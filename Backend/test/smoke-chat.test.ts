import assert from 'node:assert/strict'
import { Buffer } from 'node:buffer'
import { randomUUID } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import { ZodError } from 'zod'

import type {
  AgentModelInput,
  AgentModelPort,
  AgentModelResult,
  AgentToolCall,
} from '../src/agent/agent-model-port.js'
import {
  ChatServiceError,
  createChatService,
} from '../src/agent/chat-service.js'
import { createProductSearchIndex } from '../src/agent/tools/product-tools.js'
import { CHAT_MODEL_INPUT_MARGIN_UNITS } from '../src/agent/usage-budget-controller.js'
import { loadCatalogRepository } from '../src/catalog/catalog-repository.js'
import { chatResponseSchema } from '../src/contracts/chat.js'
import { loadFaqDocuments } from '../src/knowledge/faq-content-loader.js'
import { createFaqSearchIndex } from '../src/knowledge/faq-search.js'
import type { ChatOperationalEvent } from '../src/observability/chat-operational-events.js'
import {
  assertSmokeWorstCaseBudget,
  assertSmokeCaseEvidence,
  classifySmokeFailure,
  createSmokeDiagnosticTracker,
  createSmokeCostGuard,
  resolveSmokeExecutionPlan,
  SMOKE_DIAGNOSTIC_STAGES,
  SMOKE_MAX_EXECUTIONS,
  SMOKE_MAX_INPUT_UNITS_PER_CALL,
  SMOKE_MAX_MODEL_CALLS_BY_CASE,
  SMOKE_MAX_MONETARY_CEILING_USD,
  SMOKE_MAX_OUTPUT_TOKENS,
  SMOKE_MAX_PROVIDER_CALLS,
  smokeModelCallLimit,
  SmokeGuardError,
  SmokeSetupError,
} from '../src/scripts/smoke-chat-guards.js'
import { createMvpDeterministicModel } from './helpers/mvp-deterministic-model.js'

function requestBody(content = 'consulta') {
  return JSON.stringify({
    messages: [{ role: 'user', content }],
    max_completion_tokens: SMOKE_MAX_OUTPUT_TOKENS,
  })
}

function request(body = requestBody()): RequestInit {
  return { method: 'POST', body }
}

function createTransportCounter() {
  let calls = 0
  return {
    get calls() {
      return calls
    },
    transport: async () => {
      calls += 1
      return new Response('{}', { status: 200 })
    },
  }
}

function smokeToolCall(
  id: string,
  name: string,
  args: unknown,
): AgentToolCall {
  return {
    id,
    type: 'function',
    function: { name, arguments: JSON.stringify(args) },
  }
}

function smokeModelResponse(
  content: string | null,
  toolCalls?: readonly AgentToolCall[],
): AgentModelResult {
  return {
    message: {
      role: 'assistant',
      content,
      ...(toolCalls ? { toolCalls } : {}),
    },
    usage: { inputTokens: 100, outputTokens: 20, totalTokens: 120 },
  }
}

function createSequentialMixedModel() {
  const inputs: AgentModelInput[] = []
  const steps = [
    smokeModelResponse(null, [
      smokeToolCall('mixed-product', 'search_products', {
        query: 'anticaspa frescor',
        category: 'shampoos',
        subcategory: 'anticaspa',
        scalpTypes: ['oleoso'],
        hairConcerns: ['caspa', 'oleosidade'],
        maxPrice: 50,
        requireInStock: true,
        limit: 5,
      }),
    ]),
    smokeModelResponse(null, [
      smokeToolCall('mixed-faq', 'search_faq', {
        query: 'qual é o prazo de entrega?',
        limit: 3,
      }),
    ]),
    smokeModelResponse('Resposta final fundamentada nos dois domínios.'),
  ]
  const model: AgentModelPort = {
    async complete(input) {
      inputs.push(input)
      const step = steps.shift()
      if (!step) throw new Error('Unexpected model call')
      return step
    },
  }
  return { model, inputs }
}

test('rejects an oversized effective request before transport', async () => {
  const fake = createTransportCounter()
  const guard = createSmokeCostGuard({
    inputPricePerMillion: 1,
    outputPricePerMillion: 1,
    monetaryCeilingUsd: 1,
    maxInputUnitsPerCall: CHAT_MODEL_INPUT_MARGIN_UNITS + 10,
  })
  const transport = guard.wrapTransport(fake.transport)

  await assert.rejects(
    () => transport('https://invalid.example', request(requestBody('x'.repeat(100)))),
    SmokeGuardError,
  )
  assert.equal(fake.calls, 0)
  assert.equal(guard.snapshot().blocked, true)
})

test('refuses the next transport when the remaining monetary ceiling is insufficient', async () => {
  const body = requestBody()
  const estimatedInput =
    Buffer.byteLength(body, 'utf8') + CHAT_MODEL_INPUT_MARGIN_UNITS
  const oneCallMaximum =
    (estimatedInput + SMOKE_MAX_OUTPUT_TOKENS) / 1_000_000
  const fake = createTransportCounter()
  const guard = createSmokeCostGuard({
    inputPricePerMillion: 1,
    outputPricePerMillion: 1,
    monetaryCeilingUsd: oneCallMaximum * 1.5,
  })
  const transport = guard.wrapTransport(fake.transport)

  await transport('https://invalid.example', request(body))
  guard.reconcileUsage({
    inputTokens: estimatedInput,
    outputTokens: SMOKE_MAX_OUTPUT_TOKENS,
    totalTokens: estimatedInput + SMOKE_MAX_OUTPUT_TOKENS,
  })
  await assert.rejects(
    () => transport('https://invalid.example', request(body)),
    SmokeGuardError,
  )
  assert.equal(fake.calls, 1)
})

test('records reported usage above the request estimate without hiding it', async () => {
  const body = requestBody()
  const estimatedInput =
    Buffer.byteLength(body, 'utf8') + CHAT_MODEL_INPUT_MARGIN_UNITS
  const fake = createTransportCounter()
  const guard = createSmokeCostGuard({
    inputPricePerMillion: 1,
    outputPricePerMillion: 1,
    monetaryCeilingUsd: 1,
  })
  await guard.wrapTransport(fake.transport)(
    'https://invalid.example',
    request(body),
  )
  guard.reconcileUsage({
    inputTokens: estimatedInput + 1,
    outputTokens: SMOKE_MAX_OUTPUT_TOKENS,
    totalTokens: estimatedInput + 1 + SMOKE_MAX_OUTPUT_TOKENS,
  })

  assert.equal(guard.snapshot().usageOverEstimate, true)
  assert.doesNotThrow(() => guard.assertHealthy())
})

test('missing usage blocks the smoke and every later transport', async () => {
  const fake = createTransportCounter()
  const guard = createSmokeCostGuard({
    inputPricePerMillion: 1,
    outputPricePerMillion: 1,
    monetaryCeilingUsd: 1,
  })
  const transport = guard.wrapTransport(fake.transport)
  await transport('https://invalid.example', request())

  assert.throws(
    () => guard.reconcileUsage(undefined),
    (error: unknown) =>
      error instanceof SmokeGuardError && error.code === 'USAGE_REPORTING',
  )
  await assert.rejects(
    () => transport('https://invalid.example', request()),
    (error: unknown) =>
      error instanceof SmokeGuardError && error.code === 'USAGE_REPORTING',
  )
  assert.equal(fake.calls, 1)
})

test('enforces the 2/2/3 scenario limits, seven transports and 512 output tokens', async () => {
  assert.equal(SMOKE_MAX_EXECUTIONS, 3)
  assert.deepEqual(SMOKE_MAX_MODEL_CALLS_BY_CASE, {
    product: 2,
    faq: 2,
    mixed: 3,
  })
  assert.equal(Math.max(...Object.values(SMOKE_MAX_MODEL_CALLS_BY_CASE)), 3)
  assert.equal(SMOKE_MAX_PROVIDER_CALLS, 7)
  assert.equal(SMOKE_MAX_OUTPUT_TOKENS, 512)
  const fake = createTransportCounter()
  const guard = createSmokeCostGuard({
    inputPricePerMillion: 1,
    outputPricePerMillion: 1,
    monetaryCeilingUsd: 1,
  })
  const transport = guard.wrapTransport(fake.transport)
  for (let index = 0; index < 7; index += 1) {
    await transport('https://invalid.example', request())
    guard.reconcileUsage({ inputTokens: 0, outputTokens: 0, totalTokens: 0 })
  }
  await assert.rejects(
    () => transport('https://invalid.example', request()),
    (error: unknown) =>
      error instanceof SmokeGuardError && error.code === 'PROVIDER_CALL_LIMIT',
  )
  assert.equal(fake.calls, 7)

  const wrongOutputFake = createTransportCounter()
  const wrongOutputGuard = createSmokeCostGuard({
    inputPricePerMillion: 1,
    outputPricePerMillion: 1,
    monetaryCeilingUsd: 1,
  })
  await assert.rejects(
    () =>
      wrongOutputGuard.wrapTransport(wrongOutputFake.transport)(
        'https://invalid.example',
        request(
          JSON.stringify({
            messages: [],
            max_completion_tokens: SMOKE_MAX_OUTPUT_TOKENS + 1,
          }),
        ),
      ),
    SmokeGuardError,
  )
  assert.equal(wrongOutputFake.calls, 0)
})

test('worst-case seven-call reservation fits the 0.30 USD ceiling at the reviewed rates', () => {
  const worstCaseReservedCostUsd = assertSmokeWorstCaseBudget({
    inputPricePerMillion: 0.4,
    outputPricePerMillion: 1.6,
    monetaryCeilingUsd: SMOKE_MAX_MONETARY_CEILING_USD,
  })

  assert.equal(SMOKE_MAX_INPUT_UNITS_PER_CALL, 102_048)
  assert.equal(worstCaseReservedCostUsd, 0.2914688)
  assert.ok(worstCaseReservedCostUsd <= SMOKE_MAX_MONETARY_CEILING_USD)
})

test('scenario allowlist preserves the full plan and selects only mixed on demand', () => {
  assert.deepEqual(resolveSmokeExecutionPlan(undefined), {
    selection: 'all',
    cases: ['product', 'faq', 'mixed'],
    maxProviderCalls: 7,
  })
  assert.deepEqual(resolveSmokeExecutionPlan('mixed'), {
    selection: 'mixed',
    cases: ['mixed'],
    maxProviderCalls: 3,
  })
  assert.equal(smokeModelCallLimit('product'), 2)
  assert.equal(smokeModelCallLimit('faq'), 2)
  assert.equal(smokeModelCallLimit('mixed'), 3)
  assert.throws(
    () => resolveSmokeExecutionPlan('mixed,product'),
    (error: unknown) =>
      error instanceof SmokeSetupError &&
      error.code === 'SCENARIO_CONFIGURATION',
  )
})

test('mixed-only plan reserves and permits exactly three transports', async () => {
  const plan = resolveSmokeExecutionPlan('mixed')
  const worstCaseReservedCostUsd = assertSmokeWorstCaseBudget({
    inputPricePerMillion: 0.4,
    outputPricePerMillion: 1.6,
    monetaryCeilingUsd: SMOKE_MAX_MONETARY_CEILING_USD,
    maxProviderCalls: plan.maxProviderCalls,
  })
  assert.equal(worstCaseReservedCostUsd, 0.1249152)

  const fake = createTransportCounter()
  const guard = createSmokeCostGuard({
    inputPricePerMillion: 1,
    outputPricePerMillion: 1,
    monetaryCeilingUsd: 1,
    maxProviderCalls: plan.maxProviderCalls,
  })
  const transport = guard.wrapTransport(fake.transport)
  for (let index = 0; index < plan.maxProviderCalls; index += 1) {
    await transport('https://invalid.example', request())
    guard.reconcileUsage({ inputTokens: 0, outputTokens: 0, totalTokens: 0 })
  }
  await assert.rejects(
    () => transport('https://invalid.example', request()),
    (error: unknown) =>
      error instanceof SmokeGuardError &&
      error.code === 'PROVIDER_CALL_LIMIT',
  )
  assert.equal(fake.calls, 3)
})

test('unsafe selected plan is rejected before any transport starts', () => {
  const fake = createTransportCounter()
  const plan = resolveSmokeExecutionPlan('mixed')

  assert.throws(
    () =>
      assertSmokeWorstCaseBudget({
        inputPricePerMillion: 0.4,
        outputPricePerMillion: 200,
        monetaryCeilingUsd: SMOKE_MAX_MONETARY_CEILING_USD,
        maxProviderCalls: plan.maxProviderCalls,
      }),
    (error: unknown) =>
      error instanceof SmokeGuardError && error.code === 'MONETARY_BUDGET',
  )
  assert.equal(fake.calls, 0)
})

test('worst-case preflight rejects an unsafe price or a ceiling above 0.30 USD', () => {
  assert.throws(
    () =>
      assertSmokeWorstCaseBudget({
        inputPricePerMillion: 0.4,
        outputPricePerMillion: 100,
        monetaryCeilingUsd: SMOKE_MAX_MONETARY_CEILING_USD,
      }),
    (error: unknown) =>
      error instanceof SmokeGuardError && error.code === 'MONETARY_BUDGET',
  )
  assert.throws(
    () =>
      assertSmokeWorstCaseBudget({
        inputPricePerMillion: 0.01,
        outputPricePerMillion: 0.01,
        monetaryCeilingUsd: SMOKE_MAX_MONETARY_CEILING_USD + 0.01,
      }),
    (error: unknown) =>
      error instanceof SmokeGuardError && error.code === 'MONETARY_BUDGET',
  )
})

test('sanitized diagnostics classify setup, guard and provider failures without messages', () => {
  const secret = 'OPENROUTER_API_KEY=must-not-leak C:\\private\\payload.json'
  const cases = [
    [new SmokeSetupError('CONFIRMATION_REQUIRED'), 'CONFIRMATION_REQUIRED'],
    [new SmokeGuardError('USAGE_REPORTING'), 'USAGE_REPORTING'],
    [Object.assign(new Error(secret), { code: 'AI_UNAVAILABLE' }), 'MODEL_UNAVAILABLE'],
    [Object.assign(new Error(secret), { code: 'AI_BAD_RESPONSE' }), 'MODEL_INVALID_RESPONSE'],
    [Object.assign(new Error(secret), { code: 'AI_TIMEOUT' }), 'MODEL_TIMEOUT'],
    [Object.assign(new Error(secret), { code: 'REQUEST_CANCELLED' }), 'MODEL_CANCELLED'],
    [
      Object.assign(new Error(secret), { code: 'AI_UNAVAILABLE' }),
      'MODEL_AUTHENTICATION_FAILED',
      'MODEL_AUTHENTICATION_FAILED',
    ],
    [
      Object.assign(new Error(secret), { code: 'AI_UNAVAILABLE' }),
      'MODEL_RATE_LIMITED',
      'MODEL_RATE_LIMITED',
    ],
    [new Error(secret), 'UNEXPECTED_FAILURE'],
  ] as const

  for (const [error, expected, terminationStatus] of cases) {
    const category = classifySmokeFailure(error, terminationStatus)
    assert.equal(category, expected)
    assert.doesNotMatch(category, /OPENROUTER|private|payload|must-not-leak/i)
  }
})

test('stage diagnostics locate offline failures without exposing their raw errors', async (t) => {
  const secret =
    'OPENROUTER_API_KEY=must-not-leak C:\\private\\catalog.json prompt completo'
  const cases = [
    ['configuration', 'BACKEND_CONFIGURATION'],
    ['budget_preflight', 'GUARD_CONFIGURATION'],
    ['catalog_loading', 'CATALOG_LOADING_FAILED'],
    ['faq_loading', 'FAQ_LOADING_FAILED'],
    ['service_initialization', 'SERVICE_INITIALIZATION_FAILED'],
    ['scenario_execution', 'SCENARIO_EXECUTION_FAILED'],
    ['usage_reconciliation', 'USAGE_REPORTING'],
    ['grounding_validation', 'GROUNDING_EVIDENCE'],
    ['local_budget_check', 'LOCAL_BUDGET_CHECK_FAILED'],
  ] as const

  assert.deepEqual(SMOKE_DIAGNOSTIC_STAGES, [
    'configuration',
    'budget_preflight',
    'catalog_loading',
    'faq_loading',
    'service_initialization',
    'scenario_execution',
    'usage_reconciliation',
    'grounding_validation',
    'local_budget_check',
    'completed',
  ])

  for (const [stage, expectedCategory] of cases) {
    await t.test(stage, () => {
      const tracker = createSmokeDiagnosticTracker()
      const scenarioOrdinal =
        stage === 'scenario_execution' ||
        stage === 'usage_reconciliation' ||
        stage === 'grounding_validation'
          ? 1
          : undefined
      tracker.enter(stage, scenarioOrdinal)

      const fakeAction = () => {
        throw new Error(secret)
      }
      let failure: unknown
      try {
        fakeAction()
      } catch (error) {
        failure = error
      }
      const diagnostic = tracker.failure(failure, 0)
      assert.equal(diagnostic.stage, stage)
      assert.equal(diagnostic.category, expectedCategory)
      assert.equal(diagnostic.transportsStarted, 0)
      assert.equal(diagnostic.completedScenarios, 0)
      assert.equal(diagnostic.scenarioOrdinal, scenarioOrdinal)
      assert.doesNotMatch(
        JSON.stringify(diagnostic),
        /OPENROUTER_API_KEY|must-not-leak|private|catalog\.json|prompt completo/i,
      )
    })
  }
})

test('diagnostics preserve safe progress and only allow known termination statuses', () => {
  const tracker = createSmokeDiagnosticTracker()
  tracker.enter('scenario_execution', 1)
  tracker.recordTermination('ASSISTANT_RESPONSE')
  tracker.completeScenario()
  tracker.enter('scenario_execution', 2)
  tracker.recordTermination('MODEL_RATE_LIMITED')
  tracker.recordTermination('secret-provider-status')

  const diagnostic = tracker.failure(
    new Error('credential and response body must not leak'),
    2,
  )
  assert.deepEqual(diagnostic, {
    stage: 'scenario_execution',
    category: 'MODEL_RATE_LIMITED',
    transportsStarted: 2,
    completedScenarios: 1,
    scenarioOrdinal: 2,
    lastTerminationStatus: 'MODEL_RATE_LIMITED',
  })
  assert.doesNotMatch(
    JSON.stringify(diagnostic),
    /credential|response body|secret-provider-status/i,
  )
})

test('smoke generates UUID request IDs for scenarios and the local budget check', async () => {
  const source = await readFile(
    new URL('../src/scripts/smoke-chat.ts', import.meta.url),
    'utf8',
  )
  const requestIdInitializers = source.match(/requestId: randomUUID\(\)/g) ?? []

  assert.equal(requestIdInitializers.length, 2)
  assert.doesNotMatch(source, /requestId:\s*['`]manual-smoke/)
  assert.match(source, /HIDRASPLASH_SMOKE_SCENARIO/)
  assert.equal(
    source.match(/maxProviderCalls: executionPlan\.maxProviderCalls/g)?.length,
    2,
  )
  assert.match(source, /maxModelCalls: smokeModelCallLimit\(kind\)/)

  for (const requestId of [randomUUID(), randomUUID()]) {
    assert.doesNotThrow(() =>
      chatResponseSchema.parse({
        type: 'text',
        message: 'Resposta demonstrativa.',
        sourceIds: [],
        requestId,
      }),
    )
  }
})

test('completed deterministic smoke response rejects the old ID and accepts a generated UUID', async () => {
  const [catalog, faqDocuments] = await Promise.all([
    loadCatalogRepository(),
    loadFaqDocuments(),
  ])
  const service = createChatService({
    catalog,
    productIndex: createProductSearchIndex(catalog.listAll()),
    faqIndex: createFaqSearchIndex(faqDocuments),
    faqDocuments,
    model: createMvpDeterministicModel(),
    maxModelCalls: smokeModelCallLimit('product'),
    maxOutputTokens: SMOKE_MAX_OUTPUT_TOKENS,
  })
  const input = {
    message:
      'Quero um shampoo anticaspa para couro cabeludo oleoso, com sensação refrescante, até R$ 50.',
    history: [],
    cart: [],
  }

  async function execute(requestId: string) {
    const terminations: ChatOperationalEvent[] = []
    const operation = service.execute(input, {
      requestId,
      signal: new AbortController().signal,
      observer: {
        record(event) {
          if (event.type === 'orchestrator_termination') {
            terminations.push(event)
          }
        },
      },
    })
    return { operation, terminations }
  }

  const legacy = await execute('manual-smoke-1')
  await assert.rejects(
    legacy.operation,
    (error: unknown) =>
      error instanceof ZodError &&
      error.issues.some((issue) => issue.path.join('.') === 'requestId'),
  )
  const legacyTermination = legacy.terminations.at(-1)
  assert.equal(legacyTermination?.type, 'orchestrator_termination')
  assert.ok(legacyTermination?.type === 'orchestrator_termination')
  assert.equal(legacyTermination.status, 'ASSISTANT_RESPONSE')
  assert.equal(legacyTermination.modelCalls, 2)

  const requestId = randomUUID()
  const current = await execute(requestId)
  const response = chatResponseSchema.parse(await current.operation)
  const currentTermination = current.terminations.at(-1)
  assert.equal(currentTermination?.type, 'orchestrator_termination')
  assert.ok(currentTermination?.type === 'orchestrator_termination')
  assert.equal(currentTermination.status, 'ASSISTANT_RESPONSE')
  assert.equal(currentTermination.modelCalls, 2)
  assert.equal(response.requestId, requestId)
  assert.equal(response.type, 'recommendation')
  assert.deepEqual(response.productIds, [13])
})

test('sequential mixed grounding needs three model calls and returns both domains', async () => {
  const [catalog, faqDocuments] = await Promise.all([
    loadCatalogRepository(),
    loadFaqDocuments(),
  ])
  const productIndex = createProductSearchIndex(catalog.listAll())
  const faqIndex = createFaqSearchIndex(faqDocuments)
  const input = {
    message:
      'Quero um shampoo anticaspa para couro oleoso, com frescor, até R$ 50, e qual é o prazo de entrega?',
    history: [],
    cart: [],
  }

  function execute(maxModelCalls: number) {
    const { model, inputs } = createSequentialMixedModel()
    const events: ChatOperationalEvent[] = []
    const service = createChatService({
      catalog,
      productIndex,
      faqIndex,
      faqDocuments,
      model,
      maxModelCalls,
      maxOutputTokens: SMOKE_MAX_OUTPUT_TOKENS,
    })
    const operation = service.execute(input, {
      requestId: randomUUID(),
      signal: new AbortController().signal,
      observer: { record: (event) => events.push(event) },
    })
    return { events, inputs, operation }
  }

  const limited = execute(2)
  await assert.rejects(
    limited.operation,
    (error: unknown) =>
      error instanceof ChatServiceError && error.code === 'AI_BAD_RESPONSE',
  )
  const limitedTermination = [...limited.events].reverse().find(
    (event) => event.type === 'orchestrator_termination',
  )
  assert.ok(limitedTermination?.type === 'orchestrator_termination')
  assert.equal(limitedTermination.status, 'MODEL_LIMIT')
  assert.equal(limitedTermination.modelCalls, 2)
  assert.equal(limitedTermination.groundingRequirement, 'both')
  assert.equal(limitedTermination.productGrounding, 'found')
  assert.equal(limitedTermination.faqGrounding, 'found')
  assert.equal(limited.inputs.length, 2)

  const completed = execute(3)
  const response = chatResponseSchema.parse(await completed.operation)
  const completedTermination = [...completed.events].reverse().find(
    (event) => event.type === 'orchestrator_termination',
  )
  assert.ok(completedTermination?.type === 'orchestrator_termination')
  assert.equal(completedTermination.status, 'ASSISTANT_RESPONSE')
  assert.equal(completedTermination.modelCalls, 3)
  assert.equal(completedTermination.groundingRequirement, 'both')
  assert.equal(completedTermination.productGrounding, 'found')
  assert.equal(completedTermination.faqGrounding, 'found')
  assert.equal(completed.inputs.length, 3)
  assert.equal(response.type, 'recommendation')
  assert.deepEqual(response.productIds, [13])
  assert.ok(response.sourceIds.length > 0)
  assert.doesNotThrow(() =>
    assertSmokeCaseEvidence({
      kind: 'mixed',
      response,
      termination: {
        status: completedTermination.status,
        groundingRequirement: completedTermination.groundingRequirement,
        productGrounding: completedTermination.productGrounding,
        faqGrounding: completedTermination.faqGrounding,
      },
    }),
  )
})

test('requires domain-specific evidence before declaring smoke scenarios successful', () => {
  assert.doesNotThrow(() =>
    assertSmokeCaseEvidence({
      kind: 'product',
      response: { type: 'recommendation', productIds: [13], sourceIds: [] },
      termination: {
        status: 'ASSISTANT_RESPONSE',
        groundingRequirement: 'product',
        productGrounding: 'found',
        faqGrounding: 'not_consulted',
      },
    }),
  )
  assert.doesNotThrow(() =>
    assertSmokeCaseEvidence({
      kind: 'faq',
      response: { type: 'answer', sourceIds: ['faq-shipping'] },
      termination: {
        status: 'ASSISTANT_RESPONSE',
        groundingRequirement: 'faq',
        productGrounding: 'not_consulted',
        faqGrounding: 'found',
      },
    }),
  )
  assert.doesNotThrow(() =>
    assertSmokeCaseEvidence({
      kind: 'mixed',
      response: {
        type: 'recommendation',
        productIds: [13],
        sourceIds: ['faq-shipping'],
      },
      termination: {
        status: 'ASSISTANT_RESPONSE',
        groundingRequirement: 'both',
        productGrounding: 'found',
        faqGrounding: 'found',
      },
    }),
  )

  assert.throws(
    () =>
      assertSmokeCaseEvidence({
        kind: 'product',
        response: { type: 'answer', sourceIds: [] },
        termination: {
          status: 'ASSISTANT_RESPONSE',
          groundingRequirement: 'product',
          productGrounding: 'not_found',
          faqGrounding: 'not_consulted',
        },
      }),
    SmokeGuardError,
  )
  assert.throws(
    () =>
      assertSmokeCaseEvidence({
        kind: 'faq',
        response: { type: 'answer', sourceIds: [] },
        termination: {
          status: 'ASSISTANT_RESPONSE',
          groundingRequirement: 'faq',
          productGrounding: 'not_consulted',
          faqGrounding: 'found',
        },
      }),
    SmokeGuardError,
  )
  assert.throws(
    () =>
      assertSmokeCaseEvidence({
        kind: 'mixed',
        response: { type: 'recommendation', productIds: [13], sourceIds: [] },
        termination: {
          status: 'ASSISTANT_RESPONSE',
          groundingRequirement: 'both',
          productGrounding: 'found',
          faqGrounding: 'not_found',
        },
      }),
    SmokeGuardError,
  )
})
