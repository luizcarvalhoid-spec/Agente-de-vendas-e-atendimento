import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { after, before, test } from 'node:test'
import { promisify } from 'node:util'

import { OPENROUTER_MAX_TIMEOUT_MS } from '../src/agent/openrouter/openrouter-client.js'
import { TOOL_ORCHESTRATOR_TIMEOUT_MS } from '../src/agent/tool-orchestrator.js'
import { fingerprintEvalDataset } from '../src/evals/eval-baseline.js'
import { loadEvalDataset } from '../src/evals/eval-loader.js'
import {
  renderExternalCanaryPreparationMarkdown,
  serializeExternalCanaryPreparation,
  writeExternalCanaryPreparationReports,
} from '../src/evals/external-canary-report.js'
import {
  externalCanaryManifestSchema,
  externalCanaryReviewItems,
  type ExternalCanaryManifest,
} from '../src/evals/external-canary-schema.js'
import {
  fingerprintExternalCanaryManifest,
  prepareExternalCanary,
  rehearseExternalCanary,
} from '../src/evals/external-canary.js'
import { createInMemoryOpenRouterTransport, runLiveExternalEval } from '../src/evals/external-eval-runner.js'
import { resolveOfflineEvalDataset } from '../src/evals/offline-eval-runner.js'

const exec = promisify(execFile)
const backendRoot = resolve(import.meta.dirname, '..')
const candidateFile = join(backendRoot, 'evals/canary/first-external-candidate.v1.json')
const candidate = JSON.parse(await readFile(candidateFile, 'utf8'))
const simulatedModel = 'mock/synthetic-canary'
const simulatedProvider = 'mock-synthetic-provider'
const fakeKey = 'sk-or-fixture-never-transmitted'
const originalFetch = globalThis.fetch
let networkCalls = 0

before(() => {
  globalThis.fetch = async () => {
    networkCalls += 1
    throw new Error('fetch externo proibido no ensaio')
  }
})

after(() => {
  globalThis.fetch = originalFetch
  assert.equal(networkCalls, 0)
})

function fixture(): ExternalCanaryManifest {
  return externalCanaryManifestSchema.parse({
    ...candidate,
    experimentId: 'synthetic-canary-test',
    purpose: 'synthetic_rehearsal',
    modelId: simulatedModel,
    routing: {
      providerId: simulatedProvider,
      allowFallbacks: false,
      requireParameters: true,
      dataCollection: 'deny',
      zeroDataRetention: true,
    },
    limits: {
      maxModelCalls: 2,
      maxInputTokensPerCall: 20_000,
      maxOutputTokensPerCall: 512,
      maxExecutionTokens: 50_000,
      timeoutMs: 2_000,
      effectiveTimeoutMs: 2_000,
    },
    pricing: {
      modelId: simulatedModel,
      providerId: simulatedProvider,
      currency: 'USD',
      inputUsdPerMillionTokens: 1,
      outputUsdPerMillionTokens: 2,
      confirmedAt: '2020-01-01T00:00:00Z',
      source: 'https://prices.example.invalid/synthetic-canary',
    },
    maxBudgetUsd: 1,
    unreportedUsageMultiplier: 1.25,
    outputDirectory: 'external-eval-reports/synthetic-canary',
    sourceRevision: '0'.repeat(40),
  })
}

test('candidato inicial está pendente, sem preço fictício e com fingerprint canônico', async () => {
  const loaded = await loadEvalDataset(resolveOfflineEvalDataset(candidate.dataset.id))
  assert.equal(candidate.dataset.fingerprint, fingerprintEvalDataset(loaded))
  assert.deepEqual(candidate.scenarioIds, ['universal.core.incomplete-need.001'])
  const report = await prepareExternalCanary(candidate)
  assert.equal(report.status, 'configuration_incomplete')
  assert.equal(report.manifestFingerprint, undefined)
  assert.equal(report.budget, undefined)
  assert.equal(report.draft?.pricing, undefined)
  assert.equal(report.draft?.modelId, undefined)
  assert(report.stages.includes('financial_review_pending'))
  assert(report.stages.includes('data_policy_review_pending'))
  assert.equal(report.networkAllowed, false)
  assert.equal(report.experimentAuthorized, false)
})

test('manifesto e fingerprint são estáveis e vinculam os campos do experimento', async () => {
  const initial = fixture()
  const fingerprint = fingerprintExternalCanaryManifest(initial)
  assert.match(fingerprint, /^sha256:[a-f0-9]{64}$/)
  assert.equal(fingerprintExternalCanaryManifest(Object.fromEntries(Object.entries(initial).reverse())), fingerprint)
  const changed: ExternalCanaryManifest[] = [
    { ...initial, scenarioIds: ['universal.core.informational-no-pressure.001'] },
    { ...initial, modelId: 'mock/other-model', pricing: { ...initial.pricing, modelId: 'mock/other-model' } },
    { ...initial, routing: { ...initial.routing, providerId: 'mock-other' }, pricing: { ...initial.pricing, providerId: 'mock-other' } },
    { ...initial, pricing: { ...initial.pricing, inputUsdPerMillionTokens: 2 } },
    { ...initial, limits: { ...initial.limits, maxOutputTokensPerCall: 256 } },
    { ...initial, routing: { ...initial.routing, dataCollection: 'allow' } },
  ]
  const review = { manifestFingerprint: fingerprint, attestations: [...externalCanaryReviewItems] }
  for (const manifest of changed) {
    assert.notEqual(fingerprintExternalCanaryManifest(manifest), fingerprint)
    const report = await prepareExternalCanary(manifest, review)
    assert.equal(report.status, 'blocked')
    assert(report.issues.some(({ code }) => code === 'REVIEW_FINGERPRINT_MISMATCH'))
    assert.equal(report.requirements.local_budget, 'pending')
  }
})

test('atestações financeiras e de dados são diagnósticas e a autorização específica fica pendente', async () => {
  const manifest = fixture()
  const original = await prepareExternalCanary(manifest)
  assert.equal(original.status, 'ready_for_human_review')
  assert.equal(original.technicalPreparationComplete, true)
  assert.equal(original.requirements.local_budget, 'pending')
  assert.equal(original.requirements.provider_account_spend_limit, 'pending')
  assert.equal(original.budget?.approvedMaxBudgetUsd, undefined)
  assert.deepEqual(original.budget, {
    estimatedUsdPerCall: 0.021024,
    estimatedUsdTotal: 0.042048,
    reservedUsdPerCall: 0.02628,
    reservedUsdTotal: 0.05256,
    configuredMaxBudgetUsd: 1,
    preventiveBalanceUsd: 0.94744,
    sufficient: true,
  })

  const report = await prepareExternalCanary(manifest, {
    manifestFingerprint: original.manifestFingerprint,
    attestations: [...externalCanaryReviewItems],
  })
  assert.equal(report.requirements.price_and_source, 'attested')
  assert.equal(report.requirements.secure_credential_mechanism, 'attested')
  assert.equal(report.budget?.approvedMaxBudgetUsd, 1)
  assert.equal(report.requirements.execution_authorization, 'pending')
  assert(report.stages.includes('authorization_pending'))
  assert.equal(report.executionAllowed, false)
  assert.equal(report.networkAllowed, false)
  assert.equal(report.experimentAuthorized, false)
  assert.equal(report.experimentExecuted, false)
})

test('preflight identifica lacunas, conflitos, versão, escopo e orçamento insuficiente', async () => {
  const manifest = fixture()
  for (const [input, code, field] of [
    [{ ...manifest, pricing: { ...manifest.pricing, source: undefined } }, 'FIELD_REQUIRED', 'pricing.source'],
    [{ ...manifest, pricing: { ...manifest.pricing, confirmedAt: undefined } }, 'FIELD_REQUIRED', 'pricing.confirmedAt'],
    [{ ...manifest, pricing: { ...manifest.pricing, confirmedAt: '9999-01-01T00:00:00Z' } }, 'PRICE_CONFIRMATION_IN_FUTURE', 'pricing.confirmedAt'],
    [{ ...manifest, routing: { ...manifest.routing, dataCollection: undefined } }, 'FIELD_REQUIRED', 'routing.dataCollection'],
    [{ ...manifest, routing: { ...manifest.routing, allowFallbacks: true } }, 'MANIFEST_INVALID', undefined],
    [{ ...manifest, pricing: { ...manifest.pricing, providerId: 'mock-other' } }, 'PRICING_PROVIDER_MISMATCH', undefined],
    [{ ...manifest, limits: { ...manifest.limits, timeoutMs: OPENROUTER_MAX_TIMEOUT_MS + 1, effectiveTimeoutMs: TOOL_ORCHESTRATOR_TIMEOUT_MS } }, 'OPENROUTER_TIMEOUT_EXCEEDS_LIMIT', undefined],
    [{ ...manifest, limits: { ...manifest.limits, effectiveTimeoutMs: 1 } }, 'EFFECTIVE_TIMEOUT_MISMATCH', 'limits.effectiveTimeoutMs'],
    [{ ...manifest, maxBudgetUsd: 0.0001 }, 'ESTIMATED_COST_EXCEEDS_BUDGET', undefined],
    [{ ...manifest, dataset: { ...manifest.dataset, version: '99.0.0' } }, 'DATASET_FINGERPRINT_OR_VERSION_MISMATCH', 'dataset'],
    [{ ...manifest, scenarioIds: ['universal.other.001'] }, 'SCENARIO_NOT_FOUND', undefined],
    [{ ...manifest, scenarioIds: [] }, 'MANIFEST_INVALID', undefined],
    [{ ...manifest, manifestVersion: 99 }, 'MANIFEST_INVALID', undefined],
  ] as const) {
    const report = await prepareExternalCanary(input)
    assert(report.issues.some((issue) => issue.code === code && issue.field === field), code)
    assert.equal(report.technicalPreparationComplete, false, code)
    assert.equal(report.executionAllowed, false, code)
  }
})

function transportFor(options: {
  returnedModelId?: string
  returnedProviderId?: string | null
  withoutUsage?: boolean
  toolCall?: boolean
  status?: number
  generationId?: string
} = {}) {
  const requests: Array<Record<string, unknown>> = []
  const transport = createInMemoryOpenRouterTransport(async (_url, init) => {
    requests.push(JSON.parse(String(init?.body)))
    if (options.status !== undefined) return new Response('private-provider-error', { status: options.status })
    return Response.json({
      id: options.generationId ?? 'synthetic-generation',
      model: options.returnedModelId ?? simulatedModel,
      ...(options.returnedProviderId === null ? {} : { provider: options.returnedProviderId ?? simulatedProvider }),
      created: 0,
      choices: [{
        index: 0,
        finish_reason: options.toolCall ? 'tool_calls' : 'stop',
        message: options.toolCall ? {
          role: 'assistant',
          content: null,
          tool_calls: [{
            id: 'synthetic-tool',
            type: 'function',
            function: { name: 'search_faq', arguments: '{"query":"frete","limit":2}' },
          }],
        } : { role: 'assistant', content: 'O que você gostaria de resolver com o produto?' },
      }],
      ...(options.withoutUsage ? {} : { usage: { prompt_tokens: 300, completion_tokens: 15, total_tokens: 315 } }),
    })
  })
  return { transport, requests }
}

test('ensaio completo usa ChatService, avalia assertions e preserva a origem simulada', async () => {
  const manifest = fixture()
  const { transport, requests } = transportFor()
  const { rehearsal, ...report } = await rehearseExternalCanary(manifest, { transport })
  assert.equal(requests.length, 1)
  assert.deepEqual(requests[0]?.provider, {
    order: [simulatedProvider],
    only: [simulatedProvider],
    allow_fallbacks: false,
    require_parameters: true,
    data_collection: 'deny',
    zdr: true,
  })
  assert.equal(requests[0]?.model, simulatedModel)
  assert.equal(requests[0]?.stream, false)
  assert.equal(requests[0]?.max_completion_tokens, manifest.limits.maxOutputTokensPerCall)
  assert.equal(Object.hasOwn(requests[0]!, 'models'), false)
  assert.equal(rehearsal?.technicalStatus, 'completed')
  assert.equal(rehearsal?.evidence, 'not_real_model_performance')
  assert.deepEqual(rehearsal.returnedModelIds, [simulatedModel])
  assert.deepEqual(rehearsal.observedProviderIds, [simulatedProvider])
  assert.equal(rehearsal.assertions.passed, 2)
  assert.equal(rehearsal.assertions.notEvaluated, 0)
  assert.equal(rehearsal.requiredHumanCriteriaPending, 1)
  assert.equal(report.experimentAuthorized, false)
  assert.equal(report.experimentExecuted, false)
})

test('ensaio interrompe por excesso preventivo, divergência, provedor desconhecido e erro HTTP', async () => {
  for (const options of [
    { returnedModelId: 'mock/different-model' },
    { returnedProviderId: 'mock-different-provider' },
    { returnedProviderId: null },
    { status: 503 },
  ]) {
    const controlled = transportFor(options)
    const { rehearsal } = await rehearseExternalCanary(fixture(), controlled)
    assert.equal(controlled.requests.length, 1)
    assert.equal(rehearsal?.technicalStatus, 'technical_failure')
    assert.equal(rehearsal.assertions.failed, 0)
    assert.equal(rehearsal.assertions.notEvaluated, 2)
    if (options.returnedProviderId === null) assert.deepEqual(rehearsal.observedProviderIds, [])
    if (options.returnedProviderId) assert.equal(rehearsal.observations[0]?.providerIdentityMatches, false)
    if (options.returnedModelId) assert.deepEqual(rehearsal.returnedModelIds, [options.returnedModelId])
  }

  const manifest = fixture()
  manifest.limits.maxInputTokensPerCall = 1
  const controlled = transportFor()
  const { rehearsal } = await rehearseExternalCanary(manifest, controlled)
  assert.equal(controlled.requests.length, 0)
  assert(rehearsal?.limitsReached.includes('max_input_tokens_per_call'))
})

test('continuação após ferramenta respeita o limite global de uma chamada', async () => {
  const manifest = fixture()
  const datasetId = 'hidrasplash-conversations'
  const loaded = await loadEvalDataset(resolveOfflineEvalDataset(datasetId))
  manifest.dataset = {
    id: datasetId,
    version: loaded.data.dataset.version,
    fingerprint: fingerprintEvalDataset(loaded),
  }
  manifest.scenarioIds = ['hidrasplash.conversation.shipping-boundary.001']
  manifest.limits.maxModelCalls = 1
  const controlled = transportFor({ toolCall: true })
  const { rehearsal } = await rehearseExternalCanary(manifest, controlled)
  assert.equal(controlled.requests.length, 1)
  assert.equal(rehearsal?.technicalStatus, 'technical_failure')
  assert.equal(rehearsal.toolsExecuted, 1)
  assert(rehearsal.limitsReached.includes('max_model_calls'))
})

test('usage ausente conserva reserva e cancelamento prévio evita transporte', async () => {
  const controlled = transportFor({ withoutUsage: true })
  const report = await rehearseExternalCanary(fixture(), controlled)
  assert.equal(report.rehearsal?.consumption.callsWithoutCompleteUsage, 1)
  assert.equal(report.rehearsal?.consumption.reportedTotalTokens, 0)
  assert.equal(report.rehearsal?.consumption.chargedCostUsd, report.budget?.reservedUsdPerCall)

  const cancelled = transportFor()
  const { rehearsal } = await rehearseExternalCanary(fixture(), {
    ...cancelled,
    signal: AbortSignal.abort(),
  })
  assert.equal(cancelled.requests.length, 0)
  assert.equal(rehearsal?.operatorCancelled, true)
  assert.equal(rehearsal.technicalStatus, 'technical_failure')
})

test('cancelamento durante o transporte encerra o cenário e conserva a reserva', async () => {
  const controller = new AbortController()
  let calls = 0
  const transport = createInMemoryOpenRouterTransport(async (_url, init) => {
    calls += 1
    return new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener('abort', () => reject(new Error('synthetic cancellation')), { once: true })
      controller.abort()
    })
  })
  const report = await rehearseExternalCanary(fixture(), { transport, signal: controller.signal })
  assert.equal(calls, 1)
  assert.equal(report.rehearsal?.operatorCancelled, true)
  assert.equal(report.rehearsal.technicalStatus, 'technical_failure')
  assert.equal(report.rehearsal.consumption.chargedCostUsd, report.budget?.reservedUsdPerCall)
})

test('relatórios omitem segredos, transcrição e payload e preservam arquivos existentes', async (t) => {
  const invalid = await prepareExternalCanary({ ...fixture(), apiKey: fakeKey })
  assert.deepEqual(invalid.issues, [{ code: 'MANIFEST_INVALID' }])
  assert.doesNotMatch(serializeExternalCanaryPreparation(invalid), /fixture-never-transmitted|apiKey/)
  const report = await rehearseExternalCanary(fixture(), transportFor({ generationId: fakeKey }))
  const markdown = renderExternalCanaryPreparationMarkdown(report)
  assert.match(markdown, /Experimento autorizado: não/)
  assert.match(markdown, /Assertions aprovadas, reprovadas e pendentes: 2 \/ 0 \/ 0/)
  const directory = await mkdtemp(join(tmpdir(), 'canary-eval-test-'))
  t.after(() => rm(directory, { recursive: true, force: true }))
  const paths = await writeExternalCanaryPreparationReports(report, directory)
  await assert.rejects(writeExternalCanaryPreparationReports(report, directory), /já existe/)
  const json = await readFile(paths.json, 'utf8')
  assert.equal((JSON.parse(json) as typeof report).rehearsal?.observations[0]?.generationId, '[CREDENTIAL_REDACTED]')
  assert.equal(await readFile(paths.markdown, 'utf8'), markdown)
  for (const output of [json, markdown]) {
    assert.doesNotMatch(output, /fixture-never-transmitted|gostaria de resolver|messages|Authorization|EVAL_07B_SIMULATED_KEY/)
  }
})

test('CLI produz preparo e ensaio offline, e ambas as entradas reais seguem bloqueadas', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'canary-cli-test-'))
  t.after(() => rm(directory, { recursive: true, force: true }))
  const manifestFile = join(directory, 'synthetic-test-input.json')
  await writeFile(manifestFile, JSON.stringify(fixture()), { flag: 'wx' })
  const guard = 'data:text/javascript,globalThis.fetch%3Dasync()%3D%3E%7Bthrow%20Error(%22forbidden%22)%7D'
  const cli = (script: string, ...args: string[]) => exec(process.execPath, [
    '--import', guard, '--import', 'tsx', `src/scripts/${script}.ts`, ...args,
  ], { cwd: backendRoot, env: { ...process.env, OPENROUTER_API_KEY: fakeKey } })
  const prep = await cli('eval-canary', '--manifest', candidateFile, '--output-dir', directory)
  assert.equal(JSON.parse(prep.stdout).status, 'configuration_incomplete')
  const rehearsal = await cli('eval-canary', '--action', 'rehearse', '--manifest', manifestFile, '--output-dir', directory)
  assert.equal(JSON.parse(rehearsal.stdout).rehearsalStatus, 'completed')
  assert.equal((await readdir(directory)).filter((name) => name.endsWith('.canary.v1.md')).length, 2)
  await assert.rejects(cli('eval-canary', '--action', 'run', '--manifest', manifestFile, '--output-dir', directory))
  await assert.rejects(cli('eval-live', '--action', 'run', '--modality', 'live_external', '--dataset', 'universal-core'), /bloqueada/)
  await assert.rejects(runLiveExternalEval(), { code: 'LIVE_EXTERNAL_DISABLED' })
})
