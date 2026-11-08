import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

import { loadFaqDocuments } from '../src/knowledge/faq-content-loader.js'
import { faqCategories } from '../src/knowledge/faq-document-schema.js'

const backendRoot = dirname(dirname(fileURLToPath(import.meta.url)))
const faqRoot = join(backendRoot, 'content', 'knowledge', 'faq')
const productsFile = join(backendRoot, 'content', 'catalog', 'products.json')
const unknownQueriesFile = join(
  backendRoot,
  'test',
  'fixtures',
  'faq-unknown-queries.json',
)

function getRequiredDocument(
  documents: Awaited<ReturnType<typeof loadFaqDocuments>>,
  sourceId: string,
) {
  const document = documents.find((candidate) => candidate.sourceId === sourceId)
  assert.ok(document, `Documento ${sourceId} ausente.`)
  return document
}

test('canonical FAQ contains 25 deterministic fictional documents', async () => {
  const firstLoad = await loadFaqDocuments({ faqRoot })
  const secondLoad = await loadFaqDocuments({ faqRoot })

  assert.equal(firstLoad.length, 25)
  assert.deepEqual(
    firstLoad.map((document) => document.sourceId),
    Array.from({ length: 25 }, (_, index) =>
      `faq-${String(index + 1).padStart(3, '0')}`,
    ),
  )
  assert.deepEqual(
    secondLoad.map((document) => document.sourceId),
    firstLoad.map((document) => document.sourceId),
  )
  assert.equal(new Set(firstLoad.map((document) => document.sourceId)).size, 25)
  assert.equal(new Set(firstLoad.map((document) => document.title)).size, 25)
  assert.ok(
    firstLoad.every(
      (document) =>
        document.classification === 'fictional-demo' &&
        /\b(?:demonstra(?:ção|tiv[oa]s?)|fictíci[oa]s?)\b/iu.test(
          document.content,
        ),
    ),
  )

  const counts = Object.fromEntries(
    faqCategories.map((category) => [
      category,
      firstLoad.filter((document) => document.category === category).length,
    ]),
  )
  assert.deepEqual(counts, {
    frete: 4,
    pagamento: 4,
    trocas: 5,
    produtos: 5,
    pedidos: 4,
    privacidade: 3,
  })
})

test('approved illustrative policy values remain coherent', async () => {
  const documents = await loadFaqDocuments({ faqRoot })

  assert.match(
    getRequiredDocument(documents, 'faq-002').content,
    /maior que R\$ 100,00/i,
  )
  assert.match(
    getRequiredDocument(documents, 'faq-002').content,
    /R\$ 100,00 exatos não recebe/i,
  )
  assert.match(
    getRequiredDocument(documents, 'faq-002').content,
    /preços atuais dos produtos e antes do frete/i,
  )
  assert.match(getRequiredDocument(documents, 'faq-003').content, /R\$ 12,90/)
  assert.match(
    getRequiredDocument(documents, 'faq-004').content,
    /4 a 8 dias úteis/i,
  )
  assert.match(
    getRequiredDocument(documents, 'faq-010').content,
    /7 dias corridos/i,
  )
  assert.match(
    getRequiredDocument(documents, 'faq-011').content,
    /7 dias corridos/i,
  )
  assert.match(
    getRequiredDocument(documents, 'faq-013').content,
    /5 dias úteis/i,
  )
})

test('FAQ does not duplicate catalog products or contain concrete personal data', async () => {
  const documents = await loadFaqDocuments({ faqRoot })
  const corpus = documents
    .map((document) => `${document.title}\n${document.content}`)
    .join('\n')
  const products = JSON.parse(await readFile(productsFile, 'utf8')) as Array<{
    name: string
    slug: string
  }>

  for (const product of products) {
    assert.doesNotMatch(corpus, new RegExp(product.slug, 'i'))
    assert.equal(corpus.includes(product.name), false)
  }

  assert.doesNotMatch(corpus, /\b\d{3}\.\d{3}\.\d{3}-\d{2}\b/)
  assert.doesNotMatch(corpus, /\b\d{5}-\d{3}\b/)
  assert.doesNotMatch(corpus, /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/i)
  assert.doesNotMatch(corpus, /https?:\/\//i)
  assert.doesNotMatch(
    corpus,
    /(?:clinicamente comprovado|hipoalergênico|seguro para alergias|atendente disponível|especialista disponível|transportadora parceira)/i,
  )

  const monetaryValues = new Set(
    [...corpus.matchAll(/R\$\s*\d+(?:\.\d{3})*,\d{2}/g)].map((match) =>
      match[0].replace(/\s+/g, ' '),
    ),
  )
  assert.deepEqual([...monetaryValues].sort(), ['R$ 100,00', 'R$ 12,90'])
})

test('unknown-query fixtures remain answerless and outside the knowledge root', async () => {
  const input = JSON.parse(await readFile(unknownQueriesFile, 'utf8')) as unknown

  assert.ok(Array.isArray(input))
  assert.equal(input.length, 5)
  assert.ok(input.every((query) => typeof query === 'string' && query.endsWith('?')))
  assert.equal(new Set(input).size, input.length)
  assert.equal(unknownQueriesFile.startsWith(faqRoot), false)
})
