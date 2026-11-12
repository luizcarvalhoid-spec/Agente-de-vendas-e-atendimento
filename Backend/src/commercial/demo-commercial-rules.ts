export const DEMO_FREE_SHIPPING_THRESHOLD_CENTS = 10_000
export const DEMO_STANDARD_SHIPPING_CENTS = 1_290

export interface DemoCommercialLine {
  readonly unitPriceCents: number
  readonly quantity: number
}

export interface DemoCommercialTotals {
  readonly totalUnits: number
  readonly subtotalCents: number
  readonly shippingCents: number
  readonly totalCents: number
}

export function demoPriceToCents(price: number): number | undefined {
  if (!Number.isFinite(price) || price < 0) return undefined

  const cents = Math.round((price + Number.EPSILON) * 100)
  return Number.isSafeInteger(cents) && cents >= 0 ? cents : undefined
}

export function calculateDemoCommercialTotals(
  lines: readonly DemoCommercialLine[],
): DemoCommercialTotals {
  let totalUnits = 0
  let subtotalCents = 0

  for (const line of lines) {
    if (
      !Number.isSafeInteger(line.unitPriceCents) ||
      line.unitPriceCents < 0 ||
      !Number.isSafeInteger(line.quantity) ||
      line.quantity <= 0
    ) {
      throw new TypeError('Linha comercial demonstrativa inválida.')
    }
    totalUnits += line.quantity
    subtotalCents += line.unitPriceCents * line.quantity
    if (
      !Number.isSafeInteger(totalUnits) ||
      !Number.isSafeInteger(subtotalCents)
    ) {
      throw new TypeError('Totais comerciais demonstrativos inválidos.')
    }
  }

  const shippingCents =
    totalUnits === 0
      ? 0
      : subtotalCents > DEMO_FREE_SHIPPING_THRESHOLD_CENTS
        ? 0
        : DEMO_STANDARD_SHIPPING_CENTS

  return {
    totalUnits,
    subtotalCents,
    shippingCents,
    totalCents: subtotalCents + shippingCents,
  }
}
