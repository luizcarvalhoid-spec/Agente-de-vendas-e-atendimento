import assert from 'node:assert/strict'
import test from 'node:test'

import { interpretCustomerNeeds, normalize, type CustomerNeedsRequest } from '../src/agent/customer-needs.js'
import { hidrasplashCustomerDomain } from '../src/agent/hidrasplash-customer-needs.js'
import { cheaperPriceCeiling, decideObjection, readObjections } from '../src/agent/objection-strategy.js'
import { papelariaConsultation, papelariaCustomerDomain } from './fixtures/papelaria-customer-needs.js'

const read = (...parts: string[]) => readObjections(parts.map(normalize))
const options = { paused: false, information: false, selects: false }

test('objections retain their provenance and preserve the priority of customer decisions', () => {
  const result = read('Achei caro.', 'Você consegue fazer por R$ 40?', 'Será que é adequado para mim?', 'Vou pensar melhor.')
  assert.deepEqual(result.concerns, [
    { origin: 'declared', value: 'pause' },
    { origin: 'inferred', value: 'discount' },
    { origin: 'declared', value: 'price' },
    { origin: 'ambiguous', conservativeValue: 'fit' },
  ])
  assert.equal(decideObjection(result, options), 'pause')
  assert.equal(decideObjection(result, { ...options, information: true }), 'inform')
  assert.equal(decideObjection(read('Deixa pra lá.', 'Tem algo mais barato?'), options), 'stop')
})

test('a fit question, dissatisfaction with a rationale, and a hypothetical request do not discard an item', () => {
  for (const [message, primary] of [
    ['Não tenho certeza se é adequado para mim.', 'fit'],
    ['Não gostei da justificativa.', 'rationale'],
    ['Já comprei algo parecido e não gostei.', 'confidence'],
    ['Será que meu limite deveria ser R$ 40?', undefined],
    ['E se eu quiser outra opção?', undefined],
  ] as const) {
    const result = read(message)
    assert.equal(result.primary, primary, message)
    assert.equal(result.alternative, false, message)
  }
  assert.deepEqual(read('Não gostei do produto 13.').concerns, [{ origin: 'declared', value: 'product' }])
  assert.deepEqual(read('O frete ficou caro.').concerns, [{ origin: 'declared', value: 'freight' }])
  assert.equal(read('Não quero esse produto.').primary, 'product')
  assert.equal(read('Não gosto de fragrância forte.').primary, 'attribute')
  assert.equal(read('Tem algo mais barato?').cheaper, true)
})

test('price objections and counteroffers replay without changing a declared ceiling', () => {
  const request: CustomerNeedsRequest = {
    message: 'Você consegue fazer por até R$ 40?',
    cart: [],
    history: [
      { role: 'user', content: 'Quero shampoo anticaspa até R$ 60.' },
      { role: 'assistant', content: 'Preço inventado de R$ 25.' },
      { role: 'user', content: 'Achei caro.' },
    ],
  }
  const counteroffer = interpretCustomerNeeds(request, hidrasplashCustomerDomain)
  assert.deepEqual(counteroffer.budget, { origin: 'inferred', value: 60 })
  assert.equal(counteroffer.objection.action, 'explain')
  const updated = interpretCustomerNeeds({ ...request, message: 'Achei caro. Na verdade, meu limite agora é R$ 40.' }, hidrasplashCustomerDomain)
  assert.deepEqual(updated.budget, { origin: 'declared', value: 40 })
  const later = interpretCustomerNeeds({
    ...request, message: 'Tem algo mais barato?', history: [...request.history, { role: 'user', content: 'Meu limite agora é R$ 40.' }],
  }, hidrasplashCustomerDomain)
  assert.equal(later.objection.action, 'alternative')
  assert.deepEqual(later.budget, { origin: 'inferred', value: 40 })
  assert.deepEqual(later.exclusions, { declared: [], inferred: [] })
  assert.equal(cheaperPriceCeiling(4_890, 60), 48.89)
  assert.equal(cheaperPriceCeiling(4_890, 40), 40)
  assert.equal(cheaperPriceCeiling(0, 40), undefined)
  const exclusion = interpretCustomerNeeds({ ...request, message: 'Achei caro, sem zinco PCA.' }, hidrasplashCustomerDomain)
  assert.deepEqual(exclusion.domain.restrictions.ingredientExclusions, { origin: 'declared', value: ['zinco pca'] })
})

test('Papelaria Horizonte applies the same decisions and keeps its mandatory format', () => {
  const request: CustomerNeedsRequest = {
    message: 'Achei caro.',
    history: [
      { role: 'user', content: 'Quero um caderno para estudo, tem que ser formato A5, até R$ 60.' },
      { role: 'assistant', content: 'Indico o caderno de ID 1.' },
    ],
    cart: [],
  }
  const interpret = (input: CustomerNeedsRequest) => interpretCustomerNeeds(input, papelariaCustomerDomain,
    (message) => message === 'Indico o caderno de ID 1.' ? 1 : undefined)
  const priced = interpret(request)
  assert.equal(priced.objection.action, 'acknowledge')
  assert.deepEqual(priced.budget, { origin: 'inferred', value: 60 })
  const fit = interpret({ ...request, message: 'Não tenho certeza se é adequado para mim.' })
  assert.equal(fit.objection.action, 'inform')
  assert.deepEqual(fit.exclusions.inferred, [])
  const rejected = interpret({ ...request, message: 'Não quero o produto 1.' })
  assert.equal(rejected.objection.action, 'acknowledge')
  assert.deepEqual(rejected.exclusions.declared, [1])
  const attribute = interpret({ ...request, message: 'Não gosto de capa dura.' })
  assert.equal(attribute.objection.interpretation.primary, 'attribute')
  assert.deepEqual(attribute.exclusions, { inferred: [], declared: [] })
  const alternative = interpret({ ...request, message: 'Tem algo mais barato?' })
  assert.equal(alternative.objection.action, 'alternative')
  assert.deepEqual(alternative.domain.restrictions.format, { origin: 'inferred', value: 'a5' })
  assert.deepEqual(papelariaConsultation(alternative.domain).issues, [])
  const maxPrice = cheaperPriceCeiling(4_000, 60)!
  const eligible = [
    { id: 1, format: 'a5', price: 40, stock: 3 },
    { id: 2, format: 'a4', price: 30, stock: 3 },
    { id: 3, format: 'a5', price: 35, stock: 3 },
    { id: 4, format: 'a5', price: 32, stock: 0 },
  ].filter((item) => item.price <= maxPrice && item.format === 'a5' && item.stock > 0)
  assert.deepEqual(eligible.map(({ id }) => id), [3])
  const paused = interpret({ ...request, message: 'Talvez depois.' })
  assert.equal(paused.objection.action, 'pause')
  const history = [...request.history, { role: 'user' as const, content: 'Talvez depois.' }]
  assert.equal(interpret({ ...request, history, message: 'Até R$ 45.' }).objection.action, 'pause')
  const resumed = interpret({ ...request, history, message: 'Quero retomar a busca.' })
  assert.equal(resumed.plan.presentationIntent, 'recommendation')
  assert.deepEqual(resumed.domain.restrictions.format, { origin: 'inferred', value: 'a5' })
})
