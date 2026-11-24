import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { after, before, test } from 'node:test'

import { OPENROUTER_CHAT_COMPLETIONS_ENDPOINT } from '../src/agent/chat-completions-client.js'
import { fingerprintEvalDataset } from '../src/evals/eval-baseline.js'
import { loadEvalDataset } from '../src/evals/eval-loader.js'
import { configuredCanaryAuthorities } from '../src/evals/external-canary-authorities.js'
import { verifyCanaryOperations } from '../src/evals/external-canary-operations.js'
import { externalCanaryDraftSchema, externalCanaryManifestSchema } from '../src/evals/external-canary-schema.js'
import { CanaryAuthorizationUseStore } from '../src/evals/external-canary-use-store.js'
import { rehearseExternalCanary } from '../src/evals/external-canary.js'
import { externalEvalWorstCaseCost } from '../src/evals/external-eval-cost.js'
import { createInMemoryOpenRouterTransport, runLiveExternalEval } from '../src/evals/external-eval-runner.js'
import { resolveOfflineEvalDataset } from '../src/evals/offline-eval-runner.js'
import { functionCall, syntheticCompletion } from './fixtures/openai-direct-synthetic.js'

const backend = resolve(import.meta.dirname, '..')
const candidate = externalCanaryDraftSchema.parse(JSON.parse(await readFile(
  resolve(backend, 'evals/canary/gpt-6-luna-openrouter-candidate.v1.json'), 'utf8',
)))
const originalFetch = globalThis.fetch
let fetchCalls = 0

before(() => {
  globalThis.fetch = async () => {
    fetchCalls += 1
    throw new Error('O ensaio do canário é offline.')
  }
})
after(() => {
  globalThis.fetch = originalFetch
  assert.equal(fetchCalls, 0)
})

const standardRates = { inputUsdPerMillionTokens: 0.1, outputUsdPerMillionTokens: 0.5 }
const rehearsalManifest = externalCanaryManifestSchema.parse({
  ...candidate,
  purpose: 'synthetic_rehearsal',
  sourceRevision: '0'.repeat(40),
  pricing: {
    ...standardRates,
    currency: 'USD',
    modelId: candidate.modelId,
    providerId: candidate.routing?.providerId,
    source: 'https://pricing.example.invalid',
    confirmedAt: '2026-01-01T00:00:00Z',
  },
})

test('candidato vincula o cenário comercial e mantém preço operacional e autorização pendentes', async () => {
  const dataset = await loadEvalDataset(resolveOfflineEvalDataset(candidate.dataset.id))
  assert.equal(fingerprintEvalDataset(dataset), candidate.dataset.fingerprint)
  assert.equal(dataset.data.dataset.version, candidate.dataset.version)
  assert.deepEqual(dataset.data.cases.map((item) => item.id), candidate.scenarioIds)
  assert.deepEqual(dataset.data.cases[0]?.input.turns.map((turn) => turn.message), [
    'Olá! Estou procurando um shampoo anticaspa, mas não sei qual escolher. Vocês podem me ajudar?',
  ])
  assert.equal(candidate.transcriptPersistence, 'disabled')
  assert.deepEqual(candidate.limits, {
    maxModelCalls: 2,
    maxInputTokensPerCall: 20_000,
    maxOutputTokensPerCall: 512,
    maxExecutionTokens: 41_024,
    timeoutMs: 15_000,
    effectiveTimeoutMs: 15_000,
  })
  assert.equal(candidate.maxBudgetUsd, 1)
  assert.equal(candidate.unreportedUsageMultiplier, 1.25)
  const { maxInputTokensPerCall, effectiveTimeoutMs: _effectiveTimeoutMs, ...limits } = rehearsalManifest.limits
  assert.equal(externalEvalWorstCaseCost({
    limits: { ...limits, estimatedInputTokensPerCall: maxInputTokensPerCall },
    pricing: standardRates,
    unreportedUsageMultiplier: candidate.unreportedUsageMultiplier,
  }), 0.00564)

  const report = await verifyCanaryOperations({ manifest: candidate }, {
    authorities: configuredCanaryAuthorities,
    useStore: new CanaryAuthorizationUseStore(resolve(backend, 'external-eval-reports/canary-control')),
  })
  assert.equal(report.plan.status, 'configuration_incomplete')
  assert.equal(report.financial.estimatedReservationUsd, undefined)
  assert.equal(report.plan.manifestFingerprint, undefined)
  assert.equal(report.plan.approvedCodeRevision, undefined)
  assert.equal(report.authorizationUse, 'not_checked')
  assert.equal(report.executionAllowed, false)
  assert.equal(report.networkAllowed, false)
  assert(report.blockers.includes('MANIFEST_NOT_APPROVED'))
  assert(report.blockers.includes('PROVIDER_ACCOUNT_LIMIT_UNVERIFIED'))
  assert(report.blockers.includes('LIVE_EXECUTION_DISABLED'))
  await assert.rejects(runLiveExternalEval(), { code: 'LIVE_EXTERNAL_DISABLED' })
})

function searchCompletion(ordinal: number) {
  return syntheticCompletion(null, {
    model: rehearsalManifest.modelId,
    toolCalls: [functionCall('search_products', {
      query: 'shampoo anticaspa',
      category: 'shampoos',
      subcategory: 'anticaspa',
      requireInStock: true,
      limit: ordinal,
    }, `call-search-${ordinal}`)],
  })
}

test('transporte em memória serializa Luna e consulta o catálogo pelo ChatService', async () => {
  const requests: Array<{
    messages: Array<{ role: string; content: string; tool_call_id?: string }>
    tools?: Array<{ function: { name: string } }>
    [key: string]: unknown
  }> = []
  const { rehearsal } = await rehearseExternalCanary(rehearsalManifest, {
    transport: createInMemoryOpenRouterTransport(async (url, init) => {
      assert.equal(String(url), OPENROUTER_CHAT_COMPLETIONS_ENDPOINT)
      assert.equal(init?.method, 'POST')
      requests.push(JSON.parse(String(init?.body)))
      const completion = requests.length === 1 ? searchCompletion(1) : syntheticCompletion(
        'Você prefere um shampoo para couro cabeludo oleoso ou seco?', { model: rehearsalManifest.modelId },
      )
      return Response.json({ ...completion, provider: 'azure' })
    }),
  })
  assert.equal(requests.length, 2)
  for (const body of requests) {
    assert.deepEqual(body.provider, {
      order: ['azure'], only: ['azure'], allow_fallbacks: false,
      require_parameters: true, data_collection: 'deny', zdr: true,
    })
    assert.equal(body.model, 'openai/gpt-6-luna')
    assert.equal(body.reasoning_effort, 'none')
    assert.equal(body.service_tier, 'default')
    assert.equal(body.max_completion_tokens, 512)
    assert.equal(body.stream, false)
    assert.equal(body.tool_choice, 'auto')
    assert(body.tools?.some(({ function: tool }) => tool.name === 'search_products'))
    for (const key of ['models', 'store', 'reasoning', 'route']) assert.equal(Object.hasOwn(body, key), false)
  }
  const toolMessage = requests[1]?.messages.find((message) => message.role === 'tool')
  assert.equal(toolMessage?.tool_call_id, 'call-search-1')
  assert.equal(rehearsal?.technicalStatus, 'completed')
  assert.equal(rehearsal.toolsExecuted, 1)
  assert.equal(rehearsal.assertions.passed, 4)
  assert.equal(rehearsal.requiredHumanCriteriaPending, 3)
  assert.equal(rehearsal.evidence, 'not_real_model_performance')
  assert.deepEqual(rehearsal.returnedModelIds, ['openai/gpt-6-luna'])
  assert.deepEqual(rehearsal.observedProviderIds, ['azure'])
})

test('identidade ausente ou divergente e HTTP inválido interrompem sem retry', async () => {
  for (const response of [
    Response.json({ ...searchCompletion(1), model: 'openai/gpt-6-luna-pro', provider: 'azure' }),
    Response.json({ ...searchCompletion(1), provider: 'Azure' }),
    Response.json(searchCompletion(1)),
    new Response('error', { status: 503 }),
  ]) {
    let requests = 0
    const { rehearsal } = await rehearseExternalCanary(rehearsalManifest, {
      transport: createInMemoryOpenRouterTransport(async () => {
        requests += 1
        return response
      }),
    })
    assert.equal(requests, 1)
    assert.equal(rehearsal?.technicalStatus, 'technical_failure')
    assert.equal(rehearsal.toolsExecuted, 0)
  }
})

test('duas solicitações de ferramenta não permitem uma terceira chamada de modelo', async () => {
  let requests = 0
  const { rehearsal } = await rehearseExternalCanary(rehearsalManifest, {
    transport: createInMemoryOpenRouterTransport(async () => {
      requests += 1
      return Response.json({ ...searchCompletion(requests), provider: 'azure' })
    }),
  })
  assert.equal(requests, 2)
  assert(rehearsal?.limitsReached.includes('max_model_calls'))
})
