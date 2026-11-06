import assert from 'node:assert/strict'
import test from 'node:test'

import { ConfigError, loadConfig } from '../src/config/env.js'

test('configuration uses local defaults without OpenRouter credentials', () => {
  assert.deepEqual(loadConfig({}), {
    port: 3333,
    frontendOrigin: 'http://localhost:5173',
    openRouterApiKey: undefined,
    openRouterModel: undefined,
  })
})

test('configuration parses a complete valid environment', () => {
  assert.deepEqual(
    loadConfig({
      PORT: '4000',
      FRONTEND_ORIGIN: 'https://shop.example.com',
      OPENROUTER_API_KEY: 'test-key',
      OPENROUTER_MODEL: 'test-model',
    }),
    {
      port: 4000,
      frontendOrigin: 'https://shop.example.com',
      openRouterApiKey: 'test-key',
      openRouterModel: 'test-model',
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

test('OpenRouter key and model must be configured together', () => {
  const secret = 'must-not-appear-in-errors'

  assert.throws(
    () => loadConfig({ OPENROUTER_API_KEY: secret }),
    (error: unknown) => {
      assert.ok(error instanceof ConfigError)
      assert.deepEqual(error.fields, ['OPENROUTER_API_KEY'])
      assert.doesNotMatch(String(error), new RegExp(secret))
      return true
    },
  )

  assert.throws(
    () => loadConfig({ OPENROUTER_MODEL: 'model-without-key' }),
    ConfigError,
  )
})

test('empty OpenRouter values are treated as absent', () => {
  const config = loadConfig({
    OPENROUTER_API_KEY: ' ',
    OPENROUTER_MODEL: '',
  })

  assert.equal(config.openRouterApiKey, undefined)
  assert.equal(config.openRouterModel, undefined)
})
