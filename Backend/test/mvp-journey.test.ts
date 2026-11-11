import assert from 'node:assert/strict'
import { dirname, join } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

import { createChatService } from '../src/agent/chat-service.js'
import { createProductSearchIndex } from '../src/agent/tools/product-tools.js'
import {
  chatRequestSchema,
  chatResponseSchema,
  type ChatPreferences,
} from '../src/contracts/chat.js'
import { loadCatalogRepository } from '../src/catalog/catalog-repository.js'
import { loadFaqDocuments } from '../src/knowledge/faq-content-loader.js'
import { createFaqSearchIndex } from '../src/knowledge/faq-search.js'
import { createMvpDeterministicModel } from './helpers/mvp-deterministic-model.js'
import { buildTestApp } from './helpers/test-app.js'

interface JourneyCase {
  id: string
  message: string
  preferences?: ChatPreferences
  expected: {
    type: 'text' | 'recommendation' | 'comparison'
    reason?: 'clarification' | 'not_found' | 'unable_to_verify'
    productIds?: number[]
    allowedProductIds?: number[]
    sourceIds: string[]
    messageIncludes?: string[]
  }
}

const backendRoot = dirname(dirname(fileURLToPath(import.meta.url)))
const catalogRoot = join(backendRoot, 'content', 'catalog')
const faqRoot = join(backendRoot, 'content', 'knowledge', 'faq')
const fixtureUrl = new URL('./fixtures/mvp-journey-cases.json', import.meta.url)

async function loadCases() {
  const raw = await import('node:fs/promises').then(({ readFile }) =>
    readFile(fixtureUrl, 'utf8'),
  )
  return JSON.parse(raw) as JourneyCase[]
}

test('M1 deterministic backend journey uses canonical tools and grounded sources', async () => {
  const [catalog, faqDocuments, cases] = await Promise.all([
    loadCatalogRepository({
      catalogRoot,
      productsFile: join(catalogRoot, 'products.json'),
    }),
    loadFaqDocuments({ faqRoot }),
    loadCases(),
  ])
  const service = createChatService({
    catalog,
    productIndex: createProductSearchIndex(catalog.listAll()),
    faqIndex: createFaqSearchIndex(faqDocuments),
    faqDocuments,
    model: createMvpDeterministicModel(),
  })

  assert.equal(new Set(cases.map((item) => item.id)).size, cases.length)
  for (const [index, journeyCase] of cases.entries()) {
    const request = chatRequestSchema.parse({
      message: journeyCase.message,
      history: [],
      cart: [],
      ...(journeyCase.preferences
        ? { preferences: journeyCase.preferences }
        : {}),
    })
    let rawResponse: unknown
    try {
      rawResponse = await service.execute(request, {
        requestId: `00000000-0000-4000-8000-${String(index + 1).padStart(12, '0')}`,
        signal: new AbortController().signal,
      })
    } catch (error) {
      assert.fail(`${journeyCase.id}: ${String(error)}`)
    }
    const response = chatResponseSchema.parse(rawResponse)

    assert.equal(response.type, journeyCase.expected.type, journeyCase.id)
    if (journeyCase.expected.sourceIds.length === 0) {
      assert.deepEqual(response.sourceIds, [], journeyCase.id)
    } else {
      for (const sourceId of journeyCase.expected.sourceIds) {
        assert.ok(response.sourceIds.includes(sourceId), journeyCase.id)
      }
    }
    for (const sourceId of response.sourceIds) {
      assert.ok(
        faqDocuments.some((document) => document.sourceId === sourceId),
        `${journeyCase.id}: unknown source ${sourceId}`,
      )
    }
    if (response.type === 'text') {
      assert.equal(response.reason, journeyCase.expected.reason, journeyCase.id)
      assert.equal('products' in response, false, journeyCase.id)
      for (const expectedText of journeyCase.expected.messageIncludes ?? []) {
        assert.ok(
          response.message.includes(expectedText),
          `${journeyCase.id}: missing canonical text "${expectedText}"`,
        )
      }
      continue
    }

    if (journeyCase.expected.productIds) {
      assert.deepEqual(
        [...response.productIds],
        journeyCase.expected.productIds,
        journeyCase.id,
      )
    }
    if (journeyCase.expected.allowedProductIds) {
      assert.ok(
        response.productIds.every((id) =>
          journeyCase.expected.allowedProductIds?.includes(id),
        ),
        `${journeyCase.id}: received ${response.productIds.join(', ')}`,
      )
    }
    for (const product of response.products) {
      const canonical = catalog.findById(product.id)
      assert.ok(canonical, journeyCase.id)
      assert.equal(product.slug, canonical.slug, journeyCase.id)
      assert.equal(product.price, canonical.price, journeyCase.id)
      assert.equal(product.stock, canonical.stock, journeyCase.id)
      assert.equal(product.isDemo, true, journeyCase.id)
    }
  }
})

test('M1 preserves anticaspa context across two HTTP chat turns', async (t) => {
  const [catalog, faqDocuments] = await Promise.all([
    loadCatalogRepository({
      catalogRoot,
      productsFile: join(catalogRoot, 'products.json'),
    }),
    loadFaqDocuments({ faqRoot }),
  ])
  const service = createChatService({
    catalog,
    productIndex: createProductSearchIndex(catalog.listAll()),
    faqIndex: createFaqSearchIndex(faqDocuments),
    faqDocuments,
    model: createMvpDeterministicModel(),
  })
  const app = await buildTestApp({ chatService: service })
  t.after(() => app.close())
  const sessionId = 'mvp-deterministic-two-turns'

  const firstHttpResponse = await app.inject({
    method: 'POST',
    url: '/api/chat',
    payload: {
      message: 'Preciso de shampoo anticaspa.',
      sessionId,
      history: [],
      cart: [],
    },
  })
  assert.equal(firstHttpResponse.statusCode, 200)
  const firstResponse = chatResponseSchema.parse(firstHttpResponse.json())
  assert.equal(firstResponse.type, 'text')
  assert.equal(firstResponse.reason, 'clarification')
  assert.equal('products' in firstResponse, false)

  const history = [
    { role: 'user' as const, content: 'Preciso de shampoo anticaspa.' },
    { role: 'assistant' as const, content: firstResponse.message },
  ]
  const secondHttpResponse = await app.inject({
    method: 'POST',
    url: '/api/chat',
    payload: {
      message:
        'Meu couro cabeludo é oleoso, prefiro frescor e posso gastar até R$ 50.',
      sessionId,
      history,
      cart: [],
    },
  })
  assert.equal(secondHttpResponse.statusCode, 200)
  const secondResponse = chatResponseSchema.parse(secondHttpResponse.json())
  assert.equal(secondResponse.type, 'recommendation')
  assert.deepEqual([...secondResponse.productIds], [13])
  assert.equal(secondResponse.products.length, 1)

  const canonical = catalog.findById(13)
  assert.ok(canonical)
  const [product] = secondResponse.products
  assert.equal(product?.id, canonical.id)
  assert.equal(product?.slug, canonical.slug)
  assert.equal(product?.price, canonical.price)
  assert.equal(product?.stock, canonical.stock)
  assert.equal(product?.isDemo, true)
  assert.deepEqual(secondResponse.sourceIds, [])
})

test('M1 fixture keeps the approved FAQ and consultative coverage explicit', async () => {
  const cases = await loadCases()
  const sourceIds = new Set(
    cases.flatMap((item) => item.expected.sourceIds),
  )
  assert.deepEqual(
    [...sourceIds].sort(),
    ['faq-001', 'faq-002', 'faq-003', 'faq-009', 'faq-011'],
  )
  assert.ok(cases.some((item) => item.expected.reason === 'clarification'))
  assert.ok(cases.some((item) => item.expected.reason === 'not_found'))
  assert.ok(cases.some((item) => item.expected.type === 'comparison'))
  assert.equal(
    cases.filter((item) => item.expected.messageIncludes !== undefined).length,
    4,
  )
})
