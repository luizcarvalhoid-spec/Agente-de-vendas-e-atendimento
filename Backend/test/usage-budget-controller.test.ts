import assert from 'node:assert/strict'
import test from 'node:test'

import {
  AgentModelError,
  type AgentModelPort,
  type AgentModelResult,
} from '../src/agent/agent-model-port.js'
import {
  createBudgetedAgentModel,
  createUsageBudgetController,
} from '../src/agent/usage-budget-controller.js'

const modelInput = {
  messages: [{ role: 'user' as const, content: 'Olá' }],
  tools: [],
  signal: new AbortController().signal,
  maxOutputTokens: 10,
}

test('denied reservation prevents the model transport', async () => {
  let calls = 0
  const model: AgentModelPort = {
    async complete() {
      calls += 1
      return { message: { role: 'assistant', content: 'não executar' } }
    },
  }
  const controller = createUsageBudgetController({
    executionBudgetUnits: 1_000,
    windowBudgetUnits: 10_000,
  })
  const budgeted = createBudgetedAgentModel({
    model,
    budget: controller.createExecution(),
  })
  await assert.rejects(
    () => budgeted.complete(modelInput),
    (error: unknown) =>
      error instanceof AgentModelError &&
      error.code === 'LOCAL_BUDGET_EXHAUSTED' &&
      error.transportStarted === false,
  )
  assert.equal(calls, 0)
})

test('two executions cannot reserve the same final window capacity', () => {
  const controller = createUsageBudgetController({
    executionBudgetUnits: 10_000,
    windowBudgetUnits: 3_000,
  })
  const first = controller.createExecution().reserve({
    estimatedInputTokens: 2_000,
    maxOutputTokens: 500,
  })
  const second = controller.createExecution().reserve({
    estimatedInputTokens: 500,
    maxOutputTokens: 500,
  })
  assert.equal(first.reserved, true)
  assert.equal(second.reserved, false)
  if (!second.reserved) assert.equal(second.reason, 'window_budget')
})

test('reservation reconciliation is idempotent and never becomes negative', () => {
  const controller = createUsageBudgetController({
    executionBudgetUnits: 10_000,
    windowBudgetUnits: 10_000,
  })
  const result = controller.createExecution().reserve({
    estimatedInputTokens: 100,
    maxOutputTokens: 20,
  })
  assert.equal(result.reserved, true)
  if (!result.reserved) return
  const first = result.reservation.reconcile({ kind: 'not_sent' })
  const second = result.reservation.reconcile({ kind: 'possibly_sent' })
  assert.deepEqual(second, first)
  assert.equal(first.chargedUnits, 0)
  assert.equal(first.usageComplete, true)
})

test('reported, missing and excessive usage are reconciled distinctly', () => {
  const controller = createUsageBudgetController({
    executionBudgetUnits: 10_000,
    windowBudgetUnits: 20_000,
  })

  const reported = controller.createExecution().reserve({
    estimatedInputTokens: 100,
    maxOutputTokens: 20,
  })
  assert.equal(reported.reserved, true)
  if (reported.reserved) {
    const reconciliation = reported.reservation.reconcile({
      kind: 'reported',
      usage: { inputTokens: 40, outputTokens: 10, totalTokens: 50 },
    })
    assert.equal(reconciliation.chargedUnits, 50)
    assert.equal(reconciliation.usageComplete, true)
  }

  const missing = controller.createExecution().reserve({
    estimatedInputTokens: 100,
    maxOutputTokens: 20,
  })
  assert.equal(missing.reserved, true)
  if (missing.reserved) {
    const reconciliation = missing.reservation.reconcile({
      kind: 'sent_without_usage',
    })
    assert.equal(reconciliation.chargedUnits, 120)
    assert.equal(reconciliation.usageComplete, false)
  }

  const excessive = controller.createExecution().reserve({
    estimatedInputTokens: 100,
    maxOutputTokens: 20,
  })
  assert.equal(excessive.reserved, true)
  if (excessive.reserved) {
    const reconciliation = excessive.reservation.reconcile({
      kind: 'reported',
      usage: { inputTokens: 150, outputTokens: 50, totalTokens: 200 },
    })
    assert.equal(reconciliation.overReservationUnits, 80)
    assert.equal(reconciliation.chargedUnits, 200)
  }
})

test('pre-transport failure is free while timeout and cancellation are conservative', async () => {
  const cases = [
    {
      error: new AgentModelError('CONFIGURATION_INVALID', false),
      expectedCharge: 0,
      expectedOutcome: 'not_sent',
    },
    {
      error: new AgentModelError('MODEL_TIMEOUT', true),
      expectedCharge: 'reserved',
      expectedOutcome: 'timeout',
    },
    {
      error: new AgentModelError('MODEL_CANCELLED', true),
      expectedCharge: 'reserved',
      expectedOutcome: 'cancelled',
    },
  ] as const

  for (const item of cases) {
    const events: { chargedUnits: number; reservedUnits: number; outcome: string }[] = []
    const budgeted = createBudgetedAgentModel({
      model: {
        async complete() {
          throw item.error
        },
      },
      budget: createUsageBudgetController({
        executionBudgetUnits: 10_000,
        windowBudgetUnits: 10_000,
      }).createExecution(),
      onUsage(event) {
        events.push(event)
      },
    })
    await assert.rejects(() => budgeted.complete(modelInput), item.error)
    assert.equal(events.length, 1)
    assert.equal(events[0]?.outcome, item.expectedOutcome)
    assert.equal(
      events[0]?.chargedUnits,
      item.expectedCharge === 'reserved'
        ? events[0]?.reservedUnits
        : item.expectedCharge,
    )
  }
})

test('configured maximum output is forwarded to the underlying model', async () => {
  let observed: number | undefined
  const budgeted = createBudgetedAgentModel({
    model: {
      async complete(input) {
        observed = input.maxOutputTokens
        return {
          message: { role: 'assistant', content: 'ok' },
          usage: { inputTokens: 5, outputTokens: 2, totalTokens: 7 },
        }
      },
    },
    budget: createUsageBudgetController().createExecution(),
  })
  await budgeted.complete({ ...modelInput, maxOutputTokens: 128 })
  assert.equal(observed, 128)
})

test('cancellation reconciles a non-cooperative model exactly once', async () => {
  let completeLate: ((result: AgentModelResult) => void) | undefined
  const pending = new Promise<AgentModelResult>((resolve) => {
    completeLate = resolve
  })
  const events: {
    chargedUnits: number
    reservedUnits: number
    outcome: string
  }[] = []
  const controller = createUsageBudgetController({
    executionBudgetUnits: 20_000,
    windowBudgetUnits: 20_000,
    maxLedgerEntries: 1,
  })
  const budgeted = createBudgetedAgentModel({
    model: { complete: () => pending },
    budget: controller.createExecution(),
    onUsage(event) {
      events.push(event)
    },
  })
  const abortController = new AbortController()
  const call = budgeted.complete({
    ...modelInput,
    signal: abortController.signal,
  })

  abortController.abort(new AgentModelError('MODEL_CANCELLED', true))
  await assert.rejects(
    call,
    (error: unknown) =>
      error instanceof AgentModelError && error.code === 'MODEL_CANCELLED',
  )
  assert.equal(events.length, 1)
  assert.equal(events[0]?.outcome, 'cancelled')
  assert.equal(events[0]?.chargedUnits, events[0]?.reservedUnits)
  const laterReservation = controller.createExecution().reserve({
    estimatedInputTokens: 1,
    maxOutputTokens: 1,
  })
  assert.equal(laterReservation.reserved, false)
  if (!laterReservation.reserved) {
    assert.equal(laterReservation.reason, 'ledger_capacity')
  }

  completeLate?.({
    message: { role: 'assistant', content: 'resultado tardio' },
    usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
  })
  await new Promise<void>((resolve) => setImmediate(resolve))
  assert.equal(events.length, 1)
  assert.equal(events[0]?.chargedUnits, events[0]?.reservedUnits)
})

test('window capacity becomes available only after committed usage expires', () => {
  let now = 0
  const controller = createUsageBudgetController({
    executionBudgetUnits: 1_000,
    windowBudgetUnits: 120,
    windowMs: 1_000,
    now: () => now,
  })
  const first = controller.createExecution().reserve({
    estimatedInputTokens: 100,
    maxOutputTokens: 20,
  })
  assert.equal(first.reserved, true)
  if (!first.reserved) return
  first.reservation.reconcile({ kind: 'sent_without_usage' })

  const blocked = controller.createExecution().reserve({
    estimatedInputTokens: 1,
    maxOutputTokens: 1,
  })
  assert.equal(blocked.reserved, false)
  if (!blocked.reserved) {
    assert.equal(blocked.reason, 'window_budget')
    assert.equal(blocked.retryAfterSeconds, 1)
  }

  now = 1_001
  assert.equal(
    controller.createExecution().reserve({
      estimatedInputTokens: 100,
      maxOutputTokens: 20,
    }).reserved,
    true,
  )
})

test('reported overage is charged and blocks later reservations', () => {
  const controller = createUsageBudgetController({
    executionBudgetUnits: 1_000,
    windowBudgetUnits: 200,
  })
  const first = controller.createExecution().reserve({
    estimatedInputTokens: 80,
    maxOutputTokens: 20,
  })
  assert.equal(first.reserved, true)
  if (!first.reserved) return
  const reconciliation = first.reservation.reconcile({
    kind: 'reported',
    usage: { inputTokens: 180, outputTokens: 20, totalTokens: 200 },
  })
  assert.equal(reconciliation.overReservationUnits, 100)

  const blocked = controller.createExecution().reserve({
    estimatedInputTokens: 1,
    maxOutputTokens: 1,
  })
  assert.equal(blocked.reserved, false)
  if (!blocked.reserved) assert.equal(blocked.reason, 'window_budget')
})

test('ledger capacity is bounded and fails closed until entries expire', () => {
  let now = 0
  const controller = createUsageBudgetController({
    executionBudgetUnits: 1_000,
    windowBudgetUnits: 10_000,
    maxLedgerEntries: 1,
    windowMs: 1_000,
    now: () => now,
  })
  const first = controller.createExecution().reserve({
    estimatedInputTokens: 10,
    maxOutputTokens: 10,
  })
  assert.equal(first.reserved, true)
  if (!first.reserved) return
  first.reservation.reconcile({
    kind: 'reported',
    usage: {
      inputTokens: 5,
      outputTokens: 5,
      totalTokens: 10,
    },
  })

  const blocked = controller.createExecution().reserve({
    estimatedInputTokens: 10,
    maxOutputTokens: 10,
  })
  assert.equal(blocked.reserved, false)
  if (!blocked.reserved) assert.equal(blocked.reason, 'ledger_capacity')

  now = 1_001
  assert.equal(
    controller.createExecution().reserve({
      estimatedInputTokens: 10,
      maxOutputTokens: 10,
    }).reserved,
    true,
  )
})
