import {
  historicalUserMessages,
  needFrom,
  needValue,
  normalize,
  resolveContextValues,
  type CustomerNeedsDomain,
  type CustomerNeedsRequest,
  type Need,
} from '../../src/agent/customer-needs.js'
import type { ClarificationIssue } from '../../src/agent/clarification-strategy.js'

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

function goal(text: string) {
  const message = normalize(text)
  const request = message.match(/(?:^|[.;:]\s*)(?:agora\s+)?(?:quero|procuro|preciso de)\s+([^.;!?]*)/)?.[1]
  return {
    category: request && /\bcadernos?\b/.test(request) ? 'caderno' as const : undefined,
    objective: request?.match(/\bpara (estudo|desenho|anotacoes)\b/)?.[1] ??
      message.match(/^para (estudo|desenho|anotacoes)[.!]?$/)?.[1],
  }
}

function readTurn(text: string) {
  const message = normalize(text)
  const requirements = new Set(Array.from(
    message.matchAll(/\b(?:tem que ser|precisa ser|obrigatoriamente) (?:no )?formato (\w+)\b/g),
    (match) => match[1],
  ))
  const [requiredFormat] = requirements
  const format = message.match(/\b(?:prefiro|com|no) formato (\w+)\b|^(?:formato )?(a[456])[.!]?$/)
  const preferredFormat = format?.[1] ?? format?.[2]
  const paper = message.match(/\bfolhas? (\w+)\b/)?.[1]
  return {
    ...goal(text),
    preferences: {
      format: attribute<Format>(requiredFormat === preferredFormat ? undefined : preferredFormat, formats),
      paper: attribute<Paper>(paper, papers),
    },
    restrictions: { format: requirements.size > 1 ? { origin: 'ambiguous' } as const : attribute<Format>(requiredFormat, formats) },
    revokeFormat: !message.includes('?') && /\bpode ser qualquer formato\b/.test(message),
  }
}

function resolveAttribute<T>(
  history: readonly { value: Need<T>; revoke?: boolean }[],
  current: { value: Need<T>; revoke?: boolean },
): Need<T> {
  const update = ({ value, revoke }: typeof current) => ({
    replace: value.origin !== 'absent' ? [value] : revoke ? [] : undefined,
  })
  const resolved = resolveContextValues(history.map(update), update(current))
  const value = needValue(resolved)?.[0]
  if (!value || !('value' in resolved)) return { origin: 'absent' }
  return 'value' in value ? { origin: resolved.origin, value: value.value } : value
}

function interpret(request: CustomerNeedsRequest) {
  const history = historicalUserMessages(request).map(readTurn)
  const current = readTurn(request.message)
  return {
    category: resolveAttribute(history.map(({ category }) => ({ value: needFrom(category) })), { value: needFrom(current.category) }),
    objective: resolveAttribute(history.map(({ objective }) => ({ value: needFrom(objective) })), { value: needFrom(current.objective) }),
    preferences: {
      format: resolveAttribute(history.map((turn) => ({ value: turn.preferences.format })), { value: current.preferences.format }),
      paper: resolveAttribute(history.map((turn) => ({ value: turn.preferences.paper })), { value: current.preferences.paper }),
    },
    restrictions: {
      format: resolveAttribute(
        history.map((turn) => ({ value: turn.restrictions.format, revoke: turn.revokeFormat })),
        { value: current.restrictions.format, revoke: current.revokeFormat },
      ),
    },
  }
}

export const papelariaCustomerDomain = {
  vocabulary: {
    productSignals: [/\bcadernos?\b/, /\b(?:folhas?|formato|gramatura)\b/],
    requestedProduct: /\bcadernos?\b/,
  },
  interpret,
  goal,
  isPreferenceFollowUp: (message: string) =>
    /\b(?:folhas?|formato|a[456])\b|^para (?:estudo|desenho|anotacoes)[.!]?$/.test(normalize(message)),
} satisfies CustomerNeedsDomain<{ maxPrice?: number }, ReturnType<typeof interpret>>

export function papelariaConsultation(domain: ReturnType<typeof interpret>): {
  readonly issues: readonly ClarificationIssue[]
  readonly selectionQuestion?: ClarificationIssue
  readonly canChooseWithoutPreference?: boolean
} {
  if (domain.restrictions.format.origin === 'ambiguous') {
    return { issues: [{
      reason: 'format_conflict', priority: 'restriction', attribute: 'format',
      question: 'Qual formato é obrigatório para você?',
      limitation: 'Sem confirmar o formato obrigatório, não consigo indicar um caderno.',
    }] }
  }
  if (domain.objective.origin === 'absent') {
    return { issues: [{
      reason: 'missing_purpose', priority: 'selection', attribute: 'purpose',
      question: 'Para que você vai usar o caderno?',
      limitation: 'Ainda preciso saber para que você quer usar o caderno.',
    }] }
  }
  if (needValue(domain.restrictions.format) || needValue(domain.preferences.format)) return { issues: [] }
  return {
    issues: [],
    canChooseWithoutPreference: true,
    selectionQuestion: {
      reason: 'format_preference', priority: 'preference', attribute: 'format',
      question: 'Qual tamanho de caderno você prefere?',
      limitation: 'Ainda não consigo diferenciar um caderno para você.',
    },
  }
}
