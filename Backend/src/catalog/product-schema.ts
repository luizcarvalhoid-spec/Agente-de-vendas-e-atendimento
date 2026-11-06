import { z } from 'zod'

export const PRODUCT_CATEGORIES = [
  'shampoos',
  'condicionadores',
  'mascaras',
  'finalizadores',
] as const

export const PRODUCT_SUBCATEGORIES = [
  'anticaspa',
  'antiqueda',
  'antirresiduos',
  'controle-de-oleosidade',
  'hidratacao',
  'nutricao',
  'reconstrucao',
  'cachos',
  'uso-diario',
  'protecao-termica',
] as const

export const HAIR_TYPES = [
  'todos',
  'lisos',
  'ondulados',
  'cacheados',
  'crespos',
] as const

export const SCALP_TYPES = [
  'todos',
  'normal',
  'seco',
  'oleoso',
  'sensivel',
] as const

export const PRODUCT_CONCERNS = [
  'caspa',
  'descamacao',
  'oleosidade',
  'ressecamento',
  'sensibilidade',
  'queda-e-quebra',
  'frizz',
  'danos',
  'falta-de-brilho',
  'definicao-de-cachos',
  'acumulo-de-residuos',
] as const

export const RESTRICTION_CODES = [
  'evitar-couro-cabeludo-sensivel',
  'evitar-couro-cabeludo-seco',
  'evitar-couro-cabeludo-oleoso',
  'evitar-cabelos-coloridos',
  'evitar-cabelos-quimicamente-tratados',
  'evitar-sensibilidade-a-fragrancia',
] as const

export type ProductCategory = (typeof PRODUCT_CATEGORIES)[number]
export type ProductSubcategory = (typeof PRODUCT_SUBCATEGORIES)[number]

export const SUBCATEGORIES_BY_CATEGORY = {
  shampoos: [
    'anticaspa',
    'antiqueda',
    'antirresiduos',
    'controle-de-oleosidade',
    'hidratacao',
    'nutricao',
    'reconstrucao',
    'cachos',
    'uso-diario',
  ],
  condicionadores: [
    'hidratacao',
    'nutricao',
    'reconstrucao',
    'cachos',
    'uso-diario',
  ],
  mascaras: ['hidratacao', 'nutricao', 'reconstrucao', 'cachos'],
  finalizadores: [
    'hidratacao',
    'nutricao',
    'reconstrucao',
    'cachos',
    'protecao-termica',
  ],
} as const satisfies Record<
  ProductCategory,
  readonly ProductSubcategory[]
>

const nonEmptyTextSchema = z
  .string()
  .trim()
  .min(1, 'O texto não pode ficar vazio.')

export const normalizedIdentifierSchema = z
  .string()
  .trim()
  .transform((value) => value.toLowerCase())
  .pipe(
    z
      .string()
      .regex(
        /^[a-z0-9]+(?:-[a-z0-9]+)*$/,
        'Use somente letras minúsculas sem acento, números e hífens.',
      ),
  )

export const imageReferenceSchema = z
  .string()
  .trim()
  .regex(
    /^(?:[a-zA-Z0-9][a-zA-Z0-9._-]*\/)*[a-zA-Z0-9][a-zA-Z0-9._-]*\.(?:jpe?g|png|webp)$/i,
    'Use um caminho relativo seguro para uma imagem JPG, PNG ou WebP.',
  )

const priceSchema = z
  .number()
  .finite()
  .nonnegative('O preço não pode ser negativo.')
  .multipleOf(0.01, 'O preço deve ter no máximo duas casas decimais.')

export const ingredientSchema = z
  .object({
    id: normalizedIdentifierSchema,
    name: nonEmptyTextSchema,
  })
  .strict()

export const productCategorySchema = z.enum(PRODUCT_CATEGORIES)
export const productSubcategorySchema = z.enum(PRODUCT_SUBCATEGORIES)
export const hairTypeSchema = z.enum(HAIR_TYPES)
export const scalpTypeSchema = z.enum(SCALP_TYPES)
export const productConcernSchema = z.enum(PRODUCT_CONCERNS)
export const restrictionCodeSchema = z.enum(RESTRICTION_CODES)

function normalizeForComparison(value: string) {
  return value
    .normalize('NFKD')
    .replace(/\p{Diacritic}/gu, '')
    .trim()
    .replace(/\s+/g, ' ')
    .toLocaleLowerCase('pt-BR')
}

function reportDuplicateStrings(
  values: readonly string[],
  ctx: z.RefinementCtx,
  field: string,
) {
  const seen = new Map<string, number>()

  values.forEach((value, index) => {
    const normalized = normalizeForComparison(value)
    const firstIndex = seen.get(normalized)

    if (firstIndex !== undefined) {
      ctx.addIssue({
        code: 'custom',
        path: [field, index],
        message: `Valor duplicado após normalização; primeira ocorrência no índice ${firstIndex}.`,
      })
      return
    }

    seen.set(normalized, index)
  })
}

function validateAllMarker(
  values: readonly string[],
  ctx: z.RefinementCtx,
  field: 'hairTypes' | 'scalpTypes',
) {
  if (values.includes('todos') && values.length > 1) {
    ctx.addIssue({
      code: 'custom',
      path: [field],
      message: 'O valor "todos" não pode ser combinado com tipos específicos.',
    })
  }
}

const productBaseSchema = z
  .object({
    id: z.number().int().positive(),
    slug: normalizedIdentifierSchema,
    name: nonEmptyTextSchema,
    category: productCategorySchema,
    subcategory: productSubcategorySchema,
    description: nonEmptyTextSchema,
    shortDescription: nonEmptyTextSchema,
    price: priceSchema,
    originalPrice: priceSchema.optional(),
    image: imageReferenceSchema,
    images: z.array(imageReferenceSchema).min(1).optional(),
    stock: z.number().int().nonnegative(),
    tags: z.array(normalizedIdentifierSchema).min(1),
    indications: z.array(nonEmptyTextSchema).min(1),
    hairTypes: z.array(hairTypeSchema).min(1),
    scalpTypes: z.array(scalpTypeSchema).min(1),
    concerns: z.array(productConcernSchema).min(1),
    benefits: z.array(nonEmptyTextSchema).min(1),
    ingredients: z.array(ingredientSchema).min(1),
    usage: nonEmptyTextSchema,
    restrictions: z.array(restrictionCodeSchema),
    warnings: z.array(nonEmptyTextSchema),
    contraindications: z.array(nonEmptyTextSchema),
    rating: z.number().min(0).max(5).multipleOf(0.1).optional(),
    reviews: z.number().int().nonnegative().optional(),
  })
  .strict()

export const productSchema = productBaseSchema.superRefine((product, ctx) => {
  if (
    !(SUBCATEGORIES_BY_CATEGORY[product.category] as readonly ProductSubcategory[])
      .includes(product.subcategory)
  ) {
    ctx.addIssue({
      code: 'custom',
      path: ['subcategory'],
      message: `A subcategoria não pertence à categoria ${product.category}.`,
    })
  }

  if (
    product.originalPrice !== undefined &&
    product.originalPrice <= product.price
  ) {
    ctx.addIssue({
      code: 'custom',
      path: ['originalPrice'],
      message: 'O preço original deve ser maior que o preço atual.',
    })
  }

  const { rating, reviews } = product
  const hasRating = rating !== undefined
  const hasReviews = reviews !== undefined

  if (hasRating !== hasReviews) {
    ctx.addIssue({
      code: 'custom',
      path: [hasRating ? 'reviews' : 'rating'],
      message: 'Rating e reviews devem ser informados em conjunto.',
    })
  } else if (rating !== undefined && reviews !== undefined) {
    if (reviews === 0 && rating !== 0) {
      ctx.addIssue({
        code: 'custom',
        path: ['rating'],
        message: 'Produtos sem reviews devem ter rating igual a zero.',
      })
    }

    if (reviews > 0 && rating === 0) {
      ctx.addIssue({
        code: 'custom',
        path: ['rating'],
        message: 'Produtos com reviews devem ter rating maior que zero.',
      })
    }
  }

  validateAllMarker(product.hairTypes, ctx, 'hairTypes')
  validateAllMarker(product.scalpTypes, ctx, 'scalpTypes')

  reportDuplicateStrings(product.tags, ctx, 'tags')
  reportDuplicateStrings(product.indications, ctx, 'indications')
  reportDuplicateStrings(product.hairTypes, ctx, 'hairTypes')
  reportDuplicateStrings(product.scalpTypes, ctx, 'scalpTypes')
  reportDuplicateStrings(product.concerns, ctx, 'concerns')
  reportDuplicateStrings(product.benefits, ctx, 'benefits')
  reportDuplicateStrings(product.restrictions, ctx, 'restrictions')
  reportDuplicateStrings(product.warnings, ctx, 'warnings')
  reportDuplicateStrings(product.contraindications, ctx, 'contraindications')

  reportDuplicateStrings(
    product.ingredients.map((ingredient) => ingredient.id),
    ctx,
    'ingredients',
  )

  reportDuplicateStrings(
    product.ingredients.map((ingredient) => ingredient.name),
    ctx,
    'ingredients',
  )

  const seenImages = new Map<string, string>([
    [normalizeForComparison(product.image), 'image'],
  ])

  product.images?.forEach((image, index) => {
    const normalized = normalizeForComparison(image)
    const firstPath = seenImages.get(normalized)

    if (firstPath !== undefined) {
      ctx.addIssue({
        code: 'custom',
        path: ['images', index],
        message: `Imagem duplicada; primeira ocorrência em ${firstPath}.`,
      })
      return
    }

    seenImages.set(normalized, `images.${index}`)
  })

  const scalpRestrictionConflicts = {
    'evitar-couro-cabeludo-sensivel': 'sensivel',
    'evitar-couro-cabeludo-seco': 'seco',
    'evitar-couro-cabeludo-oleoso': 'oleoso',
  } as const

  product.restrictions.forEach((restriction, index) => {
    const conflictingScalpType =
      scalpRestrictionConflicts[
        restriction as keyof typeof scalpRestrictionConflicts
      ]

    if (
      conflictingScalpType &&
      (product.scalpTypes.includes('todos') ||
        product.scalpTypes.includes(conflictingScalpType))
    ) {
      ctx.addIssue({
        code: 'custom',
        path: ['restrictions', index],
        message: 'A restrição contradiz os tipos de couro cabeludo compatíveis.',
      })
    }
  })
})

export const productCatalogSchema = z
  .array(productSchema)
  .min(1, 'O catálogo deve conter pelo menos um produto.')
  .superRefine((products, ctx) => {
    const ids = new Map<number, number>()
    const slugs = new Map<string, number>()

    products.forEach((product, index) => {
      const firstIdIndex = ids.get(product.id)
      if (firstIdIndex !== undefined) {
        ctx.addIssue({
          code: 'custom',
          path: [index, 'id'],
          message: `ID duplicado; primeira ocorrência no índice ${firstIdIndex}.`,
        })
      } else {
        ids.set(product.id, index)
      }

      const firstSlugIndex = slugs.get(product.slug)
      if (firstSlugIndex !== undefined) {
        ctx.addIssue({
          code: 'custom',
          path: [index, 'slug'],
          message: `Slug duplicado; primeira ocorrência no índice ${firstSlugIndex}.`,
        })
      } else {
        slugs.set(product.slug, index)
      }
    })
  })

export type Ingredient = z.infer<typeof ingredientSchema>
export type HairType = z.infer<typeof hairTypeSchema>
export type ScalpType = z.infer<typeof scalpTypeSchema>
export type ProductConcern = z.infer<typeof productConcernSchema>
export type RestrictionCode = z.infer<typeof restrictionCodeSchema>
export type Product = z.infer<typeof productSchema>
