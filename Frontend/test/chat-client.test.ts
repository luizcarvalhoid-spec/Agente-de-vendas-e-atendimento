import { describe, expect, test, vi } from 'vitest'

import {
  ApiRequestError,
  resolveCatalogImageUrl,
  sendChat,
  type ApiTransport,
} from '../src/api/client'

const request = {
  message: 'Preciso de shampoo anticaspa.',
  sessionId: 'demo_123',
  history: [],
}
const response = {
  type: 'text',
  message: 'Seu couro cabeludo é seco, normal ou oleoso?',
  reason: 'clarification',
  sourceIds: [],
  requestId: '00000000-0000-4000-8000-000000000001',
}

function jsonResponse(body: unknown, init: ResponseInit = {}) {
  return new Response(JSON.stringify(body), {
    status: init.status ?? 200,
    headers: { 'Content-Type': 'application/json', ...init.headers },
  })
}

describe('sendChat', () => {
  test('sends one strict POST request and returns a validated response', async () => {
    const transport = vi.fn<ApiTransport>().mockResolvedValue(jsonResponse(response))

    await expect(
      sendChat(request, undefined, {
        apiUrl: 'http://api.test',
        transport,
      }),
    ).resolves.toEqual(response)
    expect(transport).toHaveBeenCalledTimes(1)
    const [url, init] = transport.mock.calls[0] ?? []
    expect(url).toBe('http://api.test/api/chat')
    expect(init?.method).toBe('POST')
    expect(init?.headers).toEqual({
      Accept: 'application/json',
      'Content-Type': 'application/json',
    })
    expect(JSON.parse(String(init?.body))).toEqual(request)
  })

  test('rejects invalid or expanded payloads before transport', async () => {
    const transport = vi.fn<ApiTransport>()
    await expect(
      sendChat(
        { ...request, cart: [{ productId: 13, quantity: 1 }] },
        undefined,
        { apiUrl: 'http://api.test', transport },
      ),
    ).rejects.toMatchObject({ kind: 'invalid-request' })
    expect(transport).not.toHaveBeenCalled()
  })

  test('rejects malformed success responses without rendering partial data', async () => {
    const transport = vi
      .fn<ApiTransport>()
      .mockResolvedValue(jsonResponse({ ...response, sourceIds: ['invalid'] }))
    await expect(
      sendChat(request, undefined, { apiUrl: 'http://api.test', transport }),
    ).rejects.toMatchObject({ kind: 'invalid-response' })
  })

  test('classifies network failures without leaking their message', async () => {
    const secret = new Error('C:\\internal\\secret.txt')
    const transport = vi.fn<ApiTransport>().mockRejectedValue(secret)
    await expect(
      sendChat(request, undefined, { apiUrl: 'http://api.test', transport }),
    ).rejects.toEqual(
      expect.objectContaining({
        name: 'ApiRequestError',
        kind: 'network',
        message: 'Não foi possível consultar a API.',
        originalCause: secret,
      }),
    )
  })

  test('preserves 429 Retry-After and the sanitized request ID', async () => {
    const transport = vi.fn<ApiTransport>().mockResolvedValue(
      jsonResponse(
        {
          code: 'RATE_LIMITED',
          message: 'Aguarde.',
          requestId: response.requestId,
        },
        { status: 429, headers: { 'Retry-After': '7' } },
      ),
    )
    await expect(
      sendChat(request, undefined, { apiUrl: 'http://api.test', transport }),
    ).rejects.toMatchObject({
      kind: 'http',
      status: 429,
      code: 'RATE_LIMITED',
      requestId: response.requestId,
      retryAfterSeconds: 7,
    })
  })

  test.each([
    [502, 'AI_BAD_RESPONSE'],
    [503, 'AI_UNAVAILABLE'],
    [504, 'AI_TIMEOUT'],
  ] as const)('preserves HTTP %i as %s', async (status, code) => {
    const transport = vi.fn<ApiTransport>().mockResolvedValue(
      jsonResponse(
        { code, message: 'Falha sanitizada.', requestId: response.requestId },
        { status },
      ),
    )
    await expect(
      sendChat(request, undefined, { apiUrl: 'http://api.test', transport }),
    ).rejects.toMatchObject({ status, code })
  })

  test('rejects invalid API configuration before transport', async () => {
    const transport = vi.fn<ApiTransport>()
    await expect(
      sendChat(request, undefined, {
        apiUrl: 'https://api.test/private',
        transport,
      }),
    ).rejects.toBeInstanceOf(ApiRequestError)
    expect(transport).not.toHaveBeenCalled()
  })
})

describe('resolveCatalogImageUrl', () => {
  test('resolves only catalog images against the configured API origin', () => {
    expect(
      resolveCatalogImageUrl(
        '/api/catalog/images/shampoos/produto.jpg',
        'https://api.test',
      ),
    ).toBe('https://api.test/api/catalog/images/shampoos/produto.jpg')
    expect(
      resolveCatalogImageUrl(
        'https://api.test/api/catalog/images/produto.webp',
        'https://api.test',
      ),
    ).toBe('https://api.test/api/catalog/images/produto.webp')
  })

  test.each([
    'https://external.test/api/catalog/images/produto.jpg',
    '/api/catalog/images/produto.jpg?token=secret',
    '/api/catalog/images/produto.jpg#fragment',
    '/api/catalog/images/../private/produto.jpg',
    '/api/catalog/images/arquivo.txt',
    '/other/produto.jpg',
  ])('rejects unsafe catalog image reference %s', (path) => {
    expect(() =>
      resolveCatalogImageUrl(path, 'https://api.test'),
    ).toThrowError(ApiRequestError)
  })
})
