import assert from 'node:assert/strict'
import test from 'node:test'

import { z } from 'zod'

import { buildApp } from '../src/app.js'
import { loadConfig } from '../src/config/env.js'
import { apiErrorSchema } from '../src/contracts/api.js'

const config = loadConfig({})

test('Zod errors return a sanitized validation response', async (t) => {
  const app = buildApp({ config })
  t.after(() => app.close())
  app.get('/test/zod-error', async () => {
    return z.object({ quantity: z.number().positive() }).parse({ quantity: 0 })
  })

  const response = await app.inject({ method: 'GET', url: '/test/zod-error' })

  assert.equal(response.statusCode, 400)
  assert.deepEqual(apiErrorSchema.parse(response.json()), {
    code: 'VALIDATION_ERROR',
    message: 'Dados de entrada inválidos.',
  })
  assert.doesNotMatch(response.body, /quantity|positive/i)
})

test('Fastify validation errors return a sanitized response', async (t) => {
  const app = buildApp({ config })
  t.after(() => app.close())
  app.post(
    '/test/fastify-validation',
    {
      schema: {
        body: {
          type: 'object',
          additionalProperties: false,
          required: ['name'],
          properties: { name: { type: 'string' } },
        },
      },
    },
    async () => ({ ok: true }),
  )

  const response = await app.inject({
    method: 'POST',
    url: '/test/fastify-validation',
    payload: {},
  })

  assert.equal(response.statusCode, 400)
  assert.deepEqual(apiErrorSchema.parse(response.json()), {
    code: 'VALIDATION_ERROR',
    message: 'Dados de entrada inválidos.',
  })
  assert.doesNotMatch(response.body, /name|required/i)
})

test('unknown routes return the public not found contract', async (t) => {
  const app = buildApp({ config })
  t.after(() => app.close())

  const response = await app.inject({ method: 'GET', url: '/missing' })

  assert.equal(response.statusCode, 404)
  assert.deepEqual(apiErrorSchema.parse(response.json()), {
    code: 'NOT_FOUND',
    message: 'Recurso não encontrado.',
  })
})

test('unexpected errors do not expose internal messages', async (t) => {
  const app = buildApp({ config })
  t.after(() => app.close())
  app.get('/test/internal-error', async () => {
    throw new Error('database-password=must-not-leak')
  })

  const response = await app.inject({
    method: 'GET',
    url: '/test/internal-error',
  })

  assert.equal(response.statusCode, 500)
  assert.deepEqual(apiErrorSchema.parse(response.json()), {
    code: 'INTERNAL_SERVER_ERROR',
    message: 'Erro interno do servidor.',
  })
  assert.doesNotMatch(response.body, /database-password|must-not-leak/i)
})
