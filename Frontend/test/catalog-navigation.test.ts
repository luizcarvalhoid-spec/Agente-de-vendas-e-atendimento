import assert from 'node:assert/strict'
import test from 'node:test'

import {
  formatProductCount,
  getSafeCatalogReturnTo,
  readCatalogUrlState,
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

test('product count uses singular and plural concordance', () => {
  assert.equal(formatProductCount(0), '0 produtos encontrados')
  assert.equal(formatProductCount(1), '1 produto encontrado')
  assert.equal(formatProductCount(27), '27 produtos encontrados')
})
