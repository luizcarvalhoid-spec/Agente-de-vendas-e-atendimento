import assert from 'node:assert/strict'
import test from 'node:test'

import {
  AgentModelError,
  type AgentModelPort,
} from '../src/agent/agent-model-port.js'
import {
  ChatServiceError,
  type ChatService,
} from '../src/agent/chat-service.js'
import type { ChatRequest, ChatResponse } from '../src/contracts/chat.js'
import type {
  EvalCase,
  EvalDataset,
} from '../src/evals/eval-dataset-schema.js'
import {
  loadEvalDataset,
  type LoadedEvalDataset,
} from '../src/evals/eval-loader.js'
import { createOfflineEvalModel } from '../src/evals/offline-eval-model.js'
import {
  OFFLINE_EVAL_DATASETS,
  resolveOfflineEvalDataset,
  runOfflineEval,
  runOfflineEvalDataset,
  type OfflineScenarioRuntimeFactory,
} from '../src/evals/offline-eval-runner.js'
import { OfflineEvalTraceCollector } from '../src/evals/offline-eval-trace.js'

function textResponse(message: string): ChatResponse {
  return {
    type: 'text',
    message,
    sourceIds: [],
    requestId: '00000000-0000-4000-a000-000000000001',
  }
}

function recommendationResponse(
  productId: number,
  message: string,
): ChatResponse {
  return {
    type: 'recommendation',
    message,
    productIds: [productId],
    products: [{}],
    sourceIds: [],
    requestId: '00000000-0000-4000-a000-000000000001',
  } as unknown as ChatResponse
}

function runtimeFactory(
  execute: ChatService['execute'],
): OfflineScenarioRuntimeFactory {
  return () => ({
    chatService: { execute },
    trace: new OfflineEvalTraceCollector(),
  })
}

function loadedWithCases(cases: readonly EvalCase[]): LoadedEvalDataset {
  const data = {
    schemaVersion: 1,
    dataset: {
      id: 'runner-test',
      version: '1.0.0',
      scope: 'universal',
      locale: 'pt-BR',
    },
    cases,
  } as EvalDataset
  return {
    sourcePath: '<runner-test>',
    data,
    cases: cases.map((scenario, index) => ({
      index,
      sourcePath: `<runner-test>#${scenario.id}`,
      scenario,
    })),
  }
}

async function baseScenario() {
  const loaded = await loadEvalDataset(
    resolveOfflineEvalDataset('hidrasplash-conversations'),
  )
  return structuredClone(loaded.data.cases[0] as EvalCase)
}

test('carrega um dataset v1 válido pelo loader aprovado', async () => {
  const loaded = await loadEvalDataset(
    resolveOfflineEvalDataset('universal-core'),
  )
  assert.equal(loaded.data.dataset.id, 'universal-core')
  assert.equal(loaded.cases.length, 2)
})

test('executa cenário de turno único e distingue execução de conformidade', async () => {
  const loaded = await loadEvalDataset(
    resolveOfflineEvalDataset('universal-core'),
  )
  const single = loadedWithCases([loaded.data.cases[0] as EvalCase])
  const result = await runOfflineEvalDataset(single, {
    createScenarioRuntime: runtimeFactory(async () =>
      textResponse('Qual é a sua principal necessidade?'),
    ),
  })

  assert.equal(result.technicalStatus, 'completed')
  assert.equal(result.behavioralEvaluation, 'not_evaluated')
  assert.equal(result.scenarios[0]?.turns[0]?.response?.type, 'text')
})

test('usa o histórico real da resposta em conversa multi-turno', async () => {
  const scenario = await baseScenario()
  const requests: ChatRequest[] = []
  const result = await runOfflineEvalDataset(loadedWithCases([scenario]), {
    createScenarioRuntime: runtimeFactory(async (request) => {
      requests.push(structuredClone(request))
      return textResponse(`resposta-real-${requests.length}`)
    }),
  })

  assert.equal(result.scenarios[0]?.turns.length, 2)
  assert.equal(requests[1]?.history[0]?.content, scenario.input.turns[0]?.message)
  assert.equal(requests[1]?.history[1]?.content, 'resposta-real-1')
})

test('preserva e substitui preferências conforme as operações', async () => {
  const scenario = await baseScenario()
  const firstTurn = scenario.input.turns[0]
  const secondTurn = scenario.input.turns[1]
  assert(firstTurn && secondTurn)
  const custom = {
    ...scenario,
    input: {
      initialState: {
        history: [],
        cart: [],
        preferences: { maxPrice: 60 },
      },
      turns: [
        { ...firstTurn, preferences: { mode: 'preserve' as const } },
        {
          ...secondTurn,
          preferences: {
            mode: 'replace' as const,
            value: { maxPrice: 35 },
          },
        },
      ],
    },
  } as EvalCase
  const requests: ChatRequest[] = []
  await runOfflineEvalDataset(loadedWithCases([custom]), {
    createScenarioRuntime: runtimeFactory(async (request) => {
      requests.push(structuredClone(request))
      return textResponse('ok')
    }),
  })

  assert.equal(requests[0]?.preferences?.maxPrice, 60)
  assert.deepEqual(requests[1]?.preferences, { maxPrice: 35 })
})

test('limpa contexto de recomendação e carrinho sem manter estado oculto', async () => {
  const scenario = await baseScenario()
  const firstTurn = scenario.input.turns[0]
  assert(firstTurn)
  const custom = {
    ...scenario,
    input: {
      initialState: {
        history: [],
        cart: [{ productId: 1, quantity: 2 }],
        preferences: { maxPrice: 50 },
        recommendationContext: { productIds: [13] },
      },
      turns: [
        {
          ...firstTurn,
          preferences: { mode: 'clear' as const },
          cart: { mode: 'clear' as const },
          recommendationContext: { mode: 'clear' as const },
        },
      ],
    },
  } as EvalCase
  let captured: ChatRequest | undefined
  await runOfflineEvalDataset(loadedWithCases([custom]), {
    createScenarioRuntime: runtimeFactory(async (request) => {
      captured = structuredClone(request)
      return textResponse('ok')
    }),
  })

  assert.deepEqual(captured?.cart, [])
  assert.equal(captured?.preferences, undefined)
  assert.equal(captured?.recommendationContext, undefined)
})

test('replace persiste, nova recomendação substitui e clear limpa turnos futuros', async () => {
  const scenario = await baseScenario()
  const firstTurn = scenario.input.turns[0]
  const secondTurn = scenario.input.turns[1]
  assert(firstTurn && secondTurn)
  const custom = {
    ...scenario,
    input: {
      initialState: {
        history: [],
        cart: [{ productId: 1, quantity: 1 }],
        recommendationContext: { productIds: [13] },
      },
      turns: [
        {
          ...firstTurn,
          preferences: { mode: 'preserve' as const },
          cart: {
            mode: 'replace' as const,
            value: [{ productId: 9, quantity: 2 }],
          },
          recommendationContext: {
            mode: 'replace' as const,
            value: { productIds: [9] },
          },
        },
        {
          ...secondTurn,
          preferences: { mode: 'preserve' as const },
          cart: { mode: 'preserve' as const },
          recommendationContext: { mode: 'auto' as const },
        },
        {
          ...secondTurn,
          message: 'Ainda estou avaliando essa opção.',
          preferences: { mode: 'preserve' as const },
          cart: { mode: 'preserve' as const },
          recommendationContext: { mode: 'auto' as const },
        },
        {
          ...secondTurn,
          message: 'Vamos limpar essa referência.',
          preferences: { mode: 'preserve' as const },
          cart: { mode: 'preserve' as const },
          recommendationContext: { mode: 'clear' as const },
        },
        {
          ...secondTurn,
          message: 'Agora continue sem referência anterior.',
          preferences: { mode: 'preserve' as const },
          cart: { mode: 'preserve' as const },
          recommendationContext: { mode: 'auto' as const },
        },
      ],
    },
  } as EvalCase
  const requests: ChatRequest[] = []
  await runOfflineEvalDataset(loadedWithCases([custom]), {
    createScenarioRuntime: runtimeFactory(async (request) => {
      requests.push(structuredClone(request))
      return requests.length === 2
        ? recommendationResponse(7, 'nova recomendação real')
        : textResponse('resposta textual')
    }),
  })

  assert.deepEqual(requests.map((request) => request.recommendationContext), [
    { productIds: [9] },
    { productIds: [9] },
    { productIds: [7] },
    undefined,
    undefined,
  ])
  assert.deepEqual(requests[4]?.cart, [{ productId: 9, quantity: 2 }])
})

test('auto preserva a última recomendação através de resposta textual', async () => {
  const scenario = await baseScenario()
  const firstTurn = scenario.input.turns[0]
  const secondTurn = scenario.input.turns[1]
  assert(firstTurn && secondTurn)
  const custom = {
    ...scenario,
    input: {
      ...scenario.input,
      turns: [
        firstTurn,
        {
          ...secondTurn,
          message: 'E como funciona o frete?',
          recommendationContext: { mode: 'auto' as const },
        },
        {
          ...secondTurn,
          message: 'Quero outra opção no lugar da anterior.',
          recommendationContext: { mode: 'auto' as const },
        },
      ],
    },
  } as EvalCase
  const requests: ChatRequest[] = []
  await runOfflineEvalDataset(loadedWithCases([custom]), {
    createScenarioRuntime: runtimeFactory(async (request) => {
      requests.push(structuredClone(request))
      return requests.length === 1
        ? recommendationResponse(13, 'produto real do turno')
        : textResponse('resposta textual intermediária')
    }),
  })

  assert.deepEqual(requests[1]?.recommendationContext, { productIds: [13] })
  assert.deepEqual(requests[2]?.recommendationContext, { productIds: [13] })
  assert.equal(requests[1]?.history[1]?.content, 'produto real do turno')
  assert.equal(
    requests[2]?.history[3]?.content,
    'resposta textual intermediária',
  )
})

test('isola a instância de runtime entre cenários', async () => {
  const loaded = await loadEvalDataset(
    resolveOfflineEvalDataset('universal-core'),
  )
  const localCallCounts: number[] = []
  let factories = 0
  const factory: OfflineScenarioRuntimeFactory = () => {
    factories += 1
    let calls = 0
    return {
      trace: new OfflineEvalTraceCollector(),
      chatService: {
        async execute() {
          calls += 1
          localCallCounts.push(calls)
          return textResponse('isolado')
        },
      },
    }
  }
  await runOfflineEvalDataset(loaded, { createScenarioRuntime: factory })

  assert.equal(factories, 2)
  assert.deepEqual(localCallCounts, [1, 1])
})

test('registra falha técnica quando o histórico excede o contrato, sem truncar', async () => {
  const scenario = await baseScenario()
  const template = scenario.input.turns[0]
  assert(template)
  const custom = {
    ...scenario,
    input: {
      initialState: { history: [], cart: [] },
      turns: Array.from({ length: 7 }, (_, index) => ({
        ...template,
        message: `turno ${index}`,
        preferences: { mode: 'preserve' as const },
        cart: { mode: 'preserve' as const },
        recommendationContext: { mode: 'auto' as const },
      })),
    },
  } as unknown as EvalCase
  let calls = 0
  const result = await runOfflineEvalDataset(loadedWithCases([custom]), {
    createScenarioRuntime: runtimeFactory(async () => {
      calls += 1
      return textResponse('ok')
    }),
  })

  const turns = result.scenarios[0]?.turns ?? []
  assert.equal(calls, 6)
  assert.equal(turns.length, 7)
  assert.equal(turns[6]?.technicalStatus, 'technical_failure')
  assert.equal(turns[6]?.error?.code, 'INVALID_CHAT_REQUEST')
  assert.equal(turns[6]?.appliedState.historyLength, 12)
})

test('converte falha do modelo em erro técnico sanitizado', async () => {
  const loaded = await loadEvalDataset(
    resolveOfflineEvalDataset('universal-core'),
  )
  const result = await runOfflineEvalDataset(
    loadedWithCases([loaded.data.cases[0] as EvalCase]),
    {
      createScenarioRuntime: runtimeFactory(async () => {
        throw new ChatServiceError('AI_BAD_RESPONSE')
      }),
    },
  )

  const turn = result.scenarios[0]?.turns[0]
  assert.equal(turn?.technicalStatus, 'technical_failure')
  assert.deepEqual(turn?.error, {
    code: 'AI_BAD_RESPONSE',
    message: 'O ChatService encerrou o turno com uma falha controlada.',
  })
})

test('execução canônica offline não chama fetch nem OpenRouter', async () => {
  const originalFetch = globalThis.fetch
  let networkCalls = 0
  globalThis.fetch = (async () => {
    networkCalls += 1
    throw new Error('network forbidden')
  }) as typeof fetch
  try {
    const result = await runOfflineEval('universal-core')
    assert.equal(result.technicalStatus, 'completed')
    assert.equal(networkCalls, 0)
  } finally {
    globalThis.fetch = originalFetch
  }
})

test('redige credenciais e identificadores das evidências', async () => {
  const scenario = await baseScenario()
  const template = scenario.input.turns[0]
  assert(template)
  const secretMessage =
    'Minha chave sk-or-segredo123, email pessoa@example.com, CPF 123.456.789-00 e cartão 4111 1111 1111 1111.'
  const sensitiveIngredient = 'sk-or-ingrediente123 pessoa@example.com'
  const custom = {
    ...scenario,
    input: {
      initialState: { history: [], cart: [] },
      turns: [
        {
          ...template,
          message: secretMessage,
          preferences: {
            mode: 'replace' as const,
            value: { avoidIngredients: [sensitiveIngredient] },
          },
        },
      ],
    },
  } as EvalCase
  let originalRequest: ChatRequest | undefined
  const result = await runOfflineEvalDataset(loadedWithCases([custom]), {
    createScenarioRuntime: runtimeFactory(async (request) => {
      originalRequest = structuredClone(request)
      return textResponse(`eco ${secretMessage} ${sensitiveIngredient}`)
    }),
  })
  assert.deepEqual(originalRequest?.preferences?.avoidIngredients, [
    sensitiveIngredient,
  ])

  const appliedIngredients = result.scenarios[0]?.turns[0]?.appliedState
    .preferences?.avoidIngredients
  assert.deepEqual(appliedIngredients, [
    '[CREDENTIAL_REDACTED] [EMAIL_REDACTED]',
  ])

  const trace = new OfflineEvalTraceCollector()
  trace.recordModelCall([
    {
      id: 'sensitive-tool-call',
      type: 'function',
      function: {
        name: 'search_faq',
        arguments: JSON.stringify({ query: secretMessage, limit: 1 }),
      },
    },
  ])
  trace.recordIngredientResolution(
    [sensitiveIngredient],
    { resolvedIds: [], unresolvedTerms: [sensitiveIngredient] },
  )
  trace.recordProductSearch(
    {
      query: sensitiveIngredient,
      requireInStock: true,
      incompatibleIngredientIds: [sensitiveIngredient],
      limit: 1,
    },
    [],
  )
  const serialized = JSON.stringify({ result, trace: trace.snapshot() })

  assert.doesNotMatch(
    serialized,
    /segredo123|ingrediente123|pessoa@example|123\.456|4111 1111/,
  )
  assert.match(serialized, /CREDENTIAL_REDACTED/)
  assert.match(serialized, /EMAIL_REDACTED/)
})

test('distingue ferramenta solicitada de solicitação não executada', () => {
  const trace = new OfflineEvalTraceCollector()
  trace.recordModelCall([
    {
      id: 'rejected-tool-call',
      type: 'function',
      function: {
        name: 'search_faq',
        arguments: JSON.stringify({ query: 'consulta', limit: 1 }),
      },
    },
  ])
  trace.recordOperationalEvent({
    type: 'orchestrator_tool',
    requestId: '00000000-0000-4000-a000-000000000001',
    ordinal: 1,
    toolName: 'search_faq',
    status: 'invalid_arguments',
    executed: false,
    outcome: 'rejected',
  })
  trace.recordOperationalEvent({
    type: 'orchestrator_termination',
    requestId: '00000000-0000-4000-a000-000000000001',
    status: 'ASSISTANT_RESPONSE',
    modelCalls: 2,
    toolCalls: 1,
    toolErrors: 1,
    inputTokens: 0,
    outputTokens: 0,
    totalTokens: 0,
    usageComplete: true,
    groundingRequirement: 'faq',
    productGrounding: 'not_consulted',
    faqGrounding: 'failed',
  })

  const evidence = trace.snapshot()
  assert.deepEqual(evidence.toolsRequested, ['search_faq'])
  assert.deepEqual(evidence.toolsExecuted, [])
  assert.deepEqual(evidence.toolExecutions, [
    {
      ordinal: 1,
      name: 'search_faq',
      status: 'invalid_arguments',
      executed: false,
      outcome: 'rejected',
    },
  ])
  assert.deepEqual(evidence.termination, {
    status: 'ASSISTANT_RESPONSE',
    toolCalls: 1,
    toolErrors: 1,
  })
})

test('modelo offline rejeita resultado de ferramenta inesperado', async () => {
  const model: AgentModelPort = createOfflineEvalModel(
    new OfflineEvalTraceCollector(),
  )
  await assert.rejects(
    model.complete({
      messages: [
        { role: 'system', content: 'instrução de teste' },
        {
          role: 'tool',
          toolCallId: 'sem-chamada-correspondente',
          content: JSON.stringify({ ok: true, status: 'not_found' }),
        },
      ],
      tools: [
        {
          type: 'function',
          function: {
            name: 'search_products',
            description: 'teste',
            parameters: {},
          },
        },
      ],
      signal: new AbortController().signal,
    }),
    (error: unknown) =>
      error instanceof AgentModelError &&
      error.code === 'INVALID_MODEL_RESPONSE',
  )
})

test('percorre tecnicamente os oito cenários e captura restrição combinada', async () => {
  const executions = await Promise.all(
    Object.keys(OFFLINE_EVAL_DATASETS).map((dataset) =>
      runOfflineEval(dataset),
    ),
  )
  assert.equal(
    executions.reduce(
      (total, execution) => total + execution.scenarios.length,
      0,
    ),
    8,
  )
  assert(executions.every((execution) => execution.technicalStatus === 'completed'))
  assert(
    executions.every(
      (execution) => execution.behavioralEvaluation === 'not_evaluated',
    ),
  )

  const recommendationExecution = executions.find(
    (execution) => execution.dataset.id === 'hidrasplash-recommendations',
  )
  const combined = recommendationExecution?.scenarios.find(
    (scenario) =>
      scenario.scenarioId ===
      'hidrasplash.recommendation.rejection-ingredient.001',
  )
  const evidence = combined?.turns[0]
  assert.deepEqual(evidence?.appliedState.recommendationContext, {
    productIds: [13],
  })
  assert(
    evidence?.trace.ingredientResolutions.some(
      (resolution) =>
        resolution.resolvedIds.includes('cocamidopropil-betaina') &&
        resolution.unresolvedTerms.length === 0,
    ),
  )
  assert(
    evidence?.trace.productSearches.some((search) =>
      search.incompatibleIngredientIds.includes('cocamidopropil-betaina'),
    ),
  )
  assert(evidence?.trace.toolsRequested.includes('search_products'))
  assert(evidence?.trace.toolsExecuted.includes('search_products'))
  assert(
    evidence?.trace.toolExecutions.some(
      (execution) =>
        execution.name === 'search_products' &&
        execution.executed &&
        execution.outcome === 'not_found',
    ),
  )
})
