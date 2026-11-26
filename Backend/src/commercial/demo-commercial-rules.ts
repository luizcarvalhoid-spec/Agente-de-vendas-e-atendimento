export const DEMO_FREE_SHIPPING_THRESHOLD_CENTS = 10_000
export const DEMO_STANDARD_SHIPPING_CENTS = 1_290

export interface CommercialShippingRules {
  readonly standardShippingCents: number
  readonly freeShippingThresholdCents: number
  readonly freeShippingComparison: 'above' | 'at_or_above'
}

export const DEMO_SHIPPING_RULES = Object.freeze({
  standardShippingCents: DEMO_STANDARD_SHIPPING_CENTS,
  freeShippingThresholdCents: DEMO_FREE_SHIPPING_THRESHOLD_CENTS,
  freeShippingComparison: 'above',
} satisfies CommercialShippingRules)

export interface CommercialLine {
  readonly unitPriceCents: number
  readonly quantity: number
}

export interface CommercialTotals {
  readonly totalUnits: number
  readonly subtotalCents: number
  readonly shippingCents: number
  readonly totalCents: number
}

export type DemoCommercialLine = CommercialLine
export type DemoCommercialTotals = CommercialTotals

export function priceToCents(price: number): number | undefined {
  if (!Number.isFinite(price) || price < 0) return undefined

  const cents = Math.round((price + Number.EPSILON) * 100)
  return Number.isSafeInteger(cents) && cents >= 0 ? cents : undefined
}

export { priceToCents as demoPriceToCents }

export function calculateCommercialTotals(
  lines: readonly CommercialLine[],
  rules: CommercialShippingRules,
): CommercialTotals {
  if (
    !Number.isSafeInteger(rules.standardShippingCents) ||
    rules.standardShippingCents <= 0 ||
    !Number.isSafeInteger(rules.freeShippingThresholdCents) ||
    rules.freeShippingThresholdCents <= 0 ||
    (rules.freeShippingComparison !== 'above' &&
      rules.freeShippingComparison !== 'at_or_above')
  ) {
    throw new TypeError('Regras de frete inválidas.')
  }

  let totalUnits = 0
  let subtotalCents = 0

  for (const line of lines) {
    if (
      !Number.isSafeInteger(line.unitPriceCents) ||
      line.unitPriceCents < 0 ||
      !Number.isSafeInteger(line.quantity) ||
      line.quantity <= 0
    ) {
      throw new TypeError('Linha comercial inválida.')
    }
    totalUnits += line.quantity
    subtotalCents += line.unitPriceCents * line.quantity
    if (
      !Number.isSafeInteger(totalUnits) ||
      !Number.isSafeInteger(subtotalCents)
    ) {
      throw new TypeError('Totais comerciais inválidos.')
    }
  }

  const qualifiesForFreeShipping =
    rules.freeShippingComparison === 'above'
      ? subtotalCents > rules.freeShippingThresholdCents
      : subtotalCents >= rules.freeShippingThresholdCents
  const shippingCents =
    totalUnits === 0 || qualifiesForFreeShipping ? 0 : rules.standardShippingCents
  const totalCents = subtotalCents + shippingCents
  if (!Number.isSafeInteger(totalCents)) {
    throw new TypeError('Totais comerciais inválidos.')
  }

  return {
    totalUnits,
    subtotalCents,
    shippingCents,
    totalCents,
  }
}

export function calculateDemoCommercialTotals(
  lines: readonly DemoCommercialLine[],
): DemoCommercialTotals {
  return calculateCommercialTotals(lines, DEMO_SHIPPING_RULES)
}
