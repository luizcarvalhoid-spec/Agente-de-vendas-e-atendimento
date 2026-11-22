import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { after, before, test } from 'node:test'

import type { AgentModelInput } from '../src/agent/agent-model-port.js'
import { registerInMemoryChatTransport } from '../src/agent/in-memory-chat-transport.js'
import { createOpenAiDirectAgentModel, OPENAI_DIRECT_MODEL, OPENAI_DIRECT_PROTOCOL } from '../src/agent/openai/openai-direct-agent-model.js'
import { configuredCanaryAuthorities } from '../src/evals/external-canary-authorities.js'
import { verifyCanaryOperations } from '../src/evals/external-canary-operations.js'
import { CanaryAuthorizationUseStore } from '../src/evals/external-canary-use-store.js'
import { renderExternalEvalReportMarkdown, serializeExternalEvalReport } from '../src/evals/external-eval-report.js'
import { createMockExternalEvalModel, runLiveExternalEval } from '../src/evals/external-eval-runner.js'
import { openAiDirectCandidateSchema, prepareOpenAiDirectCandidate, rehearseOpenAiDirectCandidate } from '../src/evals/openai-direct-candidate.js'
import { functionCall, syntheticCompletion } from './fixtures/openai-direct-synthetic.js'

const candidate = openAiDirectCandidateSchema.parse(JSON.parse(await readFile(new URL(
  '../evals/canary/gpt-6-luna-openai-direct-candidate.v1.json', import.meta.url,
), 'utf8')))
const originalFetch = globalThis.fetch
let networkAttempts = 0
before(() => {
  globalThis.fetch = async () => {
    networkAttempts += 1
    throw new Error('A suíte não permite rede.')
  }
})
after(() => {
  globalThis.fetch = originalFetch
  assert.equal(networkAttempts, 0)
})

const tool = {
  type: 'function',
  function: { name: 'search_products', description: 'Consulta catálogo fictício.', parameters: { type: 'object' } },
} as const
const input: AgentModelInput = {
  messages: [{ role: 'system', content: 'Controle de teste sintético.' }, { role: 'user', content: 'Quero shampoo.' }],
  tools: [tool],
  signal: new AbortController().signal,
}

test('OpenAI direto serializa apenas o contrato de Chat Completions e devolve a chamada de função', async () => {
  const call = functionCall('search_products', { query: 'shampoo' })
  const transport = registerInMemoryChatTransport(async (url, init) => {
    assert.equal(url, OPENAI_DIRECT_PROTOCOL.endpoint)
    assert.equal(init?.method, 'POST')
    assert.equal(init?.redirect, 'error')
    assert.equal(new Headers(init?.headers).has('authorization'), false)
    assert.equal(new Headers(init?.headers).has('x-openrouter-metadata'), false)
    assert.deepEqual(JSON.parse(String(init?.body)), {
      model: OPENAI_DIRECT_MODEL, messages: input.messages, max_completion_tokens: 256,
      stream: false, reasoning_effort: 'none', store: false, tools: [tool], tool_choice: 'auto',
    })
    return Response.json({
      ...syntheticCompletion(null, { toolCalls: [call], usage: { prompt_tokens: 25, completion_tokens: 5, total_tokens: 30 } }),
      provider: 'untrusted-provider', endpoint_id: 'untrusted-endpoint',
    })
  })
  const observations: unknown[] = []
  const model = createOpenAiDirectAgentModel({ transport, limits: { maxOutputTokens: 256 }, onObservation(value) { observations.push(value) } })
  assert.deepEqual(await model.complete(input), {
    message: { role: 'assistant', content: null, toolCalls: [call] },
    usage: { inputTokens: 25, outputTokens: 5, totalTokens: 30 },
  })
  assert.deepEqual(observations, [{
    requestedModelId: OPENAI_DIRECT_MODEL, returnedModelId: OPENAI_DIRECT_MODEL,
    generationId: 'chatcmpl-synthetic-fixture', finishReason: 'tool_calls', usageStatus: 'complete',
    reportedUsage: { inputTokens: 25, outputTokens: 5, totalTokens: 30 }, modelIdentityMatches: true,
  }])
  await assert.rejects(model.complete({ ...input, maxOutputTokens: 257 }), { code: 'CONFIGURATION_INVALID', transportStarted: false })
})

test('truncamento, recusa, payload malformado e função não registrada são rejeitados', async (t) => {
  for (const [label, raw, code] of [
    ['truncamento', syntheticCompletion('Fragmento', { finishReason: 'length' }), 'INVALID_MODEL_RESPONSE'],
    ['recusa', syntheticCompletion('Resposta recusada', { refusal: 'Synthetic refusal' }), 'INVALID_MODEL_RESPONSE'],
    ['payload malformado', { choices: [] }, 'INVALID_MODEL_RESPONSE'],
    ['função não registrada', syntheticCompletion(null, { toolCalls: [functionCall('unknown_tool', {})] }), 'TOOL_CALLING_INCOMPATIBLE'],
  ] as const) {
    await t.test(label, async () => {
      const model = createOpenAiDirectAgentModel({ transport: registerInMemoryChatTransport(async () => Response.json(raw)) })
      await assert.rejects(model.complete(input), { code, transportStarted: true })
    })
  }
})

test('modelo divergente interrompe chamadas seguintes e preserva a observação literal', async () => {
  let calls = 0
  const observed: string[] = []
  const model = createOpenAiDirectAgentModel({
    transport: registerInMemoryChatTransport(async () => {
      calls += 1
      return Response.json(syntheticCompletion('Resposta sintética.', { model: 'wrong-model' }))
    }),
    onObservation(observation) { observed.push(observation.returnedModelId) },
  })
  await assert.rejects(model.complete(input), { code: 'INVALID_MODEL_RESPONSE', transportStarted: true })
  await assert.rejects(model.complete(input), { code: 'INVALID_MODEL_RESPONSE', transportStarted: false })
  assert.deepEqual(observed, ['wrong-model'])
  assert.equal(calls, 1)
})

test('erros HTTP são neutralizados sem ler o corpo ou repetir a solicitação', async (t) => {
  for (const [status, code] of [
    [400, 'CONFIGURATION_INVALID'], [401, 'AUTHENTICATION_FAILED'], [403, 'AUTHENTICATION_FAILED'],
    [429, 'PROVIDER_RATE_LIMITED'], [503, 'PROVIDER_UNAVAILABLE'],
  ] as const) {
    await t.test(String(status), async () => {
      let calls = 0
      const model = createOpenAiDirectAgentModel({ transport: registerInMemoryChatTransport(async () => {
        calls += 1
        return new Response('sk-synthetic-error-fixture', { status })
      }) })
      await assert.rejects(model.complete(input), (error: unknown) => {
        assert(error instanceof Error)
        assert.doesNotMatch(error.message, /sk-synthetic/)
        assert.equal((error as Error & { code: string }).code, code)
        return true
      })
      assert.equal(calls, 1)
    })
  }
})

test('timeout e cancelamento interrompem transporte não cooperativo', async () => {
  let calls = 0
  const timeout = createOpenAiDirectAgentModel({
    limits: { timeoutMs: 15 },
    transport: registerInMemoryChatTransport(async () => {
      calls += 1
      return new Promise<Response>(() => undefined)
    }),
  })
  await assert.rejects(timeout.complete(input), { code: 'MODEL_TIMEOUT', transportStarted: true })
  const controller = new AbortController()
  const cancelled = createOpenAiDirectAgentModel({ transport: registerInMemoryChatTransport(async () => {
    calls += 1
    controller.abort()
    return new Promise<Response>(() => undefined)
  }) })
  await assert.rejects(cancelled.complete({ ...input, signal: controller.signal }), { code: 'MODEL_CANCELLED', transportStarted: true })
  await assert.rejects(cancelled.complete({ ...input, signal: controller.signal }), { code: 'MODEL_CANCELLED', transportStarted: false })
  assert.equal(calls, 2)
})

test('candidato calcula reserva documental e preserva os gates e a procedência', async () => {
  const prepared = await prepareOpenAiDirectCandidate(candidate)
  assert.equal(prepared.simulationReady, true)
  assert.equal(prepared.documentaryReserveUsd, 0.00564)
  assert.equal(prepared.experimentAuthorized, false)
  assert.equal(prepared.observedEndpointIdentity, 'not_observed')
  assert.equal(prepared.transportOrigin.configuredProvider, 'openai')
  assert(prepared.operationalBlockers.includes('DATA_RETENTION_REVIEW_PENDING'))
  assert(prepared.operationalBlockers.includes('LIVE_EXECUTION_DISABLED'))
  const changed = await prepareOpenAiDirectCandidate({ ...candidate, pricing: { ...candidate.pricing, outputUsdPerMillionTokens: 0.6 } })
  assert.notEqual(changed.candidateFingerprint, prepared.candidateFingerprint)
  const mismatched = await prepareOpenAiDirectCandidate({
    ...candidate, dataset: { ...candidate.dataset, fingerprint: `sha256:${'0'.repeat(64)}` },
  })
  assert.equal(mismatched.simulationReady, false)
  assert(mismatched.simulationBlockers.includes('DATASET_FINGERPRINT_MISMATCH'))
  assert.equal(openAiDirectCandidateSchema.safeParse({ ...candidate, liveAuthorization: true }).success, false)
  assert.equal(openAiDirectCandidateSchema.safeParse({ ...candidate, pricing: { ...candidate.pricing, providerId: 'azure' } }).success, false)
  assert.equal(openAiDirectCandidateSchema.safeParse({
    ...candidate, limits: { ...candidate.limits, timeoutMs: 60_001, effectiveTimeoutMs: 45_000 },
  }).success, false)
  const gate = await verifyCanaryOperations({ manifest: candidate }, {
    authorities: configuredCanaryAuthorities,
    useStore: new CanaryAuthorizationUseStore('external-eval-reports/no-authorization-fixture'),
  })
  assert(gate.blockers.includes('MANIFEST_INVALID'))
  assert(gate.blockers.includes('LIVE_EXECUTION_DISABLED'))
  assert.equal(gate.executionAllowed, false)
  await assert.rejects(runLiveExternalEval(), { code: 'LIVE_EXTERNAL_DISABLED' })
  await assert.rejects(rehearseOpenAiDirectCandidate(candidate, globalThis.fetch), { code: 'LIVE_EXTERNAL_DISABLED' })
  assert.throws(() => createOpenAiDirectAgentModel({ transport: async () => Response.json({}) }), { code: 'CONFIGURATION_INVALID' })
  const offlineModel = createOpenAiDirectAgentModel({ transport: registerInMemoryChatTransport(async () => Response.json({})) })
  assert.throws(() => createMockExternalEvalModel(offlineModel), { code: 'EXTERNAL_MODEL_FORBIDDEN' })
})

test('usage incompleto mantém reserva e relatórios não propagam conteúdo bruto', async () => {
  for (const [usage, status] of [
    [undefined, 'missing'],
    [{ prompt_tokens: 20, completion_tokens: 2, total_tokens: 900 }, 'inconsistent'],
  ] as const) {
    const simulated = await rehearseOpenAiDirectCandidate(candidate, registerInMemoryChatTransport(async () => Response.json(
      syntheticCompletion('Qual tipo de produto você procura para sua rotina?', { usage, id: 'sk-synthetic-credential' }),
    )))
    const { evaluation } = simulated
    assert.equal(evaluation.execution.technicalStatus, 'completed')
    assert.equal(evaluation.execution.modelCalls, 1)
    assert.equal(evaluation.consumption.chargedCostUsd, 0.00282)
    assert.equal(evaluation.consumption.callsWithoutCompleteUsage, 1)
    assert.equal(evaluation.model.observations[0]?.usageStatus, status)
    assert.deepEqual(evaluation.model.providerIds, [])
    assert.deepEqual(evaluation.model.returnedIds, [OPENAI_DIRECT_MODEL])
    for (const output of [JSON.stringify(simulated), serializeExternalEvalReport(evaluation), renderExternalEvalReportMarkdown(evaluation)]) {
      assert.doesNotMatch(output, /sk-synthetic-credential|Qual tipo de produto|Bearer/)
    }
  }
})

test('orçamento insuficiente barra o transporte e duas chamadas são o máximo do ensaio', async () => {
  let calls = 0
  const transport = registerInMemoryChatTransport(async () => {
    calls += 1
    const call = functionCall('search_products', { query: `shampoo ${calls}`, limit: 1 }, `call-search-${calls}`)
    return Response.json(syntheticCompletion(null, { toolCalls: [call] }))
  })
  await assert.rejects(rehearseOpenAiDirectCandidate({ ...candidate, maxBudgetUsd: 0.001 }, transport), { code: 'PLAN_BLOCKED' })
  assert.equal(calls, 0)
  const report = await rehearseOpenAiDirectCandidate(candidate, transport)
  assert.equal(calls, 2)
  assert.equal(report.evaluation.execution.modelCalls, 2)
  assert(report.evaluation.execution.limitsReached.includes('max_model_calls'))
  assert.equal(report.evaluation.consumption.chargedCostUsd, 0.00564)
})
