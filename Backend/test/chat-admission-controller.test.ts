import assert from 'node:assert/strict'
import test from 'node:test'

import { createChatAdmissionController } from '../src/http/chat-admission-controller.js'

const secret = new Uint8Array(32).fill(7)

test('rate limiter allows requests below the ceiling and returns Retry-After at the limit', () => {
  let now = 1_000
  const controller = createChatAdmissionController({
    perOrigin: 2,
    perSession: 2,
    windowMs: 10_000,
    now: () => now,
    secret,
  })

  assert.deepEqual(controller.checkRate({ origin: '127.0.0.1' }), {
    allowed: true,
  })
  assert.deepEqual(controller.checkRate({ origin: '127.0.0.1' }), {
    allowed: true,
  })
  const rejected = controller.checkRate({ origin: '127.0.0.1' })
  assert.equal(rejected.allowed, false)
  if (!rejected.allowed) {
    assert.equal(rejected.reason, 'origin_rate_limit')
    assert.equal(rejected.retryAfterSeconds, 10)
  }

  now = 11_001
  assert.deepEqual(controller.checkRate({ origin: '127.0.0.1' }), {
    allowed: true,
  })
})

test('alternating forged session IDs cannot bypass the origin limit', () => {
  const controller = createChatAdmissionController({
    perOrigin: 2,
    perSession: 1,
    now: () => 0,
    secret,
  })
  assert.equal(
    controller.checkRate({ origin: 'client', sessionId: 'one' }).allowed,
    true,
  )
  assert.equal(
    controller.checkRate({ origin: 'client', sessionId: 'two' }).allowed,
    true,
  )
  const rejected = controller.checkRate({
    origin: 'client',
    sessionId: 'three',
  })
  assert.equal(rejected.allowed, false)
  if (!rejected.allowed) assert.equal(rejected.reason, 'origin_rate_limit')
})

test('session limit is secondary and scoped to the observed origin', () => {
  const controller = createChatAdmissionController({
    perOrigin: 5,
    perSession: 1,
    now: () => 0,
    secret,
  })
  assert.equal(
    controller.checkRate({ origin: 'first', sessionId: 'same' }).allowed,
    true,
  )
  assert.equal(
    controller.checkRate({ origin: 'second', sessionId: 'same' }).allowed,
    true,
  )
  const rejected = controller.checkRate({
    origin: 'first',
    sessionId: 'same',
  })
  assert.equal(rejected.allowed, false)
  if (!rejected.allowed) assert.equal(rejected.reason, 'session_rate_limit')
})

test('rate limiter bounds memory and reuses capacity after expiration', () => {
  let now = 0
  const controller = createChatAdmissionController({
    perOrigin: 2,
    perSession: 2,
    maxKeys: 1,
    windowMs: 1_000,
    now: () => now,
    secret,
  })
  assert.equal(controller.checkRate({ origin: 'first' }).allowed, true)
  const full = controller.checkRate({ origin: 'second' })
  assert.equal(full.allowed, false)
  if (!full.allowed) assert.equal(full.reason, 'rate_limit_capacity')

  now = 1_001
  assert.equal(controller.checkRate({ origin: 'second' }).allowed, true)
})

test('concurrency is bounded globally and per origin and releases exactly once', () => {
  const controller = createChatAdmissionController({
    maxConcurrent: 2,
    maxConcurrentPerOrigin: 1,
    secret,
  })
  const first = controller.acquireConcurrency('first')
  assert.equal(first.acquired, true)
  assert.deepEqual(controller.acquireConcurrency('first'), {
    acquired: false,
    reason: 'origin_concurrency_limit',
    retryAfterSeconds: 1,
  })
  const second = controller.acquireConcurrency('second')
  assert.equal(second.acquired, true)
  assert.deepEqual(controller.acquireConcurrency('third'), {
    acquired: false,
    reason: 'global_concurrency_limit',
    retryAfterSeconds: 1,
  })

  if (first.acquired) {
    first.lease.release()
    first.lease.release()
  }
  const replacement = controller.acquireConcurrency('third')
  assert.equal(replacement.acquired, true)
  if (second.acquired) second.lease.release()
  if (replacement.acquired) replacement.lease.release()
})
