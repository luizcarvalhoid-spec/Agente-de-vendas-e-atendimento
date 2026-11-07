import { z } from 'zod'

export const PRODUCT_CATEGORIES = [
  'shampoos',
  'condicionadores',
  'mascaras',
  'finalizadores',
  'sabonetes',
  'oleos-corporais',
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
  'kit',
  'barra',
  'liquido',
  'relaxamento',
  'revitalizacao',
] as const

export const APPLICATION_AREAS = ['hair', 'body'] as const
export const PRODUCT_KINDS = ['single', 'kit'] as const
export const CONTENT_UNITS = ['ml', 'g'] as const
export const SOAP_FORMS = ['bar', 'liquid'] as const
export const FORMULATION_DATA_SOURCES = [
  'not-provided',
  'synthetic-test-data',
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

export const SKIN_TYPES = [
  'todos',
  'normal',
  'seca',
  'oleosa',
  'mista',
  'sensivel',
] as const

export const BODY_CONCERNS = [
  'ressecamento',
  'sensibilidade',
  'aspereza',
  'limpeza-suave',
  'nutricao',
  'relaxamento',
  'revitalizacao',
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
    'kit',
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
  sabonetes: ['barra', 'liquido'],
  'oleos-corporais': [
    'hidratacao',
    'nutricao',
    'relaxamento',
    'revitalizacao',
  ],
} as const satisfies Record<
  ProductCategory,
  readonly ProductSubcategory[]
>

const CATEGORY_APPLICATION_AREA = {
  shampoos: 'hair',
  condicionadores: 'hair',
  mascaras: 'hair',
  finalizadores: 'hair',
  sabonetes: 'body',
  'oleos-corporais': 'body',
} as const satisfies Record<ProductCategory, (typeof APPLICATION_AREAS)[number]>

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

export const dataClassificationSchema = z
  .object({
    commercial: z.literal('fictional-demo'),
    compatibility: z.literal('commercial-positioning'),
    formulation: z.enum(FORMULATION_DATA_SOURCES),
    safety: z.literal('not-evaluated'),
  })
  .strict()

const publishedDataClassificationSchema = dataClassificationSchema.extend({
  formulation: z.literal('synthetic-test-data'),
})

export const netContentSchema = z
  .object({
    value: z.number().finite().positive(),
    unit: z.enum(CONTENT_UNITS),
  })
  .strict()

export const commercialVariantSchema = z
  .object({
    name: nonEmptyTextSchema,
    profile: normalizedIdentifierSchema.optional(),
    sensoryNotes: z.array(nonEmptyTextSchema).min(1).optional(),
  })
  .strict()

export const syntheticFormulationSchema = z
  .object({
    basis: z.literal('synthetic-test-data'),
    ingredients: z.array(ingredientSchema).min(1),
    usage: nonEmptyTextSchema,
    restrictions: z.array(z.enum(RESTRICTION_CODES)),
    warnings: z.array(nonEmptyTextSchema).min(1),
    contraindications: z.array(nonEmptyTextSchema),
  })
  .strict()

export const kitContentSchema = z
  .object({
    name: nonEmptyTextSchema,
    quantity: z.number().int().positive(),
    netContent: netContentSchema.optional(),
    formulation: syntheticFormulationSchema.optional(),
  })
  .strict()

export const productCategorySchema = z.enum(PRODUCT_CATEGORIES)
export const productSubcategorySchema = z.enum(PRODUCT_SUBCATEGORIES)
export const applicationAreaSchema = z.enum(APPLICATION_AREAS)
export const productKindSchema = z.enum(PRODUCT_KINDS)
export const hairTypeSchema = z.enum(HAIR_TYPES)
export const scalpTypeSchema = z.enum(SCALP_TYPES)
export const productConcernSchema = z.enum(PRODUCT_CONCERNS)
export const skinTypeSchema = z.enum(SKIN_TYPES)
export const bodyConcernSchema = z.enum(BODY_CONCERNS)
export const restrictionCodeSchema = z.enum(RESTRICTION_CODES)

const commercialFields = {
  id: z.number().int().positive(),
  slug: normalizedIdentifierSchema,
  name: nonEmptyTextSchema,
  brand: nonEmptyTextSchema,
  visibleLabelBrand: nonEmptyTextSchema.optional(),
  isDemo: z.literal(true),
  dataClassification: dataClassificationSchema,
  category: productCategorySchema,
  subcategory: productSubcategorySchema,
  applicationArea: applicationAreaSchema,
  productKind: productKindSchema,
  description: nonEmptyTextSchema,
  shortDescription: nonEmptyTextSchema,
  price: priceSchema,
  originalPrice: priceSchema.optional(),
  image: imageReferenceSchema,
  images: z.array(imageReferenceSchema).min(1).optional(),
  stock: z.number().int().nonnegative(),
  netContent: netContentSchema.optional(),
  variant: commercialVariantSchema,
  kitContents: z.array(kitContentSchema).min(1).optional(),
  soapForm: z.enum(SOAP_FORMS).optional(),
  tags: z.array(normalizedIdentifierSchema).min(1),
  indications: z.array(nonEmptyTextSchema).min(1),
  benefits: z.array(nonEmptyTextSchema).min(1),
  rating: z.number().min(0).max(5).multipleOf(0.1).optional(),
  reviews: z.number().int().nonnegative().optional(),
} as const

const publicationFields = {
  ingredients: z.array(ingredientSchema).min(1).optional(),
  usage: nonEmptyTextSchema.optional(),
  restrictions: z.array(restrictionCodeSchema).optional(),
  warnings: z.array(nonEmptyTextSchema).min(1).optional(),
  contraindications: z.array(nonEmptyTextSchema).optional(),
} as const

const hairCompatibilityFields = {
  hairTypes: z.array(hairTypeSchema).min(1),
  scalpTypes: z.array(scalpTypeSchema).min(1),
  concerns: z.array(productConcernSchema).min(1),
} as const

const bodyCompatibilityFields = {
  skinTypes: z.array(skinTypeSchema).min(1),
  bodyConcerns: z.array(bodyConcernSchema).min(1),
} as const

const rawCommercialProductSchema = z.discriminatedUnion('applicationArea', [
  z
    .object({
      ...commercialFields,
      applicationArea: z.literal('hair'),
      ...hairCompatibilityFields,
    })
    .strict(),
  z
    .object({
      ...commercialFields,
      applicationArea: z.literal('body'),
      ...bodyCompatibilityFields,
    })
    .strict(),
])

const rawProductSchema = z.discriminatedUnion('applicationArea', [
  z
    .object({
      ...commercialFields,
      applicationArea: z.literal('hair'),
      dataClassification: publishedDataClassificationSchema,
      ...hairCompatibilityFields,
      ...publicationFields,
    })
    .strict(),
  z
    .object({
      ...commercialFields,
      applicationArea: z.literal('body'),
      dataClassification: publishedDataClassificationSchema,
      ...bodyCompatibilityFields,
      ...publicationFields,
    })
    .strict(),
])

type ProductCandidate =
  | z.infer<typeof rawCommercialProductSchema>
  | z.infer<typeof rawProductSchema>

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
  field: string,
) {
  if (values.includes('todos') && values.length > 1) {
    ctx.addIssue({
      code: 'custom',
      path: [field],
      message: 'O valor "todos" não pode ser combinado com tipos específicos.',
    })
  }
}

function validateProduct(product: ProductCandidate, ctx: z.RefinementCtx) {
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

  if (CATEGORY_APPLICATION_AREA[product.category] !== product.applicationArea) {
    ctx.addIssue({
      code: 'custom',
      path: ['applicationArea'],
      message: `A área de aplicação não corresponde à categoria ${product.category}.`,
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

  const publication = product as ProductCandidate & {
    ingredients?: Array<z.infer<typeof ingredientSchema>>
    usage?: string
    restrictions?: Array<z.infer<typeof restrictionCodeSchema>>
    warnings?: string[]
    contraindications?: string[]
  }
  const topLevelFormulationFields = [
    publication.ingredients,
    publication.usage,
    publication.restrictions,
    publication.warnings,
    publication.contraindications,
  ]
  const hasTopLevelFormulation = topLevelFormulationFields.some(
    (value) => value !== undefined,
  )

  if (product.dataClassification.formulation === 'not-provided') {
    if (hasTopLevelFormulation) {
      ctx.addIssue({
        code: 'custom',
        path: ['dataClassification', 'formulation'],
        message:
          'Registros sem formulação não podem declarar ingredientes ou informações de uso e segurança.',
      })
    }

    product.kitContents?.forEach((content, index) => {
      if (content.formulation !== undefined) {
        ctx.addIssue({
          code: 'custom',
          path: ['kitContents', index, 'formulation'],
          message:
            'Componentes não podem declarar formulação quando a origem está marcada como not-provided.',
        })
      }
    })
  } else if (product.productKind === 'single') {
    const requiredFields = [
      ['ingredients', publication.ingredients],
      ['usage', publication.usage],
      ['restrictions', publication.restrictions],
      ['warnings', publication.warnings],
      ['contraindications', publication.contraindications],
    ] as const

    requiredFields.forEach(([field, value]) => {
      if (value === undefined) {
        ctx.addIssue({
          code: 'custom',
          path: [field],
          message:
            'Formulações sintéticas devem fornecer todos os campos estruturados.',
        })
      }
    })
  } else {
    if (hasTopLevelFormulation) {
      ctx.addIssue({
        code: 'custom',
        path: ['ingredients'],
        message:
          'Kits não podem agregar ingredientes ou segurança em uma formulação única.',
      })
    }

    product.kitContents?.forEach((content, index) => {
      if (content.formulation === undefined) {
        ctx.addIssue({
          code: 'custom',
          path: ['kitContents', index, 'formulation'],
          message:
            'Cada componente do kit deve possuir formulação sintética independente.',
        })
      }
    })
  }

  if (product.productKind === 'kit') {
    if (product.subcategory !== 'kit') {
      ctx.addIssue({
        code: 'custom',
        path: ['subcategory'],
        message: 'Produtos do tipo kit devem usar a subcategoria kit.',
      })
    }

    if (!product.kitContents) {
      ctx.addIssue({
        code: 'custom',
        path: ['kitContents'],
        message: 'Um kit deve listar seus componentes comerciais.',
      })
    }
  } else {
    if (product.subcategory === 'kit') {
      ctx.addIssue({
        code: 'custom',
        path: ['productKind'],
        message: 'A subcategoria kit exige productKind igual a kit.',
      })
    }

    if (product.kitContents !== undefined) {
      ctx.addIssue({
        code: 'custom',
        path: ['kitContents'],
        message: 'Produtos individuais não podem declarar componentes de kit.',
      })
    }
  }

  if (product.category === 'sabonetes' && product.soapForm === undefined) {
    ctx.addIssue({
      code: 'custom',
      path: ['soapForm'],
      message: 'Sabonetes devem informar se a apresentação é em barra ou líquida.',
    })
  }

  if (product.category !== 'sabonetes' && product.soapForm !== undefined) {
    ctx.addIssue({
      code: 'custom',
      path: ['soapForm'],
      message: 'A forma de sabonete só pode ser usada na categoria sabonetes.',
    })
  }

  reportDuplicateStrings(product.tags, ctx, 'tags')
  reportDuplicateStrings(product.indications, ctx, 'indications')
  reportDuplicateStrings(product.benefits, ctx, 'benefits')
  reportDuplicateStrings(
    product.variant.sensoryNotes ?? [],
    ctx,
    'variant.sensoryNotes',
  )
  reportDuplicateStrings(
    product.kitContents?.map((content) => content.name) ?? [],
    ctx,
    'kitContents',
  )

  if (product.applicationArea === 'hair') {
    validateAllMarker(product.hairTypes, ctx, 'hairTypes')
    validateAllMarker(product.scalpTypes, ctx, 'scalpTypes')
    reportDuplicateStrings(product.hairTypes, ctx, 'hairTypes')
    reportDuplicateStrings(product.scalpTypes, ctx, 'scalpTypes')
    reportDuplicateStrings(product.concerns, ctx, 'concerns')
  } else {
    validateAllMarker(product.skinTypes, ctx, 'skinTypes')
    reportDuplicateStrings(product.skinTypes, ctx, 'skinTypes')
    reportDuplicateStrings(product.bodyConcerns, ctx, 'bodyConcerns')
  }

  if (publication.ingredients !== undefined) {
    reportDuplicateStrings(
      publication.ingredients.map((ingredient) => ingredient.id),
      ctx,
      'ingredients',
    )
    reportDuplicateStrings(
      publication.ingredients.map((ingredient) => ingredient.name),
      ctx,
      'ingredients',
    )
  }

  reportDuplicateStrings(publication.restrictions ?? [], ctx, 'restrictions')
  reportDuplicateStrings(publication.warnings ?? [], ctx, 'warnings')
  reportDuplicateStrings(
    publication.contraindications ?? [],
    ctx,
    'contraindications',
  )

  product.kitContents?.forEach((content, index) => {
    const formulation = content.formulation
    if (!formulation) return

    reportDuplicateStrings(
      formulation.ingredients.map((ingredient) => ingredient.id),
      ctx,
      `kitContents.${index}.formulation.ingredients`,
    )
    reportDuplicateStrings(
      formulation.ingredients.map((ingredient) => ingredient.name),
      ctx,
      `kitContents.${index}.formulation.ingredients`,
    )
    reportDuplicateStrings(
      formulation.restrictions,
      ctx,
      `kitContents.${index}.formulation.restrictions`,
    )
    reportDuplicateStrings(
      formulation.warnings,
      ctx,
      `kitContents.${index}.formulation.warnings`,
    )
    reportDuplicateStrings(
      formulation.contraindications,
      ctx,
      `kitContents.${index}.formulation.contraindications`,
    )
  })

  if (
    publication.restrictions !== undefined &&
    product.applicationArea === 'hair'
  ) {
    const scalpRestrictionConflicts = {
      'evitar-couro-cabeludo-sensivel': 'sensivel',
      'evitar-couro-cabeludo-seco': 'seco',
      'evitar-couro-cabeludo-oleoso': 'oleoso',
    } as const

    publication.restrictions.forEach((restriction, index) => {
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
          message:
            'A restrição contradiz os tipos de couro cabeludo compatíveis.',
        })
      }
    })
  }

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
}

function validateCatalogUniqueness(
  products: readonly { id: number; slug: string; image: string }[],
  ctx: z.RefinementCtx,
) {
  const ids = new Map<number, number>()
  const slugs = new Map<string, number>()
  const images = new Map<string, number>()

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

    const normalizedImage = normalizeForComparison(product.image)
    const firstImageIndex = images.get(normalizedImage)
    if (firstImageIndex !== undefined) {
      ctx.addIssue({
        code: 'custom',
        path: [index, 'image'],
        message: `Imagem principal duplicada; primeira ocorrência no índice ${firstImageIndex}.`,
      })
    } else {
      images.set(normalizedImage, index)
    }
  })
}

export const commercialProductSchema = rawCommercialProductSchema.superRefine(
  validateProduct,
)

export const productSchema = rawProductSchema.superRefine(validateProduct)

export const commercialProductCatalogSchema = z
  .array(commercialProductSchema)
  .min(1, 'O catálogo comercial deve conter pelo menos um produto.')
  .superRefine(validateCatalogUniqueness)

export const productCatalogSchema = z
  .array(productSchema)
  .min(1, 'O catálogo deve conter pelo menos um produto.')
  .superRefine(validateCatalogUniqueness)

export type Ingredient = z.infer<typeof ingredientSchema>
export type HairType = z.infer<typeof hairTypeSchema>
export type ScalpType = z.infer<typeof scalpTypeSchema>
export type ProductConcern = z.infer<typeof productConcernSchema>
export type SkinType = z.infer<typeof skinTypeSchema>
export type BodyConcern = z.infer<typeof bodyConcernSchema>
export type RestrictionCode = z.infer<typeof restrictionCodeSchema>
export type CommercialProduct = z.infer<typeof commercialProductSchema>
export type Product = z.infer<typeof productSchema>
