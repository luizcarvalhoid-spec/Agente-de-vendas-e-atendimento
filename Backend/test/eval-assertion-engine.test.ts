import assert from 'node:assert/strict'
import test from 'node:test'

import { toProductCard } from '../src/agent/chat-service.js'
import { loadCatalogRepository } from '../src/catalog/catalog-repository.js'
import type { ChatProductCard } from '../src/contracts/chat.js'
import {
  createEvalCanonicalData,
  evaluateOfflineEvalExecution,
} from '../src/evals/eval-assertion-engine.js'
import type {
  EvalAssertion,
  EvalCase,
  EvalDataset,
  EvalQualityCriterion,
} from '../src/evals/eval-dataset-schema.js'
import type { LoadedEvalDataset } from '../src/evals/eval-loader.js'
import type {
  EvalTurnExecution,
  OfflineEvalExecution,
} from '../src/evals/offline-eval-runner.js'
import type { EvalRuntimeTrace } from '../src/evals/offline-eval-trace.js'

const canonicalPromise = loadCatalogRepository().then(createEvalCanonicalData)

function emptyTrace(overrides: Partial<EvalRuntimeTrace> = {}): EvalRuntimeTrace {
  return {
    modelCalls: 1,
    toolsRequested: [],
    toolsExecuted: [],
    toolCalls: [],
    toolExecutions: [],
    grounding: {
      requirement: 'not_required',
      product: 'not_consulted',
      faq: 'not_consulted',
    },
    ingredientResolutions: [],
    productSearches: [],
    faqSearches: [],
    ...overrides,
  }
}

function textResponse(
  message = 'Resposta objetiva.',
  sourceIds: readonly string[] = [],
): NonNullable<EvalTurnExecution['response']> {
  return {
    type: 'text',
    message,
    productIds: [],
    products: [],
    sourceIds,
  }
}

function productResponse(
  products: readonly ChatProductCard[],
): NonNullable<EvalTurnExecution['response']> {
  return {
    type: products.length === 1 ? 'recommendation' : 'comparison',
    message: 'Recomendação canônica.',
    productIds: products.map((product) => product.id),
    products,
    sourceIds: [],
  }
}

function objectiveCriterion(
  assertions: readonly EvalAssertion[],
  overrides: Partial<Extract<EvalQualityCriterion, { kind: 'objective' }>> = {},
): EvalQualityCriterion {
  return {
    id: 'objective',
    criterion: 'factual_accuracy',
    kind: 'objective',
    applicability: 'required',
    evaluation: 'deterministic',
    status: 'not_evaluated',
    weight: 2,
    assertionIds: assertions.map((assertion) => assertion.id),
    ...overrides,
  }
}

function scenarioWith(
  assertions: readonly EvalAssertion[],
  criteria: readonly EvalQualityCriterion[] = [objectiveCriterion(assertions)],
): EvalCase {
  return {
    id: 'engine.scenario.001',
    category: 'engine-test',
    difficulty: 'medium',
    severity: 'high',
    tags: ['engine'],
    input: {
      initialState: { history: [], cart: [] },
      turns: [
        {
          message: 'Mensagem de teste.',
          preferences: { mode: 'preserve' },
          cart: { mode: 'preserve' },
          recommendationContext: { mode: 'auto' },
        },
      ],
    },
    expected_behaviors: [
      {
        turn: 0,
        action: 'answer',
        description: 'Resposta de teste.',
        requiredGrounding: [],
      },
    ],
    assertions: [...assertions],
    quality_criteria: [...criteria],
  } as EvalCase
}

function loadedWith(scenario: EvalCase): LoadedEvalDataset {
  const data = {
    schemaVersion: 1,
    dataset: {
      id: 'engine-dataset',
      version: '1.0.0',
      scope: 'store',
      locale: 'pt-BR',
      storeProfile: 'hidrasplash',
    },
    cases: [scenario],
  } as EvalDataset
  return {
    sourcePath: '<engine-test>',
    data,
    cases: [
      {
        index: 0,
        sourcePath: '<engine-test>#engine.scenario.001',
        scenario,
      },
    ],
  }
}

function executionWith(
  response: EvalTurnExecution['response'],
  trace = emptyTrace(),
  technicalStatus: EvalTurnExecution['technicalStatus'] = 'completed',
): OfflineEvalExecution {
  const turn: EvalTurnExecution = {
    datasetId: 'engine-dataset',
    scenarioId: 'engine.scenario.001',
    turn: 0,
    message: 'Mensagem de teste.',
    appliedState: { historyLength: 0, cart: [] },
    technicalStatus,
    ...(response === undefined ? {} : { response }),
    trace,
    ...(technicalStatus === 'technical_failure'
      ? {
          error: {
            code: 'OFFLINE_EXECUTION_FAILED',
            message: 'Falha controlada.',
          },
        }
      : {}),
  }
  return {
    mode: 'offline',
    dataset: {
      id: 'engine-dataset',
      version: '1.0.0',
      sourcePath: '<engine-test>',
    },
    technicalStatus,
    behavioralEvaluation: 'not_evaluated',
    scenarios: [
      {
        scenarioId: 'engine.scenario.001',
        technicalStatus,
        behavioralEvaluation: 'not_evaluated',
        turns: [turn],
      },
    ],
    summary: {
      scenarios: 1,
      completed: technicalStatus === 'completed' ? 1 : 0,
      technicalFailures: technicalStatus === 'technical_failure' ? 1 : 0,
    },
  }
}

async function evaluate(
  assertions: readonly EvalAssertion[],
  response: EvalTurnExecution['response'],
  trace = emptyTrace(),
  criteria?: readonly EvalQualityCriterion[],
  technicalStatus: EvalTurnExecution['technicalStatus'] = 'completed',
) {
  const scenario = scenarioWith(assertions, criteria)
  return evaluateOfflineEvalExecution(
    loadedWith(scenario),
    executionWith(response, trace, technicalStatus),
    await canonicalPromise,
  )
}

type AssertionValue = EvalAssertion extends infer Assertion
  ? Assertion extends EvalAssertion
    ? Omit<Assertion, 'id' | 'criterionId' | 'turn' | 'severity'>
    : never
  : never

function assertion(
  value: AssertionValue,
  index: number,
  severity: EvalAssertion['severity'] = 'high',
): EvalAssertion {
  return {
    id: `assertion-${index}`,
    criterionId: 'objective',
    turn: 0,
    severity,
    ...value,
  } as EvalAssertion
}

test('avalia tipos de resposta e todas as relações de IDs, inclusive arrays vazios', async () => {
  const assertions = [
    assertion(
      {
        type: 'response_type_allowed',
        responseTypes: ['text'],
        textReasons: ['not_found'],
      },
      1,
    ),
    assertion({ type: 'product_ids_exact', productIds: [] }, 2),
    assertion({ type: 'product_ids_include', productIds: [13] }, 3),
    assertion({ type: 'product_ids_exclude', productIds: [13] }, 4),
    assertion({ type: 'product_ids_allowed', productIds: [13] }, 5),
    assertion({ type: 'source_ids_exact', sourceIds: ['faq-002'] }, 6),
    assertion({ type: 'source_ids_include', sourceIds: ['faq-002'] }, 7),
    assertion({ type: 'source_ids_exclude', sourceIds: ['faq-003'] }, 8),
    assertion({ type: 'source_ids_allowed', sourceIds: ['faq-002'] }, 9),
  ]
  const response = {
    ...textResponse('Não encontrei uma alternativa.', ['faq-002']),
    reason: 'not_found' as const,
  }
  const result = await evaluate(assertions, response)
  const statuses = result.scenarios[0]?.assertionResults.map(
    (item) => item.status,
  )
  assert.deepEqual(statuses, [
    'passed',
    'passed',
    'failed',
    'passed',
    'passed',
    'passed',
    'passed',
    'passed',
    'passed',
  ])
})

test('normaliza texto sem exigir redação literal e aplica limites estruturais', async () => {
  const assertions = [
    assertion(
      { type: 'text_includes', values: ['INFORMAÇÃO ÚTIL'], match: 'normalized' },
      1,
    ),
    assertion(
      { type: 'text_excludes', values: ['compre agora'], match: 'normalized' },
      2,
    ),
    assertion({ type: 'max_questions', maximum: 1 }, 3),
    assertion(
      { type: 'message_length_between', minimum: 10, maximum: 100 },
      4,
    ),
  ]
  const result = await evaluate(
    assertions,
    textResponse('Uma informação   útil, com outra redação. Posso ajudar?'),
  )
  assert.deepEqual(
    result.scenarios[0]?.assertionResults.map((item) => item.status),
    ['passed', 'passed', 'passed', 'passed'],
  )
})

test('usa grounding, execução real de ferramenta e chamadas de modelo', async () => {
  const assertions = [
    assertion(
      { type: 'grounding_domains', domains: ['product'], match: 'exact' },
      1,
    ),
    assertion({ type: 'tool_called', toolName: 'search_products' }, 2),
    assertion({ type: 'tool_not_called', toolName: 'search_faq' }, 3),
    assertion({ type: 'max_model_calls', maximum: 2 }, 4),
  ]
  const trace = emptyTrace({
    modelCalls: 2,
    toolsRequested: ['search_products', 'search_faq'],
    toolsExecuted: ['search_products'],
    toolExecutions: [
      {
        ordinal: 1,
        name: 'search_products',
        executed: true,
        status: 'ok',
        outcome: 'found',
      },
      {
        ordinal: 2,
        name: 'search_faq',
        executed: false,
        status: 'invalid_arguments',
        outcome: 'rejected',
      },
    ],
    grounding: {
      requirement: 'product',
      product: 'found',
      faq: 'not_consulted',
    },
  })
  const result = await evaluate(assertions, textResponse(), trace)
  assert.deepEqual(
    result.scenarios[0]?.assertionResults.map((item) => item.status),
    ['passed', 'passed', 'passed', 'passed'],
  )
})

test('solicitação rejeitada não conta como ferramenta executada', async () => {
  const assertions = [
    assertion({ type: 'tool_called', toolName: 'search_products' }, 1),
    assertion({ type: 'tool_not_called', toolName: 'search_products' }, 2),
  ]
  const result = await evaluate(
    assertions,
    textResponse(),
    emptyTrace({
      toolsRequested: ['search_products'],
      toolExecutions: [
        {
          ordinal: 1,
          name: 'search_products',
          executed: false,
          status: 'invalid_arguments',
          outcome: 'rejected',
        },
      ],
    }),
  )
  assert.deepEqual(
    result.scenarios[0]?.assertionResults.map((item) => item.status),
    ['failed', 'passed'],
  )
})

test('compara todos os campos do cartão com o catálogo canônico', async () => {
  const canonical = await canonicalPromise
  const product = canonical.catalog.findById(13)
  assert.ok(product)
  const card = toProductCard(product, canonical.catalog)
  assert.ok(card)
  const assertionValue = assertion({ type: 'canonical_product_cards' }, 1, 'critical')

  const valid = await evaluate([assertionValue], productResponse([card]))
  assert.equal(valid.scenarios[0]?.assertionResults[0]?.status, 'passed')

  const altered = { ...card, price: card.price + 1 }
  const invalid = await evaluate([assertionValue], productResponse([altered]))
  assert.equal(invalid.scenarios[0]?.assertionResults[0]?.status, 'failed')
  assert.equal(invalid.scenarios[0]?.overallStatus, 'failed_critical')
})

test('fonte correta não transforma conteúdo comercial incorreto em aprovação completa', async () => {
  const sourceAssertion = assertion(
    { type: 'source_ids_include', sourceIds: ['faq-002'] },
    1,
    'critical',
  )
  const objective = objectiveCriterion([sourceAssertion])
  const human: EvalQualityCriterion = {
    id: 'human-facts',
    criterion: 'factual_accuracy',
    kind: 'subjective',
    applicability: 'required',
    evaluation: 'human',
    status: 'not_evaluated',
    weight: 2,
  }
  const result = await evaluate(
    [sourceAssertion],
    textResponse('Frete grátis em qualquer valor.', ['faq-002']),
    emptyTrace(),
    [objective, human],
  )
  assert.equal(result.assertionSummary.passed, 1)
  assert.equal(result.overallStatus, 'needs_review')
  assert.equal(result.requiredHumanCriteriaPending, 1)
})

test('restrição de ingrediente exige resolução e aplicação, não apenas ausência de produto', async () => {
  const canonical = await canonicalPromise
  const resolution = canonical.productIndex.resolveIngredientTerms([
    'cocamidopropil-betaína',
  ])
  assert.equal(resolution.unresolvedTerms.length, 0)
  const assertionValue = assertion(
    {
      type: 'products_satisfy_ingredient_restrictions',
      terms: ['cocamidopropil-betaína'],
    },
    1,
    'critical',
  )

  const insufficient = await evaluate([assertionValue], textResponse())
  assert.equal(
    insufficient.scenarios[0]?.assertionResults[0]?.status,
    'not_evaluated',
  )

  const trace = emptyTrace({
    toolsExecuted: ['search_products'],
    toolExecutions: [
      {
        ordinal: 1,
        name: 'search_products',
        executed: true,
        status: 'ok',
        outcome: 'not_found',
      },
    ],
    ingredientResolutions: [
      {
        terms: ['cocamidopropil-betaína'],
        resolvedIds: resolution.resolvedIds,
        unresolvedTerms: [],
      },
    ],
    productSearches: [
      {
        incompatibleIngredientIds: resolution.resolvedIds,
        resultProductIds: [],
      },
    ],
  })
  const proven = await evaluate([assertionValue], textResponse(), trace)
  assert.equal(proven.scenarios[0]?.assertionResults[0]?.status, 'passed')
})

test('outcome desconhecido não aprova restrição de ingrediente', async () => {
  const canonical = await canonicalPromise
  const resolution = canonical.productIndex.resolveIngredientTerms([
    'cocamidopropil-betaína',
  ])
  const responseAssertion = assertion(
    { type: 'response_type_allowed', responseTypes: ['text'] },
    1,
  )
  const assertionValue = assertion(
    {
      type: 'products_satisfy_ingredient_restrictions',
      terms: ['cocamidopropil-betaína'],
    },
    2,
    'critical',
  )
  const result = await evaluate(
    [responseAssertion, assertionValue],
    textResponse(),
    emptyTrace({
      toolsExecuted: ['search_products'],
      toolExecutions: [
        {
          ordinal: 1,
          name: 'search_products',
          executed: true,
          status: 'ok',
          outcome: 'unknown',
        },
      ],
      ingredientResolutions: [
        {
          terms: ['cocamidopropil-betaína'],
          resolvedIds: resolution.resolvedIds,
          unresolvedTerms: [],
        },
      ],
      productSearches: [
        {
          incompatibleIngredientIds: resolution.resolvedIds,
          resultProductIds: [],
        },
      ],
    }),
  )
  assert.equal(result.scenarios[0]?.assertionResults[0]?.status, 'passed')
  assert.equal(result.scenarios[0]?.assertionResults[1]?.status, 'not_evaluated')
  assert.equal(result.objectiveScore?.partial, true)
})

test('produto incompatível e produto explicitamente proibido geram falhas críticas', async () => {
  const canonical = await canonicalPromise
  const product = canonical.catalog.findById(13)
  assert.ok(product)
  const card = toProductCard(product, canonical.catalog)
  assert.ok(card)
  const resolution = canonical.productIndex.resolveIngredientTerms([
    'cocamidopropil-betaína',
  ])
  const assertions = [
    assertion({ type: 'product_ids_exclude', productIds: [13] }, 1, 'critical'),
    assertion(
      {
        type: 'products_satisfy_ingredient_restrictions',
        terms: ['cocamidopropil-betaína'],
      },
      2,
      'critical',
    ),
  ]
  const result = await evaluate(
    assertions,
    productResponse([card]),
    emptyTrace({
      ingredientResolutions: [
        {
          terms: ['cocamidopropil-betaína'],
          resolvedIds: resolution.resolvedIds,
          unresolvedTerms: [],
        },
      ],
    }),
  )
  assert.equal(result.criticalFailures, 2)
  assert.equal(result.overallStatus, 'failed_critical')
  assert.ok((result.objectiveScore?.final ?? 10) <= 3)
})

test('falha crítica limita nota alta sem apagar a pontuação bruta', async () => {
  const assertions = [
    assertion({ type: 'product_ids_exclude', productIds: [13] }, 0, 'critical'),
    ...Array.from({ length: 10 }, (_, index) =>
      assertion(
        { type: 'response_type_allowed', responseTypes: ['text'] },
        index + 1,
        'critical',
      ),
    ),
  ]
  const response = {
    ...textResponse(),
    productIds: [13],
  }
  const result = await evaluate(assertions, response)
  assert.equal(result.overallStatus, 'failed_critical')
  assert.ok((result.objectiveScore?.raw ?? 0) > 9)
  assert.equal(result.objectiveScore?.final, 3)
})

test('critério subjetivo obrigatório fica pendente; opcional e não aplicável não bloqueiam', async () => {
  const assertionValue = assertion(
    { type: 'response_type_allowed', responseTypes: ['text'] },
    1,
  )
  const objective = objectiveCriterion([assertionValue])
  const requiredHuman: EvalQualityCriterion = {
    id: 'required-human',
    criterion: 'naturalness',
    kind: 'subjective',
    applicability: 'required',
    evaluation: 'human',
    status: 'not_evaluated',
    weight: 1,
  }
  const optionalHuman: EvalQualityCriterion = {
    id: 'optional-human',
    criterion: 'consultative_quality',
    kind: 'subjective',
    applicability: 'optional',
    evaluation: 'human',
    status: 'not_evaluated',
    weight: 1,
  }
  const notApplicable: EvalQualityCriterion = {
    id: 'not-applicable',
    criterion: 'context_continuity',
    kind: 'objective',
    applicability: 'not_applicable',
    status: 'not_applicable',
    reason: 'Cenário de turno único.',
  }
  const result = await evaluate(
    [assertionValue],
    textResponse(),
    emptyTrace(),
    [objective, requiredHuman, optionalHuman, notApplicable],
  )
  assert.equal(result.overallStatus, 'needs_review')
  assert.equal(result.requiredHumanCriteriaPending, 1)
  assert.equal(result.criterionSummary.notApplicable, 1)
  assert.equal(result.criterionSummary.notEvaluated, 2)
})

test('critério objetivo opcional é diagnóstico e não bloqueia aprovação obrigatória', async () => {
  const requiredAssertion = assertion(
    { type: 'response_type_allowed', responseTypes: ['text'] },
    1,
  )
  const optionalAssertion = {
    ...assertion({ type: 'max_questions', maximum: 0 }, 2),
    criterionId: 'optional-objective',
  } as EvalAssertion
  const requiredCriterion = objectiveCriterion([requiredAssertion])
  const optionalCriterion = objectiveCriterion(
    [optionalAssertion],
    {
      id: 'optional-objective',
      applicability: 'optional',
      assertionIds: [optionalAssertion.id],
    },
  )
  const result = await evaluate(
    [requiredAssertion, optionalAssertion],
    textResponse('Posso ajudar?'),
    emptyTrace(),
    [requiredCriterion, optionalCriterion],
  )
  assert.equal(result.scenarios[0]?.objectiveStatus, 'failed')
  assert.equal(result.overallStatus, 'passed')
  assert.ok((result.objectiveScore?.final ?? 10) < 10)
})

test('falha técnica não aprova assertions nem fabrica nota', async () => {
  const assertionValue = assertion(
    { type: 'response_type_allowed', responseTypes: ['text'] },
    1,
    'critical',
  )
  const result = await evaluate(
    [assertionValue],
    undefined,
    emptyTrace(),
    undefined,
    'technical_failure',
  )
  assert.equal(result.assertionSummary.notEvaluated, 1)
  assert.equal(result.criticalFailures, 0)
  assert.equal(result.objectiveScore, undefined)
  assert.equal(result.overallStatus, 'needs_review')
})

test('evidência ausente mantém todas as famílias de assertion não avaliadas', async () => {
  const assertions = [
    assertion({ type: 'response_type_allowed', responseTypes: ['text'] }, 1),
    assertion({ type: 'product_ids_exact', productIds: [] }, 2),
    assertion({ type: 'product_ids_include', productIds: [13] }, 3),
    assertion({ type: 'product_ids_exclude', productIds: [13] }, 4),
    assertion({ type: 'product_ids_allowed', productIds: [13] }, 5),
    assertion({ type: 'source_ids_exact', sourceIds: [] }, 6),
    assertion({ type: 'source_ids_include', sourceIds: ['faq-001'] }, 7),
    assertion({ type: 'source_ids_exclude', sourceIds: ['faq-001'] }, 8),
    assertion({ type: 'source_ids_allowed', sourceIds: ['faq-001'] }, 9),
    assertion({ type: 'canonical_product_cards' }, 10),
    assertion({ type: 'text_includes', values: ['texto'], match: 'exact' }, 11),
    assertion({ type: 'text_excludes', values: ['texto'], match: 'exact' }, 12),
    assertion({ type: 'max_questions', maximum: 1 }, 13),
    assertion(
      { type: 'message_length_between', minimum: 1, maximum: 100 },
      14,
    ),
    assertion(
      { type: 'grounding_domains', domains: ['product'], match: 'include' },
      15,
    ),
    assertion({ type: 'tool_called', toolName: 'search_products' }, 16),
    assertion({ type: 'tool_not_called', toolName: 'search_products' }, 17),
    assertion({ type: 'max_model_calls', maximum: 2 }, 18),
    assertion(
      {
        type: 'products_satisfy_ingredient_restrictions',
        terms: ['cocamidopropil-betaína'],
      },
      19,
    ),
  ]
  const result = await evaluate(
    assertions,
    undefined,
    emptyTrace(),
    undefined,
    'technical_failure',
  )
  assert.equal(result.assertionSummary.notEvaluated, assertions.length)
  assert.equal(result.assertionSummary.passed, 0)
  assert.equal(result.assertionSummary.failed, 0)
  assert.equal(result.objectiveScore, undefined)
})

test('avaliação determinística é reproduzível', async () => {
  const assertions = [
    assertion({ type: 'response_type_allowed', responseTypes: ['text'] }, 1),
    assertion({ type: 'max_questions', maximum: 0 }, 2),
  ]
  const first = await evaluate(assertions, textResponse())
  const second = await evaluate(assertions, textResponse())
  assert.deepEqual(second, first)
})
