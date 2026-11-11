import { describe, expect, test } from 'vitest'

import {
  CART_MAX_STORAGE_BYTES,
  CART_STANDARD_SHIPPING_CENTS,
  type CartItem,
  calculateCartTotals,
  parseStoredCart,
  priceToCents,
  serializeCartItems,
} from '../src/cart/cart-model'

const classification = {
  commercial: 'fictional-demo',
  compatibility: 'commercial-positioning',
  formulation: 'synthetic-test-data',
  safety: 'not-evaluated',
} as const

function readyItem(
  unitPriceCents: number,
  quantity = 1,
  productId = 1,
): CartItem {
  return {
    status: 'ready',
    productId,
    slug: `produto-${productId}`,
    quantity,
    product: {
      productId,
      slug: `produto-${productId}`,
      name: `Produto ${productId}`,
      unitPriceCents,
      stock: 20,
      imageUrl: 'http://api.test/api/catalog/images/produto.jpg',
      dataClassification: classification,
    },
  }
}

describe('cart model', () => {
  test('converts canonical decimal prices to safe integer cents', () => {
    expect(priceToCents(48.9)).toBe(4_890)
    expect(priceToCents(100.01)).toBe(10_001)
    expect(priceToCents(0.1 + 0.2)).toBe(30)
    expect(priceToCents(Number.NaN)).toBeUndefined()
    expect(priceToCents(Number.POSITIVE_INFINITY)).toBeUndefined()
    expect(priceToCents(-1)).toBeUndefined()
  })

  test('does not charge shipping for an empty cart', () => {
    expect(calculateCartTotals([])).toEqual({
      totalUnits: 0,
      subtotalCents: 0,
      shippingCents: 0,
      totalCents: 0,
      isPartial: false,
    })
  })

  test.each([
    [9_999, CART_STANDARD_SHIPPING_CENTS],
    [10_000, CART_STANDARD_SHIPPING_CENTS],
    [10_001, 0],
  ])('applies the documented shipping boundary at %i cents', (subtotal, shipping) => {
    const totals = calculateCartTotals([readyItem(subtotal)])
    expect(totals.subtotalCents).toBe(subtotal)
    expect(totals.shippingCents).toBe(shipping)
    expect(totals.totalCents).toBe(subtotal + shipping)
  })

  test('counts units and marks totals partial when a reference has a problem', () => {
    const problem: CartItem = {
      status: 'problem',
      reason: 'removed',
      productId: 2,
      slug: 'produto-2',
      quantity: 4,
    }
    expect(calculateCartTotals([readyItem(2_500, 3), problem])).toEqual({
      totalUnits: 3,
      subtotalCents: 7_500,
      shippingCents: 1_290,
      totalCents: 8_790,
      isPartial: true,
    })
  })

  test('serializes only references, never price, stock or commercial details', () => {
    const raw = serializeCartItems([readyItem(4_890, 2, 13)])!
    expect(JSON.parse(raw)).toEqual({
      version: 1,
      items: [
        {
          productId: 13,
          slug: 'produto-13',
          quantity: 2,
        },
      ],
    })
    expect(raw).not.toContain('unitPriceCents')
    expect(raw).not.toContain('stock')
    expect(raw).not.toContain('name')
  })

  test('recovers valid versioned references', () => {
    expect(
      parseStoredCart(
        JSON.stringify({
          version: 1,
          items: [{ productId: 13, slug: 'produto-13', quantity: 2 }],
        }),
      ),
    ).toEqual([{ productId: 13, slug: 'produto-13', quantity: 2 }])
  })

  test.each([
    ['invalid JSON', '{'],
    [
      'unknown root property',
      JSON.stringify({ version: 1, items: [], price: 1 }),
    ],
    [
      'unknown item property',
      JSON.stringify({
        version: 1,
        items: [{ productId: 1, slug: 'produto-1', quantity: 1, price: 1 }],
      }),
    ],
    [
      'duplicate product ID',
      JSON.stringify({
        version: 1,
        items: [
          { productId: 1, slug: 'produto-1', quantity: 1 },
          { productId: 1, slug: 'produto-2', quantity: 1 },
        ],
      }),
    ],
    [
      'duplicate slug',
      JSON.stringify({
        version: 1,
        items: [
          { productId: 1, slug: 'produto-1', quantity: 1 },
          { productId: 2, slug: 'produto-1', quantity: 1 },
        ],
      }),
    ],
    [
      'quantity over limit',
      JSON.stringify({
        version: 1,
        items: [{ productId: 1, slug: 'produto-1', quantity: 21 }],
      }),
    ],
    [
      'non-normalized slug',
      JSON.stringify({
        version: 1,
        items: [{ productId: 1, slug: '../produto', quantity: 1 }],
      }),
    ],
  ])('rejects %s', (_label, raw) => {
    expect(parseStoredCart(raw)).toBeUndefined()
  })

  test('rejects storage above the UTF-8 byte budget', () => {
    expect(parseStoredCart('á'.repeat(CART_MAX_STORAGE_BYTES))).toBeUndefined()
  })
})
