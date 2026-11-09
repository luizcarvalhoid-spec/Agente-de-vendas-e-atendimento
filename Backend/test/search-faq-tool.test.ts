import assert from 'node:assert/strict'
import { dirname, join } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

import {
  SEARCH_FAQ_MAX_SERIALIZED_RESULT_CHARACTERS,
  SEARCH_FAQ_TOOL_DESCRIPTION,
  SEARCH_FAQ_TOOL_NAME,
  createSearchFaqTool,
  searchFaqToolExecutionResultSchema,
  searchFaqToolInputSchema,
} from '../src/agent/tools/search-faq-tool.js'
import { loadFaqDocuments } from '../src/knowledge/faq-content-loader.js'
import {
  createFaqSearchIndex,
  type FaqSearchIndex,
  type FaqSearchResult,
} from '../src/knowledge/faq-search.js'

const backendRoot = dirname(dirname(fileURLToPath(import.meta.url)))
const faqRoot = join(backendRoot, 'content', 'knowledge', 'faq')

type FaqSearchPort = Pick<FaqSearchIndex, 'searchFaq'>

function createResult(
  sourceId: string,
  options: {
    title?: string
    content?: string
    score?: number
  } = {},
): FaqSearchResult {
  return {
    sourceId,
    title: options.title ?? 'Qual é a política demonstrativa consultada?',
    category: 'frete',
    classification: 'fictional-demo',
    content:
      options.content ??
      'Esta política fictícia de demonstração contém uma resposta completa e controlada.',
    score: options.score ?? 1,
  }
}

function createRecordingIndex(results: readonly FaqSearchResult[]) {
  const calls: Array<{ query: string; limit: number | undefined }> = []
  const index: FaqSearchPort = {
    searchFaq(query, limit) {
      calls.push({ query, limit })
      return results
    },
  }

  return { calls, index }
}

test('tool exposes provider-agnostic metadata and strict input schema', () => {
  const { index } = createRecordingIndex([])
  const tool = createSearchFaqTool(index)

  assert.equal(tool.name, SEARCH_FAQ_TOOL_NAME)
  assert.equal(tool.name, 'search_faq')
  assert.equal(tool.description, SEARCH_FAQ_TOOL_DESCRIPTION)
  assert.equal(tool.inputSchema, searchFaqToolInputSchema)
  assert.equal('openRouter' in tool, false)
  assert.equal('url' in tool, false)
})

test('valid input is trimmed, defaults limit and returns only authorized source fields', async () => {
  const indexedResult = createResult('faq-002', { score: 8.25 })
  const { calls, index } = createRecordingIndex([indexedResult])
  const tool = createSearchFaqTool(index)
  const result = await tool.execute({ query: '  frete grátis  ' })

  assert.deepEqual(calls, [{ query: 'frete grátis', limit: 3 }])
  assert.equal(result.ok, true)
  assert.equal(result.ok && result.status, 'found')
  if (!result.ok || result.status !== 'found') return

  assert.equal(result.budgetLimited, false)
  assert.equal(result.sources.length, 1)
  assert.deepEqual(Object.keys(result.sources[0] ?? {}).sort(), [
    'category',
    'classification',
    'content',
    'sourceId',
    'title',
  ])
  assert.equal(result.sources[0]?.sourceId, indexedResult.sourceId)
  assert.equal(result.sources[0]?.classification, 'fictional-demo')
  assert.equal(result.sources[0]?.content, indexedResult.content)
  assert.equal('score' in (result.sources[0] ?? {}), false)
})

test('valid input without sources is not_found rather than an error', async () => {
  const { calls, index } = createRecordingIndex([])
  const result = await createSearchFaqTool(index).execute({
    query: 'política não coberta',
    limit: 5,
  })

  assert.deepEqual(calls, [{ query: 'política não coberta', limit: 5 }])
  assert.deepEqual(result, {
    ok: true,
    status: 'not_found',
    sources: [],
    budgetLimited: false,
  })
})

test('invalid arguments are rejected without calling the index', async () => {
  const invalidInputs: unknown[] = [
    undefined,
    null,
    {},
    { query: '' },
    { query: '   ' },
    { query: 'x'.repeat(301) },
    { query: 'frete', limit: 0 },
    { query: 'frete', limit: -1 },
    { query: 'frete', limit: 1.5 },
    { query: 'frete', limit: 6 },
    { query: 'frete', limit: '3' },
    { query: 123 },
    { query: 'frete', unexpected: true },
  ]
  const { calls, index } = createRecordingIndex([])
  const tool = createSearchFaqTool(index)

  for (const input of invalidInputs) {
    assert.deepEqual(await tool.execute(input), {
      ok: false,
      error: {
        code: 'INVALID_ARGUMENTS',
        message: 'Argumentos inválidos para search_faq.',
      },
    })
  }

  assert.equal(calls.length, 0)
})

test('stopword-only and file-like strings remain data passed to the injected index', async () => {
  const { calls, index } = createRecordingIndex([])
  const tool = createSearchFaqTool(index)

  assert.equal((await tool.execute({ query: 'a de para com' })).ok, true)
  assert.equal(
    (await tool.execute({ query: '../../frete/faq-002.md' })).ok,
    true,
  )
  assert.deepEqual(calls, [
    { query: 'a de para com', limit: 3 },
    { query: '../../frete/faq-002.md', limit: 3 },
  ])
})

test('serialized result stays within budget and omits only complete trailing sources', async () => {
  const contentPrefix =
    'Esta política fictícia de demonstração preserva todo o conteúdo. '
  const longContent =
    contentPrefix + 'x'.repeat(1_500 - contentPrefix.length)
  assert.equal(longContent.length, 1_500)

  const indexedResults = Array.from({ length: 5 }, (_, index) =>
    createResult(`faq-9${String(index + 1).padStart(2, '0')}`, {
      title: `Qual é a política demonstrativa extensa número ${index + 1}?`,
      content: longContent,
      score: 5 - index,
    }),
  )
  const { index } = createRecordingIndex(indexedResults)
  const result = await createSearchFaqTool(index).execute({
    query: 'política demonstrativa extensa',
    limit: 5,
  })

  assert.equal(result.ok, true)
  assert.equal(result.ok && result.status, 'found')
  if (!result.ok || result.status !== 'found') return

  assert.equal(result.sources.length, 3)
  assert.equal(result.budgetLimited, true)
  assert.ok(
    JSON.stringify(result).length <=
      SEARCH_FAQ_MAX_SERIALIZED_RESULT_CHARACTERS,
  )
  assert.deepEqual(
    result.sources.map((source) => source.sourceId),
    indexedResults.slice(0, 3).map((source) => source.sourceId),
  )
  assert.ok(result.sources.every((source) => source.content === longContent))
})

test('budgetLimited is false when no relevant source is omitted', async () => {
  const indexedResults = [
    createResult('faq-901'),
    createResult('faq-902'),
    createResult('faq-903'),
  ]
  const { index } = createRecordingIndex(indexedResults)
  const result = await createSearchFaqTool(index).execute({
    query: 'política demonstrativa',
    limit: 3,
  })

  assert.equal(result.ok, true)
  assert.equal(result.ok && result.status, 'found')
  if (!result.ok || result.status !== 'found') return

  assert.equal(result.budgetLimited, false)
  assert.deepEqual(
    result.sources.map((source) => source.sourceId),
    ['faq-901', 'faq-902', 'faq-903'],
  )
})

test('invalid or unexpected index results become sanitized execution failures', async () => {
  const invalidResults: unknown[] = [
    [{ sourceId: 'faq-001' }],
    [{ ...createResult('faq-001'), path: 'C:\\private\\faq-001.md' }],
    [{ ...createResult('faq-001'), classification: 'trusted-system' }],
    [createResult('faq-001', { score: Number.POSITIVE_INFINITY })],
    'not-an-array',
  ]

  for (const invalidResult of invalidResults) {
    const index: FaqSearchPort = {
      searchFaq() {
        return invalidResult as readonly FaqSearchResult[]
      },
    }
    const result = await createSearchFaqTool(index).execute({ query: 'frete' })
    const serialized = JSON.stringify(result)

    assert.deepEqual(result, {
      ok: false,
      error: {
        code: 'EXECUTION_FAILED',
        message: 'Não foi possível consultar as políticas agora.',
      },
    })
    assert.doesNotMatch(serialized, /private|path|trusted-system|Infinity/i)
  }
})

test('an index returning more sources than requested is an execution failure', async () => {
  const { index } = createRecordingIndex([
    createResult('faq-901'),
    createResult('faq-902'),
  ])
  const result = await createSearchFaqTool(index).execute({
    query: 'frete',
    limit: 1,
  })

  assert.equal(result.ok, false)
  assert.equal(!result.ok && result.error.code, 'EXECUTION_FAILED')
})

test('operational errors never expose internal messages, paths or secrets', async () => {
  const index: FaqSearchPort = {
    searchFaq() {
      throw new Error(
        'C:\\private\\knowledge\\faq.md OPENROUTER_API_KEY=secret-value',
      )
    },
  }
  const result = await createSearchFaqTool(index).execute({ query: 'frete' })
  const serialized = JSON.stringify(result)

  assert.deepEqual(result, {
    ok: false,
    error: {
      code: 'EXECUTION_FAILED',
      message: 'Não foi possível consultar as políticas agora.',
    },
  })
  assert.doesNotMatch(serialized, /private|OPENROUTER|secret-value|faq\.md/i)
})

test('result states are semantically consistent', () => {
  assert.equal(
    searchFaqToolExecutionResultSchema.safeParse({
      ok: true,
      status: 'found',
      sources: [],
      budgetLimited: false,
    }).success,
    false,
  )
  assert.equal(
    searchFaqToolExecutionResultSchema.safeParse({
      ok: true,
      status: 'not_found',
      sources: [createResult('faq-001')],
      budgetLimited: false,
    }).success,
    false,
  )
  assert.equal(
    searchFaqToolExecutionResultSchema.safeParse({
      ok: true,
      status: 'not_found',
      sources: [],
      budgetLimited: true,
    }).success,
    false,
  )
})

test('real FAQ index returns validated demonstrative sources without invented URLs', async () => {
  const documents = await loadFaqDocuments({ faqRoot })
  const index = createFaqSearchIndex(documents)
  const result = await createSearchFaqTool(index).execute({
    query: 'frete grátis acima de 100',
    limit: 2,
  })

  assert.equal(result.ok, true)
  assert.equal(result.ok && result.status, 'found')
  if (!result.ok || result.status !== 'found') return

  assert.equal(result.sources[0]?.sourceId, 'faq-002')
  assert.ok(
    result.sources.every(
      (source) => source.classification === 'fictional-demo',
    ),
  )
  assert.doesNotMatch(JSON.stringify(result), /https?:\/\//i)
  assert.ok(
    JSON.stringify(result).length <=
      SEARCH_FAQ_MAX_SERIALIZED_RESULT_CHARACTERS,
  )
})
