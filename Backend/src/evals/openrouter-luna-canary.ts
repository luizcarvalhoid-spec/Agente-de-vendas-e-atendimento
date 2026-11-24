import { createHash } from 'node:crypto'
import { lstat, realpath } from 'node:fs/promises'
import { z } from 'zod'

import { AgentModelError, type AgentModelPort } from '../agent/agent-model-port.js'
import { chatCompletionsAgentModelModuleUrl, createChatCompletionsAgentModel } from '../agent/chat-completions-agent-model.js'
import {
  awaitWithAbort, chatCompletionsModuleUrl, createOpenRouterClient, OPENROUTER_CHAT_COMPLETIONS_ENDPOINT,
  readResponseBodyWithinLimit,
} from '../agent/chat-completions-client.js'
import { isInMemoryChatTransport } from '../agent/in-memory-chat-transport.js'
import {
  authenticateCanaryApproval, canaryApprovalSigningBytes, type CanaryApprovalPayload, type CanaryAuthorityRegistry,
} from './external-canary-approval.js'
import { configuredCanaryAuthorities } from './external-canary-authorities.js'
import { createCanaryRuntimeSourceInspector, inspectCanarySource } from './external-canary-integrity.js'
import { inspectCanaryOperationGate, type CanaryOperationalInput } from './external-canary-operations.js'
import type { ExternalCanaryManifest } from './external-canary-schema.js'
import { CanaryAuthorizationUseStore } from './external-canary-use-store.js'
import { externalCanaryPlanRequest, fingerprintExternalCanaryManifest } from './external-canary.js'
import { evaluateCanaryModel, type InMemoryOpenRouterTransport } from './external-eval-runner.js'
import { loadOpenRouterCanaryCredential, openRouterCanaryCredentialModuleUrl } from './openrouter-canary-credential.js'

const modelId = 'openai/gpt-6-luna'
const providerId = 'azure'
const syntheticCredential = 'test-fixture-only-never-a-real-key'
const keyEndpoint = 'https://openrouter.ai/api/v1/key'
const authorizationDirectory = '/var/lib/openrouter-canary/authorizations'
const inspectRuntime = createCanaryRuntimeSourceInspector([
  [import.meta.url, 'evals/openrouter-luna-canary.ts'],
  [openRouterCanaryCredentialModuleUrl, 'evals/openrouter-canary-credential.ts'],
  [chatCompletionsModuleUrl, 'agent/chat-completions-client.ts'],
  [chatCompletionsAgentModelModuleUrl, 'agent/chat-completions-agent-model.ts'],
  [new URL('./external-canary-operations.ts', import.meta.url).href, 'evals/external-canary-operations.ts'],
  [new URL('./external-canary-approval.ts', import.meta.url).href, 'evals/external-canary-approval.ts'],
  [new URL('./external-canary-use-store.ts', import.meta.url).href, 'evals/external-canary-use-store.ts'],
])

type Deployment = {
  authorities: CanaryAuthorityRegistry
  serviceUid: number
}

// A implantação futura depende de revisão separada de isolamento e da autoridade.
function configuredDeployment(): Deployment | undefined {
  return undefined
}

async function verifyService(deployment: Deployment | undefined) {
  if (!deployment || process.platform !== 'linux' || deployment.serviceUid <= 0 ||
      process.getuid?.() !== deployment.serviceUid) return false
  try {
    const directory = await lstat(authorizationDirectory)
    return directory.isDirectory() && directory.uid === deployment.serviceUid &&
      (directory.mode & 0o077) === 0 && await realpath(authorizationDirectory) === authorizationDirectory
  } catch {
    return false
  }
}

function scopedManifest(manifest: ExternalCanaryManifest, fixture: boolean) {
  const { routing, limits, dataset } = manifest
  return manifest.purpose === (fixture ? 'synthetic_rehearsal' : 'external_candidate') &&
    manifest.experimentId === 'first-commercial-canary-gpt-6-luna-openrouter' &&
    dataset.id === 'hidrasplash-luna-commercial-canary' && dataset.version === '1.0.0' &&
    dataset.fingerprint === 'sha256:6deda7968a92d74565ae94f258afb69f3c96866ccc00016cf8879bd53da61bfe' &&
    manifest.scenarioIds[0] === 'hidrasplash.canary.antidandruff-clarification.001' &&
    manifest.modelId === modelId && routing.providerId === providerId &&
    routing.reasoningEffort === 'none' && routing.serviceTier === 'default' && routing.zeroDataRetention &&
    routing.dataCollection === 'deny' && routing.requireParameters && routing.allowFallbacks === false &&
    manifest.maxBudgetUsd === 1 && manifest.unreportedUsageMultiplier === 1.25 &&
    limits.maxModelCalls === 2 && limits.maxInputTokensPerCall === 20_000 && limits.maxOutputTokensPerCall === 512 &&
    limits.maxExecutionTokens === 41_024 && limits.timeoutMs === 15_000 && limits.effectiveTimeoutMs === 15_000
}

function checkEvidence(approval: CanaryApprovalPayload | undefined, manifest: ExternalCanaryManifest | undefined, reserve: number | undefined, now: number) {
  const issued = approval ? Date.parse(approval.issuedAt) : NaN
  const validAt = (item: { verifiedAt: string; validUntil: string }) =>
    Date.parse(item.verifiedAt) <= issued && now < Date.parse(item.validUntil)
  const evidence = approval?.openRouterEvidence
  const limit = approval?.providerSpendLimit
  const terms = evidence?.pricing
  return {
    APPROVAL_NOT_CURRENT: approval !== undefined && Number.isFinite(now) && issued <= now && now < Date.parse(approval.expiresAt),
    ROUTING_FAMILY_DECISION_REQUIRED: evidence?.routingDecision !== undefined && validAt(evidence.routingDecision),
    PRIVACY_EVIDENCE_REQUIRED: evidence?.privacy !== undefined && validAt(evidence.privacy),
    PROVIDER_ACCOUNT_LIMIT_UNVERIFIED: limit !== undefined && limit.limitUsd === 1 && validAt(limit) &&
      evidence?.account !== undefined && validAt(evidence.account) && reserve !== undefined &&
      evidence.account.availableCreditsUsd >= reserve,
    PRICE_REVALIDATION_REQUIRED: terms !== undefined && manifest !== undefined && validAt(terms) &&
      Date.parse(manifest.pricing.confirmedAt) <= Date.parse(terms.verifiedAt) &&
      manifest.pricing.inputUsdPerMillionTokens >= Math.max(
        terms.maximumPromptUsdPerMillion, terms.maximumCacheReadUsdPerMillion, terms.maximumCacheWriteUsdPerMillion,
      ) && manifest.pricing.outputUsdPerMillionTokens >= terms.maximumOutputUsdPerMillion,
  }
}

const keyResponse = z.object({ data: z.object({
  limit: z.literal(1),
  limit_reset: z.null(),
  limit_remaining: z.number().finite().min(0).max(1),
  is_free_tier: z.literal(false),
  is_management_key: z.literal(false),
  is_provisioning_key: z.literal(false),
  effective_budget: z.object({ remaining_usd: z.number().finite().nonnegative() }).nullish(),
}) })

type Context = {
  authorities: CanaryAuthorityRegistry
  useStore: CanaryAuthorizationUseStore
  fixtureRoot?: string
  enabled: boolean
  inspectSource: typeof inspectRuntime
  verifyIsolation(): Promise<boolean>
  loadCredential(): Promise<string | undefined>
  now(): number
}

function operationalContext(): Context {
  const deployment = configuredDeployment()
  return {
    enabled: deployment !== undefined,
    authorities: deployment?.authorities ?? configuredCanaryAuthorities,
    useStore: new CanaryAuthorizationUseStore(authorizationDirectory),
    inspectSource: inspectRuntime,
    verifyIsolation: () => verifyService(deployment),
    loadCredential: loadOpenRouterCanaryCredential,
    now: Date.now,
  }
}

async function inspect(input: CanaryOperationalInput, context: Context) {
  const fixture = context.fixtureRoot !== undefined
  const { report: base, manifest, approval, budget } = await inspectCanaryOperationGate(
    input, context,
    context.fixtureRoot === undefined
      ? { kind: 'loaded_runtime', inspect: context.inspectSource }
      : { kind: 'synthetic_fixture', root: context.fixtureRoot },
    'openrouter_luna',
  )
  const source = base.source ?? await context.inspectSource()
  const blockers = new Set<string>([...base.blockers, ...source.issues])
  const isolationVerified = await context.verifyIsolation()
  if (!context.enabled) blockers.add('LIVE_EXECUTION_DISABLED')
  if (!isolationVerified) blockers.add('ISOLATED_ENVIRONMENT_UNVERIFIED')
  if (manifest && !scopedManifest(manifest, fixture)) blockers.add('CANARY_SCOPE_MISMATCH')
  const evidence = checkEvidence(approval, manifest, budget?.reservedUsdTotal, context.now())
  for (const [code, passed] of Object.entries(evidence)) {
    if (!passed && (code !== 'APPROVAL_NOT_CURRENT' || approval)) blockers.add(code)
  }
  return { manifest, approval, budget, blockers, report: {
    reportVersion: 1,
    provenance: fixture ? 'synthetic_fixture' : 'openrouter_operational',
    plan: base.plan,
    source: {
      loadedRevision: source.runtimeCommit, inspectedRevision: source.commit, approvedRevision: approval?.sourceRevision,
      worktreeFingerprint: source.worktreeFingerprint, lockfileFingerprint: source.lockfileFingerprint,
      dependenciesFingerprint: source.dependenciesFingerprint,
    },
    authorizationUse: base.authorizationUse,
    checks: { ...base.checks, isolationVerified, providerAccountLimitVerified: false,
      signedAccountEvidenceAccepted: base.checks.providerAccountLimitVerified && evidence.PROVIDER_ACCOUNT_LIMIT_UNVERIFIED,
      routingFamilyAccepted: evidence.ROUTING_FAMILY_DECISION_REQUIRED,
      privacyVerified: evidence.PRIVACY_EVIDENCE_REQUIRED, pricesVerified: evidence.PRICE_REVALIDATION_REQUIRED },
    credential: 'not_checked' as 'not_checked' | 'available' | 'unavailable',
    financial: { ...base.financial },
    preflight: blockers.size === 0 ? 'ready_for_credential_check' : 'blocked',
    accountCheckAttempts: 0,
    completionAttempts: 0,
    realInferenceAttempts: 0,
    networkAllowed: false,
    providerFamilyObserved: false,
    endpointIdentity: 'unverified',
    execution: undefined as Awaited<ReturnType<typeof evaluateCanaryModel>> | undefined,
  } }
}

export async function verifyOpenRouterLunaCanary(input: CanaryOperationalInput) {
  const { blockers, report } = await inspect(input, operationalContext())
  return { ...report, blockers: [...blockers] }
}

type ObserveResponse = (message: string) => Promise<void>

export function executeOpenRouterLunaCanary(input: CanaryOperationalInput, signal?: AbortSignal, observe?: ObserveResponse) {
  return run(input, operationalContext(), (url, init) => globalThis.fetch(url, init), signal, observe)
}

export function rehearseOpenRouterLunaCanary(input: CanaryOperationalInput, fixture: {
  authorities: CanaryAuthorityRegistry
  useStore: CanaryAuthorizationUseStore
  fixtureRoot: string
  transport: InMemoryOpenRouterTransport
  credentialAvailable: boolean
  now?: () => number
  signal?: AbortSignal
  observe?: ObserveResponse
}) {
  if (typeof fixture.fixtureRoot !== 'string' || !isInMemoryChatTransport(fixture.transport)) {
    throw new TypeError('O ensaio exige fonte sintética e transporte em memória.')
  }
  return run(input, {
    ...fixture, enabled: true,
    inspectSource: (revision) => revision === undefined ? Promise.resolve({ issues: [] }) : inspectCanarySource(fixture.fixtureRoot, revision),
    async verifyIsolation() { return true },
    async loadCredential() { return fixture.credentialAvailable ? syntheticCredential : undefined },
    now: fixture.now ?? Date.now,
  }, fixture.transport, fixture.signal, fixture.observe)
}

async function run(input: CanaryOperationalInput, context: Context, dispatch: typeof fetch, signal?: AbortSignal, observe?: ObserveResponse) {
  const { report, manifest, approval, budget, blockers } = await inspect(input, context)
  if (signal?.aborted) blockers.add('OPERATOR_CANCELLED')
  const finish = () => ({
    ...report, blockers: [...blockers],
    realInferenceAttempts: context.fixtureRoot === undefined ? report.completionAttempts : 0,
    networkAllowed: context.fixtureRoot === undefined && report.accountCheckAttempts > 0,
  })
  if (blockers.size || !manifest || !approval || !budget) return finish()
  const approvedBytes = canaryApprovalSigningBytes(approval)
  let reserved = false
  let credential: string | undefined
  let stopped = false
  let finalResponse: string | undefined

  function stop(reason: string, code: 'CONFIGURATION_INVALID' | 'MODEL_CANCELLED' | 'MODEL_TIMEOUT' = 'CONFIGURATION_INVALID'): never {
    blockers.add(reason)
    throw new AgentModelError(code, false)
  }

  function checkSignal(active: AbortSignal) {
    if (signal?.aborted) stop('OPERATOR_CANCELLED', 'MODEL_CANCELLED')
    if (active.aborted) stop('CANARY_TIMEOUT', 'MODEL_TIMEOUT')
  }

  const revalidateEvidence = (active: AbortSignal) => {
    checkSignal(active)
    const reauthenticated = authenticateCanaryApproval(input.approval, context.authorities)
    if (!reauthenticated || !canaryApprovalSigningBytes(reauthenticated).equals(approvedBytes) ||
        fingerprintExternalCanaryManifest(manifest) !== approval.manifestFingerprint) {
      stop('APPROVAL_INVALID')
    }
    const invalid = Object.entries(checkEvidence(approval, manifest, budget.reservedUsdTotal, context.now()))
      .filter(([, passed]) => !passed)
    for (const [code] of invalid) blockers.add(code)
    if (invalid.length) stop('APPROVAL_EVIDENCE_INVALID_BEFORE_TRANSPORT')
  }

  const model: AgentModelPort = {
    async complete(modelInput) {
      if (stopped) throw new AgentModelError('CONFIGURATION_INVALID', false)
      const active = AbortSignal.any([modelInput.signal, AbortSignal.timeout(manifest.limits.timeoutMs)])
      const revalidate = async () => {
        revalidateEvidence(active)
        const source = await context.inspectSource(manifest.sourceRevision)
        if (source.issues.length || source.commit !== approval.sourceRevision ||
            source.worktreeFingerprint !== approval.worktreeFingerprint ||
            source.dependenciesFingerprint !== approval.dependenciesFingerprint ||
            (context.fixtureRoot === undefined && source.runtimeCommit !== approval.sourceRevision)) {
          stop('APPROVAL_SOURCE_MISMATCH')
        }
        if (!await context.verifyIsolation()) stop('ISOLATED_ENVIRONMENT_UNVERIFIED')
        revalidateEvidence(active)
      }
      try {
        if (report.completionAttempts >= manifest.limits.maxModelCalls) stop('MODEL_CALL_LIMIT')
        await revalidate()
        if (!reserved) {
          credential = await context.loadCredential()
          if (credential === undefined || `sha256:${createHash('sha256').update(credential).digest('hex')}` !==
              approval.openRouterEvidence?.account?.keyFingerprint) {
            report.credential = 'unavailable'
            stop('CREDENTIAL_UNAVAILABLE')
          }
          report.credential = 'available'
          report.checks.credentialAvailable = true
          revalidateEvidence(active)
          const use = await context.useStore.consume(approval.useId)
          if (use !== 'reserved') stop(use === 'consumed' ? 'AUTHORIZATION_ALREADY_CONSUMED' : 'AUTHORIZATION_STORE_UNAVAILABLE')
          reserved = true
          report.authorizationUse = 'consumed'
        }
        if (await context.useStore.status(approval.useId) !== 'consumed') stop('AUTHORIZATION_STORE_UNAVAILABLE')
        revalidateEvidence(active)
        const apiKey = credential ?? stop('CREDENTIAL_UNAVAILABLE')
        const headers = { Authorization: `Bearer ${apiKey}` }
        report.checks.providerAccountLimitVerified = false
        report.accountCheckAttempts += 1
        try {
          const response = await awaitWithAbort(() => dispatch(keyEndpoint, { method: 'GET', headers, signal: active, redirect: 'error' }), active)
          if (!response.ok) {
            void response.body?.cancel().catch(() => undefined)
            stop('KEY_CONFIGURATION_UNVERIFIED')
          }
          const { data } = keyResponse.parse(JSON.parse(await readResponseBodyWithinLimit(response, active)))
          const remaining = Number((budget.reservedUsdPerCall * (manifest.limits.maxModelCalls - report.completionAttempts)).toFixed(8))
          if (data.limit_remaining < remaining || (data.effective_budget && data.effective_budget.remaining_usd < remaining)) {
            stop('KEY_BALANCE_INSUFFICIENT')
          }
          report.checks.providerAccountLimitVerified = true
        } catch (error) {
          checkSignal(active)
          if (error instanceof AgentModelError) throw error
          stop('KEY_CONFIGURATION_UNVERIFIED')
        }
        await revalidate()
        if (await context.useStore.status(approval.useId) !== 'consumed') stop('AUTHORIZATION_STORE_UNAVAILABLE')
        let currentFamilyObserved = false
        const client = createOpenRouterClient({
          apiKey, model: modelId, evaluationRouting: manifest.routing,
          timeoutMs: manifest.limits.timeoutMs, maxOutputTokens: manifest.limits.maxOutputTokensPerCall,
          async transport(url, init) {
            revalidateEvidence(active)
            if (String(url) !== OPENROUTER_CHAT_COMPLETIONS_ENDPOINT || init?.method !== 'POST' ||
                init.signal?.aborted || report.completionAttempts >= manifest.limits.maxModelCalls) {
              stop('TRANSPORT_SCOPE_MISMATCH')
            }
            report.completionAttempts += 1
            return dispatch(OPENROUTER_CHAT_COMPLETIONS_ENDPOINT, { ...init, redirect: 'error' })
          },
        })
        const result = await createChatCompletionsAgentModel(client, {
          expectedModelId: modelId,
          onObservation(observation) {
            if (!observation.modelIdentityMatches) blockers.add('MODEL_IDENTITY_MISMATCH')
            // O catálogo publica o slug e o nome da família. Nenhum deles identifica um endpoint.
            currentFamilyObserved = observation.providerId === providerId || observation.providerId === 'Azure'
            if (!currentFamilyObserved) blockers.add('PROVIDER_FAMILY_UNVERIFIED')
            report.providerFamilyObserved ||= currentFamilyObserved
          },
        }).complete({ ...modelInput, signal: active })
        if (!currentFamilyObserved) throw new AgentModelError('INVALID_MODEL_RESPONSE', true)
        if (result.usage && (result.usage.inputTokens > manifest.limits.maxInputTokensPerCall ||
            result.usage.outputTokens > manifest.limits.maxOutputTokensPerCall)) {
          blockers.add('USAGE_EXCEEDED_RESERVATION')
          stopped = true
        }
        return result
      } catch (error) {
        stopped = true
        if (error instanceof AgentModelError && error.code === 'MODEL_TIMEOUT') blockers.add('CANARY_TIMEOUT')
        throw error
      }
    },
  }
  try {
    report.execution = await evaluateCanaryModel(externalCanaryPlanRequest(manifest, 'mock_external'), {
      model, datasetFingerprint: manifest.dataset.fingerprint, signal,
      observeResponse: observe && ((message) => { finalResponse = message }),
    })
    if (report.execution.execution.technicalStatus === 'technical_failure') blockers.add('TECHNICAL_FAILURE')
    if (report.execution.execution.limitsReached.includes('reported_usage_exceeded_reservation')) blockers.add('USAGE_EXCEEDED_RESERVATION')
    if (report.execution.modelCalls.some((call) => call.errorCode === 'MODEL_TIMEOUT')) blockers.add('CANARY_TIMEOUT')
  } catch {
    blockers.add('TECHNICAL_FAILURE')
  }
  if (signal?.aborted) blockers.add('OPERATOR_CANCELLED')
  if (observe && finalResponse !== undefined && report.completionAttempts > 0 && blockers.size === 0) {
    try {
      const message = credential ? finalResponse.replaceAll(credential, '[REDACTED]') : finalResponse
      await observe(message)
    } catch {
      blockers.add('INTERACTIVE_OBSERVATION_FAILED')
    }
  }
  return finish()
}
