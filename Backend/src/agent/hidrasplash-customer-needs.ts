import {
  SUBCATEGORIES_BY_CATEGORY,
  type ProductCategory,
  type ProductConcern,
  type ProductSubcategory,
  type ScalpType,
} from '../catalog/product-schema.js'
import type { ChatPreferences, ChatRequest } from '../contracts/chat.js'
import type { ChatGroundingPlan } from './chat-grounding-planner.js'
import type { ClarificationIssue } from './clarification-strategy.js'
import {
  asksForProductSelection,
  budgetQuestion,
  historicalNeed,
  matchesClarificationQuestion,
  needFrom,
  needValue,
  normalize,
  rejectedProductQuestion,
  resolveContextNeed,
  resolveContextValues,
  shortBudgetAnswer,
  type CustomerNeeds,
  type CustomerNeedsDomain,
  type CustomerNeedsRequest,
  type Need,
} from './customer-needs.js'
import {
  PRODUCT_SEARCH_MAX_QUERY_LENGTH,
  searchProductsToolInputSchema,
  type ProductEligibilityConstraints,
  type ProductSearchIndex,
  type SearchProductsInput,
} from './tools/product-tools.js'

function latestHistoricalValue<T>(
  messages: readonly string[],
  infer: (message: string) => T | undefined,
) {
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

const categoryQuestion = 'Que tipo de produto você quer nesta busca?'
const objectiveQuestion = 'Qual é a finalidade principal do produto nesta busca?'
const scalpQuestion = 'Recebi duas informações sobre o seu couro cabeludo. Qual delas descreve melhor o seu caso?'
const ingredientQuestion = 'As informações divergem sobre um ingrediente. Qual ingrediente precisa ficar de fora?'

interface CustomerTurn {
  readonly message: string
  readonly reply?: string
}

function declaredProductGoal(message: string, reply?: string) {
  const text = normalize(message)
  const request = text.match(/(?:^|[.;:!]\s*)(?:(?:agora|na verdade,?|em vez disso,?|eu)\s+)*(?:quero|procuro|preciso de|busco|estou procurando)\s+([^.;!?]+)/)?.[1]
  const barePurpose = /^(?:para )?(?:antiqueda|antirresiduos|hidratacao|nutricao)(?:\s+ou\s+(?:para )?(?:antiqueda|antirresiduos|hidratacao|nutricao))*[.!]?$/.test(text)
  const product = request ?? (asksForProductSelection(text) || barePurpose ? text :
    text.match(/^(?:shampoo|anticaspa|condicionador|mascara|finalizador|sabonete|oleo corporal)\b[^.;!?]*/)?.[0])
  const alternatives = product?.split(/\s+ou\s+/) ?? []
  const categories = new Set(alternatives.map(inferCategory).filter((category) => category !== undefined))
  const explicitChange = /\b(?:agora quero|em vez disso,? quero)\b/.test(text)
  const explicitPurpose = explicitChange || /\bna verdade,? quero\b/.test(text) || barePurpose
  const objectives = new Set((categories.size === 1 || explicitPurpose ? alternatives : [])
    .map(inferSubcategory).filter((objective) => objective !== undefined))
  const category: Need<ProductCategory> = categories.size > 1 ||
    (categories.size === 1 && reply !== undefined && matchesClarificationQuestion(reply, categoryQuestion))
    ? { origin: 'ambiguous' } : needFrom([...categories][0])
  const objective: Need<ProductSubcategory> = objectives.size > 1 ||
    (objectives.size === 1 && reply !== undefined && matchesClarificationQuestion(reply, objectiveQuestion))
    ? { origin: 'ambiguous' } : needFrom([...objectives][0])
  return {
    category,
    objective,
    explicitChange,
  }
}

function inferScalpTypes(message: string): readonly ScalpType[] | undefined {
  const normalized = normalize(message)
  const types: ScalpType[] = []
  if (/\bcouro(?: cabeludo)? (?:e |eh )?oleoso\b/.test(normalized)) types.push('oleoso')
  if (/\bcouro(?: cabeludo)? (?:e |eh )?seco\b/.test(normalized)) types.push('seco')
  if (/\bcouro(?: cabeludo)? (?:e |eh )?normal\b/.test(normalized)) types.push('normal')
  if (/\bcouro(?: cabeludo)? (?:e |eh )?sensivel\b/.test(normalized)) types.push('sensivel')
  return types.length > 0 ? types : undefined
}

function inferEllipticalScalpTypes(
  message: string,
  hasSafeScalpContext: boolean,
): readonly ScalpType[] | undefined {
  if (!hasSafeScalpContext) return undefined
  const match = normalize(message).match(
    /^(?:(?:e|eh|meu couro e|meu couro eh)\s+)?(oleoso|seco|normal|sensivel)\b/,
  )
  return match?.[1] ? [match[1] as ScalpType] : undefined
}

function latestHistoricalScalpTypes(turns: readonly CustomerTurn[]) {
  let hasSafeScalpContext = false
  let latest: Need<readonly ScalpType[]> = { origin: 'absent' }
  for (const { message, reply } of turns) {
    hasSafeScalpContext ||=
      needValue(declaredProductGoal(message).objective) === 'anticaspa' ||
      /\bcouro(?: cabeludo)?\b/.test(normalize(message))
    const types = inferScalpTypes(readAttributeNeeds(message).rankingText) ??
      inferEllipticalScalpTypes(message, hasSafeScalpContext)
    if (types !== undefined) {
      latest = reply !== undefined && matchesClarificationQuestion(reply, scalpQuestion)
        ? { origin: 'ambiguous' } : historicalNeed(needFrom(types))
    }
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

type AttributeClause = {
  readonly kind: 'preference' | 'exclusion' | 'requirement' | 'neutral' | 'allow' | 'release'
  readonly term: string
  readonly start: number
  readonly end: number
}

// Deliberately bounded to explicit clauses. A new request or budget ends the
// attribute; ranking and formulation evidence still come from the existing index.
const attributeIntroducers = [
  /((?:prefiro|de preferencia)\s+(?:sem|evitar|nao (?:ter|conter))|nao gosto de)/,
  /(tanto faz(?:\s+(?:se (?:tem|contem)|ter|conter|ser))?|nao (?:precisa|tem que) (?:mais )?(?:ter|conter|ser(?:\s+para)?)|sem preferencia\s+(?:de|por)|(?:agora |ja )?pode (?:ter|conter)|nao(?=\s+(?:oleoso|seco|sensivel|normal|fragrancia|frescor|refrescante|intens[ao]|citric[ao])\b))/,
  /((?:tem que|precisa|deve)\s+(?:ter|conter|ser\s+para|ser(?=\s+(?:couro|cabelo|pele|fragrancia|perfil)\b)))/,
  /(?:nao (?:pode|deve) (?:ter|conter)|nao quero(?:\s+(?:ter|conter))?|evitar|incompativel com|sem)/,
]
const attributeMarker = new RegExp(
  `\\b(?:${attributeIntroducers.map(({ source }) => source).join('|')})\\s+`,
  'g',
)
const attributeBoundary = /[,;.!?]|\s+(?:(?:e\s+)?(?:quero|procuro|prefiro)|mas|porem|ate|no maximo|orcamento|limite|mudei de ideia)\b/

function readAttributeClauses(message: string) {
  const markers = [...message.matchAll(attributeMarker)]
  return markers.flatMap((marker, index): AttributeClause[] => {
    const [introducer, preference, neutral, requirement] = marker
    const start = marker.index + introducer.length
    const term = message.slice(start, markers[index + 1]?.index)
      .split(attributeBoundary, 1)[0]
      ?.trim()
      .replace(/\s+(?:e|ou|mas)$/, '')
    if (
      !term ||
      /^(?:(?:mais\s+)?(?:o\s+)?produto\s+(?:id\s*)?\d+|(?:mais\s+)?(?:esse|este|essa|esta)\s+(?:produto|opcao)|perguntar|fazer perguntas|restricoes?|preferencias?)\b/.test(term)
    ) {
      return []
    }
    let kind: AttributeClause['kind'] = preference
      ? 'preference'
      : neutral ? 'neutral' : requirement ? 'requirement' : 'exclusion'
    if (neutral && !message.includes('?')) {
      if (/^nao (?:precisa|tem que)\b/.test(neutral)) kind = 'release'
      if (
        /^(?:(?:agora|ja) pode)\b/.test(neutral) ||
        (/^pode\b/.test(neutral) && /\bmudei de ideia\b/.test(message))
      ) {
        kind = 'allow'
      }
    }
    return [{ kind, term, start, end: start + term.length }]
  })
}

function readIngredientExclusion(clauses: readonly AttributeClause[]) {
  return {
    required: clauses.filter(({ kind }) => kind === 'exclusion').map(({ term }) => term),
    preferred: clauses.filter(({ kind }) => kind === 'preference').map(({ term }) => term),
    revoked: clauses.filter(({ kind }) => kind === 'allow').map(({ term }) => term),
  }
}

function suppressedSensoryTerms(terms: readonly string[]) {
  return inferSensoryTerms(normalize(terms.join(' '))
    .replace(/\bcitrica\b/g, 'citrico')
    .replace(/\bintensa\b/g, 'intenso')) ?? []
}

function removeSensoryTerms(text: string, terms: readonly string[]) {
  return terms.length === 0
    ? text
    : normalize(text).replace(new RegExp(`\\b(?:${terms.join('|')})\\b`, 'g'), ' ').trim()
}

function readAttributeNeeds(message: string) {
  const normalized = normalize(message)
  const clauses = readAttributeClauses(normalized)
  const suppressedSensory = suppressedSensoryTerms(clauses.map(({ term }) => term))
  const rankingText = clauses.length === 0
    ? message
    : clauses.reduceRight(
        (text, { start, end }) => text.slice(0, start) + text.slice(end),
        normalized,
      )
  return { clauses, rankingText: removeSensoryTerms(rankingText, suppressedSensory), suppressedSensory }
}

const attributeKey = (term: string) => normalize(term).replace(/-/g, ' ').replace(/\s+/g, ' ')

function requiredAttributes(clauses: readonly AttributeClause[]) {
  return {
    add: clauses.filter(({ kind }) => kind === 'requirement').map(({ term }) => term),
    revoke: clauses.filter(({ kind }) => kind === 'release').map(({ term }) => term),
  }
}

function sensoryUpdate(message: string, attributes: ReturnType<typeof readAttributeNeeds>) {
  const positive = inferSensoryTerms(attributes.rankingText)
  return {
    ...(/\b(?:agora prefiro|em vez de|na verdade|mudei de ideia)\b/.test(normalize(message)) && positive
      ? { replace: positive }
      : { add: positive }),
    revoke: attributes.suppressedSensory,
  }
}

function interpretHidrasplashNeeds(request: CustomerNeedsRequest<ChatPreferences>, comparisonText = '') {
  const preferences = request.preferences ?? {}
  const attributes = readAttributeNeeds(request.message)
  const rankingText = comparisonText ? `${comparisonText} ${attributes.rankingText}`.trim() : attributes.rankingText
  const turns = request.history.flatMap((entry, index): CustomerTurn[] => {
    if (entry.role !== 'user') return []
    const next = request.history[index + 1]
    return [{ message: entry.content, reply: next?.role === 'assistant' ? next.content : undefined }]
  })
  const previous = turns.map(({ message }) => message)
  const priorAttributes = previous.map(readAttributeNeeds)
  let historicalCategory: Need<ProductCategory> = { origin: 'absent' }
  let historicalSubcategory: Need<ProductSubcategory> = { origin: 'absent' }
  for (const { message, reply } of turns) {
    const goal = declaredProductGoal(message, reply)
    historicalCategory = resolveContextNeed(historicalCategory, historicalNeed(goal.category))
    historicalSubcategory = resolveContextNeed(historicalSubcategory, historicalNeed(goal.objective))
  }
  const spokenGoal = declaredProductGoal(request.message)
  const spokenCategory = needValue(spokenGoal.category)
  const spokenObjective = needValue(spokenGoal.objective)
  const comparisonCategory = historicalCategory.origin === 'absent' ? inferCategory(comparisonText) : undefined
  const comparisonSubcategory = historicalSubcategory.origin === 'absent' ? inferSubcategory(comparisonText) : undefined

  const historyHasSafeScalpContext =
    needValue(historicalSubcategory) === 'anticaspa' ||
    previous.some((message) =>
      /\bcouro(?: cabeludo)?\b/.test(normalize(message)),
    )
  const spokenScalp = inferScalpTypes(rankingText)
  const contextualScalp = inferEllipticalScalpTypes(request.message, historyHasSafeScalpContext)
  const ingredientExclusion = readIngredientExclusion(attributes.clauses)
  const priorExclusions = priorAttributes.map(({ clauses }, index) => {
    const exclusion = readIngredientExclusion(clauses)
    const reply = turns[index]?.reply
    const unconfirmed = reply !== undefined && matchesClarificationQuestion(reply, ingredientQuestion)
    return { ...exclusion, tentativeRevocation: unconfirmed ? exclusion.revoked : [],
      revoked: unconfirmed ? [] : exclusion.revoked }
  })
  const currentExclusions = [...(preferences.avoidIngredients ?? []), ...ingredientExclusion.required]
  const pendingIngredientChanges = resolveContextValues(
    priorExclusions.map(({ required, revoked, tentativeRevocation }) =>
      ({ add: tentativeRevocation, revoke: [...required, ...revoked] })),
    { revoke: [...currentExclusions, ...ingredientExclusion.revoked] },
    attributeKey,
  )
  const ingredientExclusions = resolveContextValues(
    priorExclusions.map(({ required, revoked }) => ({ add: required, revoke: revoked })),
    { add: currentExclusions, revoke: ingredientExclusion.revoked },
    attributeKey,
  )
  const preferredIngredientExclusions = resolveContextValues(
    priorExclusions.map(({ preferred, revoked }) => ({ add: preferred, revoke: revoked })),
    { add: ingredientExclusion.preferred, revoke: ingredientExclusion.revoked },
    attributeKey,
  )
  const mandatory = resolveContextValues(
    priorAttributes.map(({ clauses }) => requiredAttributes(clauses)),
    requiredAttributes(attributes.clauses),
    attributeKey,
  )
  const unsupportedRequirement: Need<string> = 'value' in mandatory && mandatory.value[0] !== undefined
    ? { origin: mandatory.origin, value: mandatory.value[0] }
    : { origin: 'absent' }
  const suppressed = suppressedSensoryTerms([
    ...(needValue(ingredientExclusions) ?? []),
    ...(needValue(preferredIngredientExclusions) ?? []),
    ...(needValue(mandatory) ?? []),
  ])
  const sensory = resolveContextValues(
    previous.map((message, index) => sensoryUpdate(message, priorAttributes[index])),
    sensoryUpdate(request.message, { ...attributes, rankingText: removeSensoryTerms(rankingText, suppressed) }),
  )
  const effectiveSensory = needValue(sensory)?.filter((term) => !suppressed.includes(term))
  const historicalConcerns = latestHistoricalValue(previous, (message) => inferHairConcerns(readAttributeNeeds(message).rankingText))
      ?.filter((concern) =>
        !(spokenScalp?.includes('seco') && concern === 'oleosidade') &&
        !(spokenScalp?.includes('oleoso') && concern === 'ressecamento'),
      )
  const conflictingStructuredAttribute =
    (preferences.avoidIngredients ?? []).some((term) =>
      ingredientExclusion.revoked.some((removed) => attributeKey(term) === attributeKey(removed)),
    ) ? 'ingredient' :
    preferences.category !== undefined && spokenCategory !== undefined &&
      preferences.category !== spokenCategory ? 'category' :
    preferences.subcategory !== undefined && spokenObjective !== undefined &&
      preferences.subcategory !== spokenObjective ? 'objective' :
    preferences.scalpTypes !== undefined && spokenScalp !== undefined &&
      !spokenScalp.some((type) => preferences.scalpTypes?.includes(type)) ? 'scalp' :
    undefined
  const category = resolveContextNeed(historicalCategory, spokenGoal.category.origin === 'ambiguous'
    ? spokenGoal.category
    : preferences.category !== undefined ? needFrom(preferences.category)
      : historicalNeed(needFrom(spokenCategory ?? comparisonCategory)))
  const objective = resolveContextNeed(historicalSubcategory, spokenGoal.objective.origin === 'ambiguous'
    ? spokenGoal.objective : needFrom(preferences.subcategory ?? spokenObjective ?? comparisonSubcategory))

  return {
    category,
    rankingText: removeSensoryTerms(rankingText, suppressed),
    conflictingStructured: conflictingStructuredAttribute !== undefined,
    conflictingStructuredAttribute,
    objective,
    preferences: {
      hairTypes: needFrom(preferences.hairTypes),
      scalpTypes: resolveContextNeed(latestHistoricalScalpTypes(turns),
        needFrom(preferences.scalpTypes ?? spokenScalp, contextualScalp)),
      hairConcerns: needFrom(
        preferences.hairConcerns ?? inferHairConcerns(rankingText),
        historicalConcerns?.length ? historicalConcerns : undefined,
      ),
      sensory: 'value' in sensory && effectiveSensory?.length
        ? { origin: sensory.origin, value: effectiveSensory } satisfies Need<readonly string[]>
        : { origin: 'absent' as const },
      skinTypes: needFrom(preferences.skinTypes),
      bodyConcerns: needFrom(preferences.bodyConcerns),
      preferredIngredientExclusions,
    },
    restrictions: {
      ingredientExclusions,
      pendingIngredientChanges,
      unsupportedRequirement,
    },
  }
}

export const hidrasplashCustomerDomain = {
  vocabulary: {
    productSignals: [
      /\b(?:shampoo|condicionador|mascara|finalizador|sabonete|oleo corporal)\b/,
      /\b(?:ingrediente|formula|composicao|contem|leva|sem fragrancia)\b/,
      /\b(?:caspa|oleosidade|oleoso|ressecamento|frizz|queda|couro(?: cabeludo)?|cabelo|pele)\b/,
    ],
    requestedProduct: /\b(?:shampoo|condicionador|mascara|finalizador|sabonete|oleo|anticaspa)\b/,
  },
  interpret: interpretHidrasplashNeeds,
  goal(message: string, preferences?: ChatPreferences, reply?: string) {
    const declared = declaredProductGoal(message, reply)
    return {
      category: declared.category.origin === 'ambiguous'
        ? declared.category : resolveContextNeed(declared.category, needFrom(preferences?.category)),
      objective: declared.objective.origin === 'ambiguous'
        ? declared.objective : resolveContextNeed(declared.objective, needFrom(preferences?.subcategory)),
      explicitChange: declared.explicitChange,
    }
  },
  isPreferenceFollowUp(message: string) {
    const attributes = readAttributeNeeds(message)
    const { category, objective } = declaredProductGoal(message)
    return (
      category.origin !== 'absent' ||
      objective.origin !== 'absent' ||
      attributes.clauses.length > 0 ||
      inferSensoryTerms(attributes.rankingText) !== undefined ||
      inferScalpTypes(attributes.rankingText) !== undefined ||
      /^(?:e|eh)?\s*(?:oleoso|seco|normal|sensivel)\b/.test(normalize(message))
    )
  },
  quoteProductNouns: 'produto|shampoo',
  quoteQuantityNouns: 'unidades?|frascos?|itens?',
  isFormulationQuestion(message: string) {
    return /\b(?:ingredientes?|formula|formulacao|composicao|contem|leva)\b/.test(message)
  },
} satisfies CustomerNeedsDomain<ChatPreferences, ReturnType<typeof interpretHidrasplashNeeds>> & {
  quoteProductNouns: string
  quoteQuantityNouns: string
  isFormulationQuestion(message: string): boolean
}

type HidrasplashNeeds = CustomerNeeds<ReturnType<typeof interpretHidrasplashNeeds>>

export function translateHidrasplashNeeds(
  needs: HidrasplashNeeds,
  request: Pick<ChatRequest, 'cart' | 'message'>,
  productIndex: ProductSearchIndex,
) {
  const { budget, domain } = needs
  const category = needValue(domain.category)
  const requestedSubcategory = needValue(domain.objective)
  const invalidScope = category !== undefined && requestedSubcategory !== undefined &&
    !(SUBCATEGORIES_BY_CATEGORY[category] as readonly string[]).includes(requestedSubcategory)
  const conflictingScope = invalidScope || domain.category.origin === 'ambiguous' || domain.objective.origin === 'ambiguous'
  const subcategory = conflictingScope ? undefined : requestedSubcategory
  const maxPrice = budget.origin === 'ambiguous' ? budget.conservativeValue : needValue(budget)
  const effectiveSensoryTerms = needValue(domain.preferences.sensory) ?? []
  const scalpTypes = needValue(domain.preferences.scalpTypes)
  const hairConcerns = needValue(domain.preferences.hairConcerns)
  const hairTypes = needValue(domain.preferences.hairTypes)
  const skinTypes = needValue(domain.preferences.skinTypes)
  const bodyConcerns = needValue(domain.preferences.bodyConcerns)
  const ingredientResolution = productIndex.resolveIngredientTerms(
    needValue(domain.restrictions.ingredientExclusions) ?? [],
  )

  const constraints: ProductEligibilityConstraints = {
    ...(category !== undefined ? { category } : {}),
    ...(subcategory !== undefined ? { subcategory } : {}),
    ...(maxPrice !== undefined ? { maxPrice } : {}),
    requireInStock: true,
    ...(ingredientResolution.resolvedIds.length > 0
      ? { incompatibleIngredientIds: [...ingredientResolution.resolvedIds] }
      : {}),
  }

  const query = [domain.rankingText, ...effectiveSensoryTerms].join(' ').trim() || request.message
  const searchInput: SearchProductsInput = {
    query,
    ...(category !== undefined ? { category } : {}),
    ...(subcategory !== undefined ? { subcategory } : {}),
    ...(maxPrice !== undefined ? { maxPrice } : {}),
    requireInStock: true,
    ...(hairTypes !== undefined
      ? { hairTypes: hairTypes }
      : {}),
    ...(scalpTypes !== undefined ? { scalpTypes: [...scalpTypes] } : {}),
    ...(hairConcerns !== undefined
      ? { hairConcerns: [...hairConcerns] }
      : {}),
    ...(skinTypes !== undefined
      ? { skinTypes: skinTypes }
      : {}),
    ...(bodyConcerns !== undefined
      ? { bodyConcerns: bodyConcerns }
      : {}),
    ...(ingredientResolution.resolvedIds.length > 0
      ? { incompatibleIngredientIds: [...ingredientResolution.resolvedIds] }
      : {}),
    limit: 5,
  }

  // The internal index still ranks the full message. Validate only the tool-sized
  // projection, preserving the existing ranking inputs and strict tool contract.
  const toolPreferences = searchProductsToolInputSchema.safeParse({
    ...searchInput,
    query: searchInput.query?.slice(0, PRODUCT_SEARCH_MAX_QUERY_LENGTH),
  })
  const issues: ClarificationIssue[] = []
  const invalidBudget = !toolPreferences.success &&
    toolPreferences.error.issues.some(({ path }) => path[0] === 'maxPrice')
  if (domain.restrictions.unsupportedRequirement.origin !== 'absent') {
    issues.push({
      reason: 'unverified_requirement', priority: 'restriction', attribute: 'required_attribute',
      limitation: 'Não consegui verificar esse requisito obrigatório no catálogo. Com essa condição, não posso indicar um produto com segurança.',
    })
  }
  if (ingredientResolution.unresolvedTerms.length > 0) {
    issues.push({
      reason: 'unverified_exclusion', priority: 'restriction', attribute: 'ingredient',
      limitation: 'Não consegui confirmar a exclusão desse ingrediente no catálogo. Com essa condição, não posso indicar um produto com segurança.',
    })
  }
  if (domain.conflictingStructuredAttribute === 'ingredient' || domain.restrictions.pendingIngredientChanges.origin !== 'absent') {
    issues.push({
      reason: 'structured_conflict', priority: 'restriction', attribute: 'ingredient',
      question: ingredientQuestion,
      limitation: 'A exclusão de ingrediente ainda está em aberto, então não consigo indicar um produto com segurança.',
    })
  }
  if (budget.origin === 'ambiguous') {
    issues.push({
      reason: 'budget_conflict', priority: 'restriction', attribute: 'budget',
      question: budgetQuestion,
      limitation: 'O limite de preço ainda está em aberto, então não consigo indicar um produto com segurança.',
    })
  } else if (needs.context.budgetEvidenceMissing) {
    issues.push({
      reason: 'budget_unconfirmed', priority: 'restriction', attribute: 'budget',
      question: shortBudgetAnswer(request.message) === undefined ? budgetQuestion
        : 'Esse número é o valor máximo que você quer gastar? Se for, informe o limite com “Até R$ ...”.',
      limitation: 'Ainda preciso que você confirme o limite de preço para indicar um produto.',
    })
  } else if (invalidBudget) {
    issues.push({
      reason: 'unverified_budget', priority: 'restriction', attribute: 'budget',
      limitation: 'Não consegui usar o limite de preço informado para verificar os produtos disponíveis.',
    })
  }
  if (domain.conflictingStructuredAttribute === 'scalp' || domain.preferences.scalpTypes.origin === 'ambiguous') {
    issues.push({
      reason: 'structured_conflict', priority: 'ambiguity', attribute: 'scalp',
      question: scalpQuestion,
      limitation: 'As informações sobre o couro cabeludo são diferentes e preciso dessa confirmação para indicar um produto.',
    })
  } else if (conflictingScope || domain.conflictingStructuredAttribute === 'category' ||
    domain.conflictingStructuredAttribute === 'objective' || (!toolPreferences.success && !invalidBudget)) {
    const categoryConflict = invalidScope || domain.category.origin === 'ambiguous' || domain.conflictingStructuredAttribute === 'category' ||
      (!toolPreferences.success && !invalidBudget)
    issues.push({
      reason: 'scope_conflict', priority: 'ambiguity', attribute: categoryConflict ? 'category' : 'objective',
      question: categoryConflict ? categoryQuestion : objectiveQuestion,
      limitation: 'O tipo ou a finalidade do produto ainda está em aberto, então não consigo fazer uma indicação segura.',
    })
  }
  if (needs.context.unresolvedRejection) {
    issues.push({
      reason: 'rejection_reference', priority: 'ambiguity', attribute: 'product',
      question: rejectedProductQuestion,
      limitation: 'Sem identificar o produto que você quer deixar de fora, não consigo escolher outra opção com segurança.',
    })
  }
  return {
    constraints,
    searchInput,
    toolPreferences: toolPreferences.data,
    presentation: { searchInput, sensoryTerms: effectiveSensoryTerms },
    rejectedProductIds: new Set([...needs.exclusions.declared, ...needs.exclusions.inferred]),
    issues,
    needsClarification: issues.length > 0,
    cart: request.cart,
  }
}

type HidrasplashSearchContext = ReturnType<typeof translateHidrasplashNeeds>

function hasCommercialScope(context: HidrasplashSearchContext) {
  const input = context.searchInput
  return input.category !== undefined || input.subcategory !== undefined ||
    input.hairTypes !== undefined || input.scalpTypes !== undefined ||
    input.hairConcerns !== undefined || input.skinTypes !== undefined || input.bodyConcerns !== undefined
}

export function hasSelectionDiscriminator(context: HidrasplashSearchContext) {
  if (!hasCommercialScope(context)) return false
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

export function hidrasplashConsultation(
  plan: ChatGroundingPlan,
  context: HidrasplashSearchContext,
) : { readonly issues: readonly ClarificationIssue[]; readonly selectionQuestion?: ClarificationIssue; readonly canChooseWithoutPreference?: boolean } {
  if (
    plan.presentationIntent !== 'recommendation' ||
    hasSelectionDiscriminator(context)
  ) {
    return { issues: context.issues }
  }
  const { category, subcategory, hairConcerns } = context.searchInput
  if (!hasCommercialScope(context)) {
    return { issues: context.issues, selectionQuestion: {
      reason: 'missing_scope', priority: 'selection', attribute: 'category',
      question: 'Que tipo de produto você está procurando?',
      limitation: 'Ainda preciso saber que tipo de produto você procura para indicar uma opção.',
    } }
  }
  const scalpMatters = subcategory === 'anticaspa' || Boolean(hairConcerns?.includes('caspa'))
  const forSkin = category === 'sabonetes' || category === 'oleos-corporais'
  return {
    issues: context.issues,
    canChooseWithoutPreference: true,
    selectionQuestion: {
      reason: 'selection_preference', priority: 'preference', attribute: scalpMatters ? 'scalp' : 'objective',
      question: scalpMatters
        ? 'Seu couro cabeludo tende a ser seco, normal, oleoso ou sensível?'
        : forSkin ? 'O que você quer priorizar no cuidado da pele?' : 'O que você quer priorizar no cuidado do cabelo?',
      limitation: 'Com o que você informou até aqui, ainda não consigo diferenciar uma opção com segurança.',
    },
  }
}
