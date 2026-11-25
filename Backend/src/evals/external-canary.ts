import { ZodError } from 'zod'

import {
  TOOL_ORCHESTRATOR_MAX_MODEL_CALLS,
  TOOL_ORCHESTRATOR_TIMEOUT_MS,
} from '../agent/tool-orchestrator.js'
import { fingerprintEvalDataset, fingerprintEvalValue } from './eval-baseline.js'
import {
  EXTERNAL_CANARY_VERSION,
  externalCanaryDraftSchema,
  externalCanaryManifestSchema,
  externalCanaryReviewItems,
  externalCanaryReviewSchema,
  type ExternalCanaryDraft,
  type ExternalCanaryManifest,
} from './external-canary-schema.js'
import { estimateExternalEvalCost, externalEvalWorstCaseCost } from './external-eval-cost.js'
import { planExternalEval } from './external-eval-plan.js'
import {
  runSimulatedOpenRouterExternalEval,
  type InMemoryOpenRouterTransport,
} from './external-eval-runner.js'
import type { ExternalEvalPlanRequest, ExternalEvalReport } from './external-eval-schema.js'

export const externalCanaryModuleUrl = import.meta.url

const checklist = [
  'Usar ambiente e conta isolados de produção, com teto financeiro verificado na conta.',
  'Conferir o commit, o fingerprint, o escopo, o preço vigente e a política de dados.',
  'Disponibilizar credencial apenas por mecanismo de segredos, fora do repositório, argumentos e logs.',
  'Manter transcrições, prompts, payloads HTTP e cabeçalhos brutos fora dos artefatos.',
  'Usar destino exclusivo, preservar os relatórios anteriores e preparar cancelamento operacional.',
  'Encerrar no primeiro erro técnico ou limite preventivo relevante. Evitar retries e fallback.',
  'Obter uma autorização específica para a execução em uma etapa de ativação revisada.',
] as const

const limitations = [
  'Atestações são declarações vinculadas ao fingerprint. O preflight offline não verifica preço, conta ou credencial junto ao provedor.',
  'Contagem de entrada e custo são estimativas locais. A cobrança externa pode divergir.',
  'A disponibilidade, o roteamento e a retenção efetiva do provedor exigem revisão antes de uma ativação.',
  'Um ensaio em memória cobre integração e evidência objetiva para um cenário. Qualidade subjetiva exige avaliação humana.',
] as const

type ReviewItem = typeof externalCanaryReviewItems[number]
type Requirement = ReviewItem | 'technical_configuration' | 'execution_authorization'
type Stage =
  | 'configuration_incomplete'
  | 'technical_preflight_passed'
  | 'financial_review_pending'
  | 'data_policy_review_pending'
  | 'authorization_pending'
  | 'ready_for_human_review'
  | 'blocked'

type PreparationIssue = { code: string; field?: string }
type CanaryBudget = {
  estimatedUsdPerCall: number
  estimatedUsdTotal: number
  reservedUsdPerCall: number
  reservedUsdTotal: number
  configuredMaxBudgetUsd: number
  approvedMaxBudgetUsd?: number
  preventiveBalanceUsd: number
  sufficient: boolean
}

function safeObservedId(value: string) {
  return /^[A-Za-z0-9._:/-]+$/.test(value) || /^\[[A-Z_]+_REDACTED\]$/.test(value)
    ? value
    : '[IDENTIFIER_REDACTED]'
}

const knownFinishReasons = new Set(['stop', 'length', 'tool_calls', 'content_filter', 'error'])

function summarizeRehearsal(report: ExternalEvalReport, operatorCancelled: boolean) {
  const { summary } = report.objectiveEvaluation
  return {
    provenance: 'simulated_external_transport' as const,
    evidence: 'not_real_model_performance' as const,
    executionId: report.executionId,
    technicalStatus: report.execution.technicalStatus,
    operatorCancelled,
    modelCalls: report.execution.modelCalls,
    toolCallsRequested: report.execution.toolCallsRequested,
    toolsExecuted: report.execution.toolsExecuted,
    limitsReached: report.execution.limitsReached,
    technicalErrorCodes: [...new Set(report.scenarios.flatMap((scenario) =>
      scenario.turns.flatMap((turn) => turn.technicalErrorCode === undefined ? [] : [turn.technicalErrorCode]),
    ))],
    returnedModelIds: report.model.returnedIds.map(safeObservedId),
    observedProviderIds: report.model.providerIds.map(safeObservedId),
    observations: report.model.observations.map((observation) => ({
      ...observation,
      generationId: safeObservedId(observation.generationId),
      returnedModelId: safeObservedId(observation.returnedModelId),
      ...(observation.providerId === undefined ? {} : { providerId: safeObservedId(observation.providerId) }),
      finishReason: observation.finishReason === null || knownFinishReasons.has(observation.finishReason)
        ? observation.finishReason
        : 'unrecognized',
    })),
    consumption: report.consumption,
    assertions: summary.assertions,
    criticalFailures: summary.criticalFailures,
    requiredHumanCriteriaPending: summary.requiredHumanCriteriaPending,
  }
}

export interface ExternalCanaryPreparation {
  readonly reportVersion: typeof EXTERNAL_CANARY_VERSION
  readonly status: Stage
  readonly stages: readonly Stage[]
  readonly technicalPreparationComplete: boolean
  readonly experimentAuthorized: false
  readonly experimentExecuted: false
  readonly executionAllowed: false
  readonly networkAllowed: false
  readonly draft?: ExternalCanaryDraft
  readonly manifestFingerprint?: string
  readonly issues: readonly PreparationIssue[]
  readonly requirements: Record<Requirement, 'passed' | 'attested' | 'pending'>
  readonly budget?: CanaryBudget
  readonly rehearsal?: ReturnType<typeof summarizeRehearsal>
  readonly checklist: typeof checklist
  readonly limitations: typeof limitations
}

export function fingerprintExternalCanaryManifest(input: unknown) {
  return fingerprintEvalValue(externalCanaryManifestSchema.parse(input))
}

const canaryPreparationConfigurationSchema = externalCanaryManifestSchema.omit({ sourceRevision: true })
type CanaryPreparationConfiguration = Omit<ExternalCanaryManifest, 'sourceRevision'>

export function externalCanaryPlanRequest(manifest: CanaryPreparationConfiguration, modality: 'dry_run' | 'mock_external') {
  const { effectiveTimeoutMs: _effectiveTimeoutMs, maxInputTokensPerCall, ...limits } = manifest.limits
  return {
    modality,
    datasetId: manifest.dataset.id,
    scenarioIds: manifest.scenarioIds,
    modelId: manifest.modelId,
    routing: manifest.routing,
    limits: { ...limits, estimatedInputTokensPerCall: maxInputTokensPerCall },
    pricing: manifest.pricing,
    maxBudgetUsd: manifest.maxBudgetUsd,
    unreportedUsageMultiplier: manifest.unreportedUsageMultiplier,
    outputDirectory: manifest.outputDirectory,
  } satisfies ExternalEvalPlanRequest
}

function budgetFor(manifest: CanaryPreparationConfiguration, locallyApproved: boolean): CanaryBudget {
  const request = externalCanaryPlanRequest(manifest, 'dry_run')
  const cost = {
    inputTokens: manifest.limits.maxInputTokensPerCall,
    outputTokens: manifest.limits.maxOutputTokensPerCall,
    inputUsdPerMillionTokens: manifest.pricing.inputUsdPerMillionTokens,
    outputUsdPerMillionTokens: manifest.pricing.outputUsdPerMillionTokens,
  }
  const reservedUsdTotal = externalEvalWorstCaseCost(request)!
  return {
    estimatedUsdPerCall: estimateExternalEvalCost(cost),
    estimatedUsdTotal: externalEvalWorstCaseCost({ ...request, unreportedUsageMultiplier: 1 })!,
    reservedUsdPerCall: estimateExternalEvalCost({
      ...cost,
      multiplier: manifest.unreportedUsageMultiplier,
    }),
    reservedUsdTotal,
    configuredMaxBudgetUsd: manifest.maxBudgetUsd,
    ...(locallyApproved ? { approvedMaxBudgetUsd: manifest.maxBudgetUsd } : {}),
    preventiveBalanceUsd: Math.max(0, Number((manifest.maxBudgetUsd - reservedUsdTotal).toFixed(8))),
    sufficient: reservedUsdTotal <= manifest.maxBudgetUsd,
  }
}

async function inspectCanary(input: unknown, reviewInput?: unknown) {
  const draft = externalCanaryDraftSchema.safeParse(input)
  const issues: PreparationIssue[] = []
  const requirements: ExternalCanaryPreparation['requirements'] = {
    technical_configuration: 'pending',
    price_and_source: 'pending',
    model_and_provider: 'pending',
    data_policy: 'pending',
    local_budget: 'pending',
    provider_account_spend_limit: 'pending',
    scope_and_scenario: 'pending',
    plan_and_fingerprint: 'pending',
    secure_credential_mechanism: 'pending',
    execution_authorization: 'pending',
  }
  const stages: Stage[] = []
  let status: Stage = 'blocked'
  let manifest: ExternalCanaryManifest | undefined
  let manifestFingerprint: string | undefined
  let budget: CanaryBudget | undefined

  if (!draft.success) {
    issues.push({ code: 'MANIFEST_INVALID' })
  } else {
    const complete = externalCanaryManifestSchema.safeParse(draft.data)
    if (!complete.success) {
      status = 'configuration_incomplete'
      stages.push(status)
      for (const issue of complete.error.issues) {
        // O rascunho estrito já rejeitou chaves desconhecidas.
        issues.push({ code: 'FIELD_REQUIRED', field: issue.path.join('.') })
      }
    } else {
      manifest = complete.data
      manifestFingerprint = fingerprintExternalCanaryManifest(manifest)
    }

    // Um plano com parâmetros completos pode ser estimado enquanto aguarda a revisão Git.
    const { sourceRevision: _sourceRevision, ...draftConfiguration } = draft.data
    const configuration = complete.success ? complete : canaryPreparationConfigurationSchema.safeParse(draftConfiguration)
    if (configuration.success) {
      const candidate = configuration.data
      const request = externalCanaryPlanRequest(candidate, 'dry_run')
      budget = budgetFor(candidate, false)
      if (candidate.limits.effectiveTimeoutMs !== Math.min(
        candidate.limits.timeoutMs,
        TOOL_ORCHESTRATOR_TIMEOUT_MS,
      )) {
        issues.push({ code: 'EFFECTIVE_TIMEOUT_MISMATCH', field: 'limits.effectiveTimeoutMs' })
      }
      if (candidate.limits.maxModelCalls > TOOL_ORCHESTRATOR_MAX_MODEL_CALLS) {
        issues.push({ code: 'ORCHESTRATOR_CALL_LIMIT_EXCEEDED', field: 'limits.maxModelCalls' })
      }
      const syntheticSource = new URL(candidate.pricing.source).hostname.endsWith('.invalid')
      if (syntheticSource !== (candidate.purpose === 'synthetic_rehearsal')) {
        issues.push({ code: 'PRICE_SOURCE_PURPOSE_MISMATCH', field: 'pricing.source' })
      }
      if (Date.parse(candidate.pricing.confirmedAt) > Date.now()) {
        issues.push({ code: 'PRICE_CONFIRMATION_IN_FUTURE', field: 'pricing.confirmedAt' })
      }

      try {
        const { plan, loaded } = await planExternalEval(request)
        issues.push(...plan.blockers.map(({ code }) => ({ code })))
        if (loaded !== undefined && (
          fingerprintEvalDataset(loaded) !== candidate.dataset.fingerprint ||
          loaded.data.dataset.id !== candidate.dataset.id ||
          loaded.data.dataset.version !== candidate.dataset.version
        )) {
          issues.push({ code: 'DATASET_FINGERPRINT_OR_VERSION_MISMATCH', field: 'dataset' })
        }
      } catch (error) {
        if (!(error instanceof ZodError)) throw error
        issues.push({ code: budget.sufficient ? 'PREFLIGHT_INVALID' : 'ESTIMATED_COST_EXCEEDS_BUDGET' })
      }
      if (manifest !== undefined && issues.length === 0) {
        requirements.technical_configuration = 'passed'
        stages.push('technical_preflight_passed')
        status = 'ready_for_human_review'
      }
    }
  }

  if (reviewInput !== undefined) {
    const review = externalCanaryReviewSchema.safeParse(reviewInput)
    if (!review.success) {
      issues.push({ code: 'REVIEW_INVALID' })
      status = 'blocked'
    } else if (review.data.manifestFingerprint !== manifestFingerprint) {
      issues.push({ code: 'REVIEW_FINGERPRINT_MISMATCH' })
      status = 'blocked'
    } else if (status === 'ready_for_human_review') {
      for (const item of review.data.attestations) requirements[item] = 'attested'
      if (manifest !== undefined && requirements.local_budget === 'attested') {
        budget = budgetFor(manifest, true)
      }
    }
  }

  const financialItems = ['price_and_source', 'local_budget', 'provider_account_spend_limit'] as const
  if (financialItems.some((item) => requirements[item] === 'pending')) {
    stages.push('financial_review_pending')
  }
  if (requirements.data_policy === 'pending') stages.push('data_policy_review_pending')
  stages.push('authorization_pending')
  if (!stages.includes(status)) stages.push(status)
  const report: ExternalCanaryPreparation = {
    reportVersion: EXTERNAL_CANARY_VERSION,
    status,
    stages,
    technicalPreparationComplete: requirements.technical_configuration === 'passed',
    experimentAuthorized: false,
    experimentExecuted: false,
    executionAllowed: false,
    networkAllowed: false,
    ...(draft.success ? { draft: draft.data } : {}),
    ...(manifestFingerprint === undefined ? {} : { manifestFingerprint }),
    ...(budget === undefined ? {} : { budget }),
    issues,
    requirements,
    checklist,
    limitations,
  }
  return { manifest, report }
}

export async function prepareExternalCanary(input: unknown, review?: unknown) {
  return (await inspectCanary(input, review)).report
}

export async function rehearseExternalCanary(
  input: unknown,
  options: { transport: InMemoryOpenRouterTransport; signal?: AbortSignal },
): Promise<ExternalCanaryPreparation> {
  const { manifest, report } = await inspectCanary(input)
  if (manifest?.purpose !== 'synthetic_rehearsal' || report.status !== 'ready_for_human_review') {
    return {
      ...report,
      status: 'blocked',
      stages: [...new Set([...report.stages, 'blocked' as const])],
      issues: [...report.issues, { code: 'SYNTHETIC_REHEARSAL_REQUIRED' }],
    }
  }
  const result = await runSimulatedOpenRouterExternalEval(externalCanaryPlanRequest(manifest, 'mock_external'), {
    transport: options.transport,
    canary: { datasetFingerprint: manifest.dataset.fingerprint, signal: options.signal },
  })
  return {
    ...report,
    rehearsal: summarizeRehearsal(result, options.signal?.aborted === true),
  }
}
