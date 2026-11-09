import { z } from 'zod'

import type { CatalogRepository } from '../../catalog/catalog-repository.js'
import {
  SUBCATEGORIES_BY_CATEGORY,
  bodyConcernSchema,
  commercialVariantSchema,
  dataClassificationSchema,
  hairTypeSchema,
  ingredientSchema,
  netContentSchema,
  normalizedIdentifierSchema,
  productCategorySchema,
  productConcernSchema,
  productSchema,
  productSubcategorySchema,
  restrictionCodeSchema,
  scalpTypeSchema,
  skinTypeSchema,
  syntheticFormulationSchema,
  type Product,
  type ProductCategory,
  type ProductSubcategory,
  type RestrictionCode,
} from '../../catalog/product-schema.js'
import type {
  AgentTool,
  AgentToolExecutionContext,
} from './agent-tool.js'

export const SEARCH_PRODUCTS_TOOL_NAME = 'search_products'
export const GET_PRODUCT_DETAILS_TOOL_NAME = 'get_product_details'
export const PRODUCT_SEARCH_DEFAULT_LIMIT = 3
export const PRODUCT_SEARCH_MAX_RESULTS = 5
export const PRODUCT_SEARCH_MAX_QUERY_LENGTH = 100
export const PRODUCT_SEARCH_MAX_SERIALIZED_RESULT_CHARACTERS = 8_000
export const PRODUCT_DETAILS_MAX_SERIALIZED_RESULT_CHARACTERS = 12_000

export const SEARCH_PRODUCTS_TOOL_DESCRIPTION =
  'Busca produtos demonstrativos elegíveis no catálogo canônico. Filtros de preço, estoque, restrições e ingredientes são aplicados pelo backend; a ordem representa pertinência comercial, não segurança ou eficácia clínica.'
export const GET_PRODUCT_DETAILS_TOOL_DESCRIPTION =
  'Consulta dados canônicos de um produto pelo ID. Um produto pode ser consultado para informação sem estar elegível para recomendação.'

const uniqueArray = <T extends z.ZodType>(schema: T, max: number) =>
  z
    .array(schema)
    .min(1)
    .max(max)
    .refine((values) => new Set(values).size === values.length, {
      message: 'Os valores não podem se repetir.',
    })

const querySchema = z.string().trim().min(1).max(PRODUCT_SEARCH_MAX_QUERY_LENGTH)
const ingredientIdsSchema = uniqueArray(normalizedIdentifierSchema, 20)

const hairCriteriaFields = [
  'hairTypes',
  'scalpTypes',
  'hairConcerns',
] as const
const bodyCriteriaFields = ['skinTypes', 'bodyConcerns'] as const
const hairCategories = new Set<ProductCategory>([
  'shampoos',
  'condicionadores',
  'mascaras',
  'finalizadores',
])
const bodyCategories = new Set<ProductCategory>([
  'sabonetes',
  'oleos-corporais',
])

export const searchProductsToolInputSchema = z
  .object({
    query: querySchema.optional(),
    category: productCategorySchema.optional(),
    subcategory: productSubcategorySchema.optional(),
    maxPrice: z.number().finite().nonnegative().max(100_000).optional(),
    requireInStock: z.boolean().default(false),
    hairTypes: uniqueArray(hairTypeSchema, 5).optional(),
    scalpTypes: uniqueArray(scalpTypeSchema, 5).optional(),
    hairConcerns: uniqueArray(productConcernSchema, 10).optional(),
    skinTypes: uniqueArray(skinTypeSchema, 6).optional(),
    bodyConcerns: uniqueArray(bodyConcernSchema, 7).optional(),
    activeRestrictionCodes: uniqueArray(restrictionCodeSchema, 6).optional(),
    incompatibleIngredientIds: ingredientIdsSchema.optional(),
    limit: z
      .number()
      .int()
      .min(1)
      .max(PRODUCT_SEARCH_MAX_RESULTS)
      .default(PRODUCT_SEARCH_DEFAULT_LIMIT),
  })
  .strict()
  .superRefine((input, context) => {
    if (
      input.category !== undefined &&
      input.subcategory !== undefined &&
      !(SUBCATEGORIES_BY_CATEGORY[input.category] as readonly string[]).includes(
        input.subcategory,
      )
    ) {
      context.addIssue({
        code: 'custom',
        path: ['subcategory'],
        message: 'A subcategoria não pertence à categoria informada.',
      })
    }

    const hasHairCriteria = hairCriteriaFields.some(
      (field) => input[field] !== undefined,
    )
    const hasBodyCriteria = bodyCriteriaFields.some(
      (field) => input[field] !== undefined,
    )
    if (hasHairCriteria && hasBodyCriteria) {
      context.addIssue({
        code: 'custom',
        path: [],
        message: 'Critérios capilares e corporais não podem ser misturados.',
      })
    }
    if (
      input.category !== undefined &&
      ((hairCategories.has(input.category) && hasBodyCriteria) ||
        (bodyCategories.has(input.category) && hasHairCriteria))
    ) {
      context.addIssue({
        code: 'custom',
        path: ['category'],
        message: 'Os critérios não correspondem à área da categoria.',
      })
    }

    const hasPositiveSelector =
      input.query !== undefined ||
      input.category !== undefined ||
      input.subcategory !== undefined ||
      hasHairCriteria ||
      hasBodyCriteria
    if (!hasPositiveSelector) {
      context.addIssue({
        code: 'custom',
        path: [],
        message: 'Informe ao menos um critério comercial de busca.',
      })
    }
  })

const eligibilityReasonSchema = z.enum([
  'above-price-limit',
  'out-of-stock',
  'category-mismatch',
  'subcategory-mismatch',
  'restriction-code',
  'incompatible-ingredient',
])

const matchReasonSchema = z.enum([
  'query-name',
  'query-profile',
  'query-description',
  'hair-type',
  'scalp-type',
  'skin-type',
  'hair-concern',
  'body-concern',
  'generic-compatibility',
])

const hairCompatibilitySchema = z
  .object({
    applicationArea: z.literal('hair'),
    hairTypes: z.array(hairTypeSchema).min(1),
    scalpTypes: z.array(scalpTypeSchema).min(1),
    concerns: z.array(productConcernSchema).min(1),
  })
  .strict()

const bodyCompatibilitySchema = z
  .object({
    applicationArea: z.literal('body'),
    skinTypes: z.array(skinTypeSchema).min(1),
    bodyConcerns: z.array(bodyConcernSchema).min(1),
  })
  .strict()

const productCompatibilitySchema = z.discriminatedUnion('applicationArea', [
  hairCompatibilitySchema,
  bodyCompatibilitySchema,
])

export const productSearchCandidateSchema = z
  .object({
    id: z.number().int().positive(),
    slug: normalizedIdentifierSchema,
    name: z.string().trim().min(1),
    category: productCategorySchema,
    subcategory: productSubcategorySchema,
    shortDescription: z.string().trim().min(1),
    price: z.number().finite().nonnegative(),
    originalPrice: z.number().finite().nonnegative().optional(),
    stock: z.number().int().nonnegative(),
    variant: commercialVariantSchema,
    compatibility: productCompatibilitySchema,
    dataClassification: dataClassificationSchema,
    matchReasons: z.array(matchReasonSchema),
  })
  .strict()

export const searchProductsFoundResultSchema = z
  .object({
    ok: z.literal(true),
    status: z.literal('found'),
    products: z
      .array(productSearchCandidateSchema)
      .min(1)
      .max(PRODUCT_SEARCH_MAX_RESULTS),
    budgetLimited: z.boolean(),
  })
  .strict()

export const searchProductsNotFoundResultSchema = z
  .object({
    ok: z.literal(true),
    status: z.literal('not_found'),
    products: z.tuple([]),
    budgetLimited: z.literal(false),
  })
  .strict()

export const productToolFailureResultSchema = z
  .object({
    ok: z.literal(false),
    error: z
      .object({
        code: z.enum(['INVALID_ARGUMENTS', 'EXECUTION_FAILED']),
        message: z.string().min(1),
      })
      .strict(),
  })
  .strict()

export const searchProductsExecutionResultSchema = z.union([
  searchProductsFoundResultSchema,
  searchProductsNotFoundResultSchema,
  productToolFailureResultSchema,
])

const formulationDetailsSchema = syntheticFormulationSchema

const kitContentDetailsSchema = z
  .object({
    name: z.string().trim().min(1),
    quantity: z.number().int().positive(),
    netContent: netContentSchema.optional(),
    formulation: formulationDetailsSchema,
  })
  .strict()

export const productDetailsSchema = z
  .object({
    id: z.number().int().positive(),
    slug: normalizedIdentifierSchema,
    name: z.string().trim().min(1),
    brand: z.string().trim().min(1),
    isDemo: z.literal(true),
    dataClassification: dataClassificationSchema,
    category: productCategorySchema,
    subcategory: productSubcategorySchema,
    applicationArea: z.enum(['hair', 'body']),
    productKind: z.enum(['single', 'kit']),
    description: z.string().trim().min(1),
    shortDescription: z.string().trim().min(1),
    price: z.number().finite().nonnegative(),
    originalPrice: z.number().finite().nonnegative().optional(),
    stock: z.number().int().nonnegative(),
    netContent: netContentSchema.optional(),
    variant: commercialVariantSchema,
    indications: z.array(z.string().trim().min(1)).min(1),
    benefits: z.array(z.string().trim().min(1)).min(1),
    compatibility: productCompatibilitySchema,
    formulation: formulationDetailsSchema.nullable(),
    kitContents: z.array(kitContentDetailsSchema).min(1).optional(),
    eligibility: z
      .object({
        eligible: z.boolean(),
        reasons: z.array(eligibilityReasonSchema),
      })
      .strict(),
  })
  .strict()

export const getProductDetailsInputSchema = z
  .object({ productId: z.number().int().positive() })
  .strict()

export const getProductDetailsFoundResultSchema = z
  .object({
    ok: z.literal(true),
    status: z.literal('found'),
    product: productDetailsSchema,
  })
  .strict()

export const getProductDetailsNotFoundResultSchema = z
  .object({
    ok: z.literal(true),
    status: z.literal('not_found'),
    product: z.null(),
    budgetLimited: z.literal(false),
  })
  .strict()

export const getProductDetailsExecutionResultSchema = z.union([
  getProductDetailsFoundResultSchema,
  getProductDetailsNotFoundResultSchema,
  productToolFailureResultSchema,
])

export type SearchProductsInput = z.infer<typeof searchProductsToolInputSchema>
export type EligibilityReason = z.infer<typeof eligibilityReasonSchema>

export interface ProductEligibilityConstraints {
  readonly category?: ProductCategory
  readonly subcategory?: ProductSubcategory
  readonly maxPrice?: number
  readonly requireInStock?: boolean
  readonly activeRestrictionCodes?: readonly RestrictionCode[]
  readonly incompatibleIngredientIds?: readonly string[]
}

export interface ProductEligibilityPolicy {
  applySearchConstraints(
    input: SearchProductsInput,
    context: AgentToolExecutionContext,
  ): boolean
  evaluate(
    product: Product,
    context: AgentToolExecutionContext,
    scope?: Pick<SearchProductsInput, 'category' | 'subcategory'>,
  ): { eligible: boolean; reasons: readonly EligibilityReason[] }
}

interface IndexedProduct {
  product: Product
  nameTokens: ReadonlySet<string>
  profileTokens: ReadonlySet<string>
  descriptionTokens: ReadonlySet<string>
}

export interface ProductSearchIndex {
  readonly size: number
  readonly products: readonly Product[]
  readonly ingredientIds: ReadonlySet<string>
  findById(id: number): Product | undefined
  resolveIngredientTerms(terms: readonly string[]): {
    resolvedIds: readonly string[]
    unresolvedTerms: readonly string[]
  }
  search(
    input: SearchProductsInput,
    policy: ProductEligibilityPolicy,
    context: AgentToolExecutionContext,
  ): readonly z.infer<typeof productSearchCandidateSchema>[]
}

function normalizeText(value: string) {
  return value
    .normalize('NFKD')
    .replace(/\p{Diacritic}/gu, '')
    .toLocaleLowerCase('pt-BR')
}

const stopWords = new Set([
  'a',
  'as',
  'com',
  'da',
  'de',
  'do',
  'e',
  'em',
  'meu',
  'minha',
  'o',
  'os',
  'para',
  'por',
  'quero',
  'um',
  'uma',
])

function tokenize(value: string) {
  return (
    normalizeText(value).match(/[\p{L}\p{N}]+/gu) ?? []
  ).filter((token) => token.length > 1 && !stopWords.has(token))
}

function normalizeIngredientTerm(value: string) {
  return tokenize(value).join('-')
}

function productIngredientIds(product: Product) {
  if (product.productKind === 'single') {
    return new Set((product.ingredients ?? []).map((ingredient) => ingredient.id))
  }

  return new Set(
    (product.kitContents ?? []).flatMap((content) =>
      content.formulation?.ingredients.map((ingredient) => ingredient.id) ?? [],
    ),
  )
}

function productCompatibility(product: Product) {
  return product.applicationArea === 'hair'
    ? {
        applicationArea: 'hair' as const,
        hairTypes: product.hairTypes,
        scalpTypes: product.scalpTypes,
        concerns: product.concerns,
      }
    : {
        applicationArea: 'body' as const,
        skinTypes: product.skinTypes,
        bodyConcerns: product.bodyConcerns,
      }
}

function isCategoryPairValid(
  category: ProductCategory | undefined,
  subcategory: ProductSubcategory | undefined,
) {
  return (
    category === undefined ||
    subcategory === undefined ||
    (SUBCATEGORIES_BY_CATEGORY[category] as readonly string[]).includes(
      subcategory,
    )
  )
}

export function createProductSearchIndex(
  documents: readonly Product[],
): ProductSearchIndex {
  const products = z.array(productSchema).parse(documents).sort((a, b) => a.id - b.id)
  const indexed: IndexedProduct[] = products.map((product) => ({
    product,
    nameTokens: new Set(
      tokenize(`${product.name} ${product.slug} ${product.subcategory} ${product.tags.join(' ')}`),
    ),
    profileTokens: new Set(
      tokenize(
        `${product.variant.name} ${product.variant.profile ?? ''} ${(product.variant.sensoryNotes ?? []).join(' ')}`,
      ),
    ),
    descriptionTokens: new Set(
      tokenize(
        `${product.shortDescription} ${product.description} ${product.indications.join(' ')} ${product.benefits.join(' ')}`,
      ),
    ),
  }))
  const productsById = new Map(products.map((product) => [product.id, product]))
  const ingredientIds = new Set<string>()
  const ingredientTerms = new Map<string, Set<string>>()

  for (const product of products) {
    const ingredients =
      product.productKind === 'single'
        ? (product.ingredients ?? [])
        : (product.kitContents ?? []).flatMap(
            (content) => content.formulation?.ingredients ?? [],
          )
    for (const ingredient of ingredients) {
      ingredientIds.add(ingredient.id)
      for (const term of [ingredient.id, ingredient.name]) {
        const normalized = normalizeIngredientTerm(term)
        const ids = ingredientTerms.get(normalized) ?? new Set<string>()
        ids.add(ingredient.id)
        ingredientTerms.set(normalized, ids)
      }
    }
  }

  return {
    size: products.length,
    products,
    ingredientIds,
    findById(id) {
      return productsById.get(id)
    },
    resolveIngredientTerms(terms) {
      const resolvedIds: string[] = []
      const unresolvedTerms: string[] = []
      for (const term of terms) {
        const matches = ingredientTerms.get(normalizeIngredientTerm(term))
        if (matches?.size === 1) {
          const [id] = matches
          if (id !== undefined && !resolvedIds.includes(id)) resolvedIds.push(id)
        } else {
          unresolvedTerms.push(term)
        }
      }
      return { resolvedIds, unresolvedTerms }
    },
    search(input, policy, context) {
      const queryTokens = [...new Set(tokenize(input.query ?? ''))]
      const hasHairCriteria = hairCriteriaFields.some(
        (field) => input[field] !== undefined,
      )
      const hasBodyCriteria = bodyCriteriaFields.some(
        (field) => input[field] !== undefined,
      )

      return indexed
        .flatMap(({ product, nameTokens, profileTokens, descriptionTokens }) => {
          const eligibility = policy.evaluate(product, context, input)
          if (!eligibility.eligible) return []
          if (hasHairCriteria && product.applicationArea !== 'hair') return []
          if (hasBodyCriteria && product.applicationArea !== 'body') return []

          let score = 0
          let structuredMatches = 0
          let nameEvidence = 0
          const reasons = new Set<z.infer<typeof matchReasonSchema>>()
          for (const token of queryTokens) {
            if (nameTokens.has(token)) {
              score += 3
              nameEvidence += 1
              reasons.add('query-name')
            } else if (profileTokens.has(token)) {
              score += 2
              reasons.add('query-profile')
            } else if (descriptionTokens.has(token)) {
              score += 1
              reasons.add('query-description')
            }
          }

          const scoreCompatibility = (
            requested: readonly string[] | undefined,
            available: readonly string[],
            exactReason: z.infer<typeof matchReasonSchema>,
          ) => {
            for (const value of requested ?? []) {
              if (available.includes(value)) {
                score += 4
                structuredMatches += 1
                reasons.add(exactReason)
              } else if (available.includes('todos')) {
                score += 1
                reasons.add('generic-compatibility')
              }
            }
          }

          if (product.applicationArea === 'hair') {
            scoreCompatibility(input.hairTypes, product.hairTypes, 'hair-type')
            scoreCompatibility(input.scalpTypes, product.scalpTypes, 'scalp-type')
            scoreCompatibility(input.hairConcerns, product.concerns, 'hair-concern')
          } else {
            scoreCompatibility(input.skinTypes, product.skinTypes, 'skin-type')
            scoreCompatibility(input.bodyConcerns, product.bodyConcerns, 'body-concern')
          }

          const hasSoftSelector =
            queryTokens.length > 0 || hasHairCriteria || hasBodyCriteria
          const hasHardScope = input.category !== undefined || input.subcategory !== undefined
          if (hasSoftSelector && score === 0 && !hasHardScope) return []

          const candidate = productSearchCandidateSchema.parse({
            id: product.id,
            slug: product.slug,
            name: product.name,
            category: product.category,
            subcategory: product.subcategory,
            shortDescription: product.shortDescription,
            price: product.price,
            ...(product.originalPrice !== undefined
              ? { originalPrice: product.originalPrice }
              : {}),
            stock: product.stock,
            variant: product.variant,
            compatibility: productCompatibility(product),
            dataClassification: product.dataClassification,
            matchReasons: [...reasons],
          })
          return [{ candidate, score, structuredMatches, nameEvidence }]
        })
        .sort(
          (first, second) =>
            second.score - first.score ||
            second.structuredMatches - first.structuredMatches ||
            second.nameEvidence - first.nameEvidence ||
            first.candidate.id - second.candidate.id,
        )
        .slice(0, input.limit)
        .map(({ candidate }) => candidate)
    },
  }
}

export function createProductEligibilityPolicy(
  index: ProductSearchIndex,
  trusted: ProductEligibilityConstraints = {},
): ProductEligibilityPolicy {
  if (!isCategoryPairValid(trusted.category, trusted.subcategory)) {
    throw new TypeError('Restrições confiáveis de categoria inválidas.')
  }
  if (
    trusted.maxPrice !== undefined &&
    (!Number.isFinite(trusted.maxPrice) || trusted.maxPrice < 0)
  ) {
    throw new TypeError('Restrição confiável de preço inválida.')
  }

  const trustedIngredientIds = new Set(trusted.incompatibleIngredientIds ?? [])
  if (
    [...trustedIngredientIds].some((id) => !index.ingredientIds.has(id))
  ) {
    throw new TypeError('Restrição confiável de ingrediente inválida.')
  }
  const stateKey = Symbol('product-eligibility')
  const stateFor = (context: AgentToolExecutionContext) =>
    context.getState(stateKey, () => ({
      maxPrice: trusted.maxPrice,
      requireInStock: trusted.requireInStock ?? false,
      activeRestrictionCodes: new Set(trusted.activeRestrictionCodes ?? []),
      incompatibleIngredientIds: new Set(trustedIngredientIds),
    }))

  return {
    applySearchConstraints(input, context) {
      if (
        (trusted.category !== undefined &&
          input.category !== undefined &&
          input.category !== trusted.category) ||
        (trusted.subcategory !== undefined &&
          input.subcategory !== undefined &&
          input.subcategory !== trusted.subcategory) ||
        (input.incompatibleIngredientIds ?? []).some(
          (id) => !index.ingredientIds.has(id),
        )
      ) {
        return false
      }

      const state = stateFor(context)
      if (input.maxPrice !== undefined) {
        state.maxPrice =
          state.maxPrice === undefined
            ? input.maxPrice
            : Math.min(state.maxPrice, input.maxPrice)
      }
      state.requireInStock ||= input.requireInStock
      for (const code of input.activeRestrictionCodes ?? []) {
        state.activeRestrictionCodes.add(code)
      }
      for (const id of input.incompatibleIngredientIds ?? []) {
        state.incompatibleIngredientIds.add(id)
      }
      return true
    },
    evaluate(product, context, scope = {}) {
      const state = stateFor(context)
      const reasons: EligibilityReason[] = []
      const category = trusted.category ?? scope.category
      const subcategory = trusted.subcategory ?? scope.subcategory
      if (category !== undefined && product.category !== category) {
        reasons.push('category-mismatch')
      }
      if (subcategory !== undefined && product.subcategory !== subcategory) {
        reasons.push('subcategory-mismatch')
      }
      if (state.maxPrice !== undefined && product.price > state.maxPrice) {
        reasons.push('above-price-limit')
      }
      if (state.requireInStock && product.stock <= 0) {
        reasons.push('out-of-stock')
      }
      if (
        (product.restrictions ?? []).some((code) =>
          state.activeRestrictionCodes.has(code),
        )
      ) {
        reasons.push('restriction-code')
      }
      if (
        [...productIngredientIds(product)].some((id) =>
          state.incompatibleIngredientIds.has(id),
        )
      ) {
        reasons.push('incompatible-ingredient')
      }
      return { eligible: reasons.length === 0, reasons }
    },
  }
}

function invalidArguments(toolName: string) {
  return {
    ok: false as const,
    error: {
      code: 'INVALID_ARGUMENTS' as const,
      message: `Argumentos inválidos para ${toolName}.`,
    },
  }
}

function executionFailed() {
  return {
    ok: false as const,
    error: {
      code: 'EXECUTION_FAILED' as const,
      message: 'Não foi possível consultar o catálogo agora.',
    },
  }
}

function serializedLength(value: unknown) {
  return JSON.stringify(value).length
}

export function createSearchProductsTool(
  index: ProductSearchIndex,
  eligibility: ProductEligibilityPolicy = createProductEligibilityPolicy(index),
): AgentTool {
  return {
    name: SEARCH_PRODUCTS_TOOL_NAME,
    description: SEARCH_PRODUCTS_TOOL_DESCRIPTION,
    inputSchema: searchProductsToolInputSchema,
    outputSchema: searchProductsExecutionResultSchema,
    isRecommendationProductEligible(productId, context) {
      const product = index.findById(productId)
      return (
        product !== undefined && eligibility.evaluate(product, context).eligible
      )
    },
    async execute(input, context) {
      const parsed = searchProductsToolInputSchema.safeParse(input)
      if (
        !parsed.success ||
        !eligibility.applySearchConstraints(parsed.data, context)
      ) {
        return invalidArguments(SEARCH_PRODUCTS_TOOL_NAME)
      }

      try {
        const products = index.search(parsed.data, eligibility, context)
        if (products.length === 0) {
          return {
            ok: true,
            status: 'not_found',
            products: [],
            budgetLimited: false,
          }
        }

        const selected: typeof products[number][] = []
        let budgetLimited = false
        for (const product of products) {
          const candidate = {
            ok: true,
            status: 'found',
            products: [...selected, product],
            budgetLimited: false,
          }
          if (
            serializedLength(candidate) >
            PRODUCT_SEARCH_MAX_SERIALIZED_RESULT_CHARACTERS
          ) {
            budgetLimited = true
            break
          }
          selected.push(product)
        }
        if (selected.length === 0) return executionFailed()

        return searchProductsFoundResultSchema.parse({
          ok: true,
          status: 'found',
          products: selected,
          budgetLimited,
        })
      } catch {
        return executionFailed()
      }
    },
  }
}

function toFormulation(product: Product) {
  if (product.productKind !== 'single') return null
  return syntheticFormulationSchema.parse({
    basis: 'synthetic-test-data',
    ingredients: product.ingredients,
    usage: product.usage,
    restrictions: product.restrictions,
    warnings: product.warnings,
    contraindications: product.contraindications,
  })
}

export function createGetProductDetailsTool(
  catalog: Pick<CatalogRepository, 'findById'>,
  eligibility: ProductEligibilityPolicy,
): AgentTool {
  return {
    name: GET_PRODUCT_DETAILS_TOOL_NAME,
    description: GET_PRODUCT_DETAILS_TOOL_DESCRIPTION,
    inputSchema: getProductDetailsInputSchema,
    outputSchema: getProductDetailsExecutionResultSchema,
    isRecommendationProductEligible(productId, context) {
      const product = catalog.findById(productId)
      return (
        product !== undefined && eligibility.evaluate(product, context).eligible
      )
    },
    async execute(input, context) {
      const parsed = getProductDetailsInputSchema.safeParse(input)
      if (!parsed.success) return invalidArguments(GET_PRODUCT_DETAILS_TOOL_NAME)

      try {
        const product = catalog.findById(parsed.data.productId)
        if (!product) {
          return {
            ok: true,
            status: 'not_found',
            product: null,
            budgetLimited: false,
          }
        }

        const eligibilityResult = eligibility.evaluate(product, context)
        const details = productDetailsSchema.parse({
          id: product.id,
          slug: product.slug,
          name: product.name,
          brand: product.brand,
          isDemo: product.isDemo,
          dataClassification: product.dataClassification,
          category: product.category,
          subcategory: product.subcategory,
          applicationArea: product.applicationArea,
          productKind: product.productKind,
          description: product.description,
          shortDescription: product.shortDescription,
          price: product.price,
          ...(product.originalPrice !== undefined
            ? { originalPrice: product.originalPrice }
            : {}),
          stock: product.stock,
          ...(product.netContent !== undefined
            ? { netContent: product.netContent }
            : {}),
          variant: product.variant,
          indications: product.indications,
          benefits: product.benefits,
          compatibility: productCompatibility(product),
          formulation: toFormulation(product),
          ...(product.productKind === 'kit'
            ? {
                kitContents: (product.kitContents ?? []).map((content) => ({
                  name: content.name,
                  quantity: content.quantity,
                  ...(content.netContent !== undefined
                    ? { netContent: content.netContent }
                    : {}),
                  formulation: content.formulation,
                })),
              }
            : {}),
          eligibility: eligibilityResult,
        })
        const result = { ok: true, status: 'found', product: details } as const
        if (
          serializedLength(result) >
          PRODUCT_DETAILS_MAX_SERIALIZED_RESULT_CHARACTERS
        ) {
          return executionFailed()
        }
        return result
      } catch {
        return executionFailed()
      }
    },
  }
}
