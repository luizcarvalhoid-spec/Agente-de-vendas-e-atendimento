import assert from 'node:assert/strict'
import {
  copyFile,
  cp,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  symlink,
  writeFile,
} from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import test, { type TestContext } from 'node:test'
import { fileURLToPath } from 'node:url'

import { buildApp } from '../src/app.js'
import { loadCatalogRepository } from '../src/catalog/catalog-repository.js'
import {
  runCatalogValidation,
  type CatalogValidationOutput,
} from '../src/catalog/catalog-validation-command.js'
import { loadConfig } from '../src/config/env.js'
import {
  productDetailResponseSchema,
  productListResponseSchema,
} from '../src/contracts/catalog.js'

type ProductRecord = Record<string, unknown> & {
  id: number
  slug: string
  name?: string
  image: string
  dataClassification: Record<string, unknown>
}

const backendRoot = dirname(dirname(fileURLToPath(import.meta.url)))
const canonicalCatalogRoot = join(backendRoot, 'content', 'catalog')
const canonicalProductsFile = join(canonicalCatalogRoot, 'products.json')
const canonicalImagesRoot = join(canonicalCatalogRoot, 'images')

function createOutputCollector() {
  const info: string[] = []
  const errors: string[] = []
  const output: CatalogValidationOutput = {
    info(message) {
      info.push(message)
    },
    error(message) {
      errors.push(message)
    },
  }

  return { errors, info, output }
}

async function readCanonicalProducts() {
  return JSON.parse(
    await readFile(canonicalProductsFile, 'utf8'),
  ) as ProductRecord[]
}

async function copyProductImages(
  products: readonly ProductRecord[],
  catalogRoot: string,
) {
  for (const product of products) {
    const references = [
      product.image,
      ...((product.images as string[] | undefined) ?? []),
    ]

    for (const reference of references) {
      const target = join(catalogRoot, reference)
      await mkdir(dirname(target), { recursive: true })
      await copyFile(join(canonicalCatalogRoot, reference), target)
    }
  }
}

async function createSmallCatalogFixture(t: TestContext) {
  const temporaryRoot = await mkdtemp(
    join(tmpdir(), 'hidrasplash-editorial-validation-'),
  )
  const catalogRoot = join(temporaryRoot, 'catalog')
  const productsFile = join(catalogRoot, 'products.json')
  const products = structuredClone((await readCanonicalProducts()).slice(0, 2))

  await mkdir(catalogRoot)
  await copyProductImages(products, catalogRoot)
  await writeFile(productsFile, JSON.stringify(products, null, 2), 'utf8')
  t.after(() => rm(temporaryRoot, { recursive: true, force: true }))

  return { catalogRoot, products, productsFile, temporaryRoot }
}

async function runFixtureValidation(
  catalogRoot: string,
  productsFile: string,
) {
  const collector = createOutputCollector()
  const exitCode = await runCatalogValidation({
    catalogRoot,
    productsFile,
    output: collector.output,
  })

  return { ...collector, exitCode }
}

test('editorial command validates the canonical catalog with useful counts', async () => {
  const result = await runFixtureValidation(
    canonicalCatalogRoot,
    canonicalProductsFile,
  )

  assert.equal(result.exitCode, 0)
  assert.deepEqual(result.errors, [])
  assert.ok(result.info.includes('Catálogo válido.'))
  assert.ok(result.info.includes('Produtos: 27'))
  assert.ok(result.info.includes('Referências de imagem: 27'))
})

test('editorial command distinguishes malformed JSON and inaccessible files', async (t) => {
  await t.test('malformed JSON', async (t) => {
    const { catalogRoot, productsFile } = await createSmallCatalogFixture(t)
    await writeFile(productsFile, '{ invalid json', 'utf8')
    const result = await runFixtureValidation(catalogRoot, productsFile)

    assert.equal(result.exitCode, 1)
    assert.deepEqual(result.info, [])
    assert.deepEqual(result.errors, [
      'Catálogo inválido: products.json não contém JSON válido.',
    ])
  })

  await t.test('missing products file', async (t) => {
    const { catalogRoot, temporaryRoot } = await createSmallCatalogFixture(t)
    const result = await runFixtureValidation(
      catalogRoot,
      join(temporaryRoot, 'missing-products.json'),
    )

    assert.equal(result.exitCode, 1)
    assert.deepEqual(result.errors, [
      'Não foi possível ler products.json ou uma imagem referenciada pelo catálogo.',
    ])
  })
})

test('editorial command reports schema and image errors with sanitized paths', async (t) => {
  const cases: Array<{
    name: string
    mutate(products: ProductRecord[]): void
    expectedPath: RegExp
  }> = [
    {
      name: 'duplicate ID',
      mutate(products) {
        products[1]!.id = products[0]!.id
      },
      expectedPath: /products\[1\]\.id/,
    },
    {
      name: 'duplicate slug',
      mutate(products) {
        products[1]!.slug = products[0]!.slug
      },
      expectedPath: /products\[1\]\.slug/,
    },
    {
      name: 'invalid category',
      mutate(products) {
        products[0]!.category = 'categoria-invalida'
      },
      expectedPath: /products\[0\]\.category/,
    },
    {
      name: 'missing required field',
      mutate(products) {
        delete products[0]!.name
      },
      expectedPath: /products\[0\]\.name/,
    },
    {
      name: 'invalid data classification',
      mutate(products) {
        products[0]!.dataClassification.safety = 'verified'
      },
      expectedPath: /products\[0\]\.dataClassification\.safety/,
    },
    {
      name: 'missing image',
      mutate(products) {
        products[0]!.image = 'images/missing-product.jpg'
      },
      expectedPath: /products\[0\]\.image/,
    },
    {
      name: 'path traversal',
      mutate(products) {
        products[0]!.image = '../outside.jpg'
      },
      expectedPath: /products\[0\]\.image/,
    },
  ]

  for (const item of cases) {
    await t.test(item.name, async (t) => {
      const { catalogRoot, products, productsFile, temporaryRoot } =
        await createSmallCatalogFixture(t)
      item.mutate(products)
      await writeFile(productsFile, JSON.stringify(products, null, 2), 'utf8')
      const result = await runFixtureValidation(catalogRoot, productsFile)
      const output = result.errors.join('\n')

      assert.equal(result.exitCode, 1)
      assert.match(output, item.expectedPath)
      assert.doesNotMatch(output, new RegExp(temporaryRoot.replace(/\\/g, '\\\\'), 'i'))
      assert.doesNotMatch(output, /at runCatalogValidation|node_modules/i)
    })
  }
})

test('editorial command rejects an image link that escapes the catalog root', async (t) => {
  const { catalogRoot, products, productsFile, temporaryRoot } =
    await createSmallCatalogFixture(t)
  const outsideRoot = join(temporaryRoot, 'outside')
  const linkedRoot = join(catalogRoot, 'linked')

  await mkdir(outsideRoot)
  await copyFile(
    join(canonicalImagesRoot, 'shampoo-anticaspa-coco-blueberry.jpg'),
    join(outsideRoot, 'outside.jpg'),
  )
  await symlink(
    outsideRoot,
    linkedRoot,
    process.platform === 'win32' ? 'junction' : 'dir',
  )
  products[0]!.image = 'linked/outside.jpg'
  await writeFile(productsFile, JSON.stringify(products, null, 2), 'utf8')

  const result = await runFixtureValidation(catalogRoot, productsFile)

  assert.equal(result.exitCode, 1)
  assert.match(result.errors.join('\n'), /products\[0\]\.image/)
  assert.match(result.errors.join('\n'), /link simbólico/i)
})

test('temporary catalog accepts product 28 and exposes it through the API', async (t) => {
  const canonicalSourceBefore = await readFile(canonicalProductsFile, 'utf8')
  const temporaryRoot = await mkdtemp(
    join(tmpdir(), 'hidrasplash-editorial-extension-'),
  )
  const catalogRoot = join(temporaryRoot, 'catalog')
  const productsFile = join(catalogRoot, 'products.json')
  const imagesRoot = join(catalogRoot, 'images')
  const products = structuredClone(await readCanonicalProducts())
  const sourceProduct = products[26]!
  const newImageName = 'condicionador-editorial-temporario.jpg'
  const newProduct = structuredClone(sourceProduct)

  newProduct.id = 28
  newProduct.slug = 'condicionador-editorial-temporario'
  newProduct.name = 'Condicionador Editorial Temporário'
  newProduct.image = `images/${newImageName}`
  products.push(newProduct)

  await mkdir(catalogRoot)
  await cp(canonicalImagesRoot, imagesRoot, { recursive: true })
  await copyFile(
    join(canonicalCatalogRoot, sourceProduct.image),
    join(imagesRoot, newImageName),
  )
  await writeFile(productsFile, JSON.stringify(products, null, 2), 'utf8')
  t.after(() => rm(temporaryRoot, { recursive: true, force: true }))

  const validation = await runFixtureValidation(catalogRoot, productsFile)
  assert.equal(validation.exitCode, 0)
  assert.ok(validation.info.includes('Produtos: 28'))
  assert.ok(validation.info.includes('Referências de imagem: 28'))

  const catalog = await loadCatalogRepository({ catalogRoot, productsFile })
  assert.equal(catalog.findById(28)?.slug, newProduct.slug)
  const app = buildApp({ config: loadConfig({}), catalog })
  t.after(() => app.close())

  const listResponse = await app.inject({
    method: 'GET',
    url: '/api/products?pageSize=100',
  })
  const list = productListResponseSchema.parse(listResponse.json())
  assert.equal(listResponse.statusCode, 200)
  assert.equal(list.pagination.totalItems, 28)
  assert.ok(list.items.some((product) => product.id === 28))

  const detailResponse = await app.inject({
    method: 'GET',
    url: `/api/products/${newProduct.slug}`,
  })
  const detail = productDetailResponseSchema.parse(detailResponse.json())
  assert.equal(detailResponse.statusCode, 200)
  assert.equal(detail.item.id, 28)

  const imageResponse = await app.inject({
    method: 'GET',
    url: detail.media.primaryUrl,
  })
  assert.equal(imageResponse.statusCode, 200)
  assert.match(imageResponse.headers['content-type'] ?? '', /^image\/jpeg/)

  assert.equal(await readFile(canonicalProductsFile, 'utf8'), canonicalSourceBefore)
})
