import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { MemoryRouter, Route, Routes } from 'react-router'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'

import Header from '../src/Pages/Header'
import type { ProductDetailResponse } from '../src/api/contracts'
import CartProvider from '../src/cart/CartProvider'
import { CART_STORAGE_KEY, type CartStorage } from '../src/cart/cart-model'

const slug = 'shampoo-anticaspa-controle-oleosidade'

const detail: ProductDetailResponse = {
  item: {
    id: 13,
    slug,
    name: 'Shampoo Anticaspa Controle de Oleosidade',
    brand: 'HidraSplash',
    isDemo: true,
    dataClassification: {
      commercial: 'fictional-demo',
      compatibility: 'commercial-positioning',
      formulation: 'synthetic-test-data',
      safety: 'not-evaluated',
    },
    category: 'shampoos',
    subcategory: 'anticaspa',
    applicationArea: 'hair',
    productKind: 'single',
    description: 'Descrição canônica demonstrativa.',
    shortDescription: 'Perfil refrescante para couro cabeludo oleoso.',
    price: 48.9,
    stock: 14,
    image: 'images/shampoo-anticaspa.jpg',
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
  },
  media: {
    primaryUrl: '/api/catalog/images/shampoo-anticaspa.jpg',
    galleryUrls: [],
  },
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

function storageWithItems(includeProblem = false) {
  const storage = new MemoryStorage()
  storage.setItem(
    CART_STORAGE_KEY,
    JSON.stringify({
      version: 1,
      items: [
        { productId: 13, slug, quantity: 1 },
        ...(includeProblem
          ? [{ productId: 99, slug: 'produto-nao-confirmado', quantity: 1 }]
          : []),
      ],
    }),
  )
  return storage
}

async function settle() {
  await act(async () => {
    await Promise.resolve()
    await Promise.resolve()
    await Promise.resolve()
  })
}

describe('Header mini-cart', () => {
  let container: HTMLDivElement
  let root: Root
  let rootMounted: boolean

  beforeEach(() => {
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
      callback(0)
      return 1
    })
    vi.stubGlobal('cancelAnimationFrame', vi.fn())
    container = document.createElement('div')
    document.body.append(container)
    root = createRoot(container)
    rootMounted = true
  })

  afterEach(() => {
    if (rootMounted) act(() => root.unmount())
    container.remove()
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  function renderHeader({
    includeProblem = false,
    productDetail = detail,
  }: {
    includeProblem?: boolean
    productDetail?: ProductDetailResponse
  } = {}) {
    const loadProduct = vi.fn((requestedSlug: string) => {
      if (requestedSlug === slug) return Promise.resolve(productDetail)
      return Promise.reject(new Error('Falha controlada de validação'))
    })
    act(() =>
      root.render(
        <MemoryRouter>
          <CartProvider
            storage={storageWithItems(includeProblem)}
            loadProduct={loadProduct}
          >
            <Header />
            <Routes>
              <Route path="/" element={<output>Página inicial</output>} />
              <Route path="/carrinho" element={<output>Rota do carrinho</output>} />
              <Route
                path="/checkout-demo"
                element={<output>Rota do checkout demonstrativo</output>}
              />
            </Routes>
          </CartProvider>
        </MemoryRouter>,
      ),
    )
    return loadProduct
  }

  const trigger = () =>
    container.querySelector<HTMLButtonElement>('button[aria-haspopup="dialog"]')!
  const openMiniCart = () => act(() => trigger().click())

  test('opens from the Header and shows shared cart items and demonstrative totals', async () => {
    const loadProduct = renderHeader()
    await settle()

    expect(trigger().getAttribute('aria-expanded')).toBe('false')
    openMiniCart()

    const dialog = container.querySelector<HTMLElement>('[role="dialog"]')!
    expect(dialog).not.toBeNull()
    expect(trigger().getAttribute('aria-expanded')).toBe('true')
    expect(dialog.textContent).toContain(detail.item.name)
    expect(dialog.textContent).toContain('1 unidade')
    expect(dialog.textContent).toContain('48,90')
    expect(dialog.textContent).toContain('12,90')
    expect(dialog.textContent).toContain('61,80')
    expect(loadProduct).toHaveBeenCalledTimes(1)
    expect(document.activeElement).toBe(
      container.querySelector('button[aria-label="Fechar resumo do carrinho"]'),
    )
  })

  test('closes with Escape and an outside pointer, returning focus to the trigger', async () => {
    renderHeader()
    await settle()
    openMiniCart()

    act(() =>
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' })),
    )
    expect(container.querySelector('[role="dialog"]')).toBeNull()
    expect(document.activeElement).toBe(trigger())

    openMiniCart()
    act(() =>
      document.body.dispatchEvent(new Event('pointerdown', { bubbles: true })),
    )
    expect(container.querySelector('[role="dialog"]')).toBeNull()
    expect(document.activeElement).toBe(trigger())
  })

  test('keeps Tab and Shift+Tab contained inside the modal mini-cart', async () => {
    renderHeader()
    await settle()
    openMiniCart()

    const dialog = container.querySelector<HTMLElement>('[role="dialog"]')!
    const focusableElements = Array.from(
      dialog.querySelectorAll<HTMLElement>(
        'a[href], button:not([disabled]), [tabindex]:not([tabindex="-1"])',
      ),
    )
    const firstElement = focusableElements[0]
    const lastElement = focusableElements[focusableElements.length - 1]

    expect(dialog.getAttribute('aria-modal')).toBe('true')
    act(() => lastElement.focus())
    act(() =>
      document.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'Tab', bubbles: true }),
      ),
    )
    expect(document.activeElement).toBe(firstElement)

    act(() => firstElement.focus())
    act(() =>
      document.dispatchEvent(
        new KeyboardEvent('keydown', {
          key: 'Tab',
          shiftKey: true,
          bubbles: true,
        }),
      ),
    )
    expect(document.activeElement).toBe(lastElement)
  })

  test('removes an item through the shared CartProvider without leaving a ghost line', async () => {
    renderHeader()
    await settle()
    openMiniCart()

    const removeButton = container.querySelector<HTMLButtonElement>(
      `button[aria-label^="Remover ${detail.item.name}"]`,
    )!
    const closeButton = container.querySelector<HTMLButtonElement>(
      'button[aria-label="Fechar resumo do carrinho"]',
    )!
    act(() => removeButton.focus())
    act(() => removeButton.click())

    expect(container.textContent).toContain('Seu carrinho está vazio')
    expect(container.textContent).not.toContain(detail.item.name)
    expect(trigger().getAttribute('aria-label')).toContain('0 unidades confirmadas')
    expect(document.activeElement).toBe(closeButton)
  })

  test('shows an accessible fallback when the product image URL is absent', async () => {
    renderHeader({
      productDetail: {
        ...detail,
        media: { ...detail.media, primaryUrl: '' },
      },
    })
    await settle()
    openMiniCart()

    const dialog = container.querySelector<HTMLElement>('[role="dialog"]')!
    expect(dialog.querySelector('img')).toBeNull()
    expect(
      dialog
        .querySelector('[role="img"]')
        ?.getAttribute('aria-label'),
    ).toBe(`Imagem indisponível para ${detail.item.name}`)
  })

  test('isolates a real image loading error behind the accessible fallback', async () => {
    renderHeader()
    await settle()
    openMiniCart()

    const dialog = container.querySelector<HTMLElement>('[role="dialog"]')!
    const image = dialog.querySelector<HTMLImageElement>('img.object-contain')!
    expect(image).not.toBeNull()
    expect(image.className).toContain('object-contain')

    act(() => image.dispatchEvent(new Event('error', { bubbles: true })))

    expect(dialog.querySelector('img.object-contain')).toBeNull()
    expect(
      dialog
        .querySelector('[role="img"]')
        ?.getAttribute('aria-label'),
    ).toBe(`Imagem indisponível para ${detail.item.name}`)
  })

  test('reports partial validation honestly and blocks direct checkout', async () => {
    renderHeader({ includeProblem: true })
    await settle()
    openMiniCart()

    const dialog = container.querySelector<HTMLElement>('[role="dialog"]')!
    expect(dialog.textContent).toContain('1 item precisa de revisão')
    expect(dialog.textContent).toContain('Subtotal confirmado')
    expect(dialog.textContent).toContain('Total parcial')
    expect(
      Array.from(dialog.querySelectorAll('button')).find(
        (button) => button.textContent?.trim() === 'Finalizar compra',
      )?.disabled,
    ).toBe(true)
    expect(dialog.querySelector('a[href="/checkout-demo"]')).toBeNull()
  })

  test('keeps the full cart and checkout routes as explicit destinations', async () => {
    renderHeader()
    await settle()
    openMiniCart()

    const dialog = container.querySelector<HTMLElement>('[role="dialog"]')!
    expect(dialog.querySelector('a[href="/carrinho"]')).not.toBeNull()
    const checkoutLink = dialog.querySelector<HTMLAnchorElement>(
      'a[href="/checkout-demo"]',
    )!
    expect(checkoutLink).not.toBeNull()

    act(() => checkoutLink.focus())
    act(() => checkoutLink.click())
    expect(container.textContent).toContain('Rota do checkout demonstrativo')
    expect(container.querySelector('[role="dialog"]')).toBeNull()
    expect(document.activeElement).not.toBe(trigger())
  })

  test('navigates to the complete cart without starting checkout', async () => {
    renderHeader()
    await settle()
    openMiniCart()

    const cartLink = container.querySelector<HTMLAnchorElement>(
      '[role="dialog"] a[href="/carrinho"]',
    )!
    act(() => cartLink.focus())
    act(() => cartLink.click())
    expect(container.textContent).toContain('Rota do carrinho')
    expect(container.textContent).not.toContain('Rota do checkout demonstrativo')
    expect(container.querySelector('[role="dialog"]')).toBeNull()
    expect(document.activeElement).not.toBe(trigger())
  })

  test('removes document listeners after closing and unmounting', async () => {
    renderHeader()
    await settle()
    const addListenerSpy = vi.spyOn(document, 'addEventListener')
    const removeListenerSpy = vi.spyOn(document, 'removeEventListener')

    openMiniCart()
    const firstKeydownHandler = addListenerSpy.mock.calls.find(
      ([eventName]) => eventName === 'keydown',
    )?.[1]
    const firstPointerHandler = addListenerSpy.mock.calls.find(
      ([eventName]) => eventName === 'pointerdown',
    )?.[1]
    expect(firstKeydownHandler).toBeTypeOf('function')
    expect(firstPointerHandler).toBeTypeOf('function')

    act(() =>
      container
        .querySelector<HTMLButtonElement>('button[aria-label="Fechar resumo do carrinho"]')!
        .click(),
    )
    expect(removeListenerSpy).toHaveBeenCalledWith(
      'keydown',
      firstKeydownHandler,
    )
    expect(removeListenerSpy).toHaveBeenCalledWith(
      'pointerdown',
      firstPointerHandler,
    )

    openMiniCart()
    const keydownHandlers = addListenerSpy.mock.calls.filter(
      ([eventName]) => eventName === 'keydown',
    )
    const pointerHandlers = addListenerSpy.mock.calls.filter(
      ([eventName]) => eventName === 'pointerdown',
    )
    const lastKeydownHandler = keydownHandlers.at(-1)?.[1]
    const lastPointerHandler = pointerHandlers.at(-1)?.[1]

    act(() => root.unmount())
    rootMounted = false
    expect(removeListenerSpy).toHaveBeenCalledWith(
      'keydown',
      lastKeydownHandler,
    )
    expect(removeListenerSpy).toHaveBeenCalledWith(
      'pointerdown',
      lastPointerHandler,
    )
  })
})
