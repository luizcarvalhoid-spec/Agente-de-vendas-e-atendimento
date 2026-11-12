import assert from 'node:assert/strict'
import test from 'node:test'

import {
  calculateDemoCommercialTotals,
  DEMO_STANDARD_SHIPPING_CENTS,
  demoPriceToCents,
} from '../src/commercial/demo-commercial-rules.js'

test('demonstrative totals preserve the empty and shipping boundaries', () => {
  assert.deepEqual(calculateDemoCommercialTotals([]), {
    totalUnits: 0,
    subtotalCents: 0,
    shippingCents: 0,
    totalCents: 0,
  })
  assert.deepEqual(
    calculateDemoCommercialTotals([{ unitPriceCents: 10_000, quantity: 1 }]),
    {
      totalUnits: 1,
      subtotalCents: 10_000,
      shippingCents: DEMO_STANDARD_SHIPPING_CENTS,
      totalCents: 11_290,
    },
  )
  assert.deepEqual(
    calculateDemoCommercialTotals([{ unitPriceCents: 10_001, quantity: 1 }]),
    {
      totalUnits: 1,
      subtotalCents: 10_001,
      shippingCents: 0,
      totalCents: 10_001,
    },
  )
})

test('canonical decimal prices are converted to integer cents', () => {
  assert.equal(demoPriceToCents(48.9), 4_890)
  assert.equal(demoPriceToCents(100.01), 10_001)
  assert.equal(demoPriceToCents(Number.NaN), undefined)
  assert.equal(demoPriceToCents(-1), undefined)
})
