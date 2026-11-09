import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

import { z } from 'zod'

import {
  SEARCH_FAQ_MAX_SERIALIZED_RESULT_CHARACTERS,
  createSearchFaqTool,
} from '../src/agent/tools/search-faq-tool.js'
import { loadFaqDocuments } from '../src/knowledge/faq-content-loader.js'
import {
  faqDocumentSchema,
  type FaqDocument,
} from '../src/knowledge/faq-document-schema.js'
import {
  createFaqSearchIndex,
  type FaqSearchIndex,
  type FaqSearchResult,
} from '../src/knowledge/faq-search.js'

const backendRoot = dirname(dirname(fileURLToPath(import.meta.url)))
const faqRoot = join(backendRoot, 'content', 'knowledge', 'faq')
const evaluationCasesFile = join(
  backendRoot,
  'test',
  'fixtures',
  'faq-evaluation-cases.json',
)
const unknownQueriesFile = join(
  backendRoot,
  'test',
  'fixtures',
  'faq-unknown-queries.json',
)

const caseBaseSchema = z
  .object({
    id: z.string().regex(/^rag-[a-z0-9-]+$/),
    group: z.enum([
      'frete',
      'pagamento',
      'trocas',
      'pedidos',
      'produtos',
      'inexistente',
    ]),
    query: z.string().trim().min(10).max(300),
    rationale: z.string().trim().min(20),
  })
  .strict()

const evaluationCaseSchema = z.discriminatedUnion('expectedStatus', [
  caseBaseSchema
    .extend({
      expectedStatus: z.literal('found'),
      expectedSourceIds: z
        .array(z.string().regex(/^faq-\d{3}$/))
        .min(1)
        .max(3),
      top1Eligible: z.boolean(),
    })
    .strict(),
  caseBaseSchema
    .extend({
      expectedStatus: z.literal('not_found'),
      expectedSourceIds: z.tuple([]),
      top1Eligible: z.literal(false),
    })
    .strict(),
])

const evaluationCasesSchema = z.array(evaluationCaseSchema).length(10)
const unknownQueriesSchema = z.array(z.string().trim().min(1)).min(1)

type EvaluationCase = z.infer<typeof evaluationCaseSchema>

interface EvaluationRow {
  id: string
  expectedSourceIds: readonly string[]
  observedSourceIds: readonly string[]
  recallAt3Pass: boolean
  top1Pass?: boolean
  fallbackPass?: boolean
}

interface EvaluationContext {
  cases: readonly EvaluationCase[]
  documents: readonly FaqDocument[]
  documentsBySourceId: ReadonlyMap<string, FaqDocument>
  index: FaqSearchIndex
  unknownQueries: readonly string[]
}

let contextPromise: Promise<EvaluationContext> | undefined

async function readJson(file: string) {
  return JSON.parse(await readFile(file, 'utf8')) as unknown
}

async function loadContext() {
  contextPromise ??= Promise.all([
    readJson(evaluationCasesFile),
    readJson(unknownQueriesFile),
    loadFaqDocuments({ faqRoot }),
  ]).then(([rawCases, rawUnknownQueries, documents]) => ({
    cases: evaluationCasesSchema.parse(rawCases),
    documents,
    documentsBySourceId: new Map(
      documents.map((document) => [document.sourceId, document] as const),
    ),
    index: createFaqSearchIndex(documents),
    unknownQueries: unknownQueriesSchema.parse(rawUnknownQueries),
  }))

  return contextPromise
}

function evaluateCase(
  evaluationCase: EvaluationCase,
  results: readonly FaqSearchResult[],
): EvaluationRow {
  const observedSourceIds = results.map((result) => result.sourceId)

  if (evaluationCase.expectedStatus === 'not_found') {
    return {
      id: evaluationCase.id,
      expectedSourceIds: [],
      observedSourceIds,
      recallAt3Pass: true,
      fallbackPass: observedSourceIds.length === 0,
    }
  }

  return {
    id: evaluationCase.id,
    expectedSourceIds: evaluationCase.expectedSourceIds,
    observedSourceIds,
    recallAt3Pass: evaluationCase.expectedSourceIds.every((sourceId) =>
      observedSourceIds.includes(sourceId),
    ),
    top1Pass: evaluationCase.top1Eligible
      ? evaluationCase.expectedSourceIds.includes(observedSourceIds[0] ?? '')
      : undefined,
  }
}

function assertSourceIntegrity(
  result: FaqSearchResult,
  documentsBySourceId: ReadonlyMap<string, FaqDocument>,
) {
  const canonical = documentsBySourceId.get(result.sourceId)

  assert.ok(canonical, `Fonte desconhecida recuperada: ${result.sourceId}`)
  assert.deepEqual(
    faqDocumentSchema.parse({
      sourceId: result.sourceId,
      title: result.title,
      category: result.category,
      classification: result.classification,
      content: result.content,
    }),
    canonical,
  )
  assert.equal('file' in result, false)
  assert.equal('path' in result, false)
  assert.equal('url' in result, false)
  assert.doesNotMatch(JSON.stringify(result), /https?:\/\//i)
}

test('evaluation fixtures are strict, unique and distributed as approved', async () => {
  const { cases, documentsBySourceId, unknownQueries } = await loadContext()
  const foundCases = cases.filter((item) => item.expectedStatus === 'found')
  const notFoundCases = cases.filter(
    (item) => item.expectedStatus === 'not_found',
  )

  assert.equal(foundCases.length, 7)
  assert.equal(notFoundCases.length, 3)
  assert.equal(new Set(cases.map((item) => item.id)).size, cases.length)
  assert.equal(new Set(cases.map((item) => item.query)).size, cases.length)
  assert.ok(
    ['frete', 'pagamento', 'trocas', 'pedidos', 'produtos'].every((group) =>
      foundCases.some((item) => item.group === group),
    ),
  )
  assert.ok(
    notFoundCases.every(
      (item) => !unknownQueries.includes(item.query),
    ),
  )
  assert.ok(
    foundCases.every((item) =>
      item.expectedSourceIds.every((sourceId) =>
        documentsBySourceId.has(sourceId),
      ),
    ),
  )
})

test('golden set reaches the objective retrieval and fallback metrics', async () => {
  const { cases, index, unknownQueries } = await loadContext()
  const rows = cases.map((evaluationCase) =>
    evaluateCase(evaluationCase, index.searchFaq(evaluationCase.query, 3)),
  )
  const positiveRows = rows.filter((row) => row.expectedSourceIds.length > 0)
  const top1Rows = positiveRows.filter((row) => row.top1Pass !== undefined)
  const mainNegativeRows = rows.filter(
    (row) => row.expectedSourceIds.length === 0,
  )
  const regressionNegativeRows = unknownQueries.map((query, indexPosition) => {
    const observedSourceIds = index
      .searchFaq(query, 3)
      .map((result) => result.sourceId)
    return {
      id: `unknown-regression-${String(indexPosition + 1).padStart(3, '0')}`,
      observedSourceIds,
      fallbackPass: observedSourceIds.length === 0,
    }
  })
  const allNegativeRows = [...mainNegativeRows, ...regressionNegativeRows]

  assert.equal(positiveRows.length, 7)
  assert.equal(
    positiveRows.filter((row) => row.recallAt3Pass).length,
    positiveRows.length,
    JSON.stringify(positiveRows.filter((row) => !row.recallAt3Pass)),
  )
  assert.equal(top1Rows.length, 7)
  assert.equal(
    top1Rows.filter((row) => row.top1Pass).length,
    top1Rows.length,
    JSON.stringify(top1Rows.filter((row) => !row.top1Pass)),
  )
  assert.equal(allNegativeRows.length, 8)
  assert.equal(
    allNegativeRows.filter((row) => row.fallbackPass).length,
    allNegativeRows.length,
    JSON.stringify(allNegativeRows.filter((row) => !row.fallbackPass)),
  )
  assert.equal(
    allNegativeRows.filter((row) => row.observedSourceIds.length > 0).length,
    0,
  )

  const secondRun = cases.map((evaluationCase) =>
    evaluateCase(evaluationCase, index.searchFaq(evaluationCase.query, 3)),
  )
  assert.deepEqual(secondRun, rows)
})

test('every retrieved source preserves canonical metadata and content', async () => {
  const { cases, documentsBySourceId, index } = await loadContext()
  const retrievedResults = cases.flatMap((evaluationCase) =>
    index.searchFaq(evaluationCase.query, 3),
  )

  assert.ok(retrievedResults.length > 0)
  retrievedResults.forEach((result) =>
    assertSourceIntegrity(result, documentsBySourceId),
  )
})

test('canonical search_faq tool preserves grounded sources and honest fallback', async () => {
  const { cases, documentsBySourceId, index } = await loadContext()
  const tool = createSearchFaqTool(index)

  for (const evaluationCase of cases) {
    const result = await tool.execute({
      query: evaluationCase.query,
      limit: 3,
    })
    const serialized = JSON.stringify(result)

    assert.ok(
      serialized.length <= SEARCH_FAQ_MAX_SERIALIZED_RESULT_CHARACTERS,
      evaluationCase.id,
    )
    assert.doesNotMatch(serialized, /https?:\/\//i)
    assert.doesNotMatch(serialized, /(?:"score"|"path"|"file"|[A-Z]:\\)/)

    if (evaluationCase.expectedStatus === 'not_found') {
      assert.deepEqual(
        result,
        {
          ok: true,
          status: 'not_found',
          sources: [],
          budgetLimited: false,
        },
        evaluationCase.id,
      )
      continue
    }

    assert.equal(result.ok, true, evaluationCase.id)
    assert.equal(result.ok && result.status, 'found', evaluationCase.id)
    if (!result.ok || result.status !== 'found') continue

    assert.equal(result.budgetLimited, false, evaluationCase.id)
    const observedSourceIds = result.sources.map((source) => source.sourceId)
    assert.ok(
      evaluationCase.expectedSourceIds.every((sourceId) =>
        observedSourceIds.includes(sourceId),
      ),
      `${evaluationCase.id}: ${observedSourceIds.join(', ')}`,
    )

    for (const source of result.sources) {
      const canonical = documentsBySourceId.get(source.sourceId)
      assert.ok(canonical)
      assert.equal(source.classification, 'fictional-demo')
      assert.equal(source.content, canonical.content)
      assert.equal('score' in source, false)
    }
  }

  const freeShippingResult = await tool.execute({
    query: cases.find((item) => item.id === 'rag-frete-limite-100')?.query,
    limit: 1,
  })
  assert.equal(freeShippingResult.ok, true)
  if (freeShippingResult.ok && freeShippingResult.status === 'found') {
    assert.match(freeShippingResult.sources[0]?.content ?? '', /maior que R\$ 100,00/i)
    assert.match(
      freeShippingResult.sources[0]?.content ?? '',
      /R\$ 100,00 exatos não recebe/i,
    )
  }

  const clinicalResult = await tool.execute({
    query: cases.find((item) => item.id === 'rag-produto-promessa-clinica')
      ?.query,
    limit: 1,
  })
  assert.equal(clinicalResult.ok, true)
  if (clinicalResult.ok && clinicalResult.status === 'found') {
    assert.match(
      clinicalResult.sources[0]?.content ?? '',
      /não deve diagnosticar, prescrever, prometer cura/i,
    )
  }
})
