import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { after, before, test, type TestContext } from 'node:test'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'

import { loadCatalogRepository } from '../src/catalog/catalog-repository.js'
import { CanaryAuthorizationUseStore } from '../src/evals/external-canary-use-store.js'
import {
  commercialModel, commercialUseId, runCommercialExperiment,
} from '../src/evals/openrouter-commercial-experiment.js'
import { functionCall, syntheticCompletion } from './fixtures/openai-direct-synthetic.js'

const originalFetch = globalThis.fetch
let realAttempts = 0
before(() => {
  globalThis.fetch = async () => { realAttempts += 1; throw new Error('rede proibida') }
})
after(() => {
  globalThis.fetch = originalFetch
  assert.equal(realAttempts, 0)
})

const fakeKey = 'sk-or-v1-only-a-test-fixture-not-a-secret'
const provider = 'azure'
const live = { provider, authorized: true, accountZdrOnlyConfirmed: true } as const
const endpoint = {
  model_id: commercialModel, tag: provider, provider_name: 'Azure', status: 0, service_tier: null,
  name: 'Azure | openai/gpt-6-luna-20260922',
  supported_parameters: ['tools', 'tool_choice', 'reasoning_effort', 'max_completion_tokens'],
  supports_tool_choice: { auto: true },
  pricing: { prompt: '0.00000010', completion: '0.00000050', input_cache_read: '0.000000010', input_cache_write: '0.000000125' },
}
const key = {
  limit: 1, limit_reset: null, limit_remaining: 1,
  is_free_tier: false, is_management_key: false, is_provisioning_key: false,
}
const usage = { prompt_tokens: 600, completion_tokens: 34, total_tokens: 634 }
const completion = (message: string | null, options?: Parameters<typeof syntheticCompletion>[1], observed: string = provider) =>
  Response.json({ ...syntheticCompletion(message, { model: commercialModel, usage, ...options }), provider: observed })
const search = (ordinal: number) => completion(null, { toolCalls: [functionCall('search_products', {
  query: 'shampoo anticaspa frescor', category: 'shampoos', subcategory: 'anticaspa', scalpTypes: ['oleoso'],
  maxPrice: 50, requireInStock: true, limit: 1,
}, `search-${ordinal}`)] })

async function fixture(t: TestContext, options: {
  catalog?: Record<string, unknown>[]; zdr?: Record<string, unknown>[]; key?: Record<string, unknown>;
  post?(ordinal: number, body: Record<string, unknown>): Response | Promise<Response>
} = {}) {
  const directory = await mkdtemp(join(tmpdir(), 'eval-07d6-'))
  t.after(() => rm(directory, { recursive: true, force: true }))
  const store = new CanaryAuthorizationUseStore(directory)
  const controller = new AbortController()
  const requests: string[] = []
  const bodies: Record<string, unknown>[] = []
  const deps = {
    loadCatalog: loadCatalogRepository,
    loadKey: () => fakeKey,
    async createUseStore() { return store },
    transport: (async (url, init) => {
      const path = new URL(String(url)).pathname
      requests.push(path)
      assert.equal(init?.redirect, 'error')
      if (path.endsWith('/models/openai/gpt-6-luna/endpoints')) {
        assert(!new Headers(init?.headers).has('authorization'))
        return Response.json({ data: { endpoints: options.catalog ?? [endpoint] } })
      }
      if (path.endsWith('/endpoints/zdr')) {
        assert(!new Headers(init?.headers).has('authorization'))
        return Response.json({ data: options.zdr ?? [{ ...endpoint, safety_retention: false }] })
      }
      assert.equal(new Headers(init?.headers).get('authorization'), `Bearer ${fakeKey}`)
      assert.equal(await store.status(commercialUseId), 'consumed')
      if (path.endsWith('/key')) return Response.json({ data: { ...key, ...options.key } })
      assert.equal(path, '/api/v1/chat/completions')
      assert.equal(init?.method, 'POST')
      const body = JSON.parse(String(init?.body))
      bodies.push(body)
      return options.post?.(bodies.length, body) ?? completion('Qual intensidade de frescor você prefere?')
    }) satisfies typeof fetch,
  }
  return { deps, controller, requests, bodies, run: () => runCommercialExperiment({ live, signal: controller.signal }, deps) }
}

test('dry-run valida catálogo e orçamento histórico sem ler chave, usar rede ou consumir autorização', async (t) => {
  const { deps } = await fixture(t)
  const result = await runCommercialExperiment({ signal: new AbortController().signal }, {
    ...deps, loadKey: () => assert.fail(), createUseStore: async () => assert.fail(),
    transport: async () => assert.fail(),
  })
  assert.equal(result.status, 'dry-run')
  assert.equal(result.modelAttempts, 0)
  assert.deepEqual(result.compatibleIds, [9, 13])
  if (result.status === 'dry-run') assert.equal(result.historicalReserveUsd, 0.00689)
})

test('ausência de autorização, prova da política da conta, chave ou catálogo impede qualquer rede', async (t) => {
  const { deps, controller, requests } = await fixture(t)
  const signal = controller.signal
  await assert.rejects(runCommercialExperiment({ live: { ...live, authorized: false }, signal }, deps), { code: 'LIVE_AUTHORIZATION_REQUIRED' })
  await assert.rejects(runCommercialExperiment({ live: { ...live, accountZdrOnlyConfirmed: false }, signal }, deps), { code: 'ACCOUNT_ZDR_ONLY_CONFIRMATION_REQUIRED' })
  await assert.rejects(runCommercialExperiment({ live, signal }, { ...deps, loadKey: () => undefined }), { code: 'DEDICATED_KEY_UNAVAILABLE' })
  await assert.rejects(runCommercialExperiment({ live, signal }, { ...deps, loadCatalog: async () => { throw new Error() } }), { code: 'CATALOG_UNAVAILABLE' })
  const realCatalog = await deps.loadCatalog()
  await assert.rejects(runCommercialExperiment({ live, signal }, {
    ...deps, loadCatalog: async () => ({ ...realCatalog, listAll: () => realCatalog.listAll().filter((item) => item.id === 11) }),
  }), { code: 'NO_COMPATIBLE_PRODUCT' })
  assert.deepEqual(requests, [])
})

test('família Azure ambígua e ZDR sem prova inequívoca barram antes do GET da chave', async (t) => {
  for (const catalog of [[], [endpoint, endpoint], [{ ...endpoint, tag: 'azure/eu' }],
    [endpoint, { ...endpoint, tag: 'azure/us' }], [{ ...endpoint, safety_retention: true }],
    [{ ...endpoint, supported_parameters: ['tools'] }]]) {
    const uncertain = await fixture(t, { catalog })
    await assert.rejects(uncertain.run(), { code: 'AZURE_ROUTING_UNVERIFIED' })
    assert.equal(uncertain.requests.length, 1)
  }
  const zdrAzure = { ...endpoint, safety_retention: false }
  for (const zdr of [[], [{ ...endpoint, safety_retention: true }], [{ ...endpoint }],
    [zdrAzure, { ...zdrAzure, tag: 'azure/us' }], [{ ...zdrAzure, name: 'outro deployment' }]]) {
    const fixtureResult = await fixture(t, { zdr })
    await assert.rejects(fixtureResult.run(), { code: 'ZDR_WITHOUT_SAFETY_RETENTION_UNVERIFIED' })
    assert.equal(fixtureResult.requests.length, 2)
  }
  const changedPrice = await fixture(t, { zdr: [{ ...endpoint, safety_retention: false, pricing: { ...endpoint.pricing, input_cache_write: '0.2' } }] })
  await assert.rejects(changedPrice.run(), { code: 'PRICING_UNVERIFIED' })
  assert.equal(changedPrice.requests.length, 2)
  const charged = { ...endpoint, pricing: { ...endpoint.pricing, request: '0.01' } }
  const fee = await fixture(t, { catalog: [charged], zdr: [{ ...charged, safety_retention: false }] })
  await assert.rejects(fee.run(), { code: 'PRICING_UNVERIFIED' })
  assert.equal(fee.requests.length, 2)
})

test('teto, reset e saldo incompatíveis barram inferência e o consumo único permanece após a falha', async (t) => {
  for (const options of [{ key: { limit: 2 } }, { key: { limit_reset: 'daily' } }, { key: { limit_remaining: 0.001 } },
    { key: { effective_budget: { remaining_usd: 0.001 } } }]) {
    const { run, bodies, requests } = await fixture(t, options)
    await assert.rejects(run(), { code: 'limit_remaining' in options.key || 'effective_budget' in options.key ? 'BUDGET_INSUFFICIENT' : 'KEY_CONFIGURATION_UNVERIFIED' })
    assert.equal(bodies.length, 0)
    assert.equal(requests.length, 3)
    await assert.rejects(run(), { code: 'EXPERIMENT_ALREADY_CONSUMED' })
    assert.equal(requests.length, 3)
  }
})

test('concorrência permite uma rodada com ferramenta canônica, dois POSTs e resposta sem segredo', async (t) => {
  const { run, bodies, requests } = await fixture(t, {
    post: (ordinal) => ordinal === 1 ? search(ordinal) : completion('Essa opção entrega uma sensação de frescor.'),
  })
  const results = await Promise.allSettled([run(), run()])
  const success = results.find((result) => result.status === 'fulfilled')
  const duplicate = results.find((result) => result.status === 'rejected')
  assert.equal(duplicate?.reason.code, 'EXPERIMENT_ALREADY_CONSUMED')
  assert.equal(requests.filter((path) => path.endsWith('/key')).length, 1)
  assert.equal(bodies.length, 2)
  for (const body of bodies) {
    assert.deepEqual(body.provider, {
      only: [provider], order: [provider], zdr: true, data_collection: 'deny', allow_fallbacks: false, require_parameters: true,
    })
    assert.equal(body.model, commercialModel)
    assert.equal(body.reasoning_effort, 'none')
    assert.equal(body.service_tier, 'default')
    assert.equal(body.max_completion_tokens, 512)
    assert.equal(body.stream, false)
    assert.equal(Object.hasOwn(body, 'models'), false)
  }
  assert(success && success.value.status !== 'dry-run')
  assert.equal(success.value.status, 'completed')
  assert.equal(success.value.reservedUsd, 0.00689)
  assert.equal(success.value.executedTools, 1)
  assert(success.value.productIds.length > 0)
  assert.equal(success.value.returnedModel, commercialModel)
  assert.equal(success.value.observedProvider, 'azure')
  assert.equal(success.value.commercialStatus, 'passed')
  assert.deepEqual(success.value.commercialFailures, [])
  assert.equal(success.value.tokens?.total, 1268)
  assert(!JSON.stringify(success).includes(fakeKey))
})

test('resposta genérica sem ferramenta conclui tecnicamente e falha comercialmente', async (t) => {
  const { run } = await fixture(t, { post: () => completion(`Posso ajudar você a escolher um shampoo. ${fakeKey}`) })
  const result = await run()
  assert(result.status !== 'dry-run')
  assert.equal(result.status, 'completed', result.reason)
  assert.equal(result.commercialStatus, 'failed')
  assert.deepEqual(result.commercialFailures, ['PRODUCT_TOOL_EVIDENCE_MISSING', 'RECOMMENDATION_MISSING'])
  assert.equal(result.executedTools, 0)
  assert.deepEqual(result.productIds, [])
  assert.equal(result.responseSource, 'model_for_review')
  assert.match(result.response ?? '', /Posso ajudar/)
  assert(result.response)
  assert(!result.response.includes(fakeKey))
})

test('chave injetada por ambiente é reconhecida offline sem carregar .env ou expor o valor', async (t) => {
  const cwd = await mkdtemp(join(tmpdir(), 'eval-07d6-key-'))
  t.after(() => rm(cwd, { recursive: true, force: true }))
  await writeFile(join(cwd, '.env'), `OPENROUTER_API_KEY=${fakeKey}\n`)
  const script = fileURLToPath(new URL('../src/scripts/eval-commercial-openrouter.ts', import.meta.url))
  const tsx = import.meta.resolve('tsx')
  const guard = 'data:text/javascript,globalThis.fetch%3D()%3D%3Eprocess.exit(97)'
  const args = ['--import', guard, '--import', tsx, script, '--check-key']
  const env = { ...process.env }
  delete env.OPENROUTER_API_KEY
  const exec = promisify(execFile)
  await assert.rejects(exec(process.execPath, args, { cwd, env }), (error: unknown) => {
    const { code, stdout, stderr } = error as { code: number; stdout: string; stderr: string }
    assert.equal(code, 1)
    assert.equal(stdout.trim(), 'OPENROUTER_API_KEY ausente')
    assert.equal(stderr, '')
    return true
  })
  const result = await exec(process.execPath, args, { cwd, env: { ...env, OPENROUTER_API_KEY: fakeKey } })
  assert.equal(result.stdout.trim(), 'OPENROUTER_API_KEY presente, formato compatível')
  assert.equal(result.stderr, '')
})

test('HTTP inválido, provedor ausente, excesso de tokens e ferramentas repetidas não fazem retry', async (t) => {
  for (const post of [
    () => new Response(fakeKey, { status: 503 }),
    () => new Response(fakeKey),
    () => completion('oi', {}, 'other-provider'),
    () => completion(null, { toolCalls: [functionCall('search_products', { query: 'anticaspa' })],
      usage: { prompt_tokens: 20_001, completion_tokens: 44, total_tokens: 20_045 } }),
    () => completion(null, { toolCalls: [functionCall('search_products', { query: 'anticaspa' })],
      usage: { prompt_tokens: 600, completion_tokens: 513, total_tokens: 1_113 } }),
  ]) {
    const { run, bodies } = await fixture(t, { post })
    const result = await run()
    assert.equal(result.status, 'interrupted')
    assert.equal(bodies.length, 1)
    assert(!JSON.stringify(result).includes(fakeKey))
  }
  const repeated = await fixture(t, { post: search })
  assert.equal((await repeated.run()).status, 'interrupted')
  assert.equal(repeated.bodies.length, 2)
})

test('timeout da comunicação e interrupção do operador terminam a rodada', async (t) => {
  const timeout = await fixture(t, { post() {
    t.mock.timers.tick(15_000)
    return new Promise(() => {})
  } })
  t.mock.timers.enable({ apis: ['setTimeout'] })
  try {
    const result = await timeout.run()
    assert.equal(result.status, 'interrupted')
    assert.equal(timeout.bodies.length, 1)
    assert.equal(result.reason, 'MODEL_TIMEOUT')
  } finally {
    t.mock.timers.reset()
  }
  const cancelled = await fixture(t, { post() {
    cancelled.controller.abort()
    return new Promise(() => {})
  } })
  assert.equal((await cancelled.run()).status, 'interrupted')
  assert.equal(cancelled.bodies.length, 1)
})
