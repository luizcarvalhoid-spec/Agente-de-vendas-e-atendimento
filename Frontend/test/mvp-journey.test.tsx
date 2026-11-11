import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { MemoryRouter, Route, Routes } from 'react-router'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'

import App from '../src/App'
import ProductRoutePage from '../src/Pages/ProductRoutePage'
import type { ChatRequest } from '../src/api/chat-contracts'
import type {
  CatalogProductSummary,
  ProductDetailResponse,
} from '../src/api/contracts'
import { CART_STORAGE_KEY } from '../src/cart/cart-model'
import CartProvider from '../src/cart/CartProvider'

const slug = 'shampoo-anticaspa-controle-oleosidade-limao-siciliano-hortela'
const requestId = '00000000-0000-4000-8000-000000000065'
const classification = {
  commercial: 'fictional-demo',
  compatibility: 'commercial-positioning',
  formulation: 'synthetic-test-data',
  safety: 'not-evaluated',
} as const
const apiSummary: CatalogProductSummary = {
  id: 13,
  slug,
  name: 'Shampoo Anticaspa Controle de Oleosidade Limão Siciliano & Hortelã',
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
  imageUrl: '/api/catalog/images/shampoo-anticaspa.jpg',
}
const apiDetail: ProductDetailResponse = {
  item: {
    ...apiSummary,
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
    primaryUrl: '/api/catalog/images/shampoo-anticaspa.jpg',
    galleryUrls: [],
  },
}

function response(body: unknown, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: new Headers(),
    json: async () => body,
  } as Response
}

function setInputValue(input: HTMLInputElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(
    HTMLInputElement.prototype,
    'value',
  )?.set
  act(() => {
    setter?.call(input, value)
    input.dispatchEvent(new Event('input', { bubbles: true }))
  })
}

async function settle() {
  await act(async () => {
    await Promise.resolve()
    await Promise.resolve()
  })
}

async function waitForText(container: HTMLElement, text: string) {
  for (let attempt = 0; attempt < 30; attempt += 1) {
    await settle()
    if (container.textContent?.includes(text)) return
    await act(async () => new Promise((resolve) => window.setTimeout(resolve, 0)))
  }
  throw new Error(`Texto não encontrado: ${text}`)
}

describe('M1 offline DOM integration journey', () => {
  let container: HTMLDivElement
  let root: Root

  beforeEach(() => {
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
    vi.stubEnv('VITE_API_URL', 'http://api.test')
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
      callback(0)
      return 1
    })
    vi.stubGlobal('cancelAnimationFrame', vi.fn())
    vi.stubGlobal('scrollTo', vi.fn())
    Object.defineProperty(HTMLElement.prototype, 'scrollTo', {
      configurable: true,
      value: vi.fn(),
    })
    Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', {
      configurable: true,
      value: vi.fn(),
    })
    window.localStorage.clear()
    window.sessionStorage.clear()
    window.history.replaceState(null, '', '/')
    container = document.createElement('div')
    document.body.append(container)
    root = createRoot(container)
  })

  afterEach(() => {
    act(() => root.unmount())
    container.remove()
    window.localStorage.clear()
    window.sessionStorage.clear()
    vi.unstubAllEnvs()
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  test('walks from consultative clarification to a fictitious confirmed checkout', async () => {
    const chatBodies: ChatRequest[] = []
    const calls = { list: 0, detail: 0, chat: 0, health: 0 }
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL, init: RequestInit = {}) => {
        const url = new URL(String(input))
        expect(url.origin).toBe('http://api.test')
        const method = init.method ?? 'GET'

        if (url.pathname === '/api/health') {
          expect(method).toBe('GET')
          calls.health += 1
          return response({
            status: 'ok',
            service: 'hidrasplash-api',
            version: '0.1.0-demo',
          })
        }
        if (url.pathname === '/api/products') {
          expect(method).toBe('GET')
          expect(url.searchParams.get('page')).toBe('1')
          expect(url.searchParams.get('pageSize')).toBe('12')
          calls.list += 1
          return response({
            items: [apiSummary],
            pagination: {
              page: 1,
              pageSize: 12,
              totalItems: 1,
              totalPages: 1,
              hasPreviousPage: false,
              hasNextPage: false,
            },
          })
        }
        if (url.pathname === `/api/products/${slug}`) {
          expect(method).toBe('GET')
          calls.detail += 1
          return response(apiDetail)
        }
        if (url.pathname === '/api/chat') {
          expect(method).toBe('POST')
          expect(init.headers).toMatchObject({
            Accept: 'application/json',
            'Content-Type': 'application/json',
          })
          const body = JSON.parse(String(init.body)) as ChatRequest
          chatBodies.push(body)
          calls.chat += 1
          if (calls.chat === 1) {
            expect(body.message).toBe('Preciso de shampoo anticaspa.')
            expect(body.history).toEqual([])
            return response({
              type: 'text',
              message: 'Seu couro cabeludo é seco, normal ou oleoso?',
              reason: 'clarification',
              sourceIds: [],
              requestId,
            })
          }
          expect(body.message).toBe(
            'Meu couro cabeludo é oleoso, prefiro frescor e posso gastar até R$ 50.',
          )
          expect(body.history).toEqual([
            { role: 'user', content: 'Preciso de shampoo anticaspa.' },
            {
              role: 'assistant',
              content: 'Seu couro cabeludo é seco, normal ou oleoso?',
            },
          ])
          return response({
            type: 'recommendation',
            message: 'Recomendação demonstrativa fundamentada no catálogo.',
            productIds: [13],
            products: [
              {
                id: apiSummary.id,
                slug: apiSummary.slug,
                name: apiSummary.name,
                brand: apiSummary.brand,
                isDemo: true,
                dataClassification: classification,
                category: apiSummary.category,
                subcategory: apiSummary.subcategory,
                shortDescription: apiSummary.shortDescription,
                price: apiSummary.price,
                stock: apiSummary.stock,
                imageUrl: apiSummary.imageUrl,
              },
            ],
            sourceIds: [],
            requestId,
          })
        }
        throw new Error(`Endpoint inesperado no transporte offline: ${method} ${url}`)
      }),
    )

    act(() => root.render(<App />))
    await waitForText(container, '1 produto encontrado')

    const openChat = container.querySelector<HTMLButtonElement>(
      'button[aria-label="Abrir atendimento consultivo"]',
    )!
    act(() => openChat.click())
    const chatInput = () =>
      container.querySelector<HTMLInputElement>('[role="dialog"] input')!
    const send = () =>
      container.querySelector<HTMLButtonElement>(
        '[role="dialog"] button[aria-label="Enviar mensagem"]',
      )!

    setInputValue(chatInput(), 'Preciso de shampoo anticaspa.')
    act(() => send().click())
    await waitForText(container, 'Seu couro cabeludo é seco, normal ou oleoso?')
    setInputValue(
      chatInput(),
      'Meu couro cabeludo é oleoso, prefiro frescor e posso gastar até R$ 50.',
    )
    act(() => send().click())
    await waitForText(container, 'Produto recomendado')

    const detailsLink = container.querySelector<HTMLAnchorElement>(
      `a[href="/produtos/${slug}"][aria-label^="Ver detalhes"]`,
    )!
    act(() => detailsLink.click())
    await waitForText(container, 'Descrição canônica demonstrativa.')

    const add = Array.from(container.querySelectorAll('button')).find((button) =>
      button.textContent?.includes('Adicionar ao carrinho'),
    )!
    await act(async () => {
      add.click()
      await Promise.resolve()
      await Promise.resolve()
    })
    expect(
      container
        .querySelector('button[aria-haspopup="dialog"]')
        ?.getAttribute('aria-label'),
    ).toContain('1 unidade')

    act(() =>
      container
        .querySelector<HTMLButtonElement>('button[aria-haspopup="dialog"]')!
        .click(),
    )
    act(() => container.querySelector<HTMLAnchorElement>('a[href="/carrinho"]')!.click())
    await waitForText(container, 'Carrinho demonstrativo')
    expect(container.textContent).toContain('Subtotal do item: R$ 48,90')
    expect(container.textContent).toContain('R$ 12,90')
    expect(container.textContent).toContain('R$ 61,80')

    act(() =>
      container
        .querySelector<HTMLAnchorElement>('a[href="/checkout-demo"]')!
        .click(),
    )
    await waitForText(container, 'Checkout demonstrativo')
    const confirm = Array.from(container.querySelectorAll('button')).find(
      (button) => button.textContent?.includes('Confirmar demonstração'),
    )!
    await act(async () => {
      confirm.click()
      await Promise.resolve()
      await Promise.resolve()
    })
    await waitForText(
      container,
      'Pedido demonstrativo gerado — nenhuma compra foi efetuada.',
    )
    expect(window.localStorage.getItem(CART_STORAGE_KEY)).toBeNull()

    const restart = Array.from(container.querySelectorAll('button')).find(
      (button) => button.textContent?.includes('Iniciar nova demonstração'),
    )!
    act(() => restart.click())
    await waitForText(container, 'Produtos em destaque')

    expect(chatBodies).toHaveLength(2)
    expect(calls.chat).toBe(2)
    expect(calls.detail).toBe(3)
    expect(calls.list).toBe(2)
    expect(calls.health).toBeGreaterThanOrEqual(1)
  })

  test.each([
    { status: 200, expectedHeading: apiSummary.name },
    { status: 404, expectedHeading: 'Produto não encontrado' },
  ])(
    'returns a product route opened by the cart to the cart ($status)',
    async ({ status, expectedHeading }) => {
      vi.stubGlobal(
        'fetch',
        vi.fn(async (input: RequestInfo | URL, init: RequestInit = {}) => {
          const url = new URL(String(input))
          expect(init.method ?? 'GET').toBe('GET')
          expect(url.pathname).toBe(`/api/products/${slug}`)
          return status === 200
            ? response(apiDetail)
            : response(
                {
                  code: 'NOT_FOUND',
                  message: 'Recurso não encontrado.',
                  requestId,
                },
                404,
              )
        }),
      )

      act(() =>
        root.render(
          <MemoryRouter
            initialEntries={[
              {
                pathname: `/produtos/${slug}`,
                state: { catalogReturnTo: '/carrinho' },
              },
            ]}
          >
            <CartProvider storage={null}>
              <Routes>
                <Route path="/produtos/:slug" element={<ProductRoutePage />} />
              </Routes>
            </CartProvider>
          </MemoryRouter>,
        ),
      )
      await waitForText(container, expectedHeading)

      const returnLink = Array.from(
        container.querySelectorAll<HTMLAnchorElement>('a[href="/carrinho"]'),
      ).find((link) => link.textContent?.includes('Voltar ao carrinho'))
      expect(returnLink).toBeDefined()
    },
  )
})
