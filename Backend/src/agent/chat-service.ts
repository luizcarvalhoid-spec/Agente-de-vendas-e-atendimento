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
}

interface EffectiveCommercialContext {
  constraints: ProductEligibilityConstraints
  searchInput: SearchProductsInput
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

function inferScalpTypes(message: string): readonly ScalpType[] | undefined {
  const normalized = normalize(message)
  const types: ScalpType[] = []
  if (/\bcouro(?: cabeludo)? oleoso\b/.test(normalized)) types.push('oleoso')
  if (/\bcouro(?: cabeludo)? seco\b/.test(normalized)) types.push('seco')
  if (/\bcouro(?: cabeludo)? normal\b/.test(normalized)) types.push('normal')
  if (/\bcouro(?: cabeludo)? sensivel\b/.test(normalized)) types.push('sensivel')
  return types.length > 0 ? types : undefined
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

function extractAvoidedIngredientTerms(message: string) {
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
  const category = preferences.category ?? inferCategory(request.message)
  const subcategory =
    preferences.subcategory ?? inferSubcategory(request.message)
  const scalpTypes =
    preferences.scalpTypes ?? inferScalpTypes(request.message)
  const hairConcerns =
    preferences.hairConcerns ?? inferHairConcerns(request.message)

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
    query: request.message,
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
    input.maxPrice !== undefined ||
    input.hairTypes !== undefined ||
    input.scalpTypes !== undefined ||
    input.hairConcerns !== undefined ||
    input.skinTypes !== undefined ||
    input.bodyConcerns !== undefined ||
    input.incompatibleIngredientIds !== undefined ||
    /\b(?:frescor|refrescante|citrico|herbal|suave|intenso|coco|camomila|aloe|hortela|limao)\b/.test(
      normalized,
    )
  )
}

function explicitComparisonIds(message: string, catalog: CatalogRepository) {
  const normalized = normalize(message)
  const match = normalized.match(
    /\b(?:compare|comparar|comparacao entre)\s+(?:os\s+)?produtos?\s+(?:id\s*)?(\d{1,6})\s+(?:e|com|versus|vs)\s+(?:(?:o|com o)\s+)?(?:produto\s+)?(?:id\s*)?(\d{1,6})\b/,
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

function resolveFaqSourceIds(
  result: ToolOrchestratorResult,
  faqDocuments: ReadonlyMap<string, FaqDocument>,
) {
  return result.faqSourceIds.filter((sourceId) => faqDocuments.has(sourceId))
}

function mixedPolicySuffix(
  plan: ChatGroundingPlan,
  result: ToolOrchestratorResult,
  sourceIds: readonly string[],
  faqDocuments: ReadonlyMap<string, FaqDocument>,
) {
  if (plan.groundingRequirement !== 'both') return ''
  if (result.grounding.faq === 'not_found') {
    return ' A política solicitada não está documentada nesta demonstração.'
  }
  const source = faqDocuments.get(sourceIds[0] ?? '')
  return source ? ` Política documentada: ${source.content}` : ''
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
  if (result.termination === 'OPERATION_TIMEOUT') {
    throw new ChatServiceError('AI_TIMEOUT')
  }
  if (result.termination === 'MODEL_FAILED' || requiredDomainFailed(result)) {
    throw new ChatServiceError('AI_UNAVAILABLE')
  }
  throw new ChatServiceError('AI_BAD_RESPONSE')
}

function controlledTextResponse(
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
    const source = faqDocuments.get(sourceIds[0] ?? '')
    if (source) {
      return chatResponseSchema.parse({
        type: 'text',
        message: source.content,
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

      const plan = planChatGrounding(request)
      const commercial = resolveCommercialContext(request, options.productIndex)
      const policy = createProductEligibilityPolicy(
        options.productIndex,
        commercial.constraints,
      )
      const registry = createAgentToolRegistry([
        createSearchProductsTool(options.productIndex, policy),
        createGetProductDetailsTool(options.catalog, policy),
        faqTool,
      ])
      const orchestrator = createToolOrchestrator({
        model: options.model,
        tools: registry,
        timeoutMs: options.timeoutMs,
      })
      const result = await orchestrator.run({
        conversation: createConversation(request, commercial),
        groundingRequirement: plan.groundingRequirement,
        signal: execution.signal,
      })

      if (result.status !== 'completed') handleNonCompleted(result)

      const authorizedIds = new Set(result.recommendationProductIds)
      const selectionContext = createAgentToolExecutionContext(execution.signal)
      const rankedIds = options.productIndex
        .search(commercial.searchInput, policy, selectionContext)
        .map((candidate) => candidate.id)
        .filter((id) => authorizedIds.has(id))
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
                hasSelectionDiscriminator(commercial)
              ? rankedIds.slice(0, 2)
              : []
      }

      const finalPolicy = createProductEligibilityPolicy(
        options.productIndex,
        commercial.constraints,
      )
      const finalContext = createAgentToolExecutionContext(execution.signal)
      const products = selectedIds.flatMap((id) => {
        const product = options.catalog.findById(id)
        if (
          !product ||
          !finalPolicy.evaluate(product, finalContext).eligible
        ) {
          return []
        }
        const card = toProductCard(product, options.catalog)
        return card ? [card] : []
      })
      const sourceIds = resolveFaqSourceIds(result, faqDocuments)
      const policySuffix = mixedPolicySuffix(
        plan,
        result,
        sourceIds,
        faqDocuments,
      )

      if (selectedIds.length === 1 && products.length === 1) {
        const product = products[0]
        return chatResponseSchema.parse({
          type: 'recommendation',
          message: `Com base nas preferências informadas e nos dados demonstrativos atuais, selecionei ${product?.name}. Confira o cartão com preço e estoque canônicos.${policySuffix}`,
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
        return chatResponseSchema.parse({
          type: 'comparison',
          message: `Comparei ${products[0]?.name} e ${products[1]?.name} usando os dados demonstrativos atuais do catálogo.${policySuffix}`,
          productIds: [products[0]?.id, products[1]?.id],
          products: [products[0], products[1]],
          sourceIds,
          requestId: execution.requestId,
        })
      }

      return controlledTextResponse(
        execution.requestId,
        result,
        plan,
        faqDocuments,
        commercial.needsClarification,
      )
    },
  }
}
