import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'

import { ApiRequestError } from '../src/api/client'
import type { ProductDetailResponse } from '../src/api/contracts'
import CartProvider from '../src/cart/CartProvider'
import {
  CART_STORAGE_KEY,
  type CartStorage,
} from '../src/cart/cart-model'
import { type CartContextValue, useCart } from '../src/cart/useCart'

const classification = {
  commercial: 'fictional-demo',
  compatibility: 'commercial-positioning',
  formulation: 'synthetic-test-data',
  safety: 'not-evaluated',
} as const

function detailResponse(
  overrides: Partial<ProductDetailResponse['item']> = {},
): ProductDetailResponse {
  const id = overrides.id ?? 13
  const slug =
    overrides.slug ??
    'shampoo-anticaspa-controle-oleosidade-limao-siciliano-hortela'
  return {
    item: {
      id,
      slug,
      name: 'Shampoo Anticaspa Controle de Oleosidade',
      brand: 'HidraSplash',
      isDemo: true,
      dataClassification: classification,
      category: 'shampoos',
      subcategory: 'anticaspa',
      applicationArea: 'hair',
      productKind: 'single',
      description: 'Descrição canônica demonstrativa.',
      shortDescription: 'Perfil refrescante para couro cabeludo oleoso.',
      price: 48.9,
      image: 'images/shampoo-anticaspa.jpg',
      stock: 14,
      netContent: { value: 250, unit: 'ml' },
      variant: { name: 'Limão e hortelã', sensoryNotes: ['Refrescante'] },
      tags: ['anticaspa'],
      indications: ['Posicionamento demonstrativo'],
      benefits: ['Benefício demonstrativo'],
      hairTypes: ['todos'],
      scalpTypes: ['oleoso'],
      concerns: ['caspa', 'oleosidade'],
      ingredients: [{ id: 'base-limpante', name: 'Base limpante sintética' }],
      usage: 'Uso demonstrativo.',
      restrictions: [],
      warnings: ['Informações de segurança não avaliadas.'],
      contraindications: [],
      ...overrides,
    } as ProductDetailResponse['item'],
    media: {
      primaryUrl: `http://api.test/api/catalog/images/${slug}.jpg`,
      galleryUrls: [],
    },
  }
}

class MemoryStorage implements CartStorage {
  readonly values = new Map<string, string>()

  getItem(key: string) {
    return this.values.get(key) ?? null
  }

  setItem(key: string, value: string) {
    this.values.set(key, value)
  }

  removeItem(key: string) {
    this.values.delete(key)
  }
}

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((done, fail) => {
    resolve = done
    reject = fail
  })
  return { promise, resolve, reject }
}

async function settle() {
  await act(async () => {
    await Promise.resolve()
    await Promise.resolve()
  })
}

describe('CartProvider', () => {
  let container: HTMLDivElement
  let root: Root
  let cart: CartContextValue

  function Observer() {
    cart = useCart()
    return (
      <output data-testid="cart-state">
        {JSON.stringify({
          phase: cart.phase,
          totalUnits: cart.totalUnits,
          subtotalCents: cart.subtotalCents,
          shippingCents: cart.shippingCents,
          isPartial: cart.isPartial,
          issueCount: cart.issueCount,
          persistenceStatus: cart.persistenceStatus,
        })}
      </output>
    )
  }

  function renderProvider(
    storage: CartStorage | null,
    loadProduct: (
      slug: string,
      signal?: AbortSignal,
    ) => Promise<ProductDetailResponse>,
  ) {
    act(() =>
      root.render(
        <CartProvider storage={storage} loadProduct={loadProduct}>
          <Observer />
        </CartProvider>,
      ),
    )
  }

  beforeEach(() => {
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
    container = document.createElement('div')
    document.body.append(container)
    root = createRoot(container)
  })

  afterEach(() => {
    act(() => root.unmount())
    container.remove()
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
  })

  test('starts in hydration and reaches an empty cart without shipping', async () => {
    renderProvider(new MemoryStorage(), vi.fn())
    expect(cart.phase).toBe('ready')
    expect(cart.totalUnits).toBe(0)
    expect(cart.shippingCents).toBe(0)
    expect(cart.isPartial).toBe(false)
    await settle()
  })

  test('discards corrupted storage and continues with an empty cart', () => {
    const storage = new MemoryStorage()
    storage.setItem(CART_STORAGE_KEY, '{not-json')
    renderProvider(storage, vi.fn())
    expect(cart.phase).toBe('ready')
    expect(cart.items).toHaveLength(0)
    expect(storage.getItem(CART_STORAGE_KEY)).toBeNull()
  })

  test('adds, aggregates, changes, removes and clears one canonical line', async () => {
    const storage = new MemoryStorage()
    const loadProduct = vi.fn().mockResolvedValue(detailResponse())
    renderProvider(storage, loadProduct)

    let firstResult
    await act(async () => {
      firstResult = await cart.addProduct({
        productId: 13,
        slug: detailResponse().item.slug,
        observedPriceCents: 4_890,
      })
    })
    expect(firstResult).toEqual({
      status: 'success',
      quantity: 1,
      priceChanged: false,
    })
    expect(cart.totalUnits).toBe(1)
    expect(cart.subtotalCents).toBe(4_890)

    await act(async () => {
      await cart.addProduct({ productId: 13, slug: detailResponse().item.slug })
    })
    expect(cart.items).toHaveLength(1)
    expect(cart.totalUnits).toBe(2)

    await act(async () => {
      await cart.setQuantity(13, 3)
    })
    expect(cart.totalUnits).toBe(3)

    act(() => cart.removeProduct(13))
    expect(cart.totalUnits).toBe(0)
    expect(cart.items).toHaveLength(0)

    await act(async () => {
      await cart.addProduct({ productId: 13, slug: detailResponse().item.slug })
    })
    act(() => cart.clearCart())
    expect(cart.items).toHaveLength(0)
    expect(storage.getItem(CART_STORAGE_KEY)).toBeNull()
    expect(loadProduct).toHaveBeenCalledTimes(4)
  })

  test('persists only ID, slug and quantity and restores canonical data on reload', async () => {
    const storage = new MemoryStorage()
    storage.setItem(
      CART_STORAGE_KEY,
      JSON.stringify({
        version: 1,
        items: [{ productId: 13, slug: detailResponse().item.slug, quantity: 2 }],
      }),
    )
    const loadProduct = vi.fn().mockResolvedValue(detailResponse())
    renderProvider(storage, loadProduct)
    await settle()

    expect(cart.phase).toBe('ready')
    expect(cart.totalUnits).toBe(2)
    const persisted = storage.getItem(CART_STORAGE_KEY)!
    expect(persisted).not.toContain('price')
    expect(persisted).not.toContain('stock')
    expect(persisted).not.toContain('name')
    expect(loadProduct).toHaveBeenCalledTimes(1)
  })

  test('keeps invalid restored references identifiable but excludes them from totals', async () => {
    const storage = new MemoryStorage()
    storage.setItem(
      CART_STORAGE_KEY,
      JSON.stringify({
        version: 1,
        items: [{ productId: 13, slug: detailResponse().item.slug, quantity: 2 }],
      }),
    )
    renderProvider(
      storage,
      vi.fn().mockRejectedValue(
        new ApiRequestError('http', { status: 404, code: 'NOT_FOUND' }),
      ),
    )
    await settle()

    expect(cart.items).toEqual([
      expect.objectContaining({
        productId: 13,
        quantity: 2,
        status: 'problem',
        reason: 'removed',
      }),
    ])
    expect(cart.totalUnits).toBe(0)
    expect(cart.shippingCents).toBe(0)
    expect(cart.issueCount).toBe(1)
    expect(cart.isPartial).toBe(true)
  })

  test.each([
    ['identity mismatch', detailResponse({ id: 99 }), 'identity_mismatch'],
    ['out of stock', detailResponse({ stock: 0 }), 'out_of_stock'],
    ['insufficient stock', detailResponse({ stock: 1 }), 'insufficient_stock'],
  ])('rejects %s without creating a ghost line', async (_label, response, reason) => {
    renderProvider(new MemoryStorage(), vi.fn().mockResolvedValue(response))
    let result
    await act(async () => {
      result = await cart.addProduct(
        { productId: 13, slug: detailResponse().item.slug },
        reason === 'insufficient_stock' ? 2 : 1,
      )
    })
    expect(result).toEqual({ status: 'rejected', reason })
    expect(cart.items).toHaveLength(0)
    expect(cart.totalUnits).toBe(0)
  })

  test('rejects removed products and catalog failures without a ghost line', async () => {
    const loader = vi
      .fn()
      .mockRejectedValueOnce(
        new ApiRequestError('http', { status: 404, code: 'NOT_FOUND' }),
      )
      .mockRejectedValueOnce(new Error('offline'))
    renderProvider(new MemoryStorage(), loader)

    let removed
    await act(async () => {
      removed = await cart.addProduct({
        productId: 13,
        slug: detailResponse().item.slug,
      })
    })
    expect(removed).toEqual({ status: 'rejected', reason: 'removed' })
    let offline
    await act(async () => {
      offline = await cart.addProduct({
        productId: 13,
        slug: detailResponse().item.slug,
      })
    })
    expect(offline).toEqual({ status: 'rejected', reason: 'validation_failed' })
    expect(cart.items).toHaveLength(0)
  })

  test('enforces quantity and distinct-product limits before transport', async () => {
    const storage = new MemoryStorage()
    storage.setItem(
      CART_STORAGE_KEY,
      JSON.stringify({
        version: 1,
        items: Array.from({ length: 20 }, (_, index) => ({
          productId: index + 1,
          slug: `produto-${index + 1}`,
          quantity: 1,
        })),
      }),
    )
    const loader = vi.fn((slug: string) => {
      const id = Number(slug.replace('produto-', ''))
      return Promise.resolve(detailResponse({ id, slug, stock: 20 }))
    })
    renderProvider(storage, loader)
    await settle()
    expect(cart.items).toHaveLength(20)

    let quantityLimit
    await act(async () => {
      quantityLimit = await cart.setQuantity(1, 21)
    })
    expect(quantityLimit).toEqual({
      status: 'rejected',
      reason: 'quantity_limit',
    })

    let cartLimit
    await act(async () => {
      cartLimit = await cart.addProduct({ productId: 21, slug: 'produto-21' })
    })
    expect(cartLimit).toEqual({ status: 'rejected', reason: 'cart_limit' })
    expect(loader).toHaveBeenCalledTimes(20)
  })

  test('preserves valid items when a later catalog validation fails', async () => {
    const loader = vi
      .fn()
      .mockResolvedValueOnce(detailResponse())
      .mockRejectedValueOnce(new Error('offline'))
    renderProvider(new MemoryStorage(), loader)
    await act(async () => {
      await cart.addProduct({ productId: 13, slug: detailResponse().item.slug })
    })
    let result
    await act(async () => {
      result = await cart.addProduct({ productId: 13, slug: detailResponse().item.slug })
    })
    expect(result).toEqual({ status: 'rejected', reason: 'validation_failed' })
    expect(cart.totalUnits).toBe(1)
    expect(cart.items).toHaveLength(1)
  })

  test('blocks mutations during hydration and clear prevents a late restore', async () => {
    const storage = new MemoryStorage()
    storage.setItem(
      CART_STORAGE_KEY,
      JSON.stringify({
        version: 1,
        items: [{ productId: 13, slug: detailResponse().item.slug, quantity: 2 }],
      }),
    )
    const pending = deferred<ProductDetailResponse>()
    renderProvider(storage, vi.fn().mockReturnValue(pending.promise))
    expect(cart.phase).toBe('hydrating')
    expect(cart.isPartial).toBe(true)

    let result
    await act(async () => {
      result = await cart.addProduct({ productId: 13, slug: detailResponse().item.slug })
    })
    expect(result).toEqual({ status: 'rejected', reason: 'hydrating' })

    act(() => cart.clearCart())
    expect(cart.phase).toBe('ready')
    expect(cart.items).toHaveLength(0)
    pending.resolve(detailResponse())
    await settle()
    expect(cart.items).toHaveLength(0)
    expect(cart.totalUnits).toBe(0)
  })

  test('blocks duplicate operations and late non-cooperative results after clear', async () => {
    const pending = deferred<ProductDetailResponse>()
    renderProvider(new MemoryStorage(), vi.fn().mockReturnValue(pending.promise))
    let first!: Promise<unknown>
    act(() => {
      first = cart.addProduct({ productId: 13, slug: detailResponse().item.slug })
    })
    expect(cart.isProductPending(13)).toBe(true)
    expect(cart.isPartial).toBe(true)

    let duplicate
    await act(async () => {
      duplicate = await cart.addProduct({
        productId: 13,
        slug: detailResponse().item.slug,
      })
    })
    expect(duplicate).toEqual({ status: 'rejected', reason: 'busy' })

    act(() => cart.clearCart())
    pending.resolve(detailResponse())
    await act(async () => {
      await first
    })
    expect(cart.items).toHaveLength(0)
    expect(cart.totalUnits).toBe(0)
  })

  test('reports a canonical price change without trusting the observed price', async () => {
    renderProvider(
      new MemoryStorage(),
      vi.fn().mockResolvedValue(detailResponse({ price: 52.3 })),
    )
    let result
    await act(async () => {
      result = await cart.addProduct({
        productId: 13,
        slug: detailResponse().item.slug,
        observedPriceCents: 4_890,
      })
    })
    expect(result).toEqual({
      status: 'success',
      quantity: 1,
      priceChanged: true,
    })
    expect(cart.subtotalCents).toBe(5_230)
  })

  test('keeps the in-memory cart usable when storage quota fails', async () => {
    const storage: CartStorage = {
      getItem: () => null,
      setItem: () => {
        throw new DOMException('Quota exceeded', 'QuotaExceededError')
      },
      removeItem: () => undefined,
    }
    renderProvider(storage, vi.fn().mockResolvedValue(detailResponse()))
    await act(async () => {
      await cart.addProduct({ productId: 13, slug: detailResponse().item.slug })
    })
    expect(cart.totalUnits).toBe(1)
    expect(cart.persistenceStatus).toBe('unavailable')
  })

  test('keeps the application ready when storage cannot be read', () => {
    const storage: CartStorage = {
      getItem: () => {
        throw new DOMException('Blocked', 'SecurityError')
      },
      setItem: () => undefined,
      removeItem: () => undefined,
    }
    renderProvider(storage, vi.fn())
    expect(cart.phase).toBe('ready')
    expect(cart.items).toHaveLength(0)
    expect(cart.persistenceStatus).toBe('unavailable')
  })
})
