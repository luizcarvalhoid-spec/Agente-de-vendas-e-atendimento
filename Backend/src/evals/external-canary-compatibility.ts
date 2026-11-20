import { z } from 'zod'

import { sanitizeEvalReportText } from './eval-report-builder.js'
import { externalCanaryDraftSchema, type ExternalCanaryDraft } from './external-canary-schema.js'
import { estimateExternalEvalCost, externalEvalWorstCaseCost } from './external-eval-cost.js'

const sources = {
  model_page: 'https://openrouter.ai/openai/gpt-4.1-mini',
  model_endpoints: 'https://openrouter.ai/api/v1/models/openai/gpt-4.1-mini/endpoints',
  zdr_endpoints: 'https://openrouter.ai/api/v1/endpoints/zdr',
  provider_selection: 'https://openrouter.ai/docs/guides/routing/provider-selection',
  zdr_guide: 'https://openrouter.ai/docs/guides/features/zdr',
  chat_api: 'https://openrouter.ai/docs/api/api-reference/chat/send-chat-completion-request',
  metadata_example: 'https://openrouter.ai/docs/guides/features/guardrails/overview',
} as const
const sourceId = z.enum(Object.keys(sources) as Array<keyof typeof sources>)
const publicLabel = z.string().min(1).max(160).regex(/^[A-Za-z0-9 .|:/_-]+$/)
  .refine((value) => sanitizeEvalReportText(value) === value)
const identifier = publicLabel.regex(/^[a-z0-9][a-z0-9./_-]*$/)
const rate = z.number().positive().max(1_000_000)
const endpointSchema = z.strictObject({
  modelId: identifier,
  providerName: publicLabel,
  providerId: identifier.optional(),
  catalogEndpointId: identifier.optional(),
  routingSlug: identifier.optional(),
  label: publicLabel,
  scope: z.enum(['global_chat', 'regional_chat', 'batch']),
  zdr: z.enum(['confirmed', 'excluded', 'unverified']),
  listedInPublicZdr: z.boolean(),
  safetyRetention: z.boolean().optional(),
  retainsPrompts: z.boolean().optional(),
  training: z.boolean().optional(),
  parameters: z.array(z.string().regex(/^[a-z][a-z0-9_]{0,63}$/)).max(64),
  autoToolChoice: z.boolean().optional(),
  maxCompletionTokens: z.number().int().positive().optional(),
  pricing: z.strictObject({
    currency: z.literal('USD'),
    inputUsdPerMillionTokens: rate,
    outputUsdPerMillionTokens: rate,
  }).optional(),
  sources: z.array(sourceId).max(7),
})

export const canaryEndpointEvidenceSchema = z.strictObject({
  version: z.literal(1),
  provenance: z.enum(['public_catalog', 'synthetic_fixture']),
  accountPolicy: z.enum(['unverified', 'strict_zdr_only', 'allows_safety_retention']),
  observations: z.array(z.strictObject({ source: sourceId, observedAt: z.iso.datetime() })).max(7),
  endpoints: z.array(endpointSchema).max(30),
}).refine(({ provenance, accountPolicy }) => provenance === 'synthetic_fixture' || accountPolicy === 'unverified')

type Endpoint = z.infer<typeof endpointSchema>
const endpointParameters = ['max_completion_tokens', 'tools', 'tool_choice'] as const

function estimateEndpoint(endpoint: Endpoint, candidate: ExternalCanaryDraft) {
  const { pricing } = endpoint
  const { limits, unreportedUsageMultiplier, maxBudgetUsd } = candidate
  if (!pricing || !limits || unreportedUsageMultiplier === undefined || maxBudgetUsd === undefined ||
      endpoint.scope === 'batch') return undefined
  const costInputs = {
    ...pricing,
    inputTokens: limits.maxInputTokensPerCall,
    outputTokens: limits.maxOutputTokensPerCall,
  }
  const reservedUsdTotal = externalEvalWorstCaseCost({
    limits: { ...limits, estimatedInputTokensPerCall: limits.maxInputTokensPerCall },
    pricing,
    unreportedUsageMultiplier,
  })!
  return {
    estimatedUsdPerCall: estimateExternalEvalCost(costInputs),
    reservedUsdTotal,
    withinProposedBudget: reservedUsdTotal <= maxBudgetUsd,
    scope: 'documentary_estimate_only' as const,
  }
}

function assessEndpoint(endpoint: Endpoint, candidate: ExternalCanaryDraft) {
  const documentedBlockers: string[] = []
  if (!endpoint.catalogEndpointId || !endpoint.routingSlug || !endpoint.providerId) {
    documentedBlockers.push('ENDPOINT_IDENTIFIER_UNVERIFIED')
  }
  if (endpoint.scope !== 'global_chat') documentedBlockers.push('ENDPOINT_OUTSIDE_GLOBAL_CHAT_SCOPE')
  if (endpoint.zdr !== 'confirmed') {
    documentedBlockers.push(endpoint.zdr === 'excluded' ? 'ZDR_INCOMPATIBLE' : 'ZDR_UNVERIFIED')
  }
  if (endpoint.safetyRetention !== false) documentedBlockers.push('ENDPOINT_SAFETY_RETENTION_UNVERIFIED_OR_PRESENT')
  if (endpoint.retainsPrompts !== false || endpoint.training !== false) {
    documentedBlockers.push('ENDPOINT_DATA_POLICY_UNVERIFIED_OR_INCOMPATIBLE')
  }
  const missingParameters = endpointParameters.filter((parameter) => !endpoint.parameters.includes(parameter))
  if (missingParameters.length) documentedBlockers.push('REQUIRED_PARAMETERS_NOT_ADVERTISED')
  if (missingParameters.includes('max_completion_tokens') && endpoint.parameters.includes('max_tokens')) {
    documentedBlockers.push('MAX_TOKENS_ALIAS_UNVERIFIED')
  }
  if (endpoint.autoToolChoice !== true) documentedBlockers.push('TOOL_CHOICE_AUTO_UNVERIFIED_OR_UNSUPPORTED')
  if (candidate.limits && (endpoint.maxCompletionTokens ?? 0) < candidate.limits.maxOutputTokensPerCall) {
    documentedBlockers.push('OUTPUT_LIMIT_UNVERIFIED_OR_INSUFFICIENT')
  }
  const estimate = estimateEndpoint(endpoint, candidate)
  if (!endpoint.pricing) documentedBlockers.push('ENDPOINT_PRICING_UNVERIFIED')
  if (estimate?.withinProposedBudget === false) documentedBlockers.push('ESTIMATED_COST_EXCEEDS_BUDGET')
  return { ...endpoint, missingParameters, documentedBlockers, estimate }
}

function assessCandidate(
  draft: ExternalCanaryDraft,
  evidence: z.infer<typeof canaryEndpointEvidenceSchema>,
) {
  const { routing, pricing, modelId } = draft
  const endpoints = evidence.endpoints.filter((endpoint) => endpoint.modelId === modelId)
    .map((endpoint) => assessEndpoint(endpoint, draft))
  const relevant = endpoints.filter((endpoint) => routing !== undefined &&
    endpoint.providerId === routing.providerId && endpoint.scope !== 'batch')
  const blockers = new Set<string>(['LIVE_EXECUTION_DISABLED', 'RESPONSE_IDENTITY_UNVERIFIED'])
  if (routing?.dataCollection !== 'deny' || routing.zeroDataRetention !== true) {
    blockers.add('STRICT_DATA_POLICY_REQUIRED')
  }
  if (evidence.accountPolicy !== 'strict_zdr_only') blockers.add('ACCOUNT_STRICT_ZDR_UNVERIFIED_OR_INCOMPATIBLE')
  if (relevant.length === 0) blockers.add('PROVIDER_ID_UNVERIFIED')
  // O contrato v1 do canário seleciona uma família de provedor por slug base.
  // Um ID de catálogo ou uma única entrada observada não tornam essa seleção exata.
  blockers.add('EXACT_ENDPOINT_SELECTION_UNVERIFIED')
  if (!draft.sourceRevision) blockers.add('SOURCE_REVISION_PENDING')
  if (!pricing?.confirmedAt || !pricing.source) blockers.add('CANDIDATE_PRICING_PENDING')
  if (pricing && (
    pricing.modelId !== modelId || pricing.providerId !== routing?.providerId ||
    relevant.some((endpoint) => endpoint.pricing && (
      endpoint.pricing.inputUsdPerMillionTokens !== pricing.inputUsdPerMillionTokens ||
      endpoint.pricing.outputUsdPerMillionTokens !== pricing.outputUsdPerMillionTokens
    ))
  )) blockers.add('CANDIDATE_PRICING_MISMATCH')
  for (const endpoint of relevant) {
    for (const reason of endpoint.documentedBlockers) blockers.add(reason)
  }
  const reserves = relevant.flatMap((endpoint) => endpoint.estimate ? [endpoint.estimate.reservedUsdTotal] : [])
  return {
    experimentId: draft.experimentId,
    manifestStatus: draft.sourceRevision && pricing?.confirmedAt ? 'review_required' : 'configuration_incomplete',
    modelId,
    scenarioIds: draft.scenarioIds,
    dataset: draft.dataset,
    routing,
    limits: draft.limits,
    proposedBudgetUsd: draft.maxBudgetUsd,
    worstObservedReserveUsd: reserves.length && reserves.length === relevant.length ? Math.max(...reserves) : undefined,
    endpoints: relevant,
    blockers: [...blockers],
  }
}

export function compareCanaryEndpointEvidence(original: unknown, alternative: unknown, input: unknown) {
  const evidence = canaryEndpointEvidenceSchema.parse(input)
  const parsedOriginal = externalCanaryDraftSchema.parse(original)
  const parsedAlternative = externalCanaryDraftSchema.parse(alternative)
  if (!parsedOriginal.modelId || parsedOriginal.modelId !== parsedAlternative.modelId) {
    throw new TypeError('Compare candidatos do mesmo modelo explícito.')
  }
  return {
    reportVersion: 1,
    provenance: evidence.provenance,
    modelId: parsedOriginal.modelId,
    sourceObservations: evidence.observations.map(({ source, observedAt }) => ({
      source, url: sources[source], observedAt,
    })),
    references: sources,
    requestContract: { stream: false, endpointParameters, toolChoice: 'auto' },
    accountPolicy: evidence.accountPolicy,
    original: assessCandidate(parsedOriginal, evidence),
    alternative: assessCandidate(parsedAlternative, evidence),
    otherCatalogEntries: evidence.endpoints.filter((endpoint) =>
      endpoint.modelId === parsedOriginal.modelId && endpoint.scope === 'batch',
    ).map((endpoint) => assessEndpoint(endpoint, parsedOriginal)),
    responseIdentity: 'not_observed' as const,
    limitations: [
      'O slug base identifica a família do provedor. order e only com fallback desabilitado não fixam um endpoint dentro dessa família.',
      'O campo max_tokens anunciado por um endpoint não comprova a aceitação de max_completion_tokens pelo filtro require_parameters.',
      'stream: false é suportado pelo contrato Chat Completions. A compatibilidade combinada da requisição não foi exercitada no provedor.',
      'A lista pública ZDR e o indicador da página são evidências de catálogo. A política efetiva da conta ou do guardrail precisa ser conferida para excluir Safety Retention.',
      'O provedor e o endpoint efetivos permanecem desconhecidos. Nome de exibição, ID de catálogo e configuração enviada não são evidência de identidade observada.',
      'As estimativas comparam tarifas publicadas. O maior valor observado não é uma reserva autorizada para o canário.',
    ],
    recommendation: 'keep_external_execution_blocked' as const,
    networkAllowed: false,
    experimentAuthorized: false,
    experimentExecuted: false,
  }
}
