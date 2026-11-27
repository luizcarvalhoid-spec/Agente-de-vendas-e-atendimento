import type {
  ToolOrchestratorGroundingRequirement,
} from './tool-orchestrator.js'

export type ChatPresentationIntent =
  | 'text'
  | 'recommendation'
  | 'comparison'

export interface ChatGroundingPlan {
  groundingRequirement: ToolOrchestratorGroundingRequirement
  presentationIntent: ChatPresentationIntent
}

export interface ProductIntentVocabulary {
  readonly productSignals: readonly RegExp[]
  readonly requestedProduct: RegExp
}

function normalize(value: string) {
  return value
    .normalize('NFKD')
    .replace(/\p{Diacritic}/gu, '')
    .toLocaleLowerCase('pt-BR')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .replace(/\s+/g, ' ')
}

const conversationalMessages = new Set([
  'ajuda',
  'boa noite',
  'boa tarde',
  'bom dia',
  'como voce pode ajudar',
  'obrigada',
  'obrigado',
  'oi',
  'ola',
  'quem e voce',
  'tudo bem',
])

const productSignals = [
  /\b(?:produtos?|kit)\b/,
  /\b(?:preco|custa|custar|pagar|valor|orcamento|limite|caro|barato|bolso)\b/,
  /\b(?:estoque|disponivel|disponibilidade|pronta entrega)\b/,
  /\b(?:recomenda|recomendacao|indica|indicado|me recomende|me indique|escolher|escolho|combina comigo|melhor opcao)\b/,
]

const faqSignals = [
  /\b(?:frete|envio|entreg(?:a|am|ar|ue)|transportadora|receber|prazo de entrega)\b/,
  /\b(?:troca|trocar|devolucao|devolver|desistir|reembolso|estorno|danificado)\b/,
  /\b(?:pagamento|forma de pagar|parcelamento|pix|cartao|boleto)\b/,
  /\b(?:pedido|cancelar pedido|rastreamento|rastrear)\b/,
  /\b(?:politica|privacidade|dados pessoais|atacado|fidelidade|embalagem para presente)\b/,
]

const comparisonSignals = [
  /\bcompar(?:a|ar|acao|e)\b/,
  /\bdiferenca entre\b/,
  /\bqual dos dois\b/,
]

const recommendationSignals = [
  /\b(?:recomenda|recomendacao|indica|indicado|me recomende|me indique|escolher|escolho|melhor opcao)\b/,
  /\bo que combina comigo\b/,
]

function matchesAny(value: string, patterns: readonly RegExp[]) {
  return patterns.some((pattern) => pattern.test(value))
}

export function hasFaqTopic(message: string) {
  return matchesAny(normalize(message), faqSignals)
}

export function planChatGrounding(
  message: string,
  vocabulary: ProductIntentVocabulary,
  structuredProductContext = false,
): ChatGroundingPlan {
  const currentMessage = normalize(message)
  const comparison = matchesAny(currentMessage, comparisonSignals)
  const product =
    structuredProductContext ||
    comparison ||
    matchesAny(currentMessage, productSignals) ||
    matchesAny(currentMessage, vocabulary.productSignals)
  const faq =
    !/\bpronta entrega\b/.test(currentMessage) &&
    matchesAny(currentMessage, faqSignals)
  const requested = currentMessage.match(/\b(?:quero|procuro|preciso de)\b(.*)/)?.[1] ?? ''
  const recommendation = !comparison && (
    matchesAny(currentMessage, recommendationSignals) ||
    /\b(?:produto|kit)\b/.test(requested) ||
    vocabulary.requestedProduct.test(requested)
  )

  if (
    !structuredProductContext &&
    !product &&
    !faq &&
    conversationalMessages.has(currentMessage)
  ) {
    return {
      groundingRequirement: 'not_required',
      presentationIntent: 'text',
    }
  }

  const groundingRequirement: ToolOrchestratorGroundingRequirement =
    product && faq ? 'both' : product ? 'product' : faq ? 'faq' : 'both'

  return {
    groundingRequirement,
    presentationIntent: comparison
      ? 'comparison'
      : recommendation
        ? 'recommendation'
        : 'text',
  }
}
