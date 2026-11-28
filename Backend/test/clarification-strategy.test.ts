import assert from 'node:assert/strict'
import test from 'node:test'

import { decideClarification, type ClarificationIssue } from '../src/agent/clarification-strategy.js'
import { budgetQuestion, clarificationReply, interpretCustomerNeeds, type CustomerNeedsRequest } from '../src/agent/customer-needs.js'
import { hidrasplashCustomerDomain } from '../src/agent/hidrasplash-customer-needs.js'
import { papelariaConsultation, papelariaCustomerDomain } from './fixtures/papelaria-customer-needs.js'
import { createConversationLanguage, type ClarificationPrompt } from '../src/agent/conversation-language.js'

const plan = { presentationIntent: 'recommendation', groundingRequirement: 'product' } as const
const language = createConversationLanguage()
const history = (...turns: readonly (readonly [string, ClarificationPrompt])[]): CustomerNeedsRequest['history'] =>
  turns.flatMap(([message, reply]) => [
    { role: 'user', content: message }, { role: 'assistant', content: language.question(reply) },
  ])

test('the universal decision orders issues and explains an unresolvable condition without a question', () => {
  const reference: ClarificationIssue = {
    reason: 'ambiguous_reference', priority: 'ambiguity', attribute: 'product',
    question: 'A qual produto você se refere?', limitation: 'O produto ainda está em aberto.',
  }
  const budget: ClarificationIssue = {
    reason: 'budget_conflict', priority: 'restriction', attribute: 'budget',
    question: 'Qual valor máximo você quer gastar?', limitation: 'O teto ainda está em aberto.',
  }
  const safety: ClarificationIssue = {
    reason: 'blocked', priority: 'safety', attribute: 'safety', limitation: 'Não consigo verificar essa informação.',
  }
  const base = { plan, history: [], message: 'Quero escolher.' }
  assert.deepEqual(decideClarification({ ...base, issues: [reference, budget] }), { action: 'ask', issue: budget })
  assert.deepEqual(decideClarification({ ...base, issues: [budget, safety] }), { action: 'explain', issue: safety })
  assert.deepEqual(decideClarification({ ...base, issues: [budget], message: 'Tanto faz.' }), { action: 'explain', issue: budget })
  assert.deepEqual(decideClarification({
    ...base, issues: [], plan: { presentationIntent: 'text', groundingRequirement: 'not_required' },
  }), { action: 'direct' })
})

test('Papelaria Horizonte asks about purpose or format only while the answer can change the choice', () => {
  const read = (message: string, previous: CustomerNeedsRequest['history'] = []) => {
    const needs = interpretCustomerNeeds({ message, history: previous, cart: [] }, papelariaCustomerDomain)
    return decideClarification({
      ...papelariaConsultation(needs.domain), plan: needs.plan, message, history: needs.context.history,
    })
  }
  const withoutPurpose = read('Quero um caderno.')
  assert.equal(withoutPurpose.action, 'ask')
  assert.equal(withoutPurpose.issue.attribute, 'purpose')
  const purposeAnswered = read('Para desenho.', history(['Quero um caderno.', withoutPurpose.issue.question ?? '']))
  assert.equal(purposeAnswered.action, 'search')
  assert.equal(purposeAnswered.question?.attribute, 'format')

  const initial = 'Quero um caderno para desenho.'
  const withoutFormat = read(initial)
  assert.equal(withoutFormat.action, 'search')
  assert.equal(withoutFormat.question?.attribute, 'format')
  const prior = history([initial, withoutFormat.question?.question ?? ''])
  const unknown = read('Não sei.', prior)
  assert.deepEqual(unknown, { action: 'search', selection: 'recommendation', flexible: true })
  const answered = read('A5.', prior)
  assert.deepEqual(answered, { action: 'search', selection: 'recommendation', flexible: false })
  const enough = read('Quero um caderno para desenho com formato A5.')
  assert.deepEqual(enough, answered)

  const conflicting = 'Quero um caderno para desenho. Tem que ser formato A4 e tem que ser formato A5.'
  const mandatory = read(conflicting)
  assert.equal(mandatory.action, 'ask')
  assert.equal(mandatory.issue.attribute, 'format')
  const refused = read('Tanto faz.', history([conflicting, mandatory.issue.question ?? '']))
  assert.equal(refused.action, 'explain')
  assert.equal(refused.issue.reason, 'format_conflict')
})

test('short budget answers require a real conflict and replay as confirmed context', () => {
  const initial = 'Quero shampoo anticaspa até R$ 50 ou até R$ 80.'
  const read = (message: string, previous: CustomerNeedsRequest['history']) =>
    interpretCustomerNeeds({ message, history: previous, cart: [] }, hidrasplashCustomerDomain)
  for (const question of budgetQuestion) {
    for (const answer of ['R$ 50.', '50 reais.', '50.', 'Até R$ 50.']) {
      const current = read(answer, history([initial, question]))
      assert.deepEqual(current.budget, { origin: 'declared', value: 50 }, answer)
      assert.equal(current.plan.presentationIntent, 'recommendation')
      const resumed = read('Também prefiro frescor.', history([initial, question], [answer, 'Anotei o teto.']))
      assert.deepEqual(resumed.budget, { origin: 'inferred', value: 50 }, answer)
      assert.equal(resumed.plan.presentationIntent, 'recommendation')
    }
  }
  assert.equal(read('50 ou 80.', history([initial, budgetQuestion])).budget.origin, 'ambiguous')
  assert.equal(read('50.', history([initial, budgetQuestion], ['50 ou 80.', budgetQuestion])).budget.origin, 'declared')
  assert.deepEqual(read('50.', history(['Quero shampoo anticaspa até R$ 60.', budgetQuestion])).budget, {
    origin: 'inferred', value: 60,
  })
  assert.equal(read('50.', history([initial, 'Qual produto era?'])).budget.origin, 'ambiguous')
  assert.equal(read('50.', []).budget.origin, 'absent')
  const structured = interpretCustomerNeeds({
    message: '50.',
    history: history(['Quero shampoo anticaspa até R$ 80.', budgetQuestion]),
    cart: [],
    preferences: { maxPrice: 50 },
  }, hidrasplashCustomerDomain)
  assert.deepEqual(structured.budget, { origin: 'declared', value: 50 })
  assert.equal(structured.context.budgetAnswerConfirmed, true)
})

test('refusal survives ordinary follow-ups and can be changed by an explicit delegation', () => {
  const question = 'Qual tamanho você prefere?'
  const issue: ClarificationIssue = {
    reason: 'size', priority: 'preference', attribute: 'size', question, limitation: 'Ainda não tenho essa informação.',
  }
  const prior = history(['Quero escolher um produto.', question], ['Não quero responder.', 'Tudo bem.'])
  const read = (message: string) => decideClarification({
    plan, message, history: prior, issues: [], selectionQuestion: issue, canChooseWithoutPreference: true,
  })
  assert.equal(read('Até R$ 50.').action, 'explain')
  assert.equal(read('Tanto faz.').action, 'explain')
  assert.deepEqual(read('Você pode escolher.'), { action: 'search', selection: 'recommendation', flexible: true })
  assert.deepEqual([
    'Não sei.', 'Não tenho preferência.', 'Você pode escolher.', 'Não quero responder.', 'Não quero continuar.',
  ].map(clarificationReply), ['unknown', 'indifferent', 'delegated', 'refused', 'ended'])
})

test('Papelaria Horizonte separates a mandatory format answer from a preference and replays it', () => {
  const initial = 'Quero um caderno para estudo. Tem que ser formato A4 e tem que ser formato A5. Até R$ 50 ou até R$ 80.'
  const read = (message: string, previous: CustomerNeedsRequest['history']) =>
    interpretCustomerNeeds({ message, history: previous, cart: [] }, papelariaCustomerDomain)
  const budget = read('50 reais.', history([initial, budgetQuestion]))
  assert.deepEqual(budget.budget, { origin: 'declared', value: 50 })
  const issue = papelariaConsultation(budget.domain).issues[0]
  assert.equal(issue?.reason, 'format_conflict')
  const formatQuestion = issue?.question ?? ''
  const prior = history([initial, budgetQuestion], ['50 reais.', formatQuestion])
  const answer = read('A5.', prior)
  assert.deepEqual(answer.domain.restrictions.format, { origin: 'declared', value: 'a5' })
  assert.deepEqual(answer.budget, { origin: 'inferred', value: 50 })
  const resumed = read('Prefiro folha lisa.', [...prior, ...history(['A5.', 'Formato confirmado.'])])
  assert.deepEqual(resumed.domain.restrictions.format, { origin: 'inferred', value: 'a5' })
  assert.deepEqual(resumed.budget, { origin: 'inferred', value: 50 })
  assert.deepEqual(papelariaConsultation(resumed.domain).issues, [])
  const forged = read('A5.', history(['Quero caderno para estudo. Tem que ser formato A4.', formatQuestion]))
  assert.deepEqual(forged.domain.restrictions.format, { origin: 'inferred', value: 'a4' })
})

test('Papelaria Horizonte retains purpose ambiguity after an independent format answer', () => {
  const initial = 'Quero um caderno para estudo ou desenho até R$ 50.'
  const read = (message: string, previous: CustomerNeedsRequest['history']) =>
    interpretCustomerNeeds({ message, history: previous, cart: [] }, papelariaCustomerDomain)
  const format = read('Formato A5.', history([initial, 'Para que você vai usar o caderno?']))
  assert.equal(format.domain.objective.origin, 'ambiguous')
  assert.deepEqual(format.domain.preferences.format, { origin: 'declared', value: 'a5' })
  assert.equal(papelariaConsultation(format.domain).issues[0]?.attribute, 'purpose')
  const confirmed = read('Para desenho.', history(
    [initial, 'Para que você vai usar o caderno?'], ['Formato A5.', 'Para que você vai usar o caderno?'],
  ))
  assert.deepEqual(confirmed.domain.objective, { origin: 'declared', value: 'desenho' })
  assert.deepEqual(confirmed.domain.preferences.format, { origin: 'inferred', value: 'a5' })
  assert.deepEqual(confirmed.budget, { origin: 'inferred', value: 50 })
  assert.deepEqual(papelariaConsultation(confirmed.domain).issues, [])
})
