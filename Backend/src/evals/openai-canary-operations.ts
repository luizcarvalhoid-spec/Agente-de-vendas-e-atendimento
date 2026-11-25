import { lstat, realpath } from 'node:fs/promises'

import { AgentModelError } from '../agent/agent-model-port.js'
import { chatCompletionsAgentModelModuleUrl, createChatCompletionsAgentModel } from '../agent/chat-completions-agent-model.js'
import { chatCompletionsModuleUrl, createChatCompletionsClient } from '../agent/chat-completions-client.js'
import { isInMemoryChatTransport } from '../agent/in-memory-chat-transport.js'
import { OPENAI_DIRECT_MODEL, OPENAI_DIRECT_PROTOCOL, openAiDirectAgentModelModuleUrl } from '../agent/openai/openai-direct-agent-model.js'
import { fingerprintEvalDataset } from './eval-baseline.js'
import type { CanaryAuthorityRegistry } from './external-canary-approval.js'
import { createCanaryRuntimeSourceInspector, inspectCanarySource, type CanarySourceIntegrity } from './external-canary-integrity.js'
import { CanaryAuthorizationUseStore } from './external-canary-use-store.js'
import { estimateExternalEvalCost } from './external-eval-cost.js'
import { planExternalEval } from './external-eval-plan.js'
import { evaluateCanaryModel } from './external-eval-runner.js'
import {
  authenticateOpenAiCanaryApproval, fingerprintOpenAiCanaryManifest, openAiCanaryDraftSchema, openAiCanaryManifestSchema,
  openAiCanaryContractModuleUrl, openAiCanaryProjectSchema, type OpenAiCanaryApproval, type OpenAiCanaryManifest,
} from './openai-canary-contract.js'
import { loadOpenAiCanaryCredential, openAiCanaryCredentialModuleUrl } from './openai-canary-credential.js'
import { openAiDirectPlanRequest } from './openai-direct-candidate.js'

const inspectLoadedSource = createCanaryRuntimeSourceInspector([
  [import.meta.url, 'evals/openai-canary-operations.ts'],
  [openAiCanaryContractModuleUrl, 'evals/openai-canary-contract.ts'],
  [openAiCanaryCredentialModuleUrl, 'evals/openai-canary-credential.ts'],
  [chatCompletionsModuleUrl, 'agent/chat-completions-client.ts'],
  [chatCompletionsAgentModelModuleUrl, 'agent/chat-completions-agent-model.ts'],
  [openAiDirectAgentModelModuleUrl, 'agent/openai/openai-direct-agent-model.ts'],
])
const syntheticCredential = 'synthetic-canary-credential'

interface Deployment {
  readonly projectId: string
  readonly authorities: CanaryAuthorityRegistry
  readonly useStore: CanaryAuthorizationUseStore
}

// O provisionamento futuro requer revisão de código e nova assinatura vinculada ao runtime.
function configuredDeployment(): Omit<Deployment, 'useStore'> & { serviceUid: number } | undefined {
  return undefined
}

const authorizationDirectory = '/var/lib/openai-canary/authorizations'

async function verifyIsolatedService(serviceUid: number | undefined) {
  if (process.platform !== 'linux' || serviceUid === undefined || serviceUid <= 0 || process.getuid?.() !== serviceUid) return false
  try {
    const stat = await lstat(authorizationDirectory)
    return stat.isDirectory() && stat.uid === serviceUid && (stat.mode & 0o077) === 0 &&
      await realpath(authorizationDirectory) === authorizationDirectory
  } catch {
    return false
  }
}

export interface OpenAiCanaryInput {
  readonly manifest: unknown
  readonly approval?: unknown
}

function currentEvidence(approval: OpenAiCanaryApproval, manifest: OpenAiCanaryManifest, now: number, reserve: number) {
  const issued = Date.parse(approval.issuedAt)
  const expires = Date.parse(approval.expiresAt)
  const validAt = (evidence: { verifiedAt: string; validUntil: string }) =>
    Date.parse(evidence.verifiedAt) <= issued && Date.parse(evidence.validUntil) > now
  const finance = approval.providerSpendLimit
  const retention = approval.retentionDecision
  return {
    approvalCurrent: Number.isFinite(now) && issued <= now && now < expires,
    financialLimitVerified: finance !== undefined && validAt(finance) && finance.projectId === approval.projectId &&
      finance.enforcement === 'hard_limit' && finance.limitUsd <= approval.approvedBudgetUsd &&
      finance.availableUsd <= finance.limitUsd && reserve <= finance.availableUsd,
    retentionApproved: retention !== undefined && validAt(retention) && retention.projectId === approval.projectId,
    pricesCurrent: approval.pricingReview !== undefined && validAt(approval.pricingReview) &&
      Date.parse(manifest.pricing.observedAt) <= Date.parse(approval.pricingReview.verifiedAt),
  }
}

type GateContext = {
  deployment?: Deployment
  fixture: boolean
  inspectSource(revision?: string): Promise<CanarySourceIntegrity>
  verifyIsolation(): Promise<boolean>
  loadCredential(): Promise<string | undefined>
  now(): number
}

const checksChecklist = [
  'Conferir o checkout e as dependências isoladas e vincular a revisão do runtime ao manifesto.',
  'Revalidar a tarifa e o teto externo com enforcement ativo em projeto dedicado.',
  'Registrar decisão expressa sobre retenção padrão para dados fictícios sem transcrições.',
  'Provisionar autoridade e mount de credencial protegidos no serviço isolado.',
  'Emitir autorização Ed25519 específica para o fingerprint e o escopo de uso único.',
] as const

async function inspect(input: OpenAiCanaryInput, context: GateContext) {
  const draft = openAiCanaryDraftSchema.safeParse(input.manifest).data
  const manifest = openAiCanaryManifestSchema.safeParse(draft).data
  const fingerprint = manifest && fingerprintOpenAiCanaryManifest(manifest)
  const { deployment } = context
  const approval = deployment && authenticateOpenAiCanaryApproval(input.approval, deployment.authorities)
  const request = draft && openAiDirectPlanRequest(draft)
  const planned = request && await planExternalEval(request)
  const loaded = planned?.loaded
  const reserve = planned?.plan.estimatedWorstCaseUsd
  const datasetMatches = draft !== undefined && loaded !== undefined && loaded.data.dataset.id === draft.dataset.id &&
    loaded.data.dataset.version === draft.dataset.version && fingerprintEvalDataset(loaded) === draft.dataset.fingerprint
  const source = await context.inspectSource(draft?.sourceRevision)
  const isolationVerified = await context.verifyIsolation()
  const blockers = new Set<string>(source.issues)
  if (!deployment) blockers.add('LIVE_EXECUTION_DISABLED')
  if (!isolationVerified) blockers.add('ISOLATED_ENVIRONMENT_UNVERIFIED')
  if (!draft) blockers.add('MANIFEST_INVALID')
  else if (!manifest) blockers.add('SOURCE_REVISION_PENDING')
  if (!datasetMatches) blockers.add('DATASET_SCOPE_UNVERIFIED')
  if (planned && !planned.plan.executionAllowed) {
    for (const issue of planned.plan.blockers) blockers.add(issue.code)
  }
  if (!approval) blockers.add(input.approval === undefined ? 'APPROVAL_REQUIRED' : 'APPROVAL_INVALID')
  if ((deployment?.authorities.size ?? 0) === 0) blockers.add('APPROVAL_AUTHORITY_UNCONFIGURED')
  const scopeMatches = approval !== undefined && manifest !== undefined && deployment !== undefined &&
    openAiCanaryProjectSchema.safeParse(deployment.projectId).success && approval.projectId === deployment.projectId &&
    approval.scope === (context.fixture ? 'openai_direct_fixture_once' : 'openai_direct_once') &&
    manifest.purpose === (context.fixture ? 'synthetic_rehearsal' : 'external_candidate') &&
    approval.experimentId === manifest.experimentId && approval.dataset.id === manifest.dataset.id &&
    approval.dataset.version === manifest.dataset.version && approval.dataset.fingerprint === manifest.dataset.fingerprint &&
    approval.scenarioIds[0] === manifest.scenarioIds[0]
  const fingerprintMatches = approval !== undefined && fingerprint !== undefined && approval.manifestFingerprint === fingerprint
  const budgetMatches = approval !== undefined && manifest !== undefined && approval.approvedBudgetUsd === manifest.maxBudgetUsd
  const sourceMatches = manifest !== undefined && approval !== undefined && source.issues.length === 0 &&
    source.commit === approval.sourceRevision && source.commit === manifest.sourceRevision &&
    (context.fixture || source.runtimeCommit === manifest.sourceRevision) &&
    source.worktreeFingerprint !== undefined && source.worktreeFingerprint === approval.worktreeFingerprint &&
    source.dependenciesFingerprint !== undefined && source.dependenciesFingerprint === approval.dependenciesFingerprint
  if (approval) {
    if (!scopeMatches) blockers.add('CANARY_SCOPE_MISMATCH')
    if (!fingerprintMatches) blockers.add('APPROVAL_FINGERPRINT_MISMATCH')
    if (!budgetMatches) blockers.add('APPROVAL_BUDGET_MISMATCH')
    if (!sourceMatches) blockers.add('APPROVAL_SOURCE_MISMATCH')
  }
  const evidence = approval && manifest && reserve !== undefined ? currentEvidence(approval, manifest, context.now(), reserve) : undefined
  const contractMatches = scopeMatches && fingerprintMatches && budgetMatches
  const approvalCurrent = evidence?.approvalCurrent === true
  const financialLimitVerified = contractMatches && approvalCurrent && evidence?.financialLimitVerified === true
  const retentionApproved = contractMatches && approvalCurrent && evidence?.retentionApproved === true
  const pricesCurrent = contractMatches && approvalCurrent && evidence?.pricesCurrent === true
  if (approval && !approvalCurrent) blockers.add('APPROVAL_NOT_CURRENT')
  if (!financialLimitVerified) blockers.add('EXTERNAL_HARD_LIMIT_UNVERIFIED')
  if (!retentionApproved) blockers.add('DATA_RETENTION_APPROVAL_REQUIRED')
  if (!pricesCurrent) blockers.add('PRICE_REVALIDATION_REQUIRED')
  const use = approval && deployment ? await deployment.useStore.status(approval.useId) : 'not_checked'
  if (use === 'consumed') blockers.add('AUTHORIZATION_ALREADY_CONSUMED')
  if (use === 'unavailable') blockers.add('AUTHORIZATION_STORE_UNAVAILABLE')
  const credential = deployment && (context.fixture || blockers.size === 0) ? await context.loadCredential() : undefined
  if (credential === undefined) blockers.add('CREDENTIAL_UNAVAILABLE')

  return { manifest, approval, request, reserve, credential, report: {
    reportVersion: 1,
    provenance: context.fixture ? 'synthetic_fixture' : 'operational_preflight',
    configuration: draft,
    manifestFingerprint: fingerprint,
    source: { loadedRevision: source.runtimeCommit, inspectedRevision: source.commit, approvedRevision: approval?.sourceRevision },
    authorization: { authenticated: approval !== undefined, current: approvalCurrent, use },
    checks: { datasetMatches, isolationVerified, scopeMatches, fingerprintMatches, sourceMatches, budgetMatches, financialLimitVerified,
      retentionApproved, pricesCurrent, credentialAvailable: credential !== undefined },
    retention: retentionApproved ? 'standard_retention_approved' : 'pending_human_review',
    financial: {
      proposedBudgetUsd: draft?.maxBudgetUsd,
      approvedBudgetUsd: budgetMatches ? approval?.approvedBudgetUsd : undefined,
      externalHardLimitUsd: financialLimitVerified ? approval?.providerSpendLimit?.limitUsd : undefined,
      estimatedCostPerCallUsd: draft && estimateExternalEvalCost({
        ...draft.pricing, inputTokens: draft.limits.maxInputTokensPerCall, outputTokens: draft.limits.maxOutputTokensPerCall,
      }),
      estimatedReservationUsd: reserve,
      actualCharge: 'none_attempted',
    },
    preflight: blockers.size === 0 ? 'ready' : 'blocked',
    blockers: [...blockers],
    checklist: checksChecklist,
    experimentAuthorized: false,
    networkAllowed: false,
    transportAttempts: 0,
    realInferenceAttempts: 0,
    execution: undefined as Awaited<ReturnType<typeof evaluateCanaryModel>> | undefined,
  }}
}

function operationalContext(): GateContext {
  const config = configuredDeployment()
  return {
    deployment: config && { ...config, useStore: new CanaryAuthorizationUseStore(authorizationDirectory) },
    fixture: false, inspectSource: inspectLoadedSource, verifyIsolation: () => verifyIsolatedService(config?.serviceUid),
    loadCredential: loadOpenAiCanaryCredential, now: Date.now,
  }
}

export async function verifyOpenAiCanary(input: OpenAiCanaryInput) {
  return (await inspect(input, operationalContext())).report
}

export function executeOpenAiCanary(input: OpenAiCanaryInput, signal?: AbortSignal) {
  return run(input, operationalContext(), (url, init) => globalThis.fetch(url, init), signal)
}

export function rehearseOpenAiCanaryGate(input: OpenAiCanaryInput, options: Deployment & {
  fixtureRoot: string
  transport: typeof fetch
  credentialAvailable: boolean
  now?: () => number
  signal?: AbortSignal
}) {
  if (!isInMemoryChatTransport(options.transport)) throw new TypeError('O ensaio exige transporte em memória.')
  return run(input, {
    deployment: options, fixture: true,
    async verifyIsolation() { return true },
    inspectSource: (revision) => revision === undefined ? Promise.resolve({ issues: [] }) : inspectCanarySource(options.fixtureRoot, revision),
    async loadCredential() { return options.credentialAvailable ? syntheticCredential : undefined },
    now: options.now ?? Date.now,
  }, options.transport, options.signal)
}

async function run(input: OpenAiCanaryInput, context: GateContext, dispatch: typeof fetch, signal?: AbortSignal) {
  const { report, manifest, approval, request, reserve, credential } = await inspect(input, context)
  if (report.preflight !== 'ready' || !manifest || !approval || !request || reserve === undefined || !credential || !context.deployment) return report
  if (signal?.aborted) return { ...report, blockers: ['OPERATOR_CANCELLED'] }
  const use = await context.deployment.useStore.consume(approval.useId)
  if (use !== 'reserved') return {
    ...report,
    authorization: { ...report.authorization, use },
    blockers: [use === 'consumed' ? 'AUTHORIZATION_ALREADY_CONSUMED' : 'AUTHORIZATION_STORE_UNAVAILABLE'],
  }
  report.authorization = { ...report.authorization, use: 'consumed' }
  let attempts = 0
  let evidenceExpired = false
  const transport: typeof fetch = async (url, init) => {
    if (signal?.aborted || init?.signal?.aborted) throw new AgentModelError('MODEL_CANCELLED', false)
    if (!Object.values(currentEvidence(approval, manifest, context.now(), reserve)).every(Boolean)) {
      evidenceExpired = true
      throw new AgentModelError('CONFIGURATION_INVALID', false)
    }
    if (attempts >= manifest.limits.maxModelCalls || url !== OPENAI_DIRECT_PROTOCOL.endpoint || init?.method !== 'POST') {
      throw new AgentModelError('CONFIGURATION_INVALID', false)
    }
    const headers = new Headers(init.headers)
    headers.set('Authorization', `Bearer ${credential}`)
    headers.set('OpenAI-Project', approval.projectId)
    attempts += 1
    return dispatch(OPENAI_DIRECT_PROTOCOL.endpoint, { ...init, headers, redirect: 'error' })
  }
  let modelMatches: boolean | undefined
  const model = createChatCompletionsAgentModel(createChatCompletionsClient({
    model: OPENAI_DIRECT_MODEL,
    timeoutMs: manifest.limits.timeoutMs,
    maxOutputTokens: manifest.limits.maxOutputTokensPerCall,
    transport,
    protocol: { ...OPENAI_DIRECT_PROTOCOL, kind: 'direct_canary' },
  }), { expectedModelId: OPENAI_DIRECT_MODEL, onObservation(value) { modelMatches = value.modelIdentityMatches } })
  try {
    report.execution = await evaluateCanaryModel(request, { model, datasetFingerprint: manifest.dataset.fingerprint, signal })
    if (modelMatches === false) report.blockers.push('MODEL_IDENTITY_MISMATCH')
    if (report.execution.execution.limitsReached.includes('reported_usage_exceeded_reservation')) report.blockers.push('USAGE_EXCEEDED_RESERVATION')
    if (report.execution.execution.technicalStatus === 'technical_failure') report.blockers.push('TECHNICAL_FAILURE')
  } catch {
    report.blockers.push('TECHNICAL_FAILURE')
  }
  if (signal?.aborted) report.blockers.push('OPERATOR_CANCELLED')
  if (evidenceExpired) report.blockers.push('APPROVAL_EVIDENCE_EXPIRED_BEFORE_TRANSPORT')
  report.transportAttempts = attempts
  report.realInferenceAttempts = context.fixture ? 0 : attempts
  report.experimentAuthorized = !context.fixture && attempts > 0
  report.networkAllowed = report.experimentAuthorized
  if (report.realInferenceAttempts > 0) report.financial.actualCharge = 'unverified'
  return report
}
