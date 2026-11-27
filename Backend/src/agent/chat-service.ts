import type { CatalogRepository } from '../catalog/catalog-repository.js'
import { toCatalogImageUrl } from '../catalog/catalog-repository.js'
import type { Product } from '../catalog/product-schema.js'
import { priceToCents } from '../commercial/demo-commercial-rules.js'
import {
  chatProductCardSchema,
  chatRequestSchema,
  chatResponseSchema,
  type ChatProductCard,
  type ChatRequest,
  type ChatResponse,
} from '../contracts/chat.js'
import type { FaqDocument } from '../knowledge/faq-document-schema.js'
import type { FaqSearchIndex } from '../knowledge/faq-search.js'
import type { AgentMessage, AgentModelPort } from './agent-model-port.js'
import {
  createChatResponseComposer,
  formatCommercialCents,
  recommendationSubject,
  type FaqComposition,
  type StoreResponseProfile,
} from './chat-response-composer.js'
import { createConsultativeSystemInstruction } from './consultative-agent-policy.js'
import { hidrasplashResponseProfile } from './hidrasplash-response-profile.js'
import {
  createBudgetedAgentModel,
  type UsageBudgetExecution,
} from './usage-budget-controller.js'
import {
  observeChatOperation,
  type ChatOperationalObserver,
} from '../observability/chat-operational-events.js'
import type { ChatGroundingPlan } from './chat-grounding-planner.js'
import {
  explicitRejectedProductIds,
  historicalUserMessages,
  interpretCustomerNeeds,
  normalize,
} from './customer-needs.js'
import {
  consultativeQuestion,
  hasSelectionDiscriminator,
  hidrasplashCustomerDomain,
  translateHidrasplashNeeds,
} from './hidrasplash-customer-needs.js'
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
  type ProductSearchIndex,
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
  readonly responseProfile?: StoreResponseProfile
  readonly timeoutMs?: number
  readonly maxModelCalls?: number
  readonly maxOutputTokens?: number
}

type ResponseComposer = ReturnType<typeof createChatResponseComposer>

type EffectiveCommercialContext = ReturnType<typeof translateHidrasplashNeeds>

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
    preferences: context.toolPreferences && {
      ...context.toolPreferences,
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

const quantityReference = new RegExp(
  `\\b(?:[2-9]|[1-9]\\d{1,5}|dois|duas|tres|quatro|cinco|seis|sete|oito|nove|dez)\\s*(?:${hidrasplashCustomerDomain.quoteQuantityNouns})\\b`,
)
const recommendedProductReference = new RegExp(
  `\\b(?:esse|essa|desse|dessa|deste|desta)\\s+(?:${hidrasplashCustomerDomain.quoteProductNouns})\\b.*\\b(?:recomendou|recomendado)\\b`,
)
const differentProductReference = new RegExp(
  `\\b(?:outro|outra|(?:${hidrasplashCustomerDomain.quoteProductNouns}) diferente)\\b`,
)

function isQuoteIntent(message: string) {
  const normalized = normalize(message)
  const asksTotal = /\b(?:total|valor final)\b/.test(normalized)
  const referencesRecommendation = recommendedProductReference.test(normalized)
  return (
    (asksTotal && referencesRecommendation) ||
    (/\bfrete\b/.test(normalized) &&
      (asksTotal ||
      /\bquanto\s+(?:ficaria|fica|daria|da|custaria|custa)\b/.test(
        normalized,
      )))
  )
}

function contextualQuoteResponse(
  request: ChatRequest,
  requestId: string,
  catalog: CatalogRepository,
  composer: ResponseComposer,
  rejectedIds: ReadonlySet<number>,
): ChatResponse | undefined {
  if (!isQuoteIntent(request.message)) return undefined

  if (quantityReference.test(normalize(request.message))) {
    return controlledConsultativeQuestion(
      'A cotação calcula uma unidade por vez. Informe um único produto para cotar uma unidade com frete.',
      requestId,
    )
  }

  const explicitIds = explicitInformationalProductIds(request.message)
  if (explicitIds.length > 1) {
    return controlledConsultativeQuestion(
      'Qual dos produtos você quer usar nessa cotação? Informe um único ID de produto.',
      requestId,
    )
  }
  const explicitId = explicitIds[0]
  const contextualIds = (request.recommendationContext?.productIds ?? []).filter(
    (productId) => !rejectedIds.has(productId),
  )
  const rejectsPreviousReference =
    explicitId === undefined &&
    differentProductReference.test(normalize(request.message))
  if (
    rejectsPreviousReference ||
    (explicitId === undefined && contextualIds.length !== 1)
  ) {
    return controlledConsultativeQuestion(
      'Qual produto você quer usar nessa cotação? Informe um único ID de produto.',
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
        'Não consegui revalidar esse produto com estoque no catálogo atual. Informe outro ID para uma nova cotação.',
      reason: 'not_found',
      sourceIds: [],
      requestId,
    })
  }

  if (priceToCents(product.price) === undefined) {
    return chatResponseSchema.parse({
      type: 'text',
      message:
        'Não foi possível validar o preço atual desse produto para uma cotação.',
      reason: 'unable_to_verify',
      sourceIds: [],
      requestId,
    })
  }
  const quote = composer.quote(product)
  if (!quote) {
    return chatResponseSchema.parse({
      type: 'text',
      message: 'Consegui validar o produto, mas não a política de frete necessária para calcular o total.',
      reason: 'unable_to_verify',
      sourceIds: [],
      requestId,
    })
  }

  return chatResponseSchema.parse({ type: 'text', ...quote, requestId })
}

function controlledProductInformation(
  request: ChatRequest,
  result: ToolOrchestratorResult,
  catalog: CatalogRepository,
  describeIngredients: NonNullable<StoreResponseProfile['presentation']>['describeIngredients'],
): string | undefined {
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

  if (
    describeIngredients &&
    hidrasplashCustomerDomain.isFormulationQuestion(normalized)
  ) {
    return `${product.name}: ${describeIngredients(product)}`
  }
  if (/\b(?:preco|custa|valor|estoque|disponivel|disponibilidade)\b/.test(normalized)) {
    const price = priceToCents(product.price)
    if (price === undefined) return undefined
    return `${product.name}: preço atual de ${formatCommercialCents(price)} e estoque atual de ${product.stock} unidade(s).`
  }
  return undefined
}

export function toProductCard(
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
  requestId: string,
  result: ToolOrchestratorResult,
  plan: ChatGroundingPlan,
  faqAnswer: FaqComposition | undefined,
  needsClarification: boolean,
): ChatResponse {
  if (needsClarification) {
    const mixedFaq = plan.groundingRequirement === 'both' ? faqAnswer : undefined
    return chatResponseSchema.parse({
      type: 'text',
      message: `Preciso confirmar a restrição comercial informada antes de selecionar um produto.${mixedFaq ? ` Sobre a outra dúvida: ${mixedFaq.message}` : ''}`,
      reason: 'clarification',
      sourceIds: mixedFaq?.sourceIds ?? [],
      requestId,
    })
  }
  if (
    plan.groundingRequirement === 'both' &&
    result.grounding.product === 'not_found' &&
    faqAnswer
  ) {
    return chatResponseSchema.parse({
      type: 'text',
      message: `Não encontrei um produto elegível para a solicitação. Sobre a outra dúvida: ${faqAnswer.message}`,
      reason: faqAnswer.status === 'unable_to_verify' ? 'unable_to_verify' : 'not_found',
      sourceIds: faqAnswer.sourceIds,
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
        'Não encontrei um produto elegível nem uma política documentada para esta solicitação.',
      reason: 'not_found',
      sourceIds: [],
      requestId,
    })
  }
  if (result.grounding.status === 'not_found') {
    return chatResponseSchema.parse({
      type: 'text',
      message:
        'Não encontrei produto ou política documentada que responda com segurança a esta solicitação.',
      reason: 'not_found',
      sourceIds: [],
      requestId,
    })
  }
  if (result.grounding.faq === 'not_found' && plan.groundingRequirement === 'both') {
    return chatResponseSchema.parse({
      type: 'text',
      message:
        'Encontrei dados de produto, mas a política solicitada não está documentada nas fontes disponíveis.',
      reason: 'not_found',
      sourceIds: [],
      requestId,
    })
  }
  if (faqAnswer) {
    return chatResponseSchema.parse({
      type: 'text',
      message: faqAnswer.message,
      ...(faqAnswer.status === 'unable_to_verify' ? { reason: 'unable_to_verify' } : {}),
      sourceIds: faqAnswer.sourceIds,
      requestId,
    })
  }
  if (plan.groundingRequirement === 'not_required' && result.status === 'completed') {
    return chatResponseSchema.parse({
      type: 'text',
      message: result.message,
      sourceIds: [],
      requestId,
    })
  }
  return chatResponseSchema.parse({
    type: 'text',
    message:
      'Consultei os dados disponíveis, mas não houve uma seleção inequívoca para exibir cartões. Posso refinar a busca com mais uma preferência.',
    reason: 'clarification',
    sourceIds: [],
    requestId,
  })
}

export function createChatService(
  options: CreateChatServiceOptions,
): ChatService {
  const profile = options.responseProfile === undefined
    ? hidrasplashResponseProfile
    : options.responseProfile
  const systemInstruction = createConsultativeSystemInstruction({
    storeName: profile?.storeName,
    domainInstructions: profile?.domainInstructions,
  })
  const composer = createChatResponseComposer(profile, options.faqDocuments)
  const faqTool = createSearchFaqTool(options.faqIndex)

  return {
    async execute(rawInput, execution) {
      const completeEarly = (
        response: ChatResponse,
        reason:
          | 'clinical_boundary'
          | 'contextual_quote'
          | 'comparison_clarification',
      ) => {
        observeChatOperation(execution.observer, {
          type: 'chat_service_early_completion',
          requestId: execution.requestId,
          reason,
        })
        return response
      }
      const request = chatRequestSchema.parse(rawInput)
      if (execution.signal.aborted) {
        throw new ChatServiceError('REQUEST_CANCELLED')
      }
      for (const item of request.cart) {
        if (options.catalog.findById(item.productId) === undefined) {
          throw new ChatServiceError('INVALID_REQUEST')
        }
      }

      const clinicalBoundary = profile.presentation?.clinicalBoundary?.(
        request.message,
        historicalUserMessages(request),
      )
      if (clinicalBoundary) {
        return completeEarly(
          chatResponseSchema.parse({
            type: 'text',
            message: clinicalBoundary,
            reason: 'unable_to_verify',
            sourceIds: [],
            requestId: execution.requestId,
          }),
          'clinical_boundary',
        )
      }

      const needs = interpretCustomerNeeds(
        request,
        hidrasplashCustomerDomain,
        (message) => recommendationSubject(message, options.catalog.listAll()),
      )
      if (needs.context.interrupted) {
        return chatResponseSchema.parse({
          type: 'text',
          message: 'Tudo bem, vou encerrar esta busca.',
          sourceIds: [],
          requestId: execution.requestId,
        })
      }
      const quoteResponse = contextualQuoteResponse(
        request,
        execution.requestId,
        options.catalog,
        composer,
        new Set([...needs.exclusions.declared, ...needs.exclusions.inferred]),
      )
      if (quoteResponse) {
        return completeEarly(quoteResponse, 'contextual_quote')
      }

      const { plan } = needs
      const commercial = translateHidrasplashNeeds(needs, request, options.productIndex)
      if (
        plan.presentationIntent === 'comparison' &&
        hasUnresolvedComparisonReference(request.message) &&
        explicitComparisonIds(request.message, options.catalog).length !== 2
      ) {
        return completeEarly(
          controlledConsultativeQuestion(
            'Quais são os dois produtos que você quer comparar? Informe os dois IDs.',
            execution.requestId,
          ),
          'comparison_clarification',
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
        systemInstruction: () => systemInstruction,
        timeoutMs: options.timeoutMs,
        maxModelCalls: options.maxModelCalls,
        maxOutputTokens: options.maxOutputTokens,
        log: (event) => {
          if (event.type === 'tool') {
            if (
              event.toolName === undefined ||
              event.ordinal === undefined ||
              event.executed === undefined ||
              event.outcome === undefined
            ) {
              return
            }
            observeChatOperation(execution.observer, {
              type: 'orchestrator_tool',
              requestId: execution.requestId,
              ordinal: event.ordinal,
              toolName: registry.get(event.toolName)?.name ?? 'unknown_tool',
              status: event.status,
              executed: event.executed,
              outcome: event.outcome,
            })
            return
          }
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
      const faqAnswer = result.grounding.faq === 'found'
        ? composer.faq(request.message, result.faqSourceIds)
        : undefined

      if (result.status !== 'completed') {
        if (commercial.needsClarification && result.termination === 'INSUFFICIENT_GROUNDING') {
          return controlledTextResponse(execution.requestId, result, plan, faqAnswer, true)
        }
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

      if (consultationQuestion) {
        return controlledConsultativeQuestion(
          consultationQuestion,
          execution.requestId,
        )
      }
      const mixedFaq = plan.groundingRequirement === 'both' ? faqAnswer : undefined
      const mixedFaqText = mixedFaq?.message ?? (
        plan.groundingRequirement === 'both' && result.grounding.faq === 'not_found'
          ? 'A política solicitada não está documentada nas fontes disponíveis.'
          : ''
      )
      const mixedSourceIds = mixedFaq?.sourceIds ?? []
      if (plan.presentationIntent === 'text') {
        const productInformation = controlledProductInformation(
          request,
          result,
          options.catalog,
          profile.presentation?.describeIngredients,
        )
        if (productInformation) {
          return chatResponseSchema.parse({
            type: 'text',
            message: mixedFaqText ? `${productInformation}\n\n${mixedFaqText}` : productInformation,
            ...(mixedFaq?.status === 'unable_to_verify' ? { reason: 'unable_to_verify' } : {}),
            sourceIds: mixedSourceIds,
            requestId: execution.requestId,
          })
        }
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
      ).filter((id) => authorizedIds.has(id) && !commercial.rejectedProductIds.has(id))

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
          commercial.rejectedProductIds.has(id) ||
          !finalPolicy.evaluate(product, finalContext).eligible
        ) {
          return []
        }
        const card = toProductCard(product, options.catalog)
        return card ? [{ product, card }] : []
      })
      const products = selectedProducts.map(({ card }) => card)
      if (selectedIds.length === 1 && products.length === 1) {
        const product = products[0]
        const canonicalProduct = selectedProducts[0]?.product
        if (!canonicalProduct) {
          return controlledTextResponse(
            execution.requestId,
            result,
            plan,
            faqAnswer,
            commercial.needsClarification,
          )
        }
        return chatResponseSchema.parse({
          type: 'recommendation',
          message: composer.recommendation(
            canonicalProduct,
            commercial.presentation,
            mixedFaqText,
          ),
          productIds: [product?.id],
          products: [product],
          sourceIds: mixedSourceIds,
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
            execution.requestId,
            result,
            plan,
            faqAnswer,
            commercial.needsClarification,
          )
        }
        return chatResponseSchema.parse({
          type: 'comparison',
          message: composer.comparison(
            canonicalProducts as [Product, Product],
            mixedFaqText,
          ),
          productIds: [products[0]?.id, products[1]?.id],
          products: [products[0], products[1]],
          sourceIds: mixedSourceIds,
          requestId: execution.requestId,
        })
      }

      return controlledTextResponse(
        execution.requestId,
        result,
        plan,
        faqAnswer,
        commercial.needsClarification,
      )
    },
  }
}
