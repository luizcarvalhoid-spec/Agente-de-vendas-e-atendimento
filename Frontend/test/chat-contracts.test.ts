import { describe, expect, test } from 'vitest'

import {
  isChatResponse,
  parseChatRequest,
  type ChatProductCard,
} from '../src/api/chat-contracts'

const requestId = '00000000-0000-4000-8000-000000000001'

const product: ChatProductCard = {
  id: 13,
  slug: 'shampoo-anticaspa-refrescante',
  name: 'Shampoo Anticaspa Refrescante',
  brand: 'HidraSplash',
  isDemo: true,
  category: 'shampoos',
  subcategory: 'anticaspa',
  shortDescription: 'Produto demonstrativo.',
  price: 48.9,
  stock: 14,
  imageUrl: '/api/catalog/images/shampoos/produto.jpg',
  dataClassification: {
    commercial: 'fictional-demo',
    compatibility: 'commercial-positioning',
    formulation: 'synthetic-test-data',
    safety: 'not-evaluated',
  },
}

describe('chat response contracts', () => {
  test('accepts text, recommendation and comparison responses', () => {
    expect(
      isChatResponse({
        type: 'text',
        message: 'Como posso ajudar?',
        reason: 'clarification',
        sourceIds: [],
        requestId,
      }),
    ).toBe(true)
    expect(
      isChatResponse({
        type: 'recommendation',
        message: 'Selecionei uma opção demonstrativa.',
        productIds: [13],
        products: [product],
        sourceIds: ['faq-001'],
        requestId,
      }),
    ).toBe(true)
    expect(
      isChatResponse({
        type: 'comparison',
        message: 'Comparei duas opções demonstrativas.',
        productIds: [13, 14],
        products: [product, { ...product, id: 14, slug: 'outra-opcao' }],
        sourceIds: [],
        requestId,
      }),
    ).toBe(true)
  })

  test.each([
    {
      type: 'text',
      message: 'Resposta',
      sourceIds: ['faq-001', 'faq-001'],
      requestId,
    },
    {
      type: 'text',
      message: 'Resposta',
      sourceIds: [],
      requestId: 'not-a-uuid',
    },
    {
      type: 'text',
      message: 'Resposta',
      sourceIds: [],
      requestId,
      score: 1,
    },
    {
      type: 'recommendation',
      message: 'Resposta',
      productIds: [99],
      products: [product],
      sourceIds: [],
      requestId,
    },
    {
      type: 'comparison',
      message: 'Resposta',
      productIds: [13, 13],
      products: [product, product],
      sourceIds: [],
      requestId,
    },
    {
      type: 'recommendation',
      message: 'Resposta',
      productIds: [13],
      products: [{ ...product, imageUrl: 'https://example.com/product.jpg' }],
      sourceIds: [],
      requestId,
    },
    {
      type: 'recommendation',
      message: 'Resposta',
      productIds: [13],
      products: [
        {
          ...product,
          dataClassification: {
            ...product.dataClassification,
            formulation: 'verified',
          },
        },
      ],
      sourceIds: [],
      requestId,
    },
  ])('rejects incompatible response %#', (value) => {
    expect(isChatResponse(value)).toBe(false)
  })
})

describe('chat request contract', () => {
  test('accepts only the strict public payload', () => {
    const request = {
      message: 'Prefiro algo refrescante.',
      sessionId: 'demo_123',
      history: [
        { role: 'user', content: 'Preciso de shampoo.' },
        { role: 'assistant', content: 'Qual é o seu perfil?' },
      ],
    }
    expect(parseChatRequest(request)).toEqual(request)
    expect(
      parseChatRequest({
        ...request,
        recommendationContext: { productIds: [13] },
      }),
    ).toEqual({
      ...request,
      recommendationContext: { productIds: [13] },
    })
    expect(parseChatRequest({ ...request, cart: [] })).toBeUndefined()
  })

  test.each([
    { message: '', sessionId: 'demo_1', history: [] },
    { message: 'x'.repeat(4_001), sessionId: 'demo_1', history: [] },
    { message: 'ok', sessionId: '../unsafe', history: [] },
    {
      message: 'ok',
      sessionId: 'demo_1',
      history: [{ role: 'user', content: 'sem resposta' }],
    },
    {
      message: 'ok',
      sessionId: 'demo_1',
      history: [
        { role: 'assistant', content: 'a' },
        { role: 'assistant', content: 'b' },
      ],
    },
    {
      message: 'ok',
      sessionId: 'demo_1',
      history: [],
      recommendationContext: { productIds: [] },
    },
    {
      message: 'ok',
      sessionId: 'demo_1',
      history: [],
      recommendationContext: { productIds: [13, 13] },
    },
    {
      message: 'ok',
      sessionId: 'demo_1',
      history: [],
      recommendationContext: { productIds: [13], price: 0.01 },
    },
  ])('rejects invalid request %#', (value) => {
    expect(parseChatRequest(value)).toBeUndefined()
  })

  test('rejects a conversation over the UTF-8 byte budget', () => {
    const history = Array.from({ length: 5 }, () => [
      { role: 'user', content: 'á'.repeat(4_000) },
      { role: 'assistant', content: 'é'.repeat(4_000) },
    ]).flat()
    expect(
      parseChatRequest({ message: 'ok', sessionId: 'demo_1', history }),
    ).toBeUndefined()
  })
})
