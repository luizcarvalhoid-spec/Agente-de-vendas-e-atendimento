import { describe, expect, test } from 'vitest'

import type { ChatResponse } from '../src/api/chat-contracts'
import {
  CHAT_MAX_COMPLETED_TURNS,
  CHAT_SESSION_STORAGE_KEY,
  buildChatHistory,
  buildRecommendationContext,
  clearChatSession,
  createChatSessionId,
  loadChatSession,
  saveChatSession,
  type CompletedTurn,
  type StoragePort,
} from '../src/utils/chat-conversation'

const response = (message: string): ChatResponse => ({
  type: 'text',
  message,
  sourceIds: [],
  requestId: '00000000-0000-4000-8000-000000000001',
})

function turn(index: number, text = `mensagem ${index}`): CompletedTurn {
  return {
    id: `turn_00000000-0000-4000-8000-00000000000${index}`,
    userMessage: text,
    response: response(`resposta ${index}`),
    restored: false,
  }
}

function recommendationTurn(index: number, productId: number): CompletedTurn {
  return {
    ...turn(index),
    response: {
      type: 'recommendation',
      message: `Recomendação ${productId}`,
      productIds: [productId],
      products: [
        {
          id: productId,
          slug: `produto-${productId}`,
          name: `Produto ${productId}`,
          brand: 'HidraSplash',
          isDemo: true,
          category: 'shampoos',
          subcategory: 'anticaspa',
          shortDescription: 'Produto demonstrativo.',
          price: 48.9,
          stock: 1,
          imageUrl: '/api/catalog/images/produto.jpg',
          dataClassification: {
            commercial: 'fictional-demo',
            compatibility: 'commercial-positioning',
            formulation: 'synthetic-test-data',
            safety: 'not-evaluated',
          },
        },
      ],
      sourceIds: [],
      requestId: '00000000-0000-4000-8000-000000000001',
    },
  }
}

function createStorage(): StoragePort & { values: Map<string, string> } {
  const values = new Map<string, string>()
  return {
    values,
    getItem(key) {
      return values.get(key) ?? null
    },
    setItem(key, value) {
      values.set(key, value)
    },
    removeItem(key) {
      values.delete(key)
    },
  }
}

describe('canonical chat history', () => {
  test('keeps at most five complete alternating pairs', () => {
    const history = buildChatHistory(
      Array.from({ length: 7 }, (_, index) => turn(index + 1)),
      'mensagem atual',
    )

    expect(history).toHaveLength(CHAT_MAX_COMPLETED_TURNS * 2)
    expect(history[0]).toEqual({ role: 'user', content: 'mensagem 3' })
    expect(history.at(-1)).toEqual({ role: 'assistant', content: 'resposta 7' })
    history.forEach((message, index) => {
      expect(message.role).toBe(index % 2 === 0 ? 'user' : 'assistant')
    })
  })

  test('removes old pairs until the UTF-8 conversation budget fits', () => {
    const turns = Array.from({ length: 5 }, (_, index) => ({
      ...turn(index + 1, 'á'.repeat(4_000)),
      response: response('é'.repeat(4_000)),
    }))
    const history = buildChatHistory(turns, 'mensagem atual')

    expect(history.length).toBeLessThan(10)
    expect(history.length % 2).toBe(0)
    expect(
      new TextEncoder().encode(
        JSON.stringify({ history, message: 'mensagem atual' }),
      ).byteLength,
    ).toBeLessThanOrEqual(32_000)
  })

  test('derives only product IDs from the latest structured recommendation', () => {
    const first = recommendationTurn(1, 13)
    const faq = turn(2, 'Qual é o prazo de entrega?')
    const latest = recommendationTurn(3, 9)

    expect(buildRecommendationContext([first, faq])).toEqual({
      productIds: [13],
    })
    expect(buildRecommendationContext([first, faq, latest])).toEqual({
      productIds: [9],
    })
  })

  test('drops a recommendation after it leaves the recent history window', () => {
    const turns = [
      recommendationTurn(1, 13),
      ...Array.from({ length: CHAT_MAX_COMPLETED_TURNS }, (_, index) =>
        turn(index + 2, `Pergunta de acompanhamento ${index + 1}`),
      ),
    ]

    expect(buildChatHistory(turns, 'Pergunta atual')[0]).toEqual({
      role: 'user',
      content: 'Pergunta de acompanhamento 1',
    })
    expect(buildRecommendationContext(turns, 'Pergunta atual')).toBeUndefined()
  })

  test('invalidates an older product after an explicit change without a new recommendation', () => {
    const changed = {
      ...turn(2, 'Agora quero outro shampoo.'),
      response: response('Qual perfil você procura?'),
    }
    expect(
      buildRecommendationContext([recommendationTurn(1, 13), changed]),
    ).toBeUndefined()
  })
})

describe('session persistence', () => {
  test('stores a bounded validated snapshot and marks restored cards as historical', () => {
    const storage = createStorage()
    saveChatSession(storage, {
      sessionId: 'demo_session',
      turns: Array.from({ length: 7 }, (_, index) => turn(index + 1)),
    })

    const restored = loadChatSession(storage)
    expect(restored?.sessionId).toBe('demo_session')
    expect(restored?.turns).toHaveLength(5)
    expect(restored?.turns.every((item) => item.restored)).toBe(true)
    expect(restored?.turns[0]?.userMessage).toBe('mensagem 3')
  })

  test('preserves a recent restored recommendation and clears it with the session', () => {
    const storage = createStorage()
    saveChatSession(storage, {
      sessionId: 'demo_session',
      turns: [recommendationTurn(1, 13), turn(2, 'Qual é o prazo?')],
    })

    const restored = loadChatSession(storage)
    expect(buildRecommendationContext(restored?.turns ?? [])).toEqual({
      productIds: [13],
    })

    clearChatSession(storage)
    expect(loadChatSession(storage)).toBeUndefined()
    expect(buildRecommendationContext([])).toBeUndefined()
  })

  test.each([
    'not-json',
    JSON.stringify({ version: 1, sessionId: '../unsafe', turns: [] }),
    JSON.stringify({
      version: 1,
      sessionId: 'demo_ok',
      turns: [{ id: 'turn_1', userMessage: 'oi', response: { type: 'text' } }],
    }),
  ])('discards corrupted persisted state', (raw) => {
    const storage = createStorage()
    storage.values.set(CHAT_SESSION_STORAGE_KEY, raw)
    expect(loadChatSession(storage)).toBeUndefined()
  })

  test('storage failures never break the in-memory conversation', () => {
    const unavailable: StoragePort = {
      getItem() {
        throw new Error('unavailable')
      },
      setItem() {
        throw new Error('quota')
      },
      removeItem() {
        throw new Error('unavailable')
      },
    }

    expect(loadChatSession(unavailable)).toBeUndefined()
    expect(() =>
      saveChatSession(unavailable, {
        sessionId: 'demo_session',
        turns: [turn(1)],
      }),
    ).not.toThrow()
    expect(() => clearChatSession(unavailable)).not.toThrow()
  })

  test('creates a backend-compatible demonstrative session ID', () => {
    expect(createChatSessionId(() => 'uuid-123')).toBe('demo_uuid-123')
  })
})
