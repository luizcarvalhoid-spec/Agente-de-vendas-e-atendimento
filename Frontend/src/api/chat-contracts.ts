import {
  isProductCategory,
  isSubcategoryForCategory,
  type ProductCategory,
  type ProductDataClassification,
  type ProductSubcategory,
} from './contracts'

export const CHAT_MAX_MESSAGE_CHARACTERS = 4_000
export const CHAT_MAX_HISTORY_MESSAGES = 10
export const CHAT_MAX_CONVERSATION_BYTES = 32_000
export const CHAT_MAX_SOURCES = 5

export interface ChatHistoryMessage {
  role: 'user' | 'assistant'
  content: string
}

export interface ChatRequest {
  message: string
  sessionId: string
  history: ChatHistoryMessage[]
}

export interface ChatProductCard {
  id: number
  slug: string
  name: string
  brand: string
  isDemo: true
  category: ProductCategory
  subcategory: ProductSubcategory
  shortDescription: string
  price: number
  originalPrice?: number
  stock: number
  imageUrl: string
  dataClassification: ProductDataClassification
}

interface ChatResponseBase {
  message: string
  sourceIds: string[]
  requestId: string
}

export interface ChatTextResponse extends ChatResponseBase {
  type: 'text'
  reason?: 'clarification' | 'not_found' | 'unable_to_verify'
}

export interface ChatRecommendationResponse extends ChatResponseBase {
  type: 'recommendation'
  productIds: [number]
  products: [ChatProductCard]
}

export interface ChatComparisonResponse extends ChatResponseBase {
  type: 'comparison'
  productIds: [number, number]
  products: [ChatProductCard, ChatProductCard]
}

export type ChatResponse =
  | ChatTextResponse
  | ChatRecommendationResponse
  | ChatComparisonResponse

const sessionIdPattern = /^[A-Za-z0-9_-]+$/
const sourceIdPattern = /^faq-\d{3}$/
const normalizedIdentifierPattern = /^[a-z0-9]+(?:-[a-z0-9]+)*$/
const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const catalogImagePattern =
  /^\/api\/catalog\/images\/(?:[a-zA-Z0-9][a-zA-Z0-9._-]*\/)*[a-zA-Z0-9][a-zA-Z0-9._-]*\.(?:jpe?g|png|webp)$/i

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function hasOnlyKeys(
  value: Record<string, unknown>,
  required: readonly string[],
  optional: readonly string[] = [],
) {
  const keys = Object.keys(value)
  return (
    required.every((key) => Object.prototype.hasOwnProperty.call(value, key)) &&
    keys.every((key) => required.includes(key) || optional.includes(key))
  )
}

function isBoundedText(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    value === value.trim() &&
    value.length >= 1 &&
    value.length <= CHAT_MAX_MESSAGE_CHARACTERS
  )
}

function isPositiveInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0
}

function isNonNegativeFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0
}

function isDataClassification(
  value: unknown,
): value is ProductDataClassification {
  return (
    isRecord(value) &&
    hasOnlyKeys(value, [
      'commercial',
      'compatibility',
      'formulation',
      'safety',
    ]) &&
    value.commercial === 'fictional-demo' &&
    value.compatibility === 'commercial-positioning' &&
    value.formulation === 'synthetic-test-data' &&
    value.safety === 'not-evaluated'
  )
}

function isChatProductCard(value: unknown): value is ChatProductCard {
  if (
    !isRecord(value) ||
    !hasOnlyKeys(
      value,
      [
        'id',
        'slug',
        'name',
        'brand',
        'isDemo',
        'category',
        'subcategory',
        'shortDescription',
        'price',
        'stock',
        'imageUrl',
        'dataClassification',
      ],
      ['originalPrice'],
    ) ||
    !isProductCategory(value.category)
  ) {
    return false
  }

  return (
    isPositiveInteger(value.id) &&
    typeof value.slug === 'string' &&
    normalizedIdentifierPattern.test(value.slug) &&
    isBoundedText(value.name) &&
    isBoundedText(value.brand) &&
    value.isDemo === true &&
    isSubcategoryForCategory(value.category, value.subcategory) &&
    isBoundedText(value.shortDescription) &&
    isNonNegativeFiniteNumber(value.price) &&
    (value.originalPrice === undefined ||
      (isNonNegativeFiniteNumber(value.originalPrice) &&
        value.originalPrice > value.price)) &&
    isPositiveInteger(value.stock) &&
    typeof value.imageUrl === 'string' &&
    catalogImagePattern.test(value.imageUrl) &&
    isDataClassification(value.dataClassification)
  )
}

function isResponseBase(value: Record<string, unknown>) {
  return (
    isBoundedText(value.message) &&
    Array.isArray(value.sourceIds) &&
    value.sourceIds.length <= CHAT_MAX_SOURCES &&
    value.sourceIds.every(
      (sourceId) =>
        typeof sourceId === 'string' && sourceIdPattern.test(sourceId),
    ) &&
    new Set(value.sourceIds).size === value.sourceIds.length &&
    typeof value.requestId === 'string' &&
    uuidPattern.test(value.requestId)
  )
}

export function isChatResponse(value: unknown): value is ChatResponse {
  if (!isRecord(value) || !isResponseBase(value)) return false

  if (value.type === 'text') {
    return (
      hasOnlyKeys(
        value,
        ['type', 'message', 'sourceIds', 'requestId'],
        ['reason'],
      ) &&
      (value.reason === undefined ||
        value.reason === 'clarification' ||
        value.reason === 'not_found' ||
        value.reason === 'unable_to_verify')
    )
  }

  if (
    value.type !== 'recommendation' &&
    value.type !== 'comparison'
  ) {
    return false
  }
  if (
    !hasOnlyKeys(value, [
      'type',
      'message',
      'sourceIds',
      'requestId',
      'productIds',
      'products',
    ]) ||
    !Array.isArray(value.productIds) ||
    !Array.isArray(value.products)
  ) {
    return false
  }

  const expectedLength = value.type === 'recommendation' ? 1 : 2
  return (
    value.productIds.length === expectedLength &&
    value.products.length === expectedLength &&
    value.productIds.every(isPositiveInteger) &&
    value.products.every(isChatProductCard) &&
    new Set(value.productIds).size === expectedLength &&
    value.productIds.every(
      (productId, index) => productId === value.products[index]?.id,
    )
  )
}

function isChatHistoryMessage(value: unknown): value is ChatHistoryMessage {
  return (
    isRecord(value) &&
    hasOnlyKeys(value, ['role', 'content']) &&
    (value.role === 'user' || value.role === 'assistant') &&
    isBoundedText(value.content)
  )
}

export function parseChatRequest(value: unknown): ChatRequest | undefined {
  if (
    !isRecord(value) ||
    !hasOnlyKeys(value, ['message', 'sessionId', 'history']) ||
    !isBoundedText(value.message) ||
    typeof value.sessionId !== 'string' ||
    value.sessionId.length < 1 ||
    value.sessionId.length > 128 ||
    !sessionIdPattern.test(value.sessionId) ||
    !Array.isArray(value.history) ||
    value.history.length > CHAT_MAX_HISTORY_MESSAGES ||
    !value.history.every(isChatHistoryMessage)
  ) {
    return undefined
  }

  for (let index = 1; index < value.history.length; index += 1) {
    if (value.history[index]?.role === value.history[index - 1]?.role) {
      return undefined
    }
  }
  if (
    value.history.length > 0 &&
    value.history.at(-1)?.role !== 'assistant'
  ) {
    return undefined
  }

  const request: ChatRequest = {
    message: value.message,
    sessionId: value.sessionId,
    history: value.history,
  }
  if (
    new TextEncoder().encode(
      JSON.stringify({ history: request.history, message: request.message }),
    ).byteLength > CHAT_MAX_CONVERSATION_BYTES
  ) {
    return undefined
  }

  return request
}
