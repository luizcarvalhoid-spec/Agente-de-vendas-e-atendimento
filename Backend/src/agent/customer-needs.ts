import {
  hasFaqTopic,
  planChatGrounding,
  type ChatGroundingPlan,
  type ProductIntentVocabulary,
} from './chat-grounding-planner.js'

export type Need<T> =
  | { readonly origin: 'declared' | 'inferred'; readonly value: T }
  | { readonly origin: 'absent' }
  | { readonly origin: 'ambiguous'; readonly conservativeValue?: T }

export function needFrom<T>(current: T | undefined, historical?: T): Need<T> {
  if (current !== undefined) return { origin: 'declared', value: current }
  if (historical !== undefined) return { origin: 'inferred', value: historical }
  return { origin: 'absent' }
}

export function needValue<T>(need: Need<T>): T | undefined {
  return 'value' in need ? need.value : undefined
}

interface BudgetPreference {
  readonly maxPrice?: number
}

export interface CustomerNeedsRequest<Preferences extends BudgetPreference = BudgetPreference> {
  readonly message: string
  readonly history: readonly { role: 'user' | 'assistant'; content: string }[]
  readonly preferences?: Preferences
  readonly cart: readonly unknown[]
  readonly recommendationContext?: { readonly productIds: readonly number[] }
}

export interface DomainNeeds {
  readonly category: Need<string>
  readonly objective: Need<string>
  readonly preferences: object
  readonly restrictions: object
}

export interface CustomerNeedsDomain<Preferences extends BudgetPreference, Needs extends DomainNeeds> {
  readonly vocabulary: ProductIntentVocabulary
  interpret(request: CustomerNeedsRequest<Preferences>): Needs
  isPreferenceFollowUp(message: string): boolean
}

export interface CustomerNeeds<Needs extends DomainNeeds> {
  readonly intent: Need<'recommendation' | 'comparison' | 'informational' | 'conversation'>
  readonly plan: ChatGroundingPlan
  readonly budget: Need<number>
  readonly exclusions: {
    readonly declared: readonly number[]
    readonly inferred: readonly number[]
  }
  readonly domain: Needs
}

export function normalize(value: string) {
  return value
    .normalize('NFKD')
    .replace(/\p{Diacritic}/gu, '')
    .toLocaleLowerCase('pt-BR')
    .replace(/\s+/g, ' ')
    .trim()
}

function extractBudget(value: string) {
  const normalized = normalize(value)
  const limitExpression = /\b(?:ate|no maximo|orcamento(?: de)?|limite(?: agora)?(?: e| de)?)\s+(?:r\$\s*)?(-?\d+(?:[.,]\d+)*)/g
  const values = new Set<number>()
  for (const [, amount] of normalized.matchAll(limitExpression)) {
    if (!amount || !/^\d{1,6}(?:[.,]\d{1,2})?$/.test(amount)) {
      return { value: undefined, ambiguous: true }
    }
    values.add(Number(amount.replace(',', '.')))
  }
  const [amount] = values
  return {
    value: values.size === 1 ? amount : undefined,
    ambiguous: values.size > 1,
  }
}

function latestHistoricalBudget(request: CustomerNeedsRequest) {
  for (let index = request.history.length - 1; index >= 0; index -= 1) {
    const message = request.history[index]
    if (message?.role !== 'user') continue
    const budget = extractBudget(message.content)
    if (budget.value !== undefined) return budget.value
  }
  return undefined
}

export function historicalUserMessages(request: CustomerNeedsRequest) {
  return request.history
    .filter((message) => message.role === 'user')
    .map((message) => message.content)
}

function interruptsCommercialContinuity(message: string) {
  const normalized = normalize(message)
  return /\b(?:mudando de assunto|outro assunto|vamos falar de|agora sobre|nao quero mais|deixa pra la|deixe pra la|esquece|encerrar|encerra|cancelar essa busca|cancela essa busca)\b/.test(
    normalized,
  )
}

function isCommercialContinuation(message: string, isPreferenceFollowUp: (message: string) => boolean) {
  if (interruptsCommercialContinuity(message)) return false
  const budget = extractBudget(message)
  return (
    budget.value !== undefined ||
    budget.ambiguous ||
    isPreferenceFollowUp(message)
  )
}

function hasHistoricalRecommendationIntent(
  request: CustomerNeedsRequest,
  vocabulary: ProductIntentVocabulary,
  isPreferenceFollowUp: (message: string) => boolean,
) {
  const previousUsers = request.history.filter(
    (message) => message.role === 'user',
  )
  for (let index = previousUsers.length - 1; index >= 0; index -= 1) {
    const content = previousUsers[index]?.content ?? ''
    if (interruptsCommercialContinuity(content)) return false
    const plan = planChatGrounding(content, vocabulary)
    if (plan.presentationIntent === 'recommendation') return true
    if (!isCommercialContinuation(content, isPreferenceFollowUp)) return false
  }
  return false
}

function preserveHistoricalRecommendationIntent(
  request: CustomerNeedsRequest,
  currentPlan: ChatGroundingPlan,
  vocabulary: ProductIntentVocabulary,
  isPreferenceFollowUp: (message: string) => boolean,
): ChatGroundingPlan {
  if (
    currentPlan.presentationIntent !== 'text' ||
    currentPlan.groundingRequirement === 'not_required'
  ) {
    return currentPlan
  }
  if (!hasHistoricalRecommendationIntent(request, vocabulary, isPreferenceFollowUp)) {
    return currentPlan
  }
  if (currentPlan.groundingRequirement === 'product') {
    return { ...currentPlan, presentationIntent: 'recommendation' }
  }
  if (!isCommercialContinuation(request.message, isPreferenceFollowUp)) return currentPlan
  return {
    groundingRequirement: hasFaqTopic(request.message) ? 'both' : 'product',
    presentationIntent: 'recommendation',
  }
}

export function explicitRejectedProductIds(message: string) {
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

export function interpretCustomerNeeds<Preferences extends BudgetPreference, Needs extends DomainNeeds>(
  request: CustomerNeedsRequest<Preferences>,
  domain: CustomerNeedsDomain<Preferences, Needs>,
): CustomerNeeds<Needs> {
  const currentPlan = planChatGrounding(
    request.message, domain.vocabulary,
    request.cart.length > 0 || request.preferences !== undefined,
  )
  const plan = preserveHistoricalRecommendationIntent(
    request, currentPlan, domain.vocabulary, (message) => domain.isPreferenceFollowUp(message),
  )
  const currentBudget = extractBudget(request.message)
  const structuredBudget = request.preferences?.maxPrice
  const historicalBudget = latestHistoricalBudget(request)
  const conflicts = structuredBudget !== undefined &&
    currentBudget.value !== undefined && structuredBudget !== currentBudget.value
  const budget: Need<number> = currentBudget.ambiguous || conflicts
    ? {
        origin: 'ambiguous',
        conservativeValue: conflicts
          ? Math.min(structuredBudget, currentBudget.value ?? structuredBudget)
          : structuredBudget ?? historicalBudget,
      }
    : needFrom(structuredBudget ?? currentBudget.value, historicalBudget)

  const declared = explicitRejectedProductIds(request.message)
  const inferred = /\b(?:outra opcao|outro produto|produto diferente|algo diferente|nao gostei|prefiro outra)\b/.test(
    normalize(request.message),
  ) ? (request.recommendationContext?.productIds ?? []).filter((id) => !declared.has(id)) : []

  const intent = plan.presentationIntent === 'text'
    ? {
        origin: 'inferred' as const,
        value: plan.groundingRequirement === 'not_required' ? 'conversation' as const : 'informational' as const,
      }
    : {
        origin: currentPlan.presentationIntent === 'text' ? 'inferred' as const : 'declared' as const,
        value: plan.presentationIntent,
      }

  return {
    intent,
    plan,
    budget,
    exclusions: { declared: [...declared], inferred },
    domain: domain.interpret(request),
  }
}
