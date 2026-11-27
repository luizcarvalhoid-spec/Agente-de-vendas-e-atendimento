import assert from 'node:assert/strict'
import test from 'node:test'

import { decideClarification, type ClarificationIssue } from '../src/agent/clarification-strategy.js'
import { interpretCustomerNeeds, type CustomerNeedsRequest } from '../src/agent/customer-needs.js'
import { papelariaConsultation, papelariaCustomerDomain } from './fixtures/papelaria-customer-needs.js'

const plan = { presentationIntent: 'recommendation', groundingRequirement: 'product' } as const
const history = (...turns: readonly (readonly [string, string])[]): CustomerNeedsRequest['history'] =>
  turns.flatMap(([message, reply]) => [
    { role: 'user', content: message }, { role: 'assistant', content: reply },
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
