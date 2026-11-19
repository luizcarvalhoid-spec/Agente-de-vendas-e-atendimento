import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { generateKeyPairSync, randomBytes, sign } from 'node:crypto'
import { cp, mkdir, mkdtemp, readFile, readdir, realpath, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { after, before, test } from 'node:test'
import { pathToFileURL } from 'node:url'
import { promisify } from 'node:util'

import { AgentModelError } from '../src/agent/agent-model-port.js'
import { canaryApprovalSigningBytes, type CanaryApprovalPayload } from '../src/evals/external-canary-approval.js'
import { fingerprintEvalValue } from '../src/evals/eval-baseline.js'
import { inspectCanarySource } from '../src/evals/external-canary-integrity.js'
import {
  renderCanaryOperationalMarkdown,
  serializeCanaryOperationalReport,
  writeCanaryOperationalReports,
} from '../src/evals/external-canary-operational-report.js'
import {
  createSyntheticCanaryCredentialSource,
  rehearseCanaryActivation,
  rehearseCanaryFixtureActivation,
  verifyCanaryFixtureOperations,
  verifyCanaryOperations,
} from '../src/evals/external-canary-operations.js'
import { externalCanaryManifestSchema, externalCanaryReviewItems } from '../src/evals/external-canary-schema.js'
import { CanaryAuthorizationUseStore } from '../src/evals/external-canary-use-store.js'
import { fingerprintExternalCanaryManifest } from '../src/evals/external-canary.js'
import { ExternalEvalCostController } from '../src/evals/external-eval-cost.js'
import { createInMemoryOpenRouterTransport, runLiveExternalEval } from '../src/evals/external-eval-runner.js'

const exec = promisify(execFile)
const backend = resolve(import.meta.dirname, '..')
const now = Date.parse('2026-01-02T00:00:00Z')
const fakeKey = 'sk-or-operational-fixture-never-exposed'
const fakePrompt = 'Marcador fictício de mensagem bruta'
const originalFetch = globalThis.fetch
let networkCalls = 0
before(() => {
  globalThis.fetch = async () => {
    networkCalls += 1
    throw new Error('Fetch externo proibido no teste')
  }
})
after(() => {
  globalThis.fetch = originalFetch
  assert.equal(networkCalls, 0)
})

const candidate = JSON.parse(await readFile(join(backend, 'evals/canary/first-external-candidate.v1.json'), 'utf8'))
const lock = "lockfileVersion: '9.0'\n"
const modelId = 'mock/operations'
const providerId = 'mock-operations'

async function git(cwd: string, ...args: string[]) {
  return (await exec('git', args, { cwd, windowsHide: true })).stdout.trim()
}

async function installSyntheticFiles(repositoryRoot: string) {
  const dependencies = join(repositoryRoot, 'Backend/node_modules')
  await mkdir(join(dependencies, '.pnpm'), { recursive: true })
  await mkdir(join(dependencies, 'fixture'))
  await writeFile(join(dependencies, '.pnpm/lock.yaml'), lock)
  await writeFile(join(dependencies, 'fixture/index.js'), '// dependency fixture v1\n')
}

async function fixture(t: { after(callback: () => Promise<void>): void }, timeoutMs = 2_000) {
  const directory = await mkdtemp(join(tmpdir(), 'canary-operations-'))
  t.after(() => rm(directory, { recursive: true, force: true }))
  const repositoryRoot = join(directory, 'repo')
  await mkdir(join(repositoryRoot, 'Backend/src'), { recursive: true })
  await git(repositoryRoot, 'init', '-q')
  await writeFile(join(repositoryRoot, '.gitignore'), 'node_modules/\n.env\n')
  await writeFile(join(repositoryRoot, 'Backend/src/index.ts'), '// tracked code fixture\n')
  await writeFile(join(repositoryRoot, 'Backend/pnpm-lock.yaml'), lock)
  await git(repositoryRoot, 'add', '.')
  await git(repositoryRoot, '-c', 'user.name=Canary Fixture', '-c', 'user.email=canary@example.invalid',
    '-c', 'commit.gpgsign=false', 'commit', '-qm', 'synthetic canary source')
  const sourceRevision = await git(repositoryRoot, 'rev-parse', 'HEAD')
  await installSyntheticFiles(repositoryRoot)
  const integrity = await inspectCanarySource(repositoryRoot, sourceRevision)
  assert.deepEqual(integrity.issues, [])

  const manifest = externalCanaryManifestSchema.parse({
    ...candidate,
    experimentId: 'operations-fixture',
    purpose: 'synthetic_rehearsal',
    modelId,
    routing: {
      providerId, allowFallbacks: false, requireParameters: true,
      dataCollection: 'deny', zeroDataRetention: true,
    },
    limits: {
      maxModelCalls: 2, maxInputTokensPerCall: 20_000,
      maxOutputTokensPerCall: 512, maxExecutionTokens: 50_000,
      timeoutMs, effectiveTimeoutMs: timeoutMs,
    },
    pricing: {
      modelId, providerId, currency: 'USD',
      inputUsdPerMillionTokens: 1, outputUsdPerMillionTokens: 2,
      confirmedAt: '2025-12-31T00:00:00Z',
      source: 'https://prices.example.invalid/operational-fixture',
    },
    maxBudgetUsd: 1,
    unreportedUsageMultiplier: 1.25,
    outputDirectory: 'external-eval-reports/synthetic-operations',
    sourceRevision,
  })
  const manifestFingerprint = fingerprintExternalCanaryManifest(manifest)
  const review = { manifestFingerprint, attestations: [...externalCanaryReviewItems] }
  const { privateKey, publicKey } = generateKeyPairSync('ed25519')
  const payload: CanaryApprovalPayload = {
    version: 1,
    authorizationId: 'synthetic-authorization',
    useId: randomBytes(16).toString('hex'),
    experimentId: manifest.experimentId,
    manifestFingerprint,
    dataset: manifest.dataset,
    scenarioIds: manifest.scenarioIds,
    modelId,
    providerId,
    approvedBudgetUsd: manifest.maxBudgetUsd,
    sourceRevision,
    worktreeFingerprint: integrity.worktreeFingerprint!,
    dependenciesFingerprint: integrity.dependenciesFingerprint!,
    authorityId: 'synthetic-authority',
    approverId: 'synthetic-reviewer',
    issuedAt: '2026-01-01T00:00:00Z',
    expiresAt: '2026-01-03T00:00:00Z',
    scope: 'synthetic_canary_once',
    providerSpendLimit: {
      origin: 'synthetic_fixture', providerId, manifestFingerprint,
      limitUsd: 1, verifiedAt: '2025-12-31T00:00:00Z', validUntil: '2026-01-03T00:00:00Z',
    },
  }
  const signed = (overrides: Partial<CanaryApprovalPayload> = {}) => {
    const value = { ...payload, ...overrides }
    return { payload: value, signature: sign(null, canaryApprovalSigningBytes(value), privateKey).toString('base64url') }
  }
  const storeDirectory = join(directory, 'control')
  await mkdir(storeDirectory)
  const deps = {
    fixtureRoot: repositoryRoot,
    authorities: new Map([[payload.authorityId, { publicKey, approverId: payload.approverId, scope: payload.scope }]]),
    useStore: new CanaryAuthorizationUseStore(storeDirectory),
    credentials: createSyntheticCanaryCredentialSource(true),
    now: () => now,
  }
  const legacyApproval = {
    payload,
    signature: sign(null, Buffer.from(
      `hidrasplash/canary-approval/v1\n${fingerprintEvalValue(payload)}\n`,
    ), privateKey).toString('base64url'),
  }
  return { directory, storeDirectory, input: { manifest, review, approval: signed() }, deps, signed, payload, legacyApproval }
}

function syntheticTransport(options: { returnedModel?: string; provider?: string | null; highUsage?: boolean; status?: number } = {}) {
  let calls = 0
  const transport = createInMemoryOpenRouterTransport(async (_, init) => {
    calls += 1
    const request = JSON.parse(String(init?.body))
    assert.equal(request.model, modelId)
    assert.deepEqual(request.provider.only, [providerId])
    assert.equal(request.provider.allow_fallbacks, false)
    if (options.status !== undefined) return new Response(fakePrompt, { status: options.status })
    const input = options.highUsage ? 55_000 : 300
    return Response.json({
      id: fakeKey,
      model: options.returnedModel ?? modelId,
      ...(options.provider === null ? {} : { provider: options.provider ?? providerId }),
      created: 0,
      choices: [{
        index: 0,
        finish_reason: 'stop',
        message: { role: 'assistant', content: `Qual necessidade você quer resolver? ${fakePrompt}` },
      }],
      usage: { prompt_tokens: input, completion_tokens: 15, total_tokens: input + 15 },
    })
  })
  return { transport, get calls() { return calls } }
}

test('aprovação de teste autenticada permanece bloqueada para rede e verify não consome', async (t) => {
  const { input, deps, storeDirectory } = await fixture(t)
  const report = await verifyCanaryFixtureOperations(input, deps)
  const { sourceMatches, ...fixtureChecks } = report.checks
  assert.equal(sourceMatches, false)
  assert.equal(report.sourceKind, 'synthetic_fixture')
  assert.equal(report.source?.runtimeCommit, undefined)
  assert(Object.values(fixtureChecks).every(Boolean))
  assert.equal(report.source?.commit, input.manifest.sourceRevision)
  assert.equal(report.approval?.authorityId, 'synthetic-authority')
  assert.equal(report.authorizationUse, 'available')
  assert.equal(report.rehearsalEligible, true)
  assert.deepEqual(report.blockers, ['LIVE_EXECUTION_DISABLED'])
  assert.equal(report.networkAllowed, false)
  assert.equal(report.executionAllowed, false)
  assert.equal(report.experimentAuthorized, false)
  assert.equal(report.experimentExecuted, false)
  assert.deepEqual(await readdir(storeDirectory), [])
  await assert.rejects(runLiveExternalEval(), { code: 'LIVE_EXTERNAL_DISABLED' })
})

test('assinatura, autoridade, validade, plano e orçamento são verificados separadamente', async (t) => {
  const { input, deps, signed, legacyApproval } = await fixture(t)
  assert.match(canaryApprovalSigningBytes(input.approval.payload).toString(), /^agent-evals\/canary-approval\/v1\nsha256:/)
  for (const [approval, code] of [
    [legacyApproval, 'APPROVAL_INVALID'],
    [{ ...input.approval, payload: { ...input.approval.payload, approvedBudgetUsd: 2 } }, 'APPROVAL_INVALID'],
    [{ ...input.approval, signature: 'A'.repeat(86) }, 'APPROVAL_INVALID'],
    [signed({ authorityId: 'untrusted-authority' }), 'APPROVAL_INVALID'],
    [signed({ approverId: 'untrusted-approver' }), 'APPROVAL_INVALID'],
    [signed({ expiresAt: '2026-01-01T23:59:59Z' }), 'APPROVAL_EXPIRED'],
    [signed({ issuedAt: '2026-01-02T01:00:00Z' }), 'APPROVAL_NOT_YET_VALID'],
    [signed({ manifestFingerprint: `sha256:${'f'.repeat(64)}` }), 'APPROVAL_FINGERPRINT_MISMATCH'],
    [signed({ modelId: 'mock/different' }), 'CANARY_SCOPE_MISMATCH'],
    [signed({ approvedBudgetUsd: 2 }), 'APPROVAL_BUDGET_MISMATCH'],
  ] as const) {
    const report = await verifyCanaryFixtureOperations({ ...input, approval }, deps)
    assert(report.blockers.includes(code), code)
    assert.equal(report.rehearsalEligible, false)
  }
  const changed = await verifyCanaryFixtureOperations({
    ...input,
    manifest: {
      ...input.manifest,
      outputDirectory: 'external-eval-reports/other-destination',
      routing: { ...input.manifest.routing, dataCollection: 'allow' },
    },
  }, deps)
  assert(changed.blockers.includes('APPROVAL_FINGERPRINT_MISMATCH'))
  assert(changed.blockers.includes('MANIFEST_NOT_APPROVED'))
})

test('gate operacional rejeita checkout de fixture e não consome sua aprovação', async (t) => {
  const { input, deps, signed, storeDirectory } = await fixture(t)
  const root = resolve(backend, '..')
  const runtimeCommit = await git(root, 'rev-parse', 'HEAD')
  const expected = await inspectCanarySource(root, runtimeCommit)
  const controlled = syntheticTransport()
  // O chamador pode ter um objeto legado com repositoryRoot. Ele não escolhe a origem operacional.
  const legacyDeps = { ...deps, repositoryRoot: deps.fixtureRoot }
  const report = await rehearseCanaryActivation(input, legacyDeps, controlled)
  assert.equal(report.sourceKind, 'loaded_runtime')
  assert.equal(report.source?.runtimeCommit, runtimeCommit)
  assert.equal(report.source?.commit, runtimeCommit)
  assert.equal(report.source?.worktreeFingerprint, expected.worktreeFingerprint)
  assert.equal(report.checks.sourceMatches, false)
  assert.equal(report.checks.fixtureSourceMatches, undefined)
  assert(report.blockers.includes('SOURCE_REVISION_MISMATCH'))
  assert(report.blockers.includes('APPROVAL_WORKTREE_MISMATCH'))
  assert(report.blockers.includes('LIVE_EXECUTION_DISABLED'))
  assert.equal(controlled.calls, 0)
  assert.deepEqual(await readdir(storeDirectory), [])

  const manifest = { ...input.manifest, sourceRevision: runtimeCommit }
  const manifestFingerprint = fingerprintExternalCanaryManifest(manifest)
  const sameRevision = await verifyCanaryOperations({
    manifest,
    review: { ...input.review, manifestFingerprint },
    approval: signed({ sourceRevision: runtimeCommit, manifestFingerprint }),
  }, legacyDeps)
  assert.equal(sameRevision.checks.approvalMatchesPlan, true)
  assert.equal(sameRevision.checks.sourceMatches, false)
  assert(sameRevision.blockers.includes('APPROVAL_WORKTREE_MISMATCH'))
})

test('runtime carregado de um checkout limpo detecta troca posterior de HEAD', async (t) => {
  const { deps } = await fixture(t)
  const root = deps.fixtureRoot
  await cp(join(backend, 'src'), join(root, 'Backend/src'), { recursive: true })
  await cp(await realpath(join(backend, 'node_modules/zod')),
    join(root, 'Backend/node_modules/zod'), { recursive: true })
  await writeFile(join(root, 'Backend/package.json'), '{"type":"module"}\n')
  await git(root, 'add', 'Backend')
  await git(root, '-c', 'user.name=Canary Fixture', '-c', 'user.email=canary@example.invalid',
    '-c', 'commit.gpgsign=false', 'commit', '-qm', 'runtime used in the test')
  const head = await git(root, 'rev-parse', 'HEAD')
  const guard = 'data:text/javascript,globalThis.fetch%3Dasync()%3D%3E%7Bthrow%20Error(%22forbidden%22)%7D'
  const entry = pathToFileURL(join(root, 'Backend/src/evals/external-canary-integrity.ts')).href
  const outcome = await exec(process.execPath, [
    '--import', guard, '--import', 'tsx', '--input-type=module', '-e', `
      import { execFileSync } from 'node:child_process'
      const [entry, root, head] = process.argv.slice(1)
      const { inspectCanaryRuntimeSource } = await import(entry)
      const original = await inspectCanaryRuntimeSource(head)
      process.chdir(root)
      const git = (...args) => execFileSync('git', args, { encoding: 'utf8' }).trim()
      git('-c', 'user.name=Canary Fixture', '-c', 'user.email=canary@example.invalid',
          '-c', 'commit.gpgsign=false', 'commit', '--allow-empty', '-qm', 'later HEAD')
      const newHead = git('rev-parse', 'HEAD')
      const changed = await inspectCanaryRuntimeSource(newHead)
      console.log(JSON.stringify({ original, changed, newHead }))
    `, entry, root, head,
  ], { cwd: backend })
  const { original, changed, newHead } = JSON.parse(outcome.stdout)
  assert.deepEqual(original.issues, [], JSON.stringify(original))
  assert.equal(original.runtimeCommit, head)
  assert.equal(original.commit, head)
  assert.equal(changed.runtimeCommit, head)
  assert.equal(changed.commit, newHead)
  assert.deepEqual(changed.issues, ['RUNTIME_SOURCE_MISMATCH'])
})

test('teto externo depende de evidência assinada, vigente e suficiente', async (t) => {
  const { input, deps, payload, signed } = await fixture(t)
  for (const providerSpendLimit of [
    undefined,
    { ...payload.providerSpendLimit!, validUntil: '2026-01-01T23:59:59Z' },
    { ...payload.providerSpendLimit!, providerId: 'mock-unrelated' },
    { ...payload.providerSpendLimit!, limitUsd: 0.000001 },
  ]) {
    const report = await verifyCanaryFixtureOperations({ ...input, approval: signed({ providerSpendLimit }) }, deps)
    assert(report.blockers.includes('PROVIDER_ACCOUNT_LIMIT_UNVERIFIED'))
    assert.equal(report.financial.providerAccountLimitUsd, undefined)
    assert.equal(report.checks.approvalAuthenticated, true)
  }
  const report = await verifyCanaryFixtureOperations(input, {
    ...deps, credentials: { async resolve() { throw new Error(fakeKey) } },
  })
  assert(report.blockers.includes('CREDENTIAL_UNAVAILABLE'))
  assert.doesNotMatch(serializeCanaryOperationalReport(report), /never-exposed/)
  const withoutApproval = await verifyCanaryFixtureOperations({ ...input, approval: undefined }, deps)
  assert.equal(withoutApproval.checks.credentialAvailable, true)
  assert.equal(withoutApproval.checks.approvalAuthenticated, false)
  assert.equal(withoutApproval.experimentAuthorized, false)
  assert.equal(withoutApproval.rehearsalEligible, false)
})

test('HEAD, alterações rastreadas e arquivos não rastreados relevantes invalidam a revisão', async (t) => {
  const { input, deps } = await fixture(t)
  const root = deps.fixtureRoot
  const expected = input.manifest.sourceRevision
  const tracked = join(root, 'Backend/src/index.ts')
  await writeFile(tracked, '// modified tracked source\n')
  assert((await inspectCanarySource(root, expected)).issues.includes('DIRTY_WORKTREE'))
  await writeFile(tracked, '// tracked code fixture\n')
  await writeFile(join(root, 'Backend/src/.env'), 'synthetic=ignored\n')
  assert((await inspectCanarySource(root, expected)).issues.includes('DIRTY_WORKTREE'))
  await rm(join(root, 'Backend/src/.env'))
  await writeFile(join(root, 'Backend/src/untracked.ts'), '// untracked\n')
  assert((await inspectCanarySource(root, expected)).issues.includes('DIRTY_WORKTREE'))
  await git(root, 'add', 'Backend/src/untracked.ts')
  await git(root, '-c', 'user.name=Canary Fixture', '-c', 'user.email=canary@example.invalid',
    '-c', 'commit.gpgsign=false', 'commit', '-qm', 'different revision')
  const outcome = await verifyCanaryFixtureOperations(input, deps)
  assert(outcome.blockers.includes('SOURCE_REVISION_MISMATCH'))
  assert.equal(outcome.checks.sourceMatches, false)
})

test('lockfile, bytes de dependências e outra worktree são verificados', async (t) => {
  const { input, deps, directory } = await fixture(t)
  const root = deps.fixtureRoot
  const lockfile = join(root, 'Backend/pnpm-lock.yaml')
  const installed = join(root, 'Backend/node_modules')
  await writeFile(lockfile, '# divergência\n')
  assert((await verifyCanaryFixtureOperations(input, deps)).blockers.includes('LOCKFILE_MISMATCH'))
  await writeFile(lockfile, lock)
  await writeFile(join(installed, '.pnpm/lock.yaml'), '# divergência instalada\n')
  assert((await verifyCanaryFixtureOperations(input, deps)).blockers.includes('DEPENDENCIES_UNVERIFIED'))
  await writeFile(join(installed, '.pnpm/lock.yaml'), lock)
  await writeFile(join(installed, 'fixture/index.js'), '// dependency fixture v2\n')
  assert((await verifyCanaryFixtureOperations(input, deps)).blockers.includes('APPROVAL_DEPENDENCIES_MISMATCH'))
  const other = join(directory, 'other-tree')
  await git(root, 'worktree', 'add', '--detach', other, input.manifest.sourceRevision)
  await installSyntheticFiles(other)
  const report = await verifyCanaryFixtureOperations(input, { ...deps, fixtureRoot: other })
  assert(report.blockers.includes('APPROVAL_WORKTREE_MISMATCH'))
  assert.equal(report.source?.commit, input.manifest.sourceRevision)
})

test('falha no registro persistente bloqueia o ensaio antes do transporte', async (t) => {
  const { input, deps, directory } = await fixture(t)
  const transport = syntheticTransport()
  const report = await rehearseCanaryFixtureActivation(input, {
    ...deps, useStore: new CanaryAuthorizationUseStore(join(directory, 'missing-store')),
  }, transport)
  assert(report.blockers.includes('AUTHORIZATION_STORE_UNAVAILABLE'))
  assert.equal(transport.calls, 0)
  assert.equal(report.authorizationUse, 'unavailable')
})

test('concorrência permite um único ensaio e outro processo vê o marcador persistente', async (t) => {
  const { input, deps, storeDirectory } = await fixture(t)
  const first = syntheticTransport()
  const second = syntheticTransport()
  const results = await Promise.all([
    rehearseCanaryFixtureActivation(input, deps, first),
    rehearseCanaryFixtureActivation(input, { ...deps, useStore: new CanaryAuthorizationUseStore(storeDirectory) }, second),
  ])
  assert.equal(first.calls + second.calls, 1)
  const completed = results.find((item) => item.rehearsal !== undefined)
  assert.equal(completed?.rehearsal?.technicalStatus, 'completed')
  assert.equal(completed.rehearsal.assertions.passed, 2)
  assert.equal(completed.rehearsal.requiredHumanCriteriaPending, 1)
  assert.equal(completed.rehearsal.provenance, 'simulated_external_transport')
  assert.equal(completed.experimentExecuted, false)
  assert.equal(completed.financial.effectiveCharge, 'not_verified')
  assert(results.some((item) => item.blockers.includes('AUTHORIZATION_ALREADY_CONSUMED')))
  const resumed = await verifyCanaryFixtureOperations(input, { ...deps, useStore: new CanaryAuthorizationUseStore(storeDirectory) })
  assert.equal(resumed.authorizationUse, 'consumed')
  const restarted = await exec(process.execPath, [
    '--import', 'tsx', '--input-type=module', '-e',
    "import { CanaryAuthorizationUseStore } from './src/evals/external-canary-use-store.ts'; console.log(await new CanaryAuthorizationUseStore(process.argv[1]).status(process.argv[2]));",
    storeDirectory, input.approval.payload.useId,
  ], { cwd: backend })
  assert.equal(restarted.stdout.trim(), 'consumed')
  const [marker] = await readdir(storeDirectory)
  assert.equal(await readFile(join(storeDirectory, marker!), 'utf8'), '{"version":1,"state":"consumed"}\n')
})

test('cancelamento depois da reserva e antes do transporte libera o custo', async () => {
  const signal = new AbortController()
  let calls = 0
  const controller = new ExternalEvalCostController({
    requestedModelId: modelId,
    limits: { maxModelCalls: 2, maxOutputTokensPerCall: 64, maxExecutionTokens: 5_000, estimatedInputTokensPerCall: 100, timeoutMs: 2_000 },
    pricing: { modelId, currency: 'USD', inputUsdPerMillionTokens: 1, outputUsdPerMillionTokens: 2, confirmedAt: '2025-12-31T00:00:00Z' },
    maxBudgetUsd: 1,
    unreportedUsageMultiplier: 1.25,
    cancellableBeforeTransport: true,
  })
  const wrapped = controller.wrap({ async complete() {
    calls += 1
    return { message: { role: 'assistant', content: 'simulated' } }
  } })
  const modelInput = { messages: [{ role: 'user' as const, content: 'fixture' }], tools: [], signal: signal.signal }
  const pending = wrapped.complete(modelInput)
  const cancelled = assert.rejects(pending, { code: 'MODEL_CANCELLED', transportStarted: false })
  assert.equal(controller.snapshot().activeReservations, 1)
  signal.abort(new AgentModelError('MODEL_CANCELLED', true))
  await cancelled
  await assert.rejects(wrapped.complete({ ...modelInput, signal: AbortSignal.abort() }))
  const snapshot = controller.snapshot()
  assert.equal(calls, 0)
  assert.equal(snapshot.activeReservations, 0)
  assert.equal(snapshot.transportedCalls, 0)
  assert.equal(snapshot.chargedCostUsd, 0)
})

test('cancelamento durante transporte conserva custo e consome a autorização', async (t) => {
  const { input, deps } = await fixture(t)
  const signal = new AbortController()
  const preCancelled = syntheticTransport()
  const before = await rehearseCanaryFixtureActivation(input, deps, { ...preCancelled, signal: AbortSignal.abort() })
  assert(before.blockers.includes('OPERATOR_CANCELLED'))
  assert.equal(before.authorizationUse, 'available')
  assert.equal(preCancelled.calls, 0)
  let sent = 0
  const transport = createInMemoryOpenRouterTransport(async (_, init) => {
    sent += 1
    return new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener('abort', () => reject(new Error(fakeKey)), { once: true })
      signal.abort()
    })
  })
  const during = await rehearseCanaryFixtureActivation(input, deps, { transport, signal: signal.signal })
  assert.equal(sent, 1)
  assert.equal(during.authorizationUse, 'consumed')
  assert(during.blockers.includes('OPERATOR_CANCELLED'))
  assert(during.rehearsal!.consumption.chargedCostUsd > 0)
  assert.equal(during.rehearsal?.assertions.notEvaluated, 2)
})

test('timeout, erro técnico e identidade inválida preservam o estado de consumo', async (t) => {
  const { input, deps, signed } = await fixture(t)
  for (const options of [
    { returnedModel: 'mock/other' },
    { provider: 'mock-unexpected' },
    { provider: null },
    { status: 503 },
  ]) {
    const controlled = syntheticTransport(options)
    const report = await rehearseCanaryFixtureActivation({
      ...input, approval: signed({ useId: randomBytes(16).toString('hex') }),
    }, deps, controlled)
    assert.equal(controlled.calls, 1)
    assert.equal(report.authorizationUse, 'consumed')
    assert.equal(report.rehearsal?.technicalStatus, 'technical_failure')
    assert.equal(report.rehearsal.assertions.failed, 0)
    assert.equal(report.rehearsal.assertions.notEvaluated, 2)
    if (options.provider === null) assert.deepEqual(report.rehearsal.observedProviderIds, [])
  }

  const limited = await fixture(t, 30)
  const transport = createInMemoryOpenRouterTransport(async (_, init) => new Promise<Response>((_resolve, reject) => {
    init?.signal?.addEventListener('abort', () => reject(new Error('synthetic timeout')), { once: true })
  }))
  const report = await rehearseCanaryFixtureActivation(limited.input, limited.deps, { transport })
  assert.equal(report.rehearsal?.technicalStatus, 'technical_failure')
  assert(report.rehearsal.technicalErrorCodes.some((code) => code.includes('TIMEOUT')))
  assert(report.rehearsal.consumption.chargedCostUsd > 0)
  assert.equal(report.authorizationUse, 'consumed')
})

test('excesso de uso é reportado e os artefatos minimizam dados e protegem a escrita', async (t) => {
  const { input, deps, directory } = await fixture(t)
  const controlled = syntheticTransport({ highUsage: true })
  const report = await rehearseCanaryFixtureActivation(input, deps, controlled)
  assert.equal(controlled.calls, 1)
  assert(report.rehearsal!.limitsReached.includes('reported_usage_exceeded_reservation'))
  assert(report.rehearsal!.consumption.overReservedCostUsd > 0)
  const files = await writeCanaryOperationalReports(report, directory)
  await assert.rejects(writeCanaryOperationalReports(report, directory), /já existe/)
  const json = await readFile(files.json, 'utf8')
  const markdown = await readFile(files.markdown, 'utf8')
  assert.equal(markdown, renderCanaryOperationalMarkdown(report))
  assert.match(markdown, /Execução externa autorizada: não/)
  for (const data of [json, markdown]) {
    for (const secret of [fakeKey, fakePrompt, input.approval.signature, input.approval.payload.useId, deps.fixtureRoot]) {
      assert.equal(data.includes(secret), false)
    }
  }
  const tooCheap = { ...input.manifest, maxBudgetUsd: 0.000001 }
  const fingerprint = fingerprintExternalCanaryManifest(tooCheap)
  const blockedTransport = syntheticTransport()
  const blocked = await rehearseCanaryFixtureActivation({
    manifest: tooCheap,
    review: { ...input.review, manifestFingerprint: fingerprint },
    approval: { ...input.approval },
  }, deps, blockedTransport)
  assert(blocked.plan.issues.some(({ code }) => code === 'ESTIMATED_COST_EXCEEDS_BUDGET'))
  assert.equal(blockedTransport.calls, 0)
})

test('CLI verifica offline, não aceita autoridade do arquivo e mantém run bloqueado', async (t) => {
  const { input, directory, storeDirectory } = await fixture(t)
  const manifest = join(directory, 'manifest.json')
  const approval = join(directory, 'approval.json')
  const review = join(directory, 'review.json')
  await Promise.all([
    writeFile(manifest, JSON.stringify(input.manifest)),
    writeFile(approval, JSON.stringify(input.approval)),
    writeFile(review, JSON.stringify(input.review)),
  ])
  const guard = 'data:text/javascript,globalThis.fetch%3Dasync()%3D%3E%7Bthrow%20Error(%22forbidden%22)%7D'
  const cli = (script: string, ...args: string[]) => exec(process.execPath, [
    '--import', guard, '--import', 'tsx', `src/scripts/${script}.ts`, ...args,
  ], { cwd: backend, env: { ...process.env, OPENROUTER_API_KEY: fakeKey } })
  await assert.rejects(cli('eval-canary', '--action', 'verify', '--manifest', manifest, '--approval', approval,
    '--review', review, '--output-dir', directory), (error: unknown) => {
    const { stdout, stderr } = error as { stdout: string; stderr: string }
    const summary = JSON.parse(stdout)
    assert(summary.blockers.includes('APPROVAL_AUTHORITY_UNCONFIGURED'))
    assert(summary.blockers.includes('LIVE_EXECUTION_DISABLED'))
    assert.equal(summary.networkAllowed, false)
    assert(!`${stdout}${stderr}`.includes(fakeKey))
    return true
  })
  assert.equal((await readdir(directory)).filter((file) => file.startsWith('canary-operations.')).length, 2)
  assert.deepEqual(await readdir(storeDirectory), [])
  await assert.rejects(cli('eval-canary', '--action', 'run', '--manifest', manifest, '--output-dir', directory))
  await assert.rejects(cli('eval-live', '--action', 'run', '--dataset', 'universal-core', '--modality', 'live_external'), /bloqueada/)
})
