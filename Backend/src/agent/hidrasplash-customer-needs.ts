import {
  SUBCATEGORIES_BY_CATEGORY,
  type ProductCategory,
  type ProductConcern,
  type ProductSubcategory,
  type ScalpType,
} from '../catalog/product-schema.js'
import type { ChatPreferences, ChatRequest } from '../contracts/chat.js'
import type { ChatGroundingPlan } from './chat-grounding-planner.js'
import {
  historicalUserMessages,
  needFrom,
  needValue,
  normalize,
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
  request: CustomerNeedsRequest<ChatPreferences>,
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

function relevantHistoricalProductMessages(request: CustomerNeedsRequest<ChatPreferences>) {
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
  request: CustomerNeedsRequest<ChatPreferences>,
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

function latestHistoricalScalpTypes(request: CustomerNeedsRequest<ChatPreferences>) {
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

type AttributeClause = {
  readonly kind: 'preference' | 'exclusion' | 'requirement' | 'neutral'
  readonly term: string
  readonly start: number
  readonly end: number
}

// Deliberately bounded to explicit clauses. A new request or budget ends the
// attribute; ranking and formulation evidence still come from the existing index.
const attributeIntroducers = [
  /((?:prefiro|de preferencia)\s+(?:sem|evitar|nao (?:ter|conter))|nao gosto de)/,
  /(tanto faz(?:\s+(?:se (?:tem|contem)|ter|conter|ser))?|nao (?:precisa|tem que) (?:ter|conter|ser)|sem preferencia\s+(?:de|por))/,
  /((?:tem que|precisa|deve)\s+(?:ter|conter|ser\s+para|ser(?=\s+(?:couro|cabelo|pele|fragrancia|perfil)\b)))/,
  /(?:nao (?:pode|deve) (?:ter|conter)|nao quero(?:\s+(?:ter|conter))?|evitar|incompativel com|sem)/,
]
const attributeMarker = new RegExp(
  `\\b(?:${attributeIntroducers.map(({ source }) => source).join('|')})\\s+`,
  'g',
)
const attributeBoundary = /[,;.!?]|\s+(?:(?:e\s+)?(?:quero|procuro|prefiro)|mas|porem|ate|no maximo|orcamento|limite)\b/

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
      /^(?:(?:mais\s+)?(?:o\s+)?produto\s+(?:id\s*)?\d+|perguntar|fazer perguntas|restricoes?|preferencias?)\b/.test(term)
    ) {
      return []
    }
    const kind = preference ? 'preference' : neutral ? 'neutral' : requirement ? 'requirement' : 'exclusion'
    return [{ kind, term, start, end: start + term.length }]
  })
}

function readIngredientExclusion(clauses: readonly AttributeClause[]) {
  return {
    required: clauses.filter(({ kind }) => kind === 'exclusion').map(({ term }) => term),
    preferred: clauses.filter(({ kind }) => kind === 'preference').map(({ term }) => term),
  }
}

function readAttributeNeeds(message: string, structuredExclusions: readonly string[] = []) {
  const normalized = normalize(message)
  const clauses = readAttributeClauses(normalized)
  const suppressedSensory = inferSensoryTerms([
    ...clauses.map(({ term }) => term),
    ...structuredExclusions,
  ].join(' ')) ?? []
  let rankingText = clauses.length === 0
    ? message
    : clauses.reduceRight(
        (text, { start, end }) => text.slice(0, start) + text.slice(end),
        normalized,
      )
  if (suppressedSensory.length > 0) {
    rankingText = normalize(rankingText).replace(
      new RegExp(`\\b(?:${suppressedSensory.join('|')})\\b`, 'g'),
      ' ',
    )
  }
  return { clauses, rankingText: rankingText.trim(), suppressedSensory }
}

function interpretHidrasplashNeeds(request: CustomerNeedsRequest<ChatPreferences>) {
  const preferences = request.preferences ?? {}
  const attributes = readAttributeNeeds(request.message, preferences.avoidIngredients)
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

  const historyHasSafeScalpContext =
    historicalSubcategory === 'anticaspa' ||
    relevantHistoricalProductMessages(request).some((message) =>
      /\bcouro(?: cabeludo)?\b/.test(normalize(message)),
    )
  const spokenScalp = inferScalpTypes(attributes.rankingText)
  const contextualScalp = inferEllipticalScalpTypes(request.message, historyHasSafeScalpContext)
  const ingredientExclusion = readIngredientExclusion(attributes.clauses)
  const requiredIngredients = [
    ...(preferences.avoidIngredients ?? []),
    ...ingredientExclusion.required,
  ]
  const unsupportedRequirement = attributes.clauses.find(({ kind }) => kind === 'requirement')?.term
  const historicalSensory = productGoalChanged
    ? undefined
    : latestRelevantHistoricalValue(request, (message) =>
        inferSensoryTerms(readAttributeNeeds(message).rankingText),
      )?.filter((term) => !attributes.suppressedSensory.includes(term))
  const category: Need<ProductCategory> = preferences.category !== undefined
    ? needFrom(preferences.category)
    : currentCategory !== undefined
      ? { origin: 'inferred', value: currentCategory }
      : needFrom(undefined, historicalCategory)

  return {
    category,
    rankingText: attributes.rankingText,
    objective: needFrom(currentSubcategory, categoryChanged ? undefined : historicalSubcategory),
    preferences: {
      hairTypes: needFrom(preferences.hairTypes),
      scalpTypes: needFrom(
        preferences.scalpTypes ?? spokenScalp,
        contextualScalp ?? (productGoalChanged ? undefined : latestHistoricalScalpTypes(request)),
      ),
      hairConcerns: needFrom(
        preferences.hairConcerns ?? inferHairConcerns(attributes.rankingText),
        productGoalChanged ? undefined : latestRelevantHistoricalValue(request, inferHairConcerns),
      ),
      sensory: needFrom(
        inferSensoryTerms(attributes.rankingText),
        historicalSensory?.length ? historicalSensory : undefined,
      ),
      skinTypes: needFrom(preferences.skinTypes),
      bodyConcerns: needFrom(preferences.bodyConcerns),
      preferredIngredientExclusions: needFrom(
        ingredientExclusion.preferred.length > 0 ? [...new Set(ingredientExclusion.preferred)] : undefined,
      ),
    },
    restrictions: {
      ingredientExclusions: needFrom(requiredIngredients.length > 0 ? [...new Set(requiredIngredients)] : undefined),
      unsupportedRequirement: needFrom(unsupportedRequirement),
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
  isPreferenceFollowUp(message: string) {
    const attributes = readAttributeNeeds(message)
    return (
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
  request: Pick<ChatRequest, 'cart'>,
  productIndex: ProductSearchIndex,
) {
  const { budget, domain } = needs
  const category = needValue(domain.category)
  const requestedSubcategory = needValue(domain.objective)
  const conflictingScope = category !== undefined && requestedSubcategory !== undefined &&
    !(SUBCATEGORIES_BY_CATEGORY[category] as readonly string[]).includes(requestedSubcategory)
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

  const searchInput: SearchProductsInput = {
    query: [domain.rankingText, ...effectiveSensoryTerms].join(' '),
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
  return {
    constraints,
    searchInput,
    toolPreferences: toolPreferences.data,
    presentation: { searchInput, sensoryTerms: effectiveSensoryTerms },
    rejectedProductIds: new Set([...needs.exclusions.declared, ...needs.exclusions.inferred]),
    needsClarification:
      budget.origin === 'ambiguous' ||
      conflictingScope ||
      !toolPreferences.success ||
      domain.restrictions.unsupportedRequirement.origin !== 'absent' ||
      ingredientResolution.unresolvedTerms.length > 0,
    cart: request.cart,
  }
}

type HidrasplashSearchContext = ReturnType<typeof translateHidrasplashNeeds>

export function hasSelectionDiscriminator(context: HidrasplashSearchContext) {
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

export function consultativeQuestion(
  plan: ChatGroundingPlan,
  context: HidrasplashSearchContext,
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
