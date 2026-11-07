import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { readFile, readdir } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

import {
  validateCatalog,
  validateCommercialCatalog,
} from '../src/catalog/catalog-validator.js'
import {
  commercialProductCatalogSchema,
  productCatalogSchema,
} from '../src/catalog/product-schema.js'

interface ImageManifestEntry {
  id: number
  source: string
  target: string
  sha256: string
}

const backendRoot = dirname(dirname(fileURLToPath(import.meta.url)))
const catalogRoot = join(backendRoot, 'content', 'catalog')
const commercialProductsPath = join(catalogRoot, 'commercial-products.json')
const productsPath = join(catalogRoot, 'products.json')
const manifestPath = join(catalogRoot, 'image-manifest.json')
const imagesRoot = join(catalogRoot, 'images')

async function readJson(path: string) {
  return JSON.parse(await readFile(path, 'utf8')) as unknown
}

async function sha256(path: string) {
  return createHash('sha256').update(await readFile(path)).digest('hex')
}

test('commercial catalog contains the approved 27 product identities', async () => {
  const input = await readJson(commercialProductsPath)
  const products = commercialProductCatalogSchema.parse(input)

  assert.equal(products.length, 27)
  assert.deepEqual(
    products.map((product) => product.id),
    Array.from({ length: 27 }, (_, index) => index + 1),
  )

  const counts = products.reduce<Record<string, number>>((result, product) => {
    result[product.category] = (result[product.category] ?? 0) + 1
    return result
  }, {})

  assert.deepEqual(counts, {
    shampoos: 14,
    sabonetes: 5,
    'oleos-corporais': 4,
    condicionadores: 4,
  })

  const antidandruffProducts = products.filter(
    (product) =>
      product.category === 'shampoos' && product.subcategory === 'anticaspa',
  )
  assert.equal(antidandruffProducts.length, 6)
  assert.equal(
    new Set(
      antidandruffProducts.map((product) => product.variant.profile),
    ).size,
    6,
  )

  const kits = products.filter((product) => product.productKind === 'kit')
  assert.equal(kits.length, 1)
  assert.equal(kits[0]?.id, 7)
  assert.equal(kits[0]?.kitContents?.length, 2)
  assert.equal(products[0]?.name, 'Shampoo Anticaspa Coco & Blueberry — Nível 1')
  assert.equal(products[8]?.name, 'Shampoo Anticaspa Coco — Nível 2')
  assert.ok(
    products.every(
      (product) =>
        product.dataClassification.formulation === 'not-provided' &&
        product.dataClassification.safety === 'not-evaluated',
    ),
  )
})

test('commercial catalog has valid images and no duplicate binaries', async () => {
  const input = await readJson(commercialProductsPath)
  const products = await validateCommercialCatalog(input, {
    imageRoot: catalogRoot,
  })
  const manifest = (await readJson(manifestPath)) as ImageManifestEntry[]
  const imageFiles = (await readdir(imagesRoot)).filter((file) =>
    /\.(?:jpe?g|png|webp)$/i.test(file),
  )

  assert.equal(manifest.length, 27)
  assert.equal(imageFiles.length, 27)
  assert.equal(new Set(manifest.map((entry) => entry.source)).size, 27)
  assert.equal(new Set(manifest.map((entry) => entry.target)).size, 27)
  assert.equal(new Set(manifest.map((entry) => entry.sha256)).size, 27)

  const productById = new Map(products.map((product) => [product.id, product]))
  for (const entry of manifest) {
    assert.equal(productById.get(entry.id)?.image, entry.target)
    assert.equal(await sha256(join(catalogRoot, entry.target)), entry.sha256)
  }
})

test('commercial records do not bypass the publication schema', async () => {
  const rawProducts = await readFile(commercialProductsPath, 'utf8')
  const input = JSON.parse(rawProducts) as unknown

  assert.doesNotMatch(rawProducts, /\b(?:TODO|pendente|não informado)\b/i)
  assert.equal(commercialProductCatalogSchema.safeParse(input).success, true)
  assert.equal(productCatalogSchema.safeParse(input).success, false)
})

test('canonical catalog validates 27 publishable demo products and their images', async () => {
  const input = await readJson(productsPath)
  const products = await validateCatalog(input, { imageRoot: catalogRoot })

  assert.equal(products.length, 27)
  assert.deepEqual(
    products.map((product) => product.id),
    Array.from({ length: 27 }, (_, index) => index + 1),
  )
  assert.equal(new Set(products.map((product) => product.id)).size, 27)
  assert.equal(new Set(products.map((product) => product.slug)).size, 27)

  const counts = products.reduce<Record<string, number>>((result, product) => {
    result[product.category] = (result[product.category] ?? 0) + 1
    return result
  }, {})

  assert.deepEqual(counts, {
    shampoos: 14,
    sabonetes: 5,
    'oleos-corporais': 4,
    condicionadores: 4,
  })
  assert.equal(
    products.filter(
      (product) =>
        product.category === 'shampoos' &&
        product.subcategory === 'anticaspa',
    ).length,
    6,
  )
})

test('canonical products keep hair and body compatibility fields separate', async () => {
  const products = productCatalogSchema.parse(await readJson(productsPath))

  for (const product of products) {
    if (product.applicationArea === 'hair') {
      assert.ok(product.hairTypes.length > 0)
      assert.ok(product.scalpTypes.length > 0)
      assert.ok(product.concerns.length > 0)
      assert.equal('skinTypes' in product, false)
      assert.equal('bodyConcerns' in product, false)
    } else {
      assert.ok(product.skinTypes.length > 0)
      assert.ok(product.bodyConcerns.length > 0)
      assert.equal('hairTypes' in product, false)
      assert.equal('scalpTypes' in product, false)
      assert.equal('concerns' in product, false)
    }
  }
})

test('kit remains one product with two independent synthetic formulations', async () => {
  const products = productCatalogSchema.parse(await readJson(productsPath))
  const kit = products.find((product) => product.id === 7)

  assert.ok(kit)
  assert.equal(kit.productKind, 'kit')
  assert.equal(kit.kitContents?.length, 2)
  assert.equal('ingredients' in kit, false)
  assert.equal('usage' in kit, false)
  assert.equal('warnings' in kit, false)

  const formulations = kit.kitContents?.map((content) => content.formulation)
  assert.equal(formulations?.length, 2)
  assert.ok(formulations?.every((formulation) => formulation !== undefined))
  assert.ok(
    formulations?.every(
      (formulation) =>
        formulation?.basis === 'synthetic-test-data' &&
        formulation.ingredients.length > 0 &&
        formulation.usage.length > 0 &&
        formulation.warnings.length > 0,
    ),
  )
  assert.notDeepEqual(
    formulations?.[0]?.ingredients.map((ingredient) => ingredient.id),
    formulations?.[1]?.ingredients.map((ingredient) => ingredient.id),
  )
})

test('canonical data cannot present synthetic formulation or unevaluated safety as verified', async () => {
  const rawProducts = await readFile(productsPath, 'utf8')
  const products = productCatalogSchema.parse(JSON.parse(rawProducts) as unknown)

  assert.doesNotMatch(rawProducts, /"(?:formulation|safety)"\s*:\s*"verified"/i)

  for (const product of products) {
    assert.deepEqual(product.dataClassification, {
      commercial: 'fictional-demo',
      compatibility: 'commercial-positioning',
      formulation: 'synthetic-test-data',
      safety: 'not-evaluated',
    })

    const formulations =
      product.productKind === 'kit'
        ? (product.kitContents ?? []).map((content) => content.formulation)
        : [product]

    for (const formulation of formulations) {
      assert.ok(formulation)
      assert.ok(formulation.warnings?.some((warning) => /sintétic/i.test(warning)))
      assert.ok(
        formulation.warnings?.some((warning) =>
          /segurança não avaliada/i.test(warning),
        ),
      )
      assert.ok(Array.isArray(formulation.restrictions))
      assert.ok(Array.isArray(formulation.contraindications))
    }
  }
})
