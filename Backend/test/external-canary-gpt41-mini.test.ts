import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { after, before, test } from 'node:test'
import { promisify } from 'node:util'

import { OPENROUTER_MAX_TIMEOUT_MS } from '../src/agent/openrouter/openrouter-client.js'
import { TOOL_ORCHESTRATOR_TIMEOUT_MS } from '../src/agent/tool-orchestrator.js'
import { configuredCanaryAuthorities } from '../src/evals/external-canary-authorities.js'
import { verifyCanaryOperations } from '../src/evals/external-canary-operations.js'
import { renderExternalCanaryPreparationMarkdown } from '../src/evals/external-canary-report.js'
import { externalCanaryDraftSchema, externalCanaryManifestSchema } from '../src/evals/external-canary-schema.js'
import { CanaryAuthorizationUseStore } from '../src/evals/external-canary-use-store.js'
import { fingerprintExternalCanaryManifest, prepareExternalCanary } from '../src/evals/external-canary.js'
import { runLiveExternalEval } from '../src/evals/external-eval-runner.js'

const backend = resolve(import.meta.dirname, '..')
const candidate = externalCanaryDraftSchema.parse(JSON.parse(await readFile(
  resolve(backend, 'evals/canary/gpt-4.1-mini-candidate.v1.json'), 'utf8',
)))
const originalFetch = globalThis.fetch
let fetchCalls = 0

before(() => {
  globalThis.fetch = async () => {
    fetchCalls += 1
    throw new Error('O preflight não pode acessar a rede.')
  }
})
after(() => {
  globalThis.fetch = originalFetch
  assert.equal(fetchCalls, 0)
})

test('candidato GPT-4.1 Mini preserva o cenário universal e fixa modelo e política do provedor', async () => {
  const template = externalCanaryDraftSchema.parse(JSON.parse(await readFile(
    resolve(backend, 'evals/canary/first-external-candidate.v1.json'), 'utf8',
  )))
  assert.equal(template.modelId, undefined)
  assert.equal(template.sourceRevision, undefined)
  assert.equal(candidate.manifestVersion, template.manifestVersion)
  assert.deepEqual(candidate.technicalVersions, template.technicalVersions)
  assert.deepEqual(candidate.stopCriteria, template.stopCriteria)
  assert.deepEqual(candidate.dataset, template.dataset)
  assert.deepEqual(candidate.scenarioIds, ['universal.core.incomplete-need.001'])
  assert.equal(candidate.purpose, 'external_candidate')
  assert.equal(candidate.transcriptPersistence, 'disabled')
  assert.equal(candidate.modelId, 'openai/gpt-4.1-mini')
  assert.deepEqual(candidate.routing, {
    providerId: 'openai',
    allowFallbacks: false,
    requireParameters: true,
    dataCollection: 'deny',
    zeroDataRetention: true,
  })
  assert.deepEqual(candidate.limits, {
    maxModelCalls: 2,
    maxInputTokensPerCall: 20_000,
    maxOutputTokensPerCall: 512,
    maxExecutionTokens: 41_024,
    timeoutMs: 15_000,
    effectiveTimeoutMs: 15_000,
  })
  assert(candidate.limits.timeoutMs <= OPENROUTER_MAX_TIMEOUT_MS)
  assert.equal(candidate.limits.effectiveTimeoutMs, Math.min(
    candidate.limits.timeoutMs, TOOL_ORCHESTRATOR_TIMEOUT_MS,
  ))
  assert.equal(candidate.limits.maxExecutionTokens, candidate.limits.maxModelCalls * (
    candidate.limits.maxInputTokensPerCall + candidate.limits.maxOutputTokensPerCall
  ))
  assert.equal(candidate.maxBudgetUsd, 1)
  assert.equal(candidate.unreportedUsageMultiplier, 1.25)
  assert.deepEqual(candidate.pricing, {
    modelId: candidate.modelId,
    providerId: candidate.routing.providerId,
    currency: 'USD',
    inputUsdPerMillionTokens: 0.4,
    outputUsdPerMillionTokens: 1.6,
    source: 'https://openrouter.ai/openai/gpt-4.1-mini',
    confirmedAt: '2026-11-19T14:31:29.906Z',
  })
})

test('preflight calcula reserva abaixo de USD 1 e mantém revisão e política de dados pendentes', async () => {
  const report = await prepareExternalCanary(candidate)
  assert.equal(report.status, 'configuration_incomplete')
  assert.deepEqual(report.issues, [{ code: 'FIELD_REQUIRED', field: 'sourceRevision' }])
  assert.equal(report.technicalPreparationComplete, false)
  assert.equal(report.manifestFingerprint, undefined)
  assert.equal(report.draft?.sourceRevision, undefined)
  assert(report.stages.includes('financial_review_pending'))
  assert(report.stages.includes('data_policy_review_pending'))
  assert.equal(report.requirements.data_policy, 'pending')
  assert.equal(report.requirements.price_and_source, 'pending')
  assert.equal(report.requirements.execution_authorization, 'pending')
  assert.equal(report.experimentAuthorized, false)
  assert.equal(report.executionAllowed, false)
  assert.equal(report.networkAllowed, false)
  assert.deepEqual(report.budget, {
    estimatedUsdPerCall: 0.0088192,
    estimatedUsdTotal: 0.0176384,
    reservedUsdPerCall: 0.011024,
    reservedUsdTotal: 0.022048,
    configuredMaxBudgetUsd: 1,
    preventiveBalanceUsd: 0.977952,
    sufficient: true,
  })
  const markdown = renderExternalCanaryPreparationMarkdown(report)
  assert.match(markdown, /Estimativa de rascunho/)
  assert.match(markdown, /Retenção zero: exigida/)
  assert.match(markdown, /Elegibilidade ZDR do endpoint: pendente de verificação/)
})

test('uma alteração de preço muda o fingerprint e invalida as atestações anteriores', async () => {
  // SHA fictício em memória, usado somente para exercitar o contrato completo.
  const complete = externalCanaryManifestSchema.parse({ ...candidate, sourceRevision: '0'.repeat(40) })
  const manifestFingerprint = fingerprintExternalCanaryManifest(complete)
  const changed = { ...complete, pricing: { ...complete.pricing, inputUsdPerMillionTokens: 0.41 } }
  assert.notEqual(fingerprintExternalCanaryManifest(changed), manifestFingerprint)
  const report = await prepareExternalCanary(changed, { manifestFingerprint, attestations: ['price_and_source'] })
  assert.equal(report.status, 'blocked')
  assert(report.issues.some(({ code }) => code === 'REVIEW_FINGERPRINT_MISMATCH'))
  assert.equal(report.requirements.price_and_source, 'pending')
})

test('gate mantém o candidato sem autoridade e ambas as entradas live continuam bloqueadas', async () => {
  const report = await verifyCanaryOperations({ manifest: candidate }, {
    authorities: configuredCanaryAuthorities,
    useStore: new CanaryAuthorizationUseStore(resolve(backend, 'external-eval-reports/canary-control')),
  })
  assert.equal(report.plan.requirements.data_policy, 'pending')
  assert.equal(report.plan.approvedCodeRevision, undefined)
  assert.equal(report.financial.manifestBudgetUsd, 1)
  assert.equal(report.financial.estimatedReservationUsd, 0.022048)
  assert.equal(report.checks.sourceMatches, false)
  assert.equal(report.checks.approvalAuthenticated, false)
  assert.equal(report.authorizationUse, 'not_checked')
  assert.equal(report.experimentAuthorized, false)
  assert.equal(report.networkAllowed, false)
  assert(report.blockers.includes('MANIFEST_NOT_APPROVED'))
  assert(report.blockers.includes('APPROVAL_AUTHORITY_UNCONFIGURED'))
  assert(report.blockers.includes('PROVIDER_ACCOUNT_LIMIT_UNVERIFIED'))
  assert(report.blockers.includes('LIVE_EXECUTION_DISABLED'))

  await assert.rejects(runLiveExternalEval(), { code: 'LIVE_EXTERNAL_DISABLED' })
  const exec = promisify(execFile)
  const fetchGuard = 'data:text/javascript,globalThis.fetch%3Dasync()%3D%3E%7Bthrow%20Error(%22forbidden%22)%7D'
  await assert.rejects(exec(process.execPath, [
    '--import', fetchGuard, '--import', 'tsx', 'src/scripts/eval-live.ts', '--action', 'run',
    '--dataset', candidate.dataset.id, '--modality', 'live_external',
  ], { cwd: backend }), (error: unknown) => {
    const { stdout, stderr, code } = error as { stdout: string; stderr: string; code: number }
    const plan = JSON.parse(stdout)
    assert.equal(code, 1)
    assert.equal(plan.executionAllowed, false)
    assert.equal(plan.networkAllowed, false)
    assert(plan.blockers.some((item: { code: string }) => item.code === 'LIVE_EXTERNAL_DISABLED'))
    assert.match(stderr, /bloqueada/)
    return true
  })
})
