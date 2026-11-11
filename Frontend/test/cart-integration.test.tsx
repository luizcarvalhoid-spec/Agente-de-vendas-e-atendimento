import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { MemoryRouter } from 'react-router'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'

import Header from '../src/Pages/Header'
import CartDeferredPage from '../src/Pages/CartDeferredPage'
import ProductCard from '../src/Pages/ProductCard'
import type { ChatRecommendationResponse } from '../src/api/chat-contracts'
import type {
  CatalogProductSummary,
  ProductDetailResponse,
} from '../src/api/contracts'
import CartProvider from '../src/cart/CartProvider'
import { CART_STORAGE_KEY, type CartStorage } from '../src/cart/cart-model'
import { useCart } from '../src/cart/useCart'
import ChatProductCards from '../src/components/ChatProductCards'
import ProductDetailView from '../src/components/ProductDetailView'

const classification = {
  commercial: 'fictional-demo',
  compatibility: 'commercial-positioning',
  formulation: 'synthetic-test-data',
  safety: 'not-evaluated',
} as const

const summary: CatalogProductSummary = {
  id: 13,
  slug: 'shampoo-anticaspa-controle-oleosidade-limao-siciliano-hortela',
  name: 'Shampoo Anticaspa Controle de Oleosidade',
  brand: 'HidraSplash',
  isDemo: true,
  dataClassification: classification,
  category: 'shampoos',
  subcategory: 'anticaspa',
  applicationArea: 'hair',
  productKind: 'single',
  shortDescription: 'Perfil refrescante para couro cabeludo oleoso.',
  price: 48.9,
  stock: 14,
  imageUrl: 'http://api.test/api/catalog/images/shampoo-anticaspa.jpg',
}

const detail: ProductDetailResponse = {
  item: {
    ...summary,
    description: 'Descrição canônica demonstrativa.',
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
    primaryUrl: summary.imageUrl,
    galleryUrls: [],
  },
}

const recommendation: ChatRecommendationResponse = {
  type: 'recommendation',
  message: 'Recomendação demonstrativa fundamentada.',
  productIds: [summary.id],
  products: [
    {
      id: summary.id,
      slug: summary.slug,
      name: summary.name,
      brand: summary.brand,
      isDemo: true,
      dataClassification: summary.dataClassification,
      category: summary.category,
      subcategory: summary.subcategory,
      shortDescription: summary.shortDescription,
      price: summary.price,
      stock: summary.stock,
      imageUrl: '/api/catalog/images/shampoo-anticaspa.jpg',
    },
  ],
  sourceIds: [],
  requestId: '00000000-0000-4000-8000-000000000001',
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

async function settle() {
  await act(async () => {
    await Promise.resolve()
    await Promise.resolve()
  })
}

describe('shared cart integrations', () => {
  let container: HTMLDivElement
  let root: Root

  beforeEach(() => {
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
    vi.stubEnv('VITE_API_URL', 'http://api.test')
    container = document.createElement('div')
    document.body.append(container)
    root = createRoot(container)
  })

  afterEach(() => {
    act(() => root.unmount())
    container.remove()
    vi.unstubAllEnvs()
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  test('vitrine, PDP and chat share one action and update the accessible Header count', async () => {
    const storage = new MemoryStorage()
    const loadProduct = vi.fn().mockResolvedValue(detail)

    function CartObserver() {
      const cart = useCart()
      return <output data-testid="units">{cart.totalUnits}</output>
    }

    act(() =>
      root.render(
        <MemoryRouter>
          <CartProvider storage={storage} loadProduct={loadProduct}>
            <Header />
            <CartObserver />
            <div data-testid="storefront">
              <ProductCard product={summary} catalogReturnTo="/" />
            </div>
            <div data-testid="pdp">
              <ProductDetailView response={detail} returnTo="/" />
            </div>
            <div data-testid="chat">
              <ChatProductCards response={recommendation} restored={false} />
            </div>
          </CartProvider>
        </MemoryRouter>,
      ),
    )
    await settle()

    const storefront = container.querySelector('[data-testid="storefront"]')!
    expect(storefront.querySelector('a button')).toBeNull()
    expect(storefront.querySelector('button a')).toBeNull()
    expect(storefront.querySelector('a')?.getAttribute('href')).toBe(
      `/produtos/${summary.slug}`,
    )

    const buttons = Array.from(
      container.querySelectorAll<HTMLButtonElement>(
        'button:not([disabled])',
      ),
    ).filter((button) => button.textContent?.includes('Adicionar ao carrinho'))
    expect(buttons).toHaveLength(3)

    for (const [index, button] of buttons.entries()) {
      act(() => button.focus())
      expect(document.activeElement).toBe(button)
      await act(async () => {
        button.click()
        await Promise.resolve()
        await Promise.resolve()
      })
      expect(container.querySelector('[data-testid="units"]')?.textContent).toBe(
        String(index + 1),
      )
      expect(
        container
          .querySelector('a[href="/carrinho"]')
          ?.getAttribute('aria-label'),
      ).toContain(`${index + 1} ${index === 0 ? 'unidade' : 'unidades'}`)
    }

    expect(loadProduct).toHaveBeenCalledTimes(3)
    expect(container.textContent).toContain(
      'foi adicionado ao carrinho demonstrativo',
    )
    expect(JSON.parse(storage.getItem(CART_STORAGE_KEY)!)).toEqual({
      version: 1,
      items: [
        {
          productId: 13,
          slug: summary.slug,
          quantity: 3,
        },
      ],
    })
  })

  test('historical snapshots do not offer cart action before canonical confirmation', async () => {
    const pending = new Promise<Response>(() => undefined)
    vi.stubGlobal('fetch', vi.fn().mockReturnValue(pending))
    act(() =>
      root.render(
        <MemoryRouter>
          <CartProvider storage={null} loadProduct={vi.fn()}>
            <ChatProductCards response={recommendation} restored />
          </CartProvider>
        </MemoryRouter>,
      ),
    )
    await settle()
    expect(container.textContent).toContain(
      'Snapshot histórico — verificando dados atuais',
    )
    expect(container.textContent).not.toContain('Adicionar ao carrinho')
  })

  test('cart route announces hydration without flashing an empty state', async () => {
    const storage = new MemoryStorage()
    storage.setItem(
      CART_STORAGE_KEY,
      JSON.stringify({
        version: 1,
        items: [{ productId: 13, slug: summary.slug, quantity: 2 }],
      }),
    )
    let resolve!: (value: ProductDetailResponse) => void
    const pending = new Promise<ProductDetailResponse>((done) => {
      resolve = done
    })
    act(() =>
      root.render(
        <MemoryRouter>
          <CartProvider storage={storage} loadProduct={() => pending}>
            <CartDeferredPage />
          </CartProvider>
        </MemoryRouter>,
      ),
    )
    expect(container.textContent).toContain('Validando os itens salvos')
    expect(container.textContent).not.toContain('carrinho demonstrativo está vazio')

    resolve(detail)
    await settle()
    expect(container.textContent).toContain('2 unidades confirmadas')
  })
})
