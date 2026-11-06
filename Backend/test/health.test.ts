import assert from 'node:assert/strict'
import test from 'node:test'

import { buildApp } from '../src/app.js'

const allowedOrigin = 'http://localhost:5173'

test('GET /api/health returns the demo API status', async (t) => {
  const app = buildApp()
  t.after(() => app.close())

  const response = await app.inject({
    method: 'GET',
    url: '/api/health',
  })

  assert.equal(response.statusCode, 200)
  assert.match(response.headers['content-type'] ?? '', /^application\/json/)
  assert.deepEqual(response.json(), {
    status: 'ok',
    service: 'hidrasplash-api',
    version: '0.1.0-demo',
  })
})

test('CORS allows the local Vite origin', async (t) => {
  const app = buildApp()
  t.after(() => app.close())

  const response = await app.inject({
    method: 'GET',
    url: '/api/health',
    headers: { origin: allowedOrigin },
  })

  assert.equal(response.statusCode, 200)
  assert.equal(response.headers['access-control-allow-origin'], allowedOrigin)
})

test('CORS does not allow an unknown origin', async (t) => {
  const app = buildApp()
  t.after(() => app.close())

  const response = await app.inject({
    method: 'GET',
    url: '/api/health',
    headers: { origin: 'https://example.com' },
  })

  assert.equal(response.statusCode, 200)
  assert.equal(response.headers['access-control-allow-origin'], undefined)
})

test('CORS answers a valid health preflight request', async (t) => {
  const app = buildApp()
  t.after(() => app.close())

  const response = await app.inject({
    method: 'OPTIONS',
    url: '/api/health',
    headers: {
      origin: allowedOrigin,
      'access-control-request-method': 'GET',
    },
  })

  assert.equal(response.statusCode, 204)
  assert.equal(response.headers['access-control-allow-origin'], allowedOrigin)
  assert.match(response.headers['access-control-allow-methods'] ?? '', /GET/)
})
