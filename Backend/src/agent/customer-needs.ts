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
  goal?(message: string, preferences?: Preferences): CommercialGoal
}

interface CommercialGoal {
  readonly category?: string
  readonly objective?: string
}

export interface ContextListUpdate<T> {
  readonly add?: readonly T[]
  readonly replace?: readonly T[]
  readonly revoke?: readonly T[]
}

/** An omitted field preserves the active value. Revocation removes only named values. */
export function resolveContextValues<T>(
  history: readonly ContextListUpdate<T>[],
  current: ContextListUpdate<T>,
  key: (value: T) => string = String,
): Need<readonly T[]> {
  const values = new Map<string, { value: T; origin: 'declared' | 'inferred' }>()
  const apply = (update: ContextListUpdate<T>, origin: 'declared' | 'inferred') => {
    if (update.replace !== undefined) values.clear()
    for (const value of update.revoke ?? []) values.delete(key(value))
    for (const value of [...(update.replace ?? []), ...(update.add ?? [])]) {
      values.set(key(value), { value, origin })
    }
  }
  for (const update of history) apply(update, 'inferred')
  apply(current, 'declared')
  if (values.size === 0) return { origin: 'absent' }
  const entries = [...values.values()]
  return {
    origin: entries.some(({ origin }) => origin === 'declared') ? 'declared' : 'inferred',
    value: entries.map(({ value }) => value),
  }
}

export interface CustomerNeeds<Needs extends DomainNeeds> {
  readonly intent: Need<'recommendation' | 'comparison' | 'informational' | 'conversation'>
  readonly plan: ChatGroundingPlan
  readonly budget: Need<number>
  readonly exclusions: {
    readonly declared: readonly number[]
    readonly inferred: readonly number[]
  }
  readonly context: {
    readonly interrupted: boolean
    readonly changedGoal: boolean
    readonly unresolvedRejection: boolean
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

const budgetRevocation = /^(?:agora )?(?:sem limite de orcamento|nao tenho mais limite de orcamento|nao precisa mais respeitar (?:o )?limite de orcamento)[.!]?$/

function extractBudget(value: string) {
  const normalized = normalize(value)
  const revoked = budgetRevocation.test(normalized)
  const limitExpression = /\b(?:ate|no maximo|orcamento(?: de)?|limite(?: agora)?(?: e| de)?)\s+(?:r\$\s*)?(-?\d+(?:[.,]\d+)*)/g
  const values = new Set<number>()
  for (const [, amount] of normalized.matchAll(limitExpression)) {
    if (!amount || !/^\d{1,6}(?:[.,]\d{1,2})?$/.test(amount)) {
      return { value: undefined, ambiguous: true, revoked: false }
    }
    values.add(Number(amount.replace(',', '.')))
  }
  const [amount] = values
  return {
    value: values.size === 1 ? amount : undefined,
    ambiguous: values.size > 1,
    revoked,
  }
}

function latestHistoricalBudget(request: CustomerNeedsRequest): Need<number> {
  let budget: Need<number> = { origin: 'absent' }
  for (const message of historicalUserMessages(request)) {
    const next = extractBudget(message)
    if (next.revoked) budget = { origin: 'absent' }
    if (next.value !== undefined) budget = { origin: 'inferred', value: next.value }
    if (next.ambiguous) {
      budget = {
        origin: 'ambiguous',
        conservativeValue: budget.origin === 'ambiguous' ? budget.conservativeValue : needValue(budget),
      }
    }
  }
  return budget
}

export function historicalUserMessages(request: CustomerNeedsRequest) {
  return request.history
    .filter((message) => message.role === 'user')
    .map((message) => message.content)
}

function endsSearch(message: string) {
  return /^(?:deixa pra la|deixe pra la|esquece|encerrar|encerra|cancelar essa busca|cancela essa busca|nao quero mais)(?:\s*(?:[.!]+|por enquanto|obrigad[oa]))*$/.test(
    normalize(message),
  )
}

function changesTopic(message: string) {
  return /\b(?:mudando de assunto|outro assunto|vamos falar de|agora sobre)\b/.test(normalize(message))
}

function isInformational(message: string, plan: ChatGroundingPlan) {
  if (plan.presentationIntent !== 'text') return false
  const normalized = normalize(message)
  return (
    /^(?:qual|quais|quanto|como|o que|(?:ainda )?tem estoque|esta disponivel)\b/.test(normalized) ||
    (normalized.includes('?') && /^pode (?:ter|conter)\b/.test(normalized)) ||
    (normalized.endsWith('?') && budgetRevocation.test(normalized.slice(0, -1).trim())) ||
    (hasFaqTopic(message) && !/^(?:prefiro|ate|no maximo|na verdade|meu limite|orcamento)\b/.test(normalized))
  )
}

function goalChanged(goal: CommercialGoal, next: CommercialGoal) {
  return (
    (goal.category !== undefined && next.category !== undefined && goal.category !== next.category) ||
    (goal.objective !== undefined && next.objective !== undefined && goal.objective !== next.objective)
  )
}

function resolveActiveHistory<Preferences extends BudgetPreference, Needs extends DomainNeeds>(
  request: CustomerNeedsRequest<Preferences>,
  domain: CustomerNeedsDomain<Preferences, Needs>,
  currentPlan: ChatGroundingPlan,
) {
  let goal: CommercialGoal = {}
  let history: CustomerNeedsRequest<Preferences>['history'][number][] = []
  for (let index = 0; index < request.history.length; index += 1) {
    const entry = request.history[index]
    if (entry?.role !== 'user') continue
    if (endsSearch(entry.content) || changesTopic(entry.content)) {
      history = []
      goal = {}
      if (endsSearch(entry.content)) continue
    }
    const plan = planChatGrounding(entry.content, domain.vocabulary)
    if (isInformational(entry.content, plan)) continue
    const next = domain.goal?.(entry.content) ?? {}
    if (goalChanged(goal, next)) {
      history = []
      goal = {}
    }
    goal = { category: next.category ?? goal.category, objective: next.objective ?? goal.objective }
    history.push(entry)
    // Assistant content can only suggest a referent for a user's rejection.
    const reply = request.history[index + 1]
    if (reply?.role === 'assistant') history.push(reply)
  }
  const next = isInformational(request.message, currentPlan)
    ? {}
    : domain.goal?.(request.message, request.preferences) ?? {}
  const changedGoal = changesTopic(request.message) || goalChanged(goal, next)
  return { history: changedGoal ? [] : history, changedGoal }
}

function isCommercialContinuation(message: string, isPreferenceFollowUp: (message: string) => boolean) {
  const budget = extractBudget(message)
  return (
    budget.value !== undefined ||
    budget.ambiguous ||
    budget.revoked ||
    isPreferenceFollowUp(message) ||
    asksForAlternative(message) ||
    explicitRejectedProductIds(message).size > 0
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
    const plan = planChatGrounding(content, vocabulary)
    if (isInformational(content, plan) || plan.groundingRequirement === 'not_required') continue
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
    currentPlan.groundingRequirement === 'not_required' ||
    isInformational(request.message, currentPlan)
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

function asksForAlternative(message: string) {
  return rejectsReference(message) || /\b(?:outra opcao|outro produto|produto diferente|algo diferente|nao gostei|prefiro outra)\b/.test(normalize(message))
}

function rejectsReference(message: string) {
  return /\b(?:nao quero(?: mais)? (?:esse|este|essa|esta)|nao gostei (?:desse|deste|dessa|desta))(?:\s+(?:produto|opcao|item|recomendacao)\b|[.!?,]|$)/.test(normalize(message))
}

function resolveRejectedProducts(
  request: CustomerNeedsRequest,
  history: CustomerNeedsRequest['history'],
  changedGoal: boolean,
  resolveReference?: (assistantMessage: string) => number | undefined,
) {
  const inferred = new Set<number>()
  let unresolvedRejection = false
  for (let index = 0; index < history.length; index += 1) {
    const entry = history[index]
    if (entry?.role !== 'user') continue
    const ids = explicitRejectedProductIds(entry.content)
    for (const id of ids) inferred.add(id)
    if (ids.size > 0 || !rejectsReference(entry.content)) continue
    const previous = history[index - 1]
    const id = previous?.role === 'assistant' ? resolveReference?.(previous.content) : undefined
    if (id === undefined) unresolvedRejection = true
    else inferred.add(id)
  }
  const declared = explicitRejectedProductIds(request.message)
  if (!changedGoal && asksForAlternative(request.message)) {
    const ids = request.recommendationContext?.productIds ?? []
    const previous = history.at(-1)
    const hinted = ids.length === 0 && previous?.role === 'assistant'
      ? resolveReference?.(previous.content)
      : undefined
    for (const id of ids) inferred.add(id)
    if (hinted !== undefined) inferred.add(hinted)
    if (declared.size === 0 && rejectsReference(request.message) && ids.length !== 1 && hinted === undefined) {
      unresolvedRejection = true
    }
  }
  return {
    declared: [...declared],
    inferred: [...inferred].filter((id) => !declared.has(id)),
    unresolvedRejection,
  }
}

export function interpretCustomerNeeds<Preferences extends BudgetPreference, Needs extends DomainNeeds>(
  request: CustomerNeedsRequest<Preferences>,
  domain: CustomerNeedsDomain<Preferences, Needs>,
  resolveReference?: (assistantMessage: string) => number | undefined,
): CustomerNeeds<Needs> {
  const messagePlan = planChatGrounding(request.message, domain.vocabulary)
  const currentPlan = messagePlan.groundingRequirement === 'faq' ||
    (request.cart.length === 0 && request.preferences === undefined)
    ? messagePlan
    : planChatGrounding(request.message, domain.vocabulary, true)
  const { history, changedGoal } = resolveActiveHistory(request, domain, currentPlan)
  const scopedRequest = { ...request, history }
  const interrupted = endsSearch(request.message)
  const plan: ChatGroundingPlan = interrupted
    ? { presentationIntent: 'text', groundingRequirement: 'not_required' }
    : preserveHistoricalRecommendationIntent(
        scopedRequest, currentPlan, domain.vocabulary, (message) => domain.isPreferenceFollowUp(message),
      )
  const currentBudget = extractBudget(request.message)
  const structuredBudget = request.preferences?.maxPrice
  const historicalBudget = latestHistoricalBudget(scopedRequest)
  const conflicts = structuredBudget !== undefined &&
    (currentBudget.revoked || (currentBudget.value !== undefined && structuredBudget !== currentBudget.value))
  const budget: Need<number> = currentBudget.ambiguous || conflicts
    ? {
        origin: 'ambiguous',
        conservativeValue: conflicts
          ? Math.min(structuredBudget, currentBudget.value ?? structuredBudget)
          : structuredBudget ?? (historicalBudget.origin === 'ambiguous'
            ? historicalBudget.conservativeValue
            : needValue(historicalBudget)),
      }
    : structuredBudget !== undefined || currentBudget.value !== undefined
      ? needFrom(structuredBudget ?? currentBudget.value)
      : currentBudget.revoked ? { origin: 'absent' } : historicalBudget
  const { declared, inferred, unresolvedRejection } =
    resolveRejectedProducts(request, history, changedGoal, resolveReference)

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
    exclusions: { declared, inferred },
    context: { interrupted, changedGoal, unresolvedRejection },
    domain: domain.interpret({
      ...scopedRequest,
      message: currentBudget.revoked ? '' : request.message,
      history: history.filter(({ role, content }) =>
        role !== 'user' || !budgetRevocation.test(normalize(content)),
      ),
    }),
  }
}
