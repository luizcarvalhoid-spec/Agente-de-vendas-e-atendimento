import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

import {
  EvalDatasetLoadError,
  loadEvalDataset,
  parseEvalDataset,
} from '../src/evals/eval-loader.js'

const fixtureUrl = new URL(
  '../evals/fixtures/minimal-valid.v1.json',
  import.meta.url,
)

type JsonRecord = Record<string, unknown>

function record(value: unknown): JsonRecord {
  assert.ok(typeof value === 'object' && value !== null && !Array.isArray(value))
  return value as JsonRecord
}

function array(value: unknown): unknown[] {
  assert.ok(Array.isArray(value))
  return value
}

function casesOf(value: unknown) {
  return array(record(value).cases)
}

function firstCaseOf(value: unknown) {
  const [scenario] = casesOf(value)
  assert.ok(scenario)
  return record(scenario)
}

function assertionsOf(value: unknown) {
  return array(firstCaseOf(value).assertions)
}

function criteriaOf(value: unknown) {
  return array(firstCaseOf(value).quality_criteria)
}

function expectedBehaviorsOf(value: unknown) {
  return array(firstCaseOf(value).expected_behaviors)
}

function turnsOf(value: unknown) {
  return array(record(firstCaseOf(value).input).turns)
}

async function fixtureValue(): Promise<unknown> {
  return JSON.parse(await readFile(fixtureUrl, 'utf8')) as unknown
}

function captureLoadError(callback: () => unknown) {
  try {
    callback()
    assert.fail('Era esperado um EvalDatasetLoadError.')
  } catch (error) {
    assert.ok(error instanceof EvalDatasetLoadError)
    return error
  }
}

test('carrega um dataset v1 válido com rastreabilidade de arquivo e casos', async () => {
  const loaded = await loadEvalDataset(fixtureUrl)

  assert.equal(loaded.data.schemaVersion, 1)
  assert.equal(loaded.data.dataset.id, 'hidrasplash-minimal')
  assert.equal(loaded.cases.length, 1)
  assert.equal(loaded.cases[0]?.index, 0)
  assert.equal(loaded.cases[0]?.scenario.id, 'minimal.recommendation.001')
  assert.match(
    loaded.cases[0]?.sourcePath ?? '',
    /minimal-valid\.v1\.json#cases\[0\]\(minimal\.recommendation\.001\)$/,
  )
})

test('aceita operações explícitas de substituição e limpeza entre turnos', async () => {
  const value = await fixtureValue()
  const turns = turnsOf(value)
  turns[0] = {
    message: 'Quero uma opção até R$ 50.',
    preferences: { mode: 'replace', value: { maxPrice: 50 } },
    cart: { mode: 'replace', value: [{ productId: 13, quantity: 1 }] },
    recommendationContext: {
      mode: 'replace',
      value: { productIds: [13] },
    },
  }
  turns.push({
    message: 'Mudei de ideia; pode começar de novo?',
    preferences: { mode: 'clear' },
    cart: { mode: 'clear' },
    recommendationContext: { mode: 'clear' },
  })
  expectedBehaviorsOf(value).push({
    turn: 1,
    action: 'answer',
    description: 'Confirmar que o estado anterior foi removido.',
    requiredGrounding: [],
  })

  const loaded = parseEvalDataset(value, 'multi-turn-memory')
  assert.equal(loaded.data.cases[0]?.input.turns.length, 2)
  assert.deepEqual(
    loaded.data.cases[0]?.expected_behaviors.map((behavior) => behavior.turn),
    [0, 1],
  )
})

test('exige exatamente um comportamento esperado para cada turno', async () => {
  const value = await fixtureValue()
  turnsOf(value).push({
    message: 'Agora quero saber sobre frete.',
    preferences: { mode: 'preserve' },
    cart: { mode: 'preserve' },
    recommendationContext: { mode: 'auto' },
  })

  const missingError = captureLoadError(() => parseEvalDataset(value))
  assert.ok(
    missingError.issues.some(
      (issue) =>
        issue.path === 'cases[0].expected_behaviors' &&
        /turno 1 não possui/.test(issue.message),
    ),
  )

  const behaviors = expectedBehaviorsOf(value)
  behaviors.push({
    turn: 1,
    action: 'answer',
    description: 'Responder usando a fonte de frete.',
    requiredGrounding: ['faq'],
  })
  behaviors.push({
    turn: 1,
    action: 'safe_fallback',
    description: 'Comportamento contraditório para o mesmo turno.',
    requiredGrounding: [],
  })

  const duplicateError = captureLoadError(() => parseEvalDataset(value))
  assert.ok(
    duplicateError.issues.some(
      (issue) =>
        issue.path === 'cases[0].expected_behaviors[2].turn' &&
        /já possui expectativa/.test(issue.message),
    ),
  )
})

test(
  'rejeita comportamento esperado que referencia turno inexistente',
  async () => {
    const value = await fixtureValue()
    record(expectedBehaviorsOf(value)[0]).turn = 1

    const error = captureLoadError(() => parseEvalDataset(value))
    assert.ok(
      error.issues.some(
        (issue) =>
          issue.path === 'cases[0].expected_behaviors[0].turn' &&
          /não existe/.test(issue.message),
      ),
    )
  },
)

test('rejeita versão de schema incompatível antes da validação estrutural', async () => {
  const value = record(await fixtureValue())
  value.schemaVersion = 2

  const error = captureLoadError(() => parseEvalDataset(value, 'version.json'))
  assert.equal(error.kind, 'version')
  assert.deepEqual(error.issues, [
    { path: 'schemaVersion', message: 'Esperado 1, recebido 2.' },
  ])
})

test('rejeita IDs de cenários duplicados e localiza a segunda ocorrência', async () => {
  const value = await fixtureValue()
  const cases = casesOf(value)
  cases.push(structuredClone(cases[0]))

  const error = captureLoadError(() => parseEvalDataset(value))
  assert.equal(error.kind, 'schema')
  assert.ok(
    error.issues.some(
      (issue) =>
        issue.path === 'cases[1].id' && /duplicado/.test(issue.message),
    ),
  )
})

test('rejeita assertions fora da union discriminada', async () => {
  const value = await fixtureValue()
  record(assertionsOf(value)[0]).type = 'execute_javascript'

  const error = captureLoadError(() => parseEvalDataset(value))
  assert.equal(error.kind, 'schema')
  assert.ok(
    error.issues.some((issue) => issue.path === 'cases[0].assertions[0].type'),
  )
})

test(
  'não aceita no_unsupported_claims como assertion objetiva genérica',
  async () => {
    const value = await fixtureValue()
    record(assertionsOf(value)[0]).type = 'no_unsupported_claims'

    const error = captureLoadError(() => parseEvalDataset(value))
    assert.ok(
      error.issues.some((issue) => issue.path === 'cases[0].assertions[0].type'),
    )
  },
)

test(
  'detecta conjuntos de IDs duplicados independentemente da ordem',
  async () => {
    const value = await fixtureValue()
    const assertions = assertionsOf(value)
    assertions.splice(
      0,
      1,
      {
        id: 'exclude-products-a',
        criterionId: 'objective-compliance',
        turn: 0,
        severity: 'critical',
        type: 'product_ids_exclude',
        productIds: [13, 9],
      },
      {
        id: 'exclude-products-b',
        criterionId: 'objective-compliance',
        turn: 0,
        severity: 'critical',
        type: 'product_ids_exclude',
        productIds: [9, 13],
      },
    )
    record(criteriaOf(value)[0]).assertionIds = [
      'exclude-products-a',
      'exclude-products-b',
    ]

    const error = captureLoadError(() => parseEvalDataset(value))
    assert.ok(
      error.issues.some(
        (issue) =>
          issue.path === 'cases[0].assertions[1]' &&
          /duplicada logicamente/.test(issue.message),
      ),
    )
  },
)

test('preserva a ordem em assertions exact', async () => {
  const value = await fixtureValue()
  const assertions = assertionsOf(value)
  assertions.splice(
    0,
    1,
    {
      id: 'exact-products-a',
      criterionId: 'objective-compliance',
      turn: 0,
      severity: 'high',
      type: 'product_ids_exact',
      productIds: [13, 9],
    },
    {
      id: 'exact-products-b',
      criterionId: 'objective-compliance',
      turn: 0,
      severity: 'high',
      type: 'product_ids_exact',
      productIds: [9, 13],
    },
  )
  record(criteriaOf(value)[0]).assertionIds = [
    'exact-products-a',
    'exact-products-b',
  ]

  const loaded = parseEvalDataset(value)
  assert.equal(loaded.data.cases[0]?.assertions.length, 2)
})

test('rejeita referências a turnos inexistentes', async () => {
  const value = await fixtureValue()
  record(assertionsOf(value)[0]).turn = 1

  const error = captureLoadError(() => parseEvalDataset(value))
  assert.ok(
    error.issues.some(
      (issue) =>
        issue.path === 'cases[0].assertions[0].turn' &&
        /não existe/.test(issue.message),
    ),
  )
})

test('rejeita projeção multi-turno que excede o limite atual de histórico', async () => {
  const value = await fixtureValue()
  const turns = turnsOf(value)
  const baseTurn = structuredClone(turns[0])
  while (turns.length < 7) turns.push(structuredClone(baseTurn))

  const error = captureLoadError(() => parseEvalDataset(value))
  assert.ok(
    error.issues.some(
      (issue) =>
        issue.path === 'cases[0].input.turns[6]' &&
        /histórico/i.test(issue.message),
    ),
  )
})

test('rejeita operação replace com contexto de recomendação inválido', async () => {
  const value = await fixtureValue()
  record(turnsOf(value)[0]).recommendationContext = {
    mode: 'replace',
    value: { productIds: [] },
  }

  const error = captureLoadError(() => parseEvalDataset(value))
  assert.ok(
    error.issues.some((issue) =>
      issue.path.startsWith(
        'cases[0].input.turns[0].recommendationContext.value.productIds',
      ),
    ),
  )
})

test('rejeita campos desconhecidos em vez de ignorá-los', async () => {
  const value = record(await fixtureValue())
  value.expected_product_ids = [13]

  const error = captureLoadError(() => parseEvalDataset(value))
  assert.ok(
    error.issues.some(
      (issue) => issue.path === '<root>' && /Unrecognized key/.test(issue.message),
    ),
  )
})

test('rejeita critério objetivo obrigatório sem configuração de assertions', async () => {
  const value = await fixtureValue()
  criteriaOf(value)[0] = {
    id: 'objective-compliance',
    criterion: 'context_continuity',
    kind: 'objective',
    applicability: 'required',
    evaluation: 'deterministic',
    status: 'not_evaluated',
    weight: 1,
  }

  const error = captureLoadError(() => parseEvalDataset(value))
  assert.ok(
    error.issues.some((issue) =>
      issue.path.startsWith('cases[0].quality_criteria[0]'),
    ),
  )
})

test('rejeita criterionId e assertionIds inconsistentes', async () => {
  const value = await fixtureValue()
  record(assertionsOf(value)[0]).criterionId = 'missing-criterion'

  const error = captureLoadError(() => parseEvalDataset(value))
  assert.ok(
    error.issues.some(
      (issue) =>
        issue.path === 'cases[0].assertions[0].criterionId' &&
        /não existe/.test(issue.message),
    ),
  )
})
