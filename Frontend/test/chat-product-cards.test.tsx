import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import {
  MemoryRouter,
  Route,
  Routes,
  useLocation,
} from 'react-router'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'

import type {
  ChatComparisonResponse,
  ChatProductCard,
  ChatRecommendationResponse,
} from '../src/api/chat-contracts'
import type { ProductDetailResponse } from '../src/api/contracts'
import ChatProductCards, {
  CHAT_PRODUCT_REFRESH_TIMEOUT_MS,
} from '../src/components/ChatProductCards'

const requestId = '00000000-0000-4000-8000-000000000001'

const product: ChatProductCard = {
  id: 13,
  slug: 'shampoo-anticaspa-controle-oleosidade-limao-siciliano-hortela',
  name: 'Shampoo Anticaspa Controle de Oleosidade',
  brand: 'HidraSplash',
  isDemo: true,
  category: 'shampoos',
  subcategory: 'anticaspa',
  shortDescription: 'Perfil refrescante para couro cabeludo oleoso.',
  price: 48.9,
  originalPrice: 59.9,
  stock: 14,
  imageUrl: '/api/catalog/images/shampoo-anticaspa.jpg',
  dataClassification: {
    commercial: 'fictional-demo',
    compatibility: 'commercial-positioning',
    formulation: 'synthetic-test-data',
    safety: 'not-evaluated',
  },
}

const otherProduct: ChatProductCard = {
  ...product,
  id: 9,
  slug: 'shampoo-anticaspa-coco-nivel-2',
  name: 'Shampoo Anticaspa Coco — Nível 2',
  price: 46.9,
  stock: 12,
  imageUrl: '/api/catalog/images/shampoo-anticaspa-coco.jpg',
}

const recommendation: ChatRecommendationResponse = {
  type: 'recommendation',
  message: 'Recomendo o produto 13. Não use o ID 9 citado como exemplo.',
  productIds: [13],
  products: [product],
  sourceIds: [],
  requestId,
}

const comparison: ChatComparisonResponse = {
  type: 'comparison',
  message: 'Comparei as duas opções demonstrativas.',
  productIds: [13, 9],
  products: [product, otherProduct],
  sourceIds: [],
  requestId,
}

function detailResponse(
  overrides: Partial<ProductDetailResponse['item']> = {},
  mediaOverrides: Partial<ProductDetailResponse['media']> = {},
): ProductDetailResponse {
  return {
    item: {
      id: product.id,
      slug: product.slug,
      name: product.name,
      brand: product.brand,
      isDemo: true,
      dataClassification: product.dataClassification,
      category: 'shampoos',
      subcategory: 'anticaspa',
      applicationArea: 'hair',
      productKind: 'single',
      description: 'Descrição canônica demonstrativa.',
      shortDescription: product.shortDescription,
      price: product.price,
      originalPrice: product.originalPrice,
      image: 'images/shampoo-anticaspa.jpg',
      stock: product.stock,
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
      primaryUrl: '/api/catalog/images/shampoo-anticaspa-atual.jpg',
      galleryUrls: [],
      ...mediaOverrides,
    },
  }
}

function jsonResponse(body: unknown, init: ResponseInit = {}) {
  return new Response(JSON.stringify(body), {
    status: init.status ?? 200,
    headers: { 'Content-Type': 'application/json', ...init.headers },
  })
}

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((done) => {
    resolve = done
  })
  return { promise, resolve }
}

async function settle() {
  await act(async () => {
    await Promise.resolve()
    await Promise.resolve()
  })
}

describe('ChatProductCards', () => {
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
    vi.useRealTimers()
    vi.unstubAllEnvs()
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  function renderCards(
    response: ChatRecommendationResponse | ChatComparisonResponse,
    restored = false,
    initialEntry = '/',
  ) {
    act(() =>
      root.render(
        <MemoryRouter initialEntries={[initialEntry]}>
          <ChatProductCards response={response} restored={restored} />
        </MemoryRouter>,
      ),
    )
  }

  test('renders one validated recommendation without inferring a product from model text', () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    renderCards(recommendation)

    expect(container.querySelectorAll('article')).toHaveLength(1)
    expect(container.textContent).toContain(product.name)
    expect(container.textContent).not.toContain(otherProduct.name)
    expect(container.textContent).toContain(product.brand)
    expect(container.textContent).toContain(product.shortDescription)
    expect(container.textContent).toContain('48,90')
    expect(container.textContent).toContain('14 unidades demonstrativas')
    expect(
      container.querySelector('article')?.getAttribute('data-product-id'),
    ).toBe('13')
    expect(container.querySelector('img')?.getAttribute('src')).toBe(
      'http://api.test/api/catalog/images/shampoo-anticaspa.jpg',
    )
    expect(fetchMock).not.toHaveBeenCalled()
  })

  test('renders two distinct comparison cards in a single-column layout', () => {
    vi.stubGlobal('fetch', vi.fn())
    renderCards(comparison)

    expect(container.querySelectorAll('article')).toHaveLength(2)
    expect(container.textContent).toContain(product.name)
    expect(container.textContent).toContain(otherProduct.name)
    const grid = container.querySelector('[data-testid="chat-product-cards"] > div')
    expect(grid?.className).toContain('grid-cols-1')
    expect(grid?.className).not.toContain('overflow-x')
    expect(container.querySelectorAll('a')).toHaveLength(2)
    expect(
      Array.from(container.querySelectorAll('a')).every((link) =>
        link.className.includes('min-h-11'),
      ),
    ).toBe(true)
    const firstDetails = container.querySelector<HTMLAnchorElement>('a')!
    act(() => firstDetails.focus())
    expect(document.activeElement).toBe(firstDetails)
  })

  test('navigates Details to the validated PDP and preserves a canonical catalog return', () => {
    function Destination() {
      const location = useLocation()
      return (
        <output data-testid="destination">
          {JSON.stringify({ pathname: location.pathname, state: location.state })}
        </output>
      )
    }

    act(() =>
      root.render(
        <MemoryRouter
          initialEntries={['/?category=shampoos&subcategory=anticaspa']}
        >
          <Routes>
            <Route
              path="/"
              element={
                <ChatProductCards
                  response={recommendation}
                  restored={false}
                />
              }
            />
            <Route path="/produtos/:slug" element={<Destination />} />
          </Routes>
        </MemoryRouter>,
      ),
    )

    const details = container.querySelector<HTMLAnchorElement>('a')!
    expect(details.getAttribute('href')).toBe(`/produtos/${product.slug}`)
    expect(details.getAttribute('aria-label')).toBe(
      `Ver detalhes de ${product.name}`,
    )
    act(() => details.click())
    expect(container.textContent).toContain(`/produtos/${product.slug}`)
    expect(container.textContent).toContain(
      '/?category=shampoos&subcategory=anticaspa',
    )
  })

  test('uses an accessible fallback when the canonical image fails', () => {
    vi.stubGlobal('fetch', vi.fn())
    renderCards(recommendation)
    const image = container.querySelector<HTMLImageElement>('img')!
    expect(image.alt).toBe(product.name)
    act(() => image.dispatchEvent(new Event('error')))
    expect(container.textContent).toContain('Imagem indisponível')
    expect(container.querySelector('img')).toBeNull()
  })

  test('refreshes a historical snapshot once, preserves identity and reports commercial changes', async () => {
    const pending = deferred<Response>()
    const fetchMock = vi.fn().mockReturnValue(pending.promise)
    vi.stubGlobal('fetch', fetchMock)
    const original = structuredClone(recommendation)
    renderCards(recommendation, true)

    expect(container.textContent).toContain(
      'Snapshot histórico — verificando dados atuais',
    )
    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url, init] = fetchMock.mock.calls[0] ?? []
    expect(url).toBe(`http://api.test/api/products/${product.slug}`)
    expect(init?.method).toBe('GET')

    pending.resolve(
      jsonResponse(detailResponse({ price: 52.3, stock: 0 })),
    )
    await settle()
    expect(container.textContent).toContain('Dados atuais confirmados')
    expect(container.textContent).toContain('52,30')
    expect(container.textContent).toContain('Esgotado')
    expect(container.textContent).toContain(
      'Preço ou disponibilidade foram atualizados',
    )
    expect(container.querySelector('img')?.getAttribute('src')).toBe(
      'http://api.test/api/catalog/images/shampoo-anticaspa-atual.jpg',
    )
    expect(recommendation).toEqual(original)

    renderCards(recommendation, true)
    await settle()
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(
      fetchMock.mock.calls.some(([, request]) => request?.method === 'POST'),
    ).toBe(false)
  })

  test.each([
    { id: 99 },
    { slug: 'outro-produto-validado' },
  ])('rejects a canonical result with divergent identity %#', async (identity) => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse(detailResponse(identity)),
    )
    vi.stubGlobal('fetch', fetchMock)
    renderCards(recommendation, true)
    await settle()

    expect(container.textContent).toContain('Produto indisponível no catálogo atual')
    expect(container.querySelector('a')).toBeNull()
    expect(container.textContent).not.toContain('Dados atuais confirmados')
  })

  test('removes actions when the canonical product no longer exists', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        jsonResponse(
          { code: 'NOT_FOUND', message: 'Produto não encontrado.' },
          { status: 404 },
        ),
      ),
    )
    renderCards(recommendation, true)
    await settle()

    expect(container.textContent).toContain('Produto indisponível no catálogo atual')
    expect(container.querySelector('a')).toBeNull()
  })

  test('keeps a failed refresh explicitly historical and leaves Details safe', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('offline')))
    renderCards(recommendation, true)
    await settle()

    expect(container.textContent).toContain(
      'Snapshot histórico — não foi possível confirmar os dados atuais',
    )
    expect(container.textContent).toContain('Estoque registrado: 14')
    expect(container.querySelector('a')?.getAttribute('href')).toBe(
      `/produtos/${product.slug}`,
    )
  })

  test('times out a non-cooperative refresh and ignores its late result', async () => {
    vi.useFakeTimers()
    const pending = deferred<Response>()
    let signal: AbortSignal | undefined
    vi.stubGlobal(
      'fetch',
      vi.fn((_url, init: RequestInit) => {
        signal = init.signal as AbortSignal
        return pending.promise
      }),
    )
    renderCards(recommendation, true)
    act(() => vi.advanceTimersByTime(CHAT_PRODUCT_REFRESH_TIMEOUT_MS))

    expect(signal?.aborted).toBe(true)
    expect(container.textContent).toContain('excedeu o tempo limite')
    pending.resolve(jsonResponse(detailResponse({ price: 99.9 })))
    await settle()
    expect(container.textContent).toContain('excedeu o tempo limite')
    expect(container.textContent).not.toContain('99,90')
  })

  test('aborts an in-flight canonical refresh on unmount', () => {
    const pending = deferred<Response>()
    let signal: AbortSignal | undefined
    vi.stubGlobal(
      'fetch',
      vi.fn((_url, init: RequestInit) => {
        signal = init.signal as AbortSignal
        return pending.promise
      }),
    )
    renderCards(recommendation, true)
    act(() => root.unmount())
    expect(signal?.aborted).toBe(true)

    container.remove()
    container = document.createElement('div')
    document.body.append(container)
    root = createRoot(container)
  })
})
