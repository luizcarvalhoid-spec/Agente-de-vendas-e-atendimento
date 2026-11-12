import type { Product } from '../catalog/product-schema.js'
import type { FaqDocument } from '../knowledge/faq-document-schema.js'
import type { SearchProductsInput } from './tools/product-tools.js'

export interface CommercialPresentationContext {
  readonly searchInput: SearchProductsInput
  readonly sensoryTerms: readonly string[]
}

interface FaqCompositionInput {
  readonly question: string
  readonly sourceIds: readonly string[]
  readonly faqDocuments: ReadonlyMap<string, FaqDocument>
}

function normalize(value: string) {
  return value
    .normalize('NFKD')
    .replace(/\p{Diacritic}/gu, '')
    .toLocaleLowerCase('pt-BR')
    .replace(/\s+/g, ' ')
    .trim()
}

function formatCurrency(value: number) {
  return `R$ ${value.toFixed(2).replace('.', ',')}`
}

function joinNatural(parts: readonly string[]) {
  if (parts.length <= 1) return parts[0] ?? ''
  return `${parts.slice(0, -1).join(', ')} e ${parts.at(-1)}`
}

const scalpLabels = {
  oleoso: 'couro cabeludo com tendência à oleosidade',
  seco: 'couro cabeludo com tendência ao ressecamento',
  normal: 'couro cabeludo de perfil normal',
  sensivel: 'couro cabeludo de perfil sensível',
  todos: 'diferentes perfis de couro cabeludo',
} as const

const concernLabels = {
  caspa: 'o objetivo anticaspa',
  descamacao: 'o cuidado com descamação',
  oleosidade: 'o controle de oleosidade',
  ressecamento: 'o cuidado com ressecamento',
  sensibilidade: 'o cuidado com sensibilidade',
  'queda-e-quebra': 'o cuidado com queda e quebra',
  frizz: 'o cuidado com frizz',
  danos: 'o cuidado com danos',
  'falta-de-brilho': 'a busca por brilho',
  'definicao-de-cachos': 'a busca por definição de cachos',
  'acumulo-de-residuos': 'o cuidado com acúmulo de resíduos',
} as const

function canonicalProductText(product: Product) {
  return normalize(
    [
      product.name,
      product.description,
      product.shortDescription,
      product.variant.name,
      product.variant.profile,
      ...(product.variant.sensoryNotes ?? []),
      ...product.tags,
      ...product.indications,
      ...product.benefits,
    ].join(' '),
  )
}

const sensoryEvidence = [
  {
    requested: /\b(?:frescor|refrescante)\b/,
    canonical: /\bfresc/,
    label: 'a preferência por frescor',
  },
  {
    requested: /\bcitrico\b/,
    canonical: /\bcitric/,
    label: 'a preferência por um perfil cítrico',
  },
  {
    requested: /\bherbal\b/,
    canonical: /\bherbal\b/,
    label: 'a preferência por um perfil herbal',
  },
  {
    requested: /\bsuave\b/,
    canonical: /\bsuav/,
    label: 'a preferência por uma experiência suave',
  },
  {
    requested: /\bintenso\b/,
    canonical: /\bintens/,
    label: 'a preferência por uma experiência intensa',
  },
  {
    requested: /\bhortela\b/,
    canonical: /\bhortela\b/,
    label: 'a preferência por hortelã',
  },
  {
    requested: /\blimao\b/,
    canonical: /\blimao\b/,
    label: 'a preferência por limão',
  },
] as const

function recommendationReasons(
  product: Product,
  context: CommercialPresentationContext,
) {
  const reasons: string[] = []
  const input = context.searchInput
  let concernReason: string | undefined

  if (product.applicationArea === 'hair') {
    const matchedScalp = input.scalpTypes?.find(
      (type) =>
        product.scalpTypes.includes(type) || product.scalpTypes.includes('todos'),
    )
    if (matchedScalp) {
      reasons.push(
        `tem posicionamento comercial para ${scalpLabels[matchedScalp]}`,
      )
    }

    const matchedConcern = input.hairConcerns?.find((concern) =>
      product.concerns.includes(concern),
    )
    if (matchedConcern) {
      concernReason = `está alinhado com ${concernLabels[matchedConcern]}`
    }
  }

  const requestedSensory = normalize(context.sensoryTerms.join(' '))
  const productText = canonicalProductText(product)
  const sensory = sensoryEvidence.find(
    (evidence) =>
      evidence.requested.test(requestedSensory) &&
      evidence.canonical.test(productText),
  )
  if (sensory) reasons.push(`combina com ${sensory.label}`)

  if (
    input.maxPrice !== undefined &&
    product.price <= input.maxPrice
  ) {
    reasons.push(
      `custa ${formatCurrency(product.price)}, dentro do limite de ${formatCurrency(input.maxPrice)}`,
    )
  }

  if (concernReason) reasons.push(concernReason)

  return reasons.slice(0, 3)
}

export function composeRecommendationMessage(
  product: Product,
  context: CommercialPresentationContext,
  faqAnswer = '',
) {
  const reasons = recommendationReasons(product, context)
  const explanation =
    reasons.length > 0
      ? ` Essa opção ${joinNatural(reasons)}.`
      : ` A descrição comercial do catálogo é: ${product.shortDescription}`
  return `Pelo que você me contou, eu escolheria ${product.name}.${explanation} Os detalhes de preço e estoque estão no cartão.${faqAnswer ? `\n\n${faqAnswer}` : ''}`
}

function lowerFirst(value: string) {
  return value.length === 0 ? value : `${value[0]?.toLocaleLowerCase('pt-BR')}${value.slice(1)}`
}

function withoutTerminalPunctuation(value: string) {
  return value.replace(/[.!?]+$/, '')
}

export function composeComparisonMessage(
  products: readonly [Product, Product],
  faqAnswer = '',
) {
  const [first, second] = products
  const comparison = `${first.name} custa ${formatCurrency(first.price)} e traz ${withoutTerminalPunctuation(lowerFirst(first.shortDescription))}. ${second.name} custa ${formatCurrency(second.price)} e traz ${withoutTerminalPunctuation(lowerFirst(second.shortDescription))}`
  return `As duas opções têm propostas diferentes: ${comparison}. Assim você pode comparar os perfis sem tratar nenhuma delas como clinicamente superior. Os dados completos estão nos cartões.${faqAnswer ? `\n\n${faqAnswer}` : ''}`
}

function sentences(value: string) {
  return value
    .replace(/^No cenário demonstrativo da HidraSplash,\s*/i, 'Aqui no HidraSplash, ')
    .replace(/^Na demonstração,\s*/i, 'Na simulação, ')
    .replace(/^No fluxo fictício,\s*/i, 'Na simulação, ')
    .replace(/^Para fins de demonstração,\s*/i, 'Na simulação, ')
    .replace(
      /^O cenário demonstrativo apresenta um prazo total de\s*/i,
      'Na simulação, o prazo apresentado é de ',
    )
    .split(/(?<=[.!?])\s+/)
    .map((sentence) => sentence.trim())
    .filter(Boolean)
}

function validatedShippingSummary(documents: ReadonlyMap<string, FaqDocument>) {
  const delivery = documents.get('faq-001')
  const free = documents.get('faq-002')
  const standard = documents.get('faq-003')
  const freeIsValid = Boolean(
    free?.content.includes('maior que R$ 100,00') &&
      free.content.includes('R$ 100,00 exatos não recebe frete grátis'),
  )
  const standardIsValid = Boolean(
    standard?.content.includes('até R$ 100,00') &&
      standard.content.includes('R$ 12,90'),
  )
  const deliveryIsValid = Boolean(
    delivery?.content.includes('nenhuma mercadoria') &&
      delivery.content.includes('entregue'),
  )

  const parts: string[] = []
  const consumed = new Set<string>()
  if (freeIsValid && standardIsValid) {
    parts.push(
      'Para subtotais de até R$ 100,00, o frete demonstrativo fica em R$ 12,90. Acima de R$ 100,00, ele é grátis — R$ 100,00 exatos ainda paga o frete padrão.',
    )
    consumed.add('faq-002')
    consumed.add('faq-003')
  }
  if (deliveryIsValid) {
    parts.push(
      'Como esta é uma simulação, nenhuma mercadoria é separada, despachada ou entregue de verdade.',
    )
    consumed.add('faq-001')
  }
  return { parts, consumed }
}

export function composeFaqAnswer({
  question,
  sourceIds,
  faqDocuments,
}: FaqCompositionInput) {
  const selected = new Map<string, FaqDocument>()
  for (const sourceId of sourceIds) {
    const document = faqDocuments.get(sourceId)
    if (document) selected.set(sourceId, document)
  }

  const output: string[] = []
  const seen = new Set<string>()
  const normalizedQuestion = normalize(question)
  const shippingRequested = /\b(?:frete|entrega|entregas|envio)\b/.test(
    normalizedQuestion,
  )
  const shipping = shippingRequested
    ? validatedShippingSummary(selected)
    : { parts: [] as string[], consumed: new Set<string>() }

  for (const part of shipping.parts) {
    output.push(part)
    seen.add(normalize(part))
  }

  for (const [sourceId, document] of selected) {
    if (shipping.consumed.has(sourceId)) continue
    for (const sentence of sentences(document.content)) {
      const key = normalize(sentence)
      if (seen.has(key)) continue
      seen.add(key)
      output.push(sentence)
    }
  }

  return output.join(' ')
}
