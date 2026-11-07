import { z } from 'zod'

import {
  SUBCATEGORIES_BY_CATEGORY,
  applicationAreaSchema,
  dataClassificationSchema,
  netContentSchema,
  normalizedIdentifierSchema,
  productCategorySchema,
  productKindSchema,
  productSchema,
  productSubcategorySchema,
} from '../catalog/product-schema.js'

const searchSchema = z.preprocess(
  (value) =>
    typeof value === 'string' && value.trim() === '' ? undefined : value,
  z.string().trim().max(100).optional(),
)

const queryNumberSchema = z
  .union([
    z.number(),
    z
      .string()
      .trim()
      .regex(/^\d+(?:\.\d+)?$/)
      .transform(Number),
  ])
  .pipe(z.number().finite().nonnegative())

const queryIntegerSchema = z
  .union([
    z.number(),
    z
      .string()
      .trim()
      .regex(/^\d+$/)
      .transform(Number),
  ])
  .pipe(z.number().int().positive())

export const productListQuerySchema = z
  .object({
    q: searchSchema,
    category: productCategorySchema.optional(),
    subcategory: productSubcategorySchema.optional(),
    minPrice: queryNumberSchema.optional(),
    maxPrice: queryNumberSchema.optional(),
    page: queryIntegerSchema.default(1),
    pageSize: queryIntegerSchema.pipe(z.number().max(100)).default(12),
  })
  .strict()
  .superRefine((query, ctx) => {
    if (
      query.minPrice !== undefined &&
      query.maxPrice !== undefined &&
      query.minPrice > query.maxPrice
    ) {
      ctx.addIssue({
        code: 'custom',
        path: ['maxPrice'],
        message: 'O preço máximo deve ser maior ou igual ao preço mínimo.',
      })
    }

    if (
      query.category !== undefined &&
      query.subcategory !== undefined &&
      !(SUBCATEGORIES_BY_CATEGORY[query.category] as readonly string[]).includes(
        query.subcategory,
      )
    ) {
      ctx.addIssue({
        code: 'custom',
        path: ['subcategory'],
        message: 'A subcategoria não pertence à categoria informada.',
      })
    }
  })

export const productDetailParamsSchema = z
  .object({
    slug: normalizedIdentifierSchema,
  })
  .strict()

export const catalogImageParamsSchema = z
  .object({
    '*': z
      .string()
      .trim()
      .min(1)
      .max(255)
      .regex(
        /^(?:[a-zA-Z0-9][a-zA-Z0-9._-]*\/)*[a-zA-Z0-9][a-zA-Z0-9._-]*\.(?:jpe?g|png|webp)$/i,
      ),
  })
  .strict()

export const catalogImageUrlSchema = z
  .string()
  .regex(
    /^\/api\/catalog\/images\/(?:[a-zA-Z0-9][a-zA-Z0-9._-]*\/)*[a-zA-Z0-9][a-zA-Z0-9._-]*\.(?:jpe?g|png|webp)$/i,
  )

const publishedDataClassificationSchema = dataClassificationSchema.extend({
  formulation: z.literal('synthetic-test-data'),
})

export const catalogProductSummarySchema = z
  .object({
    id: z.number().int().positive(),
    slug: normalizedIdentifierSchema,
    name: z.string().trim().min(1),
    brand: z.string().trim().min(1),
    visibleLabelBrand: z.string().trim().min(1).optional(),
    isDemo: z.literal(true),
    category: productCategorySchema,
    subcategory: productSubcategorySchema,
    applicationArea: applicationAreaSchema,
    productKind: productKindSchema,
    shortDescription: z.string().trim().min(1),
    price: z.number().finite().nonnegative(),
    originalPrice: z.number().finite().nonnegative().optional(),
    stock: z.number().int().nonnegative(),
    netContent: netContentSchema.optional(),
    rating: z.number().min(0).max(5).optional(),
    reviews: z.number().int().nonnegative().optional(),
    imageUrl: catalogImageUrlSchema,
    dataClassification: publishedDataClassificationSchema,
  })
  .strict()

export const paginationMetadataSchema = z
  .object({
    page: z.number().int().positive(),
    pageSize: z.number().int().positive().max(100),
    totalItems: z.number().int().nonnegative(),
    totalPages: z.number().int().nonnegative(),
    hasPreviousPage: z.boolean(),
    hasNextPage: z.boolean(),
  })
  .strict()

export const productListResponseSchema = z
  .object({
    items: z.array(catalogProductSummarySchema),
    pagination: paginationMetadataSchema,
  })
  .strict()

export const productMediaSchema = z
  .object({
    primaryUrl: catalogImageUrlSchema,
    galleryUrls: z.array(catalogImageUrlSchema),
  })
  .strict()

export const productDetailResponseSchema = z
  .object({
    item: productSchema,
    media: productMediaSchema,
  })
  .strict()

export type ProductListQuery = z.infer<typeof productListQuerySchema>
export type CatalogProductSummary = z.infer<
  typeof catalogProductSummarySchema
>
export type ProductListResponse = z.infer<typeof productListResponseSchema>
export type ProductDetailResponse = z.infer<typeof productDetailResponseSchema>
