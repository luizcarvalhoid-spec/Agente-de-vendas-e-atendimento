import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

import { apiErrorSchema } from '../src/contracts/api.js'
import {
  productDetailResponseSchema,
  productListResponseSchema,
} from '../src/contracts/catalog.js'
import { buildTestApp } from './helpers/test-app.js'

interface ImageManifestEntry {
  id: number
  target: string
  sha256: string
}

const backendRoot = dirname(dirname(fileURLToPath(import.meta.url)))
const catalogRoot = join(backendRoot, 'content', 'catalog')
const manifestPath = join(catalogRoot, 'image-manifest.json')
const allowedOrigin = 'http://localhost:5173'

async function readManifest() {
  return JSON.parse(
    await readFile(manifestPath, 'utf8'),
  ) as ImageManifestEntry[]
}

test('GET /api/products paginates 27 products as 12/12/3', async (t) => {
  const app = await buildTestApp()
  t.after(() => app.close())

  const pages = await Promise.all(
    [1, 2, 3].map(async (page) => {
      const response = await app.inject({
        method: 'GET',
        url: `/api/products?page=${page}`,
      })
      assert.equal(response.statusCode, 200)
      return productListResponseSchema.parse(response.json())
    }),
  )

  assert.deepEqual(
    pages.map((page) => page.items.length),
    [12, 12, 3],
  )
  assert.deepEqual(
    pages.flatMap((page) => page.items.map((product) => product.id)),
    Array.from({ length: 27 }, (_, index) => index + 1),
  )
  assert.deepEqual(pages[0]?.pagination, {
    page: 1,
    pageSize: 12,
    totalItems: 27,
    totalPages: 3,
    hasPreviousPage: false,
    hasNextPage: true,
  })
  assert.equal(pages[2]?.pagination.hasPreviousPage, true)
  assert.equal(pages[2]?.pagination.hasNextPage, false)
})

test('pageSize=100 returns all products and the approved distribution', async (t) => {
  const app = await buildTestApp()
  t.after(() => app.close())

  const response = await app.inject({
    method: 'GET',
    url: '/api/products?pageSize=100',
  })
  const body = productListResponseSchema.parse(response.json())

  assert.equal(response.statusCode, 200)
  assert.equal(body.items.length, 27)
  assert.equal(body.pagination.totalItems, 27)
  assert.deepEqual(
    body.items.reduce<Record<string, number>>((counts, product) => {
      counts[product.category] = (counts[product.category] ?? 0) + 1
      return counts
    }, {}),
    {
      shampoos: 14,
      sabonetes: 5,
      'oleos-corporais': 4,
      condicionadores: 4,
    },
  )
  assert.equal(
    body.items.filter(
      (product) =>
        product.category === 'shampoos' &&
        product.subcategory === 'anticaspa',
    ).length,
    6,
  )
  assert.ok(
    body.items.every(
      (product) =>
        product.dataClassification.commercial === 'fictional-demo' &&
        product.dataClassification.compatibility ===
          'commercial-positioning' &&
        product.dataClassification.formulation === 'synthetic-test-data' &&
        product.dataClassification.safety === 'not-evaluated',
    ),
  )
})

test('list endpoint supports normalized search and combined filters', async (t) => {
  const app = await buildTestApp()
  t.after(() => app.close())

  const searchResponse = await app.inject({
    method: 'GET',
    url: '/api/products?q=oleo%20corporal%20hidratacao&pageSize=100',
  })
  const searchBody = productListResponseSchema.parse(searchResponse.json())
  assert.equal(searchResponse.statusCode, 200)
  assert.ok(searchBody.items.some((product) => product.id === 20))

  const filteredResponse = await app.inject({
    method: 'GET',
    url: '/api/products?q=anticaspa&category=shampoos&subcategory=anticaspa&minPrice=40&maxPrice=60&pageSize=100',
  })
  const filteredBody = productListResponseSchema.parse(filteredResponse.json())
  assert.equal(filteredResponse.statusCode, 200)
  assert.equal(filteredBody.pagination.totalItems, 6)

  const emptySearchResponse = await app.inject({
    method: 'GET',
    url: '/api/products?q=%20%20%20&pageSize=100',
  })
  const emptySearchBody = productListResponseSchema.parse(
    emptySearchResponse.json(),
  )
  assert.equal(emptySearchBody.pagination.totalItems, 27)

  const noResultsResponse = await app.inject({
    method: 'GET',
    url: '/api/products?q=produto-inexistente',
  })
  const noResultsBody = productListResponseSchema.parse(noResultsResponse.json())
  assert.equal(noResultsResponse.statusCode, 200)
  assert.deepEqual(noResultsBody.items, [])
  assert.equal(noResultsBody.pagination.totalItems, 0)
  assert.equal(noResultsBody.pagination.totalPages, 0)
})

test('list endpoint rejects invalid, duplicate and unknown query parameters', async (t) => {
  const app = await buildTestApp()
  t.after(() => app.close())
  const invalidUrls = [
    '/api/products?category=invalid',
    '/api/products?category=sabonetes&subcategory=anticaspa',
    '/api/products?minPrice=-1',
    '/api/products?minPrice=50&maxPrice=40',
    '/api/products?page=0',
    '/api/products?pageSize=101',
    '/api/products?unexpected=true',
    '/api/products?category=shampoos&category=sabonetes',
  ]

  for (const url of invalidUrls) {
    await t.test(url, async () => {
      const response = await app.inject({ method: 'GET', url })
      assert.equal(response.statusCode, 400)
      assert.deepEqual(apiErrorSchema.parse(response.json()), {
        code: 'VALIDATION_ERROR',
        message: 'Dados de entrada inválidos.',
      })
    })
  }
})

test('GET /api/products/:slug returns details and handles invalid or missing slugs', async (t) => {
  const app = await buildTestApp()
  t.after(() => app.close())

  const response = await app.inject({
    method: 'GET',
    url: '/api/products/shampoo-anticaspa-coco-blueberry',
  })
  const body = productDetailResponseSchema.parse(response.json())

  assert.equal(response.statusCode, 200)
  assert.equal(body.item.id, 1)
  assert.equal(body.media.primaryUrl, '/api/catalog/images/shampoo-anticaspa-coco-blueberry.jpg')
  assert.deepEqual(body.item.dataClassification, {
    commercial: 'fictional-demo',
    compatibility: 'commercial-positioning',
    formulation: 'synthetic-test-data',
    safety: 'not-evaluated',
  })

  const missing = await app.inject({
    method: 'GET',
    url: '/api/products/produto-inexistente',
  })
  assert.equal(missing.statusCode, 404)
  assert.deepEqual(apiErrorSchema.parse(missing.json()), {
    code: 'NOT_FOUND',
    message: 'Recurso não encontrado.',
  })

  const invalid = await app.inject({
    method: 'GET',
    url: '/api/products/slug%20invalido',
  })
  assert.equal(invalid.statusCode, 400)
  assert.deepEqual(apiErrorSchema.parse(invalid.json()), {
    code: 'VALIDATION_ERROR',
    message: 'Dados de entrada inválidos.',
  })
})

test('all 27 catalog images are streamed with integrity and safe headers', async (t) => {
  const app = await buildTestApp()
  t.after(() => app.close())
  const manifest = await readManifest()

  assert.equal(manifest.length, 27)
  for (const entry of manifest) {
    const publicPath = entry.target.replace(/^images\//, '')
    const response = await app.inject({
      method: 'GET',
      url: `/api/catalog/images/${publicPath}`,
    })

    assert.equal(response.statusCode, 200)
    assert.match(response.headers['content-type'] ?? '', /^image\/jpeg/)
    assert.equal(response.headers['x-content-type-options'], 'nosniff')
    assert.equal(response.headers['cache-control'], 'public, max-age=3600')
    assert.equal(
      createHash('sha256').update(response.rawPayload).digest('hex'),
      entry.sha256,
    )
  }
})

test('image endpoint rejects unknown and dangerous paths without leaking files', async (t) => {
  const app = await buildTestApp()
  t.after(() => app.close())
  const invalidUrls = [
    '/api/catalog/images/unknown.jpg',
    '/api/catalog/images/..%2Fproducts.json',
    '/api/catalog/images/%2e%2e%2Fproducts.json',
    '/api/catalog/images/images%5Cproduct.jpg',
    '/api/catalog/images/%252e%252e%252fproducts.json',
  ]

  for (const url of invalidUrls) {
    await t.test(url, async () => {
      const response = await app.inject({ method: 'GET', url })
      assert.equal(response.statusCode, 404)
      assert.deepEqual(apiErrorSchema.parse(response.json()), {
        code: 'NOT_FOUND',
        message: 'Recurso não encontrado.',
      })
      assert.doesNotMatch(response.body, /content[/\\]catalog|products\.json/i)
    })
  }
})

test('CORS applies to product and image routes', async (t) => {
  const app = await buildTestApp()
  t.after(() => app.close())

  const productResponse = await app.inject({
    method: 'GET',
    url: '/api/products?pageSize=100',
    headers: { origin: allowedOrigin },
  })
  assert.equal(productResponse.statusCode, 200)
  assert.equal(
    productResponse.headers['access-control-allow-origin'],
    allowedOrigin,
  )

  const imageResponse = await app.inject({
    method: 'GET',
    url: '/api/catalog/images/shampoo-anticaspa-coco-blueberry.jpg',
    headers: { origin: allowedOrigin },
  })
  assert.equal(imageResponse.statusCode, 200)
  assert.equal(
    imageResponse.headers['access-control-allow-origin'],
    allowedOrigin,
  )
})
