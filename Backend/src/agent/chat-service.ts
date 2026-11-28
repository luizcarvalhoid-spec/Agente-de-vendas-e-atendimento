import type { CatalogRepository } from '../catalog/catalog-repository.js'
import { toCatalogImageUrl } from '../catalog/catalog-repository.js'
import type { Product } from '../catalog/product-schema.js'
import { priceToCents } from '../commercial/demo-commercial-rules.js'
import {
  CHAT_MAX_MESSAGE_CHARACTERS,
  CHAT_MAX_SOURCES,
  chatProductCardSchema,
  chatRequestSchema,
  chatResponseSchema,
  type ChatProductCard,
  type ChatRequest,
  type ChatResponse,
} from '../contracts/chat.js'
import type { FaqDocument } from '../knowledge/faq-document-schema.js'
import { FAQ_SEARCH_MAX_QUERY_LENGTH, type FaqSearchIndex } from '../knowledge/faq-search.js'
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
  needValue,
  normalize,
  shortBudgetAnswer,
  shortProductAnswer,
  type CustomerNeeds,
} from './customer-needs.js'
import { cheaperPriceCeiling, readObjections, resumesSearch } from './objection-strategy.js'
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
import { createSearchFaqTool, type SearchFaqTool } from './tools/search-faq-tool.js'

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
  const lists = normalized.matchAll(/\bprodutos?\s+(?:ids?\s*)?(\d+(?:(?:\s*,\s*(?:e\s+)?|\s+e\s+)(?:ids?\s*)?\d+)*)\b/g)
  const ids = Array.from(lists).flatMap(([, list]) => (list?.match(/\d+/g) ?? []).map(Number))
  return [...new Set(ids.filter((id) => Number.isSafeInteger(id) && !rejectedIds.has(id)))]
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
const cheaperQuestion = 'Em relação a qual produto você quer uma opção mais barata? Informe um único ID.'
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
  if (matchesClarificationQuestion(message, cheaperQuestion)) return { kind: 'cheaper', question: cheaperQuestion } as const
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
      pending.kind === 'cheaper' ? readObjections([normalize(original)]).cheaper :
      pending.kind === 'comparison'
        ? hasUnresolvedComparisonReference(original) && explicitComparisonIds(original, catalog).length !== 2
        : isQuoteIntent(original) &&
          (quantityReference.test(normalize(original)) || explicitInformationalProductIds(original).length !== 1)
    if (requested) {
      const [first, second] = answer.ids
      if (answer.ids.length === count && first !== undefined) {
        if (pending.kind === 'price') return { priceId: first } as const
        if (pending.kind === 'cheaper') return { message: `Tem algo mais barato que o produto ${first}?` } as const
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

function describeProductInformation(
  message: string,
  product: Product,
  describeIngredients: NonNullable<StoreResponseProfile['presentation']>['describeIngredients'],
  requestedOnly = false,
): string | undefined {
  const normalized = normalize(message)

  if (
    describeIngredients &&
    hidrasplashCustomerDomain.isFormulationQuestion(normalized)
  ) {
    return `${product.name}: ${describeIngredients(product)}`
  }
  const asksPrice = /\b(?:preco|custa|valor)\b/.test(normalized)
  const asksStock = /\b(?:estoque|disponivel|disponibilidade)\b/.test(normalized)
  if (!asksPrice && !asksStock) return undefined
  const price = priceToCents(product.price)
  if ((!requestedOnly || asksPrice) && price === undefined) return undefined
  const facts = [
    ...((!requestedOnly || asksPrice) && price !== undefined ? [`preço atual de ${formatCommercialCents(price)}`] : []),
    ...(!requestedOnly || asksStock ? [`estoque atual de ${product.stock} unidade(s)`] : []),
  ]
  return `${product.name}: ${facts.join(' e ')}.`
}

function controlledProductInformation(
  request: ChatRequest,
  result: ToolOrchestratorResult,
  catalog: CatalogRepository,
  describeIngredients: NonNullable<StoreResponseProfile['presentation']>['describeIngredients'],
) {
  const id = explicitInformationalProductId(request.message)
  const product = id !== undefined && result.consultedProductIds.includes(id) ? catalog.findById(id) : undefined
  return product && describeProductInformation(request.message, product, describeIngredients)
}

const objectionAcknowledgments = {
  price: 'Entendo que o preço pesa na decisão.',
  freight: 'Faz sentido considerar o frete no custo total.',
  competitor: 'Faz sentido comparar os preços antes de decidir. Não consigo verificar o valor da outra loja.',
  rationale: 'A indicação deve se apoiar nas características verificáveis do catálogo e nas condições que você informou.',
  attribute: 'Entendido. Vou levar essa preferência em conta dentro do que o catálogo permite verificar.',
  hesitation: 'Tudo bem decidir no seu tempo.',
  pause: 'Tudo bem. Podemos retomar quando você quiser.',
  stop: 'Tudo bem, vou encerrar esta busca.',
  product: 'Entendido. Vou deixar esse produto de fora desta busca.',
} as const

type HidrasplashNeeds = CustomerNeeds<ReturnType<typeof hidrasplashCustomerDomain.interpret>>

function objectionReference(message: string, context: HidrasplashNeeds['context'], catalog: CatalogRepository) {
  const explicit = explicitInformationalProductIds(message)
  const ids = explicit.length ? explicit : context.recommendationIds
  if (ids.length > 1) return undefined
  const latest = context.history.at(-1)
  const id = ids[0] ??
    (latest?.role === 'assistant' ? recommendationSubject(latest.content, catalog.listAll()) : undefined)
  return id === undefined ? undefined : catalog.findById(id)
}

function acknowledgeObjection(needs: HidrasplashNeeds, request: ChatRequest) {
  const { primary } = needs.objection.interpretation
  if (primary === 'frustration') {
    const { domain } = needs
    const budget = needValue(needs.budget)
    const category = needValue(domain.category)
    const objective = needValue(domain.objective)
    const exclusions = needValue(domain.restrictions.ingredientExclusions)
    const requirement = needValue(domain.restrictions.unsupportedRequirement)
    const { scalpTypes, hairTypes, skinTypes, hairConcerns, bodyConcerns, sensory, preferredIngredientExclusions } = domain.preferences
    const usage = [...(needValue(scalpTypes) ?? []), ...(needValue(hairTypes) ?? []), ...(needValue(skinTypes) ?? [])]
    const concerns = [...(needValue(hairConcerns) ?? []), ...(needValue(bodyConcerns) ?? [])]
    const preferences = [...(needValue(sensory) ?? []), ...(needValue(preferredIngredientExclusions) ?? []).map((term) => 'evitar ' + term)]
    const feedback = normalize(request.message)
    const previous = request.history.at(-1)
    const question = previous?.role === 'assistant' && previous.content.includes('?')
      ? normalize(previous.content.split(/\n\s*\n/).at(-1) ?? '') : ''
    const cues: readonly [RegExp, string | undefined][] = [
      [/\b(?:deixar de fora|nao quero (?:esse|este|o) produto|produto rejeitado)\b/,
        !needs.context.unresolvedRejection && (needs.exclusions.declared.length || needs.exclusions.inferred.length)
          ? 'O produto rejeitado fica de fora da busca.' : undefined],
      [/\b(?:teto|orcamento|limite|valor maximo)\b/,
        budget !== undefined ? 'O teto informado é ' + formatCommercialCents(Math.round(budget * 100)) + '.'
          : needs.budget.origin === 'ambiguous' ? 'O teto ainda está em aberto.' : undefined],
      [/\b(?:ingredientes?|restricao|requisito|obrigatori[oa])\b/,
        exclusions?.length ? 'Vou manter a condição de evitar ' + exclusions.join(', ') + '.'
          : requirement ? 'Vou manter como requisito ' + requirement + '.' : undefined],
      [/\b(?:categoria|tipo de produto)\b/,
        category ? 'A categoria informada é ' + category.replaceAll('-', ' ') + '.'
          : domain.category.origin === 'ambiguous' ? 'A categoria ainda está em aberto.' : undefined],
      [/\b(?:finalidade|objetivo|para que|o que voce quer priorizar)\b/,
        objective ? 'A finalidade informada é ' + objective.replaceAll('-', ' ') + '.'
          : domain.objective.origin === 'ambiguous' ? 'A finalidade ainda está em aberto.'
          : concerns.length ? 'Vou considerar a prioridade informada (' + concerns.join(', ') + ').' : undefined],
      [/\b(?:perfil de uso|couro cabeludo|tipo de (?:cabelo|pele))\b/,
        usage.length ? 'Já tenho o perfil informado (' + [...new Set(usage)].join(', ') + ').' : undefined],
      [/\b(?:preferencia|preferencias|frescor|fragrancia)\b/,
        preferences.length ? 'Vou manter a preferência por ' + preferences.join(', ') + '.' : undefined],
    ]
    const explicit = cues.filter(([pattern]) => pattern.test(feedback))
    const relevantCues = explicit.length ? explicit : cues.filter(([pattern]) => pattern.test(question))
    const relevant = relevantCues.length === 1 ? relevantCues[0] : undefined
    if (relevant?.[1]) return relevant[1] + ' Vou evitar repetir a pergunta.'
    if (relevant) {
      return 'Não consigo recuperar a resposta anterior no trecho da conversa disponível. Vou evitar repetir a pergunta agora.'
    }
    return 'Entendi. Vou considerar o que estiver disponível e evitar repetir perguntas.'
  }
  if (primary === 'price' && needs.budget.origin === 'declared') {
    return 'Vou usar o teto de ' + formatCommercialCents(Math.round(needs.budget.value * 100)) + ' que você informou.'
  }
  return primary && primary in objectionAcknowledgments
    ? objectionAcknowledgments[primary as keyof typeof objectionAcknowledgments] : ''
}

async function composeObjectionInformation(
  needs: HidrasplashNeeds,
  requestMessage: string,
  acknowledge: string,
  dependencies: {
    readonly catalog: CatalogRepository
    readonly profile: StoreResponseProfile
    readonly composer: ResponseComposer
    readonly faqTool: SearchFaqTool
    readonly quote: (question: string) => ChatResponse | undefined
  },
  messageLimit = CHAT_MAX_MESSAGE_CHARACTERS,
) {
  const { catalog, profile, composer, faqTool, quote } = dependencies
  const { information, interpretation: { primary, topics } } = needs.objection
  const statements = new Set<string>()
  const sourceIds = new Set<string>()
  let incomplete = false
  let clarification: string | undefined
  let quoted = false
  let omitted = false
  let messageLength = 0
  const add = (message: string, sources: readonly string[] = []) => {
    if (!message || statements.has(message)) return
    const combined = new Set([...sourceIds, ...sources])
    if (combined.size > CHAT_MAX_SOURCES || messageLength + message.length + 2 > messageLimit - 320) {
      omitted = true
      return
    }
    statements.add(message)
    messageLength += message.length + 2
    for (const id of sources) sourceIds.add(id)
  }
  const lookupFaq = async (
    question: string, selects?: (source: { sourceId: string; title: string }) => boolean, query = question,
  ) => {
    const result = await faqTool.execute({ query: query.slice(0, FAQ_SEARCH_MAX_QUERY_LENGTH) })
    const matches = result.ok ? result.sources.filter((source) => !selects || selects(source)) : []
    let answer = composer.faq(question, matches.map(({ sourceId }) => sourceId))
    if (answer.status === 'complete' && answer.sourceIds.every((id) => sourceIds.has(id))) return true
    const available = CHAT_MAX_SOURCES - sourceIds.size
    const included = [...answer.sourceIds.filter((id) => sourceIds.has(id)),
      ...answer.sourceIds.filter((id) => !sourceIds.has(id)).slice(0, available)]
    if (included.length < answer.sourceIds.length) {
      omitted = true
      if (included.length === 0) return false
      answer = composer.faq(question, included)
    }
    add(answer.message, answer.sourceIds)
    incomplete ||= answer.status !== 'complete'
    return answer.status !== 'unable_to_verify'
  }

  add(acknowledge)
  const suspended = needs.context.paused || needs.context.interrupted
  if (topics.includes('freight') && !suspended) {
    if (primary !== 'freight') add(objectionAcknowledgments.freight)
    await lookupFaq('Qual é o valor do frete padrão e quando há frete grátis?',
      ({ sourceId }) => sourceId === profile.shipping?.freeShippingFaq.sourceId ||
        sourceId === profile.shipping?.standardShippingFaq.sourceId, 'frete grátis')
  }
  if (topics.includes('discount')) {
    const verified = await lookupFaq('Existem cupons ou descontos além dos preços do catálogo?',
      ({ title }) => /\b(?:descontos?|cupom|cupons)\b/.test(normalize(title)))
    if (!verified && !omitted) add('Não consigo confirmar ou aplicar um desconto nesta conversa.')
  }
  if (topics.includes('competitor') && primary !== 'competitor' && !suspended) add(objectionAcknowledgments.competitor)
  const reference = (message: string) => objectionReference(message, needs.context, catalog)
  if (!information.length && !suspended && (primary === 'competitor' || primary === 'discount')) {
    const product = reference(requestMessage)
    const price = product && priceToCents(product.price)
    if (product && price !== undefined) add(product.name + ': preço atual de ' + formatCommercialCents(price) + '.')
  }
  if (primary === 'fit' || primary === 'confidence') {
    const product = reference(requestMessage)
    const description = product && profile.presentation?.describeProduct?.(product)
    if (description && product) add('O catálogo descreve ' + product.name + ' com ' + description + '.')
    add('Posso me apoiar nas características registradas no catálogo. Elas não garantem um resultado individual.')
    incomplete = true
  }
  for (const question of information) {
    const quotation = quote(question)
    if (quotation?.type === 'text') {
      quoted = true
      if (quotation.reason === 'clarification' && !suspended) {
        clarification ??= quotation.message
        continue
      }
      if (quotation.reason) {
        incomplete = true
        if (suspended) {
          add('Não consegui verificar o total solicitado com os dados disponíveis.')
          continue
        }
      }
      add(quotation.message, quotation.sourceIds)
      continue
    }
    const asksPolicy = hasFaqTopic(question)
    if (asksPolicy) {
      const query = question.replace(/^(?:queria|quero|gostaria de) (?:saber|entender|confirmar)(?: sobre| se)?\s+/i, '')
      await lookupFaq(question, undefined, query)
    }
    const explicitIds = explicitInformationalProductIds(question)
    if (asksPolicy && explicitIds.length === 0) continue
    const references = explicitIds.length ? explicitIds : [reference(question)?.id]
    for (const id of references) {
      const product = id === undefined ? undefined : catalog.findById(id)
      const facts = product && describeProductInformation(question, product, profile.presentation?.describeIngredients, true)
      if (facts) {
        add(facts)
        continue
      }
      incomplete = true
      add(id !== undefined && !product
        ? `Não encontrei o produto ${id} no catálogo atual.`
        : 'Não consegui verificar essa informação com os dados disponíveis.')
    }
  }
  if (omitted) statements.add('Parte do pedido ficou sem resposta porque não foi possível incluir todas as informações com suas fontes.')
  if (clarification) statements.add(clarification)
  return {
    message: [...statements].join('\n\n'),
    incomplete: incomplete || omitted,
    clarification: clarification !== undefined,
    quoted,
    sourceIds: [...sourceIds],
  }
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
      const { plan, objection } = needs
      const { primary, cheaper, cheaperRequest } = objection.interpretation
      const textResponse = (
        message: string,
        details: Pick<Extract<ChatResponse, { type: 'text' }>, 'reason' | 'sourceIds'> = { sourceIds: [] },
      ) => chatResponseSchema.parse({ type: 'text', message, ...details, requestId: execution.requestId })
      if (objection.action === 'stop') return textResponse(objectionAcknowledgments.stop)
      if (objection.action === 'pause') return textResponse(objectionAcknowledgments.pause)

      const shoppingForCheaper = objection.action === 'alternative' && cheaper
      const priceReference = shoppingForCheaper
        ? objectionReference(cheaperRequest, needs.context, options.catalog) : undefined
      const price = priceReference && priceToCents(priceReference.price)
      const budget = needs.budget.origin === 'ambiguous' ? needs.budget.conservativeValue : needValue(needs.budget)
      const derivedMaximum = price === undefined ? undefined : cheaperPriceCeiling(price, budget)
      const commercial = translateHidrasplashNeeds(needs, request, options.productIndex,
        priceReference && derivedMaximum !== undefined ? { ...priceReference, maxPrice: derivedMaximum } : undefined)
      const acknowledge = acknowledgeObjection(needs, request)
      const rejectionId = shortProductAnswer(received.message)
      const answeredRejection = rejectionId !== undefined && needs.exclusions.declared.includes(rejectionId)
      if ((primary === 'product' && objection.action === 'acknowledge') || answeredRejection) {
        const issue = commercial.issues.find((candidate) => candidate.reason === 'rejection_reference')
        if (issue) {
          const decision = decideClarification({ plan, issues: [issue], message: request.message, history: needs.context.history })
          if (decision.action === 'ask' || decision.action === 'explain') return controlledClarification(decision, execution.requestId)
        }
        const originalRejection = needs.context.history.filter(({ role }) => role === 'user').at(-1)
        if (!answeredRejection || !originalRejection || !readObjections([normalize(originalRejection.content)]).alternative) {
          return textResponse(objectionAcknowledgments.product)
        }
      }
      const policy = createProductEligibilityPolicy(
        options.productIndex,
        commercial.constraints,
      )
      const quote = (message: string) => contextualQuoteResponse(
        { ...request, message },
        execution.requestId,
        options.catalog,
        composer,
        needs.context.recommendationIds,
        (product) => !commercial.needsClarification &&
          !commercial.rejectedProductIds.has(product.id) &&
          policy.evaluate(product, createAgentToolExecutionContext(execution.signal)).eligible,
      )
      const informationDependencies = { catalog: options.catalog, profile, composer, faqTool, quote }

      const hasExplicitProductList = plan.presentationIntent === 'text' && objection.information.some((question) =>
        !isQuoteIntent(question) && explicitInformationalProductIds(question).length > 1)
      if (objection.action === 'inform' || objection.action === 'explain' || hasExplicitProductList) {
        const answer = await composeObjectionInformation(needs, request.message, acknowledge, informationDependencies)
        const response = textResponse(answer.message || 'Não consegui verificar essa informação com os dados disponíveis.', {
          ...(answer.clarification ? { reason: 'clarification' } : answer.incomplete ? { reason: 'unable_to_verify' } : {}),
          sourceIds: answer.sourceIds,
        })
        return answer.quoted ? completeEarly(response, 'contextual_quote') : response
      }
      const { topics, alternative } = objection.interpretation
      const selectionWithInformation = plan.presentationIntent !== 'text' && (primary !== undefined || alternative) &&
        (objection.information.length > 0 || topics.includes('discount') || topics.includes('freight'))
      const quoteResponse = selectionWithInformation ? undefined : quote(request.message)
      if (quoteResponse) {
        const response = acknowledge
          ? chatResponseSchema.parse({ ...quoteResponse, message: [acknowledge, quoteResponse.message].join('\n\n') })
          : quoteResponse
        return completeEarly(response, 'contextual_quote')
      }

      if (objection.action === 'acknowledge') {
        return textResponse(acknowledge || 'Vou manter as condições da busca. Podemos continuar quando você pedir.')
      }

      const selectionInformation = selectionWithInformation
        ? await composeObjectionInformation(needs, request.message, '', informationDependencies, 2_800)
        : undefined
      const consultation = shoppingForCheaper && priceReference && derivedMaximum !== undefined
        ? { issues: commercial.issues, canChooseWithoutPreference: true }
        : hidrasplashConsultation(plan, commercial)
      const issues: ClarificationIssue[] = plan.presentationIntent === 'text' ? [] : [...consultation.issues]
      if (resumesSearch(normalize(request.message)) && consultation.selectionQuestion?.priority === 'selection') {
        issues.push(consultation.selectionQuestion)
      }
      if (shoppingForCheaper && !priceReference) {
        issues.push({
          reason: 'cheaper_reference', priority: 'ambiguity', attribute: 'product', question: cheaperQuestion,
          limitation: 'Preciso identificar o produto para comparar os preços do catálogo.',
        })
      } else if (shoppingForCheaper && derivedMaximum === undefined) {
        issues.push({
          reason: 'cheaper_price', priority: 'restriction', attribute: 'budget',
          limitation: 'Não consigo verificar um preço menor em relação a esse produto.',
        })
      }
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
      if (pending && (selectionInformation || !hasFaqTopic(request.message))) {
        const intro = primary === 'product' && needs.context.unresolvedRejection ? '' : acknowledge
        const response = controlledClarification(pending, execution.requestId,
          [intro, selectionInformation?.message].filter(Boolean).join('\n\n'), selectionInformation?.sourceIds)
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
        groundingRequirement: selectionInformation ? 'product' : pending ? 'faq' : plan.groundingRequirement,
        signal: execution.signal,
      })
      const faqAnswer = result.grounding.faq === 'found'
        ? composer.faq(request.message, result.faqSourceIds)
        : undefined

      const mixedFaq: FaqComposition | undefined = selectionInformation ? {
        message: selectionInformation.message,
        sourceIds: selectionInformation.sourceIds,
        status: selectionInformation.incomplete ? 'partial' : 'complete',
      } : plan.groundingRequirement === 'both' ? faqAnswer : undefined
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
        (decision.flexible || uniqueAuthorized || hasSelectionDiscriminator(commercial) || shoppingForCheaper) &&
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
            [acknowledge, mixedFaqText].filter(Boolean).join('\n\n'),
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

      if (shoppingForCheaper) {
        const available = eligibleIds.length > 0
        const message = available
          ? 'Não consegui verificar uma alternativa mais barata com as condições atuais.'
          : 'Não encontrei uma alternativa mais barata nas condições informadas.'
        return textResponse([message, mixedFaqText].filter(Boolean).join('\n\n'), {
          reason: available || mixedFaq?.status === 'unable_to_verify' ? 'unable_to_verify' : 'not_found',
          sourceIds: [...mixedSourceIds],
        })
      }

      if (selectionInformation && selectedProducts.length === 0) {
        const message = 'Não encontrei uma opção que eu possa indicar nas condições informadas.'
        return textResponse([message, selectionInformation.message].filter(Boolean).join('\n\n'), {
          reason: selectionInformation.incomplete || eligibleIds.length > 0 ? 'unable_to_verify' : 'not_found',
          sourceIds: selectionInformation.sourceIds,
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
