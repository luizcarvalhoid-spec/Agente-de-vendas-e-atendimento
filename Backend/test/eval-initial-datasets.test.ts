import assert from 'node:assert/strict'
import { dirname, join } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

import { loadCatalogRepository } from '../src/catalog/catalog-repository.js'
import {
  EVAL_DATASET_SCHEMA_VERSION,
  type EvalAssertion,
} from '../src/evals/eval-dataset-schema.js'
import { loadEvalDataset } from '../src/evals/eval-loader.js'
import { loadFaqDocuments } from '../src/knowledge/faq-content-loader.js'

const backendRoot = dirname(dirname(fileURLToPath(import.meta.url)))
const datasetRoot = join(backendRoot, 'evals', 'datasets')
const catalogRoot = join(backendRoot, 'content', 'catalog')
const faqRoot = join(backendRoot, 'content', 'knowledge', 'faq')

const datasetFiles = [
  {
    relativePath: join('universal', 'core.v1.json'),
    id: 'universal-core',
    scope: 'universal',
  },
  {
    relativePath: join('universal', 'safety.v1.json'),
    id: 'universal-safety',
    scope: 'universal',
  },
  {
    relativePath: join(
      'stores',
      'hidrasplash',
      'recommendations.v1.json',
    ),
    id: 'hidrasplash-recommendations',
    scope: 'store',
  },
  {
    relativePath: join(
      'stores',
      'hidrasplash',
      'conversations.v1.json',
    ),
    id: 'hidrasplash-conversations',
    scope: 'store',
  },
] as const

const expectedCaseIds = [
  'universal.core.incomplete-need.001',
  'universal.core.informational-no-pressure.001',
  'universal.safety.prompt-injection.001',
  'universal.safety.adverse-reaction.001',
  'hidrasplash.recommendation.oily-refreshing-budget.001',
  'hidrasplash.recommendation.rejection-ingredient.001',
  'hidrasplash.conversation.budget-change.001',
  'hidrasplash.conversation.shipping-boundary.001',
] as const

async function loadInitialDatasets() {
  return Promise.all(
    datasetFiles.map(async (file) => ({
      ...file,
      loaded: await loadEvalDataset(join(datasetRoot, file.relativePath)),
    })),
  )
}

function normalize(value: string) {
  return value
    .normalize('NFKD')
    .replace(/\p{Diacritic}/gu, '')
    .toLocaleLowerCase('pt-BR')
}

function referencedProductIds(assertion: EvalAssertion) {
  return 'productIds' in assertion ? assertion.productIds : []
}

function referencedSourceIds(assertion: EvalAssertion) {
  return 'sourceIds' in assertion ? assertion.sourceIds : []
}

test('carrega quatro datasets v1 estritos com dois cenários cada', async () => {
  const datasets = await loadInitialDatasets()

  assert.equal(datasets.length, 4)
  for (const dataset of datasets) {
    assert.equal(dataset.loaded.data.schemaVersion, EVAL_DATASET_SCHEMA_VERSION)
    assert.equal(dataset.loaded.data.dataset.id, dataset.id)
    assert.equal(dataset.loaded.data.dataset.scope, dataset.scope)
    assert.equal(dataset.loaded.data.cases.length, 2)
    assert.equal(dataset.loaded.cases.length, 2)
  }
})

test('mantém oito IDs globais, estáveis e sem duplicação', async () => {
  const datasets = await loadInitialDatasets()
  const ids = datasets.flatMap(({ loaded }) =>
    loaded.data.cases.map((scenario) => scenario.id),
  )

  assert.equal(new Set(ids).size, 8)
  assert.deepEqual(ids, [...expectedCaseIds])
})

test('preserva integridade entre assertions, critérios e avaliações subjetivas', async () => {
  const datasets = await loadInitialDatasets()

  for (const { loaded } of datasets) {
    for (const scenario of loaded.data.cases) {
      const assertionIds = scenario.assertions.map((assertion) => assertion.id)
      const referencedAssertionIds = scenario.quality_criteria.flatMap(
        (criterion) =>
          criterion.kind === 'objective' &&
          criterion.status === 'not_evaluated'
            ? criterion.assertionIds
            : [],
      )
      assert.deepEqual(
        [...referencedAssertionIds].sort(),
        [...assertionIds].sort(),
        scenario.id,
      )

      const subjectiveCriteria = scenario.quality_criteria.filter(
        (criterion) => criterion.kind === 'subjective',
      )
      assert.ok(subjectiveCriteria.length > 0, scenario.id)
      assert.ok(
        subjectiveCriteria.every(
          (criterion) => criterion.status === 'not_evaluated',
        ),
        scenario.id,
      )
    }
  }
})

test('cobre cada turno uma vez e respeita os limites atuais de histórico', async () => {
  const datasets = await loadInitialDatasets()

  for (const { loaded } of datasets) {
    for (const scenario of loaded.data.cases) {
      const expectedTurns = scenario.input.turns.map((_, index) => index)
      const behaviorTurns = scenario.expected_behaviors
        .map((behavior) => behavior.turn)
        .sort((left, right) => left - right)
      assert.deepEqual(behaviorTurns, expectedTurns, scenario.id)
      assert.ok(
        scenario.assertions.every(
          (assertion) => assertion.turn < scenario.input.turns.length,
        ),
        scenario.id,
      )
      assert.ok(
        scenario.input.initialState.history.length +
          2 * (scenario.input.turns.length - 1) <=
          10,
        scenario.id,
      )
    }
  }
})

test('datasets universais não incorporam dados da HidraSplash', async () => {
  const datasets = await loadInitialDatasets()
  const universalDatasets = datasets.filter(
    ({ loaded }) => loaded.data.dataset.scope === 'universal',
  )

  for (const { loaded } of universalDatasets) {
    const serialized = JSON.stringify(loaded.data)
    assert.doesNotMatch(serialized, /hidrasplash/i)
    assert.doesNotMatch(serialized, /faq-\d{3}/i)
    assert.doesNotMatch(serialized, /R\$/)
    for (const scenario of loaded.data.cases) {
      assert.ok(
        scenario.assertions.every(
          (assertion) => referencedProductIds(assertion).length === 0,
        ),
        scenario.id,
      )
      assert.ok(
        scenario.assertions.every(
          (assertion) => referencedSourceIds(assertion).length === 0,
        ),
        scenario.id,
      )
    }
  }
})

test('datasets da loja referenciam apenas produtos, ingredientes e fontes canônicos', async () => {
  const [datasets, catalog, faqDocuments] = await Promise.all([
    loadInitialDatasets(),
    loadCatalogRepository({
      catalogRoot,
      productsFile: join(catalogRoot, 'products.json'),
    }),
    loadFaqDocuments({ faqRoot }),
  ])
  const storeDatasets = datasets.filter(
    ({ loaded }) => loaded.data.dataset.scope === 'store',
  )
  const products = catalog.listAll()
  const productIds = new Set(products.map((product) => product.id))
  const sourceIds = new Set(faqDocuments.map((document) => document.sourceId))
  const ingredientTerms = new Set(
    products.flatMap((product) =>
      [
        ...(product.ingredients ?? []),
        ...(product.kitContents ?? []).flatMap(
          (content) => content.formulation?.ingredients ?? [],
        ),
      ].flatMap((ingredient) => [
        normalize(ingredient.id),
        normalize(ingredient.name),
      ]),
    ),
  )

  for (const { loaded } of storeDatasets) {
    assert.equal(loaded.data.dataset.scope, 'store')
    if (loaded.data.dataset.scope !== 'store') continue
    assert.equal(loaded.data.dataset.storeProfile, 'hidrasplash')
    for (const scenario of loaded.data.cases) {
      for (const assertion of scenario.assertions) {
        for (const productId of referencedProductIds(assertion)) {
          assert.ok(productIds.has(productId), `${scenario.id}: ${productId}`)
        }
        for (const sourceId of referencedSourceIds(assertion)) {
          assert.ok(sourceIds.has(sourceId), `${scenario.id}: ${sourceId}`)
        }
        if (assertion.type === 'products_satisfy_ingredient_restrictions') {
          for (const term of assertion.terms) {
            assert.ok(ingredientTerms.has(normalize(term)), scenario.id)
          }
        }
      }
      for (const productId of
        scenario.input.initialState.recommendationContext?.productIds ?? []) {
        assert.ok(productIds.has(productId), `${scenario.id}: ${productId}`)
      }
    }
  }

  const product9 = catalog.findById(9)
  const product13 = catalog.findById(13)
  assert.ok(product9)
  assert.ok(product13)
  assert.ok(product9.price <= 47)
  assert.ok(product13.price <= 50)
  assert.ok(product13.price > 47)
  assert.equal(product9.variant.profile, 'limpeza-intensa')
  assert.ok(product13.variant.sensoryNotes?.includes('Cítrico'))

  const anticaspaProducts = products.filter(
    (product) => product.subcategory === 'anticaspa',
  )
  assert.ok(anticaspaProducts.length > 0)
  assert.ok(
    anticaspaProducts.every((product) =>
      product.ingredients?.some(
        (ingredient) => ingredient.id === 'cocamidopropil-betaina',
      ),
    ),
  )

  const shippingBoundary = faqDocuments.find(
    (document) => document.sourceId === 'faq-002',
  )
  assert.ok(shippingBoundary)
  assert.match(shippingBoundary.content, /maior que R\$ 100,00/)
  assert.match(shippingBoundary.content, /não recebe frete grátis/)
  assert.match(shippingBoundary.content, /não gera uma entrega real/)
})

test('datasets são somente especificações e não alegam execução', async () => {
  const datasets = await loadInitialDatasets()

  for (const { loaded } of datasets) {
    for (const scenario of loaded.data.cases) {
      assert.ok(
        scenario.quality_criteria
          .filter((criterion) => criterion.applicability !== 'not_applicable')
          .every((criterion) => criterion.status === 'not_evaluated'),
        scenario.id,
      )
    }
  }
})
