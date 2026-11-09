import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

import { loadFaqDocuments } from '../src/knowledge/faq-content-loader.js'
import type { FaqDocument } from '../src/knowledge/faq-document-schema.js'
import { createFaqSearchIndex } from '../src/knowledge/faq-search.js'

const backendRoot = dirname(dirname(fileURLToPath(import.meta.url)))
const faqRoot = join(backendRoot, 'content', 'knowledge', 'faq')
const unknownQueriesFile = join(
  backendRoot,
  'test',
  'fixtures',
  'faq-unknown-queries.json',
)

const overlappingUnknownQueries = [
  'Vocês entregam para Portugal?',
  'Posso pedir embalagem para presente?',
  'Existe programa de fidelidade?',
  'Os frascos têm certificação ambiental?',
  'Vocês vendem no atacado?',
] as const

let canonicalIndexPromise:
  | Promise<ReturnType<typeof createFaqSearchIndex>>
  | undefined

function loadCanonicalIndex() {
  canonicalIndexPromise ??= loadFaqDocuments({ faqRoot }).then((documents) =>
    createFaqSearchIndex(documents),
  )
  return canonicalIndexPromise
}

function createDocument(
  sourceId: string,
  title: string,
  content: string,
): FaqDocument {
  return {
    sourceId,
    category: 'frete',
    title,
    classification: 'fictional-demo',
    content,
  }
}

test('canonical index retrieves precise policies with accents and controlled synonyms', async () => {
  const index = await loadCanonicalIndex()
  const cases = [
    ['FRETE GRÁTIS acima de R$ 100,00', 'faq-002'],
    ['Quanto custa o envio?', 'faq-003'],
    ['QUAL É O PRAZO DE ENTREGA?', 'faq-004'],
    ['Posso informar PIX ou cartão?', 'faq-006'],
    ['Qual é o prazo para devolver?', 'faq-010'],
    ['Recebi um item avariado', 'faq-011'],
    ['Quando ocorre o estorno em 5 dias?', 'faq-013'],
    ['É seguro para alergias e sensibilidades?', 'faq-016'],
    ['Quero rastrear meu pedido', 'faq-020'],
    ['Como cancelar o pedido?', 'faq-021'],
    ['Posso enviar dados pessoais no chat?', 'faq-025'],
  ] as const

  assert.equal(index.size, 25)
  for (const [query, expectedSourceId] of cases) {
    const [first] = index.searchFaq(query)
    assert.equal(first?.sourceId, expectedSourceId, query)
  }
})

test('unknown policies return no sources despite partial lexical overlap', async () => {
  const index = await loadCanonicalIndex()
  const fixtureQueries = JSON.parse(
    await readFile(unknownQueriesFile, 'utf8'),
  ) as string[]

  for (const query of [...fixtureQueries, ...overlappingUnknownQueries]) {
    assert.deepEqual(index.searchFaq(query), [], query)
  }

  assert.deepEqual(
    index.searchFaq('Qual é o prazo para certificação ambiental?'),
    [],
  )
})

test('empty, stopword-only, overlong and file-like queries are safe fallbacks', async () => {
  const index = await loadCanonicalIndex()

  assert.deepEqual(index.searchFaq(''), [])
  assert.deepEqual(index.searchFaq('   '), [])
  assert.deepEqual(index.searchFaq('a de para com ou que'), [])
  assert.deepEqual(index.searchFaq('x'.repeat(301)), [])
  assert.deepEqual(index.searchFaq('../../frete/faq-002.md'), [])
})

test('results preserve validated metadata and complete demonstrative conditions', async () => {
  const index = await loadCanonicalIndex()
  const [result] = index.searchFaq('frete grátis acima de 100', 1)

  assert.ok(result)
  assert.deepEqual(Object.keys(result), [
    'sourceId',
    'title',
    'category',
    'classification',
    'content',
    'score',
  ])
  assert.equal(result.sourceId, 'faq-002')
  assert.equal(result.category, 'frete')
  assert.equal(result.classification, 'fictional-demo')
  assert.match(result.content, /maior que R\$ 100,00/i)
  assert.match(result.content, /R\$ 100,00 exatos não recebe/i)
  assert.match(result.content, /não gera uma entrega real/i)
  assert.equal(Number.isFinite(result.score), true)
  assert.ok(result.score > 0)
  assert.equal('file' in result, false)
  assert.equal('path' in result, false)
})

test('scores and ordering remain stable between executions', async () => {
  const index = await loadCanonicalIndex()
  const query = 'dados pessoais no chat'

  assert.deepEqual(index.searchFaq(query, 5), index.searchFaq(query, 5))

  const rebuiltIndex = createFaqSearchIndex(
    await loadFaqDocuments({ faqRoot }),
  )
  assert.deepEqual(index.searchFaq(query, 5), rebuiltIndex.searchFaq(query, 5))
})

test('title evidence outranks content-only evidence', () => {
  const index = createFaqSearchIndex([
    createDocument(
      'faq-901',
      'Qual é o prazo de estorno?',
      'Esta demonstração fictícia descreve uma resolução editorial controlada.',
    ),
    createDocument(
      'faq-902',
      'Qual é a política de resolução?',
      'Esta demonstração fictícia menciona prazo e estorno somente no conteúdo.',
    ),
  ])

  assert.deepEqual(
    index.searchFaq('prazo estorno', 2).map((result) => result.sourceId),
    ['faq-901', 'faq-902'],
  )
})

test('term repetition does not inflate a document score', () => {
  const index = createFaqSearchIndex([
    createDocument(
      'faq-910',
      'Como funciona a primeira política editorial?',
      'Na demonstração fictícia, termo exclusivo aparece uma vez no conteúdo.',
    ),
    createDocument(
      'faq-911',
      'Como funciona a segunda política editorial?',
      'Na demonstração fictícia, termo termo termo e exclusivo exclusivo aparecem.',
    ),
  ])
  const results = index.searchFaq('termo exclusivo', 2)

  assert.equal(results.length, 2)
  assert.equal(results[0]?.score, results[1]?.score)
})

test('ties use sourceId and result limits are enforced deterministically', () => {
  const documents = Array.from({ length: 6 }, (_, index) => {
    const sourceId = `faq-${String(930 - index).padStart(3, '0')}`
    return createDocument(
      sourceId,
      `Qual é o prazo de estorno da política número ${index + 1}?`,
      'Esta demonstração fictícia mantém a mesma resposta editorial controlada.',
    )
  })
  const index = createFaqSearchIndex(documents)

  assert.deepEqual(
    index.searchFaq('prazo estorno', 99).map((result) => result.sourceId),
    ['faq-925', 'faq-926', 'faq-927', 'faq-928', 'faq-929'],
  )
  assert.equal(index.searchFaq('prazo estorno').length, 3)
  assert.equal(index.searchFaq('prazo estorno', 2).length, 2)
  assert.throws(
    () => index.searchFaq('prazo estorno', 0),
    /inteiro positivo/,
  )
  assert.throws(
    () => index.searchFaq('prazo estorno', 1.5),
    /inteiro positivo/,
  )
})

test('generic single terms do not force retrieval, while unique terms can match', async () => {
  const index = await loadCanonicalIndex()

  assert.deepEqual(index.searchFaq('pedido'), [])
  assert.deepEqual(index.searchFaq('produto'), [])
  assert.equal(index.searchFaq('rastreamento', 1)[0]?.sourceId, 'faq-020')
  assert.equal(index.searchFaq('PIX', 1)[0]?.sourceId, 'faq-006')
})
