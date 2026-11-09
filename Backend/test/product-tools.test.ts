import assert from 'node:assert/strict'
import { dirname, join } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

import { openRouterFunctionToolSchema } from '../src/agent/openrouter/openrouter-client.js'
import { createAgentToolRegistry } from '../src/agent/tools/agent-tool.js'
import {
  GET_PRODUCT_DETAILS_TOOL_NAME,
  PRODUCT_SEARCH_DEFAULT_LIMIT,
  SEARCH_PRODUCTS_TOOL_NAME,
  createGetProductDetailsTool,
  createProductEligibilityPolicy,
  createProductSearchIndex,
  createSearchProductsTool,
  getProductDetailsExecutionResultSchema,
  searchProductsExecutionResultSchema,
  searchProductsToolInputSchema,
} from '../src/agent/tools/product-tools.js'
import { createSearchFaqTool } from '../src/agent/tools/search-faq-tool.js'
import { loadCatalogRepository } from '../src/catalog/catalog-repository.js'
import { productSchema, type Product } from '../src/catalog/product-schema.js'

const backendRoot = dirname(dirname(fileURLToPath(import.meta.url)))
const catalogRoot = join(backendRoot, 'content', 'catalog')
const productsFile = join(catalogRoot, 'products.json')
const signal = new AbortController().signal

async function loadCatalog() {
  return loadCatalogRepository({ catalogRoot, productsFile })
}

async function createCanonicalTools(options: {
  products?: readonly Product[]
  trusted?: Parameters<typeof createProductEligibilityPolicy>[1]
} = {}) {
  const catalog = await loadCatalog()
  const products = options.products ?? catalog.listAll()
  const index = createProductSearchIndex(products)
  const eligibility = createProductEligibilityPolicy(index, options.trusted)
  return {
    catalog,
    index,
    eligibility,
    search: createSearchProductsTool(index, eligibility),
    details: createGetProductDetailsTool(catalog, eligibility),
  }
}

test('builds a deterministic canonical index and resolves only exact ingredient terms', async () => {
  const { index } = await createCanonicalTools()

  assert.equal(index.size, 27)
  assert.deepEqual(index.resolveIngredientTerms(['Cocamidopropil betaína']), {
    resolvedIds: ['cocamidopropil-betaina'],
    unresolvedTerms: [],
  })
  assert.deepEqual(index.resolveIngredientTerms(['cocamidopropil']), {
    resolvedIds: [],
    unresolvedTerms: ['cocamidopropil'],
  })
  assert.deepEqual(index.resolveIngredientTerms(['ingrediente desconhecido']), {
    resolvedIds: [],
    unresolvedTerms: ['ingrediente desconhecido'],
  })
})

test('generates strict OpenRouter-compatible JSON Schema from the runtime Zod schemas', async () => {
  const { search, details } = await createCanonicalTools()
  const faq = createSearchFaqTool({ searchFaq: () => [] })
  const registry = createAgentToolRegistry([search, details, faq])

  assert.equal(registry.size, 3)
  for (const definition of registry.definitions) {
    assert.equal(openRouterFunctionToolSchema.safeParse(definition).success, true)
    assert.equal(definition.function.parameters.type, 'object')
    assert.equal(definition.function.parameters.additionalProperties, false)
  }

  const searchDefinition = registry.definitions.find(
    (definition) => definition.function.name === SEARCH_PRODUCTS_TOOL_NAME,
  )
  const properties = searchDefinition?.function.parameters.properties as
    | Record<string, unknown>
    | undefined
  assert.ok(properties?.category)
  assert.ok(properties?.limit)
  assert.equal(
    (properties?.limit as { default?: unknown } | undefined)?.default,
    PRODUCT_SEARCH_DEFAULT_LIMIT,
  )
  assert.equal(
    searchProductsToolInputSchema.safeParse({
      category: 'shampoos',
      subcategory: 'barra',
    }).success,
    false,
  )
  assert.equal(
    searchProductsToolInputSchema.safeParse({
      category: 'shampoos',
      skinTypes: ['seca'],
    }).success,
    false,
  )
  assert.equal(
    searchProductsToolInputSchema.safeParse({
      query: 'anticaspa',
      unexpected: true,
    }).success,
    false,
  )
})

test('ranks anticaspa candidates commercially and breaks ties by canonical ID', async () => {
  const { search } = await createCanonicalTools()
  const result = searchProductsExecutionResultSchema.parse(
    await search.execute(
      {
        query: 'anticaspa cítrico',
        category: 'shampoos',
        subcategory: 'anticaspa',
        scalpTypes: ['oleoso'],
        limit: 5,
      },
      { signal },
    ),
  )

  assert.equal(result.ok && result.status, 'found')
  if (!result.ok || result.status !== 'found') return
  assert.equal(result.products[0]?.id, 13)
  assert.equal('score' in (result.products[0] ?? {}), false)
  assert.equal('image' in (result.products[0] ?? {}), false)
  assert.equal(result.products[0]?.dataClassification.safety, 'not-evaluated')
})

test('applies an inclusive budget and keeps hard constraints monotonic for details', async () => {
  const { search, details } = await createCanonicalTools()
  const result = searchProductsExecutionResultSchema.parse(
    await search.execute(
      {
        query: 'anticaspa',
        category: 'shampoos',
        subcategory: 'anticaspa',
        maxPrice: 47,
        limit: 5,
      },
      { signal },
    ),
  )
  assert.equal(result.ok && result.status, 'found')
  if (!result.ok || result.status !== 'found') return
  assert.ok(result.products.every((product) => product.price <= 47))
  assert.ok(result.products.some((product) => product.price === 46.9))

  await search.execute(
    { query: 'anticaspa', category: 'shampoos', maxPrice: 100 },
    { signal },
  )
  const detailResult = getProductDetailsExecutionResultSchema.parse(
    await details.execute({ productId: 11 }, { signal }),
  )
  assert.equal(detailResult.ok && detailResult.status, 'found')
  if (!detailResult.ok || detailResult.status !== 'found') return
  assert.equal(detailResult.product.eligibility.eligible, false)
  assert.deepEqual(detailResult.product.eligibility.reasons, [
    'above-price-limit',
  ])
})

test('permits an out-of-stock informational lookup without making it eligible', async () => {
  const canonical = await loadCatalog()
  const products = canonical.listAll().map((product) =>
    product.id === 9 ? productSchema.parse({ ...product, stock: 0 }) : product,
  )
  const index = createProductSearchIndex(products)
  const eligibility = createProductEligibilityPolicy(index, {
    requireInStock: true,
  })
  const catalog = {
    findById(id: number) {
      return index.findById(id)
    },
  }
  const details = createGetProductDetailsTool(catalog, eligibility)
  const result = getProductDetailsExecutionResultSchema.parse(
    await details.execute({ productId: 9 }, { signal }),
  )

  assert.equal(result.ok && result.status, 'found')
  if (!result.ok || result.status !== 'found') return
  assert.equal(result.product.stock, 0)
  assert.equal(result.product.eligibility.eligible, false)
  assert.deepEqual(result.product.eligibility.reasons, ['out-of-stock'])
})

test('does not allow model criteria to relax trusted backend restrictions', async () => {
  const { search } = await createCanonicalTools({
    trusted: {
      category: 'shampoos',
      subcategory: 'anticaspa',
      maxPrice: 47,
    },
  })

  const relaxedPrice = searchProductsExecutionResultSchema.parse(
    await search.execute(
      { query: 'anticaspa', maxPrice: 100, limit: 5 },
      { signal },
    ),
  )
  assert.equal(relaxedPrice.ok && relaxedPrice.status, 'found')
  if (relaxedPrice.ok && relaxedPrice.status === 'found') {
    assert.ok(relaxedPrice.products.every((product) => product.price <= 47))
  }

  const wrongCategory = await search.execute(
    { query: 'sabonete', category: 'sabonetes' },
    { signal },
  )
  assert.deepEqual(wrongCategory, {
    ok: false,
    error: {
      code: 'INVALID_ARGUMENTS',
      message: 'Argumentos inválidos para search_products.',
    },
  })
})

test('excludes synthetic ingredients without making a clinical safety claim', async () => {
  const { search } = await createCanonicalTools()
  const result = searchProductsExecutionResultSchema.parse(
    await search.execute(
      {
        query: 'anticaspa',
        category: 'shampoos',
        subcategory: 'anticaspa',
        incompatibleIngredientIds: ['cocamidopropil-betaina'],
        limit: 5,
      },
      { signal },
    ),
  )

  assert.equal(result.ok && result.status, 'not_found')
  assert.ok(!JSON.stringify(result).toLocaleLowerCase('pt-BR').includes('seguro'))
})

test('uses the body taxonomy without leaking hair compatibility fields', async () => {
  const { search } = await createCanonicalTools()
  const result = searchProductsExecutionResultSchema.parse(
    await search.execute(
      {
        category: 'sabonetes',
        skinTypes: ['sensivel'],
        bodyConcerns: ['sensibilidade'],
        limit: 5,
      },
      { signal },
    ),
  )

  assert.equal(result.ok && result.status, 'found')
  if (!result.ok || result.status !== 'found') return
  assert.ok(
    result.products.every(
      (product) => product.compatibility.applicationArea === 'body',
    ),
  )
  assert.equal('hairTypes' in result.products[0]!.compatibility, false)
})

test('checks incompatible synthetic ingredients inside kit components', async () => {
  const catalog = await loadCatalog()
  const kit = catalog.listAll().find((product) => product.productKind === 'kit')
  assert.ok(kit)
  if (!kit || kit.productKind !== 'kit') return
  const ingredientId = kit.kitContents?.[0]?.formulation?.ingredients[0]?.id
  assert.ok(ingredientId)
  if (!ingredientId) return

  const index = createProductSearchIndex([kit])
  const eligibility = createProductEligibilityPolicy(index)
  const search = createSearchProductsTool(index, eligibility)
  const result = searchProductsExecutionResultSchema.parse(
    await search.execute(
      {
        query: kit.name,
        category: kit.category,
        subcategory: kit.subcategory,
        incompatibleIngredientIds: [ingredientId],
      },
      { signal },
    ),
  )
  assert.equal(result.ok && result.status, 'not_found')
})

test('returns complete sanitized product details and honest not_found', async () => {
  const { details } = await createCanonicalTools()
  const found = getProductDetailsExecutionResultSchema.parse(
    await details.execute({ productId: 12 }, { signal }),
  )
  assert.equal(found.ok && found.status, 'found')
  if (found.ok && found.status === 'found') {
    const serialized = JSON.stringify(found)
    assert.equal(found.product.dataClassification.safety, 'not-evaluated')
    assert.ok(found.product.formulation?.warnings.length)
    assert.equal(serialized.includes('images/'), false)
    assert.equal(serialized.includes('/api/'), false)
    assert.equal(serialized.includes('absolutePath'), false)
  }

  const missing = await details.execute({ productId: 999_999 }, { signal })
  assert.deepEqual(missing, {
    ok: true,
    status: 'not_found',
    product: null,
    budgetLimited: false,
  })
  assert.equal(GET_PRODUCT_DETAILS_TOOL_NAME, 'get_product_details')
})
