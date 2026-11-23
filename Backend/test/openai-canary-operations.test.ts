import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { generateKeyPairSync, randomBytes, sign } from 'node:crypto'
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { after, before, test, type TestContext } from 'node:test'
import { promisify } from 'node:util'

import { registerInMemoryChatTransport } from '../src/agent/in-memory-chat-transport.js'
import type { CanaryAuthority } from '../src/evals/external-canary-approval.js'
import { inspectCanarySource } from '../src/evals/external-canary-integrity.js'
import { CanaryAuthorizationUseStore } from '../src/evals/external-canary-use-store.js'
import { runLiveExternalEval } from '../src/evals/external-eval-runner.js'
import {
  fingerprintOpenAiCanaryManifest, openAiCanaryApprovalSigningBytes, openAiCanaryManifestSchema,
  type OpenAiCanaryApproval,
} from '../src/evals/openai-canary-contract.js'
import { executeOpenAiCanary, rehearseOpenAiCanaryGate, verifyOpenAiCanary } from '../src/evals/openai-canary-operations.js'
import { functionCall, syntheticCompletion } from './fixtures/openai-direct-synthetic.js'

const candidate = JSON.parse(await readFile(new URL(
  '../evals/canary/gpt-6-luna-openai-operational-candidate.v1.json', import.meta.url,
), 'utf8')) as Record<string, unknown>
const exec = promisify(execFile)
const originalFetch = globalThis.fetch
let networkAttempts = 0
before(() => {
  globalThis.fetch = async () => {
    networkAttempts += 1
    throw new Error('A suíte é offline.')
  }
})
after(() => {
  globalThis.fetch = originalFetch
  assert.equal(networkAttempts, 0)
})

async function setup(t: TestContext) {
  const directory = await mkdtemp(join(tmpdir(), 'openai-canary-fixture-'))
  t.after(() => rm(directory, { recursive: true, force: true }))
  const fixtureRoot = join(directory, 'runtime')
  const storePath = join(directory, 'authorizations')
  const lockfile = "lockfileVersion: '9.0'\n"
  await mkdir(join(fixtureRoot, 'Backend/node_modules/.pnpm'), { recursive: true })
  await mkdir(join(fixtureRoot, 'Backend/src'))
  await mkdir(storePath)
  await writeFile(join(fixtureRoot, '.gitignore'), 'node_modules/\n')
  await writeFile(join(fixtureRoot, 'Backend/src/index.ts'), '// código sintético\n')
  await writeFile(join(fixtureRoot, 'Backend/pnpm-lock.yaml'), lockfile)
  await writeFile(join(fixtureRoot, 'Backend/node_modules/.pnpm/lock.yaml'), lockfile)
  const git = async (...args: string[]) => (await exec('git', args, { cwd: fixtureRoot, windowsHide: true })).stdout.trim()
  await git('init', '-q')
  await git('add', '.')
  await git('-c', 'user.name=Canary Fixture', '-c', 'user.email=canary@example.invalid', '-c', 'commit.gpgsign=false', 'commit', '-qm', 'synthetic')
  const sourceRevision = await git('rev-parse', 'HEAD')
  const source = await inspectCanarySource(fixtureRoot, sourceRevision)
  assert.deepEqual(source.issues, [])

  const manifest = openAiCanaryManifestSchema.parse({
    ...candidate, purpose: 'synthetic_rehearsal', sourceRevision,
  })
  const { publicKey, privateKey } = generateKeyPairSync('ed25519')
  const now = Date.parse('2026-11-23T16:00:00Z')
  const projectId = 'proj_synthetic_openai_test'
  const validity = { verifiedAt: '2026-11-23T14:00:00Z', validUntil: '2026-11-23T18:00:00Z' }
  const payload: OpenAiCanaryApproval = {
    version: 1, authorizationId: 'synthetic-authorization', useId: randomBytes(16).toString('hex'),
    authorityId: 'fixture-authority', approverId: 'fixture-reviewer', scope: 'openai_direct_fixture_once',
    experimentId: manifest.experimentId, manifestFingerprint: fingerprintOpenAiCanaryManifest(manifest),
    dataset: manifest.dataset, scenarioIds: manifest.scenarioIds, modelId: manifest.modelId, providerId: manifest.providerId,
    approvedBudgetUsd: 1, sourceRevision, worktreeFingerprint: source.worktreeFingerprint!,
    dependenciesFingerprint: source.dependenciesFingerprint!, projectId, isolation: manifest.environment,
    issuedAt: '2026-11-23T15:00:00Z', expiresAt: '2026-11-23T17:00:00Z',
    providerSpendLimit: { ...validity, enforcement: 'hard_limit', projectId, limitUsd: 1, availableUsd: 1 },
    retentionDecision: { ...validity, projectId, policy: 'standard_abuse_monitoring_explicitly_accepted',
      dataScope: 'approved_fictional_only', transcriptPersistence: 'disabled' },
    pricingReview: validity,
  }
  function signed(overrides: Partial<OpenAiCanaryApproval> = {}) {
    const value = { ...payload, ...overrides }
    return { payload: value, signature: sign(null, openAiCanaryApprovalSigningBytes(value), privateKey).toString('base64url') }
  }
  const authorities = new Map<string, CanaryAuthority>([[payload.authorityId, { publicKey, approverId: payload.approverId, scope: payload.scope }]])
  return { manifest, projectId, storePath, payload, signed, now, options: {
    fixtureRoot, projectId, authorities, useStore: new CanaryAuthorizationUseStore(storePath), credentialAvailable: true, now: () => now,
  } }
}

test('operação e CLI de verificação partem bloqueadas, sem completar o manifesto', async () => {
  const report = await verifyOpenAiCanary({ manifest: candidate })
  assert.equal(report.preflight, 'blocked')
  assert.equal(report.manifestFingerprint, undefined)
  assert.equal(report.financial.estimatedReservationUsd, 0.00564)
  assert.equal(report.experimentAuthorized, false)
  assert.equal(report.realInferenceAttempts, 0)
  for (const blocker of ['LIVE_EXECUTION_DISABLED', 'APPROVAL_REQUIRED', 'DATA_RETENTION_APPROVAL_REQUIRED', 'SOURCE_REVISION_PENDING', 'PRICE_REVALIDATION_REQUIRED']) {
    assert(report.blockers.includes(blocker), blocker)
  }
  const attempted = await executeOpenAiCanary({ manifest: candidate })
  assert.equal(attempted.transportAttempts, 0)
  assert.equal(attempted.financial.actualCharge, 'none_attempted')
  await assert.rejects(runLiveExternalEval(), { code: 'LIVE_EXTERNAL_DISABLED' })
})

test('requisitos independentes falham antes do transporte e sem consumir a autorização', async (t) => {
  const { manifest, signed, payload, options, storePath } = await setup(t)
  let calls = 0
  const transport = registerInMemoryChatTransport(async () => { calls += 1; return Response.json({}) })
  const approval = signed()
  const manifestAtOtherRevision = { ...manifest, sourceRevision: '0'.repeat(40) }
  const overpriced = { ...manifest, pricing: { ...manifest.pricing, inputUsdPerMillionTokens: 100 } }
  const cases = [
    { name: 'sem autorização', approval: undefined, code: 'APPROVAL_REQUIRED' },
    { name: 'assinatura inválida', approval: { ...approval, signature: 'A'.repeat(86) }, code: 'APPROVAL_INVALID' },
    { name: 'expirada', approval: signed({ expiresAt: '2026-11-23T15:59:00Z' }), code: 'APPROVAL_NOT_CURRENT' },
    { name: 'fingerprint divergente', approval: signed({ manifestFingerprint: `sha256:${'f'.repeat(64)}` }), code: 'APPROVAL_FINGERPRINT_MISMATCH' },
    { name: 'código divergente', approval: signed({ sourceRevision: manifestAtOtherRevision.sourceRevision,
      manifestFingerprint: fingerprintOpenAiCanaryManifest(manifestAtOtherRevision) }), manifest: manifestAtOtherRevision, code: 'SOURCE_REVISION_MISMATCH' },
    { name: 'retenção pendente', approval: signed({ retentionDecision: undefined }), code: 'DATA_RETENTION_APPROVAL_REQUIRED' },
    { name: 'teto ausente', approval: signed({ providerSpendLimit: undefined }), code: 'EXTERNAL_HARD_LIMIT_UNVERIFIED' },
    { name: 'apenas alerta', approval: signed({ providerSpendLimit: { ...payload.providerSpendLimit!, enforcement: 'alert_only' } }), code: 'EXTERNAL_HARD_LIMIT_UNVERIFIED' },
    { name: 'saldo externo insuficiente', approval: signed({ providerSpendLimit: { ...payload.providerSpendLimit!, availableUsd: 0.001 } }), code: 'EXTERNAL_HARD_LIMIT_UNVERIFIED' },
    { name: 'tarifa não revalidada', approval: signed({ pricingReview: undefined }), code: 'PRICE_REVALIDATION_REQUIRED' },
    { name: 'reserva maior que orçamento', approval: signed({ manifestFingerprint: fingerprintOpenAiCanaryManifest(overpriced) }), manifest: overpriced, code: 'ESTIMATED_COST_EXCEEDS_BUDGET' },
    { name: 'credencial indisponível', approval, credentialAvailable: false, code: 'CREDENTIAL_UNAVAILABLE' },
    { name: 'registro indisponível', approval, useStore: new CanaryAuthorizationUseStore(join(storePath, 'missing')), code: 'AUTHORIZATION_STORE_UNAVAILABLE' },
  ] as const
  for (const example of cases) {
    const report = await rehearseOpenAiCanaryGate({ manifest: 'manifest' in example ? example.manifest : manifest, approval: example.approval }, {
      ...options, transport, ...('credentialAvailable' in example ? { credentialAvailable: example.credentialAvailable } : {}),
      ...('useStore' in example ? { useStore: example.useStore } : {}),
    })
    assert.equal(report.preflight, 'blocked', example.name)
    assert(report.blockers.includes(example.code), `${example.name} ${JSON.stringify(report.blockers)}`)
    assert.equal(report.transportAttempts, 0, example.name)
    if (example.name === 'retenção pendente') assert.equal(report.checks.financialLimitVerified, true)
    if (example.name === 'teto ausente') assert.equal(report.checks.retentionApproved, true)
  }
  assert.equal(calls, 0)
  assert.deepEqual(await readdir(storePath), [])
  const operational = await executeOpenAiCanary({ manifest: { ...manifest, purpose: 'external_candidate' }, approval })
  assert(operational.blockers.includes('LIVE_EXECUTION_DISABLED'))
  assert.equal(operational.transportAttempts, 0)
  assert.throws(() => rehearseOpenAiCanaryGate({ manifest, approval }, { ...options, transport: globalThis.fetch }), /em memória/)
})

test('consumo único concorrente, autenticação em memória e relatório sanitizado', async (t) => {
  const { manifest, signed, options, storePath, projectId, now } = await setup(t)
  const approval = signed()
  const content = 'Você procura algo para qual necessidade? sk-synthetic-test-response'
  let calls = 0
  const transport = registerInMemoryChatTransport(async (url, init) => {
    calls += 1
    assert.equal(url, manifest.generation.endpoint)
    assert.equal(init?.redirect, 'error')
    const headers = new Headers(init?.headers)
    assert.equal(headers.get('Authorization'), 'Bearer synthetic-canary-credential')
    assert.equal(headers.get('OpenAI-Project'), projectId)
    const body = JSON.parse(String(init?.body))
    assert.equal(body.model, manifest.modelId)
    assert.equal(body.max_completion_tokens, 512)
    assert.equal(body.reasoning_effort, 'none')
    assert.equal(body.store, false)
    assert.equal(body.stream, false)
    assert.equal('provider' in body, false)
    return Response.json(syntheticCompletion(content, { id: 'synthetic-generation-sensitive' }))
  })
  const run = () => rehearseOpenAiCanaryGate({ manifest, approval }, { ...options, transport })
  const outcomes = await Promise.all([run(), run()])
  assert.equal(calls, 1)
  const success = outcomes.find((item) => item.transportAttempts === 1)
  assert.equal(success?.execution?.execution.technicalStatus, 'completed', JSON.stringify(outcomes.map((item) => item.blockers)))
  assert.equal(success.realInferenceAttempts, 0)
  assert.equal(success.experimentAuthorized, false)
  assert.equal(success.execution?.consumption.chargedCostUsd, 0.00282)
  assert.equal(outcomes.filter((item) => item.blockers.includes('AUTHORIZATION_ALREADY_CONSUMED')).length, 1)
  assert((await run()).blockers.includes('AUTHORIZATION_ALREADY_CONSUMED'))
  assert.equal((await readdir(storePath)).length, 1)
  const serialized = JSON.stringify(success)
  for (const forbidden of [content, 'sk-synthetic-test-response', 'synthetic-generation-sensitive', 'synthetic-canary-credential', approval.signature, approval.payload.useId, projectId]) {
    assert.equal(serialized.includes(forbidden), false)
  }
  let readings = 0
  const expiredBeforeTransport = await rehearseOpenAiCanaryGate({
    manifest, approval: signed({ useId: randomBytes(16).toString('hex') }),
  }, { ...options, transport, now: () => readings++ === 0 ? now : now + 3_600_000 })
  assert(expiredBeforeTransport.blockers.includes('APPROVAL_EVIDENCE_EXPIRED_BEFORE_TRANSPORT'))
  assert.equal(expiredBeforeTransport.authorization.use, 'consumed')
  assert.equal(expiredBeforeTransport.transportAttempts, 0)
  assert.equal(expiredBeforeTransport.execution?.consumption.chargedCostUsd, 0)
  assert.equal(calls, 1)
})

test('falhas, cancelamento, limite de chamadas e excesso de reserva interrompem o ensaio', async (t) => {
  const { manifest, signed, options } = await setup(t)
  const controller = new AbortController()
  let serial = 0
  const cases: Array<{ title: string; build: () => Response | Promise<Response>; expectedCalls: number;
    signal?: AbortSignal; code?: string; modelStatus?: string }> = [
    { title: 'modelo divergente', build: () => Response.json(syntheticCompletion('Resposta sintética.', { model: 'wrong-model' })), expectedCalls: 1, code: 'MODEL_IDENTITY_MISMATCH' },
    { title: 'erro HTTP', build: () => new Response('sk-synthetic-secret-error', { status: 503 }), expectedCalls: 1, code: 'TECHNICAL_FAILURE' },
    { title: 'cancelamento prévio', build: () => Response.json({}), expectedCalls: 0, signal: AbortSignal.abort(), code: 'OPERATOR_CANCELLED' },
    { title: 'cancelamento em voo', build: () => { controller.abort(); return new Promise<Response>(() => undefined) }, expectedCalls: 1, signal: controller.signal, code: 'OPERATOR_CANCELLED' },
    { title: 'timeout', build: () => new Promise<Response>(() => undefined), expectedCalls: 1, code: 'TECHNICAL_FAILURE', modelStatus: 'timeout' },
    { title: 'duas chamadas', build: () => Response.json(syntheticCompletion(null, { toolCalls: [functionCall('search_products', { query: `shampoo ${++serial}`, limit: 1 }, `call-search-${serial}`)] })), expectedCalls: 2 },
    { title: 'excesso de reserva', build: () => Response.json(syntheticCompletion(null, { toolCalls: [functionCall('search_products', { query: 'shampoo', limit: 1 })],
      usage: { prompt_tokens: 45_000, completion_tokens: 10, total_tokens: 45_010 } })), expectedCalls: 1, code: 'USAGE_EXCEEDED_RESERVATION' },
  ]
  for (const example of cases) {
    await t.test(example.title, async () => {
      let calls = 0
      const approval = signed({ useId: randomBytes(16).toString('hex') })
      const report = await rehearseOpenAiCanaryGate({ manifest, approval }, {
        ...options, signal: example.signal, transport: registerInMemoryChatTransport(async () => { calls += 1; return example.build() }),
      })
      assert.equal(calls, example.expectedCalls, JSON.stringify({ blockers: report.blockers, execution: report.execution?.execution }))
      assert.equal(report.realInferenceAttempts, 0)
      assert.equal(report.authorization.use, calls === 0 ? 'available' : 'consumed')
      if (example.code) assert(report.blockers.includes(example.code), JSON.stringify(report.blockers))
      if (example.modelStatus) assert(report.execution?.modelCalls.some(({ status }) => status === example.modelStatus))
      if (calls === 2) assert(report.execution?.execution.limitsReached.includes('max_model_calls'))
      assert.doesNotMatch(JSON.stringify(report), /sk-synthetic-secret-error/)
    })
  }
})
