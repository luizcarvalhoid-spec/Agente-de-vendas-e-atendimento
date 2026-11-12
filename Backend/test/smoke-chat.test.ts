import assert from 'node:assert/strict'
import { Buffer } from 'node:buffer'
import test from 'node:test'

import { CHAT_MODEL_INPUT_MARGIN_UNITS } from '../src/agent/usage-budget-controller.js'
import {
  assertSmokeWorstCaseBudget,
  assertSmokeCaseEvidence,
  classifySmokeFailure,
  createSmokeDiagnosticTracker,
  createSmokeCostGuard,
  SMOKE_DIAGNOSTIC_STAGES,
  SMOKE_MAX_EXECUTIONS,
  SMOKE_MAX_INPUT_UNITS_PER_CALL,
  SMOKE_MAX_MODEL_CALLS_PER_EXECUTION,
  SMOKE_MAX_MONETARY_CEILING_USD,
  SMOKE_MAX_OUTPUT_TOKENS,
  SMOKE_MAX_PROVIDER_CALLS,
  SmokeGuardError,
  SmokeSetupError,
} from '../src/scripts/smoke-chat-guards.js'

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

test('enforces three executions, two calls each, six transports and 512 output tokens', async () => {
  assert.equal(SMOKE_MAX_EXECUTIONS, 3)
  assert.equal(SMOKE_MAX_MODEL_CALLS_PER_EXECUTION, 2)
  assert.equal(SMOKE_MAX_PROVIDER_CALLS, 6)
  assert.equal(SMOKE_MAX_OUTPUT_TOKENS, 512)
  const fake = createTransportCounter()
  const guard = createSmokeCostGuard({
    inputPricePerMillion: 1,
    outputPricePerMillion: 1,
    monetaryCeilingUsd: 1,
  })
  const transport = guard.wrapTransport(fake.transport)
  for (let index = 0; index < 6; index += 1) {
    await transport('https://invalid.example', request())
    guard.reconcileUsage({ inputTokens: 0, outputTokens: 0, totalTokens: 0 })
  }
  await assert.rejects(
    () => transport('https://invalid.example', request()),
    (error: unknown) =>
      error instanceof SmokeGuardError && error.code === 'PROVIDER_CALL_LIMIT',
  )
  assert.equal(fake.calls, 6)

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

test('worst-case six-call reservation fits the 0.30 USD ceiling at the reviewed rates', () => {
  const worstCaseReservedCostUsd = assertSmokeWorstCaseBudget({
    inputPricePerMillion: 0.4,
    outputPricePerMillion: 1.6,
    monetaryCeilingUsd: SMOKE_MAX_MONETARY_CEILING_USD,
  })

  assert.equal(SMOKE_MAX_INPUT_UNITS_PER_CALL, 102_048)
  assert.equal(worstCaseReservedCostUsd, 0.2498304)
  assert.ok(worstCaseReservedCostUsd <= SMOKE_MAX_MONETARY_CEILING_USD)
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
