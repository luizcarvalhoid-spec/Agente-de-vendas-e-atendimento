import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { MemoryRouter, Route, Routes } from 'react-router'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'

import CartPage from '../src/Pages/CartPage'
import CheckoutDemoPage from '../src/Pages/CheckoutDemoPage'
import type { ProductDetailResponse } from '../src/api/contracts'
import CartProvider from '../src/cart/CartProvider'
import { CART_STORAGE_KEY, type CartStorage } from '../src/cart/cart-model'

const slug = 'shampoo-anticaspa-controle-oleosidade-limao-siciliano-hortela'

const classification = {
  commercial: 'fictional-demo',
  compatibility: 'commercial-positioning',
  formulation: 'synthetic-test-data',
  safety: 'not-evaluated',
} as const

function detail(
  overrides: Partial<ProductDetailResponse['item']> = {},
): ProductDetailResponse {
  const currentSlug = overrides.slug ?? slug
  return {
    item: {
      id: 13,
      slug: currentSlug,
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
      primaryUrl: `http://api.test/api/catalog/images/${currentSlug}.jpg`,
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

function storageWithItem(quantity = 1) {
  const storage = new MemoryStorage()
  storage.setItem(
    CART_STORAGE_KEY,
    JSON.stringify({
      version: 1,
      items: [{ productId: 13, slug, quantity }],
    }),
  )
  return storage
}

async function settle() {
  await act(async () => {
    await Promise.resolve()
    await Promise.resolve()
  })
}

describe('cart and demonstration checkout pages', () => {
  let container: HTMLDivElement
  let root: Root

  beforeEach(() => {
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
      callback(0)
      return 1
    })
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

  function renderRoute(
    initialEntry: '/carrinho' | '/checkout-demo',
    storage: CartStorage,
    loadProduct: (slug: string, signal?: AbortSignal) => Promise<ProductDetailResponse>,
  ) {
    act(() =>
      root.render(
        <MemoryRouter initialEntries={[initialEntry]}>
          <CartProvider storage={storage} loadProduct={loadProduct}>
            <Routes>
              <Route path="/carrinho" element={<CartPage />} />
              <Route path="/checkout-demo" element={<CheckoutDemoPage />} />
              <Route path="/" element={<output>Vitrine demonstrativa</output>} />
            </Routes>
          </CartProvider>
        </MemoryRouter>,
      ),
    )
  }

  test('renders canonical cart data, accessible quantity controls and checkout navigation', async () => {
    const loader = vi.fn().mockResolvedValue(detail())
    renderRoute('/carrinho', storageWithItem(2), loader)
    await settle()

    expect(container.textContent).toContain('Carrinho demonstrativo')
    expect(container.textContent).toContain('Preço unitário: R$ 48,90')
    expect(container.textContent).toContain('Subtotal do item: R$ 97,80')
    expect(
      container.querySelector<HTMLImageElement>(
        'main img[alt="Shampoo Anticaspa Controle de Oleosidade"]',
      ),
    ).not.toBeNull()
    expect(
      container.querySelector('button[aria-label^="Diminuir quantidade"]'),
    ).not.toBeNull()
    expect(
      container.querySelector('button[aria-label^="Aumentar quantidade"]'),
    ).not.toBeNull()
    expect(
      container.querySelector('a[href="/checkout-demo"]')?.textContent,
    ).toContain('Revisar checkout demonstrativo')

    const increase = container.querySelector<HTMLButtonElement>(
      'button[aria-label^="Aumentar quantidade"]',
    )!
    await act(async () => {
      increase.click()
      await Promise.resolve()
      await Promise.resolve()
    })
    expect(container.textContent).toContain('Quantidade de Shampoo Anticaspa')
    expect(container.textContent).toContain('Subtotal do item: R$ 146,70')

    const remove = container.querySelector<HTMLButtonElement>(
      'button[aria-label^="Remover Shampoo"]',
    )!
    act(() => remove.click())
    expect(container.textContent).toContain('Seu carrinho está vazio')
    expect(document.activeElement?.textContent).toContain('Carrinho demonstrativo')
  })

  test('clears the complete cart through the provider action', async () => {
    const storage = storageWithItem()
    renderRoute('/carrinho', storage, vi.fn().mockResolvedValue(detail()))
    await settle()
    const clear = Array.from(container.querySelectorAll('button')).find(
      (button) => button.textContent?.includes('Limpar carrinho'),
    )!
    act(() => clear.click())

    expect(container.textContent).toContain('Seu carrinho está vazio')
    expect(container.textContent).toContain('carrinho demonstrativo foi limpo')
    expect(storage.getItem(CART_STORAGE_KEY)).toBeNull()
  })

  test('keeps a failed reference visible, excludes it from totals and blocks checkout', async () => {
    renderRoute(
      '/carrinho',
      storageWithItem(),
      vi.fn().mockRejectedValue(new Error('offline')),
    )
    await settle()

    expect(container.textContent).toContain('Item fora dos valores confirmados')
    expect(container.textContent).toContain('Não foi possível validar o produto')
    expect(container.textContent).toContain('Valores confirmados parciais')
    expect(container.querySelector('a[href="/checkout-demo"]')).toBeNull()
    expect(
      container.querySelector<HTMLButtonElement>(
        'button[aria-describedby="checkout-disabled-reason"]',
      )?.disabled,
    ).toBe(true)
    expect(container.textContent).toContain('Tentar validar novamente')
    expect(container.textContent).toContain('Remover')
  })

  test('supports empty cart, removal and clearing without creating commercial success', async () => {
    renderRoute('/carrinho', new MemoryStorage(), vi.fn())
    await settle()
    expect(container.textContent).toContain('Seu carrinho está vazio')
    expect(container.querySelector('a[href="/checkout-demo"]')).toBeNull()
    expect(container.textContent).not.toContain(
      'Pedido demonstrativo gerado — nenhuma compra foi efetuada.',
    )
  })

  test('confirms only after final revalidation, clears persistence and requests no personal data', async () => {
    const storage = storageWithItem(2)
    const loader = vi.fn().mockResolvedValue(detail())
    renderRoute('/checkout-demo', storage, loader)
    await settle()

    expect(container.textContent).toContain('Checkout demonstrativo')
    expect(container.textContent).toContain('Nenhum dado pessoal')
    expect(container.querySelector('main input')).toBeNull()
    expect(container.querySelector('main form')).toBeNull()
    const confirm = Array.from(container.querySelectorAll('button')).find(
      (button) => button.textContent?.includes('Confirmar demonstração'),
    )!

    await act(async () => {
      confirm.click()
      await Promise.resolve()
      await Promise.resolve()
    })
    expect(loader).toHaveBeenCalledTimes(2)
    expect(container.textContent).toContain(
      'Pedido demonstrativo gerado — nenhuma compra foi efetuada.',
    )
    expect(container.textContent).toContain('2 unidades')
    expect(container.textContent).toContain('R$ 110,70')
    expect(container.textContent).not.toContain('Confirmar demonstração')
    expect(storage.getItem(CART_STORAGE_KEY)).toBeNull()
    expect(document.activeElement?.textContent).toContain(
      'Pedido demonstrativo gerado',
    )

    const restart = Array.from(container.querySelectorAll('button')).find(
      (button) => button.textContent?.includes('Iniciar nova demonstração'),
    )!
    act(() => restart.click())
    expect(container.textContent).toContain('Vitrine demonstrativa')

    act(() => root.unmount())
    root = createRoot(container)
    renderRoute('/checkout-demo', storage, loader)
    await settle()
    expect(container.textContent).toContain('Nenhum item para revisar')
    expect(container.textContent).not.toContain('Pedido demonstrativo gerado')
  })

  test('shows updated commercial data and requires a second explicit confirmation', async () => {
    const loader = vi
      .fn()
      .mockResolvedValueOnce(detail())
      .mockResolvedValue(detail({ price: 52.3, stock: 12 }))
    renderRoute('/checkout-demo', storageWithItem(), loader)
    await settle()

    const clickConfirm = async () => {
      const button = Array.from(container.querySelectorAll('button')).find(
        (candidate) => candidate.textContent?.includes('Confirmar demonstração'),
      )!
      await act(async () => {
        button.click()
        await Promise.resolve()
        await Promise.resolve()
      })
    }

    await clickConfirm()
    expect(container.textContent).toContain('Preço ou disponibilidade foram atualizados')
    expect(container.textContent).toContain('R$ 52,30')
    expect(container.textContent).not.toContain('Pedido demonstrativo gerado')
    expect(loader).toHaveBeenCalledTimes(2)

    await clickConfirm()
    expect(loader).toHaveBeenCalledTimes(3)
    expect(container.textContent).toContain(
      'Pedido demonstrativo gerado — nenhuma compra foi efetuada.',
    )
  })

  test('blocks direct checkout access for an empty cart', async () => {
    renderRoute('/checkout-demo', new MemoryStorage(), vi.fn())
    await settle()
    expect(container.textContent).toContain('Nenhum item para revisar')
    expect(container.textContent).not.toContain('Confirmar demonstração')
    expect(container.querySelector('a[href="/"]')).not.toBeNull()
  })
})
