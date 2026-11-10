import assert from 'node:assert/strict'
import test from 'node:test'

import { ConfigError, loadConfig } from '../src/config/env.js'

test('configuration uses local defaults without OpenRouter credentials', () => {
  const config = loadConfig({})
  assert.equal(config.port, 3333)
  assert.equal(config.frontendOrigin, 'http://localhost:5173')
  assert.equal(config.openRouterStatus, 'disabled')
  assert.equal(config.openRouterApiKey, undefined)
  assert.equal(config.openRouterModel, undefined)
  assert.equal(config.chatRateLimitPerOrigin, 10)
  assert.equal(config.chatMaxConcurrent, 4)
  assert.equal(config.chatExecutionBudgetUnits, 120_000)
  assert.equal(config.chatUsageWindowBudgetUnits, 500_000)
})

test('configuration parses a complete valid environment', () => {
  assert.deepEqual(
    loadConfig({
      PORT: '4000',
      FRONTEND_ORIGIN: 'https://shop.example.com',
      OPENROUTER_API_KEY: 'test-key',
      OPENROUTER_MODEL: 'provider/test-model',
      OPENROUTER_MAX_OUTPUT_TOKENS: '256',
    }),
    {
      ...loadConfig({}),
      port: 4000,
      frontendOrigin: 'https://shop.example.com',
      openRouterApiKey: 'test-key',
      openRouterModel: 'provider/test-model',
      openRouterStatus: 'configured',
      openRouterMaxOutputTokens: 256,
    },
  )
})

test('configuration rejects invalid ports', async (t) => {
  for (const port of ['0', '65536', 'not-a-number']) {
    await t.test(port, () => {
      assert.throws(() => loadConfig({ PORT: port }), ConfigError)
    })
  }
})

test('configuration accepts only a single HTTP or HTTPS origin', async (t) => {
  const invalidOrigins = [
    'ftp://example.com',
    'https://user:password@example.com',
    'https://example.com/path',
    'https://example.com?query=1',
    'https://example.com#fragment',
  ]

  for (const origin of invalidOrigins) {
    await t.test(origin, () => {
      assert.throws(
        () => loadConfig({ FRONTEND_ORIGIN: origin }),
        ConfigError,
      )
    })
  }
})

test('invalid or incomplete AI configuration degrades only the chat', () => {
  const secret = 'must-not-appear-in-errors'
  const missingModel = loadConfig({ OPENROUTER_API_KEY: secret })
  const missingKey = loadConfig({
    OPENROUTER_MODEL: 'provider/model-without-key',
  })
  const malformedModel = loadConfig({
    OPENROUTER_API_KEY: secret,
    OPENROUTER_MODEL: 'malformed-model',
  })
  assert.equal(missingModel.openRouterStatus, 'invalid')
  assert.equal(missingKey.openRouterStatus, 'invalid')
  assert.equal(malformedModel.openRouterStatus, 'invalid')
})

test('empty OpenRouter values are treated as absent', () => {
  const config = loadConfig({
    OPENROUTER_API_KEY: ' ',
    OPENROUTER_MODEL: '',
  })

  assert.equal(config.openRouterApiKey, undefined)
  assert.equal(config.openRouterModel, undefined)
  assert.equal(config.openRouterStatus, 'disabled')
})

test('invalid operational and general configuration still fails startup', () => {
  assert.throws(
    () => loadConfig({ CHAT_MAX_CONCURRENT: '1', CHAT_MAX_CONCURRENT_PER_ORIGIN: '2' }),
    ConfigError,
  )
  assert.throws(
    () => loadConfig({ CHAT_RATE_LIMIT_PER_ORIGIN: '0' }),
    ConfigError,
  )
  assert.throws(() => loadConfig({ PORT: 'invalid' }), ConfigError)
})
