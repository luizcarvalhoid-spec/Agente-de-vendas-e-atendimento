import {
  hasFaqTopic,
  planChatGrounding,
  type ChatGroundingPlan,
  type ProductIntentVocabulary,
} from './chat-grounding-planner.js'
import {
  asksForAlternative, asksForCheaper, decideObjection, isObjectionClause, readObjections, resumesSearch,
  type Objections,
} from './objection-strategy.js'

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

export function resolveContextNeed<T>(previous: Need<T> | undefined, current: Need<T> | undefined): Need<T> {
  return current && current.origin !== 'absent' ? current : previous ?? { origin: 'absent' }
}

export function historicalNeed<T>(need: Need<T>): Need<T> {
  return 'value' in need ? { origin: 'inferred', value: need.value } : need
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
  interpret(request: CustomerNeedsRequest<Preferences>, comparisonText?: string): Needs
  isPreferenceFollowUp(message: string): boolean
  goal?(message: string, preferences?: Preferences, reply?: string): CommercialGoal
}

interface CommercialGoal {
  readonly category?: Need<string>
  readonly objective?: Need<string>
  readonly explicitChange?: boolean
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
  readonly objection: {
    readonly interpretation: Objections
    readonly action: ReturnType<typeof decideObjection>
    readonly information: string
  }
  readonly exclusions: {
    readonly declared: readonly number[]
    readonly inferred: readonly number[]
  }
  readonly context: {
    readonly interrupted: boolean
    readonly paused: boolean
    readonly changedGoal: boolean
    readonly unresolvedRejection: boolean
    readonly recommendationIds: readonly number[]
    readonly history: CustomerNeedsRequest['history']
    readonly budgetAnswerConfirmed: boolean
    readonly budgetEvidenceMissing: boolean
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

function updateHistoricalBudget(budget: Need<number>, next: ReturnType<typeof extractBudget>): Need<number> {
  if (next.revoked) return { origin: 'absent' }
  if (next.value !== undefined) return { origin: 'inferred', value: next.value }
  if (next.ambiguous) return {
    origin: 'ambiguous',
    conservativeValue: budget.origin === 'ambiguous' ? budget.conservativeValue : needValue(budget),
  }
  return budget
}

export const budgetQuestion = 'Qual é o valor máximo que você quer gastar no produto?'

export function matchesClarificationQuestion(reply: string, question: string) {
  return reply === question || reply.endsWith(`\n\n${question}`)
}

export function shortBudgetAnswer(message: string) {
  const amount = normalize(message).match(/^(?:r\$\s*)?(\d{1,6}(?:[.,]\d{1,2})?)(?:\s+reais)?[.!]?$/)?.[1]
  return amount === undefined ? undefined : Number(amount.replace(',', '.'))
}

function hasBudgetQuestion(
  budget: Need<number>,
  reply: CustomerNeedsRequest['history'][number] | undefined,
  structured?: number,
) {
  const previous = needValue(budget)
  const conflict = budget.origin === 'ambiguous' ||
    (structured !== undefined && previous !== undefined && previous !== structured)
  return conflict && reply?.role === 'assistant' &&
    matchesClarificationQuestion(reply.content, budgetQuestion)
}

function budgetAnswerStatement(message: string, matchesPendingBudget: boolean) {
  const amount = matchesPendingBudget ? shortBudgetAnswer(message) : undefined
  return amount === undefined ? message : `Até R$ ${amount}.`
}

function isBudgetAnswerAttempt(message: string) {
  return /^(?:r\$\s*)?\d+(?:[.,]\d+)?(?:\s+reais)?(?:\s+(?:ou|e)\s+(?:r\$\s*)?\d+(?:[.,]\d+)?(?:\s+reais)?)?[.!]?$/.test(normalize(message))
}

export function historicalUserMessages(request: CustomerNeedsRequest) {
  return request.history
    .filter((message) => message.role === 'user')
    .map((message) => message.content)
}

function endsSearch(message: string) {
  return readObjections(messageParts(message).map(normalize)).primary === 'stop'
}

export function clarificationReply(message: string) {
  const text = normalize(message)
  if (endsSearch(text)) return 'ended'
  if (/^(?:nao quero|prefiro nao) responder[.!]?$/.test(text)) return 'refused'
  if (/^nao sei(?: dizer| responder)?[.!]?$/.test(text)) return 'unknown'
  if (/^(?:tanto faz|nao tenho (?:uma )?preferencia)[.!]?$/.test(text)) return 'indifferent'
  if (/^(?:voce (?:pode escolher|decide)|pode escolher|fica a seu criterio)[.!]?$/.test(text)) return 'delegated'
  return undefined
}

export const rejectedProductQuestion = 'Qual produto você quer deixar de fora? Informe o ID do produto.'

function changesTopic(message: string) {
  return /^(?:mudando de assunto|outro assunto|vamos falar de|agora sobre)\b/.test(normalize(message))
}

export function asksForProductSelection(normalized: string) {
  return /\b(?:(?:me|voce|pode|poderia) (?:indic[ae][rs]?|recomend[ae][rs]?)|(?:pode|poderia) me ajudar a escolher)\b/.test(normalized)
}

function isInformational(message: string, plan: ChatGroundingPlan) {
  const normalized = normalize(message)
  if (/^(?:sera que|e se|se eu|suponha|tenho duvida se|gostaria de saber|(?:(?:so|apenas) )?(?:quero|queria) (?:saber|entender|confirmar))\b/.test(normalized)) {
    return true
  }
  const requestsAlternative = /^(?:me mostre|mostre|quero|pode (?:me )?mostrar)\b/.test(normalized) &&
    asksForAlternative(normalized)
  const requestsSelection = plan.presentationIntent === 'recommendation' &&
    (/^(?:quero|procuro|preciso de|busco)\b/.test(normalized) ||
      asksForProductSelection(normalized))
  if (requestsSelection || requestsAlternative) return false
  return (
    normalized.endsWith('?') ||
    /^(?:e )?(?:qual|quais|quanto|como|o que|por que|(?:ainda )?tem estoque|esta disponivel)\b/.test(normalized) ||
    (plan.presentationIntent === 'text' && hasFaqTopic(message) &&
      !/^(?:prefiro|ate|no maximo|na verdade|meu limite|orcamento)\b/.test(normalized))
  )
}

function splitComparisonStatement(part: string) {
  const text = normalize(part)
  const hypothetical = /(?:,?\s+)(?:e\s+)?(?:se|caso|sera que|supondo|suponha|(?:com\s+(?:um\s+)?)?orcamento hipotetico)\b/
  const direct = text.split(hypothetical, 1)[0]?.trim() ?? ''
  const updateStart = /(?:[,:]\s*(?:e\s+)?|\s+(?:(?:e|com)\s+)?)(?=(?:sem|ate|no maximo|(?:meu\s+)?(?:orcamento|limite)|na verdade|(?:agora\s+)?(?:quero|prefiro|procuro)|nao (?:quero|pode|deve|precisa|recomende|gostei|considere|use|tenho mais limite)|evitar|incompativel com|tem que|precisa|deve|obrigatoriamente|(?:(?:agora|ja)\s+)?pode (?:ter|conter|ser))\b)/g
  for (const marker of direct.matchAll(updateStart)) {
    const topic = direct.slice(0, marker.index)
    const statement = direct.slice(marker.index + marker[0].length)
    // In a contrast such as “compare com e sem X”, X describes the options.
    if (statement.startsWith('sem ') && !marker[0].includes(',') &&
      (/\bcom(?:\s+e)?$/.test(topic) || /\b(?:com|e|versus)\s+(?:o|a|um|uma|outro|outra)\b/.test(statement))) {
      continue
    }
    return { topic, statement }
  }
  return { topic: direct, statement: '' }
}

function messageParts(message: string) {
  const parts = message.split(/(?<=[.!?])\s+|(?<=;)\s*|,\s*(?=(?:e\s+)?(?:qual|quais|quanto|como|ser[aá] que|se eu)\b)|\s+e\s+(?=(?:queria|quero) saber\b)/i)
  return parts.flatMap((part) => isObjectionClause(normalize(part))
    ? part.split(/,\s*(?:(?:e|mas)\s+)?(?=(?:na verdade|at[eé]|no m[aá]ximo|(?:meu\s+)?limite|(?:meu\s+)?or[cç]amento|sem|n[aã]o pode|tem que|precisa)\b)/i)
    : part.split(/,\s*(?=(?:me )?mostre\b)/i))
    .map((part) => part.trim()).filter(Boolean)
}

function contextStatement(message: string, vocabulary: ProductIntentVocabulary) {
  const statements: string[] = []
  const comparisonTopics: string[] = []
  const information: string[] = []
  const parts = messageParts(message)
  const objections = readObjections(parts.map(normalize))
  for (const part of parts) {
    const normalized = normalize(part)
    const plan = planChatGrounding(part, vocabulary)
    const startsWithSelection = /^(?:quero|procuro|preciso de|busco|prefiro|meu limite|na verdade)\b/.test(normalized) ||
      asksForProductSelection(normalized)
    if (isObjectionClause(normalized) && !startsWithSelection &&
      !rejectsReference(part) && explicitRejectedProductIds(part).size === 0) continue
    if (isInformational(part, plan) && !asksForCheaper(normalized)) {
      information.push(part)
      continue
    }
    if (plan.presentationIntent === 'comparison') {
      const { topic, statement } = splitComparisonStatement(part)
      // The topic helps this turn's comparison. Only customer declarations enter the active history.
      comparisonTopics.push(topic)
      if (statement) statements.push(statement)
    } else {
      statements.push(part)
    }
  }
  const selects = comparisonTopics.length > 0 || objections.alternative || parts.some((part) => {
    const normalized = normalize(part)
    return resumesSearch(normalized) || (statements.includes(part) &&
      (asksForProductSelection(normalized) ||
        (/^(?:quero|procuro|preciso de|busco)\b/.test(normalized) &&
          planChatGrounding(part, vocabulary).presentationIntent === 'recommendation')))
  })
  return { statement: statements.join(' ').trim(), comparisonText: comparisonTopics.join(' ').trim(),
    information: information.join(' '), objections, selects }
}

function goalChanged(goal: CommercialGoal, next: CommercialGoal) {
  const changesAttribute = (previous?: Need<string>, current?: Need<string>) => {
    if (!previous || !current || !('value' in current)) return false
    if (previous.origin === 'ambiguous') return next.explicitChange === true
    return 'value' in previous && previous.value !== current.value
  }
  return changesAttribute(goal.category, next.category) || changesAttribute(goal.objective, next.objective)
}

function resolveActiveHistory<Preferences extends BudgetPreference, Needs extends DomainNeeds>(
  request: CustomerNeedsRequest<Preferences>,
  domain: CustomerNeedsDomain<Preferences, Needs>,
  statement: string,
) {
  let goal: CommercialGoal = {}
  let history: CustomerNeedsRequest<Preferences>['history'][number][] = []
  let reset = false
  let budget: Need<number> = { origin: 'absent' }
  let unconfirmedBudget = false
  let paused = false
  for (let index = 0; index < request.history.length; index += 1) {
    const entry = request.history[index]
    if (entry?.role !== 'user') continue
    if (endsSearch(entry.content) || changesTopic(entry.content)) {
      history = []
      goal = {}
      budget = { origin: 'absent' }
      unconfirmedBudget = false
      paused = false
      reset = true
      if (endsSearch(entry.content)) continue
    }
    const { statement, objections, selects } = contextStatement(entry.content, domain.vocabulary)
    if (objections.primary === 'pause') paused = true
    else if (selects) paused = false
    const pendingBudget = hasBudgetQuestion(budget, request.history[index - 1])
    const content = budgetAnswerStatement(statement, pendingBudget)
    const reply = request.history[index + 1]
    if ((pendingBudget || unconfirmedBudget) && content === statement && isBudgetAnswerAttempt(statement)) {
      if (reply?.role === 'assistant' && matchesClarificationQuestion(reply.content, budgetQuestion)) history.push(reply)
      continue
    }
    if (!content) {
      // A comparison does not update the goal. Its reply still makes the
      // previous referent ambiguous if the next turn asks for an alternative.
      if (reply?.role === 'assistant' && planChatGrounding(entry.content, domain.vocabulary).presentationIntent === 'comparison') {
        history.push(reply)
      }
      continue
    }
    const next = domain.goal?.(content, undefined, reply?.role === 'assistant' ? reply.content : undefined) ?? {}
    if (goalChanged(goal, next)) {
      history = []
      goal = {}
      budget = { origin: 'absent' }
      unconfirmedBudget = false
      paused = false
      reset = true
    }
    goal = {
      category: resolveContextNeed(goal.category, next.category),
      objective: resolveContextNeed(goal.objective, next.objective),
    }
    const declaration = extractBudget(content)
    budget = updateHistoricalBudget(budget, declaration)
    // A question paired with a real ceiling can signal missing structured evidence.
    // The question supplies neither a historical value nor enough evidence to bind a short answer.
    if (declaration.value !== undefined || declaration.revoked) {
      unconfirmedBudget = declaration.value !== undefined && reply?.role === 'assistant' &&
        matchesClarificationQuestion(reply.content, budgetQuestion)
    }
    history.push({ ...entry, content })
    // Assistant content can only suggest a referent for a user's rejection.
    if (reply?.role === 'assistant') history.push(reply)
  }
  const next = domain.goal?.(statement, request.preferences) ?? {}
  const changedGoal = changesTopic(request.message) || goalChanged(goal, next)
  return {
    history: changedGoal ? [] : history,
    budget: changedGoal ? { origin: 'absent' } as const : budget,
    unconfirmedBudget: !changedGoal && unconfirmedBudget,
    changedGoal,
    paused: !changedGoal && paused,
    reset,
  }
}

function isCommercialContinuation(message: string, isPreferenceFollowUp: (message: string) => boolean) {
  const budget = extractBudget(message)
  const normalized = normalize(message)
  return (
    budget.value !== undefined ||
    budget.ambiguous ||
    budget.revoked ||
    clarificationReply(message) !== undefined ||
    isPreferenceFollowUp(message) ||
    asksForAlternative(normalized) ||
    rejectsReference(message) ||
    resumesSearch(normalized) ||
    shortProductAnswer(message) !== undefined ||
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
    if (plan.groundingRequirement === 'not_required') continue
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
  faqTopic: boolean,
  answersPendingBudget: boolean,
): ChatGroundingPlan {
  if (
    currentPlan.presentationIntent !== 'text' ||
    currentPlan.groundingRequirement === 'not_required' ||
    !request.message
  ) {
    return currentPlan
  }
  if (!hasHistoricalRecommendationIntent(request, vocabulary, isPreferenceFollowUp)) {
    return currentPlan
  }
  if (currentPlan.groundingRequirement === 'product') {
    return { ...currentPlan, presentationIntent: 'recommendation' }
  }
  if (!answersPendingBudget && !isCommercialContinuation(request.message, isPreferenceFollowUp)) return currentPlan
  return {
    groundingRequirement: faqTopic ? 'both' : 'product',
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

function discardsRecommendation(message: string) {
  return rejectsReference(message) || messageParts(message).some((part) => {
    const { alternative, cheaper } = readObjections([normalize(part)])
    return alternative && !cheaper
  })
}

function rejectsReference(message: string) {
  return /\b(?:nao quero(?: mais)? (?:esse|este|essa|esta)|nao gostei (?:desse|deste|dessa|desta))(?:\s+(?:produto|opcao|item|recomendacao)\b|[.!?,]|$)/.test(normalize(message))
}

export function shortProductAnswer(message: string) {
  const id = normalize(message).match(/^(?:(?:e )?o )?produto (?:id )?(\d{1,6})[.!]?$/)?.[1]
  return id === undefined ? undefined : Number(id)
}

function answeredRejectionQuestion(previous: CustomerNeedsRequest['history'][number] | undefined) {
  return previous?.role === 'assistant' &&
    matchesClarificationQuestion(previous.content, rejectedProductQuestion)
}

function resolveRejectedProducts(
  statement: string,
  history: CustomerNeedsRequest['history'],
  changedGoal: boolean,
  recommendationIds: readonly number[],
  resolveReference?: (assistantMessage: string) => number | undefined,
) {
  const inferred = new Set<number>()
  let unresolvedRejection = false
  let lastRejectionEstablished = false
  for (let index = 0; index < history.length; index += 1) {
    const entry = history[index]
    if (entry?.role !== 'user') continue
    const ids = explicitRejectedProductIds(entry.content)
    const previous = history[index - 1]
    const followsKnownRejection = lastRejectionEstablished
    if (unresolvedRejection && answeredRejectionQuestion(previous)) {
      const answer = shortProductAnswer(entry.content)
      if (answer !== undefined) ids.add(answer)
      if (ids.size === 1) unresolvedRejection = false
    }
    for (const id of ids) inferred.add(id)
    lastRejectionEstablished = ids.size > 0
    if (ids.size > 0 || !discardsRecommendation(entry.content)) continue
    const id = previous?.role === 'assistant' ? resolveReference?.(previous.content) : undefined
    if (id !== undefined) {
      inferred.add(id)
      lastRejectionEstablished = rejectsReference(entry.content) && !asksForAlternative(normalize(entry.content))
    } else if (!followsKnownRejection || rejectsReference(entry.content)) {
      unresolvedRejection = true
    }
  }
  const declared = explicitRejectedProductIds(statement)
  const previous = history.at(-1)
  if (unresolvedRejection && answeredRejectionQuestion(previous)) {
    const answer = shortProductAnswer(statement)
    if (answer !== undefined) declared.add(answer)
    if (declared.size === 1) unresolvedRejection = false
  }
  if (!changedGoal && discardsRecommendation(statement)) {
    const id = recommendationIds.length === 1
      ? recommendationIds[0]
      : recommendationIds.length === 0 && previous?.role === 'assistant'
        ? resolveReference?.(previous.content)
        : undefined
    if (id !== undefined) inferred.add(id)
    else if (declared.size === 0 &&
      (!lastRejectionEstablished || recommendationIds.length > 0 || rejectsReference(statement))) unresolvedRejection = true
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
  const rawPlan = messagePlan.groundingRequirement === 'faq' ||
    (request.cart.length === 0 && request.preferences === undefined)
    ? messagePlan
    : planChatGrounding(request.message, domain.vocabulary, true)
  const { statement: declaredStatement, comparisonText, information, objections, selects } =
    contextStatement(request.message, domain.vocabulary)
  const { history, budget: historicalBudget, unconfirmedBudget, changedGoal, reset, paused: wasPaused } =
    resolveActiveHistory(request, domain, declaredStatement)
  const interrupted = objections.primary === 'stop'
  const paused = objections.primary === 'pause' || (wasPaused && !selects)
  const objectionAction = decideObjection(objections, { paused, selects, information: information !== '' })
  const pendingBudget = hasBudgetQuestion(historicalBudget, request.history.at(-1), request.preferences?.maxPrice)
  const statement = budgetAnswerStatement(declaredStatement, pendingBudget)
  const asksForRationale = /^por que\b.*\b(?:sua|essa|esta)\b.*\brecomendacao\b/.test(normalize(request.message))
  const currentPlan: ChatGroundingPlan = !statement && !asksForRationale && rawPlan.presentationIntent === 'recommendation'
    ? { ...rawPlan, presentationIntent: 'text' }
    : rawPlan
  const scopedRequest = { ...request, message: statement, history }
  const suppliedIds = request.recommendationContext?.productIds ?? []
  const staleReference = reset && suppliedIds.length === 1 &&
    !history.some(({ role, content }) => role === 'assistant' && resolveReference?.(content) === suppliedIds[0])
  const recommendationIds = changedGoal || interrupted || staleReference ? [] : suppliedIds
  const needsBudgetClarification = (pendingBudget || unconfirmedBudget) && isBudgetAnswerAttempt(statement)
  const plan: ChatGroundingPlan = objectionAction === 'stop' || objectionAction === 'pause' || objectionAction === 'acknowledge'
    ? { presentationIntent: 'text', groundingRequirement: 'not_required' }
    : objectionAction === 'inform' || objectionAction === 'explain'
      ? {
          presentationIntent: 'text',
          groundingRequirement: objections.primary === 'freight' || objections.primary === 'discount'
            ? 'faq' : information ? planChatGrounding(information, domain.vocabulary).groundingRequirement : 'not_required',
        }
    : objectionAction === 'alternative' && objections.cheaper
      ? { presentationIntent: 'recommendation', groundingRequirement: hasFaqTopic(information) ? 'both' : 'product' }
    : resumesSearch(normalize(statement))
      ? { presentationIntent: 'recommendation', groundingRequirement: 'product' }
    : preserveHistoricalRecommendationIntent(
        scopedRequest, currentPlan, domain.vocabulary,
        (message) => domain.isPreferenceFollowUp(message), hasFaqTopic(request.message), needsBudgetClarification,
      )
  const currentBudget = extractBudget(statement)
  const structuredBudget = request.preferences?.maxPrice
  const budgetEvidenceMissing = unconfirmedBudget && currentBudget.value === undefined && !currentBudget.revoked &&
    (structuredBudget === undefined || structuredBudget !== needValue(historicalBudget))
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
    resolveRejectedProducts(statement, history, changedGoal, recommendationIds, resolveReference)

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
    objection: { interpretation: objections, action: objectionAction, information },
    exclusions: { declared, inferred },
    context: {
      interrupted, paused, changedGoal, unresolvedRejection, recommendationIds, history,
      budgetAnswerConfirmed: statement !== declaredStatement,
      budgetEvidenceMissing,
    },
    domain: domain.interpret(
      {
        ...scopedRequest,
        message: currentBudget.revoked || clarificationReply(statement) ? '' : statement,
        history: history.filter(({ role, content }) =>
          role !== 'user' || !(budgetRevocation.test(normalize(content)) || clarificationReply(content)),
        ),
      },
      changedGoal ? undefined : comparisonText,
    ),
  }
}
