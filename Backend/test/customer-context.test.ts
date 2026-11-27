import assert from 'node:assert/strict'
import test from 'node:test'

import { interpretCustomerNeeds, resolveContextValues } from '../src/agent/customer-needs.js'
import { hidrasplashCustomerDomain } from '../src/agent/hidrasplash-customer-needs.js'
import { CHAT_MAX_HISTORY_MESSAGES, chatRequestSchema } from '../src/contracts/chat.js'
import { papelariaCustomerDomain } from './fixtures/papelaria-customer-needs.js'

const history = (...turns: readonly string[]) => turns.flatMap((content) => [
  { role: 'user' as const, content },
  { role: 'assistant' as const, content: 'Entendi.' },
])

test('context updates preserve named values until an explicit replacement or revocation', () => {
  const prior = [{ add: ['hortela', 'zinco'] }, { add: ['glicerina'] }]
  assert.deepEqual(resolveContextValues(prior, {}), {
    origin: 'inferred', value: ['hortela', 'zinco', 'glicerina'],
  })
  assert.deepEqual(resolveContextValues(prior, { revoke: ['hortela'] }), {
    origin: 'inferred', value: ['zinco', 'glicerina'],
  })
  assert.deepEqual(resolveContextValues(prior, { replace: ['aloe'] }), {
    origin: 'declared', value: ['aloe'],
  })
  assert.deepEqual(resolveContextValues(prior, { replace: [] }), { origin: 'absent' })
})

test('a historical ambiguous budget stays conservative until a current, valid correction', () => {
  const previous = history(
    'Quero shampoo anticaspa para couro oleoso até R$ 60.',
    'Pode ser até R$ 70 ou até R$ 80.',
  )
  const read = (message: string) =>
    interpretCustomerNeeds(chatRequestSchema.parse({ message, history: previous }), hidrasplashCustomerDomain)
  assert.deepEqual(read('Prefiro frescor.').budget, { origin: 'ambiguous', conservativeValue: 60 })
  assert.deepEqual(read('Na verdade, meu limite é R$ 80.').budget, { origin: 'declared', value: 80 })
})

test('an explicit budget revocation survives later turns and conflicts with a current structured ceiling', () => {
  const initial = 'Quero shampoo anticaspa para couro oleoso até R$ 40.'
  const revocation = 'Agora sem limite de orçamento.'
  const read = (input: Parameters<typeof chatRequestSchema.parse>[0]) =>
    interpretCustomerNeeds(chatRequestSchema.parse(input), hidrasplashCustomerDomain)
  assert.deepEqual(read({ message: revocation, history: history(initial) }).budget, { origin: 'absent' })
  assert.deepEqual(read({ message: 'Prefiro frescor.', history: history(initial, revocation) }).budget, { origin: 'absent' })
  assert.deepEqual(read({ message: 'Sem limite de orçamento?', history: history(initial) }).budget, {
    origin: 'inferred', value: 40,
  })
  assert.deepEqual(read({ message: revocation, history: history(initial), preferences: { maxPrice: 40 } }).budget, {
    origin: 'ambiguous', conservativeValue: 40,
  })
})

test('a question or indifference does not revoke a declared exclusion', () => {
  const previous = history('Quero shampoo anticaspa sem hortelã.')
  for (const message of ['Pode ter hortelã?', 'Tanto faz ter hortelã.', 'Prefiro algo refrescante.']) {
    const needs = interpretCustomerNeeds(
      chatRequestSchema.parse({ message, history: previous }), hidrasplashCustomerDomain,
    )
    assert.deepEqual(needs.domain.restrictions.ingredientExclusions, { origin: 'inferred', value: ['hortela'] })
  }
})

test('questions preserve the effective context both now and when replayed', () => {
  const initial = 'Quero shampoo anticaspa para couro oleoso, sem hortelã, até R$ 60. Tem que ter fragrância cítrica.'
  const questions = [
    'Será que até R$ 100 seria suficiente?',
    'Será que agora pode ter hortelã?',
    'Será que não precisa mais ter fragrância cítrica?',
    'Esse shampoo também oferece hidratação?',
    'Sabonete tem fragrância intensa?',
    'Qual a diferença entre shampoo para hidratação e sabonete?',
  ]
  const read = (message: string, ...turns: string[]) => interpretCustomerNeeds(
    chatRequestSchema.parse({ message, history: history(initial, ...turns) }), hidrasplashCustomerDomain,
  )
  for (const question of questions) {
    for (const needs of [read(question), read('Também prefiro frescor.', question)]) {
      assert.equal(needs.context.changedGoal, false, question)
      assert.deepEqual(needs.budget, { origin: 'inferred', value: 60 }, question)
      assert.deepEqual(needs.domain.objective, { origin: 'inferred', value: 'anticaspa' }, question)
      assert.deepEqual(needs.domain.restrictions.ingredientExclusions, {
        origin: 'inferred', value: ['hortela'],
      }, question)
      assert.deepEqual(needs.domain.restrictions.unsupportedRequirement, {
        origin: 'inferred', value: 'fragrancia citrica',
      }, question)
    }
    assert.deepEqual(read('Também prefiro frescor.', question).domain.preferences.sensory, {
      origin: 'declared', value: ['frescor'],
    }, question)
  }
  const mixed = read('Na verdade, meu limite agora é R$ 100. Esse shampoo tem hidratação?')
  assert.deepEqual(mixed.budget, { origin: 'declared', value: 100 })
  assert.deepEqual(mixed.domain.objective, { origin: 'inferred', value: 'anticaspa' })
  assert.deepEqual(read('Na verdade, meu limite agora é R$ 100', questions[0]).budget, {
    origin: 'declared', value: 100,
  })
  const complement = read('Também prefiro hidratação.')
  assert.equal(complement.context.changedGoal, false)
  assert.deepEqual(complement.domain.objective, { origin: 'inferred', value: 'anticaspa' })
  const newGoal = read('Agora quero shampoo para hidratação.')
  assert.equal(newGoal.context.changedGoal, true)
  assert.deepEqual(newGoal.domain.objective, { origin: 'declared', value: 'hidratacao' })
  assert.deepEqual(newGoal.budget, { origin: 'absent' })
})

test('stationery questions about paper, price or purpose do not rewrite the active goal', () => {
  const initial = 'Quero caderno para estudo com folha pautada. Tem que ser formato A5. Até R$ 60.'
  const questions = [
    'Será que até R$ 100 seria suficiente?',
    'Será que pode ser qualquer formato?',
    'Esse caderno para desenho tem folha lisa?',
    'Qual a diferença entre um caderno para desenho e outro para anotações?',
  ]
  for (const question of questions) {
    for (const [message, previous] of [[question, [initial]], ['Prefiro formato A5.', [initial, question]]] as const) {
      const needs = interpretCustomerNeeds({ message, history: history(...previous), cart: [] }, papelariaCustomerDomain)
      assert.deepEqual(needs.budget, { origin: 'inferred', value: 60 }, question)
      assert.deepEqual(needs.domain.objective, { origin: 'inferred', value: 'estudo' }, question)
      assert.deepEqual(needs.domain.restrictions.format, { origin: 'inferred', value: 'a5' }, question)
      assert.deepEqual(needs.domain.preferences.paper, { origin: 'inferred', value: 'pautada' }, question)
    }
  }
  const complement = interpretCustomerNeeds({
    message: 'Também prefiro folha pontilhada para desenho.', history: history(initial), cart: [],
  }, papelariaCustomerDomain)
  assert.equal(complement.context.changedGoal, false)
  assert.deepEqual(complement.domain.objective, { origin: 'inferred', value: 'estudo' })
  assert.deepEqual(complement.domain.preferences.paper, { origin: 'declared', value: 'pontilhada' })
})

test('a comparison does not let an alternative refer to an older recommendation by default', () => {
  const initial = 'Quero shampoo anticaspa para couro oleoso até R$ 60.'
  const previous = [
    { role: 'user', content: initial },
    { role: 'assistant', content: 'Produto 13' },
    { role: 'user', content: 'Compare os produtos 9 e 13.' },
    { role: 'assistant', content: 'Comparei os dois produtos.' },
  ] as const
  const needs = interpretCustomerNeeds({
    message: 'Me mostre outra opção?', history: previous, cart: [],
  }, hidrasplashCustomerDomain, (content) => content === 'Produto 13' ? 13 : undefined)
  assert.equal(needs.plan.presentationIntent, 'recommendation')
  assert.equal(needs.context.unresolvedRejection, true)
  assert.deepEqual(needs.exclusions.inferred, [])
  assert.deepEqual(needs.budget, { origin: 'inferred', value: 60 })
})

test('structured exclusions still apply after a new goal and resist contradictory revocation', () => {
  const previous = history('Quero shampoo anticaspa sem hortelã, prefiro frescor.')
  const switched = interpretCustomerNeeds(chatRequestSchema.parse({
    message: 'Agora quero um sabonete.',
    history: previous,
    preferences: { avoidIngredients: ['glicerina'] },
  }), hidrasplashCustomerDomain)
  assert.equal(switched.context.changedGoal, true)
  assert.deepEqual(switched.domain.restrictions.ingredientExclusions, { origin: 'declared', value: ['glicerina'] })
  assert.deepEqual(switched.domain.preferences.sensory, { origin: 'absent' })

  const conflicting = interpretCustomerNeeds(chatRequestSchema.parse({
    message: 'Pode ter zinco PCA, mudei de ideia.',
    history: previous,
    preferences: { avoidIngredients: ['zinco-pca'] },
  }), hidrasplashCustomerDomain)
  assert.equal(conflicting.domain.conflictingStructured, true)
  assert.deepEqual(conflicting.domain.restrictions.ingredientExclusions, {
    origin: 'declared', value: ['hortela', 'zinco-pca'],
  })
})

test('the permitted history window preserves only available user facts', () => {
  const previous = history(
    'Quero shampoo anticaspa para couro oleoso sem hortelã.',
    'Até R$ 60.',
    'Prefiro frescor.',
    'Qual é o prazo de entrega?',
    'Prefiro algo confortável.',
  )
  assert.equal(previous.length, CHAT_MAX_HISTORY_MESSAGES)
  const message = 'Na verdade, meu limite é R$ 80.'
  const complete = interpretCustomerNeeds(
    chatRequestSchema.parse({ message, history: previous }), hidrasplashCustomerDomain,
  )
  assert.deepEqual(complete.domain.restrictions.ingredientExclusions, { origin: 'inferred', value: ['hortela'] })
  const truncated = interpretCustomerNeeds(
    chatRequestSchema.parse({ message, history: previous.slice(1) }), hidrasplashCustomerDomain,
  )
  assert.deepEqual(truncated.domain.restrictions.ingredientExclusions, { origin: 'absent' })
  assert.deepEqual(truncated.domain.category, { origin: 'absent' })
})

test('stationery preserves format and requirements through corrections, until a revocation or new purpose', () => {
  const initial = 'Quero caderno para estudo. Prefiro formato A5 e folha pautada. Tem que ser formato A5. Até R$ 45.'
  const correction = 'Na verdade, meu limite é R$ 80. Agora prefiro folha pontilhada.'
  const release = 'Pode ser qualquer formato.'
  const read = (message: string, ...previous: string[]) => interpretCustomerNeeds({
    message, history: history(...previous), cart: [],
  }, papelariaCustomerDomain)
  const changed = read(correction, initial)
  const flexible = read(correction, 'Quero caderno para estudo com formato A5 e folha pautada. Até R$ 45.')
  assert.deepEqual(flexible.domain.preferences.format, { origin: 'inferred', value: 'a5' })
  assert.deepEqual(changed.domain.preferences.paper, { origin: 'declared', value: 'pontilhada' })
  assert.deepEqual(changed.domain.restrictions.format, { origin: 'inferred', value: 'a5' })
  assert.deepEqual(changed.budget, { origin: 'declared', value: 80 })

  const released = read(release, initial, correction)
  assert.deepEqual(released.domain.restrictions.format, { origin: 'absent' })
  assert.deepEqual(released.domain.preferences.paper, { origin: 'inferred', value: 'pontilhada' })

  const newPurpose = read('Agora quero um caderno para desenho.', initial, correction, release)
  assert.equal(newPurpose.context.changedGoal, true)
  assert.deepEqual(newPurpose.domain.objective, { origin: 'declared', value: 'desenho' })
  assert.deepEqual(newPurpose.domain.preferences.paper, { origin: 'absent' })
  assert.deepEqual(newPurpose.budget, { origin: 'absent' })
})
