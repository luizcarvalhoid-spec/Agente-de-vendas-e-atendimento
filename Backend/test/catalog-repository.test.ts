import assert from 'node:assert/strict'
import {
  copyFile,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  writeFile,
} from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import test, { type TestContext } from 'node:test'
import { fileURLToPath, pathToFileURL } from 'node:url'

import {
  loadCatalogRepository,
  resolveDefaultCatalogPaths,
} from '../src/catalog/catalog-repository.js'
import { productListQuerySchema } from '../src/contracts/catalog.js'

const backendRoot = dirname(dirname(fileURLToPath(import.meta.url)))
const canonicalCatalogRoot = join(backendRoot, 'content', 'catalog')
const canonicalProductsFile = join(canonicalCatalogRoot, 'products.json')

async function readCanonicalProducts() {
  return JSON.parse(await readFile(canonicalProductsFile, 'utf8')) as Array<
    Record<string, unknown>
  >
}

async function createCatalogFixture(
  t: TestContext,
  options: { copyImage?: boolean } = {},
) {
  const catalogRoot = await mkdtemp(join(tmpdir(), 'hidrasplash-api-catalog-'))
  const imagesRoot = join(catalogRoot, 'images')
  const products = await readCanonicalProducts()
  const product = structuredClone(products[0])
  const productsFile = join(catalogRoot, 'products.json')

  await mkdir(imagesRoot)
  if (options.copyImage ?? true) {
    const reference = String(product?.image)
    await copyFile(
      join(canonicalCatalogRoot, reference),
      join(catalogRoot, reference),
    )
  }
  await writeFile(productsFile, JSON.stringify([product]), 'utf8')
  t.after(() => rm(catalogRoot, { recursive: true, force: true }))

  return { catalogRoot, product, productsFile }
}

test('default catalog paths work from src and dist without using cwd', () => {
  const sourceModuleUrl = pathToFileURL(
    join(backendRoot, 'src', 'catalog', 'catalog-repository.ts'),
  ).href
  const builtModuleUrl = pathToFileURL(
    join(backendRoot, 'dist', 'catalog', 'catalog-repository.js'),
  ).href

  const sourcePaths = resolveDefaultCatalogPaths(sourceModuleUrl)
  const builtPaths = resolveDefaultCatalogPaths(builtModuleUrl)

  assert.equal(sourcePaths.catalogRoot, canonicalCatalogRoot)
  assert.equal(builtPaths.catalogRoot, canonicalCatalogRoot)
  assert.equal(sourcePaths.productsFile, canonicalProductsFile)
  assert.equal(builtPaths.productsFile, canonicalProductsFile)
})

test('repository loads only products.json and preserves canonical object identity', async (t) => {
  const { catalogRoot, product, productsFile } = await createCatalogFixture(t)
  await writeFile(
    join(catalogRoot, 'commercial-products.json'),
    '{ invalid editorial inventory',
    'utf8',
  )

  const catalog = await loadCatalogRepository({ catalogRoot, productsFile })
  const byId = catalog.findById(Number(product?.id))
  const bySlug = catalog.findBySlug(String(product?.slug))
  const listed = catalog.list(productListQuerySchema.parse({})).products[0]
  const listedWithoutPagination = catalog.listAll()[0]

  assert.ok(byId)
  assert.strictEqual(byId, bySlug)
  assert.strictEqual(byId, listed)
  assert.strictEqual(byId, listedWithoutPagination)
  assert.equal(catalog.listAll().length, 1)
  assert.equal(catalog.findById(999), undefined)
  assert.equal(catalog.findBySlug('produto-inexistente'), undefined)
  assert.deepEqual(byId.dataClassification, {
    commercial: 'fictional-demo',
    compatibility: 'commercial-positioning',
    formulation: 'synthetic-test-data',
    safety: 'not-evaluated',
  })
})

test('repository rejects malformed JSON, invalid products and missing images', async (t) => {
  await t.test('malformed JSON', async (t) => {
    const { catalogRoot, productsFile } = await createCatalogFixture(t)
    await writeFile(productsFile, '{ invalid json', 'utf8')

    await assert.rejects(loadCatalogRepository({ catalogRoot, productsFile }))
  })

  await t.test('invalid product', async (t) => {
    const { catalogRoot, product, productsFile } = await createCatalogFixture(t)
    await writeFile(
      productsFile,
      JSON.stringify([{ ...product, price: -1 }]),
      'utf8',
    )

    await assert.rejects(loadCatalogRepository({ catalogRoot, productsFile }))
  })

  await t.test('missing image', async (t) => {
    const { catalogRoot, productsFile } = await createCatalogFixture(t, {
      copyImage: false,
    })

    await assert.rejects(loadCatalogRepository({ catalogRoot, productsFile }))
  })
})

test('repository filters, searches and paginates the canonical catalog', async () => {
  const catalog = await loadCatalogRepository({
    catalogRoot: canonicalCatalogRoot,
    productsFile: canonicalProductsFile,
  })

  const firstPage = catalog.list(productListQuerySchema.parse({}))
  assert.deepEqual(
    firstPage.products.map((product) => product.id),
    Array.from({ length: 12 }, (_, index) => index + 1),
  )
  assert.deepEqual(
    {
      totalItems: firstPage.totalItems,
      totalPages: firstPage.totalPages,
      hasPreviousPage: firstPage.hasPreviousPage,
      hasNextPage: firstPage.hasNextPage,
    },
    {
      totalItems: 27,
      totalPages: 3,
      hasPreviousPage: false,
      hasNextPage: true,
    },
  )

  const allProducts = catalog.list(
    productListQuerySchema.parse({ pageSize: '100' }),
  )
  assert.equal(allProducts.products.length, 27)

  const accentInsensitive = catalog.list(
    productListQuerySchema.parse({ q: 'oleo corporal hidratacao' }),
  )
  assert.ok(accentInsensitive.products.some((product) => product.id === 20))

  const combined = catalog.list(
    productListQuerySchema.parse({
      q: 'anticaspa',
      category: 'shampoos',
      subcategory: 'anticaspa',
      minPrice: '40',
      maxPrice: '60',
      pageSize: '100',
    }),
  )
  assert.equal(combined.totalItems, 6)
  assert.ok(
    combined.products.every(
      (product) =>
        product.category === 'shampoos' &&
        product.subcategory === 'anticaspa' &&
        product.price >= 40 &&
        product.price <= 60,
    ),
  )

  const emptySearch = catalog.list(
    productListQuerySchema.parse({ q: '   ', pageSize: 100 }),
  )
  assert.equal(emptySearch.totalItems, 27)

  const noMatches = catalog.list(
    productListQuerySchema.parse({ q: 'produto-inexistente' }),
  )
  assert.equal(noMatches.totalItems, 0)
  assert.equal(noMatches.totalPages, 0)
  assert.deepEqual(noMatches.products, [])
})
