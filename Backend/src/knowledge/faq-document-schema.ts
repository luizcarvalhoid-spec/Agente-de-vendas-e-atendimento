import { z } from 'zod'

export const faqCategories = [
  'frete',
  'pagamento',
  'trocas',
  'produtos',
  'pedidos',
  'privacidade',
] as const

export const faqCategorySchema = z.enum(faqCategories)

const sourceIdSchema = z
  .string()
  .regex(/^faq-\d{3}$/, 'O sourceId deve seguir o formato faq-NNN.')
const titleSchema = z
  .string()
  .trim()
  .min(10, 'O título deve conter uma pergunta clara.')
  .max(160, 'O título deve ter no máximo 160 caracteres.')
  .refine((title) => title.endsWith('?'), 'O título deve terminar com interrogação.')
const contentSchema = z
  .string()
  .trim()
  .min(40, 'A resposta deve conter pelo menos 40 caracteres.')
  .max(1_500, 'A resposta deve ter no máximo 1.500 caracteres.')
  .refine(
    (content) => /\b(?:demonstra(?:ção|tiv[oa]s?)|fictíci[oa]s?)\b/iu.test(content),
    'A resposta deve identificar explicitamente o caráter fictício ou demonstrativo.',
  )

export const faqDocumentMetadataSchema = z
  .object({
    sourceId: sourceIdSchema,
    category: faqCategorySchema,
    title: titleSchema,
    classification: z.literal('fictional-demo'),
  })
  .strict()

export const faqDocumentSchema = faqDocumentMetadataSchema
  .extend({ content: contentSchema })
  .strict()

export type FaqCategory = z.infer<typeof faqCategorySchema>
export type FaqDocument = z.infer<typeof faqDocumentSchema>
