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
import { hasFaqTopic, type ChatGroundingPlan } from './chat-grounding-planner.js'
import {
  clarificationReply,
  explicitRejectedProductIds,
  historicalUserMessages,
  interpretCustomerNeeds,
  matchesClarificationQuestion,
  normalize,
  shortBudgetAnswer,
  shortProductAnswer,
} from './customer-needs.js'
import {
  hasSelectionDiscriminator,
  hidrasplashConsultation,
  hidrasplashCustomerDomain,
  translateHidrasplashNeeds,
} from './hidrasplash-customer-needs.js'
import {
  decideClarification,
  type ClarificationDecision,
  type ClarificationIssue,
} from './clarification-strategy.js'
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

function controlledClarification(
  decision: Extract<ClarificationDecision, { issue: ClarificationIssue }>,
  requestId: string,
  faqText = '',
  sourceIds: readonly string[] = [],
): ChatResponse {
  const message = decision.action === 'ask' ? decision.issue.question ?? decision.issue.limitation : decision.issue.limitation
  return chatResponseSchema.parse({
    type: 'text',
    message: faqText ? `${faqText}\n\n${message}` : message,
    reason: decision.action === 'ask' ? 'clarification' : 'unable_to_verify',
    sourceIds,
    requestId,
  })
}

function quoteClarification(requestId: string, attribute: 'quantity' | 'product', question: string) {
  return controlledClarification({
    action: 'ask',
    issue: { reason: 'quote_reference', priority: 'ambiguity', attribute, question,
      limitation: 'Não consegui determinar uma cotação com os dados disponíveis.' },
  }, requestId)
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

const priceQuestion = 'De qual produto você quer saber o preço?'
const comparisonQuestion = 'Quais são os dois produtos que você quer comparar? Informe os dois IDs.'
const quoteQuestions = {
  quantity: 'A cotação calcula uma unidade por vez. Qual produto você quer cotar para uma unidade com frete?',
  multiple: 'Qual dos produtos você quer usar nessa cotação? Informe um único ID de produto.',
  product: 'Qual produto você quer usar nessa cotação? Informe um único ID de produto.',
  current: 'Não consegui confirmar essa recomendação com as condições atuais. Qual é o ID do produto que você deseja cotar?',
}

function isPriceOnly(message: string) {
  return /^(?:so|apenas) quero saber o preco[.!?]?$/.test(normalize(message))
}

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

function referenceQuestion(message: string) {
  if (matchesClarificationQuestion(message, priceQuestion)) return { kind: 'price', question: priceQuestion } as const
  if (matchesClarificationQuestion(message, comparisonQuestion)) return { kind: 'comparison', question: comparisonQuestion } as const
  const quote = Object.values(quoteQuestions).find((question) => matchesClarificationQuestion(message, question))
  return quote === undefined ? undefined : { kind: 'quote', question: quote } as const
}

function referenceAnswer(message: string) {
  const pair = normalize(message).match(/^(?:os )?produtos? (?:id )?(\d{1,6}) (e|ou) (?:(?:o )?produto )?(?:id )?(\d{1,6})[.!]?$/)
  const single = shortProductAnswer(message)
  const ids = pair?.[2] === 'e' && pair[1] !== pair[3] ? [Number(pair[1]), Number(pair[3])] :
    single === undefined ? [] : [single]
  return {
    ids,
    attempted: ids.length > 0 || pair !== null || shortBudgetAnswer(message) !== undefined || clarificationReply(message) !== undefined,
  }
}

function resolveReferenceFollowUp(request: ChatRequest, catalog: CatalogRepository) {
  const answer = referenceAnswer(request.message)
  if (!answer.attempted || clarificationReply(request.message) === 'ended') return undefined
  const last = request.history.at(-1)
  const pending = last?.role === 'assistant' ? referenceQuestion(last.content) : undefined
  if (!pending) return undefined
  const count = pending.kind === 'comparison' ? 2 : 1

  // Replay only a contiguous question/answer sequence with an actual user request at its start.
  for (let index = request.history.length - 2; index >= 0; index -= 2) {
    const user = request.history[index]
    const assistant = request.history[index + 1]
    if (user?.role !== 'user' || assistant?.role !== 'assistant' ||
      referenceQuestion(assistant.content)?.kind !== pending.kind) break
    const original = user.content
    const requested = pending.kind === 'price' ? isPriceOnly(original) :
      pending.kind === 'comparison'
        ? hasUnresolvedComparisonReference(original) && explicitComparisonIds(original, catalog).length !== 2
        : isQuoteIntent(original) &&
          (quantityReference.test(normalize(original)) || explicitInformationalProductIds(original).length !== 1)
    if (requested) {
      const [first, second] = answer.ids
      if (answer.ids.length === count && first !== undefined) {
        if (pending.kind === 'price') return { priceId: first } as const
        if (pending.kind === 'quote') return { message: `Quanto fica o total do produto ${first} com frete?` } as const
        if (second !== undefined && answer.ids.every((id) => catalog.findById(id) !== undefined)) {
          return { message: `Compare os produtos ${first} e ${second}. ${original}` } as const
        }
      }
      return { pending } as const
    }
    const previous = referenceAnswer(original)
    if (!previous.attempted || previous.ids.length === count || clarificationReply(original) === 'ended') break
  }
  return undefined
}

function currentPriceResponse(catalog: CatalogRepository, id: number, requestId: string): ChatResponse | undefined {
  const product = catalog.findById(id)
  const price = product && priceToCents(product.price)
  if (!product || price === undefined) return undefined
  return chatResponseSchema.parse({
    type: 'text',
    message: `${product.name}: preço atual de ${formatCommercialCents(price)}.`,
    sourceIds: [],
    requestId,
  })
}

function contextualQuoteResponse(
  request: ChatRequest,
  requestId: string,
  catalog: CatalogRepository,
  composer: ResponseComposer,
  recommendationIds: readonly number[],
  canQuoteRecommendation: (product: Product) => boolean,
): ChatResponse | undefined {
  if (!isQuoteIntent(request.message)) return undefined

  if (quantityReference.test(normalize(request.message))) {
    return quoteClarification(
      requestId,
      'quantity',
      quoteQuestions.quantity,
    )
  }

  const explicitIds = explicitInformationalProductIds(request.message)
  if (explicitIds.length > 1) {
    return quoteClarification(
      requestId,
      'product',
      quoteQuestions.multiple,
    )
  }
  const explicitId = explicitIds[0]
  const rejectsPreviousReference =
    explicitId === undefined &&
    differentProductReference.test(normalize(request.message))
  if (
    rejectsPreviousReference ||
    (explicitId === undefined && recommendationIds.length !== 1)
  ) {
    return quoteClarification(
      requestId,
      'product',
      quoteQuestions.product,
    )
  }

  const productId = explicitId ?? recommendationIds[0]
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
  if (explicitId === undefined && !canQuoteRecommendation(product)) {
    return quoteClarification(
      requestId,
      'product',
      quoteQuestions.current,
    )
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
): ChatResponse {
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
      'Consultei os dados disponíveis, mas ainda não consigo indicar um produto com segurança.',
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
      const received = chatRequestSchema.parse(rawInput)
      if (execution.signal.aborted) {
        throw new ChatServiceError('REQUEST_CANCELLED')
      }
      for (const item of received.cart) {
        if (options.catalog.findById(item.productId) === undefined) {
          throw new ChatServiceError('INVALID_REQUEST')
        }
      }

      const clinicalBoundary = profile.presentation?.clinicalBoundary?.(
        received.message,
        historicalUserMessages(received),
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

      const followUp = resolveReferenceFollowUp(received, options.catalog)
      if (followUp?.priceId !== undefined) {
        return currentPriceResponse(options.catalog, followUp.priceId, execution.requestId) ??
          chatResponseSchema.parse({
            type: 'text', reason: 'unable_to_verify', sourceIds: [], requestId: execution.requestId,
            message: 'Não consegui verificar o preço atual do produto indicado.',
          })
      }
      if (followUp?.pending) {
        const { kind, question } = followUp.pending
        return controlledClarification({
          action: clarificationReply(received.message) ? 'explain' : 'ask',
          issue: { reason: `${kind}_reference`, priority: 'ambiguity', attribute: 'product', question,
            limitation: 'Preciso identificar o produto ou os produtos para responder com segurança.' },
        }, execution.requestId)
      }
      const request = followUp?.message ? { ...received, message: followUp.message } : received
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
      const { plan } = needs
      const commercial = translateHidrasplashNeeds(needs, request, options.productIndex)
      const policy = createProductEligibilityPolicy(
        options.productIndex,
        commercial.constraints,
      )
      const quoteResponse = contextualQuoteResponse(
        request,
        execution.requestId,
        options.catalog,
        composer,
        needs.context.recommendationIds,
        (product) => !commercial.needsClarification &&
          !commercial.rejectedProductIds.has(product.id) &&
          policy.evaluate(product, createAgentToolExecutionContext(execution.signal)).eligible,
      )
      if (quoteResponse) {
        return completeEarly(quoteResponse, 'contextual_quote')
      }

      const consultation = hidrasplashConsultation(plan, commercial)
      const issues: ClarificationIssue[] = plan.presentationIntent === 'text' ? [] : [...consultation.issues]
      if (
        plan.presentationIntent === 'comparison' &&
        hasUnresolvedComparisonReference(request.message) &&
        explicitComparisonIds(request.message, options.catalog).length !== 2
      ) {
        issues.push({
          reason: 'comparison_reference', priority: 'ambiguity', attribute: 'products',
          question: comparisonQuestion,
          limitation: 'Preciso identificar os dois produtos para fazer uma comparação.',
        })
      }
      if (plan.presentationIntent === 'text' && isPriceOnly(request.message)) {
        const [id] = needs.context.recommendationIds
        if (needs.context.recommendationIds.length === 1 && id !== undefined &&
          !commercial.rejectedProductIds.has(id) && !needs.context.unresolvedRejection) {
          const price = currentPriceResponse(options.catalog, id, execution.requestId)
          if (price) return price
        }
        issues.push({
          reason: 'price_reference', priority: 'ambiguity', attribute: 'product',
          question: priceQuestion,
          limitation: 'Preciso identificar o produto para informar o preço.',
        })
      }
      if (shortBudgetAnswer(received.message) !== undefined && !needs.context.budgetAnswerConfirmed &&
        !issues.some((issue) => issue.attribute === 'budget')) {
        issues.push({
          reason: 'numeric_reference', priority: 'ambiguity', attribute: 'number',
          question: 'Esse número é um limite de preço ou se refere a um produto?',
          limitation: 'Ainda não consegui identificar o que esse número representa.',
        })
      }
      if (!followUp && referenceAnswer(received.message).ids.some((id) => !needs.exclusions.declared.includes(id))) {
        issues.push({
          reason: 'product_purpose', priority: 'ambiguity', attribute: 'product',
          question: 'O que você quer saber sobre o produto ou os produtos que indicou?',
          limitation: 'Preciso saber o que você quer consultar sobre esses produtos.',
        })
      }
      const decision = decideClarification({
        ...consultation,
        issues,
        plan,
        message: request.message,
        history: needs.context.history,
      })
      const pending = decision.action === 'ask' || decision.action === 'explain' ? decision : undefined
      if (pending && !hasFaqTopic(request.message)) {
        const response = controlledClarification(pending, execution.requestId)
        return pending.issue.reason === 'comparison_reference'
          ? completeEarly(response, 'comparison_clarification')
          : response
      }
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
        groundingRequirement: pending ? 'faq' : plan.groundingRequirement,
        signal: execution.signal,
      })
      const faqAnswer = result.grounding.faq === 'found'
        ? composer.faq(request.message, result.faqSourceIds)
        : undefined

      const mixedFaq = plan.groundingRequirement === 'both' ? faqAnswer : undefined
      const mixedFaqText = mixedFaq?.message ?? (
        plan.groundingRequirement === 'both' && result.grounding.faq === 'not_found'
          ? 'A política solicitada não está documentada nas fontes disponíveis.'
          : ''
      )
      const mixedSourceIds = mixedFaq?.sourceIds ?? []
      if (pending && (result.status === 'completed' || result.termination === 'INSUFFICIENT_GROUNDING')) {
        return controlledClarification(
          pending,
          execution.requestId,
          faqAnswer?.message ?? 'Não consegui verificar a política solicitada nas fontes disponíveis.',
          faqAnswer?.sourceIds,
        )
      }
      const selectionQuestion = decision.action === 'search' ? decision.question : undefined
      const missingSelectionScope = selectionQuestion?.priority === 'selection'
      const rankEligible = () => options.productIndex
        .search(commercial.searchInput, policy, createAgentToolExecutionContext(execution.signal))
        .map((candidate) => candidate.id)
        .filter((id) => !commercial.rejectedProductIds.has(id))
      const optionalCandidates = selectionQuestion && !missingSelectionScope ? rankEligible() : undefined
      if (optionalCandidates?.length === 0 && result.grounding.product !== 'not_found' &&
        (result.status === 'completed' || result.termination === 'INSUFFICIENT_GROUNDING')) {
        const unavailable = 'Não encontrei um produto elegível nas condições informadas.'
        return chatResponseSchema.parse({
          type: 'text',
          message: mixedFaqText ? `${unavailable}\n\n${mixedFaqText}` : unavailable,
          reason: mixedFaq?.status === 'unable_to_verify' ? 'unable_to_verify' : 'not_found',
          sourceIds: mixedSourceIds,
          requestId: execution.requestId,
        })
      }
      if (selectionQuestion && result.status !== 'completed' && result.termination === 'INSUFFICIENT_GROUNDING' &&
        (plan.groundingRequirement === 'product' || result.grounding.faq === 'found' || result.grounding.faq === 'not_found')) {
        return controlledClarification(
          { action: 'ask', issue: selectionQuestion }, execution.requestId, mixedFaqText, mixedSourceIds,
        )
      }
      if (result.status !== 'completed') handleNonCompleted(result)
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
      const eligibleIds = optionalCandidates ?? rankEligible()
      const rankedIds = eligibleIds.filter((id) => authorizedIds.has(id))
      const uniqueAuthorized = optionalCandidates?.length === 1 && rankedIds.length === 1
      if (selectionQuestion && (missingSelectionScope || eligibleIds.length > 0) &&
        !uniqueAuthorized && result.grounding.product !== 'not_found') {
        return controlledClarification(
          { action: 'ask', issue: selectionQuestion }, execution.requestId, mixedFaqText, mixedSourceIds,
        )
      }
      const explicitIds = explicitComparisonIds(
        request.message,
        options.catalog,
      ).filter((id) => authorizedIds.has(id) && !commercial.rejectedProductIds.has(id))

      let selectedIds: number[] = []
      if (
        decision.action === 'search' &&
        decision.selection === 'recommendation' &&
        (decision.flexible || uniqueAuthorized || hasSelectionDiscriminator(commercial)) &&
        rankedIds[0] !== undefined
      ) {
        selectedIds = [rankedIds[0]]
      } else if (
        decision.action === 'search' &&
        decision.selection === 'comparison'
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
      )
    },
  }
}
