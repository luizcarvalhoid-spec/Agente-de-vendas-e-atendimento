import { randomUUID } from 'node:crypto'
import { z } from 'zod'

import { AgentModelError, type AgentModelPort } from '../agent/agent-model-port.js'
import { createChatService } from '../agent/chat-service.js'
import { createOpenRouterAgentModel } from '../agent/openrouter/openrouter-agent-model.js'
import {
  awaitWithAbort, createOpenRouterClient, OPENROUTER_CHAT_COMPLETIONS_ENDPOINT, readResponseBodyWithinLimit,
  type ChatCompletionResponseValidationFailure,
} from '../agent/chat-completions-client.js'
import { createProductSearchIndex } from '../agent/tools/product-tools.js'
import { loadCatalogRepository } from '../catalog/catalog-repository.js'
import { loadFaqDocuments } from '../knowledge/faq-content-loader.js'
import { createFaqSearchIndex } from '../knowledge/faq-search.js'
import { sanitizeEvalText } from './offline-eval-sanitization.js'
import type { CanaryAuthorizationUseStore } from './external-canary-use-store.js'
import { externalEvalWorstCaseCost, ExternalEvalCostController } from './external-eval-cost.js'

export const commercialQuestion = 'Quero um shampoo anticaspa para couro cabeludo oleoso, com sensação refrescante, até R$ 50. Qual você recomenda?'
export const commercialModel = 'openai/gpt-6-luna'
export const commercialExperimentId = 'EVAL-07D.6-R2'
export const commercialUseId = '070d6000000000000000000000000002'
export const commercialProvider = 'azure'
const modelCatalogURL = `https://openrouter.ai/api/v1/models/${commercialModel}/endpoints`
const zdrCatalogURL = 'https://openrouter.ai/api/v1/endpoints/zdr'
const currentKeyURL = 'https://openrouter.ai/api/v1/key'
const providerKeyLimitUsd = 5
const experimentBudgetUsd = 1
const unreportedUsageMultiplier = 1.25
const limits = {
  maxModelCalls: 2, estimatedInputTokensPerCall: 20_000, maxOutputTokensPerCall: 512,
  maxExecutionTokens: 41_024, timeoutMs: 15_000,
}

export class CommercialExperimentError extends Error {
  constructor(readonly code: string) {
    super(code)
  }
}

const rate = z.string().regex(/^\d+(?:\.\d+)?$/).transform(Number).pipe(z.number().finite().nonnegative())
const pricingFields = z.object({
  prompt: rate, completion: rate, input_cache_read: rate, input_cache_write: rate,
  request: rate.optional(),
})
const endpointSchema = z.object({
  model_id: z.literal(commercialModel),
  tag: z.literal(commercialProvider),
  name: z.string().min(1),
  provider_name: z.literal('Azure'),
  status: z.literal(0),
  service_tier: z.union([z.null(), z.literal('default')]),
  supported_parameters: z.array(z.string()),
  supports_tool_choice: z.object({ auto: z.literal(true) }),
  safety_retention: z.literal(false).optional(),
  pricing: pricingFields.extend({
    overrides: z.array(pricingFields.extend({ min_prompt_tokens: z.number().int().nonnegative() })).optional(),
  }),
})
const noRetainingEndpoint = endpointSchema.extend({ safety_retention: z.literal(false) })
const modelCatalog = z.object({ data: z.object({ endpoints: z.array(z.unknown()) }) })
const zdrCatalog = z.object({ data: z.array(z.unknown()) })

const dedicatedKey = z.object({ data: z.object({
  limit: z.literal(providerKeyLimitUsd),
  limit_reset: z.null(),
  limit_remaining: z.number().finite().min(0).max(providerKeyLimitUsd),
  is_free_tier: z.literal(false),
  is_management_key: z.literal(false),
  is_provisioning_key: z.literal(false),
  effective_budget: z.object({ remaining_usd: z.number().finite().nonnegative() }).nullish(),
}) })

function reserve(pricing: { inputUsdPerMillionTokens: number; outputUsdPerMillionTokens: number }) {
  return externalEvalWorstCaseCost({ pricing, limits, unreportedUsageMultiplier })!
}

const advertisedIdentity = z.object({ model_id: z.unknown(), tag: z.unknown(), provider_name: z.unknown() })

function azureEntries(endpoints: unknown[], modelSpecific: boolean) {
  return endpoints.filter((entry) => {
    const identity = advertisedIdentity.safeParse(entry).data
    if (!identity || (!modelSpecific && typeof identity.model_id === 'string' && identity.model_id !== commercialModel)) return false
    const tag = typeof identity.tag === 'string' ? identity.tag.trim().toLowerCase() : ''
    const name = typeof identity.provider_name === 'string' ? identity.provider_name.trim().toLowerCase() : ''
    return tag === commercialProvider || tag.startsWith(commercialProvider + '/') || name === commercialProvider
  })
}

function supportsExperiment(endpoint: z.infer<typeof endpointSchema>) {
  return ['tools', 'tool_choice', 'reasoning_effort', 'max_completion_tokens']
    .every((name) => endpoint.supported_parameters.includes(name))
}

export function hasCommercialKeyFormat(value: string | undefined): value is string {
  return value !== undefined && /^sk-or-v1-[A-Za-z0-9_-]{17,240}$/.test(value)
}

async function fetchOpenRouterJson(transport: typeof fetch, url: string, signal: AbortSignal, errorCode: string, key?: string) {
  const timeout = AbortSignal.timeout(limits.timeoutMs)
  const active = AbortSignal.any([signal, timeout])
  try {
    const response = await awaitWithAbort(() => transport(url, {
      redirect: 'error',
      cache: 'no-store',
      method: 'GET',
      signal: active,
      ...(key === undefined ? {} : { headers: { Authorization: `Bearer ${key}` } }),
    }), active)
    if (!response.ok) {
      void response.body?.cancel().catch(() => undefined)
      throw new CommercialExperimentError(errorCode)
    }
    return JSON.parse(await readResponseBodyWithinLimit(response, active, key === undefined ? 16 * 1024 * 1024 : undefined)) as unknown
  } catch {
    throw new CommercialExperimentError(signal.aborted ? 'OPERATOR_CANCELLED' : timeout.aborted ? 'TIMEOUT' : errorCode)
  }
}

async function verifyPricing(transport: typeof fetch, signal: AbortSignal) {
  const catalog = modelCatalog.safeParse(await fetchOpenRouterJson(transport, modelCatalogURL, signal, 'PUBLIC_CATALOG_UNAVAILABLE'))
  const matches = catalog.success ? azureEntries(catalog.data.data.endpoints, true) : []
  const endpoint = endpointSchema.safeParse(matches[0]).data
  if (matches.length !== 1 || !endpoint || !supportsExperiment(endpoint)) {
    throw new CommercialExperimentError('AZURE_ROUTING_UNVERIFIED')
  }
  const publishedZdr = zdrCatalog.safeParse(await fetchOpenRouterJson(transport, zdrCatalogURL, signal, 'ZDR_LIST_UNAVAILABLE'))
  const zdrMatches = publishedZdr.success ? azureEntries(publishedZdr.data.data, false) : []
  const zdr = noRetainingEndpoint.safeParse(zdrMatches[0]).data
  if (zdrMatches.length !== 1 || !zdr || zdr.name !== endpoint.name || !supportsExperiment(zdr)) {
    throw new CommercialExperimentError('ZDR_WITHOUT_SAFETY_RETENTION_UNVERIFIED')
  }
  if (JSON.stringify(endpoint.pricing) !== JSON.stringify(zdr.pricing)) throw new CommercialExperimentError('PRICING_UNVERIFIED')
  const rates = [endpoint.pricing, ...(endpoint.pricing.overrides ?? [])
    .filter((tier) => tier.min_prompt_tokens <= limits.estimatedInputTokensPerCall)]
  if (rates.some((tier) => (tier.request ?? 0) > 0)) throw new CommercialExperimentError('PRICING_UNVERIFIED')
  const inputUsdPerMillionTokens = 1_000_000 * Math.max(...rates.flatMap((tier) => [tier.prompt, tier.input_cache_read, tier.input_cache_write]))
  const outputUsdPerMillionTokens = 1_000_000 * Math.max(...rates.map((tier) => tier.completion))
  if (inputUsdPerMillionTokens <= 0 || outputUsdPerMillionTokens <= 0) throw new CommercialExperimentError('PRICING_UNVERIFIED')
  return { modelId: commercialModel, currency: 'USD' as const, inputUsdPerMillionTokens, outputUsdPerMillionTokens, confirmedAt: new Date().toISOString() }
}

const historicalReserveUsd = reserve({ inputUsdPerMillionTokens: 0.125, outputUsdPerMillionTokens: 0.50 })
type Options = {
  live?: { provider: typeof commercialProvider; authorized: boolean; accountZdrOnlyConfirmed: boolean }
  signal: AbortSignal
}
type Dependencies = {
  transport: typeof fetch
  loadKey(): string | undefined
  createUseStore(): Promise<CanaryAuthorizationUseStore>
  loadCatalog: typeof loadCatalogRepository
}

export async function runCommercialExperiment({ live, signal }: Options, deps: Dependencies) {
  const catalogue = await deps.loadCatalog().catch(() => { throw new CommercialExperimentError('CATALOG_UNAVAILABLE') })
  const products = catalogue.listAll()
  const compatibleIds = products.filter((p) => p.isDemo && p.applicationArea === 'hair' && p.category === 'shampoos' && p.subcategory === 'anticaspa' &&
    p.scalpTypes.includes('oleoso') && p.price <= 50 && p.stock > 0 &&
    (p.tags.includes('frescor') || p.variant.sensoryNotes?.some((note) => note.toLowerCase() === 'frescor'))).map((p) => p.id)
  if (compatibleIds.length === 0) throw new CommercialExperimentError('NO_COMPATIBLE_PRODUCT')
  if (products.some((p) => !p.isDemo)) throw new CommercialExperimentError('CATALOG_NOT_FICTIONAL')
  const base = { experiment: commercialExperimentId, question: commercialQuestion, requestedModel: commercialModel, compatibleIds, limits }
  if (!live) return { ...base, status: 'dry-run' as const, historicalReserveUsd, authenticatedRequests: 0, modelAttempts: 0 }
  if (!live.authorized || live.provider !== commercialProvider) throw new CommercialExperimentError('LIVE_AUTHORIZATION_REQUIRED')
  if (!live.accountZdrOnlyConfirmed) throw new CommercialExperimentError('ACCOUNT_ZDR_ONLY_CONFIRMATION_REQUIRED')
  if (signal.aborted) throw new CommercialExperimentError('OPERATOR_CANCELLED')
  const credential = deps.loadKey()
  if (!hasCommercialKeyFormat(credential)) throw new CommercialExperimentError('DEDICATED_KEY_UNAVAILABLE')
  const faqDocuments = await loadFaqDocuments().catch(() => { throw new CommercialExperimentError('FAQ_UNAVAILABLE') })
  const useStore = await deps.createUseStore().catch(() => { throw new CommercialExperimentError('USE_STORE_UNAVAILABLE') })
  const priorUse = await useStore.status(commercialUseId)
  if (priorUse !== 'available') throw new CommercialExperimentError(priorUse === 'consumed' ? 'EXPERIMENT_ALREADY_CONSUMED' : 'USE_STORE_UNAVAILABLE')
  const pricing = await verifyPricing(deps.transport, signal)
  const reservedUsd = reserve(pricing)
  if (!Number.isFinite(reservedUsd) || reservedUsd <= 0 || reservedUsd > experimentBudgetUsd) throw new CommercialExperimentError('BUDGET_INSUFFICIENT')
  if (signal.aborted) throw new CommercialExperimentError('OPERATOR_CANCELLED')
  const use = await useStore.consume(commercialUseId)
  if (use !== 'reserved') throw new CommercialExperimentError(use === 'consumed' ? 'EXPERIMENT_ALREADY_CONSUMED' : 'USE_STORE_UNAVAILABLE')
  const key = dedicatedKey.safeParse(await fetchOpenRouterJson(deps.transport, currentKeyURL, signal, 'KEY_CONFIGURATION_UNVERIFIED', credential)).data?.data
  if (!key) throw new CommercialExperimentError('KEY_CONFIGURATION_UNVERIFIED')
  if (key.limit_remaining < reservedUsd || (key.effective_budget && key.effective_budget.remaining_usd < reservedUsd)) {
    throw new CommercialExperimentError('BUDGET_INSUFFICIENT')
  }

  let modelAttempts = 0
  let toolCalls = 0
  let executedTools = 0
  let productEvidence = false
  let returnedModel: string | undefined
  let observedProvider: string | undefined
  let firstFailure: string | undefined
  let responseValidationFailure: ChatCompletionResponseValidationFailure | undefined
  let termination: string | undefined
  let finalModelText: string | undefined
  const client = createOpenRouterClient({
    model: commercialModel, apiKey: credential, timeoutMs: limits.timeoutMs, maxOutputTokens: limits.maxOutputTokensPerCall,
    evaluationRouting: {
      providerId: live.provider, allowFallbacks: false, requireParameters: true, dataCollection: 'deny',
      zeroDataRetention: true, reasoningEffort: 'none', serviceTier: 'default',
    },
    async transport(url, init) {
      if (signal.aborted || init?.signal?.aborted || String(url) !== OPENROUTER_CHAT_COMPLETIONS_ENDPOINT ||
          init?.method !== 'POST' || modelAttempts >= limits.maxModelCalls) {
        throw new AgentModelError(signal.aborted ? 'MODEL_CANCELLED' : 'LOCAL_BUDGET_EXHAUSTED', false)
      }
      modelAttempts += 1
      return deps.transport(OPENROUTER_CHAT_COMPLETIONS_ENDPOINT, { ...init, redirect: 'error' })
    },
  })
  const model = createOpenRouterAgentModel(client, {
    expectedModelId: commercialModel,
    onResponseValidationFailure(failure) { responseValidationFailure = failure },
    onObservation(observation) {
      returnedModel = /^[a-z0-9.-]+\/[a-z0-9._:-]+$/i.test(observation.returnedModelId) && !observation.returnedModelId.includes(credential)
        ? observation.returnedModelId
        : undefined
      observedProvider = observation.providerId === live.provider || observation.providerId === 'Azure'
        ? observation.providerId : undefined
      if (!observation.modelIdentityMatches) firstFailure = 'MODEL_IDENTITY_MISMATCH'
      else if (!observedProvider) firstFailure = 'PROVIDER_UNVERIFIED'
    },
  })
  const guarded: AgentModelPort = {
    async complete(input) {
      if (firstFailure) throw new AgentModelError('CONFIGURATION_INVALID', false)
      try {
        const result = await model.complete(input)
        if (firstFailure) throw new AgentModelError('INVALID_MODEL_RESPONSE', true)
        if (result.usage && (result.usage.inputTokens > limits.estimatedInputTokensPerCall ||
            result.usage.outputTokens > limits.maxOutputTokensPerCall)) firstFailure = 'TOKEN_LIMIT_EXCEEDED'
        if (!result.usage && result.message.toolCalls?.length) firstFailure = 'USAGE_UNVERIFIED_BEFORE_NEXT_CALL'
        if (!firstFailure && !result.message.toolCalls?.length) finalModelText = result.message.content?.trim() || undefined
        return result
      } catch (error) {
        firstFailure ??= error instanceof AgentModelError ? error.code : 'MODEL_FAILURE'
        throw error
      }
    },
  }
  const cost = new ExternalEvalCostController({
    requestedModelId: commercialModel, limits, pricing, maxBudgetUsd: experimentBudgetUsd, unreportedUsageMultiplier,
    maxInputTokensPerCall: limits.estimatedInputTokensPerCall, cancellableBeforeTransport: true,
  })
  const service = createChatService({
    model: cost.wrap(guarded), catalog: catalogue, productIndex: createProductSearchIndex(products),
    faqDocuments, faqIndex: createFaqSearchIndex(faqDocuments),
    maxModelCalls: limits.maxModelCalls, maxOutputTokens: limits.maxOutputTokensPerCall, timeoutMs: limits.timeoutMs * limits.maxModelCalls,
  })
  const response = await service.execute({ message: commercialQuestion, history: [], cart: [] }, {
    requestId: randomUUID(), signal,
    observer: { record(event) {
      if (event.type === 'orchestrator_tool') {
        toolCalls += 1
        if (event.executed) executedTools += 1
        if (event.executed && event.outcome === 'found' &&
            (event.toolName === 'search_products' || event.toolName === 'get_product_details')) productEvidence = true
      }
      if (event.type === 'orchestrator_termination') termination = event.status
    } },
  }).catch(() => {
    if (termination === 'INSUFFICIENT_GROUNDING' && finalModelText && !signal.aborted) return undefined
    firstFailure ??= signal.aborted ? 'OPERATOR_CANCELLED' : 'CHAT_FAILURE'
    return undefined
  })
  const snapshot = cost.snapshot()
  const calls = snapshot.calls.filter((call) => call.status !== 'rejected')
  const productIds = response?.type === 'recommendation' ? response.productIds : []
  if (signal.aborted) firstFailure ??= 'OPERATOR_CANCELLED'
  if (snapshot.limitsReached.includes('reported_usage_exceeded_reservation')) firstFailure ??= 'USAGE_EXCEEDED_RESERVATION'
  if (snapshot.calls.some((call) => call.errorCode === 'LOCAL_BUDGET_EXHAUSTED')) firstFailure ??= 'LOCAL_BUDGET_EXHAUSTED'
  if (modelAttempts === 0) firstFailure ??= 'NO_MODEL_RESPONSE'
  if (termination && termination !== 'ASSISTANT_RESPONSE' && termination !== 'INSUFFICIENT_GROUNDING') firstFailure ??= termination
  const commercialFailures: string[] = []
  if (!firstFailure) {
    if (!productEvidence) commercialFailures.push('PRODUCT_TOOL_EVIDENCE_MISSING')
    if (productIds.length === 0) commercialFailures.push('RECOMMENDATION_MISSING')
    if (productIds.some((id) => !compatibleIds.includes(id))) commercialFailures.push('RECOMMENDATION_OUTSIDE_SCENARIO')
  }
  const tokens = calls.length === modelAttempts && calls.length > 0 && calls.every((call) => call.usageComplete)
    ? calls.reduce((total, call) => ({
      input: total.input + (call.reportedInputTokens ?? 0),
      output: total.output + (call.reportedOutputTokens ?? 0),
      total: total.total + (call.reportedTotalTokens ?? 0),
    }), { input: 0, output: 0, total: 0 })
    : undefined
  const answer = response?.message ?? (termination === 'INSUFFICIENT_GROUNDING' ? finalModelText : undefined)
  return {
    ...base, status: firstFailure ? 'interrupted' as const : 'completed' as const, reason: firstFailure,
    ...(responseValidationFailure === undefined ? {} : { responseValidationFailure }),
    commercialStatus: firstFailure ? 'not_evaluated' as const : commercialFailures.length ? 'failed' as const : 'passed' as const,
    commercialFailures,
    response: firstFailure || !answer ? undefined : sanitizeEvalText(answer.replaceAll(credential, '[REDACTED]'))
      .replace(/[\x00-\x09\x0b-\x1f\x7f-\x9f]/g, ''),
    responseSource: response ? 'chat_service' as const : 'model_for_review' as const,
    returnedModel, requestedProvider: live.provider, observedProvider,
    productIds: firstFailure ? [] : productIds, modelAttempts, toolCalls, executedTools, tokens,
    reservedUsd, estimatedCostUsd: snapshot.chargedCostUsd, effectiveChargeUsd: undefined,
  }
}
