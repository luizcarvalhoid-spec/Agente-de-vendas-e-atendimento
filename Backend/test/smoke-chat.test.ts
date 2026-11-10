import assert from 'node:assert/strict'
import { Buffer } from 'node:buffer'
import test from 'node:test'

import { CHAT_MODEL_INPUT_MARGIN_UNITS } from '../src/agent/usage-budget-controller.js'
import {
  assertSmokeCaseEvidence,
  createSmokeCostGuard,
  SMOKE_MAX_OUTPUT_TOKENS,
  SmokeGuardError,
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

  assert.throws(() => guard.reconcileUsage(undefined), SmokeGuardError)
  await assert.rejects(
    () => transport('https://invalid.example', request()),
    SmokeGuardError,
  )
  assert.equal(fake.calls, 1)
})

test('enforces the six-transport and 128-output-token protections', async () => {
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
    SmokeGuardError,
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
