import assert from 'node:assert/strict'
import test from 'node:test'

import { createConversationLanguage, matchesClarificationQuestion, recommendationSubject } from '../src/agent/conversation-language.js'
import { shortProductFact } from '../src/agent/chat-grounding-planner.js'
import { budgetQuestion, clarificationReply, interpretCustomerNeeds, type CustomerNeedsRequest } from '../src/agent/customer-needs.js'
import { decideClarification } from '../src/agent/clarification-strategy.js'
import { hidrasplashCustomerDomain } from '../src/agent/hidrasplash-customer-needs.js'
import { papelariaConsultation, papelariaCustomerDomain } from './fixtures/papelaria-customer-needs.js'

const turns = (...pairs: readonly (readonly [string, string])[]): CustomerNeedsRequest['history'] =>
  pairs.flatMap(([message, reply]) => [{ role: 'user', content: message }, { role: 'assistant', content: reply }])

test('all recommendation introductions are paired with an exact, unique canonical subject', () => {
  const product = { id: 1, name: 'Caderno Horizonte A5' }
  const other = { id: 2, name: 'Caderno Horizonte A4' }
  const history: { role: 'assistant'; content: string }[] = []
  const rendered = Array.from({ length: 4 }, () => {
    const message = createConversationLanguage(history).recommendation(product.name)
    history.push({ role: 'assistant', content: message })
    return message
  })
  assert.equal(rendered[0], 'Pelo que você me contou, eu escolheria Caderno Horizonte A5.')
  assert.equal(new Set(rendered.slice(0, 3)).size, 3)
  assert.equal(rendered[3], rendered[0])
  for (const introduction of rendered) {
    assert.equal(recommendationSubject(introduction + ' Esta é uma opção do catálogo.', [product, other]), 1)
    assert.equal(recommendationSubject('Uma vez você disse: ' + introduction, [product, other]), undefined)
    assert.equal(recommendationSubject(introduction + '0', [product, other]), undefined)
    assert.equal(recommendationSubject(introduction, [product, { ...product, id: 3 }]), undefined)
  }
  assert.equal(recommendationSubject('Caderno Horizonte A5 é o nome que apareceu.', [product, other]), undefined)
})

test('clarification variants remain bounded to complete final blocks', () => {
  const question = ['Qual é seu limite?', 'Qual teto devo usar?'] as const
  const first = createConversationLanguage().question(question)
  const second = createConversationLanguage(turns(['Meu limite mudou.', first])).question(question)
  assert.deepEqual([first, second], [...question])
  for (const wording of question) {
    assert.equal(matchesClarificationQuestion('Uma condição verificada.\n\n' + wording, question), true)
    assert.equal(matchesClarificationQuestion('A mensagem reproduziu ' + wording, question), false)
    assert.equal(matchesClarificationQuestion(wording + '\n\nEscolha um produto.', question), false)
  }
  assert.equal(createConversationLanguage([{ role: 'user', content: first }]).question(question), first)
})

test('colloquial constructions preserve negative, hypothetical and uncertain contexts', () => {
  assert.equal(shortProductFact('Qto custa?'), 'price')
  assert.equal(shortProductFact('Tem estoque msm?'), 'stock')
  assert.equal(shortProductFact('E se eu quiser saber quanto custa?'), undefined)
  assert.equal(clarificationReply('Tanto faz msm.'), 'indifferent')
  assert.equal(clarificationReply('Pode escolher pra mim.'), 'delegated')
  assert.equal(clarificationReply('Não pode escolher pra mim.'), undefined)

  const read = (message: string, history: CustomerNeedsRequest['history'] = []) =>
    interpretCustomerNeeds({ message, history, cart: [] }, hidrasplashCustomerDomain)
  assert.deepEqual(read('Meu couro é mto oleoso.').domain.preferences.scalpTypes, { origin: 'declared', value: ['oleoso'] })
  const negation = read('Meu couro não é mto oleoso.')
  assert.equal(negation.domain.preferences.scalpTypes.origin, 'absent')
  assert.equal(negation.domain.preferences.hairConcerns.origin, 'absent')
  assert.doesNotMatch(negation.domain.rankingText, /oleoso/)
  assert.equal(read('Tá caro pra mim.').objection.interpretation.primary, 'price')
  assert.equal(read('N curti esse.').objection.interpretation.primary, 'product')
  assert.equal(read('Tem um mais em conta?').objection.action, 'alternative')
  for (const message of ['Blz, vejo depois.', 'Agora não, vlw.']) {
    assert.equal(read(message).context.paused, true)
  }
  const history = turns(['Quero shampoo anticaspa sem hortelã, até R$ 45.', 'Entendi.'])
  assert.equal(read('Pode ter hortelã agr.', history).domain.restrictions.ingredientExclusions.origin, 'absent')
  for (const message of ['Será que pode ter hortelã agr?', 'Pode ter hortelã agr?', 'Não pode ter hortelã agr.']) {
    const exclusions = read(message, history).domain.restrictions.ingredientExclusions
    assert.deepEqual('value' in exclusions && exclusions.value, ['hortela'], message)
  }
  assert.deepEqual(read('Meu limite é uns 50 reais.').budget, { origin: 'inferred', value: 50 })
  assert.deepEqual(read('Meu limite é uns 50 reais.', history).budget, { origin: 'inferred', value: 45 })
  for (const message of ['Será que até uns 50 reais daria?', 'Você consegue fazer por até uns 50 reais?']) {
    assert.deepEqual(read(message, history).budget, { origin: 'inferred', value: 45 }, message)
  }
  const replayed = read('Também prefiro frescor.', [...history, ...turns(['Meu limite é uns 50 reais.', 'Certo.'])])
  assert.deepEqual(replayed.budget, { origin: 'inferred', value: 45 })
  const pending = turns(['Quero shampoo anticaspa até R$ 80.', budgetQuestion[1]])
  const approximate = 'Meu limite é uns 50 reais.'
  assert.equal(read(approximate, pending).context.budgetEvidenceMissing, true)
  assert.equal(read('Também prefiro frescor.', [...pending, ...turns([approximate, budgetQuestion[0]])]).context.budgetEvidenceMissing, true)
})

test('Papelaria uses both wordings to resolve an obligation without delegating it', () => {
  const initial = 'Quero um caderno para estudo. Tem que ser formato A4 e tem que ser formato A5. Até R$ 50.'
  const read = (message: string, history: CustomerNeedsRequest['history'] = []) =>
    interpretCustomerNeeds({ message, history, cart: [] }, papelariaCustomerDomain)
  const blocked = read(initial)
  const issue = papelariaConsultation(blocked.domain).issues[0]!
  const first = createConversationLanguage().question(issue.question!)
  const second = createConversationLanguage(turns([initial, first])).question(issue.question!)
  assert.notEqual(first, second)
  for (const question of [first, second]) {
    const history = turns([initial, question])
    const indifferent = read('Tanto faz msm.', history)
    assert.equal(decideClarification({
      ...papelariaConsultation(indifferent.domain), plan: indifferent.plan, message: 'Tanto faz msm.', history: indifferent.context.history,
    }).action, 'explain')
    const resolved = read('A5.', history)
    assert.deepEqual(resolved.domain.restrictions.format, { origin: 'declared', value: 'a5' })
    assert.deepEqual(resolved.budget, { origin: 'inferred', value: 50 })
    assert.deepEqual(papelariaConsultation(resolved.domain).issues, [])
    const options = [
      { id: 1, name: 'Caderno Horizonte A4', format: 'a4', price: 40 },
      { id: 2, name: 'Caderno Horizonte A5', format: 'a5', price: 45 },
    ]
    const selected = options.filter(({ format, price }) =>
      'value' in resolved.domain.restrictions.format && format === resolved.domain.restrictions.format.value &&
      'value' in resolved.budget && price <= resolved.budget.value)
    assert.deepEqual(selected.map(({ id }) => id), [2])
    const wording = createConversationLanguage(history).recommendation(selected[0]!.name)
    assert.equal(recommendationSubject(wording, options), 2)
  }
  const paused = read('Blz, vejo depois.', turns([initial, first]))
  assert.equal(paused.objection.action, 'pause')
  const language = createConversationLanguage()
  const pause = language.reply('pause')
  assert.notEqual(createConversationLanguage(turns(['Blz, vejo depois.', pause])).reply('pause'), pause)
})
