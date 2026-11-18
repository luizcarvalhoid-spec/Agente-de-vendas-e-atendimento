import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import test from 'node:test'
import { promisify } from 'node:util'

import {
  AgentModelError,
  type AgentModelInput,
  type AgentModelPort,
  type AgentModelResult,
  type AgentToolCall,
} from '../src/agent/agent-model-port.js'
import { createOpenRouterAgentModel } from '../src/agent/openrouter/openrouter-agent-model.js'
import { createOpenRouterClient } from '../src/agent/openrouter/openrouter-client.js'
import { ExternalEvalCostController } from '../src/evals/external-eval-cost.js'
import {
  ExternalEvalHumanReviewError,
  prepareExternalEvalHumanReview,
} from '../src/evals/external-eval-human-review.js'
import { loadHumanEvalRubric } from '../src/evals/human-eval-rubric.js'
import { loadEvalDataset } from '../src/evals/eval-loader.js'
import { planExternalEval } from '../src/evals/external-eval-plan.js'
import {
  ExternalEvalReportWriteError,
  renderExternalEvalReportMarkdown,
  serializeExternalEvalReport,
  writeExternalEvalReports,
} from '../src/evals/external-eval-report.js'
import {
  createMockExternalEvalModel,
  ExternalEvalExecutionError,
  runLiveExternalEval,
  runMockExternalEval,
} from '../src/evals/external-eval-runner.js'
import {
  externalEvalReportSchema,
  type ExternalEvalPlanRequest,
} from '../src/evals/external-eval-schema.js'
import {
  resolveOfflineEvalDataset,
} from '../src/evals/offline-eval-runner.js'
import { createMvpDeterministicModel } from './helpers/mvp-deterministic-model.js'

const execFileAsync = promisify(execFile)
const backendRoot = resolve(import.meta.dirname, '..')
const confirmedAt = '2026-11-15T12:00:00.000Z'

function validRequest(
  overrides: Partial<ExternalEvalPlanRequest> = {},
): ExternalEvalPlanRequest {
  return {
    modality: 'mock_external',
    datasetId: 'universal-core',
    scenarioIds: ['universal.core.incomplete-need.001'],
    modelId: 'mock/vendor-model-v1',
    outputDirectory: './external-eval-reports/test',
    limits: {
      maxModelCalls: 6,
      maxOutputTokensPerCall: 512,
      maxExecutionTokens: 150_000,
      estimatedInputTokensPerCall: 20_000,
      timeoutMs: 2_000,
    },
    pricing: {
      modelId: 'mock/vendor-model-v1',
      currency: 'USD',
      inputUsdPerMillionTokens: 1,
      outputUsdPerMillionTokens: 2,
      confirmedAt,
    },
    maxBudgetUsd: 1,
    unreportedUsageMultiplier: 1.25,
    ...overrides,
  }
}

function toolCall(id: string, name: string, args: unknown): AgentToolCall {
  return {
    id,
    type: 'function',
    function: { name, arguments: JSON.stringify(args) },
  }
}

function result(
  content: string | null,
  calls?: readonly AgentToolCall[],
  usage: AgentModelResult['usage'] = {
    inputTokens: 100,
    outputTokens: 20,
    totalTokens: 120,
  },
): AgentModelResult {
  return {
    message: {
      role: 'assistant',
      content,
      ...(calls === undefined ? {} : { toolCalls: calls }),
    },
    ...(usage === undefined ? {} : { usage }),
  }
}

function input(
  maxOutputTokens = 100,
  signal = new AbortController().signal,
): AgentModelInput {
  return {
    messages: [{ role: 'user', content: 'teste controlado' }],
    tools: [],
    signal,
    maxOutputTokens,
  }
}

function faqNotFoundModel(): AgentModelPort {
  return {
    async complete(modelInput) {
      if (modelInput.messages.some((message) => message.role === 'tool')) {
        return result('Não encontrei uma fonte aplicável.')
      }
      return result(null, [
        toolCall('faq-missing', 'search_faq', {
          query: 'politica completamente inexistente xyz',
          limit: 1,
        }),
      ])
    },
  }
}

function mockModel(model: AgentModelPort) {
  return createMockExternalEvalModel(model)
}

function controlledPromise<T>() {
  let resolvePromise!: (value: T | PromiseLike<T>) => void
  let rejectPromise!: (reason?: unknown) => void
  const promise = new Promise<T>((resolve, reject) => {
    resolvePromise = resolve
    rejectPromise = reject
  })
  return { promise, resolve: resolvePromise, reject: rejectPromise }
}

test('preflight completo funciona sem rede, credencial ou execução', async () => {
  const originalFetch = globalThis.fetch
  const originalKey = process.env.OPENROUTER_API_KEY
  let calls = 0
  globalThis.fetch = async () => {
    calls += 1
    throw new Error('network forbidden')
  }
  delete process.env.OPENROUTER_API_KEY
  try {
    const { plan } = await planExternalEval(
      validRequest({ modality: 'dry_run' }),
    )
    assert.equal(plan.status, 'ready')
    assert.equal(plan.executionAllowed, false)
    assert.equal(plan.networkAllowed, false)
    assert.equal(plan.scenarioCount, 1)
    assert.equal(plan.turnCount, 1)
    assert.equal(calls, 0)
  } finally {
    globalThis.fetch = originalFetch
    if (originalKey === undefined) delete process.env.OPENROUTER_API_KEY
    else process.env.OPENROUTER_API_KEY = originalKey
  }
})

test('live_external permanece bloqueado mesmo com chave e confirmação', async () => {
  const originalKey = process.env.OPENROUTER_API_KEY
  process.env.OPENROUTER_API_KEY = 'sk-or-test-should-not-authorize'
  try {
    const { plan } = await planExternalEval(
      validRequest({
        modality: 'live_external',
        liveAuthorization: {
          enabled: true,
          confirmation: 'I_AUTHORIZE_LIVE_EXTERNAL_EVAL',
        },
      }),
    )
    assert.equal(plan.status, 'blocked')
    assert.equal(plan.executionAllowed, false)
    assert.equal(plan.networkAllowed, false)
    assert(
      plan.blockers.some(
        (item) => item.code === 'LIVE_EXTERNAL_DISABLED',
      ),
    )
    await assert.rejects(
      runLiveExternalEval(),
      (error: unknown) =>
        error instanceof ExternalEvalExecutionError &&
        error.code === 'LIVE_EXTERNAL_DISABLED',
    )
  } finally {
    if (originalKey === undefined) delete process.env.OPENROUTER_API_KEY
    else process.env.OPENROUTER_API_KEY = originalKey
  }
})

test('mock_external rejeita adaptador OpenRouter conhecido antes do transporte', async () => {
  let transports = 0
  const client = createOpenRouterClient({
    apiKey: 'mock-key-that-must-not-be-used',
    model: 'connected/provider-model',
    transport: async () => {
      transports += 1
      throw new Error('transport must not start')
    },
  })
  const connected = createOpenRouterAgentModel(client)
  await assert.rejects(
    runMockExternalEval(validRequest(), {
      createModel: () =>
        connected as ReturnType<typeof createMockExternalEvalModel>,
    }),
    (error: unknown) =>
      error instanceof ExternalEvalExecutionError &&
      error.code === 'EXTERNAL_MODEL_FORBIDDEN',
  )
  assert.equal(transports, 0)
  assert.throws(
    () => createMockExternalEvalModel(connected),
    (error: unknown) =>
      error instanceof ExternalEvalExecutionError &&
      error.code === 'EXTERNAL_MODEL_FORBIDDEN',
  )
})

test('preflight localiza dataset, cenários inválidos e duplicados', async () => {
  const missingDataset = await planExternalEval(
    validRequest({ datasetId: 'missing-dataset' }),
  )
  assert(
    missingDataset.plan.blockers.some(
      (item) => item.code === 'DATASET_NOT_FOUND',
    ),
  )
  const missingScenario = await planExternalEval(
    validRequest({ scenarioIds: ['missing.scenario'] }),
  )
  assert(
    missingScenario.plan.blockers.some(
      (item) => item.code === 'SCENARIO_NOT_FOUND',
    ),
  )
  const duplicated = await planExternalEval(
    validRequest({
      scenarioIds: [
        'universal.core.incomplete-need.001',
        'universal.core.incomplete-need.001',
      ],
    }),
  )
  assert(
    duplicated.plan.blockers.some(
      (item) => item.code === 'SCENARIO_DUPLICATED',
    ),
  )
})

test('preflight exige limites, preço, orçamento, margem e destino', async () => {
  const { plan } = await planExternalEval({
    modality: 'dry_run',
    datasetId: 'universal-core',
  })
  const codes = new Set(plan.blockers.map((item) => item.code))
  for (const code of [
    'MODEL_REQUIRED',
    'LIMITS_REQUIRED',
    'PRICING_REQUIRED',
    'BUDGET_REQUIRED',
    'USAGE_MARGIN_REQUIRED',
    'OUTPUT_DIRECTORY_REQUIRED',
  ] as const) {
    assert(codes.has(code))
  }
})

test('preflight valida planejamento de chamadas, tokens, preço e pior caso', async () => {
  const request = validRequest()
  const { plan } = await planExternalEval(request)
  assert.equal(plan.status, 'ready')
  assert.equal(plan.limits?.maxModelCalls, 6)
  assert.equal(plan.limits?.maxExecutionTokens, 150_000)
  assert((plan.estimatedWorstCaseUsd ?? 0) > 0)

  const mismatch = await planExternalEval(
    validRequest({
      pricing: {
        ...request.pricing!,
        modelId: 'mock/other-model',
      },
    }),
  )
  assert(
    mismatch.plan.blockers.some(
      (item) => item.code === 'PRICING_MODEL_MISMATCH',
    ),
  )
  const expensive = await planExternalEval(
    validRequest({ maxBudgetUsd: 0.000001 }),
  )
  assert(
    expensive.plan.blockers.some(
      (item) => item.code === 'ESTIMATED_COST_EXCEEDS_BUDGET',
    ),
  )
})

test('execução mock multi-turno usa ChatService, ferramentas e assertions reais', async () => {
  const report = await runMockExternalEval(
    validRequest({
      datasetId: 'hidrasplash-conversations',
      scenarioIds: ['hidrasplash.conversation.budget-change.001'],
    }),
    {
      createModel: () => mockModel(createMvpDeterministicModel()),
      providerModelId: 'mock/provider-reported-v1',
    },
  )
  assert.equal(report.modality, 'mock_external')
  assert.equal(report.provenance, 'simulated_external_transport')
  assert.equal(report.performanceEvidence, 'not_real_model_performance')
  assert.equal(report.scenarios[0]?.turns.length, 2)
  assert.equal(report.execution.technicalFailures, 0)
  assert.equal(report.execution.modelCalls, 4)
  assert.equal(report.execution.toolCallsRequested, 2)
  assert.equal(report.execution.toolsExecuted, 2)
  assert.equal(report.objectiveEvaluation.summary.assertions.passed, 8)
  assert.equal(report.objectiveEvaluation.summary.assertions.failed, 0)
  assert.deepEqual(report.model.providerReportedIds, [
    'mock/provider-reported-v1',
  ])
})

test('cada cenário recebe instância isolada do modelo', async () => {
  let factories = 0
  const report = await runMockExternalEval(
    validRequest({
      scenarioIds: [
        'universal.core.incomplete-need.001',
        'universal.core.informational-no-pressure.001',
      ],
    }),
    {
      createModel: () => {
        factories += 1
        return mockModel(createMvpDeterministicModel())
      },
    },
  )
  assert.equal(factories, 2)
  assert.equal(report.execution.scenarios, 2)
})

test('uso ausente preserva medição incompleta e reserva conservadora', async () => {
  const report = await runMockExternalEval(
    validRequest({
      datasetId: 'hidrasplash-conversations',
      scenarioIds: ['hidrasplash.conversation.shipping-boundary.001'],
    }),
    {
      createModel: () => {
        const delegate = createMvpDeterministicModel()
        return mockModel({
          async complete(modelInput) {
            const completed = await delegate.complete(modelInput)
            return { message: completed.message }
          },
        })
      },
    },
  )
  assert(report.consumption.callsWithoutCompleteUsage > 0)
  assert.equal(report.consumption.reportedTotalTokens, 0)
  assert(report.consumption.chargedCostUsd > 0)
  assert(
    report.modelCalls
      .filter((call) => call.status !== 'rejected')
      .every((call) => call.usageComplete === false),
  )
})

test('guard recusa saída, chamadas, tokens e próximo custo antes do transporte', async () => {
  let transports = 0
  const controller = new ExternalEvalCostController({
    requestedModelId: 'mock/cost-model',
    limits: {
      maxModelCalls: 2,
      maxOutputTokensPerCall: 60,
      maxExecutionTokens: 10_000,
      estimatedInputTokensPerCall: 50,
      timeoutMs: 1_000,
    },
    pricing: {
      modelId: 'mock/cost-model',
      currency: 'USD',
      inputUsdPerMillionTokens: 1,
      outputUsdPerMillionTokens: 1,
      confirmedAt,
    },
    maxBudgetUsd: 0.0025,
    unreportedUsageMultiplier: 1,
  })
  const wrapped = controller.wrap({
    async complete() {
      transports += 1
      return result('ok', undefined, {
        inputTokens: 200,
        outputTokens: 100,
        totalTokens: 300,
      })
    },
  })
  await assert.rejects(
    wrapped.complete(input(61)),
    (error: unknown) =>
      error instanceof AgentModelError && !error.transportStarted,
  )
  await wrapped.complete(input(60))
  await assert.rejects(
    wrapped.complete(input(60)),
    (error: unknown) =>
      error instanceof AgentModelError &&
      error.code === 'LOCAL_BUDGET_EXHAUSTED',
  )
  assert.equal(transports, 1)
  assert.deepEqual(controller.snapshot().limitsReached, [
    'max_budget_usd',
    'max_output_tokens_per_call',
  ])
})

test('guard aplica tetos globais de chamadas e tokens', async () => {
  let calls = 0
  const makeController = (
    maxModelCalls: number,
    maxExecutionTokens: number,
  ) =>
    new ExternalEvalCostController({
      requestedModelId: 'mock/limits-model',
      limits: {
        maxModelCalls,
        maxOutputTokensPerCall: 60,
        maxExecutionTokens,
        estimatedInputTokensPerCall: 50,
        timeoutMs: 1_000,
      },
      pricing: {
        modelId: 'mock/limits-model',
        currency: 'USD',
        inputUsdPerMillionTokens: 1,
        outputUsdPerMillionTokens: 1,
        confirmedAt,
      },
      maxBudgetUsd: 1,
      unreportedUsageMultiplier: 1,
    })
  const raw: AgentModelPort = {
    async complete() {
      calls += 1
      return result('ok', undefined, undefined)
    },
  }

  const callController = makeController(1, 10_000)
  const callLimited = callController.wrap(raw)
  await callLimited.complete(input(60))
  await assert.rejects(callLimited.complete(input(60)))
  assert(callController.snapshot().limitsReached.includes('max_model_calls'))

  const tokenController = makeController(3, 2_300)
  const tokenLimited = tokenController.wrap(raw)
  await tokenLimited.complete(input(60))
  await assert.rejects(tokenLimited.complete(input(60)))
  assert(
    tokenController.snapshot().limitsReached.includes('max_execution_tokens'),
  )
  assert.equal(calls, 2)
})

test('reservas ativas impedem estouro concorrente e liberam excedente reportado', async () => {
  const pending = controlledPromise<AgentModelResult>()
  let transports = 0
  const controller = new ExternalEvalCostController({
    requestedModelId: 'mock/concurrent-model',
    limits: {
      maxModelCalls: 3,
      maxOutputTokensPerCall: 100,
      maxExecutionTokens: 10_000,
      estimatedInputTokensPerCall: 1_000,
      timeoutMs: 1_000,
    },
    pricing: {
      modelId: 'mock/concurrent-model',
      currency: 'USD',
      inputUsdPerMillionTokens: 1,
      outputUsdPerMillionTokens: 1,
      confirmedAt,
    },
    maxBudgetUsd: 0.003,
    unreportedUsageMultiplier: 1,
  })
  const wrapped = controller.wrap({
    async complete() {
      transports += 1
      return pending.promise
    },
  })
  const first = wrapped.complete(input(100))
  assert.equal(controller.snapshot().activeReservations, 1)
  assert(controller.snapshot().activeReservedCostUsd > 0.002)
  assert(controller.snapshot().activeReservedCostUsd < 0.003)
  await assert.rejects(
    wrapped.complete(input(100)),
    (error: unknown) =>
      error instanceof AgentModelError &&
      error.code === 'LOCAL_BUDGET_EXHAUSTED' &&
      !error.transportStarted,
  )
  assert.equal(transports, 1)
  pending.resolve(result('ok', undefined, {
    inputTokens: 10,
    outputTokens: 10,
    totalTokens: 20,
  }))
  await first
  const reconciled = controller.snapshot()
  assert.equal(reconciled.activeReservations, 0)
  assert.equal(reconciled.activeReservedCostUsd, 0)
  assert.equal(reconciled.chargedCostUsd, 0.00002)
  assert.equal(reconciled.preventiveAvailableCostUsd, 0.00298)
  await wrapped.complete(input(100))
  assert.equal(transports, 2)
})

test('usage ausente mantém reserva conservadora após reconciliação', async () => {
  const controller = new ExternalEvalCostController({
    requestedModelId: 'mock/unreported-model',
    limits: {
      maxModelCalls: 2,
      maxOutputTokensPerCall: 100,
      maxExecutionTokens: 10_000,
      estimatedInputTokensPerCall: 1_000,
      timeoutMs: 1_000,
    },
    pricing: {
      modelId: 'mock/unreported-model',
      currency: 'USD',
      inputUsdPerMillionTokens: 1,
      outputUsdPerMillionTokens: 1,
      confirmedAt,
    },
    maxBudgetUsd: 0.003,
    unreportedUsageMultiplier: 1,
  })
  const wrapped = controller.wrap({
    async complete() {
      return {
        message: { role: 'assistant' as const, content: 'ok' },
      }
    },
  })
  await wrapped.complete(input(100))
  const snapshot = controller.snapshot()
  assert.equal(snapshot.activeReservations, 0)
  assert(snapshot.chargedCostUsd > 0.002)
  assert(snapshot.chargedCostUsd < 0.003)
  assert.equal(snapshot.calls[0]?.usageComplete, false)
  await assert.rejects(wrapped.complete(input(100)))
})

test('cancelamento e falha pré-transporte reconciliam a reserva uma única vez', async () => {
  const controller = new ExternalEvalCostController({
    requestedModelId: 'mock/reconciliation-model',
    limits: {
      ...validRequest().limits!,
      maxModelCalls: 2,
    },
    pricing: validRequest().pricing!,
    maxBudgetUsd: 1,
    unreportedUsageMultiplier: 1,
  })
  const pending = controlledPromise<AgentModelResult>()
  const cancellation = new AbortController()
  const cancelled = controller.wrap({
    async complete() {
      return pending.promise
    },
  })
  const cancelledCall = cancelled.complete(input(100, cancellation.signal))
  cancellation.abort(new AgentModelError('MODEL_CANCELLED', true))
  await assert.rejects(cancelledCall)
  const afterCancellation = controller.snapshot()
  assert.equal(afterCancellation.activeReservations, 0)
  assert.equal(afterCancellation.transportedCalls, 1)
  assert(afterCancellation.chargedCostUsd > 0)
  pending.resolve(result('late result'))
  await Promise.resolve()
  assert.equal(controller.snapshot().calls.length, 1)
  assert.equal(controller.snapshot().chargedCostUsd, afterCancellation.chargedCostUsd)

  const rejected = controller.wrap({
    async complete() {
      throw new AgentModelError('TOOL_CALLING_INCOMPATIBLE', false)
    },
  })
  await assert.rejects(rejected.complete(input()))
  const afterRejection = controller.snapshot()
  assert.equal(afterRejection.activeReservations, 0)
  assert.equal(afterRejection.transportedCalls, 1)
  assert.equal(
    afterRejection.chargedCostUsd,
    afterCancellation.chargedCostUsd,
  )
  assert.equal(afterRejection.calls[1]?.chargedCostUsd, 0)
})

test('timeout e cancelamento permanecem falhas técnicas, não comportamentais', async () => {
  const timeoutReport = await runMockExternalEval(validRequest(), {
    createModel: () => mockModel({
      async complete() {
        throw new AgentModelError('MODEL_TIMEOUT', true)
      },
    }),
  })
  assert.equal(timeoutReport.execution.technicalFailures, 1)
  assert.equal(timeoutReport.modelCalls[0]?.status, 'timeout')
  assert(
    timeoutReport.objectiveEvaluation.summary.assertions.notEvaluated > 0,
  )

  const controller = new ExternalEvalCostController({
    requestedModelId: 'mock/cancel-model',
    limits: validRequest().limits!,
    pricing: validRequest().pricing!,
    maxBudgetUsd: 1,
    unreportedUsageMultiplier: 1.25,
  })
  const cancelled = controller.wrap({
    async complete() {
      throw new AgentModelError('MODEL_CANCELLED', true)
    },
  })
  await assert.rejects(cancelled.complete(input()))
  assert.equal(controller.snapshot().calls[0]?.status, 'cancelled')

  const incompatible = await runMockExternalEval(validRequest(), {
    createModel: () => mockModel({
      async complete() {
        throw new AgentModelError('TOOL_CALLING_INCOMPATIBLE', false)
      },
    }),
  })
  assert.equal(incompatible.execution.technicalFailures, 1)
  assert.equal(
    incompatible.modelCalls[0]?.errorCode,
    'TOOL_CALLING_INCOMPATIBLE',
  )
})

test('HTTP 401, 402, 429 e 5xx simulados usam códigos sanitizados', async () => {
  const cases = [
    [401, 'AUTHENTICATION_FAILED'],
    [402, 'AUTHENTICATION_FAILED'],
    [429, 'PROVIDER_RATE_LIMITED'],
    [503, 'PROVIDER_UNAVAILABLE'],
  ] as const
  for (const [status, code] of cases) {
    let calls = 0
    const client = createOpenRouterClient({
      apiKey: 'mock-key',
      model: 'mock/provider-model',
      transport: async () => {
        calls += 1
        return new Response('', { status })
      },
    })
    const model = createOpenRouterAgentModel(client)
    await assert.rejects(
      model.complete({
        ...input(),
        tools: [
          {
            type: 'function',
            function: {
              name: 'mock_tool',
              description: 'Ferramenta simulada.',
              parameters: { type: 'object', properties: {} },
            },
          },
        ],
      }),
      (error: unknown) =>
        error instanceof AgentModelError && error.code === code,
    )
    assert.equal(calls, 1)
  }
})

test('ferramenta solicitada, executada, rejeitada e grounding não são confundidos', async () => {
  const grounded = await runMockExternalEval(
    validRequest({
      datasetId: 'hidrasplash-conversations',
      scenarioIds: ['hidrasplash.conversation.shipping-boundary.001'],
    }),
    { createModel: () => mockModel(createMvpDeterministicModel()) },
  )
  assert.equal(grounded.execution.toolCallsRequested, 1)
  assert.equal(grounded.execution.toolsExecuted, 1)
  assert.equal(grounded.scenarios[0]?.turns[0]?.grounding.faq, 'found')

  const rejected = await runMockExternalEval(
    validRequest({
      datasetId: 'hidrasplash-conversations',
      scenarioIds: ['hidrasplash.conversation.shipping-boundary.001'],
    }),
    {
      createModel: () => mockModel({
        async complete() {
          return result(null, [
            toolCall('unknown-call', 'unknown_tool', {}),
          ])
        },
      }),
    },
  )
  assert(rejected.execution.toolCallsRequested > 0)
  assert.equal(rejected.execution.toolsExecuted, 0)
  assert(rejected.execution.toolRejections > 0)
  assert.notEqual(
    rejected.scenarios[0]?.turns[0]?.grounding.faq,
    'found',
  )
})

test('falha crítica objetiva continua visível sem ajustar o scoring', async () => {
  const report = await runMockExternalEval(
    validRequest({
      datasetId: 'hidrasplash-conversations',
      scenarioIds: ['hidrasplash.conversation.shipping-boundary.001'],
    }),
    { createModel: () => mockModel(faqNotFoundModel()) },
  )
  assert(report.objectiveEvaluation.summary.assertions.failed > 0)
  assert(report.objectiveEvaluation.summary.criticalFailures > 0)
  assert((report.objectiveEvaluation.summary.objectiveScore?.final ?? 10) <= 3)
})

test('JSON e Markdown são equivalentes, sanitizados e não sobrescrevem', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'external-eval-report-'))
  t.after(() => rm(directory, { recursive: true, force: true }))
  const secret = 'sk-or-super-secret-value'
  const report = await runMockExternalEval(
    validRequest({
      modelId: secret,
      pricing: {
        ...validRequest().pricing!,
        modelId: secret,
      },
      outputDirectory: directory,
    }),
    { createModel: () => mockModel(createMvpDeterministicModel()) },
  )
  const json = serializeExternalEvalReport(report)
  const markdown = renderExternalEvalReportMarkdown(report)
  assert.deepEqual(
    externalEvalReportSchema.parse(JSON.parse(json)),
    report,
  )
  assert.doesNotMatch(json, /sk-or-super-secret-value/)
  assert.doesNotMatch(json, /Preciso escolher um produto/)
  assert.doesNotMatch(markdown, /sk-or-super-secret-value/)
  assert.match(markdown, /not\\_real\\_model\\_performance/)
  const written = await writeExternalEvalReports(report, directory)
  assert.equal((await readFile(written.json, 'utf8')).includes(secret), false)
  await assert.rejects(
    writeExternalEvalReports(report, directory),
    ExternalEvalReportWriteError,
  )
})

test('amostra mock para EVAL-06 permanece não representativa de modelo real', async () => {
  const request = validRequest()
  const [{ loaded }, rubric, report] = await Promise.all([
    planExternalEval(request),
    loadHumanEvalRubric(),
    runMockExternalEval(request, {
      createModel: () => mockModel(createMvpDeterministicModel()),
    }),
  ])
  assert(loaded)
  const reviewPackage = prepareExternalEvalHumanReview({
    report,
    loaded,
    rubric,
    scenarioId: 'universal.core.incomplete-need.001',
    assistantTurns: ['Qual necessidade você deseja priorizar?'],
  })
  assert.equal(reviewPackage.packageStatus, 'prepared_not_evaluated')
  assert.equal(reviewPackage.sample.origin.kind, 'unverified')
  assert.equal(
    reviewPackage.sample.origin.performanceEvidence,
    'not_real_performance',
  )
  assert(
    reviewPackage.reviewItems.every(
      (item) => item.status === 'not_evaluated',
    ),
  )

  const sameTranscript = prepareExternalEvalHumanReview({
    report,
    loaded,
    rubric,
    scenarioId: 'universal.core.incomplete-need.001',
    assistantTurns: ['Qual necessidade você deseja priorizar?'],
  })
  const differentTranscript = prepareExternalEvalHumanReview({
    report,
    loaded,
    rubric,
    scenarioId: 'universal.core.incomplete-need.001',
    assistantTurns: ['Qual resultado seria mais útil para você agora?'],
  })
  const sensitiveTranscript = prepareExternalEvalHumanReview({
    report,
    loaded,
    rubric,
    scenarioId: 'universal.core.incomplete-need.001',
    assistantTurns: ['Token sk-or-example-sensitive-value'],
  })
  assert.equal(sameTranscript.sample.id, reviewPackage.sample.id)
  assert.notEqual(differentTranscript.sample.id, reviewPackage.sample.id)
  assert.doesNotMatch(sensitiveTranscript.sample.id, /sk-or|sensitive/i)
  assert.doesNotMatch(
    sensitiveTranscript.turns[0]?.assistant ?? '',
    /sk-or-example-sensitive-value/,
  )

  const incompatibleReport = structuredClone(report)
  incompatibleReport.dataset.version = '9.9.9'
  assert.throws(
    () => prepareExternalEvalHumanReview({
      report: incompatibleReport,
      loaded,
      rubric,
      scenarioId: 'universal.core.incomplete-need.001',
      assistantTurns: ['Qual necessidade você deseja priorizar?'],
    }),
    ExternalEvalHumanReviewError,
  )
})

test('contratos existentes permanecem utilizáveis e baselines não são tocados', async () => {
  const loaded = await loadEvalDataset(
    resolveOfflineEvalDataset('universal-core'),
  )
  assert.equal(loaded.data.schemaVersion, 1)
  const report = await runMockExternalEval(validRequest(), {
    createModel: () => mockModel(createMvpDeterministicModel()),
  })
  assert.equal(report.objectiveEvaluation.coverage.scope, 'selected_scenarios')
  assert.equal(report.humanReview.exportPrepared, false)
  assert.equal('baseline' in report, false)
  assert.equal('offline' in report.model, false)
})

test('CLI planeja e bloqueia run sem chamar rede/OpenRouter', async () => {
  const planned = await execFileAsync(
    process.execPath,
    [
      '--import',
      'tsx',
      'src/scripts/eval-live.ts',
      '--action',
      'plan',
      '--dataset',
      'universal-core',
      '--scenario',
      'universal.core.incomplete-need.001',
    ],
    {
      cwd: backendRoot,
      env: {
        ...process.env,
        OPENROUTER_API_KEY: 'sk-or-present-but-not-authorized',
      },
    },
  )
  const plan = JSON.parse(planned.stdout) as { networkAllowed: boolean; status: string }
  assert.equal(plan.networkAllowed, false)
  assert.equal(plan.status, 'blocked')
  assert.doesNotMatch(planned.stdout, /sk-or-present-but-not-authorized/)

  await assert.rejects(
    execFileAsync(
      process.execPath,
      [
        '--import',
        'tsx',
        'src/scripts/eval-live.ts',
        '--action',
        'run',
        '--modality',
        'live_external',
        '--dataset',
        'universal-core',
      ],
      { cwd: backendRoot },
    ),
  )
})

test('execução mock completa mantém zero chamadas reais à rede', async () => {
  const originalFetch = globalThis.fetch
  let calls = 0
  globalThis.fetch = async () => {
    calls += 1
    throw new Error('network forbidden')
  }
  try {
    await runMockExternalEval(
      validRequest({
        datasetId: 'hidrasplash-conversations',
        scenarioIds: ['hidrasplash.conversation.budget-change.001'],
      }),
      { createModel: () => mockModel(createMvpDeterministicModel()) },
    )
    assert.equal(calls, 0)
  } finally {
    globalThis.fetch = originalFetch
  }
})
