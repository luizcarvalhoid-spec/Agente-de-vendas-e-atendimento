import type { Need } from './customer-needs.js'

type Concern =
  | 'stop' | 'pause' | 'frustration' | 'product' | 'attribute' | 'rationale'
  | 'freight' | 'discount' | 'competitor' | 'price' | 'fit' | 'confidence' | 'hesitation'

const end = /^(?:deix[ae] (?:pra|para) la|esquece|encerrar|encerra|cancel[ae]r? essa busca|nao quero (?:mais|comprar|continuar(?: comprando)?))(?:\s*(?:[,;.!]+|obrigad[oa]))*$/
const pause = /^(?:(?:vou|prefiro) pensar(?: melhor| mais)?|talvez depois|agora nao|nao quero (?:mais|continuar|comprar) (?:por enquanto|agora|ainda)|deix[ae] (?:pra|para) la por enquanto)(?:\s*(?:[,;.!]+|obrigad[oa]))*$/
const resume = /^(?:quero retomar(?: a busca)?|vamos retomar(?: a busca)?|pode continuar(?: a busca)?|quero continuar a busca)[.!?]*$/
const freight = /\b(?:frete|envio|entrega)\b[^.!?;]*\b(?:car[oa]|cust[oa] muit[oa]|muito (?:alto|alta))\b|\bachei car[oa] (?:o|a) (?:frete|envio|entrega)\b/

const discount = /^(?:voce )?(?:(?:consegue|pode|da (?:para|pra)) (?:fazer|deixar) por\b|(?:consegue|pode) (?:dar|oferecer) (?:um )?desconto\b)|^(?:tem|teria|existe|posso usar) (?:algum |um )?(?:desconto|cupom)\b|^(?:e )?(?:(?:qual|como)\b[^.!?;]*|(?:quero|queria|gostaria de) saber\b[^.!?;]*)\b(?:descontos?|cupons?|cupom)\b/

const patterns: readonly [Concern, RegExp, 'declared' | 'inferred' | 'ambiguous'][] = [
  ['stop', end, 'declared'],
  ['pause', pause, 'declared'],
  ['frustration', /\b(?:voce nao (?:esta|ta) entendendo|ja respondi(?: essa pergunta)?|ja (?:informei|disse|falei) (?:isso|que|o valor|o limite|meu limite)|voce (?:esta|ta) insistindo(?: demais)?)\b/, 'declared'],
  ['rationale', /\bnao (?:gostei|entendi|concordo) (?:da|dessa|desta|com a) (?:justificativa|explicacao)\b/, 'declared'],
  ['product', /\b(?:nao (?:quero|recomende)(?: mais)? (?:o )?produto|nao gostei do produto) (?:id\s*)?\d{1,6}\b|\b(?:nao quero(?: mais)? (?:esse|este|essa|esta)|nao gostei (?:desse|deste|dessa|desta))(?:\s+(?:produto|opcao|item|recomendacao)\b|[.!?,;]|$)/, 'declared'],
  ['attribute', /^(?:tambem )?(?:nao gosto|nao gostei) (?:de|do|da)\s+(?!(?:produto|item|opcao|recomendacao|justificativa|explicacao)\b)/, 'declared'],
  ['freight', freight, 'declared'],
  ['discount', discount, 'inferred'],
  ['competitor', /\b(?:outra loja|concorrente)\b[^.!?;]*\b(?:mais barato|menor preco|mais em conta)\b|\bmais barato\b[^.!?;]*\b(?:outra loja|concorrente)\b/, 'declared'],
  ['price', /\b(?:achei|considero|ficou|esta|e|ta) caro\b|\bpreco (?:alto|caro)\b/, 'declared'],
  ['fit', /\b(?:nao tenho certeza se|nao sei se|sera que)\b[^.!?;]*\b(?:adequad[oa]|serve|combina|funciona|compativel)\b/, 'ambiguous'],
  ['confidence', /\b(?:tenho (?:medo|receio)|como sei que (?:esse|este|o) produto e bom|ja comprei algo parecido e nao gostei)\b/, 'declared'],
  ['hesitation', /^(?:ainda (?:estou|to) em duvida|estou indecis[oa]|nao tenho certeza)[.;!?]*$/, 'declared'],
]

const cheaper = /^(?:(?:tem|teria|ha|existe|quero|prefiro|procuro) (?:algo|(?:um |outro )?produto|(?:uma |outra )?opcao)|(?:me mostre|pode (?:me )?mostrar) (?:algo|(?:uma |outra )?opcao)|(?:tem|teria) (?:um|outro|uma|outra)) (?:mais barato|mais barata|mais em conta)\b/
const alternative = /(?:^|[.!?;,]\s*)(?:(?:e|tambem|entao) )?(?:me mostre|mostre|quero|prefiro|pode (?:me )?mostrar|tem|teria) (?:uma? )?(?:(?:outra opcao|outro produto|produto diferente|algo diferente)\b|outr[oa](?=\s*(?:[.!?;,]|$)|\s+sem\b))/

// All callers use the same accent and whitespace normalization as customer needs.
export function isObjectionClause(text: string) {
  return patterns.some(([kind, pattern]) => kind !== 'attribute' && kind !== 'product' && pattern.test(text))
}

export function asksForAlternative(text: string) {
  return asksForCheaper(text) || alternative.test(text)
}

export function asksForCheaper(text: string) {
  return cheaper.test(text)
}

export function asksForDiscount(text: string) {
  return discount.test(text)
}

export function resumesSearch(text: string) {
  return resume.test(text)
}

export function readObjections(parts: readonly string[]) {
  const active = parts.filter((part) => !/^(?:e se|se eu|suponha|sera que (?!.*\b(?:adequad[oa]|serve|combina|funciona|compativel)\b))\b/.test(part))
  const matched = patterns.filter(([kind, pattern]) =>
    active.some((part) => pattern.test(part) && (kind !== 'price' || !freight.test(part))))
  const topics = matched.map(([kind]) => kind)
  const concerns = matched.map<Need<Concern>>(([kind, , origin]) => origin === 'ambiguous'
    ? { origin, conservativeValue: kind } : { origin, value: kind })
  const cheaperRequest = active.filter(asksForCheaper).join(' ')
  return {
    concerns,
    primary: topics.at(0),
    topics,
    alternative: active.some(asksForAlternative),
    cheaper: cheaperRequest !== '',
    cheaperRequest,
  }
}

export type Objections = ReturnType<typeof readObjections>

export function cheaperPriceCeiling(referenceCents: number, existingMaximum?: number) {
  if (!Number.isSafeInteger(referenceCents) || referenceCents <= 0) return undefined
  return Math.min((referenceCents - 1) / 100, existingMaximum ?? Infinity)
}

export function decideObjection(
  objections: Objections,
  options: { readonly paused: boolean; readonly rejectionHeld?: boolean; readonly selects: boolean; readonly information: boolean },
) {
  const { primary, topics } = objections
  const hasInformation = options.information || topics.includes('discount')
  if (primary === 'stop') return hasInformation ? 'inform' : 'stop'
  if (primary === 'pause' || options.paused) return hasInformation ? 'inform' : 'pause'
  if (options.rejectionHeld && primary !== 'product') return hasInformation || topics.includes('freight') ? 'inform' : 'acknowledge'
  if (primary === 'frustration' && !hasInformation && !topics.includes('freight')) return 'acknowledge'
  if (objections.alternative) return 'alternative'
  if (options.selects || primary === undefined) return 'continue'
  if (options.information || topics.includes('freight') || (primary !== 'discount' && hasInformation)) return 'inform'
  if (primary === 'fit' || primary === 'confidence') return 'inform'
  if (primary === 'discount' || primary === 'competitor' || primary === 'rationale') return 'explain'
  // Attribute preferences still pass through the domain adapter. This decision
  // only controls whether a new selection is offered in this turn.
  return 'acknowledge'
}
