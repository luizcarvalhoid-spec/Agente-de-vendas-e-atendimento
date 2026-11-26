import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { after, before, test, type TestContext } from 'node:test'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'

import { OPENROUTER_MAX_RESPONSE_BYTES } from '../src/agent/chat-completions-client.js'
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
const canonicalModel = 'openai/gpt-6-luna-20260922'
const modelIdentityPath = '/api/v1/model/openai/gpt-6-luna'
const routingMetadata = (model: string = commercialModel, provider = 'Azure', selected = true, attempt: unknown = 1) => ({
  requested: commercialModel, attempt, endpoints: { available: [{ model, provider, selected }] },
})
const endpoint = {
  model_id: commercialModel, tag: provider, provider_name: 'Azure', status: 0, service_tier: null,
  name: 'Azure | openai/gpt-6-luna-20260922',
  supported_parameters: ['tools', 'tool_choice', 'reasoning_effort', 'max_completion_tokens'],
  supports_tool_choice: { auto: true },
  pricing: { prompt: '0.00000010', completion: '0.00000050', input_cache_read: '0.000000010', input_cache_write: '0.000000125' },
}
const key = {
  limit: 5, limit_reset: null, limit_remaining: 5,
  is_free_tier: false, is_management_key: false, is_provisioning_key: false,
}
const usage = { prompt_tokens: 600, completion_tokens: 34, total_tokens: 634 }
const completionPayload = (message: string | null, options?: Parameters<typeof syntheticCompletion>[1], observed: string = provider) => ({
  ...syntheticCompletion(message, { model: commercialModel, usage, ...options }),
  provider: observed,
  openrouter_metadata: routingMetadata(options?.model, observed),
})
const completion = (...args: Parameters<typeof completionPayload>) => Response.json(completionPayload(...args))
const searchCall = (id: string) => functionCall('search_products', {
  query: 'shampoo anticaspa frescor', category: 'shampoos', subcategory: 'anticaspa', scalpTypes: ['oleoso'],
  maxPrice: 50, requireInStock: true, limit: 1,
}, id)
const search = (ordinal: number) => completion(null, { toolCalls: [searchCall(`search-${ordinal}`)] })

async function fixture(t: TestContext, options: {
  catalog?: Record<string, unknown>[]; zdr?: Record<string, unknown>[]; key?: Record<string, unknown>;
  identity?(): Response;
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
      if (path === modelIdentityPath) {
        assert.equal(init?.method, 'GET')
        assert.equal(init?.cache, 'no-store')
        assert(!new Headers(init?.headers).has('authorization'))
        return options.identity?.() ?? Response.json({ data: { id: commercialModel, canonical_slug: canonicalModel } })
      }
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
  return { deps, controller, requests, bodies, directory, store, run: () => runCommercialExperiment({ live, signal: controller.signal }, deps) }
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
    assert.equal(uncertain.requests.length, 2)
  }
  const zdrAzure = { ...endpoint, safety_retention: false }
  for (const zdr of [[], [{ ...endpoint, safety_retention: true }], [{ ...endpoint }],
    [zdrAzure, { ...zdrAzure, tag: 'azure/us' }],
    [zdrAzure, { ...zdrAzure, model_id: canonicalModel, tag: 'azure/us' }],
    [{ ...zdrAzure, name: 'outro deployment' }]]) {
    const fixtureResult = await fixture(t, { zdr })
    await assert.rejects(fixtureResult.run(), { code: 'ZDR_WITHOUT_SAFETY_RETENTION_UNVERIFIED' })
    assert.equal(fixtureResult.requests.length, 3)
  }
  const changedPrice = await fixture(t, { zdr: [{ ...endpoint, safety_retention: false, pricing: { ...endpoint.pricing, input_cache_write: '0.2' } }] })
  await assert.rejects(changedPrice.run(), { code: 'PRICING_UNVERIFIED' })
  assert.equal(changedPrice.requests.length, 3)
  const charged = { ...endpoint, pricing: { ...endpoint.pricing, request: '0.01' } }
  const fee = await fixture(t, { catalog: [charged], zdr: [{ ...charged, safety_retention: false }] })
  await assert.rejects(fee.run(), { code: 'PRICING_UNVERIFIED' })
  assert.equal(fee.requests.length, 3)
})

test('prova pública ausente, remapeada ou incompatível bloqueia antes de consumir a R4', async (t) => {
  const cases = [
    [() => new Response(fakeKey, { status: 503 }), 'PUBLIC_MODEL_IDENTITY_UNAVAILABLE'],
    [() => Response.json({ data: { id: commercialModel } }), 'MODEL_ALIAS_UNVERIFIED'],
    [() => Response.json({ data: { id: canonicalModel, canonical_slug: commercialModel } }), 'MODEL_ALIAS_UNVERIFIED'],
    [() => Response.json({ data: { id: commercialModel, canonical_slug: `${canonicalModel}-next` } }), 'MODEL_ALIAS_UNVERIFIED'],
  ] as const
  for (const [identity, code] of cases) {
    const { run, requests, store } = await fixture(t, { identity })
    await assert.rejects(run(), { code, message: code })
    assert.deepEqual(requests, [modelIdentityPath])
    assert.equal(await store.status(commercialUseId), 'available')
  }
})

test('teto, reset e saldo incompatíveis barram inferência e o consumo único permanece após a falha', async (t) => {
  const cases = [
    [{ key: { limit: 1 } }, 'KEY_CONFIGURATION_UNVERIFIED'],
    [{ key: { limit_reset: 'daily' } }, 'KEY_CONFIGURATION_UNVERIFIED'],
    [{ key: { limit_remaining: 5.01 } }, 'KEY_CONFIGURATION_UNVERIFIED'],
    [{ key: { limit_remaining: 0.001 } }, 'BUDGET_INSUFFICIENT'],
    [{ key: { effective_budget: { remaining_usd: 0.001 } } }, 'BUDGET_INSUFFICIENT'],
  ] as const
  for (const [options, code] of cases) {
    const { run, bodies, requests } = await fixture(t, options)
    await assert.rejects(run(), { code })
    assert.equal(bodies.length, 0)
    assert.equal(requests.length, 4)
    await assert.rejects(run(), { code: 'EXPERIMENT_ALREADY_CONSUMED' })
    assert.equal(requests.length, 4)
  }
})

test('reserva maior que o orçamento interno bloqueia antes de consultar a chave com teto de USD 5', async (t) => {
  const expensive = { ...endpoint, pricing: { ...endpoint.pricing, input_cache_write: '0.00003' } }
  const { run, requests, store } = await fixture(t, { catalog: [expensive], zdr: [{ ...expensive, safety_retention: false }] })
  await assert.rejects(run(), { code: 'BUDGET_INSUFFICIENT' })
  assert.equal(requests.length, 3)
  assert.equal(await store.status(commercialUseId), 'available')
})

test('a R4 aceita saldo acima de USD 1, consome apenas o marcador novo e preserva R1, R2 e R3', async (t) => {
  const { run, bodies, requests, directory, store } = await fixture(t, {
    key: { limit_remaining: 4.90 },
    post: (ordinal) => ordinal === 1 ? search(ordinal) : completion('Essa opção entrega uma sensação de frescor.'),
  })
  const previousIds = [
    '070d6000000000000000000000000001',
    '070d6000000000000000000000000002',
    '070d6000000000000000000000000003',
  ]
  const previousMarker = '{"version":1,"state":"consumed"}\n'
  for (const id of previousIds) {
    await writeFile(join(directory, `${id}.used`), previousMarker, { flag: 'wx', mode: 0o600 })
  }
  assert.equal(commercialUseId, '070d6000000000000000000000000004')
  assert.equal(await store.status(commercialUseId), 'available')
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
  assert.equal(success.value.experiment, 'EVAL-07D.6-R4')
  assert.equal(await store.status(commercialUseId), 'consumed')
  for (const id of previousIds) {
    assert.equal(await store.status(id), 'consumed')
    assert.equal(await readFile(join(directory, `${id}.used`), 'utf8'), previousMarker)
  }
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

test('CLI aceita apenas a autorização R4 e dry-run não acessa a API', async () => {
  const script = fileURLToPath(new URL('../src/scripts/eval-commercial-openrouter.ts', import.meta.url))
  const guard = 'data:text/javascript,globalThis.fetch%3D()%3D%3Eprocess.exit(97)'
  const args = ['--import', guard, '--import', import.meta.resolve('tsx'), script]
  const exec = promisify(execFile)
  const env = { ...process.env }
  delete env.OPENROUTER_API_KEY
  assert.match((await exec(process.execPath, [...args, '--help'], { env })).stdout, /--authorize EVAL-07D\.6-R4 /)
  for (const [authorization, expectedCode] of [
    ['EVAL-07D.6', 'LIVE_AUTHORIZATION_REQUIRED'],
    ['EVAL-07D.6-R1', 'LIVE_AUTHORIZATION_REQUIRED'],
    ['EVAL-07D.6-R2', 'LIVE_AUTHORIZATION_REQUIRED'],
    ['EVAL-07D.6-R3', 'LIVE_AUTHORIZATION_REQUIRED'],
    // A CLI reconhece R4 e para no requisito de terminal, antes de qualquer execução.
    ['EVAL-07D.6-R4', 'PRIVATE_TERMINAL_REQUIRED'],
  ]) {
    await assert.rejects(exec(process.execPath, [
      ...args, '--live', '--authorize', authorization, '--provider', 'azure', '--confirm-zdr-only',
    ], { env }), (error: unknown) => {
      const { code, stderr } = error as { code: number; stderr: string }
      assert.equal(code, 1)
      assert.equal(stderr.trim(), `NO-GO ${expectedCode}`)
      return true
    })
  }
  const dryRun = await exec(process.execPath, [...args, '--dry-run'], { env })
  assert.match(dryRun.stdout, /EVAL-07D\.6-R4/)
  assert.match(dryRun.stdout, /Solicitações autenticadas e tentativas de modelo 0 0/)
  assert.equal(dryRun.stderr, '')
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

const diagnosticCall = searchCall('search-diagnostic')

function toolCompletion(toolCalls: readonly unknown[] = [diagnosticCall]) {
  const payload = syntheticCompletion(null, { model: commercialModel, usage, finishReason: 'tool_calls' })
  return {
    ...payload,
    provider: 'Azure',
    openrouter_metadata: routingMetadata(),
    choices: payload.choices.map((choice) => ({
      ...choice,
      native_finish_reason: 'completed',
      message: { ...choice.message, tool_calls: toolCalls },
    })),
  }
}

test('JSON não streaming com conteúdo nulo e tool_calls chega às ferramentas com metadados coerentes', async (t) => {
  const { run, bodies } = await fixture(t, { post: (ordinal) => ordinal === 1
    ? Response.json({ ...toolCompletion(), openrouter_metadata: routingMetadata(), streamed: true })
    : completion('A opção encontrada atende ao perfil informado.', {}, 'Azure') })
  const result = await run()
  assert(result.status !== 'dry-run')
  assert.equal(result.status, 'completed', result.reason)
  assert.equal(result.observedProvider, 'Azure')
  assert.equal(result.returnedModel, commercialModel)
  assert.equal(result.responseValidationFailure, undefined)
  assert.equal(result.executedTools, 1)
  assert.equal(bodies.length, 2)
  assert(bodies.every((body) => body.stream === false))
})

test('resposta inválida antes da observação tem diagnóstico fixo e não executa ferramentas', async (t) => {
  const valid = toolCompletion()
  const firstChoice = valid.choices[0]
  assert(firstChoice)
  const unrelatedModel = `${canonicalModel}-next`
  const cases = [
    ['INVALID_JSON', () => new Response(fakeKey)],
    ['UNEXPECTED_EVENT_STREAM', () => new Response(`data: ${JSON.stringify(valid)}\n\n`, {
      headers: { 'content-type': 'text/event-stream; charset=utf-8' },
    })],
    ['BODY_TOO_LARGE', () => new Response('x'.repeat(OPENROUTER_MAX_RESPONSE_BYTES + 1))],
    ['INVALID_ENVELOPE', () => Response.json({ ...valid, model: null })],
    ['INVALID_CHOICE', () => Response.json({ ...valid, choices: [{ ...firstChoice, finish_reason: 0 }] })],
    ['MISSING_PRIMARY_CHOICE', () => Response.json({ ...valid, choices: [{ ...firstChoice, index: 1 }] })],
    ['INVALID_ASSISTANT_MESSAGE', () => Response.json({ ...valid, choices: [{
      ...firstChoice, message: { role: 'assistant', tool_calls: [diagnosticCall] },
    }] })],
    ['EMPTY_ASSISTANT_MESSAGE', () => Response.json(toolCompletion([]))],
    ['INVALID_TOOL_CALL', () => Response.json(toolCompletion([{ ...diagnosticCall, type: fakeKey }]))],
    ['INVALID_TOOL_ARGUMENT_FIELD', () => Response.json(toolCompletion([{
      ...diagnosticCall, function: { ...diagnosticCall.function, arguments: { private: fakeKey } },
    }]))],
    ['DUPLICATE_TOOL_CALL_IDS', () => Response.json(toolCompletion([diagnosticCall, diagnosticCall]))],
    ['INVALID_USAGE', () => Response.json({ ...valid, usage: { ...usage, total_tokens: null } })],
    ['INVALID_PROVIDER_METADATA', () => Response.json({ ...valid, openrouter_metadata: { endpoints: [] } })],
    ['ROUTING_SELECTION_UNVERIFIED', () => Response.json({ ...valid, openrouter_metadata: undefined })],
    ['ROUTING_SELECTION_UNVERIFIED', () => Response.json({ ...valid,
      openrouter_metadata: routingMetadata(commercialModel, 'Azure', false) })],
    ['ROUTING_SELECTION_UNVERIFIED', () => Response.json({ ...valid, openrouter_metadata: {
      ...routingMetadata(), endpoints: { available: [
        ...routingMetadata().endpoints.available, ...routingMetadata(canonicalModel).endpoints.available,
      ] },
    } })],
    ['ROUTING_PROVIDER_CONFLICT', () => Response.json({ ...valid,
      openrouter_metadata: routingMetadata(commercialModel, 'azure') })],
    ['ROUTING_MODEL_CONFLICT', () => Response.json({ ...valid, model: unrelatedModel,
      openrouter_metadata: routingMetadata() })],
    ['ROUTING_MODEL_CONFLICT', () => Response.json({ ...valid, model: canonicalModel,
      openrouter_metadata: routingMetadata(unrelatedModel) })],
    ['ROUTING_MODEL_CONFLICT', () => Response.json({ ...valid, openrouter_metadata: {
      ...routingMetadata(), endpoints: { available: [{ provider: 'Azure', selected: true }] },
    } })],
    ['ROUTING_REQUESTED_MODEL_CONFLICT', () => Response.json({ ...valid,
      openrouter_metadata: { ...routingMetadata(), requested: unrelatedModel } })],
    ['ROUTING_REQUESTED_MODEL_CONFLICT', () => Response.json({ ...valid,
      openrouter_metadata: { ...routingMetadata(), requested: undefined } })],
    ['ROUTING_ATTEMPT_CONFLICT', () => Response.json({ ...valid,
      openrouter_metadata: routingMetadata(commercialModel, 'Azure', true, 2) })],
    ['ROUTING_ATTEMPT_CONFLICT', () => Response.json({ ...valid,
      openrouter_metadata: { ...routingMetadata(), attempt: undefined } })],
    ['ROUTING_ATTEMPT_CONFLICT', () => Response.json({ ...valid,
      openrouter_metadata: { ...routingMetadata(), strategy: 'fallback' } })],
    ['ROUTING_ATTEMPT_CONFLICT', () => Response.json({ ...valid, openrouter_metadata: {
      ...routingMetadata(), attempts: [{ provider: 'OpenAI', model: commercialModel, status: 200 }],
    } })],
    ['ROUTING_MODEL_CONFLICT', () => Response.json({ ...valid, openrouter_metadata: {
      ...routingMetadata(), attempts: [{ provider: 'Azure', model: unrelatedModel, status: 200 }],
    } })],
    ['ROUTING_ATTEMPT_CONFLICT', () => Response.json({ ...valid, openrouter_metadata: {
      ...routingMetadata(), attempts: [
        { provider: 'Azure', model: commercialModel, status: 503 },
        { provider: 'Azure', model: canonicalModel, status: 200 },
      ],
    } })],
  ] as const
  for (const [index, [category, post]] of cases.entries()) {
    await t.test(`${category} (${index + 1})`, async (subtest) => {
      const { run, bodies } = await fixture(subtest, { post })
      const result = await run()
      assert(result.status !== 'dry-run')
      assert.equal(result.status, 'interrupted')
      assert.equal(result.reason, 'INVALID_MODEL_RESPONSE')
      assert.equal(result.responseValidationFailure, category)
      assert.equal(result.returnedModel, undefined)
      assert.equal(result.observedProvider, undefined)
      assert.equal(result.executedTools, 0)
      assert.equal(result.toolCalls, 0)
      assert.equal(result.response, undefined)
      assert.equal(bodies.length, 1)
      assert(!JSON.stringify(result).includes(fakeKey))
      assert(!JSON.stringify(result).includes(unrelatedModel))
    })
  }
})

test('alias e slug comprovados funcionam nos dois sentidos e preservam a identidade retornada', async (t) => {
  for (const [returned, selected] of [[canonicalModel, commercialModel], [commercialModel, canonicalModel]] as const) {
    await t.test(returned, async (subtest) => {
      const { run, bodies } = await fixture(subtest, { post: (ordinal) => Response.json({
        ...(ordinal === 1 ? toolCompletion() : completionPayload('A opção encontrada atende ao perfil informado.')),
        model: returned,
        provider: 'Azure',
        openrouter_metadata: {
          ...routingMetadata(selected),
          attempts: [{ provider: 'Azure', model: selected, status: 200 }],
        },
      }) })
      const result = await run()
      assert(result.status !== 'dry-run')
      assert.equal(result.status, 'completed', result.reason)
      assert.equal(result.returnedModel, returned)
      assert.equal(result.observedProvider, 'Azure')
      assert.equal(result.responseValidationFailure, undefined)
      assert.equal(result.executedTools, 1)
      assert.equal(result.commercialStatus, 'passed')
      assert(result.productIds.length > 0)
      assert(result.productIds.every((id) => result.compatibleIds.includes(id)))
      assert.equal(bodies.length, 2)
      assert(bodies.every((body) => body.model === commercialModel && body.stream === false))
    })
  }
})

test('modelo e provedor não autorizados são rejeitados mesmo com roteamento internamente coerente', async (t) => {
  const cases = [
    [`${canonicalModel}-next`, 'Azure', 'MODEL_IDENTITY_MISMATCH'],
    [`openai/${fakeKey}`, 'Azure', 'MODEL_IDENTITY_MISMATCH'],
    [canonicalModel, 'OpenAI', 'PROVIDER_UNVERIFIED'],
  ] as const
  for (const [model, provider, reason] of cases) {
    const { run, bodies } = await fixture(t, { post: () => Response.json({
      ...toolCompletion(), model, provider,
      openrouter_metadata: { ...routingMetadata(model, provider), private: fakeKey },
    }) })
    const result = await run()
    assert(result.status !== 'dry-run')
    assert.equal(result.status, 'interrupted')
    assert.equal(result.reason, reason)
    assert.equal(result.returnedModel, model === canonicalModel ? canonicalModel : undefined)
    assert.equal(result.executedTools, 0)
    assert.equal(bodies.length, 1)
    assert(!JSON.stringify(result).includes(fakeKey))
    assert.equal(result.response, undefined)
  }
})

test('provedor ausente tem falha própria mesmo com Azure selecionado nos metadados', async (t) => {
  const { run, bodies } = await fixture(t, { post: () => Response.json({
    ...toolCompletion(), provider: undefined, openrouter_metadata: routingMetadata(),
  }) })
  const result = await run()
  assert(result.status !== 'dry-run')
  assert.equal(result.status, 'interrupted')
  assert.equal(result.reason, 'PROVIDER_UNVERIFIED')
  assert.equal(result.returnedModel, commercialModel)
  assert.equal(result.observedProvider, undefined)
  assert.equal(result.responseValidationFailure, undefined)
  assert.equal(result.executedTools, 0)
  assert.equal(bodies.length, 1)
})

test('nome de ferramenta não ofertada tem código próprio', async (t) => {
  const { run, bodies } = await fixture(t, { post: () => Response.json(toolCompletion([functionCall('unknown_tool', {})])) })
  const result = await run()
  assert(result.status !== 'dry-run')
  assert.equal(result.reason, 'TOOL_CALLING_INCOMPATIBLE')
  assert.equal(result.responseValidationFailure, undefined)
  assert.equal(result.executedTools, 0)
  assert.equal(bodies.length, 1)
})

test('JSON inválido ou argumentos fora do schema da ferramenta são rejeitados no orquestrador', async (t) => {
  for (const args of ['{', '{"maxPrice":"inválido"}']) {
    const invalidCall = { ...diagnosticCall, function: { ...diagnosticCall.function, arguments: args } }
    const { run, bodies } = await fixture(t, { post: (ordinal, body) => {
      if (ordinal === 1) return Response.json(toolCompletion([invalidCall]))
      const messages = body.messages as { role: string; content: string }[]
      const tool = messages.find((message) => message.role === 'tool')
      assert(tool)
      assert.equal(JSON.parse(tool.content).error.code, 'INVALID_ARGUMENTS')
      return completion('Não encontrei uma opção adequada.')
    } })
    const result = await run()
    assert(result.status !== 'dry-run')
    assert.equal(result.status, 'completed', result.reason)
    assert.equal(result.commercialStatus, 'failed')
    assert.equal(result.toolCalls, 1)
    assert.equal(result.executedTools, 0)
    assert.equal(result.returnedModel, commercialModel)
    assert.equal(result.responseValidationFailure, undefined)
    assert.equal(bodies.length, 2)
  }
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
