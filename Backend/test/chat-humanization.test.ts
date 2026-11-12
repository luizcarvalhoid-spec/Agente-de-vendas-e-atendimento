import assert from 'node:assert/strict'
import { dirname, join } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

import type {
  AgentModelInput,
  AgentModelPort,
  AgentModelResult,
  AgentToolCall,
} from '../src/agent/agent-model-port.js'
import { createChatService } from '../src/agent/chat-service.js'
import { createProductSearchIndex } from '../src/agent/tools/product-tools.js'
import { loadCatalogRepository } from '../src/catalog/catalog-repository.js'
import { chatRequestSchema } from '../src/contracts/chat.js'
import { loadFaqDocuments } from '../src/knowledge/faq-content-loader.js'
import { createFaqSearchIndex } from '../src/knowledge/faq-search.js'

const backendRoot = dirname(dirname(fileURLToPath(import.meta.url)))
const requestId = '00000000-0000-4000-8000-000000000034'

type ModelStep =
  | AgentModelResult
  | ((input: AgentModelInput) => AgentModelResult | Promise<AgentModelResult>)

function assistant(
  content: string | null,
  toolCalls?: readonly AgentToolCall[],
): AgentModelResult {
  return {
    message: {
      role: 'assistant',
      content,
      ...(toolCalls ? { toolCalls } : {}),
    },
  }
}

function toolCall(id: string, name: string, args: unknown): AgentToolCall {
  return {
    id,
    type: 'function',
    function: { name, arguments: JSON.stringify(args) },
  }
}

function queueModel(steps: ModelStep[]): AgentModelPort {
  return {
    async complete(input) {
      const step = steps.shift()
      if (!step) throw new Error('Unexpected fake-model call')
      return typeof step === 'function' ? step(input) : step
    },
  }
}

const anticaspaSearch = (maxPrice = 50) =>
  toolCall('products', 'search_products', {
    query: 'anticaspa frescor',
    category: 'shampoos',
    subcategory: 'anticaspa',
    scalpTypes: ['oleoso'],
    hairConcerns: ['caspa', 'oleosidade'],
    maxPrice,
    requireInStock: true,
    limit: 5,
  })

async function buildService(model: AgentModelPort) {
  const [catalog, faqDocuments] = await Promise.all([
    loadCatalogRepository({
      catalogRoot: join(backendRoot, 'content', 'catalog'),
      productsFile: join(backendRoot, 'content', 'catalog', 'products.json'),
    }),
    loadFaqDocuments({
      faqRoot: join(backendRoot, 'content', 'knowledge', 'faq'),
    }),
  ])
  return createChatService({
    catalog,
    productIndex: createProductSearchIndex(catalog.listAll()),
    faqIndex: createFaqSearchIndex(faqDocuments),
    faqDocuments,
    model,
  })
}

async function execute(
  model: AgentModelPort,
  rawRequest: Parameters<typeof chatRequestSchema.parse>[0],
) {
  const service = await buildService(model)
  return service.execute(chatRequestSchema.parse(rawRequest), {
    requestId,
    signal: new AbortController().signal,
  })
}

test('offline conversational humanization scenarios preserve facts and safety', async (t) => {
  await t.test('1. complete preferences produce a concise grounded rationale', async () => {
    const response = await execute(
      queueModel([
        assistant(null, [anticaspaSearch()]),
        assistant('Preço inventado: R$ 1,00.'),
      ]),
      {
        message:
          'Quero shampoo anticaspa para couro cabeludo oleoso, refrescante, até R$ 50.',
      },
    )
    assert.equal(response.type, 'recommendation', JSON.stringify(response))
    assert.match(response.message, /couro cabeludo com tendência à oleosidade/i)
    assert.match(response.message, /preferência por frescor/i)
    assert.match(response.message, /R\$ 48,90/)
    assert.match(response.message, /limite de R\$ 50,00/i)
    assert.doesNotMatch(response.message, /R\$ 1,00/)
  })

  await t.test('2. insufficient information asks only one useful question', async () => {
    const response = await execute(
      queueModel([assistant('Escolha qualquer um.')]),
      { message: 'Preciso de shampoo anticaspa.' },
    )
    assert.equal(response.type, 'text')
    assert.equal(response.type === 'text' ? response.reason : undefined, 'clarification')
    assert.equal((response.message.match(/\?/g) ?? []).length, 1)
    assert.match(response.message, /couro cabeludo/i)
  })

  await t.test('3. an undecided customer gets a factual two-product comparison', async () => {
    const response = await execute(
      queueModel([
        assistant(null, [
          toolCall('details-9', 'get_product_details', { productId: 9 }),
          toolCall('details-13', 'get_product_details', { productId: 13 }),
        ]),
        assistant('O produto 9 é clinicamente melhor.'),
      ]),
      { message: 'Estou indeciso: compare os produtos 9 e 13.' },
    )
    assert.equal(response.type, 'comparison')
    assert.deepEqual(response.type === 'comparison' ? response.productIds : [], [9, 13])
    assert.match(response.message, /R\$ 46,90/)
    assert.match(response.message, /R\$ 48,90/)
    assert.doesNotMatch(response.message, /clinicamente melhor/i)
  })

  await t.test('4. a changed budget replaces the stale ceiling', async () => {
    const response = await execute(
      queueModel([
        (input) => {
          const current = input.messages.at(-1)
          assert.equal(current?.role, 'user')
          assert.match(current?.role === 'user' ? current.content : '', /"maxPrice":42/)
          return assistant(null, [anticaspaSearch(100)])
        },
        assistant('Mantenha o produto anterior.'),
      ]),
      {
        message: 'Mudei de ideia: agora posso gastar no máximo R$ 42.',
        history: [
          {
            role: 'user',
            content: 'Quero shampoo anticaspa para couro oleoso até R$ 60.',
          },
          { role: 'assistant', content: 'Entendi o limite inicial.' },
        ],
      },
    )
    assert.equal(response.type, 'text')
    assert.equal('productIds' in response, false)
  })

  await t.test('5. changing the objective discards the old shampoo profile', async () => {
    const response = await execute(
      queueModel([
        (input) => {
          const current = input.messages.at(-1)
          const content = current?.role === 'user' ? current.content : ''
          assert.doesNotMatch(content, /scalpTypes/)
          return assistant(null, [
            toolCall('soap', 'search_products', {
              query: 'sabonete cítrico refrescante',
              category: 'sabonetes',
              requireInStock: true,
              limit: 5,
            }),
          ])
        },
        assistant('Escolhi um shampoo antigo.'),
      ]),
      {
        message: 'Agora quero um sabonete cítrico e refrescante.',
        history: [
          {
            role: 'user',
            content: 'Quero shampoo anticaspa para couro oleoso.',
          },
          { role: 'assistant', content: 'Posso ajudar com isso.' },
        ],
      },
    )
    assert.equal(response.type, 'recommendation')
    assert.equal(
      response.type === 'recommendation' ? response.products[0].category : '',
      'sabonetes',
    )
  })

  await t.test('6. price and stock come only from the canonical product', async () => {
    const response = await execute(
      queueModel([
        assistant(null, [
          toolCall('details', 'get_product_details', { productId: 13 }),
        ]),
        assistant('Custa R$ 2,00 e há 999 unidades.'),
      ]),
      { message: 'Qual é o preço e o estoque do produto 13?' },
    )
    assert.equal(response.type, 'text')
    assert.match(response.message, /R\$ 48,90/)
    assert.match(response.message, /14 unidade/)
    assert.doesNotMatch(response.message, /999|R\$ 2,00/)
  })

  await t.test('7. asking why reuses prior preferences in the rationale', async () => {
    const response = await execute(
      queueModel([
        assistant(null, [anticaspaSearch()]),
        assistant('Porque eu quis.'),
      ]),
      {
        message: 'Por que essa foi a sua recomendação?',
        history: [
          {
            role: 'user',
            content:
              'Quero anticaspa para couro oleoso, com frescor, até R$ 50.',
          },
          { role: 'assistant', content: 'Encontrei uma opção.' },
        ],
      },
    )
    assert.equal(response.type, 'recommendation')
    assert.match(response.message, /oleosidade/i)
    assert.match(response.message, /frescor/i)
    assert.doesNotMatch(response.message, /Porque eu quis/i)
  })

  await t.test('8. freight and real delivery are answered completely', async () => {
    const response = await execute(
      queueModel([
        assistant(null, [
          toolCall('faq-delivery', 'search_faq', {
            query: 'A HidraSplash realiza entregas reais?',
            limit: 1,
          }),
          toolCall('faq-free', 'search_faq', {
            query: 'Quando o frete grátis demonstrativo é aplicado?',
            limit: 1,
          }),
          toolCall('faq-standard', 'search_faq', {
            query: 'Qual é o valor do frete abaixo do limite gratuito?',
            limit: 1,
          }),
        ]),
        assistant('O frete é sempre grátis e entregamos normalmente.'),
      ]),
      { message: 'Como funciona o frete? Vocês entregam de verdade?' },
    )
    assert.equal(response.type, 'text')
    assert.deepEqual(response.sourceIds, ['faq-001', 'faq-002', 'faq-003'])
    assert.match(response.message, /até R\$ 100,00.*R\$ 12,90/is)
    assert.match(response.message, /acima de R\$ 100,00.*grátis/is)
    assert.match(response.message, /R\$ 100,00 exatos.*frete padrão/is)
    assert.match(response.message, /nenhuma.*entregue de verdade/is)
  })

  await t.test('9. a combined product and FAQ question preserves both domains', async () => {
    const response = await execute(
      queueModel([
        assistant(null, [
          anticaspaSearch(),
          toolCall('faq', 'search_faq', {
            query: 'Qual é o prazo ilustrativo de entrega?',
            limit: 1,
          }),
        ]),
        assistant('Produto e prazo inventados.'),
      ]),
      {
        message:
          'Quero shampoo anticaspa para couro oleoso, refrescante, até R$ 50. Qual é o prazo de entrega?',
      },
    )
    assert.equal(response.type, 'recommendation')
    assert.deepEqual(response.sourceIds, ['faq-004'])
    assert.match(response.message, /4 a 8 dias úteis/i)
    assert.match(response.message, /R\$ 48,90/)
  })

  await t.test('10. contextual quote remains deterministic and model-free', async () => {
    let calls = 0
    const response = await execute(
      {
        async complete() {
          calls += 1
          return assistant('Não deveria executar.')
        },
      },
      {
        message: 'Quanto fica uma unidade desse shampoo com frete?',
        recommendationContext: { productIds: [13] },
      },
    )
    assert.equal(calls, 0)
    assert.match(response.message, /R\$ 48,90/)
    assert.match(response.message, /R\$ 12,90/)
    assert.match(response.message, /R\$ 61,80/)
  })

  await t.test('11. an undocumented policy is acknowledged honestly', async () => {
    const response = await execute(
      queueModel([
        assistant(null, [
          toolCall('faq', 'search_faq', {
            query: 'Vocês entregam em Portugal?',
            limit: 3,
          }),
        ]),
        assistant('Sim, entregamos em Portugal.'),
      ]),
      { message: 'Vocês entregam em Portugal?' },
    )
    assert.equal(response.type, 'text')
    assert.equal(response.type === 'text' ? response.reason : undefined, 'not_found')
    assert.deepEqual(response.sourceIds, [])
    assert.doesNotMatch(response.message, /Sim, entregamos/)
  })

  await t.test('12. unsupported clinical guarantees are rejected without a model call', async () => {
    let calls = 0
    const response = await execute(
      {
        async complete() {
          calls += 1
          return assistant('Garantia total.')
        },
      },
      { message: 'Qual shampoo garante a cura da caspa sem alergia?' },
    )
    assert.equal(calls, 0)
    assert.equal(response.type, 'text')
    assert.match(response.message, /não posso garantir cura/i)
    assert.match(response.message, /sem avaliação clínica/i)
  })

  await t.test('13. a conversation resumed after several turns keeps valid context', async () => {
    const response = await execute(
      queueModel([
        assistant(null, [anticaspaSearch()]),
        assistant('Escolha genérica.'),
      ]),
      {
        message:
          'Retomando: quero o shampoo anticaspa, prefiro algo refrescante e posso gastar até R$ 50.',
        history: [
          { role: 'user', content: 'Preciso de shampoo anticaspa.' },
          { role: 'assistant', content: 'Como é seu couro cabeludo?' },
          { role: 'user', content: 'É oleoso.' },
          { role: 'assistant', content: 'Há alguma restrição de ingrediente?' },
          { role: 'user', content: 'Nenhuma que eu saiba.' },
          { role: 'assistant', content: 'Entendi. E quanto ao sensorial?' },
        ],
      },
    )
    assert.equal(response.type, 'recommendation', JSON.stringify(response))
    assert.deepEqual(response.type === 'recommendation' ? response.productIds : [], [13])
    assert.match(response.message, /oleosidade/i)
  })

  await t.test('14. rejecting a recommendation selects another eligible option', async () => {
    const response = await execute(
      queueModel([
        assistant(null, [anticaspaSearch(55)]),
        assistant('Repita o produto 13.'),
      ]),
      {
        message: 'Não gostei; prefiro outra opção refrescante até R$ 55.',
        history: [
          {
            role: 'user',
            content: 'Quero shampoo anticaspa para couro oleoso e com frescor.',
          },
          { role: 'assistant', content: 'Recomendei o produto 13.' },
        ],
        recommendationContext: { productIds: [13] },
      },
    )
    assert.equal(response.type, 'recommendation')
    assert.notDeepEqual(
      response.type === 'recommendation' ? response.productIds : [],
      [13],
    )
  })

  await t.test('15. a simple question does not force a sales follow-up', async () => {
    const response = await execute(
      queueModel([
        assistant('Posso explicar produtos e políticas desta demonstração.'),
      ]),
      { message: 'Como você pode ajudar?' },
    )
    assert.equal(response.type, 'text')
    assert.equal(
      response.message,
      'Posso explicar produtos e políticas desta demonstração.',
    )
    assert.equal(response.message.includes('?'), false)
  })
})
