import { Buffer } from 'node:buffer'

import { z } from 'zod'

import {
  SUBCATEGORIES_BY_CATEGORY,
  bodyConcernSchema,
  dataClassificationSchema,
  hairTypeSchema,
  normalizedIdentifierSchema,
  productCategorySchema,
  productConcernSchema,
  productSubcategorySchema,
  scalpTypeSchema,
  skinTypeSchema,
} from '../catalog/product-schema.js'
import { catalogImageUrlSchema } from './catalog.js'

export const CHAT_MAX_BODY_BYTES = 64 * 1_024
export const CHAT_MAX_MESSAGE_CHARACTERS = 4_000
export const CHAT_MAX_HISTORY_MESSAGES = 10
export const CHAT_MAX_CONVERSATION_BYTES = 32_000
export const CHAT_MAX_CART_ITEMS = 20
export const CHAT_MAX_ITEM_QUANTITY = 20
export const CHAT_MAX_AVOIDED_INGREDIENTS = 10
export const CHAT_MAX_SOURCES = 5
export const CHAT_MAX_RECOMMENDED_PRODUCT_REFERENCES = 2

const uniqueArray = <T extends z.ZodType>(schema: T, max: number) =>
  z
    .array(schema)
    .min(1)
    .max(max)
    .refine((values) => new Set(values).size === values.length, {
      message: 'Os valores não podem se repetir.',
    })

const messageContentSchema = z
  .string()
  .trim()
  .min(1)
  .max(CHAT_MAX_MESSAGE_CHARACTERS)

export const chatHistoryMessageSchema = z
  .object({
    role: z.enum(['user', 'assistant']),
    content: messageContentSchema,
  })
  .strict()

export const chatCartItemSchema = z
  .object({
    productId: z.number().int().positive(),
    quantity: z.number().int().min(1).max(CHAT_MAX_ITEM_QUANTITY),
  })
  .strict()

export const chatRecommendationContextSchema = z
  .object({
    productIds: z
      .array(z.number().int().positive())
      .min(1)
      .max(CHAT_MAX_RECOMMENDED_PRODUCT_REFERENCES)
      .refine((values) => new Set(values).size === values.length, {
        message: 'Os produtos recomendados não podem se repetir.',
      }),
  })
  .strict()

const avoidedIngredientSchema = z.string().trim().min(1).max(80)

export const chatPreferencesSchema = z
  .object({
    maxPrice: z.number().finite().nonnegative().max(100_000).optional(),
    category: productCategorySchema.optional(),
    subcategory: productSubcategorySchema.optional(),
    hairTypes: uniqueArray(hairTypeSchema, 5).optional(),
    scalpTypes: uniqueArray(scalpTypeSchema, 5).optional(),
    hairConcerns: uniqueArray(productConcernSchema, 10).optional(),
    skinTypes: uniqueArray(skinTypeSchema, 6).optional(),
    bodyConcerns: uniqueArray(bodyConcernSchema, 7).optional(),
    avoidIngredients: z
      .array(avoidedIngredientSchema)
      .min(1)
      .max(CHAT_MAX_AVOIDED_INGREDIENTS)
      .refine(
        (values) =>
          new Set(
            values.map((value) =>
              value
                .normalize('NFKD')
                .replace(/\p{Diacritic}/gu, '')
                .toLocaleLowerCase('pt-BR'),
            ),
          ).size === values.length,
        { message: 'Os ingredientes não podem se repetir.' },
      )
      .optional(),
  })
  .strict()
  .superRefine((preferences, context) => {
    if (
      preferences.category !== undefined &&
      preferences.subcategory !== undefined &&
      !(SUBCATEGORIES_BY_CATEGORY[preferences.category] as readonly string[]).includes(
        preferences.subcategory,
      )
    ) {
      context.addIssue({
        code: 'custom',
        path: ['subcategory'],
        message: 'A subcategoria não pertence à categoria informada.',
      })
    }
  })

export const chatRequestSchema = z
  .object({
    message: messageContentSchema,
    sessionId: z
      .string()
      .trim()
      .min(1)
      .max(128)
      .regex(/^[A-Za-z0-9_-]+$/)
      .optional(),
    history: z
      .array(chatHistoryMessageSchema)
      .max(CHAT_MAX_HISTORY_MESSAGES)
      .default([]),
    cart: z.array(chatCartItemSchema).max(CHAT_MAX_CART_ITEMS).default([]),
    recommendationContext: chatRecommendationContextSchema.optional(),
    preferences: chatPreferencesSchema.optional(),
  })
  .strict()
  .superRefine((request, context) => {
    const cartIds = request.cart.map((item) => item.productId)
    if (new Set(cartIds).size !== cartIds.length) {
      context.addIssue({
        code: 'custom',
        path: ['cart'],
        message: 'Cada produto deve aparecer uma única vez no carrinho.',
      })
    }

    for (let index = 1; index < request.history.length; index += 1) {
      if (request.history[index]?.role === request.history[index - 1]?.role) {
        context.addIssue({
          code: 'custom',
          path: ['history', index, 'role'],
          message: 'Os papéis do histórico devem alternar.',
        })
      }
    }
    if (
      request.history.length > 0 &&
      request.history.at(-1)?.role !== 'assistant'
    ) {
      context.addIssue({
        code: 'custom',
        path: ['history'],
        message: 'O histórico deve terminar antes da mensagem atual.',
      })
    }

    const conversationBytes = Buffer.byteLength(
      JSON.stringify({ history: request.history, message: request.message }),
      'utf8',
    )
    if (conversationBytes > CHAT_MAX_CONVERSATION_BYTES) {
      context.addIssue({
        code: 'custom',
        path: ['history'],
        message: 'O contexto conversacional excede o limite.',
      })
    }
  })

const sourceIdSchema = z.string().regex(/^faq-\d{3}$/)
const sourceIdsSchema = z
  .array(sourceIdSchema)
  .max(CHAT_MAX_SOURCES)
  .refine((values) => new Set(values).size === values.length)

const publishedDataClassificationSchema = dataClassificationSchema.extend({
  formulation: z.literal('synthetic-test-data'),
})

export const chatProductCardSchema = z
  .object({
    id: z.number().int().positive(),
    slug: normalizedIdentifierSchema,
    name: z.string().trim().min(1),
    brand: z.string().trim().min(1),
    isDemo: z.literal(true),
    category: productCategorySchema,
    subcategory: productSubcategorySchema,
    shortDescription: z.string().trim().min(1),
    price: z.number().finite().nonnegative(),
    originalPrice: z.number().finite().nonnegative().optional(),
    stock: z.number().int().positive(),
    imageUrl: catalogImageUrlSchema,
    dataClassification: publishedDataClassificationSchema,
  })
  .strict()

const responseBase = {
  message: z.string().trim().min(1).max(CHAT_MAX_MESSAGE_CHARACTERS),
  sourceIds: sourceIdsSchema,
  requestId: z.string().uuid(),
} as const

export const chatTextResponseSchema = z
  .object({
    ...responseBase,
    type: z.literal('text'),
    reason: z
      .enum(['clarification', 'not_found', 'unable_to_verify'])
      .optional(),
  })
  .strict()

export const chatRecommendationResponseSchema = z
  .object({
    ...responseBase,
    type: z.literal('recommendation'),
    productIds: z.tuple([z.number().int().positive()]),
    products: z.tuple([chatProductCardSchema]),
  })
  .strict()
  .superRefine((response, context) => {
    if (response.productIds[0] !== response.products[0].id) {
      context.addIssue({
        code: 'custom',
        path: ['productIds'],
        message: 'O ID deve corresponder ao cartão retornado.',
      })
    }
  })

export const chatComparisonResponseSchema = z
  .object({
    ...responseBase,
    type: z.literal('comparison'),
    productIds: z.tuple([
      z.number().int().positive(),
      z.number().int().positive(),
    ]),
    products: z.tuple([chatProductCardSchema, chatProductCardSchema]),
  })
  .strict()
  .superRefine((response, context) => {
    if (
      response.productIds[0] === response.productIds[1] ||
      response.productIds.some(
        (id, index) => id !== response.products[index]?.id,
      )
    ) {
      context.addIssue({
        code: 'custom',
        path: ['productIds'],
        message: 'A comparação exige dois cartões distintos e correspondentes.',
      })
    }
  })

export const chatResponseSchema = z.discriminatedUnion('type', [
  chatTextResponseSchema,
  chatRecommendationResponseSchema,
  chatComparisonResponseSchema,
])

export type ChatRequest = z.infer<typeof chatRequestSchema>
export type ChatPreferences = z.infer<typeof chatPreferencesSchema>
export type ChatProductCard = z.infer<typeof chatProductCardSchema>
export type ChatResponse = z.infer<typeof chatResponseSchema>
