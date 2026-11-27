import {
  needFrom,
  normalize,
  type CustomerNeedsDomain,
  type CustomerNeedsRequest,
  type Need,
} from '../../src/agent/customer-needs.js'

// Separate stationery vocabulary. This fixture never uses the cosmetic product schema.
const formats = ['a4', 'a5', 'a6'] as const
const papers = ['lisa', 'pautada', 'pontilhada', 'quadriculada'] as const
type Format = typeof formats[number]
type Paper = typeof papers[number]

function attribute<T extends string>(value: string | undefined, allowed: readonly T[]): Need<T> {
  if (value === undefined) return { origin: 'absent' }
  const canonical = allowed.find((candidate) => candidate === value)
  return canonical === undefined ? { origin: 'ambiguous' } : needFrom(canonical)
}

function interpret(request: CustomerNeedsRequest) {
  const message = normalize(request.message)
  const requiredFormat = message.match(/\b(?:tem que ser|precisa ser|obrigatoriamente) (?:no )?formato (\w+)\b/)?.[1]
  const format = message.match(/\b(?:prefiro|com|no) formato (\w+)\b/)?.[1]
  const paper = message.match(/\bfolhas? (\w+)\b/)?.[1]
  const purpose = message.match(/\bpara (estudo|desenho|anotacoes)\b/)?.[1]
  return {
    category: needFrom(/\bcadernos?\b/.test(message) ? 'caderno' as const : undefined),
    objective: needFrom(purpose),
    preferences: {
      format: attribute<Format>(requiredFormat === format ? undefined : format, formats),
      paper: attribute<Paper>(paper, papers),
    },
    restrictions: { format: attribute<Format>(requiredFormat, formats) },
  }
}

export const papelariaCustomerDomain = {
  vocabulary: {
    productSignals: [/\bcadernos?\b/, /\b(?:folhas?|formato|gramatura)\b/],
    requestedProduct: /\bcadernos?\b/,
  },
  interpret,
  isPreferenceFollowUp: (message: string) => /\b(?:folhas?|formato)\b/.test(normalize(message)),
} satisfies CustomerNeedsDomain<{ maxPrice?: number }, ReturnType<typeof interpret>>
