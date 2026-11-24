import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { createHash, generateKeyPairSync, randomBytes, sign } from 'node:crypto'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { after, before, test, type TestContext } from 'node:test'
import { promisify } from 'node:util'

import { OPENROUTER_CHAT_COMPLETIONS_ENDPOINT } from '../src/agent/chat-completions-client.js'
import { canaryApprovalSigningBytes, type CanaryApprovalPayload } from '../src/evals/external-canary-approval.js'
import { inspectCanarySource } from '../src/evals/external-canary-integrity.js'
import { externalCanaryManifestSchema, externalCanaryReviewItems } from '../src/evals/external-canary-schema.js'
import { CanaryAuthorizationUseStore } from '../src/evals/external-canary-use-store.js'
import { fingerprintExternalCanaryManifest } from '../src/evals/external-canary.js'
import { createInMemoryOpenRouterTransport, runLiveExternalEval } from '../src/evals/external-eval-runner.js'
import { executeOpenRouterLunaCanary, rehearseOpenRouterLunaCanary, verifyOpenRouterLunaCanary } from '../src/evals/openrouter-luna-canary.js'
import { functionCall, syntheticCompletion } from './fixtures/openai-direct-synthetic.js'

const exec = promisify(execFile)
const model = 'openai/gpt-6-luna'
const credential = 'test-fixture-only-never-a-real-key'
const start = Date.parse('2026-01-02T00:00:00Z')
const validity = { verifiedAt: '2025-12-31T00:00:00Z', validUntil: '2026-01-03T00:00:00Z' }
const candidate = JSON.parse(await readFile(
  new URL('../evals/canary/gpt-6-luna-openrouter-candidate.v1.json', import.meta.url), 'utf8',
))
const originalFetch = globalThis.fetch
let networkAttempts = 0
before(() => {
  globalThis.fetch = async () => {
    networkAttempts += 1
    throw new Error('Rede proibida na suíte do canário.')
  }
})
after(() => {
  globalThis.fetch = originalFetch
  assert.equal(networkAttempts, 0)
})

async function fixture(t: TestContext) {
  const dir = await mkdtemp(join(tmpdir(), 'openrouter-luna-'))
  t.after(() => rm(dir, { recursive: true, force: true }))
  const repo = join(dir, 'source')
  const useDirectory = join(dir, 'use')
  const lockfile = "lockfileVersion: '9.0'\n"
  await mkdir(join(repo, 'Backend/node_modules/.pnpm'), { recursive: true })
  await mkdir(join(repo, 'Backend/src'))
  await mkdir(useDirectory, { mode: 0o700 })
  const rawSource = join(repo, 'Backend/src/index.ts')
  await writeFile(rawSource, '// synthetic source\n')
  await writeFile(join(repo, '.gitignore'), 'node_modules/\n')
  await writeFile(join(repo, 'Backend/pnpm-lock.yaml'), lockfile)
  await writeFile(join(repo, 'Backend/node_modules/.pnpm/lock.yaml'), lockfile)
  const git = async (...args: string[]) => (await exec('git', args, { cwd: repo, windowsHide: true })).stdout.trim()
  await git('init', '-q')
  await git('add', '.')
  await git('-c', 'user.name=Fixture', '-c', 'user.email=canary@example.invalid', '-c', 'commit.gpgsign=false', 'commit', '-qm', 'synthetic')
  const sourceRevision = await git('rev-parse', 'HEAD')
  const integrity = await inspectCanarySource(repo, sourceRevision)
  assert.deepEqual(integrity.issues, [])
  const manifest = externalCanaryManifestSchema.parse({
    ...candidate, purpose: 'synthetic_rehearsal', sourceRevision,
    pricing: {
      modelId: model, providerId: 'azure', currency: 'USD', source: 'https://fixture.example.invalid/rates',
      confirmedAt: validity.verifiedAt, inputUsdPerMillionTokens: 0.15, outputUsdPerMillionTokens: 0.60,
    },
  })
  const manifestFingerprint = fingerprintExternalCanaryManifest(manifest)
  const { privateKey, publicKey } = generateKeyPairSync('ed25519')
  const payload: CanaryApprovalPayload = {
    version: 1, authorizationId: 'synthetic-luna-approval', useId: randomBytes(16).toString('hex'),
    experimentId: manifest.experimentId, manifestFingerprint, dataset: manifest.dataset, scenarioIds: manifest.scenarioIds,
    modelId: model, providerId: 'azure', approvedBudgetUsd: 1, sourceRevision,
    worktreeFingerprint: integrity.worktreeFingerprint!, dependenciesFingerprint: integrity.dependenciesFingerprint!,
    authorityId: 'synthetic-authority', approverId: 'synthetic-reviewer',
    scope: 'synthetic_canary_once', issuedAt: new Date(start).toISOString(), expiresAt: validity.validUntil,
    providerSpendLimit: { origin: 'synthetic_fixture', providerId: 'azure', manifestFingerprint, limitUsd: 1, ...validity },
    openRouterEvidence: {
      routingDecision: { scope: 'azure_family_fictional_data_only', ...validity },
      privacy: { zdrOnly: true, safetyRetention: false, dataCollection: 'deny', ...validity },
      account: {
        keyFingerprint: `sha256:${createHash('sha256').update(credential).digest('hex')}`, availableCreditsUsd: 1,
        limitReset: null, autoTopUp: false, dedicatedKey: true, byok: false, ...validity,
      },
      pricing: {
        variantsAndCacheReviewed: true, tokenPricingOnly: true, maximumPromptUsdPerMillion: 0.12,
        maximumCacheReadUsdPerMillion: 0.012, maximumCacheWriteUsdPerMillion: 0.15, maximumOutputUsdPerMillion: 0.60,
        ...validity,
      },
    },
  }
  const signed = (overrides: Partial<CanaryApprovalPayload> = {}) => {
    const value = { ...payload, ...overrides }
    return { payload: value, signature: sign(null, canaryApprovalSigningBytes(value), privateKey).toString('base64url') }
  }
  const deps = {
    fixtureRoot: repo, useStore: new CanaryAuthorizationUseStore(useDirectory), credentialAvailable: true, now: () => start,
    authorities: new Map([[payload.authorityId, { publicKey, approverId: payload.approverId, scope: payload.scope }]]),
  }
  const input = { manifest, approval: signed(), review: { manifestFingerprint, attestations: [...externalCanaryReviewItems] } }
  return { input, deps, signed, payload, rawSource }
}

const keyMetadata = {
  limit: 1, limit_reset: null, limit_remaining: 1, is_free_tier: false, is_management_key: false, is_provisioning_key: false,
}
const account = (overrides: Record<string, unknown> = {}) => Response.json({ data: { ...keyMetadata, ...overrides } })
const clarification = () => Response.json({
  ...syntheticCompletion('Seu couro cabeludo costuma ser seco ou oleoso?', {
    model, usage: { prompt_tokens: 300, completion_tokens: 20, total_tokens: 320 },
  }),
  provider: 'Azure',
})
const toolRequest = () => Response.json({
  ...syntheticCompletion(null, {
    model, toolCalls: [functionCall('search_products', { query: 'anticaspa', category: 'shampoos', limit: 1 })],
  }),
  provider: 'azure',
})

test('entradas públicas ficam inativas sem provisionamento e live genérico continua bloqueado', async () => {
  for (const run of [verifyOpenRouterLunaCanary, executeOpenRouterLunaCanary]) {
    const report = await run({ manifest: candidate })
    for (const code of ['LIVE_EXECUTION_DISABLED', 'APPROVAL_AUTHORITY_UNCONFIGURED', 'MANIFEST_INVALID',
      'ISOLATED_ENVIRONMENT_UNVERIFIED', 'ROUTING_FAMILY_DECISION_REQUIRED', 'PRIVACY_EVIDENCE_REQUIRED',
      'PROVIDER_ACCOUNT_LIMIT_UNVERIFIED', 'PRICE_REVALIDATION_REQUIRED']) assert(report.blockers.includes(code), code)
    assert.equal(report.credential, 'not_checked')
    assert.equal(report.networkAllowed, false)
    assert.equal(report.realInferenceAttempts, 0)
  }
  await assert.rejects(runLiveExternalEval(), { code: 'LIVE_EXTERNAL_DISABLED' })
})

test('rejeita assinatura, evidências, credencial e integridade inválidas antes de transporte e consumo', async (t) => {
  const { input, deps, signed, payload, rawSource } = await fixture(t)
  const evidence = payload.openRouterEvidence!
  const transport = createInMemoryOpenRouterTransport(async () => assert.fail('Transporte inesperado'))
  for (const [code, approval, overrides] of [
    ['APPROVAL_AUTHORITY_UNCONFIGURED', input.approval, { authorities: new Map() }],
    ['APPROVAL_INVALID', undefined, {}],
    ['APPROVAL_INVALID', { ...input.approval, signature: 'A'.repeat(86) }, {}],
    ['PRIVACY_EVIDENCE_REQUIRED', signed({ openRouterEvidence: { ...evidence, privacy: undefined } }), {}],
    ['ROUTING_FAMILY_DECISION_REQUIRED', signed({ openRouterEvidence: { ...evidence, routingDecision: undefined } }), {}],
    ['PROVIDER_ACCOUNT_LIMIT_UNVERIFIED', signed({ openRouterEvidence: { ...evidence, account: undefined } }), {}],
    ['PROVIDER_ACCOUNT_LIMIT_UNVERIFIED', signed({ openRouterEvidence: { ...evidence, account: { ...evidence.account!, availableCreditsUsd: 0.0001 } } }), {}],
    ['PRICE_REVALIDATION_REQUIRED', signed({ openRouterEvidence: { ...evidence, pricing: { ...evidence.pricing!, maximumCacheWriteUsdPerMillion: 0.16 } } }), {}],
    ['APPROVAL_DEPENDENCIES_MISMATCH', signed({ dependenciesFingerprint: `sha256:${'a'.repeat(64)}` }), {}],
    ['CREDENTIAL_UNAVAILABLE', input.approval, { credentialAvailable: false }],
    ['CREDENTIAL_UNAVAILABLE', signed({ openRouterEvidence: { ...evidence, account: { ...evidence.account!, keyFingerprint: `sha256:${'a'.repeat(64)}` } } }), {}],
  ] as const) {
    const report = await rehearseOpenRouterLunaCanary({ ...input, approval }, { ...deps, ...overrides, transport })
    assert(report.blockers.includes(code), code)
    assert.equal(report.accountCheckAttempts, 0)
    assert.equal(await deps.useStore.status(payload.useId), 'available')
  }
  await writeFile(rawSource, '// altered since approval\n')
  const report = await rehearseOpenRouterLunaCanary(input, { ...deps, transport })
  assert(report.blockers.includes('DIRTY_WORKTREE'))
  assert.equal(report.accountCheckAttempts, 0)
})

test('duas chamadas, revalidação da chave e consumo único concorrente, sem transcrição', async (t) => {
  const { input, deps, payload } = await fixture(t)
  const order: string[] = []
  const observed: string[] = []
  const observe = async (message: string) => { observed.push(message) }
  const transport = createInMemoryOpenRouterTransport(async (url, init) => {
    assert.equal(await deps.useStore.status(payload.useId), 'consumed')
    assert.equal(new Headers(init?.headers).get('authorization'), `Bearer ${credential}`)
    assert.equal(init?.redirect, 'error')
    order.push(init!.method!)
    if (init?.method === 'GET') {
      assert.equal(String(url), 'https://openrouter.ai/api/v1/key')
      assert.equal(init.body, undefined)
      return account()
    }
    assert.equal(String(url), OPENROUTER_CHAT_COMPLETIONS_ENDPOINT)
    const body = JSON.parse(String(init?.body))
    assert.equal(body.model, model)
    assert.equal(body.reasoning_effort, 'none')
    assert.equal(body.service_tier, 'default')
    assert.equal(body.stream, false)
    assert.equal(body.max_completion_tokens, 512)
    assert.deepEqual(body.provider, {
      only: ['azure'], order: ['azure'], zdr: true, data_collection: 'deny', allow_fallbacks: false, require_parameters: true,
    })
    assert.equal(Object.hasOwn(body, 'models'), false)
    return order.length === 2 ? toolRequest() : clarification()
  })
  const results = await Promise.all([
    rehearseOpenRouterLunaCanary(input, { ...deps, transport, observe }),
    rehearseOpenRouterLunaCanary(input, { ...deps, transport, observe }),
  ])
  assert.deepEqual(order, ['GET', 'POST', 'GET', 'POST'])
  const complete = results.find((report) => report.completionAttempts === 2)!
  assert.deepEqual(complete.blockers, [])
  assert.equal(complete.execution?.execution.toolsExecuted, 1)
  assert.equal(complete.execution?.assertions.passed, 4)
  assert.equal(complete.financial.estimatedReservationUsd, 0.008268)
  assert.equal(complete.realInferenceAttempts, 0)
  assert.equal(complete.endpointIdentity, 'unverified')
  assert.equal(complete.providerFamilyObserved, true)
  assert.equal(observed.length, 1)
  assert.match(observed[0]!, /couro cabeludo/i)
  const output = JSON.stringify(complete)
  assert(!output.includes(credential))
  assert(!output.includes('Estou procurando um shampoo'))
  assert(!output.includes('Seu couro cabeludo'))
  assert(results.some((report) => report.blockers.includes('AUTHORIZATION_ALREADY_CONSUMED')))
})

test('revalida evidência e integridade após a verificação da chave, antes do POST', async (t) => {
  const { input, deps, rawSource, payload, signed } = await fixture(t)
  const afterExpiry = Date.parse('2026-01-02T01:00:00Z')
  let now = start
  const evidence = payload.openRouterEvidence!
  const report = await rehearseOpenRouterLunaCanary({
    ...input, approval: signed({
      openRouterEvidence: { ...evidence, privacy: { ...evidence.privacy!, validUntil: new Date(afterExpiry).toISOString() } },
    }),
  }, { ...deps, now: () => now, transport: createInMemoryOpenRouterTransport(async (_, init) => {
    assert.equal(init?.method, 'GET')
    now = afterExpiry
    return account()
  }) })
  assert(report.blockers.includes('PRIVACY_EVIDENCE_REQUIRED'))
  assert.equal(report.completionAttempts, 0)
  const authorities = new Map(deps.authorities)
  const revoked = await rehearseOpenRouterLunaCanary({
    ...input, approval: signed({ useId: randomBytes(16).toString('hex') }),
  }, { ...deps, authorities, transport: createInMemoryOpenRouterTransport(async (_, init) => {
    assert.equal(init?.method, 'GET')
    authorities.clear()
    return account()
  }) })
  assert(revoked.blockers.includes('APPROVAL_INVALID'))
  assert.equal(revoked.completionAttempts, 0)
  const changed = await rehearseOpenRouterLunaCanary({
    ...input, approval: signed({ useId: randomBytes(16).toString('hex') }),
  }, { ...deps, transport: createInMemoryOpenRouterTransport(async (_, init) => {
    assert.equal(init?.method, 'GET')
    await writeFile(rawSource, '// changed during the account request\n')
    return account()
  }) })
  assert(changed.blockers.includes('APPROVAL_SOURCE_MISMATCH'))
  assert.equal(changed.completionAttempts, 0)
})

test('recusa chave com reset ou saldo insuficiente e para sem retry se a primeira resposta falhar', async (t) => {
  const { input, deps, signed } = await fixture(t)
  const cases: Array<{ code: string; key?: () => Response; response?: () => Response }> = [
    { code: 'KEY_CONFIGURATION_UNVERIFIED', key: () => account({ limit_reset: 'daily' }) },
    { code: 'KEY_CONFIGURATION_UNVERIFIED', key: () => account({ limit: 2 }) },
    { code: 'KEY_BALANCE_INSUFFICIENT', key: () => account({ limit_remaining: 0.0001 }) },
    { code: 'KEY_BALANCE_INSUFFICIENT', key: () => account({ effective_budget: { remaining_usd: 0.0001 } }) },
    { code: 'PROVIDER_FAMILY_UNVERIFIED', response: () => Response.json(syntheticCompletion(null, { model,
      toolCalls: [functionCall('search_products', { query: 'anticaspa' })],
    })) },
    { code: 'MODEL_IDENTITY_MISMATCH', response: () => Response.json({
      ...syntheticCompletion('x', { model: 'openai/gpt-6-luna-pro' }), provider: 'azure',
    }) },
    { code: 'TECHNICAL_FAILURE', response: () => new Response(credential, { status: 503 }) },
  ]
  for (const { code, key, response } of cases) {
    const report = await rehearseOpenRouterLunaCanary({
      ...input, approval: signed({ useId: randomBytes(16).toString('hex') }),
    }, { ...deps, transport: createInMemoryOpenRouterTransport(async (_, init) =>
      init?.method === 'GET' ? key?.() ?? account() : response!(),
    ) })
    assert(report.blockers.includes(code), code)
    assert.equal(report.accountCheckAttempts, 1)
    assert.equal(report.completionAttempts, key ? 0 : 1)
    assert(!JSON.stringify(report).includes(credential))
  }
  let keyChecks = 0
  const secondCheck = await rehearseOpenRouterLunaCanary({
    ...input, approval: signed({ useId: randomBytes(16).toString('hex') }),
  }, { ...deps, transport: createInMemoryOpenRouterTransport(async (_, init) =>
    init?.method === 'GET' ? (++keyChecks === 1 ? account() : account({ limit_remaining: 0 })) : toolRequest(),
  ) })
  assert(secondCheck.blockers.includes('KEY_BALANCE_INSUFFICIENT'))
  assert.equal(secondCheck.accountCheckAttempts, 2)
  assert.equal(secondCheck.completionAttempts, 1)
})

test('cancelamento antes do envio e timeout do GET nunca alcançam chat/completions', async (t) => {
  const { input, deps, signed, payload } = await fixture(t)
  const cancel = new AbortController()
  cancel.abort()
  const cancelled = await rehearseOpenRouterLunaCanary(input, {
    ...deps, signal: cancel.signal, transport: createInMemoryOpenRouterTransport(async () => assert.fail('Transporte inesperado')),
  })
  assert(cancelled.blockers.includes('OPERATOR_CANCELLED'))
  assert.equal(await deps.useStore.status(payload.useId), 'available')
  const timedOut = await rehearseOpenRouterLunaCanary({
    ...input, approval: signed({ useId: randomBytes(16).toString('hex') }),
  }, { ...deps, transport: createInMemoryOpenRouterTransport(async (_, init) => {
    assert.equal(init?.method, 'GET')
    return new Promise(() => {})
  }) })
  assert(timedOut.blockers.includes('CANARY_TIMEOUT'), JSON.stringify(timedOut.blockers))
  assert.equal(timedOut.accountCheckAttempts, 1)
  assert.equal(timedOut.completionAttempts, 0)
})
