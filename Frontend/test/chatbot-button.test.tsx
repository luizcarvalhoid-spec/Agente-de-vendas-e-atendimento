import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { MemoryRouter } from 'react-router'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'

import ChatbotButton from '../src/Pages/ChatbotButton'
import type { ChatProductCard } from '../src/api/chat-contracts'
import { CHAT_LOCAL_TIMEOUT_MS } from '../src/hooks/useChatConversation'

const requestId = '00000000-0000-4000-8000-000000000001'

const chatProduct: ChatProductCard = {
  id: 13,
  slug: 'shampoo-anticaspa-refrescante',
  name: 'Shampoo Anticaspa Refrescante',
  brand: 'HidraSplash',
  isDemo: true,
  category: 'shampoos',
  subcategory: 'anticaspa',
  shortDescription: 'Produto demonstrativo refrescante.',
  price: 48.9,
  stock: 14,
  imageUrl: '/api/catalog/images/shampoo-anticaspa.jpg',
  dataClassification: {
    commercial: 'fictional-demo',
    compatibility: 'commercial-positioning',
    formulation: 'synthetic-test-data',
    safety: 'not-evaluated',
  },
}

function apiResponse(message: string, status = 200, headers?: HeadersInit) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: new Headers(headers),
    json: async () =>
      status === 200
        ? {
            type: 'text',
            message,
            sourceIds: [],
            requestId,
          }
        : {
            code:
              status === 429
                ? 'RATE_LIMITED'
                : status === 400
                  ? 'VALIDATION_ERROR'
                : status === 503
                  ? 'AI_UNAVAILABLE'
                  : 'INTERNAL_SERVER_ERROR',
            message: 'Falha sanitizada.',
            requestId,
          },
  } as Response
}

function successfulResponse(body: unknown) {
  return {
    ok: true,
    status: 200,
    headers: new Headers(),
    json: async () => body,
  } as Response
}

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((done) => {
    resolve = done
  })
  return { promise, resolve }
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

describe('ChatbotButton', () => {
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
    Object.defineProperty(HTMLElement.prototype, 'scrollTo', {
      configurable: true,
      value: vi.fn(),
    })
    window.sessionStorage.clear()
    container = document.createElement('div')
    document.body.append(container)
    root = createRoot(container)
    act(() =>
      root.render(
        <MemoryRouter>
          <ChatbotButton />
        </MemoryRouter>,
      ),
    )
  })

  afterEach(() => {
    act(() => root.unmount())
    container.remove()
    vi.useRealTimers()
    vi.unstubAllEnvs()
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  const trigger = () =>
    container.querySelector<HTMLButtonElement>('button[aria-expanded]')!
  const openChat = () => act(() => trigger().click())
  const input = () => container.querySelector<HTMLInputElement>('input')!
  const sendButton = () =>
    container.querySelector<HTMLButtonElement>(
      'button[aria-label="Enviar mensagem"]',
    )!

  test('opens, focuses, minimizes, expands and closes with Escape', () => {
    expect(trigger().getAttribute('aria-label')).toBe(
      'Abrir atendimento consultivo',
    )
    openChat()
    expect(container.querySelector('[role="dialog"]')).not.toBeNull()
    expect(document.activeElement).toBe(input())

    act(() =>
      container
        .querySelector<HTMLButtonElement>('button[aria-label="Minimizar chat"]')!
        .click(),
    )
    expect(container.querySelector('input')).toBeNull()
    act(() =>
      container
        .querySelector<HTMLButtonElement>('button[aria-label="Expandir chat"]')!
        .click(),
    )
    expect(container.querySelector('input')).not.toBeNull()

    act(() => window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' })))
    expect(container.querySelector('[role="dialog"]')).toBeNull()
    expect(document.activeElement).toBe(trigger())
  })

  test('blocks concurrent submits and sends only completed turns as history', async () => {
    const first = deferred<Response>()
    const fetchMock = vi
      .fn()
      .mockReturnValueOnce(first.promise)
      .mockResolvedValueOnce(apiResponse('Segunda resposta'))
    vi.stubGlobal('fetch', fetchMock)
    openChat()

    setInputValue(input(), 'Primeira pergunta')
    act(() => sendButton().click())
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(input().disabled).toBe(true)
    act(() =>
      container
        .querySelector<HTMLFormElement>('form')!
        .dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })),
    )
    expect(fetchMock).toHaveBeenCalledTimes(1)

    first.resolve(apiResponse('Primeira resposta'))
    await settle()
    expect(container.textContent).toContain('Primeira resposta')

    setInputValue(input(), 'Segunda pergunta')
    act(() => sendButton().click())
    await settle()
    const secondBody = JSON.parse(
      String(fetchMock.mock.calls[1]?.[1]?.body),
    ) as { history: unknown[] }
    expect(secondBody.history).toEqual([
      { role: 'user', content: 'Primeira pergunta' },
      { role: 'assistant', content: 'Primeira resposta' },
    ])
    expect(JSON.stringify(secondBody)).not.toContain('Olá! Sou a assistente')
  })

  test('keeps text textual and renders structured cards without extra chat requests', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(apiResponse('Resposta somente textual'))
      .mockResolvedValueOnce(
        successfulResponse({
          type: 'recommendation',
          message: 'Uma recomendação validada.',
          productIds: [13],
          products: [chatProduct],
          sourceIds: [],
          requestId,
        }),
      )
      .mockResolvedValueOnce(
        successfulResponse({
          type: 'comparison',
          message: 'Uma comparação validada.',
          productIds: [13, 9],
          products: [
            chatProduct,
            {
              ...chatProduct,
              id: 9,
              slug: 'shampoo-anticaspa-coco',
              name: 'Shampoo Anticaspa Coco',
              imageUrl: '/api/catalog/images/shampoo-anticaspa-coco.jpg',
            },
          ],
          sourceIds: [],
          requestId,
        }),
      )
    vi.stubGlobal('fetch', fetchMock)
    openChat()

    setInputValue(input(), 'Pergunta textual')
    act(() => sendButton().click())
    await settle()
    expect(container.textContent).toContain('Resposta somente textual')
    expect(container.querySelectorAll('[data-testid="chat-product-cards"]')).toHaveLength(0)

    setInputValue(input(), 'Recomende um produto')
    act(() => sendButton().click())
    await settle()
    expect(container.querySelectorAll('[data-testid="chat-product-cards"]')).toHaveLength(1)
    expect(container.querySelectorAll('article[data-product-id]')).toHaveLength(1)

    setInputValue(input(), 'Compare duas opções')
    act(() => sendButton().click())
    await settle()
    expect(container.querySelectorAll('[data-testid="chat-product-cards"]')).toHaveLength(2)
    expect(container.querySelectorAll('article[data-product-id]')).toHaveLength(3)
    expect(fetchMock).toHaveBeenCalledTimes(3)
    expect(
      fetchMock.mock.calls.every(([, request]) => request?.method === 'POST'),
    ).toBe(true)
  })

  test('manual retry reuses one user message without duplication', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(apiResponse('unavailable', 503))
      .mockResolvedValueOnce(apiResponse('Resposta recuperada'))
    vi.stubGlobal('fetch', fetchMock)
    openChat()
    setInputValue(input(), 'Minha tentativa')
    act(() => sendButton().click())
    await settle()

    expect(container.textContent).toContain('temporariamente indisponível')
    const retry = Array.from(container.querySelectorAll('button')).find(
      (button) => button.textContent?.includes('Tentar novamente'),
    )
    act(() => retry?.click())
    await settle()
    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(container.textContent).toContain('Resposta recuperada')
    expect(container.textContent?.match(/Minha tentativa/g)).toHaveLength(1)
  })

  test('restores a rejected validation message for editing without adding it to history', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(apiResponse('Resposta anterior'))
      .mockResolvedValueOnce(apiResponse('validation', 400))
      .mockResolvedValueOnce(apiResponse('Resposta corrigida'))
    vi.stubGlobal('fetch', fetchMock)
    openChat()

    setInputValue(input(), 'Contexto válido')
    act(() => sendButton().click())
    await settle()

    const rejectedMessage = 'Texto rejeitado integralmente'
    setInputValue(input(), rejectedMessage)
    act(() => sendButton().click())
    await settle()

    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(container.textContent).toContain('Revise o conteúdo')
    expect(container.textContent?.match(new RegExp(rejectedMessage, 'g'))).toHaveLength(1)

    const editButton = Array.from(container.querySelectorAll('button')).find(
      (button) => button.textContent?.includes('Editar mensagem'),
    )
    act(() => editButton?.click())

    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(input().value).toBe(rejectedMessage)
    expect(document.activeElement).toBe(input())
    expect(container.textContent).not.toContain(rejectedMessage)

    setInputValue(input(), 'Texto corrigido')
    act(() => sendButton().click())
    await settle()

    const correctedBody = JSON.parse(
      String(fetchMock.mock.calls[2]?.[1]?.body),
    ) as { history: unknown[] }
    expect(correctedBody.history).toEqual([
      { role: 'user', content: 'Contexto válido' },
      { role: 'assistant', content: 'Resposta anterior' },
    ])
    expect(JSON.stringify(correctedBody)).not.toContain(rejectedMessage)
    expect(container.textContent).not.toContain(rejectedMessage)
    expect(container.textContent?.match(/Texto corrigido/g)).toHaveLength(1)
    expect(container.textContent).toContain('Resposta anterior')
    expect(container.textContent).toContain('Resposta corrigida')
  })

  test('closing aborts the request and ignores a late response', async () => {
    const request = deferred<Response>()
    let signal: AbortSignal | undefined
    vi.stubGlobal(
      'fetch',
      vi.fn((_url, init: RequestInit) => {
        signal = init.signal as AbortSignal
        return request.promise
      }),
    )
    openChat()
    setInputValue(input(), 'Pergunta cancelada')
    act(() => sendButton().click())
    act(() => trigger().click())
    expect(signal?.aborted).toBe(true)

    request.resolve(apiResponse('Resposta tardia'))
    await settle()
    openChat()
    expect(container.textContent).not.toContain('Resposta tardia')
    expect(window.sessionStorage.getItem('hidrasplash:chat:v1')).not.toContain(
      'Pergunta cancelada',
    )
  })

  test('new conversation cancels an active request and ignores its late response', async () => {
    const request = deferred<Response>()
    let signal: AbortSignal | undefined
    vi.stubGlobal(
      'fetch',
      vi.fn((_url, init: RequestInit) => {
        signal = init.signal as AbortSignal
        return request.promise
      }),
    )
    openChat()
    setInputValue(input(), 'Pergunta da sessão anterior')
    act(() => sendButton().click())
    act(() =>
      container
        .querySelector<HTMLButtonElement>(
          'button[aria-label="Iniciar nova conversa"]',
        )!
        .click(),
    )
    expect(signal?.aborted).toBe(true)

    request.resolve(apiResponse('Resposta antiga tardia'))
    await settle()
    expect(container.textContent).not.toContain('Pergunta da sessão anterior')
    expect(container.textContent).not.toContain('Resposta antiga tardia')
    expect(window.sessionStorage.getItem('hidrasplash:chat:v1')).not.toContain(
      'Pergunta da sessão anterior',
    )
  })

  test('local timeout is recoverable even when transport ignores abort', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-11-10T12:00:00Z'))
    const request = deferred<Response>()
    let signal: AbortSignal | undefined
    vi.stubGlobal(
      'fetch',
      vi.fn((_url, init: RequestInit) => {
        signal = init.signal as AbortSignal
        return request.promise
      }),
    )
    openChat()
    setInputValue(input(), 'Consulta demorada')
    act(() => sendButton().click())
    act(() => vi.advanceTimersByTime(CHAT_LOCAL_TIMEOUT_MS))

    expect(signal?.aborted).toBe(true)
    expect(container.textContent).toContain('demorou mais que o esperado')
    request.resolve(apiResponse('Resposta depois do timeout'))
    await settle()
    expect(container.textContent).not.toContain('Resposta depois do timeout')
  })

  test('429 uses an absolute Retry-After deadline and never retries automatically', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-11-10T12:00:00Z'))
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(apiResponse('rate', 429, { 'Retry-After': '3' }))
      .mockResolvedValueOnce(apiResponse('Resposta após espera'))
    vi.stubGlobal('fetch', fetchMock)
    openChat()
    setInputValue(input(), 'Consulta limitada')
    act(() => sendButton().click())
    await settle()

    expect(container.textContent).toContain('Tente em 3s')
    expect(fetchMock).toHaveBeenCalledTimes(1)
    act(() => vi.advanceTimersByTime(1_000))
    act(() => vi.advanceTimersByTime(1_000))
    expect(container.textContent).toContain('Tente em 1s')
    expect(fetchMock).toHaveBeenCalledTimes(1)
    act(() => vi.advanceTimersByTime(1_000))
    const retry = Array.from(container.querySelectorAll('button')).find((button) =>
      button.textContent?.includes('Tentar novamente'),
    )
    expect(retry?.disabled).toBe(false)
    act(() => retry?.click())
    await settle()
    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(container.textContent).toContain('Resposta após espera')
  })

  test('new conversation clears old turns, changes session and preserves rate limiting', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-11-10T12:00:00Z'))
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(apiResponse('Resposta antiga'))
      .mockResolvedValueOnce(apiResponse('rate', 429, { 'Retry-After': '3' }))
      .mockResolvedValueOnce(apiResponse('Resposta da nova sessão'))
    vi.stubGlobal('fetch', fetchMock)
    openChat()

    setInputValue(input(), 'Pergunta antiga')
    act(() => sendButton().click())
    await settle()
    const firstBody = JSON.parse(
      String(fetchMock.mock.calls[0]?.[1]?.body),
    ) as { sessionId: string }

    setInputValue(input(), 'Consulta limitada')
    act(() => sendButton().click())
    await settle()
    expect(container.textContent).toContain('Tente em 3s')

    act(() =>
      container
        .querySelector<HTMLButtonElement>(
          'button[aria-label="Iniciar nova conversa"]',
        )!
        .click(),
    )
    await settle()

    const stored = JSON.parse(
      window.sessionStorage.getItem('hidrasplash:chat:v1')!,
    ) as { sessionId: string; turns: unknown[] }
    expect(stored.sessionId).not.toBe(firstBody.sessionId)
    expect(stored.turns).toEqual([])
    expect(container.textContent).not.toContain('Pergunta antiga')
    expect(container.textContent).not.toContain('Resposta antiga')

    setInputValue(input(), 'Pergunta prematura')
    act(() =>
      container
        .querySelector<HTMLFormElement>('form')!
        .dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })),
    )
    expect(fetchMock).toHaveBeenCalledTimes(2)

    act(() => vi.advanceTimersByTime(1_000))
    act(() => vi.advanceTimersByTime(1_000))
    act(() => vi.advanceTimersByTime(1_000))
    setInputValue(input(), 'Pergunta da nova sessão')
    act(() => sendButton().click())
    await settle()

    const newBody = JSON.parse(
      String(fetchMock.mock.calls[2]?.[1]?.body),
    ) as { sessionId: string; history: unknown[] }
    expect(newBody.sessionId).toBe(stored.sessionId)
    expect(newBody.history).toEqual([])
    expect(container.textContent).not.toContain('Resposta antiga')
    expect(container.textContent).toContain('Resposta da nova sessão')
  })
})
