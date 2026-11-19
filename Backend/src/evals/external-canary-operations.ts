import {
  authenticateCanaryApproval,
  type CanaryAuthorityRegistry,
} from './external-canary-approval.js'
import { inspectCanarySource, type CanarySourceIntegrity, type CanarySourceIssue } from './external-canary-integrity.js'
import { externalCanaryManifestSchema, externalCanaryReviewItems } from './external-canary-schema.js'
import type { CanaryAuthorizationUseStore } from './external-canary-use-store.js'
import { prepareExternalCanary, rehearseExternalCanary } from './external-canary.js'
import type { InMemoryOpenRouterTransport } from './external-eval-runner.js'

const syntheticCredential = Symbol('synthetic canary credential')

export interface CanaryCredentialSource {
  resolve(identity: { experimentId: string; modelId: string; providerId: string }): Promise<typeof syntheticCredential | undefined>
}

export function createSyntheticCanaryCredentialSource(available: boolean): CanaryCredentialSource {
  return { async resolve() { return available ? syntheticCredential : undefined } }
}

export interface CanaryOperationDependencies {
  readonly repositoryRoot: string
  readonly authorities: CanaryAuthorityRegistry
  readonly useStore: CanaryAuthorizationUseStore
  readonly credentials?: CanaryCredentialSource
  readonly now?: () => number
}

export type CanaryOperationalBlocker = CanarySourceIssue
  | 'MANIFEST_INVALID'
  | 'MANIFEST_NOT_APPROVED'
  | 'APPROVAL_AUTHORITY_UNCONFIGURED'
  | 'APPROVAL_INVALID'
  | 'APPROVAL_EXPIRED'
  | 'APPROVAL_NOT_YET_VALID'
  | 'APPROVAL_FINGERPRINT_MISMATCH'
  | 'APPROVAL_BUDGET_MISMATCH'
  | 'APPROVAL_WORKTREE_MISMATCH'
  | 'APPROVAL_DEPENDENCIES_MISMATCH'
  | 'CANARY_SCOPE_MISMATCH'
  | 'PROVIDER_ACCOUNT_LIMIT_UNVERIFIED'
  | 'CREDENTIAL_UNAVAILABLE'
  | 'AUTHORIZATION_ALREADY_CONSUMED'
  | 'AUTHORIZATION_STORE_UNAVAILABLE'
  | 'OPERATOR_CANCELLED'
  | 'REHEARSAL_FAILED'
  | 'LIVE_EXECUTION_DISABLED'

const limitations = [
  'O gate não aciona rede. A CLI desta entrega não tem autoridade ou credencial real configurada.',
  'A evidência assinada do teto externo descreve uma verificação do operador dentro da validade indicada.',
  'A integridade é uma leitura local. A ativação futura precisa de checkout e dependências isolados, protegidos contra alterações concorrentes.',
  'A reserva local e o cancelamento não garantem o valor da cobrança externa.',
] as const

type Preparation = Awaited<ReturnType<typeof prepareExternalCanary>>
type UseStatus = 'not_checked' | 'available' | 'consumed' | 'unavailable'

export interface CanaryOperationalReport {
  readonly reportVersion: 1
  readonly plan: Pick<Preparation, 'manifestFingerprint' | 'status' | 'issues' | 'requirements'>
    & { experimentId?: string; datasetId?: string; scenarioId?: string; modelId?: string; providerId?: string; approvedCodeRevision?: string }
  readonly source?: CanarySourceIntegrity
  readonly approval?: { authorizationId: string; authorityId: string; scope: string; expiresAt: string }
  readonly checks: {
    manifestValid: boolean
    preflightPassed: boolean
    attestationsComplete: boolean
    sourceMatches: boolean
    approvalAuthenticated: boolean
    approvalMatchesPlan: boolean
    approvalCurrent: boolean
    providerAccountLimitVerified: boolean
    credentialAvailable: boolean
  }
  readonly authorizationUse: UseStatus
  readonly blockers: readonly CanaryOperationalBlocker[]
  readonly rehearsalEligible: boolean
  readonly rehearsal?: NonNullable<Preparation['rehearsal']>
  readonly financial: {
    manifestBudgetUsd?: number
    authorityBudgetUsd?: number
    providerAccountLimitUsd?: number
    estimatedReservationUsd?: number
    effectiveCharge: 'not_verified'
  }
  readonly stopCriteria: readonly string[]
  readonly experimentAuthorized: false
  readonly experimentExecuted: false
  readonly executionAllowed: false
  readonly networkAllowed: false
  readonly limitations: typeof limitations
}

export interface CanaryOperationalInput {
  readonly manifest: unknown
  readonly review?: unknown
  readonly approval?: unknown
}

async function inspectOperations(input: CanaryOperationalInput, deps: CanaryOperationDependencies) {
  const blockers = new Set<CanaryOperationalBlocker>()
  const approval = authenticateCanaryApproval(input.approval, deps.authorities)
  const prep = await prepareExternalCanary(input.manifest, input.review)
  const validated = externalCanaryManifestSchema.safeParse(prep.draft)
  const manifest = validated.success ? validated.data : undefined
  const attestationsComplete = externalCanaryReviewItems.every((item) => prep.requirements[item] === 'attested')
  if (!manifest) blockers.add('MANIFEST_INVALID')
  if (!attestationsComplete || !prep.technicalPreparationComplete) blockers.add('MANIFEST_NOT_APPROVED')
  if (!approval) blockers.add(deps.authorities.size ? 'APPROVAL_INVALID' : 'APPROVAL_AUTHORITY_UNCONFIGURED')

  let approvalMatchesPlan = false
  let approvalCurrent = false
  let providerAccountLimitVerified = false
  let credentialAvailable = false
  let authorizationUse: UseStatus = 'not_checked'
  let source: CanarySourceIntegrity | undefined

  if (approval !== undefined) {
    const now = deps.now?.() ?? Date.now()
    const issued = Date.parse(approval.issuedAt)
    const expiry = Date.parse(approval.expiresAt)
    if (!Number.isFinite(now) || expiry <= issued || expiry <= now) blockers.add('APPROVAL_EXPIRED')
    else if (issued > now) blockers.add('APPROVAL_NOT_YET_VALID')
    else approvalCurrent = true

    authorizationUse = await deps.useStore.status(approval.useId)
    if (authorizationUse === 'consumed') blockers.add('AUTHORIZATION_ALREADY_CONSUMED')
    if (authorizationUse === 'unavailable') blockers.add('AUTHORIZATION_STORE_UNAVAILABLE')

    if (manifest !== undefined) {
      const synthetic = manifest.purpose === 'synthetic_rehearsal'
      const matchesFingerprint = approval.manifestFingerprint === prep.manifestFingerprint
      const matchesScope = approval.scope === (synthetic ? 'synthetic_canary_once' : 'external_canary_once') &&
        approval.experimentId === manifest.experimentId &&
        approval.dataset.id === manifest.dataset.id &&
        approval.dataset.version === manifest.dataset.version &&
        approval.dataset.fingerprint === manifest.dataset.fingerprint &&
        approval.scenarioIds[0] === manifest.scenarioIds[0] &&
        approval.modelId === manifest.modelId &&
        approval.providerId === manifest.routing.providerId
      const matchesBudget = approval.approvedBudgetUsd === manifest.maxBudgetUsd
      const matchesRevision = approval.sourceRevision === manifest.sourceRevision
      if (!matchesFingerprint) blockers.add('APPROVAL_FINGERPRINT_MISMATCH')
      if (!matchesScope) blockers.add('CANARY_SCOPE_MISMATCH')
      if (!matchesBudget) blockers.add('APPROVAL_BUDGET_MISMATCH')
      if (!matchesRevision) blockers.add('SOURCE_REVISION_MISMATCH')
      approvalMatchesPlan = matchesFingerprint && matchesScope && matchesBudget && matchesRevision

      const limit = approval.providerSpendLimit
      providerAccountLimitVerified = limit !== undefined && approvalMatchesPlan && approvalCurrent &&
        limit.origin === (synthetic ? 'synthetic_fixture' : 'operator_account_console') &&
        limit.providerId === manifest.routing.providerId &&
        limit.manifestFingerprint === prep.manifestFingerprint &&
        Date.parse(limit.verifiedAt) <= issued &&
        Date.parse(limit.validUntil) > now &&
        prep.budget !== undefined &&
        limit.limitUsd <= approval.approvedBudgetUsd &&
        limit.limitUsd >= prep.budget.reservedUsdTotal
    }
  }
  if (!providerAccountLimitVerified) blockers.add('PROVIDER_ACCOUNT_LIMIT_UNVERIFIED')

  if (manifest !== undefined) {
    if (manifest.purpose === 'synthetic_rehearsal') {
      try {
        credentialAvailable = await deps.credentials?.resolve({
          experimentId: manifest.experimentId,
          modelId: manifest.modelId,
          providerId: manifest.routing.providerId,
        }) === syntheticCredential
      } catch {
        // O mecanismo de segredo nunca fornece texto de diagnóstico.
      }
    }
    source = await inspectCanarySource(deps.repositoryRoot, manifest.sourceRevision)
    for (const issue of source.issues) blockers.add(issue)
    if (approval !== undefined && source.worktreeFingerprint !== approval.worktreeFingerprint) {
      blockers.add('APPROVAL_WORKTREE_MISMATCH')
    }
    if (approval !== undefined && source.dependenciesFingerprint !== approval.dependenciesFingerprint) {
      blockers.add('APPROVAL_DEPENDENCIES_MISMATCH')
    }
  }
  if (!credentialAvailable) blockers.add('CREDENTIAL_UNAVAILABLE')

  const rehearsalEligible = blockers.size === 0 && manifest?.purpose === 'synthetic_rehearsal'
  const report: CanaryOperationalReport = {
    reportVersion: 1,
    plan: {
      manifestFingerprint: prep.manifestFingerprint,
      status: prep.status,
      issues: prep.issues,
      requirements: prep.requirements,
      experimentId: prep.draft?.experimentId,
      datasetId: prep.draft?.dataset.id,
      scenarioId: prep.draft?.scenarioIds[0],
      modelId: prep.draft?.modelId,
      providerId: prep.draft?.routing?.providerId,
      approvedCodeRevision: approval?.sourceRevision,
    },
    source,
    approval: approval && {
      authorizationId: approval.authorizationId,
      authorityId: approval.authorityId,
      scope: approval.scope,
      expiresAt: approval.expiresAt,
    },
    checks: {
      manifestValid: manifest !== undefined,
      preflightPassed: prep.technicalPreparationComplete,
      attestationsComplete,
      sourceMatches: source !== undefined && source.issues.length === 0 &&
        (approval === undefined || (source.commit === approval.sourceRevision &&
          source.worktreeFingerprint === approval.worktreeFingerprint &&
          source.dependenciesFingerprint === approval.dependenciesFingerprint)),
      approvalAuthenticated: approval !== undefined,
      approvalMatchesPlan,
      approvalCurrent,
      providerAccountLimitVerified,
      credentialAvailable,
    },
    authorizationUse,
    blockers: [...blockers, 'LIVE_EXECUTION_DISABLED'],
    rehearsalEligible,
    financial: {
      manifestBudgetUsd: manifest?.maxBudgetUsd,
      authorityBudgetUsd: approval?.approvedBudgetUsd,
      providerAccountLimitUsd: providerAccountLimitVerified ? approval?.providerSpendLimit?.limitUsd : undefined,
      estimatedReservationUsd: prep.budget?.reservedUsdTotal,
      effectiveCharge: 'not_verified',
    },
    stopCriteria: prep.draft?.stopCriteria ?? [],
    experimentAuthorized: false,
    experimentExecuted: false,
    executionAllowed: false,
    networkAllowed: false,
    limitations,
  }
  return { report, manifest, approval }
}

export async function verifyCanaryOperations(input: CanaryOperationalInput, deps: CanaryOperationDependencies) {
  return (await inspectOperations(input, deps)).report
}

export async function rehearseCanaryActivation(
  input: CanaryOperationalInput,
  deps: CanaryOperationDependencies,
  options: { transport: InMemoryOpenRouterTransport; signal?: AbortSignal },
): Promise<CanaryOperationalReport> {
  const { report, manifest, approval } = await inspectOperations(input, deps)
  if (!report.rehearsalEligible || !manifest || !approval) return report
  if (options.signal?.aborted) {
    return { ...report, rehearsalEligible: false, blockers: [...report.blockers, 'OPERATOR_CANCELLED'] }
  }
  const use = await deps.useStore.consume(approval.useId)
  if (use !== 'reserved') {
    return {
      ...report,
      rehearsalEligible: false,
      authorizationUse: use,
      blockers: [...report.blockers, use === 'consumed' ? 'AUTHORIZATION_ALREADY_CONSUMED' : 'AUTHORIZATION_STORE_UNAVAILABLE'],
    }
  }

  const consumed = { ...report, rehearsalEligible: false, authorizationUse: 'consumed' as const }
  const now = deps.now?.() ?? Date.now()
  if (!Number.isFinite(now) || Date.parse(approval.expiresAt) <= now) {
    return { ...consumed, blockers: [...report.blockers, 'APPROVAL_EXPIRED'] }
  }
  if (approval.providerSpendLimit === undefined || Date.parse(approval.providerSpendLimit.validUntil) <= now) {
    return { ...consumed, blockers: [...report.blockers, 'PROVIDER_ACCOUNT_LIMIT_UNVERIFIED'] }
  }
  try {
    const { rehearsal } = await rehearseExternalCanary(manifest, options)
    if (rehearsal !== undefined) return {
      ...consumed,
      rehearsal,
      blockers: options.signal?.aborted ? [...consumed.blockers, 'OPERATOR_CANCELLED'] : consumed.blockers,
    }
  } catch {
    // A autorização fica consumida mesmo se o ensaio falhar antes de retornar.
  }
  return { ...consumed, blockers: [...report.blockers, 'REHEARSAL_FAILED'] }
}
