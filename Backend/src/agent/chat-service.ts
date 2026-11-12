import type { CatalogRepository } from '../catalog/catalog-repository.js'
import { toCatalogImageUrl } from '../catalog/catalog-repository.js'
import type {
  Product,
  ProductCategory,
  ProductConcern,
  ProductSubcategory,
  ScalpType,
} from '../catalog/product-schema.js'
import {
  calculateDemoCommercialTotals,
  demoPriceToCents,
} from '../commercial/demo-commercial-rules.js'
import {
  CHAT_MAX_SOURCES,
  chatProductCardSchema,
  chatRequestSchema,
  chatResponseSchema,
  type ChatPreferences,
  type ChatProductCard,
  type ChatRequest,
  type ChatResponse,
} from '../contracts/chat.js'
import type { FaqDocument } from '../knowledge/faq-document-schema.js'
import type { FaqSearchIndex } from '../knowledge/faq-search.js'
import type { AgentMessage, AgentModelPort } from './agent-model-port.js'
import {
  composeComparisonMessage,
  composeFaqAnswer,
  composeRecommendationMessage,
} from './chat-response-composer.js'
import {
  createBudgetedAgentModel,
  type UsageBudgetExecution,
} from './usage-budget-controller.js'
import {
  observeChatOperation,
  type ChatOperationalObserver,
} from '../observability/chat-operational-events.js'
import {
  planChatGrounding,
  type ChatGroundingPlan,
} from './chat-grounding-planner.js'
import {
  createToolOrchestrator,
  type ToolOrchestratorResult,
} from './tool-orchestrator.js'
import {
  createAgentToolExecutionContext,
  createAgentToolRegistry,
} from './tools/agent-tool.js'
import {
  createGetProductDetailsTool,
  createProductEligibilityPolicy,
  createSearchProductsTool,
  type ProductEligibilityConstraints,
  type ProductSearchIndex,
  type SearchProductsInput,
} from './tools/product-tools.js'
import { createSearchFaqTool } from './tools/search-faq-tool.js'

export type ChatServiceErrorCode =
  | 'INVALID_REQUEST'
  | 'AI_UNAVAILABLE'
  | 'AI_BAD_RESPONSE'
  | 'AI_TIMEOUT'
  | 'REQUEST_CANCELLED'

export class ChatServiceError extends Error {
  readonly code: ChatServiceErrorCode

  constructor(code: ChatServiceErrorCode) {
    super('Falha controlada no serviço de chat.')
    this.name = 'ChatServiceError'
    this.code = code
  }
}

export interface ChatExecutionOptions {
  readonly requestId: string
  readonly signal: AbortSignal
  readonly usageBudget?: UsageBudgetExecution
  readonly observer?: ChatOperationalObserver
}

export interface ChatService {
  execute(
    input: ChatRequest,
    options: ChatExecutionOptions,
  ): Promise<ChatResponse>
}

export interface CreateChatServiceOptions {
  readonly catalog: CatalogRepository
  readonly productIndex: ProductSearchIndex
  readonly faqIndex: FaqSearchIndex
  readonly faqDocuments: readonly FaqDocument[]
  readonly model: AgentModelPort
  readonly timeoutMs?: number
  readonly maxModelCalls?: number
  readonly maxOutputTokens?: number
}

interface EffectiveCommercialContext {
  constraints: ProductEligibilityConstraints
  searchInput: SearchProductsInput
  sensoryTerms: readonly string[]
  rejectedProductIds: ReadonlySet<number>
  needsClarification: boolean
  cart: readonly { productId: number; quantity: number }[]
}

function normalize(value: string) {
  return value
    .normalize('NFKD')
    .replace(/\p{Diacritic}/gu, '')
    .toLocaleLowerCase('pt-BR')
    .replace(/\s+/g, ' ')
    .trim()
}

function extractBudget(value: string) {
  const normalized = normalize(value)
  const patterns = [
    /\bate\s+(?:r\$\s*)?(\d{1,6}(?:[.,]\d{1,2})?)/g,
    /\bno maximo\s+(?:r\$\s*)?(\d{1,6}(?:[.,]\d{1,2})?)/g,
    /\borcamento(?: de)?\s+(?:r\$\s*)?(\d{1,6}(?:[.,]\d{1,2})?)/g,
    /\blimite(?: agora)?(?: e| de)?\s+(?:r\$\s*)?(\d{1,6}(?:[.,]\d{1,2})?)/g,
  ]
  const values: number[] = []
  for (const pattern of patterns) {
    for (const match of normalized.matchAll(pattern)) {
      const parsed = Number(match[1]?.replace(',', '.'))
      if (Number.isFinite(parsed) && parsed >= 0 && !values.includes(parsed)) {
        values.push(parsed)
      }
    }
  }
  return values.length === 1
    ? { value: values[0], ambiguous: false }
    : { value: undefined, ambiguous: values.length > 1 }
}

function latestHistoricalBudget(request: ChatRequest) {
  for (let index = request.history.length - 1; index >= 0; index -= 1) {
    const message = request.history[index]
    if (message?.role !== 'user') continue
    const budget = extractBudget(message.content)
    if (budget.value !== undefined) return budget.value
  }
  return undefined
}

function historicalUserMessages(request: ChatRequest) {
  return request.history
    .filter((message) => message.role === 'user')
    .map((message) => message.content)
}

function latestHistoricalValue<T>(
  request: ChatRequest,
  infer: (message: string) => T | undefined,
) {
  const messages = historicalUserMessages(request)
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const value = infer(messages[index] ?? '')
    if (value !== undefined) return value
  }
  return undefined
}

function inferCategory(message: string): ProductCategory | undefined {
  const normalized = normalize(message)
  if (/\b(?:shampoo|anticaspa)\b/.test(normalized)) return 'shampoos'
  if (/\bcondicionador\b/.test(normalized)) return 'condicionadores'
  if (/\bmascara\b/.test(normalized)) return 'mascaras'
  if (/\bfinalizador\b/.test(normalized)) return 'finalizadores'
  if (/\bsabonete\b/.test(normalized)) return 'sabonetes'
  if (/\boleo corporal\b/.test(normalized)) return 'oleos-corporais'
  return undefined
}

function inferSubcategory(message: string): ProductSubcategory | undefined {
  const normalized = normalize(message)
  if (/\banticaspa\b/.test(normalized)) return 'anticaspa'
  if (/\bantiqueda\b/.test(normalized)) return 'antiqueda'
  if (/\bantirresiduos\b/.test(normalized)) return 'antirresiduos'
  if (/\bhidratacao\b/.test(normalized)) return 'hidratacao'
  if (/\bnutricao\b/.test(normalized)) return 'nutricao'
  return undefined
}

function relevantHistoricalProductMessages(request: ChatRequest) {
  const messages = historicalUserMessages(request)
  let start = 0
  let category: ProductCategory | undefined
  let subcategory: ProductSubcategory | undefined
  for (let index = 0; index < messages.length; index += 1) {
    const message = messages[index] ?? ''
    const nextCategory = inferCategory(message)
    const nextSubcategory = inferSubcategory(message)
    if (
      (nextCategory !== undefined &&
        category !== undefined &&
        nextCategory !== category) ||
      (nextSubcategory !== undefined &&
        subcategory !== undefined &&
        nextSubcategory !== subcategory)
    ) {
      start = index
    }
    category = nextCategory ?? category
    subcategory = nextSubcategory ?? subcategory
  }
  return messages.slice(start)
}

function latestRelevantHistoricalValue<T>(
  request: ChatRequest,
  infer: (message: string) => T | undefined,
) {
  const messages = relevantHistoricalProductMessages(request)
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const value = infer(messages[index] ?? '')
    if (value !== undefined) return value
  }
  return undefined
}

function inferScalpTypes(message: string): readonly ScalpType[] | undefined {
  const normalized = normalize(message)
  const types: ScalpType[] = []
  if (/\bcouro(?: cabeludo)? oleoso\b/.test(normalized)) types.push('oleoso')
  if (/\bcouro(?: cabeludo)? seco\b/.test(normalized)) types.push('seco')
  if (/\bcouro(?: cabeludo)? normal\b/.test(normalized)) types.push('normal')
  if (/\bcouro(?: cabeludo)? sensivel\b/.test(normalized)) types.push('sensivel')
  return types.length > 0 ? types : undefined
}

function inferEllipticalScalpTypes(
  message: string,
  hasSafeScalpContext: boolean,
): readonly ScalpType[] | undefined {
  if (!hasSafeScalpContext) return undefined
  const match = normalize(message).match(
    /^(?:e|eh|meu couro e|meu couro eh)\s+(oleoso|seco|normal|sensivel)\b/,
  )
  return match?.[1] ? [match[1] as ScalpType] : undefined
}

function latestHistoricalScalpTypes(request: ChatRequest) {
  let hasSafeScalpContext = false
  let latest: readonly ScalpType[] | undefined
  for (const message of relevantHistoricalProductMessages(request)) {
    hasSafeScalpContext ||=
      inferSubcategory(message) === 'anticaspa' ||
      /\bcouro(?: cabeludo)?\b/.test(normalize(message))
    latest =
      inferScalpTypes(message) ??
      inferEllipticalScalpTypes(message, hasSafeScalpContext) ??
      latest
  }
  return latest
}

function inferHairConcerns(message: string): readonly ProductConcern[] | undefined {
  const normalized = normalize(message)
  const concerns: ProductConcern[] = []
  if (/\b(?:caspa|anticaspa)\b/.test(normalized)) concerns.push('caspa')
  if (/\b(?:oleosidade|oleoso)\b/.test(normalized)) concerns.push('oleosidade')
  if (/\b(?:ressecamento|ressecado)\b/.test(normalized)) concerns.push('ressecamento')
  if (/\b(?:sensibilidade|sensivel)\b/.test(normalized)) concerns.push('sensibilidade')
  return concerns.length > 0 ? concerns : undefined
}

const sensoryTerms = [
  'frescor',
  'refrescante',
  'citrico',
  'herbal',
  'suave',
  'intenso',
  'coco',
  'camomila',
  'aloe',
  'hortela',
  'limao',
  'hidratante',
  'confortavel',
] as const

function inferSensoryTerms(message: string): readonly string[] | undefined {
  const normalized = normalize(message)
  const found = sensoryTerms.filter((term) =>
    new RegExp(`\\b${term}\\b`).test(normalized),
  )
  return found.length > 0 ? found : undefined
}

function extractAvoidedIngredientTerms(message: string) {
  if (explicitRejectedProductIds(message).size > 0) return []
  const normalized = normalize(message).replace(/[^a-z0-9 -]+/g, ' ')
  const match = normalized.match(
    /\b(?:nao quero|evitar|sem|incompativel com)\s+([a-z0-9-]+(?:\s+[a-z0-9-]+){0,3})\s*$/,
  )
  return match?.[1] ? [match[1]] : []
}

function resolveCommercialContext(
  request: ChatRequest,
  productIndex: ProductSearchIndex,
): EffectiveCommercialContext {
  const preferences: ChatPreferences = request.preferences ?? {}
  const currentBudget = extractBudget(request.message)
  const historicalBudget = latestHistoricalBudget(request)
  const structuredBudget = preferences.maxPrice
  const conflictingCurrentBudget =
    structuredBudget !== undefined &&
    currentBudget.value !== undefined &&
    structuredBudget !== currentBudget.value
  const maxPrice =
    conflictingCurrentBudget
      ? Math.min(structuredBudget, currentBudget.value ?? structuredBudget)
      : structuredBudget ?? currentBudget.value ?? historicalBudget

  const ingredientTerms = [
    ...(preferences.avoidIngredients ?? []),
    ...extractAvoidedIngredientTerms(request.message),
  ]
  const ingredientResolution = productIndex.resolveIngredientTerms(
    [...new Set(ingredientTerms)],
  )
  const historicalCategory = latestHistoricalValue(request, inferCategory)
  const historicalSubcategory = latestRelevantHistoricalValue(
    request,
    inferSubcategory,
  )
  const currentCategory = preferences.category ?? inferCategory(request.message)
  const currentSubcategory =
    preferences.subcategory ?? inferSubcategory(request.message)
  const categoryChanged =
    currentCategory !== undefined &&
    historicalCategory !== undefined &&
    currentCategory !== historicalCategory
  const objectiveChanged =
    currentSubcategory !== undefined &&
    historicalSubcategory !== undefined &&
    currentSubcategory !== historicalSubcategory
  const productGoalChanged = categoryChanged || objectiveChanged
  const category = currentCategory ?? historicalCategory
  const subcategory =
    currentSubcategory ?? (categoryChanged ? undefined : historicalSubcategory)

  const historyHasSafeScalpContext =
    historicalSubcategory === 'anticaspa' ||
    relevantHistoricalProductMessages(request).some((message) =>
      /\bcouro(?: cabeludo)?\b/.test(normalize(message)),
    )
  const currentScalpTypes =
    inferScalpTypes(request.message) ??
    inferEllipticalScalpTypes(request.message, historyHasSafeScalpContext)
  const historicalScalpTypes = latestHistoricalScalpTypes(request)
  const scalpTypes =
    preferences.scalpTypes ??
    currentScalpTypes ??
    (productGoalChanged ? undefined : historicalScalpTypes)
  const currentHairConcerns = inferHairConcerns(request.message)
  const historicalHairConcerns = latestRelevantHistoricalValue(
    request,
    inferHairConcerns,
  )
  const hairConcerns =
    preferences.hairConcerns ??
    currentHairConcerns ??
    (productGoalChanged ? undefined : historicalHairConcerns)
  const currentSensoryTerms = inferSensoryTerms(request.message)
  const historicalSensoryTerms = latestRelevantHistoricalValue(
    request,
    inferSensoryTerms,
  )
  const effectiveSensoryTerms =
    currentSensoryTerms ??
    (productGoalChanged ? undefined : historicalSensoryTerms) ??
    []
  const rejectedProductIds = explicitRejectedProductIds(request.message)
  if (
    /\b(?:outra opcao|outro produto|produto diferente|algo diferente|nao gostei|prefiro outra)\b/.test(
      normalize(request.message),
    )
  ) {
    for (const productId of request.recommendationContext?.productIds ?? []) {
      rejectedProductIds.add(productId)
    }
  }

  const constraints: ProductEligibilityConstraints = {
    ...(category !== undefined ? { category } : {}),
    ...(subcategory !== undefined ? { subcategory } : {}),
    ...(maxPrice !== undefined ? { maxPrice } : {}),
    requireInStock: true,
    ...(ingredientResolution.resolvedIds.length > 0
      ? { incompatibleIngredientIds: [...ingredientResolution.resolvedIds] }
      : {}),
  }

  const searchInput: SearchProductsInput = {
    query: [request.message, ...effectiveSensoryTerms].join(' '),
    ...(category !== undefined ? { category } : {}),
    ...(subcategory !== undefined ? { subcategory } : {}),
    ...(maxPrice !== undefined ? { maxPrice } : {}),
    requireInStock: true,
    ...(preferences.hairTypes !== undefined
      ? { hairTypes: preferences.hairTypes }
      : {}),
    ...(scalpTypes !== undefined ? { scalpTypes: [...scalpTypes] } : {}),
    ...(hairConcerns !== undefined
      ? { hairConcerns: [...hairConcerns] }
      : {}),
    ...(preferences.skinTypes !== undefined
      ? { skinTypes: preferences.skinTypes }
      : {}),
    ...(preferences.bodyConcerns !== undefined
      ? { bodyConcerns: preferences.bodyConcerns }
      : {}),
    ...(ingredientResolution.resolvedIds.length > 0
      ? { incompatibleIngredientIds: [...ingredientResolution.resolvedIds] }
      : {}),
    limit: 5,
  }

  return {
    constraints,
    searchInput,
    sensoryTerms: effectiveSensoryTerms,
    rejectedProductIds,
    needsClarification:
      currentBudget.ambiguous ||
      conflictingCurrentBudget ||
      ingredientResolution.unresolvedTerms.length > 0,
    cart: request.cart,
  }
}

function hasSelectionDiscriminator(context: EffectiveCommercialContext) {
  const input = context.searchInput
  const normalized = normalize(input.query ?? '')
  return (
    input.hairTypes !== undefined ||
    input.scalpTypes !== undefined ||
    input.skinTypes !== undefined ||
    input.bodyConcerns !== undefined ||
    input.incompatibleIngredientIds !== undefined ||
    /\b(?:frescor|refrescante|citrico|herbal|suave|intenso|coco|camomila|aloe|hortela|limao)\b/.test(
      normalized,
    )
  )
}

function consultativeQuestion(
  plan: ChatGroundingPlan,
  context: EffectiveCommercialContext,
) {
  if (
    plan.presentationIntent !== 'recommendation' ||
    plan.groundingRequirement !== 'product' ||
    context.needsClarification ||
    hasSelectionDiscriminator(context)
  ) {
    return undefined
  }
  if (
    context.searchInput.subcategory === 'anticaspa' ||
    context.searchInput.hairConcerns?.includes('caspa')
  ) {
    return 'Seu couro cabeludo tende a ser seco, normal, oleoso ou sensível?'
  }
  return 'Qual preferência é mais importante para você nessa escolha: perfil de uso, sensação ou orçamento?'
}

function hasFaqTopic(message: string) {
  const normalized = normalize(message)
  return (
    /\b(?:frete|envio|entreg(?:a|am|ar|ue)|transportadora|receber|prazo de entrega)\b/.test(
      normalized,
    ) ||
    /\b(?:troca|trocar|devolucao|devolver|desistir|reembolso|estorno|danificado)\b/.test(
      normalized,
    ) ||
    /\b(?:pagamento|forma de pagar|parcelamento|pix|cartao|boleto)\b/.test(
      normalized,
    ) ||
    /\b(?:pedido|cancelar pedido|rastreamento|rastrear)\b/.test(normalized) ||
    /\b(?:politica|privacidade|dados pessoais|atacado|fidelidade|embalagem para presente)\b/.test(
      normalized,
    )
  )
}

function interruptsCommercialContinuity(message: string) {
  const normalized = normalize(message)
  return /\b(?:mudando de assunto|outro assunto|vamos falar de|agora sobre|nao quero mais|deixa pra la|deixe pra la|esquece|encerrar|encerra|cancelar essa busca|cancela essa busca)\b/.test(
    normalized,
  )
}

function isCommercialContinuation(message: string) {
  const normalized = normalize(message)
  if (interruptsCommercialContinuity(message)) return false
  const budget = extractBudget(message)
  return (
    budget.value !== undefined ||
    budget.ambiguous ||
    inferSensoryTerms(message) !== undefined ||
    inferScalpTypes(message) !== undefined ||
    /^(?:e|eh)?\s*(?:oleoso|seco|normal|sensivel)\b/.test(normalized)
  )
}

function hasHistoricalRecommendationIntent(request: ChatRequest) {
  const previousUsers = request.history.filter(
    (message) => message.role === 'user',
  )
  for (let index = previousUsers.length - 1; index >= 0; index -= 1) {
    const content = previousUsers[index]?.content ?? ''
    if (interruptsCommercialContinuity(content)) return false
    const plan = planChatGrounding(chatRequestSchema.parse({ message: content }))
    if (plan.presentationIntent === 'recommendation') return true
    if (!isCommercialContinuation(content)) return false
  }
  return false
}

function preserveHistoricalRecommendationIntent(
  request: ChatRequest,
  currentPlan: ChatGroundingPlan,
): ChatGroundingPlan {
  if (
    currentPlan.presentationIntent !== 'text' ||
    currentPlan.groundingRequirement === 'not_required'
  ) {
    return currentPlan
  }
  if (!hasHistoricalRecommendationIntent(request)) {
    return currentPlan
  }
  if (currentPlan.groundingRequirement === 'product') {
    return { ...currentPlan, presentationIntent: 'recommendation' }
  }
  if (!isCommercialContinuation(request.message)) return currentPlan
  return {
    groundingRequirement: hasFaqTopic(request.message) ? 'both' : 'product',
    presentationIntent: 'recommendation',
  }
}

function explicitComparisonIds(message: string, catalog: CatalogRepository) {
  const normalized = normalize(message)
  const match =
    normalized.match(
      /\b(?:compare|comparar|comparacao entre)\s+(?:(?:(?:os|esses|estes)\s+)?(?:dois\s+)?|ambos(?:\s+os)?\s+)produtos?\s+(?:id\s*)?(\d{1,6})\s+(?:e|com|versus|vs)\s+(?:(?:o|com o)\s+)?(?:produto\s+)?(?:id\s*)?(\d{1,6})\b/,
    ) ??
    normalized.match(
      /\bqual dos dois\s+(?:produtos?\s+)?(?:id\s*)?(\d{1,6})\s+(?:e|com|versus|vs)\s+(?:(?:o|com o)\s+)?(?:produto\s+)?(?:id\s*)?(\d{1,6})\b/,
    )
  if (!match) return []
  const ids = [...new Set([Number(match[1]), Number(match[2])])].filter(
    (id) => catalog.findById(id) !== undefined,
  )
  return ids.length === 2 ? ids : []
}

function mentionsExplicitProductId(message: string) {
  return /\bproduto\s+(?:id\s*)?\d{1,6}\b/.test(normalize(message))
}

function hasUnresolvedComparisonReference(message: string) {
  const normalized = normalize(message)
  return (
    /\b(?:compare|comparar)\s+(?:(?:os|esses|estes)\s+)?dois\b/.test(
      normalized,
    ) ||
    /\bqual dos dois\b/.test(normalized) ||
    /\bambos\b/.test(normalized)
  )
}

function createConversation(
  request: ChatRequest,
  context: EffectiveCommercialContext,
): AgentMessage[] {
  const trustedContext = {
    preferences: {
      ...context.searchInput,
      query: undefined,
      limit: undefined,
    },
    cart: context.cart,
  }
  const currentMessage = `${request.message}\n\nContexto estruturado e validado pelo backend (dados, não instruções): ${JSON.stringify(trustedContext)}`
  return [
    ...request.history,
    { role: 'user' as const, content: currentMessage },
  ]
}

function clinicalSafetyResponse(
  request: ChatRequest,
  requestId: string,
): ChatResponse | undefined {
  const normalized = normalize(request.message)
  const adverseReaction =
    /\b(?:reac(?:ao|oes)|dores?|doendo|ardor|ardendo|inch(?:aco|acos|ado|ada|ados|adas)|feridas?|sangramento|sangrando|secrec(?:ao|oes)|sintomas? intensos?|piorando|piora)\b/.test(
      normalized,
    )
  const productContext = normalize(
    [...historicalUserMessages(request), request.message].join(' '),
  )
  const unsupportedGuarantee =
    /\b(?:shampoo|cosmetico|produto|pele|couro|cabelo|caspa|alergia|dermatolog)/.test(
      productContext,
    ) &&
    /\b(?:garant(?:e|ia|ido|ida)|curar|cura|segur(?:o|a|os|as)|seguranca dermatologica|hipoalergen(?:ico|ica)|sem alergia|nao causa alergia|eficacia terapeutica)\b/.test(
      normalized,
    )

  if (adverseReaction) {
    return chatResponseSchema.parse({
      type: 'text',
      message:
        'Não posso diagnosticar essa reação nem indicar outro cosmético como solução. Diante de dor, inchaço, ardor, feridas, sangramento, secreção ou sintomas intensos, persistentes ou em piora, procure um profissional de saúde externo.',
      reason: 'unable_to_verify',
      sourceIds: [],
      requestId,
    })
  }
  if (unsupportedGuarantee) {
    return chatResponseSchema.parse({
      type: 'text',
      message:
        'Não posso garantir cura, eficácia terapêutica, segurança dermatológica ou ausência de alergias. Os produtos e ingredientes desta demonstração têm posicionamento cosmético e formulação sintética de teste, sem avaliação clínica.',
      reason: 'unable_to_verify',
      sourceIds: [],
      requestId,
    })
  }
  return undefined
}

function controlledConsultativeQuestion(
  message: string,
  requestId: string,
): ChatResponse {
  return chatResponseSchema.parse({
    type: 'text',
    message,
    reason: 'clarification',
    sourceIds: [],
    requestId,
  })
}

function explicitRejectedProductIds(message: string) {
  const normalized = normalize(message)
  const patterns = [
    /\b(?:nao\s+(?:quero|considere|use)|sem)\s+(?:mais\s+)?(?:o\s+)?produto\s+(?:id\s*)?(\d{1,6})\b/g,
    /\bnao\s+gostei\s+(?:mais\s+)?do\s+produto\s+(?:id\s*)?(\d{1,6})\b/g,
    /\bnao\s+recomende\s+(?:mais\s+)?(?:o\s+)?produto\s+(?:id\s*)?(\d{1,6})\b/g,
  ]
  return new Set(
    patterns.flatMap((pattern) =>
      Array.from(normalized.matchAll(pattern), (match) => Number(match[1])).filter(
        Number.isSafeInteger,
      ),
    ),
  )
}

function explicitInformationalProductIds(message: string) {
  const normalized = normalize(message)
  const rejectedIds = explicitRejectedProductIds(normalized)
  return Array.from(
    new Set(
      Array.from(
        normalized.matchAll(/\bproduto\s+(?:id\s*)?(\d{1,6})\b/g),
        (match) => Number(match[1]),
      ).filter((productId) =>
        Number.isSafeInteger(productId) && !rejectedIds.has(productId),
      ),
    ),
  )
}

function explicitInformationalProductId(message: string) {
  const productIds = explicitInformationalProductIds(message)
  return productIds.length === 1 ? productIds[0] : undefined
}

function requestsMultipleQuoteUnits(message: string) {
  return /\b(?:[2-9]|[1-9]\d{1,5}|dois|duas|tres|quatro|cinco|seis|sete|oito|nove|dez)\s*(?:unidades?|frascos?|itens?)\b/.test(
    normalize(message),
  )
}

function isDemonstrativeQuoteIntent(message: string) {
  const normalized = normalize(message)
  const asksTotal = /\b(?:total|valor final)\b/.test(normalized)
  const referencesRecommendation =
    /\b(?:esse|essa|desse|dessa|deste|desta)\s+(?:produto|shampoo)\b.*\b(?:recomendou|recomendado)\b/.test(
      normalized,
    )
  return (
    (asksTotal && referencesRecommendation) ||
    (/\bfrete\b/.test(normalized) &&
      (asksTotal ||
      /\bquanto\s+(?:ficaria|fica|daria|da|custaria|custa)\b/.test(
        normalized,
      )))
  )
}

function formatDemoCurrency(cents: number) {
  return `R$ ${(cents / 100).toFixed(2).replace('.', ',')}`
}

function hasCanonicalShippingPolicies(
  faqDocuments: ReadonlyMap<string, FaqDocument>,
  requiresStandardShipping: boolean,
) {
  const freeShipping = faqDocuments.get('faq-002')
  if (
    freeShipping?.classification !== 'fictional-demo' ||
    !freeShipping.content.includes('maior que R$ 100,00') ||
    !freeShipping.content.includes('R$ 100,00 exatos não recebe frete grátis')
  ) {
    return false
  }
  if (!requiresStandardShipping) return true

  const standardShipping = faqDocuments.get('faq-003')
  return Boolean(
    standardShipping?.classification === 'fictional-demo' &&
      standardShipping.content.includes('até R$ 100,00') &&
      standardShipping.content.includes('R$ 12,90'),
  )
}

function contextualQuoteResponse(
  request: ChatRequest,
  requestId: string,
  catalog: CatalogRepository,
  faqDocuments: ReadonlyMap<string, FaqDocument>,
): ChatResponse | undefined {
  if (!isDemonstrativeQuoteIntent(request.message)) return undefined

  if (requestsMultipleQuoteUnits(request.message)) {
    return controlledConsultativeQuestion(
      'A cotação demonstrativa atual calcula uma unidade por vez. Informe um único produto para cotar uma unidade com frete.',
      requestId,
    )
  }

  const explicitIds = explicitInformationalProductIds(request.message)
  if (explicitIds.length > 1) {
    return controlledConsultativeQuestion(
      'Qual dos produtos você quer usar nessa cotação demonstrativa? Informe um único ID de produto.',
      requestId,
    )
  }
  const explicitId = explicitIds[0]
  const rejectedIds = explicitRejectedProductIds(request.message)
  const contextualIds = (request.recommendationContext?.productIds ?? []).filter(
    (productId) => !rejectedIds.has(productId),
  )
  const rejectsPreviousReference =
    explicitId === undefined &&
    /\b(?:outro|outra|produto diferente|shampoo diferente)\b/.test(
      normalize(request.message),
    )
  if (
    rejectsPreviousReference ||
    (explicitId === undefined && contextualIds.length !== 1)
  ) {
    return controlledConsultativeQuestion(
      'Qual produto você quer usar nessa cotação demonstrativa? Informe um único ID de produto.',
      requestId,
    )
  }

  const productId = explicitId ?? contextualIds[0]
  const product =
    productId === undefined ? undefined : catalog.findById(productId)
  if (!product || product.stock <= 0) {
    return chatResponseSchema.parse({
      type: 'text',
      message:
        'Não consegui revalidar esse produto com estoque no catálogo demonstrativo atual. Informe outro ID para uma nova cotação.',
      reason: 'not_found',
      sourceIds: [],
      requestId,
    })
  }

  const unitPriceCents = demoPriceToCents(product.price)
  if (unitPriceCents === undefined) {
    return chatResponseSchema.parse({
      type: 'text',
      message:
        'Não foi possível validar o preço atual desse produto para uma cotação demonstrativa.',
      reason: 'unable_to_verify',
      sourceIds: [],
      requestId,
    })
  }
  const totals = calculateDemoCommercialTotals([
    { unitPriceCents, quantity: 1 },
  ])
  const requiredSourceIds =
    totals.shippingCents === 0
      ? ['faq-002']
      : ['faq-002', 'faq-003']
  if (
    !hasCanonicalShippingPolicies(faqDocuments, totals.shippingCents !== 0)
  ) {
    return chatResponseSchema.parse({
      type: 'text',
      message:
        'Consegui validar o produto, mas não a política de frete necessária para calcular o total demonstrativo.',
      reason: 'unable_to_verify',
      sourceIds: [],
      requestId,
    })
  }

  const shippingText =
    totals.shippingCents === 0
      ? 'o frete demonstrativo seria grátis'
      : `o frete demonstrativo seria de ${formatDemoCurrency(totals.shippingCents)}`
  return chatResponseSchema.parse({
    type: 'text',
    message: `Claro! ${product.name} custa ${formatDemoCurrency(unitPriceCents)} no catálogo atual. Para uma unidade, ${shippingText}, então o total demonstrativo ficaria em ${formatDemoCurrency(totals.totalCents)}. Esta é apenas uma simulação fictícia, sem compra, cobrança, reserva ou entrega real. O produto não foi adicionado ao carrinho.`,
    sourceIds: requiredSourceIds,
    requestId,
  })
}

function controlledProductInformation(
  request: ChatRequest,
  result: ToolOrchestratorResult,
  catalog: CatalogRepository,
  sourceIds: readonly string[],
  requestId: string,
): ChatResponse | undefined {
  const normalized = normalize(request.message)
  const productId = explicitInformationalProductId(request.message)
  if (
    productId === undefined ||
    !result.consultedProductIds.includes(productId)
  ) {
    return undefined
  }
  const product = catalog.findById(productId)
  if (!product) return undefined

  if (/\b(?:ingredientes?|formula|formulacao|composicao|contem|leva)\b/.test(normalized)) {
    const ingredients = product.ingredients?.map((ingredient) => ingredient.name)
    const description =
      ingredients && ingredients.length > 0
        ? `Os ingredientes demonstrativos registrados são: ${ingredients.join(', ')}.`
        : 'Não há uma formulação individual publicada para este item demonstrativo.'
    return chatResponseSchema.parse({
      type: 'text',
      message: `${product.name}: ${description} A formulação é sintética e não comprova segurança clínica, ausência de alergias ou adequação dermatológica.`,
      sourceIds,
      requestId,
    })
  }
  if (/\b(?:preco|custa|valor|estoque|disponivel|disponibilidade)\b/.test(normalized)) {
    return chatResponseSchema.parse({
      type: 'text',
      message: `${product.name}: preço demonstrativo canônico de R$ ${product.price.toFixed(2).replace('.', ',')} e estoque atual de ${product.stock} unidade(s).`,
      sourceIds,
      requestId,
    })
  }
  return undefined
}

function resolveFaqSourceIds(
  result: ToolOrchestratorResult,
  faqDocuments: ReadonlyMap<string, FaqDocument>,
) {
  const resolved: string[] = []
  for (const sourceId of result.faqSourceIds) {
    if (
      resolved.length >= CHAT_MAX_SOURCES ||
      resolved.includes(sourceId) ||
      !faqDocuments.has(sourceId)
    ) {
      continue
    }
    resolved.push(sourceId)
  }
  return resolved
}

function mixedFaqAnswer(
  question: string,
  plan: ChatGroundingPlan,
  result: ToolOrchestratorResult,
  sourceIds: readonly string[],
  faqDocuments: ReadonlyMap<string, FaqDocument>,
) {
  if (plan.groundingRequirement !== 'both') return ''
  if (result.grounding.faq === 'not_found') {
    return 'A política solicitada não está documentada nesta demonstração.'
  }
  return composeFaqAnswer({ question, sourceIds, faqDocuments })
}

function toProductCard(
  product: Product,
  catalog: CatalogRepository,
): ChatProductCard | undefined {
  if (
    product.stock <= 0 ||
    product.dataClassification.commercial !== 'fictional-demo' ||
    product.dataClassification.compatibility !== 'commercial-positioning' ||
    product.dataClassification.formulation !== 'synthetic-test-data' ||
    product.dataClassification.safety !== 'not-evaluated' ||
    !product.image.startsWith('images/') ||
    catalog.findImage(product.image.slice('images/'.length)) === undefined
  ) {
    return undefined
  }

  const parsed = chatProductCardSchema.safeParse({
    id: product.id,
    slug: product.slug,
    name: product.name,
    brand: product.brand,
    isDemo: product.isDemo,
    category: product.category,
    subcategory: product.subcategory,
    shortDescription: product.shortDescription,
    price: product.price,
    ...(product.originalPrice !== undefined
      ? { originalPrice: product.originalPrice }
      : {}),
    stock: product.stock,
    imageUrl: toCatalogImageUrl(product.image),
    dataClassification: product.dataClassification,
  })
  return parsed.success ? parsed.data : undefined
}

function requiredDomainFailed(result: ToolOrchestratorResult) {
  const { requirement, product, faq } = result.grounding
  return (
    (requirement === 'product' && product === 'failed') ||
    (requirement === 'faq' && faq === 'failed') ||
    (requirement === 'both' && (product === 'failed' || faq === 'failed')) ||
    (requirement === 'any' && product === 'failed' && faq === 'failed')
  )
}

function handleNonCompleted(result: ToolOrchestratorResult): never {
  if (result.status === 'cancelled') {
    throw new ChatServiceError('REQUEST_CANCELLED')
  }
  if (
    result.termination === 'OPERATION_TIMEOUT' ||
    result.termination === 'MODEL_TIMEOUT'
  ) {
    throw new ChatServiceError('AI_TIMEOUT')
  }
  if (
    result.termination === 'INVALID_MODEL_RESPONSE' ||
    result.termination === 'MODEL_TOOL_CALLING_INCOMPATIBLE'
  ) {
    throw new ChatServiceError('AI_BAD_RESPONSE')
  }
  if (
    result.termination === 'MODEL_FAILED' ||
    result.termination === 'MODEL_CONFIGURATION_INVALID' ||
    result.termination === 'MODEL_AUTHENTICATION_FAILED' ||
    result.termination === 'MODEL_RATE_LIMITED' ||
    result.termination === 'MODEL_UNAVAILABLE' ||
    result.termination === 'MODEL_CANCELLED' ||
    result.termination === 'LOCAL_BUDGET_EXHAUSTED' ||
    requiredDomainFailed(result)
  ) {
    throw new ChatServiceError('AI_UNAVAILABLE')
  }
  throw new ChatServiceError('AI_BAD_RESPONSE')
}

function controlledTextResponse(
  question: string,
  requestId: string,
  result: ToolOrchestratorResult,
  plan: ChatGroundingPlan,
  faqDocuments: ReadonlyMap<string, FaqDocument>,
  needsClarification: boolean,
): ChatResponse {
  const sourceIds = resolveFaqSourceIds(result, faqDocuments)

  if (needsClarification) {
    return chatResponseSchema.parse({
      type: 'text',
      message:
        'Preciso confirmar a restrição comercial informada antes de selecionar um produto demonstrativo.',
      reason: 'clarification',
      sourceIds,
      requestId,
    })
  }
  if (
    plan.groundingRequirement === 'both' &&
    result.grounding.product === 'not_found' &&
    result.grounding.faq === 'found'
  ) {
    const faqAnswer = composeFaqAnswer({
      question,
      sourceIds,
      faqDocuments,
    })
    return chatResponseSchema.parse({
      type: 'text',
      message: `Não encontrei um produto demonstrativo elegível para a solicitação.${faqAnswer ? ` Sobre a outra dúvida: ${faqAnswer}` : ''}`,
      reason: 'not_found',
      sourceIds,
      requestId,
    })
  }
  if (
    plan.groundingRequirement === 'both' &&
    result.grounding.product === 'not_found' &&
    result.grounding.faq === 'not_found'
  ) {
    return chatResponseSchema.parse({
      type: 'text',
      message:
        'Não encontrei um produto demonstrativo elegível nem uma política documentada para esta solicitação.',
      reason: 'not_found',
      sourceIds: [],
      requestId,
    })
  }
  if (result.grounding.status === 'not_found') {
    return chatResponseSchema.parse({
      type: 'text',
      message:
        'Não encontrei produto ou política documentada que responda com segurança a esta solicitação demonstrativa.',
      reason: 'not_found',
      sourceIds,
      requestId,
    })
  }
  if (result.grounding.faq === 'not_found' && plan.groundingRequirement === 'both') {
    return chatResponseSchema.parse({
      type: 'text',
      message:
        'Encontrei dados de produto, mas a política solicitada não está documentada nesta demonstração.',
      reason: 'not_found',
      sourceIds,
      requestId,
    })
  }
  if (sourceIds.length > 0) {
    const faqAnswer = composeFaqAnswer({
      question,
      sourceIds,
      faqDocuments,
    })
    if (faqAnswer) {
      return chatResponseSchema.parse({
        type: 'text',
        message: faqAnswer,
        sourceIds,
        requestId,
      })
    }
  }
  if (plan.groundingRequirement === 'not_required' && result.status === 'completed') {
    return chatResponseSchema.parse({
      type: 'text',
      message: result.message,
      sourceIds,
      requestId,
    })
  }
  return chatResponseSchema.parse({
    type: 'text',
    message:
      'Consultei os dados demonstrativos, mas não houve uma seleção inequívoca para exibir cartões. Posso refinar a busca com mais uma preferência.',
    reason: 'clarification',
    sourceIds,
    requestId,
  })
}

export function createChatService(
  options: CreateChatServiceOptions,
): ChatService {
  const faqDocuments = new Map(
    options.faqDocuments.map((document) => [document.sourceId, document]),
  )
  const faqTool = createSearchFaqTool(options.faqIndex)

  return {
    async execute(rawInput, execution) {
      const request = chatRequestSchema.parse(rawInput)
      if (execution.signal.aborted) {
        throw new ChatServiceError('REQUEST_CANCELLED')
      }
      for (const item of request.cart) {
        if (options.catalog.findById(item.productId) === undefined) {
          throw new ChatServiceError('INVALID_REQUEST')
        }
      }

      const clinicalResponse = clinicalSafetyResponse(
        request,
        execution.requestId,
      )
      if (clinicalResponse) return clinicalResponse

      const quoteResponse = contextualQuoteResponse(
        request,
        execution.requestId,
        options.catalog,
        faqDocuments,
      )
      if (quoteResponse) return quoteResponse

      const plan = preserveHistoricalRecommendationIntent(
        request,
        planChatGrounding(request),
      )
      const commercial = resolveCommercialContext(request, options.productIndex)
      if (
        plan.presentationIntent === 'comparison' &&
        hasUnresolvedComparisonReference(request.message) &&
        explicitComparisonIds(request.message, options.catalog).length !== 2
      ) {
        return controlledConsultativeQuestion(
          'Quais são os dois produtos que você quer comparar? Informe os dois IDs.',
          execution.requestId,
        )
      }
      const consultationQuestion = consultativeQuestion(plan, commercial)
      const policy = createProductEligibilityPolicy(
        options.productIndex,
        commercial.constraints,
      )
      const registry = createAgentToolRegistry([
        createSearchProductsTool(options.productIndex, policy),
        createGetProductDetailsTool(options.catalog, policy),
        faqTool,
      ])
      const model = execution.usageBudget
        ? createBudgetedAgentModel({
            model: options.model,
            budget: execution.usageBudget,
            onUsage: (event) =>
              observeChatOperation(execution.observer, {
                type: 'model_usage',
                requestId: execution.requestId,
                ...event,
              }),
          })
        : options.model
      const orchestrator = createToolOrchestrator({
        model,
        tools: registry,
        timeoutMs: options.timeoutMs,
        maxModelCalls: options.maxModelCalls,
        maxOutputTokens: options.maxOutputTokens,
        log: (event) => {
          if (event.type !== 'termination') return
          observeChatOperation(execution.observer, {
            type: 'orchestrator_termination',
            requestId: execution.requestId,
            status: event.status,
            modelCalls: event.modelCalls ?? 0,
            toolCalls: event.toolCalls ?? 0,
            toolErrors: event.toolErrors ?? 0,
            inputTokens: event.usage?.inputTokens ?? 0,
            outputTokens: event.usage?.outputTokens ?? 0,
            totalTokens: event.usage?.totalTokens ?? 0,
            usageComplete: event.usage?.complete ?? false,
            groundingRequirement:
              event.grounding?.requirement ?? 'not_required',
            productGrounding: event.grounding?.product ?? 'not_consulted',
            faqGrounding: event.grounding?.faq ?? 'not_consulted',
          })
        },
      })
      const result = await orchestrator.run({
        conversation: createConversation(request, commercial),
        groundingRequirement: plan.groundingRequirement,
        signal: execution.signal,
      })

      if (result.status !== 'completed') {
        if (
          consultationQuestion &&
          plan.groundingRequirement === 'product' &&
          result.termination === 'INSUFFICIENT_GROUNDING'
        ) {
          return controlledConsultativeQuestion(
            consultationQuestion,
            execution.requestId,
          )
        }
        handleNonCompleted(result)
      }

      const sourceIds = resolveFaqSourceIds(result, faqDocuments)
      if (consultationQuestion) {
        return controlledConsultativeQuestion(
          consultationQuestion,
          execution.requestId,
        )
      }
      if (plan.presentationIntent === 'text') {
        const productInformation = controlledProductInformation(
          request,
          result,
          options.catalog,
          sourceIds,
          execution.requestId,
        )
        if (productInformation) return productInformation
      }

      const authorizedIds = new Set(result.recommendationProductIds)
      const selectionContext = createAgentToolExecutionContext(execution.signal)
      const rankedIds = options.productIndex
        .search(commercial.searchInput, policy, selectionContext)
        .map((candidate) => candidate.id)
        .filter(
          (id) =>
            authorizedIds.has(id) &&
            !commercial.rejectedProductIds.has(id),
        )
      const explicitIds = explicitComparisonIds(
        request.message,
        options.catalog,
      ).filter((id) => authorizedIds.has(id))

      let selectedIds: number[] = []
      if (
        !commercial.needsClarification &&
        plan.presentationIntent === 'recommendation' &&
        hasSelectionDiscriminator(commercial) &&
        rankedIds[0] !== undefined
      ) {
        selectedIds = [rankedIds[0]]
      } else if (
        !commercial.needsClarification &&
        plan.presentationIntent === 'comparison'
      ) {
        selectedIds =
          explicitIds.length === 2
            ? explicitIds
            : !mentionsExplicitProductId(request.message) &&
                !hasUnresolvedComparisonReference(request.message) &&
                hasSelectionDiscriminator(commercial)
              ? rankedIds.slice(0, 2)
              : []
      }

      const finalPolicy = createProductEligibilityPolicy(
        options.productIndex,
        commercial.constraints,
      )
      const finalContext = createAgentToolExecutionContext(execution.signal)
      const selectedProducts = selectedIds.flatMap((id) => {
        const product = options.catalog.findById(id)
        if (
          !product ||
          !finalPolicy.evaluate(product, finalContext).eligible
        ) {
          return []
        }
        const card = toProductCard(product, options.catalog)
        return card ? [{ product, card }] : []
      })
      const products = selectedProducts.map(({ card }) => card)
      const faqAnswer = mixedFaqAnswer(
        request.message,
        plan,
        result,
        sourceIds,
        faqDocuments,
      )

      if (selectedIds.length === 1 && products.length === 1) {
        const product = products[0]
        const canonicalProduct = selectedProducts[0]?.product
        if (!canonicalProduct) {
          return controlledTextResponse(
            request.message,
            execution.requestId,
            result,
            plan,
            faqDocuments,
            commercial.needsClarification,
          )
        }
        return chatResponseSchema.parse({
          type: 'recommendation',
          message: composeRecommendationMessage(
            canonicalProduct,
            {
              searchInput: commercial.searchInput,
              sensoryTerms: commercial.sensoryTerms,
            },
            faqAnswer,
          ),
          productIds: [product?.id],
          products: [product],
          sourceIds,
          requestId: execution.requestId,
        })
      }
      if (
        selectedIds.length === 2 &&
        products.length === 2 &&
        products[0]?.id !== products[1]?.id
      ) {
        const canonicalProducts = selectedProducts.map(({ product }) => product)
        if (canonicalProducts.length !== 2) {
          return controlledTextResponse(
            request.message,
            execution.requestId,
            result,
            plan,
            faqDocuments,
            commercial.needsClarification,
          )
        }
        return chatResponseSchema.parse({
          type: 'comparison',
          message: composeComparisonMessage(
            canonicalProducts as [Product, Product],
            faqAnswer,
          ),
          productIds: [products[0]?.id, products[1]?.id],
          products: [products[0], products[1]],
          sourceIds,
          requestId: execution.requestId,
        })
      }

      return controlledTextResponse(
        request.message,
        execution.requestId,
        result,
        plan,
        faqDocuments,
        commercial.needsClarification,
      )
    },
  }
}
