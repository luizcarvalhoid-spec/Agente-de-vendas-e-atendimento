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
  assert.equal(decideObjection(read('Achei caro.', 'Vou pensar melhor.'), options), 'pause')
  assert.equal(decideObjection(result, options), 'inform')
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
  assert.equal(read('Também prefiro outra fragrância.').alternative, false)
  assert.equal(read('Não pode me mostrar outra opção.').alternative, false)
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

test('Papelaria Horizonte preserves a pause through a condition and factual questions in the same turn', () => {
  const history: CustomerNeedsRequest['history'] = [
    { role: 'user', content: 'Quero um caderno para estudo até R$ 60.' },
    { role: 'assistant', content: 'Entendi.' },
    { role: 'user', content: 'Vou pensar melhor. Existe algum desconto? Qual é o prazo de entrega?' },
    { role: 'assistant', content: 'Resposta informativa.' },
    { role: 'user', content: 'Quero um produto que tem que ser formato A5.' },
    { role: 'assistant', content: 'Tudo bem.' },
    { role: 'user', content: 'Até R$ 45.' },
  ]
  const interpret = (message: string, past = history) =>
    interpretCustomerNeeds({ message, history: past, cart: [] }, papelariaCustomerDomain)
  const mixed = interpret(history[2]!.content, history.slice(0, 2))
  assert.equal(mixed.context.paused, true)
  assert.equal(mixed.objection.action, 'inform')
  assert.deepEqual(mixed.objection.interpretation.topics, ['pause', 'discount'])
  assert.deepEqual(mixed.objection.information, ['Qual é o prazo de entrega?'])
  const ambiguous = interpret('Quero um produto que tem que ser formato A6.')
  assert.equal(ambiguous.objection.action, 'pause')
  assert.equal(ambiguous.context.paused, true)
  assert.deepEqual(ambiguous.domain.restrictions.format, { origin: 'declared', value: 'a6' })
  const stock = interpret('Qual é o estoque dos produtos 1 e 2?')
  assert.equal(stock.objection.action, 'inform')
  assert.equal(stock.plan.presentationIntent, 'text')
  assert.equal(interpret('Também prefiro outra cor.').objection.action, 'pause')
  assert.equal(interpret('Não me recomende um caderno.').objection.action, 'pause')
  const newRecommendation = interpret('Pode me indicar um caderno?')
  assert.equal(newRecommendation.context.paused, false)
  assert.equal(newRecommendation.plan.presentationIntent, 'recommendation')
  const resumed = interpret('Quero retomar a busca.')
  assert.equal(resumed.context.paused, false)
  assert.deepEqual(resumed.budget, { origin: 'inferred', value: 45 })
  assert.deepEqual(resumed.domain.restrictions.format, { origin: 'inferred', value: 'a5' })
  const changed = interpret('Agora quero um caderno para desenho.')
  assert.equal(changed.context.changedGoal, true)
  assert.equal(changed.context.paused, false)
  assert.deepEqual(changed.domain.objective, { origin: 'declared', value: 'desenho' })
})

test('HidraSplash keeps restrictions and rejection state independently from a request to select', () => {
  const history: CustomerNeedsRequest['history'] = [
    { role: 'user', content: 'Quero shampoo anticaspa, para couro oleoso e até R$ 60.' },
    { role: 'assistant', content: 'Escolha inicial.' },
    { role: 'user', content: 'Não quero o produto 13.' },
    { role: 'assistant', content: 'Entendido.' },
    { role: 'user', content: 'Também prefiro frescor.' },
  ]
  const interpret = (message: string) => interpretCustomerNeeds({ message, history, cart: [] }, hidrasplashCustomerDomain)
  const preference = interpret('Sem zinco PCA.')
  assert.equal(preference.objection.action, 'acknowledge')
  assert.equal(preference.context.rejectionHeld, true)
  assert.deepEqual(preference.exclusions.inferred, [13])
  assert.deepEqual(preference.domain.restrictions.ingredientExclusions, { origin: 'declared', value: ['zinco pca'] })
  const alternative = interpret('Me mostre outra opção.')
  assert.equal(alternative.objection.action, 'alternative')
  assert.equal(alternative.context.rejectionHeld, false)
  assert.equal(alternative.context.unresolvedRejection, false)
  assert.deepEqual(alternative.exclusions.inferred, [13])
})
