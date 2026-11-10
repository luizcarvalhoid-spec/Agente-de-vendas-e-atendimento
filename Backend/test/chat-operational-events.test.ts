import assert from 'node:assert/strict'
import test from 'node:test'

import { observeChatOperation } from '../src/observability/chat-operational-events.js'

test('operational observer receives only the explicit sanitized event', () => {
  const events: unknown[] = []
  observeChatOperation(
    { record: (event) => events.push(event) },
    {
      type: 'execution_completed',
      requestId: '00000000-0000-4000-8000-000000000001',
      status: 'success',
      code: 'OK',
      durationMs: 12,
    },
  )
  assert.equal(events.length, 1)
  const serialized = JSON.stringify(events)
  assert.doesNotMatch(
    serialized,
    /message|history|prompt|session|authorization|ip|toolResult/i,
  )
})

test('observer failures are swallowed', () => {
  assert.doesNotThrow(() =>
    observeChatOperation(
      {
        record() {
          throw new Error('C:\\secret\\observer.log')
        },
      },
      {
        type: 'execution_started',
        requestId: '00000000-0000-4000-8000-000000000001',
      },
    ),
  )
})
