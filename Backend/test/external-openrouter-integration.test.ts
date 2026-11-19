import assert from 'node:assert/strict'
import test from 'node:test'

import type {
  AgentFunctionDefinition,
  AgentMessage,
  AgentModelResult,
} from '../src/agent/agent-model-port.js'
import { OPENROUTER_MAX_TIMEOUT_MS } from '../src/agent/openrouter/openrouter-client.js'
import { planExternalEval } from '../src/evals/external-eval-plan.js'
import {
  createInMemoryOpenRouterTransport,
  ExternalEvalExecutionError,
  runLiveExternalEval,
  runSimulatedOpenRouterExternalEval,
} from '../src/evals/external-eval-runner.js'
import {
  externalEvalPlanSchema,
  externalEvalReportSchema,
  type ExternalEvalPlanRequest,
} from '../src/evals/external-eval-schema.js'
import {
  renderExternalEvalReportMarkdown,
  serializeExternalEvalReport,
} from '../src/evals/external-eval-report.js'
import { createMvpDeterministicModel } from './helpers/mvp-deterministic-model.js'

const modelId = 'mock/provider-model'
const providerId = 'mock-provider'

function integrationRequest(
  overrides: Partial<ExternalEvalPlanRequest> = {},
): ExternalEvalPlanRequest {
  return {
    modality: 'mock_external',
    datasetId: 'universal-core',
    scenarioIds: ['universal.core.incomplete-need.001'],
    modelId,
    routing: {
      providerId,
      allowFallbacks: false,
      requireParameters: true,
      dataCollection: 'deny',
      zeroDataRetention: true,
    },
    outputDirectory: './external-eval-reports/test',
    limits: {
      maxModelCalls: 6,
      maxOutputTokensPerCall: 512,
      maxExecutionTokens: 150_000,
      estimatedInputTokensPerCall: 20_000,
      timeoutMs: 2_000,
    },
    pricing: {
      modelId,
      providerId,
      currency: 'USD',
      inputUsdPerMillionTokens: 1,
      outputUsdPerMillionTokens: 2,
      confirmedAt: '2026-11-18T12:00:00.000Z',
      source: 'https://openrouter.ai/models/mock/provider-model',
    },
    maxBudgetUsd: 1,
    unreportedUsageMultiplier: 1.25,
    ...overrides,
  }
}

function toAgentMessages(messages: readonly Record<string, unknown>[]) {
  return messages.map((message): AgentMessage => {
    if (message.role === 'tool') {
      return {
        role: 'tool',
        toolCallId: String(message.tool_call_id),
        content: String(message.content),
      }
    }
    if (message.role === 'assistant') {
      return {
        role: 'assistant',
        content:
          typeof message.content === 'string' ? message.content : null,
        ...(Array.isArray(message.tool_calls)
          ? { toolCalls: message.tool_calls as never[] }
          : {}),
      }
    }
    return {
      role: message.role === 'system' ? 'system' : 'user',
      content: String(message.content),
    }
  })
}

function providerResponse(input: {
  readonly ordinal: number
  readonly result: AgentModelResult
  readonly returnedModelId?: string
  readonly returnedProviderId?: string
  readonly includeProvider?: boolean
  readonly usage?: AgentModelResult['usage'] | null
  readonly generationId?: string
}) {
  const usage = input.usage === undefined ? input.result.usage : input.usage
  return {
    id: input.generationId ?? `generation-${input.ordinal}`,
    model: input.returnedModelId ?? modelId,
    ...(input.includeProvider === false
      ? {}
      : { provider: input.returnedProviderId ?? providerId }),
    created: 1_800_000_000 + input.ordinal,
    choices: [
      {
        index: 0,
        finish_reason: input.result.message.toolCalls ? 'tool_calls' : 'stop',
        message: {
          role: 'assistant',
          content: input.result.message.content,
          ...(input.result.message.toolCalls
            ? { tool_calls: input.result.message.toolCalls }
            : {}),
        },
      },
    ],
    ...(usage === null || usage === undefined
      ? {}
      : {
          usage: {
            prompt_tokens: usage.inputTokens,
            completion_tokens: usage.outputTokens,
            total_tokens: usage.totalTokens,
          },
        }),
  }
}

function deterministicHttpTransport(options: {
  readonly returnedModelId?: string
  readonly returnedProviderId?: string
  readonly includeProvider?: boolean
  readonly usage?: AgentModelResult['usage'] | null
  readonly generationId?: string
} = {}) {
  const delegate = createMvpDeterministicModel()
  const bodies: Array<Record<string, unknown>> = []
  let calls = 0
  const transport = createInMemoryOpenRouterTransport(
    async (_url, init) => {
      calls += 1
      const body = JSON.parse(String(init?.body)) as {
        messages: Array<Record<string, unknown>>
        tools?: AgentFunctionDefinition[]
        max_completion_tokens: number
      } & Record<string, unknown>
      bodies.push(body)
      const result = await delegate.complete({
        messages: toAgentMessages(body.messages),
        tools: body.tools ?? [],
        signal:
          init?.signal instanceof AbortSignal
            ? init.signal
            : new AbortController().signal,
        maxOutputTokens: body.max_completion_tokens,
      })
      return new Response(
        JSON.stringify(
          providerResponse({
            ordinal: calls,
            result,
            ...options,
          }),
        ),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      )
    },
  )
  return { transport, bodies, get calls() { return calls } }
}

test('ponto público live permanece bloqueado com chave e confirmação', async () => {
  const originalKey = process.env.OPENROUTER_API_KEY
  process.env.OPENROUTER_API_KEY = 'sk-or-must-not-be-used'
  try {
    const { plan } = await planExternalEval(
      integrationRequest({
        modality: 'live_external',
        liveAuthorization: {
          enabled: true,
          confirmation: 'I_AUTHORIZE_LIVE_EXTERNAL_EVAL',
        },
      }),
    )
    assert.equal(plan.status, 'blocked')
    assert.equal(plan.networkAllowed, false)
    assert(plan.blockers.some((blocker) => blocker.code === 'LIVE_EXTERNAL_DISABLED'))
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

test('preflight vincula roteamento e preço ao mesmo provedor', async () => {
  const missing = await planExternalEval(
    integrationRequest({
      pricing: {
        ...integrationRequest().pricing!,
        providerId: undefined,
      },
    }),
  )
  assert(missing.plan.blockers.some(
    (blocker) => blocker.code === 'PRICING_PROVIDER_REQUIRED',
  ))
  const mismatch = await planExternalEval(
    integrationRequest({
      pricing: {
        ...integrationRequest().pricing!,
        providerId: 'other-provider',
      },
    }),
  )
  assert(mismatch.plan.blockers.some(
    (blocker) => blocker.code === 'PRICING_PROVIDER_MISMATCH',
  ))
})

test('preflight aceita o timeout máximo do cliente OpenRouter', async () => {
  const request = integrationRequest({
    datasetId: 'hidrasplash-conversations',
    scenarioIds: ['hidrasplash.conversation.budget-change.001'],
  })
  request.limits!.timeoutMs = OPENROUTER_MAX_TIMEOUT_MS
  const { plan } = await planExternalEval(request)
  assert.equal(plan.status, 'ready')
  assert.equal(plan.executionAllowed, true)
  assert.deepEqual(plan.blockers, [])

  const controlled = deterministicHttpTransport()
  const report = await runSimulatedOpenRouterExternalEval(request, {
    transport: controlled.transport,
  })
  assert.equal(report.limits.timeoutMs, OPENROUTER_MAX_TIMEOUT_MS)
  assert.equal(report.execution.technicalFailures, 0)
  assert(controlled.calls > 0)
})

test('preflight bloqueia timeout acima do máximo do OpenRouter antes do transporte', async () => {
  const request = integrationRequest()
  const timeoutMs = OPENROUTER_MAX_TIMEOUT_MS + 1
  request.limits!.timeoutMs = timeoutMs
  const expectedBlocker = {
    code: 'OPENROUTER_TIMEOUT_EXCEEDS_LIMIT',
    detail: `O timeout de ${timeoutMs} ms excede o máximo de ${OPENROUTER_MAX_TIMEOUT_MS} ms do cliente OpenRouter.`,
  }

  for (const modality of ['dry_run', 'mock_external'] as const) {
    const { plan } = await planExternalEval({ ...request, modality })
    const serializedPlan = externalEvalPlanSchema.parse(
      JSON.parse(JSON.stringify(plan)),
    )
    assert.equal(serializedPlan.status, 'blocked')
    assert.equal(serializedPlan.executionAllowed, false)
    assert.equal(serializedPlan.networkAllowed, false)
    assert.deepEqual(serializedPlan.blockers, [expectedBlocker])
  }

  const controlled = deterministicHttpTransport()
  await assert.rejects(
    runSimulatedOpenRouterExternalEval(request, {
      transport: controlled.transport,
    }),
    (error: unknown) =>
      error instanceof ExternalEvalExecutionError && error.code === 'PLAN_BLOCKED',
  )
  assert.equal(controlled.calls, 0)
})

test('integração simulada multi-turno preserva ferramentas, scoring e proveniência', async () => {
  const controlled = deterministicHttpTransport()
  const originalFetch = globalThis.fetch
  let networkCalls = 0
  globalThis.fetch = async () => {
    networkCalls += 1
    throw new Error('real network forbidden')
  }
  try {
    const report = await runSimulatedOpenRouterExternalEval(
      integrationRequest({
        datasetId: 'hidrasplash-conversations',
        scenarioIds: ['hidrasplash.conversation.budget-change.001'],
      }),
      { transport: controlled.transport },
    )
    assert.equal(networkCalls, 0)
    assert.equal(controlled.calls, 4)
    assert.equal(report.provenance, 'simulated_external_transport')
    assert.equal(report.performanceEvidence, 'not_real_model_performance')
    assert.equal(report.execution.technicalFailures, 0)
    assert.equal(report.execution.toolCallsRequested, 2)
    assert.equal(report.execution.toolsExecuted, 2)
    assert.equal(report.objectiveEvaluation.summary.assertions.passed, 8)
    assert.equal(report.objectiveEvaluation.summary.assertions.failed, 0)
    assert.equal(report.humanReview.exportPrepared, false)
    assert.equal(report.model.observations.length, 4)
    assert(report.model.observations.every(
      (observation) => observation.modelIdentityMatches,
    ))
    assert.deepEqual(report.model.providerIds, [providerId])
    assert.deepEqual(controlled.bodies[0]?.provider, {
      order: [providerId],
      only: [providerId],
      allow_fallbacks: false,
      require_parameters: true,
      data_collection: 'deny',
      zdr: true,
    })
    assert(controlled.bodies.every((body) => !('models' in body)))
    const json = serializeExternalEvalReport(report)
    const markdown = renderExternalEvalReportMarkdown(report)
    const serialized = externalEvalReportSchema.parse(JSON.parse(json))
    assert.deepEqual(serialized, report)
    assert.deepEqual(serialized.model.returnedIds, [modelId])
    assert.deepEqual(serialized.model.providerReportedIds, [])
    assert(markdown.includes('- Modelos retornados: mock/provider\\-model'))
    assert(markdown.includes('- Provedores identificados: mock\\-provider'))
    assert(markdown.includes('simulated\\_external\\_transport'))
    assert(markdown.includes(report.executionId.replace('-', '\\-')))
  } finally {
    globalThis.fetch = originalFetch
  }
})

test('modelo divergente interrompe transportes futuros', async () => {
  const controlled = deterministicHttpTransport({
    returnedModelId: 'other/model',
  })
  const report = await runSimulatedOpenRouterExternalEval(
    integrationRequest({
      datasetId: 'hidrasplash-conversations',
      scenarioIds: ['hidrasplash.conversation.budget-change.001'],
    }),
    { transport: controlled.transport },
  )
  assert.equal(controlled.calls, 1)
  assert.equal(report.model.observations.length, 1)
  assert.equal(report.model.observations[0]?.returnedModelId, 'other/model')
  assert.deepEqual(report.model.returnedIds, ['other/model'])
  assert.equal(report.model.observations[0]?.modelIdentityMatches, false)
  assert(report.execution.technicalFailures > 0)
  assert(report.objectiveEvaluation.summary.assertions.notEvaluated > 0)
})

test('provedor não identificado não é fabricado', async () => {
  const controlled = deterministicHttpTransport({ includeProvider: false })
  const report = await runSimulatedOpenRouterExternalEval(
    integrationRequest(),
    { transport: controlled.transport },
  )
  assert.deepEqual(report.model.providerIds, [])
  assert.deepEqual(report.model.returnedIds, [modelId])
  assert(renderExternalEvalReportMarkdown(report).includes(
    '- Provedores identificados: não informado',
  ))
  assert.equal(report.model.observations[0]?.providerId, undefined)
  assert.equal(
    report.model.observations[0]?.providerIdentityMatches,
    undefined,
  )
})

test('usage ausente e inconsistente permanecem incompletos e conservadores', async (t) => {
  for (const item of [
    { name: 'missing', usage: null },
    {
      name: 'inconsistent',
      usage: { inputTokens: 10, outputTokens: 2, totalTokens: 99 },
    },
  ] as const) {
    await t.test(item.name, async () => {
      const controlled = deterministicHttpTransport({ usage: item.usage })
      const report = await runSimulatedOpenRouterExternalEval(
        integrationRequest(),
        { transport: controlled.transport },
      )
      assert.equal(report.consumption.callsWithoutCompleteUsage, 1)
      assert.equal(report.consumption.reportedTotalTokens, 0)
      assert(report.consumption.chargedCostUsd > 0)
      assert.equal(
        report.model.observations[0]?.usageStatus,
        item.name,
      )
    })
  }
})

test('usage acima da reserva registra excedente e bloqueia continuação', async () => {
  const controlled = deterministicHttpTransport({
    usage: {
      inputTokens: 200_000,
      outputTokens: 10_000,
      totalTokens: 210_000,
    },
  })
  const report = await runSimulatedOpenRouterExternalEval(
    integrationRequest({
      datasetId: 'hidrasplash-conversations',
      scenarioIds: ['hidrasplash.conversation.shipping-boundary.001'],
      limits: {
        maxModelCalls: 2,
        maxOutputTokensPerCall: 100,
        maxExecutionTokens: 500_000,
        estimatedInputTokensPerCall: 50_000,
        timeoutMs: 2_000,
      },
      maxBudgetUsd: 1,
      unreportedUsageMultiplier: 1,
    }),
    { transport: controlled.transport },
  )
  assert.equal(controlled.calls, 1)
  assert(report.consumption.overReservedTokens > 0)
  assert(report.consumption.overReservedCostUsd > 0)
  assert(report.execution.limitsReached.includes(
    'reported_usage_exceeded_reservation',
  ))
  assert.equal(report.modelCalls[1]?.status, 'rejected')
  assert.equal(report.modelCalls[1]?.errorCode, 'LOCAL_BUDGET_EXHAUSTED')
})

test('tool call inválida ou desconhecida não é apresentada como executada', async (t) => {
  for (const item of [
    { name: 'invalid-json', toolName: 'search_faq', args: 'not-json' },
    { name: 'unknown', toolName: 'unknown_tool', args: '{}' },
  ]) {
    await t.test(item.name, async () => {
      let calls = 0
      const transport = createInMemoryOpenRouterTransport(async () => {
        calls += 1
        return new Response(JSON.stringify({
          id: `bad-tool-${calls}`,
          model: modelId,
          provider: providerId,
          created: 1,
          choices: [{
            index: 0,
            finish_reason: 'tool_calls',
            message: {
              role: 'assistant',
              content: null,
              tool_calls: [{
                id: 'bad-call',
                type: 'function',
                function: { name: item.toolName, arguments: item.args },
              }],
            },
          }],
          usage: { prompt_tokens: 10, completion_tokens: 2, total_tokens: 12 },
        }), { status: 200 })
      })
      const report = await runSimulatedOpenRouterExternalEval(
        integrationRequest({
          datasetId: 'hidrasplash-conversations',
          scenarioIds: ['hidrasplash.conversation.shipping-boundary.001'],
        }),
        { transport },
      )
      assert.equal(report.execution.toolsExecuted, 0)
      assert(
        report.execution.toolRejections > 0 ||
        report.execution.technicalFailures > 0,
      )
    })
  }
})

test('falha crítica objetiva continua visível na integração simulada', async () => {
  let calls = 0
  const transport = createInMemoryOpenRouterTransport(async () => {
    calls += 1
    const message = calls === 1
      ? {
          role: 'assistant',
          content: null,
          tool_calls: [{
            id: 'faq-missing',
            type: 'function',
            function: {
              name: 'search_faq',
              arguments: JSON.stringify({
                query: 'política completamente inexistente xyz',
                limit: 1,
              }),
            },
          }],
        }
      : {
          role: 'assistant',
          content: 'Não encontrei uma fonte aplicável.',
        }
    return new Response(JSON.stringify({
      id: `critical-${calls}`,
      model: modelId,
      provider: providerId,
      created: 1,
      choices: [{
        index: 0,
        finish_reason: calls === 1 ? 'tool_calls' : 'stop',
        message,
      }],
      usage: { prompt_tokens: 10, completion_tokens: 2, total_tokens: 12 },
    }), { status: 200 })
  })
  const report = await runSimulatedOpenRouterExternalEval(
    integrationRequest({
      datasetId: 'hidrasplash-conversations',
      scenarioIds: ['hidrasplash.conversation.shipping-boundary.001'],
    }),
    { transport },
  )
  assert(report.objectiveEvaluation.summary.assertions.failed > 0)
  assert(report.objectiveEvaluation.summary.criticalFailures > 0)
  assert((report.objectiveEvaluation.summary.objectiveScore?.final ?? 10) <= 3)
})

test('metadados sensíveis são sanitizados em JSON e execução segue simulada', async () => {
  const controlled = deterministicHttpTransport({
    generationId: 'sk-or-secret-generation-value',
  })
  const report = await runSimulatedOpenRouterExternalEval(
    integrationRequest(),
    { transport: controlled.transport },
  )
  const json = serializeExternalEvalReport(report)
  assert.doesNotMatch(json, /sk-or-secret-generation-value/)
  assert.match(json, /simulated_external_transport/)
  assert.match(json, /not_real_model_performance/)
})

test('transporte não registrado não pode alcançar o núcleo simulado', async () => {
  const transport = (async () => {
    throw new Error('must not execute')
  }) as unknown as ReturnType<typeof createInMemoryOpenRouterTransport>
  await assert.rejects(
    runSimulatedOpenRouterExternalEval(
      integrationRequest(),
      { transport },
    ),
    (error: unknown) =>
      error instanceof ExternalEvalExecutionError &&
      error.code === 'LIVE_EXTERNAL_DISABLED',
  )
})
