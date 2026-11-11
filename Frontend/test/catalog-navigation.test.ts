import assert from 'node:assert/strict'
import test from 'node:test'

import {
  createPaginationFocusIntent,
  formatProductCount,
  getSafeCatalogReturnTo,
  getSafeProductReturnTarget,
  readCatalogUrlState,
  resolvePaginationFocusIntent,
  toCatalogSearchParams,
} from '../src/utils/catalog-navigation.ts'

test('catalog URL state keeps canonical filters and page', () => {
  const state = readCatalogUrlState(
    new URLSearchParams(
      'q=avel%C3%A3&category=sabonetes&subcategory=barra&page=2',
    ),
  )

  assert.deepEqual(state, {
    q: 'avelã',
    category: 'sabonetes',
    subcategory: 'barra',
    page: 2,
  })
  assert.equal(
    toCatalogSearchParams(state).toString(),
    'q=avel%C3%A3&category=sabonetes&subcategory=barra&page=2',
  )
})

test('catalog return accepts only canonical internal storefront URLs', () => {
  const filtered =
    '/?q=avel%C3%A3&category=sabonetes&subcategory=barra&page=2'

  assert.equal(getSafeCatalogReturnTo('/'), '/')
  assert.equal(getSafeCatalogReturnTo(filtered), filtered)
  assert.equal(getSafeCatalogReturnTo('/?category=shampoos'), '/?category=shampoos')
})

test('catalog return rejects external, non-canonical and unrelated URLs', () => {
  const invalidValues = [
    undefined,
    'https://example.com/',
    '//example.com/',
    '/produtos/exemplo',
    '/?category=invalid',
    '/?subcategory=anticaspa',
    '/?page=1',
    '/?q=teste&q=duplicado',
    '/?unexpected=true',
    '/#catalogo',
  ]

  for (const value of invalidValues) {
    assert.equal(getSafeCatalogReturnTo(value), '/')
  }
})

test('product return accepts only the exact cart route or a canonical storefront URL', () => {
  assert.deepEqual(getSafeProductReturnTarget('/carrinho'), {
    to: '/carrinho',
    label: 'Voltar ao carrinho',
  })
  assert.deepEqual(
    getSafeProductReturnTarget('/?category=shampoos&subcategory=anticaspa'),
    {
      to: '/?category=shampoos&subcategory=anticaspa',
      label: 'Voltar à vitrine',
    },
  )
})

test('product return rejects cart variants, external URLs and unexpected routes', () => {
  const invalidValues = [
    '/carrinho/',
    '/carrinho?cupom=1',
    '/carrinho#resumo',
    '/checkout-demo',
    '/produtos/outro',
    'https://example.com/carrinho',
    '//example.com/carrinho',
    '/%63arrinho',
  ]

  for (const value of invalidValues) {
    assert.deepEqual(getSafeProductReturnTarget(value), {
      to: '/',
      label: 'Voltar à vitrine',
    })
  }
})

test('product count uses singular and plural concordance', () => {
  assert.equal(formatProductCount(0), '0 produtos encontrados')
  assert.equal(formatProductCount(1), '1 produto encontrado')
  assert.equal(formatProductCount(27), '27 produtos encontrados')
})

test('pagination focus is not registered for the current page', () => {
  assert.equal(createPaginationFocusIntent(2, 2, 'page=2'), undefined)
})

test('pagination focus is bound to its loading request and resolved on success', () => {
  const created = createPaginationFocusIntent(1, 2, 'page=2')
  const loading = resolvePaginationFocusIntent(
    created,
    'page=2',
    { status: 'loading', requestKey: 'request-page-2' },
    false,
  )

  assert.deepEqual(loading, {
    intent: { queryKey: 'page=2', requestKey: 'request-page-2' },
    shouldFocus: false,
  })
  assert.deepEqual(
    resolvePaginationFocusIntent(
      loading.intent,
      'page=2',
      { status: 'success', requestKey: 'request-page-2' },
      false,
    ),
    { shouldFocus: true },
  )
})

test('pagination focus is cancelled by query changes, errors and replacement requests', () => {
  const boundIntent = {
    queryKey: 'page=2',
    requestKey: 'request-page-2',
  }

  const cancelledCases = [
    resolvePaginationFocusIntent(
      boundIntent,
      'category=sabonetes',
      { status: 'loading', requestKey: 'request-filtered' },
      false,
    ),
    resolvePaginationFocusIntent(
      boundIntent,
      'page=2',
      { status: 'error', requestKey: 'request-page-2' },
      false,
    ),
    resolvePaginationFocusIntent(
      boundIntent,
      'page=2',
      { status: 'loading', requestKey: 'replacement-request' },
      false,
    ),
    resolvePaginationFocusIntent(
      boundIntent,
      'page=2',
      { status: 'success', requestKey: 'request-page-2' },
      true,
    ),
  ]

  for (const resolution of cancelledCases) {
    assert.deepEqual(resolution, { shouldFocus: false })
  }
})
