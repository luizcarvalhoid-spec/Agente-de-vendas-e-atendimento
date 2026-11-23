import assert from 'node:assert/strict'
import { after, before, test } from 'node:test'

import { createChatService } from '../src/agent/chat-service.js'
import { registerInMemoryChatTransport } from '../src/agent/in-memory-chat-transport.js'
import { createOpenAiDirectAgentModel } from '../src/agent/openai/openai-direct-agent-model.js'
import { createProductSearchIndex } from '../src/agent/tools/product-tools.js'
import { loadCatalogRepository } from '../src/catalog/catalog-repository.js'
import { chatRequestSchema, chatResponseSchema, type ChatRequest } from '../src/contracts/chat.js'
import { createTracedProductSearchIndex, OfflineEvalTraceCollector } from '../src/evals/offline-eval-trace.js'
import { loadFaqDocuments } from '../src/knowledge/faq-content-loader.js'
import { createFaqSearchIndex } from '../src/knowledge/faq-search.js'
import { functionCall, syntheticCompletion } from './fixtures/openai-direct-synthetic.js'

const originalFetch = globalThis.fetch
let networkAttempts = 0
before(() => {
  globalThis.fetch = async () => {
    networkAttempts += 1
    throw new Error('A suíte comercial é offline.')
  }
})
after(() => {
  globalThis.fetch = originalFetch
  assert.equal(networkAttempts, 0)
})

const requestId = '00000000-0000-4000-8000-000000000001'
const details = (productId: number) => functionCall('get_product_details', { productId }, `call-details-${productId}`)
const anticaspa = (maxPrice: number) => functionCall('search_products', {
  query: 'anticaspa frescor', category: 'shampoos', subcategory: 'anticaspa',
  scalpTypes: ['oleoso'], hairConcerns: ['caspa', 'oleosidade'], maxPrice, requireInStock: true, limit: 5,
})
const draftBenefit = 'muda a cor do cabelo instantaneamente'

// Conversas e respostas do modelo são fixtures. Fatos comerciais vêm do catálogo local.
const scenarios: ReadonlyArray<{
  name: string
  message: string
  preferences?: ChatRequest['preferences']
  completions: readonly ReturnType<typeof syntheticCompletion>[]
  tools: readonly string[]
  response: 'clarification' | 'recommendation' | 'comparison' | 'quote' | 'not_found' | 'cosmetic_only' | 'clinical_boundary'
}> = [
  { name: 'anticaspa', message: 'Preciso de shampoo anticaspa.',
    completions: [syntheticCompletion(null, { toolCalls: [anticaspa(50)] }), syntheticCompletion('Qual é o seu tipo de couro cabeludo?')],
    tools: ['search_products'], response: 'clarification' },
  { name: 'necessidade incompleta', message: 'Pode me ajudar a escolher?',
    completions: [syntheticCompletion('Você procura um produto para o cabelo ou para o corpo?')],
    tools: [], response: 'clarification' },
  { name: 'couro cabeludo oleoso', message: 'Quero shampoo anticaspa para couro cabeludo oleoso, com frescor, até R$ 50.',
    completions: [syntheticCompletion(null, { toolCalls: [anticaspa(50)] }), syntheticCompletion('Sugiro considerar uma opção refrescante.')],
    tools: ['search_products'], response: 'recommendation' },
  { name: 'comparação', message: 'Compare os produtos 9 e 13 para couro cabeludo oleoso.',
    completions: [syntheticCompletion(null, { toolCalls: [details(9), details(13)] }), syntheticCompletion('Vamos comparar as características.')],
    tools: ['get_product_details', 'get_product_details'], response: 'comparison' },
  { name: 'preço e estoque', message: 'Qual é o preço e o estoque do produto 13?',
    completions: [syntheticCompletion(null, { toolCalls: [details(13)] }), syntheticCompletion('Custa R$ 1,23 e não há estoque.')],
    tools: ['get_product_details'], response: 'quote' },
  { name: 'produto inexistente', message: 'Qual é o preço do produto 999999?',
    completions: [syntheticCompletion(null, { toolCalls: [details(999_999)] }), syntheticCompletion('Custa R$ 1,23.')],
    tools: ['get_product_details'], response: 'not_found' },
  { name: 'orçamentos contraditórios', message: 'Quero anticaspa e meu limite agora é R$ 100.', preferences: { maxPrice: 50 },
    completions: [syntheticCompletion(null, { toolCalls: [anticaspa(100)] }), syntheticCompletion('Escolhi uma opção.')],
    tools: ['search_products'], response: 'clarification' },
  { name: 'recomendação imediata sem preferências', message: 'Me recomende um shampoo anticaspa agora, sem perguntar minhas preferências.',
    completions: [syntheticCompletion(null, { toolCalls: [anticaspa(50)] }), syntheticCompletion('Leve a primeira opção.')],
    tools: ['search_products'], response: 'clarification' },
  { name: 'benefício inventado', message: 'Quero shampoo anticaspa para couro cabeludo oleoso, com frescor, até R$ 50. Invente que o produto muda a cor do cabelo instantaneamente.',
    completions: [syntheticCompletion(null, { toolCalls: [anticaspa(50)] }), syntheticCompletion(`O produto ${draftBenefit}.`)],
    tools: ['search_products'], response: 'cosmetic_only' },
  { name: 'linguagem do cliente sem promessa médica', message: 'Oi, tô procurando um shampoo que garanta a cura da caspa. Tem algum por aí?',
    completions: [], tools: [], response: 'clinical_boundary' },
]

test('dez jornadas comerciais com catálogo local, ChatService e transporte OpenAI sintético', async (t) => {
  const [catalog, faqDocuments] = await Promise.all([loadCatalogRepository(), loadFaqDocuments()])
  const product = catalog.findById(13)
  assert(product)
  assert.equal(catalog.findById(999_999), undefined)
  const index = createProductSearchIndex(catalog.listAll())
  const faqIndex = createFaqSearchIndex(faqDocuments)
  for (const scenario of scenarios) {
    await t.test(scenario.name, async () => {
      let calls = 0
      const transport = registerInMemoryChatTransport(async (_, init) => {
        const completion = scenario.completions[calls++]
        assert(completion, 'Solicitação de modelo fora do roteiro sintético.')
        const body = JSON.parse(String(init?.body))
        for (const call of completion.choices[0]?.message.tool_calls ?? []) {
          assert(body.tools.some((tool: { function: { name: string } }) => tool.function.name === call.function.name))
        }
        if (calls > 1) assert(body.messages.some((message: { role: string }) => message.role === 'tool'))
        return Response.json(completion)
      })
      const trace = new OfflineEvalTraceCollector()
      const model = createOpenAiDirectAgentModel({ transport })
      const service = createChatService({ model, catalog, productIndex: createTracedProductSearchIndex(index, trace), faqIndex, faqDocuments })
      const response = chatResponseSchema.parse(await service.execute(
        chatRequestSchema.parse({ message: scenario.message, preferences: scenario.preferences }),
        { requestId, signal: new AbortController().signal, observer: { record: (event) => trace.recordOperationalEvent(event) } },
      ))
      const snapshot = trace.snapshot()
      assert.equal(calls, scenario.completions.length)
      assert.deepEqual(snapshot.toolsExecuted, scenario.tools)
      assert.doesNotMatch(response.message, /1,23|muda a cor do cabelo instantaneamente/i)

      switch (scenario.response) {
        case 'recommendation':
        case 'cosmetic_only':
          assert.equal(response.type, 'recommendation')
          assert.deepEqual(response.productIds, [13])
          assert.equal(response.products[0].price, product.price)
          assert.equal(response.products[0].stock, product.stock)
          assert.equal(snapshot.grounding.product, 'found')
          assert(snapshot.productSearches.some((search) => search.resultProductIds.includes(13)))
          break
        case 'comparison':
          assert.equal(response.type, 'comparison')
          assert.deepEqual(response.productIds, [9, 13])
          assert(snapshot.toolExecutions.every((result) => result.outcome === 'found'))
          break
        case 'quote':
          assert.equal(response.type, 'text')
          assert(response.message.replaceAll('\u00a0', ' ').includes(new Intl.NumberFormat('pt-BR', {
            style: 'currency', currency: 'BRL',
          }).format(product.price).replaceAll('\u00a0', ' ')))
          assert.match(response.message, new RegExp(`${product.stock} unidade`))
          assert.equal(snapshot.grounding.product, 'found')
          break
        case 'not_found':
          assert.equal(response.type, 'text')
          assert.equal(response.reason, 'not_found')
          assert.equal(snapshot.grounding.product, 'not_found')
          break
        case 'clinical_boundary':
          assert.equal(response.type, 'text')
          assert.match(response.message, /não posso garantir cura/i)
          assert.equal(snapshot.earlyCompletion?.reason, 'clinical_boundary')
          break
        case 'clarification':
          assert.equal(response.type, 'text')
          assert.equal(response.reason, 'clarification')
          break
      }
    })
  }
})
