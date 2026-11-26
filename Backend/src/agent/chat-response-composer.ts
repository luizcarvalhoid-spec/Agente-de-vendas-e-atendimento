import { createHash } from 'node:crypto'
import { z } from 'zod'

import type { Product } from '../catalog/product-schema.js'
import {
  calculateCommercialTotals,
  priceToCents,
  type CommercialShippingRules,
} from '../commercial/demo-commercial-rules.js'
import { CHAT_MAX_SOURCES } from '../contracts/chat.js'
import type { FaqDocument } from '../knowledge/faq-document-schema.js'
import type { ConsultativeAgentProfile } from './consultative-agent-policy.js'
import type { SearchProductsInput } from './tools/product-tools.js'

export interface CommercialPresentationContext {
  readonly searchInput: SearchProductsInput
  readonly sensoryTerms: readonly string[]
}

export interface FaqComposition {
  readonly message: string
  readonly sourceIds: readonly string[]
  readonly status: 'complete' | 'partial' | 'unable_to_verify'
}

const faqSourceIdSchema = z.string().regex(/^faq-\d{3}$/)

const pricingFaqReferenceSchema = z.strictObject({
  sourceId: faqSourceIdSchema,
  // Legacy articles may display amounts, but their expected values come from the rules.
  contentTemplate: z.string().min(40).max(1_500).refine(
    (value) => !/R\$\s*\d/.test(value),
  ),
})

const shippingProfileSchema = z.strictObject({
  rules: z.strictObject({
    standardShippingCents: z.int().positive(),
    freeShippingThresholdCents: z.int().positive(),
    freeShippingComparison: z.enum(['above', 'at_or_above']),
  }),
  freeShippingFaq: pricingFaqReferenceSchema,
  standardShippingFaq: pricingFaqReferenceSchema,
})

const reviewedFaqsSchema = z.record(faqSourceIdSchema, z.string().regex(/^[a-f0-9]{64}$/))
const commercialEvidenceSchema = z.strictObject({
  shipping: shippingProfileSchema.optional(),
  reviewedFaqs: reviewedFaqsSchema.default({}),
}).refine(({ shipping, reviewedFaqs }) => {
  if (!shipping) return true
  const freeId = shipping.freeShippingFaq.sourceId
  const standardId = shipping.standardShippingFaq.sourceId
  return freeId !== standardId && !reviewedFaqs[freeId] && !reviewedFaqs[standardId]
})

// Trusted backend configuration. FAQ results can supply evidence, never these rules.
export interface StoreResponseProfile extends ConsultativeAgentProfile {
  readonly shipping?: z.input<typeof shippingProfileSchema>
  readonly reviewedFaqs?: Readonly<z.input<typeof reviewedFaqsSchema>>
  readonly presentation?: {
    readonly shippingLabel?: string
    readonly shippingNotice?: string
    readonly quoteNotice?: string
    readonly comparisonNotice?: string
    readonly describeProduct?: (product: Product) => string | undefined
    readonly recommendationReasons?: (
      product: Product,
      context: CommercialPresentationContext,
    ) => { readonly primary: readonly string[]; readonly secondary: readonly string[] }
    readonly presentFaq?: (document: FaqDocument) => string
    readonly clinicalBoundary?: (
      question: string,
      previousUserMessages: readonly string[],
    ) => string | undefined
    readonly describeIngredients?: (product: Product) => string
  }
}

function normalize(value: string) {
  return value
    .normalize('NFKD')
    .replace(/\p{Diacritic}/gu, '')
    .toLocaleLowerCase('pt-BR')
    .replace(/\s+/g, ' ')
    .trim()
}

export function formatCommercialCents(cents: number) {
  return `R$ ${Math.floor(cents / 100)},${String(cents % 100).padStart(2, '0')}`
}

function expectedPricingContent(
  reference: z.infer<typeof pricingFaqReferenceSchema>,
  rules: CommercialShippingRules,
) {
  const inclusive = rules.freeShippingComparison === 'at_or_above'
  return reference.contentTemplate
    .replaceAll('{threshold}', formatCommercialCents(rules.freeShippingThresholdCents))
    .replaceAll('{fee}', formatCommercialCents(rules.standardShippingCents))
    .replaceAll('{freeComparison}', inclusive ? 'maior ou igual a' : 'maior que')
    .replaceAll('{standardComparison}', inclusive ? 'abaixo de' : 'de até')
    .replaceAll('{atThreshold}', inclusive ? 'recebe' : 'não recebe')
}

function pricingEvidenceStatus(
  documents: ReadonlyMap<string, FaqDocument | null>,
  reference: z.infer<typeof pricingFaqReferenceSchema>,
  rules: CommercialShippingRules,
) {
  const document = documents.get(reference.sourceId)
  if (document === undefined) return 'missing'
  return (
    document !== null &&
    document.sourceId === reference.sourceId &&
    document.category === 'frete' &&
    document.classification === 'fictional-demo' &&
    document.content === expectedPricingContent(reference, rules)
  ) ? 'verified' : 'conflicting'
}

function joinNatural(parts: readonly string[]) {
  if (parts.length <= 1) return parts[0] ?? ''
  return `${parts.slice(0, -1).join(', ')} e ${parts.at(-1)}`
}

function shippingStatements(rules: CommercialShippingRules, shippingLabel: string) {
  const threshold = formatCommercialCents(rules.freeShippingThresholdCents)
  const fee = formatCommercialCents(rules.standardShippingCents)
  const inclusive = rules.freeShippingComparison === 'at_or_above'
  return {
    standard: `Para subtotais ${inclusive ? 'abaixo de' : 'de até'} ${threshold}, aplica-se o frete padrão de ${fee}.`,
    free: inclusive
      ? `A partir de ${threshold}, o ${shippingLabel} é grátis.`
      : `Acima de ${threshold}, o ${shippingLabel} é grátis. Um subtotal de ${threshold} exatos não recebe frete grátis. Nesse valor, aplica-se o frete padrão.`,
  }
}

const shippingTopic = /\b(?:frete|entreg\w*|envios?)\b/
const freeShippingQuestion = /\b(?:gratis|gratuit\w*|limite|subtotal)\b/
const shippingFeeQuestion = /\b(?:taxa|valor|preco|cust\w*|quanto fica)\b/
const unverifiedShipping = 'Não consegui verificar a política de frete com as fontes disponíveis.'
const unverifiedFaq = 'Não consegui verificar a política solicitada nas fontes disponíveis.'

export function createChatResponseComposer(
  profile: StoreResponseProfile,
  documents: readonly FaqDocument[],
) {
  const faqDocuments = new Map<string, FaqDocument | null>()
  for (const document of documents) {
    const { sourceId } = document
    // Keep a conflicting entry even if the same ID appears again.
    faqDocuments.set(sourceId, faqDocuments.has(sourceId) ? null : document)
  }

  const { storeName, presentation } = profile
  const evidence = commercialEvidenceSchema.safeParse({
    shipping: profile.shipping,
    reviewedFaqs: profile.reviewedFaqs,
  })
  const pricing = evidence.data?.shipping
  const shippingLabel = presentation?.shippingLabel ?? 'frete'
  const freeEvidence = pricing && pricingEvidenceStatus(
    faqDocuments, pricing.freeShippingFaq, pricing.rules,
  )
  const standardEvidence = pricing && pricingEvidenceStatus(
    faqDocuments, pricing.standardShippingFaq, pricing.rules,
  )
  const pricingConflict = freeEvidence === 'conflicting' || standardEvidence === 'conflicting'
  const reviewedFaqs = new Map<string, { category: FaqDocument['category']; answer: string }>()
  for (const [sourceId, digest] of Object.entries(evidence.data?.reviewedFaqs ?? {})) {
    const document = faqDocuments.get(sourceId)
    if (
      document?.sourceId === sourceId &&
      document.classification === 'fictional-demo' &&
      createHash('sha256').update(document.content).digest('hex') === digest
    ) {
      reviewedFaqs.set(sourceId, {
        category: document.category,
        answer: presentation?.presentFaq?.(document) ?? document.content,
      })
    }
  }

  return {
    recommendation(product: Product, context: CommercialPresentationContext, faqAnswer: string) {
      const reasons = presentation?.recommendationReasons?.(product, context)
      const primary = [...(reasons?.primary ?? [])]
      const price = priceToCents(product.price)
      const budget = context.searchInput.maxPrice
      const budgetCents = budget === undefined ? undefined : priceToCents(budget)
      if (price !== undefined && budgetCents !== undefined && price <= budgetCents) {
        primary.push(
          `custa ${formatCommercialCents(price)}, dentro do limite de ${formatCommercialCents(budgetCents)}`,
        )
      }
      const explanation = joinNatural([...primary, ...(reasons?.secondary ?? [])].slice(0, 3))
      const description = presentation?.describeProduct?.(product)
      const detail = explanation
        ? ` Essa opção ${explanation}.`
        : description ? ` A opção tem ${description}.` : ''
      return `Pelo que você me contou, eu escolheria ${product.name}.${detail} Os detalhes de preço e estoque estão no cartão.${faqAnswer ? `\n\n${faqAnswer}` : ''}`
    },

    comparison(products: readonly [Product, Product], faqAnswer: string) {
      const details = products.map((product) => {
        const description = presentation?.describeProduct?.(product)
        const price = priceToCents(product.price)
        const priceText = price === undefined ? 'está no catálogo' : `custa ${formatCommercialCents(price)}`
        return `${product.name} ${priceText}${description ? ` e tem ${description}` : ''}.`
      })
      const notice = presentation?.comparisonNotice
      return `Veja as duas opções: ${details.join(' ')}${notice ? ` ${notice}` : ''} Os dados completos estão nos cartões.${faqAnswer ? `\n\n${faqAnswer}` : ''}`
    },

    faq(question: string, retrievedSourceIds: readonly string[]): FaqComposition {
      const selected = new Set(retrievedSourceIds)
      const freeId = pricing?.freeShippingFaq.sourceId
      const standardId = pricing?.standardShippingFaq.sourceId
      const sourceIds: string[] = []
      const articleAnswers: string[] = []
      const seen = new Set<string>()
      let hasFulfillment = false
      let rejectedArticle = false

      for (const sourceId of selected) {
        if (sourceIds.length === CHAT_MAX_SOURCES) break
        if (sourceId === freeId || sourceId === standardId) {
          const status = sourceId === freeId ? freeEvidence : standardEvidence
          if (!pricingConflict && status === 'verified') sourceIds.push(sourceId)
          continue
        }

        const article = reviewedFaqs.get(sourceId)
        if (!article?.answer.trim()) {
          rejectedArticle = true
          continue
        }
        const previousLength = articleAnswers.length
        for (const part of article.answer.split(/(?<=[.!?])\s+/)) {
          const sentence = part.trim()
          const key = normalize(sentence)
          if (!key || seen.has(key)) continue
          seen.add(key)
          articleAnswers.push(sentence)
        }
        if (articleAnswers.length > previousLength) {
          sourceIds.push(sourceId)
          if (article.category === 'frete') hasFulfillment = true
        }
      }

      const includeFree = freeId !== undefined && sourceIds.includes(freeId)
      const includeStandard = standardId !== undefined && sourceIds.includes(standardId)
      const normalizedQuestion = normalize(question)
      const asksShipping = shippingTopic.test(normalizedQuestion)
      const output: string[] = []

      if (pricing && (includeFree || includeStandard)) {
        const statements = shippingStatements(pricing.rules, shippingLabel)
        if (includeStandard) output.push(statements.standard)
        if (includeFree) output.push(statements.free)
        const notice = presentation?.shippingNotice
        if (!hasFulfillment && notice) output.push(notice)
      }
      const shippingGap =
        (freeId !== undefined && selected.has(freeId) && !includeFree) ||
        (standardId !== undefined && selected.has(standardId) && !includeStandard) ||
        (asksShipping && (
          (!includeFree && freeShippingQuestion.test(normalizedQuestion)) ||
          (!includeStandard && shippingFeeQuestion.test(normalizedQuestion)) ||
          (!includeFree && !includeStandard && !hasFulfillment)
        ))
      output.push(...articleAnswers)
      if (sourceIds.length === 0) {
        return {
          message: shippingGap ? unverifiedShipping : unverifiedFaq,
          sourceIds,
          status: 'unable_to_verify',
        }
      }
      if (shippingGap && rejectedArticle) {
        output.push('Não consegui verificar a política de frete nem todas as demais condições nas fontes disponíveis.')
      } else if (shippingGap) {
        output.push(unverifiedShipping)
      } else if (rejectedArticle) {
        output.push('Não consegui verificar todas as condições solicitadas nas fontes disponíveis.')
      }
      return {
        message: output.join(' '),
        sourceIds,
        status: shippingGap || rejectedArticle ? 'partial' : 'complete',
      }
    },

    quote(product: Pick<Product, 'name' | 'price'>) {
      if (!pricing || pricingConflict || freeEvidence !== 'verified') return undefined
      const unitPriceCents = priceToCents(product.price)
      if (unitPriceCents === undefined) return undefined
      let shippingCents: number
      let totalCents: number
      try {
        ({ shippingCents, totalCents } = calculateCommercialTotals(
          [{ unitPriceCents, quantity: 1 }],
          pricing.rules,
        ))
      } catch {
        return undefined
      }
      if (shippingCents > 0 && standardEvidence !== 'verified') return undefined
      const sourceIds = shippingCents === 0
        ? [pricing.freeShippingFaq.sourceId]
        : [pricing.freeShippingFaq.sourceId, pricing.standardShippingFaq.sourceId]
      const shippingText = shippingCents === 0 ? 'grátis' : `de ${formatCommercialCents(shippingCents)}`
      const notice = presentation?.quoteNotice ??
        'Esta cotação não efetuou compra nem adicionou o produto ao carrinho.'
      return {
        sourceIds,
        message: `Claro! ${product.name} custa ${formatCommercialCents(unitPriceCents)} no catálogo atual de ${storeName}. Para uma unidade, o ${shippingLabel} seria ${shippingText}, então o total ficaria em ${formatCommercialCents(totalCents)}. ${notice}`,
      }
    },
  }
}
