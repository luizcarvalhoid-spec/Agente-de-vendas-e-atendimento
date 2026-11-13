import { isDeepStrictEqual } from 'node:util'

import { toProductCard } from '../agent/chat-service.js'
import {
  createProductSearchIndex,
  productIngredientIds,
  type ProductSearchIndex,
} from '../agent/tools/product-tools.js'
import type { CatalogRepository } from '../catalog/catalog-repository.js'
import type {
  EvalAssertion,
  EvalCase,
  EvalQualityCriterion,
} from './eval-dataset-schema.js'
import type { LoadedEvalDataset } from './eval-loader.js'
import type {
  EvalTurnExecution,
  OfflineEvalExecution,
} from './offline-eval-runner.js'

export type EvalAssertionStatus = 'passed' | 'failed' | 'not_evaluated'
export type EvalCriterionStatus =
  | EvalAssertionStatus
  | 'not_applicable'
export type EvalObjectiveStatus =
  | 'passed'
  | 'failed'
  | 'not_evaluated'
  | 'failed_critical'
export type EvalOverallStatus =
  | 'passed'
  | 'failed'
  | 'needs_review'
  | 'failed_critical'

export interface EvalCanonicalData {
  readonly catalog: CatalogRepository
  readonly productIndex: ProductSearchIndex
}

export interface EvalAssertionResult {
  readonly assertionId: string
  readonly criterionId: string
  readonly scenarioId: string
  readonly turn: number
  readonly type: EvalAssertion['type']
  readonly severity: EvalAssertion['severity']
  readonly status: EvalAssertionStatus
  readonly reason: string
  readonly evidenceReferences: readonly string[]
}

export interface EvalCriterionResult {
  readonly criterionId: string
  readonly criterion: EvalQualityCriterion['criterion']
  readonly kind: EvalQualityCriterion['kind']
  readonly applicability: EvalQualityCriterion['applicability']
  readonly status: EvalCriterionStatus
  readonly weight?: number
  readonly assertionIds: readonly string[]
  readonly score?: number
  readonly partial: boolean
}

export interface EvalObjectiveScore {
  readonly raw: number
  readonly final: number
  readonly partial: boolean
}

export interface EvalScenarioEvaluation {
  readonly scenarioId: string
  readonly objectiveStatus: EvalObjectiveStatus
  readonly overallStatus: EvalOverallStatus
  readonly criticalFailures: number
  readonly requiredHumanCriteriaPending: number
  readonly assertionResults: readonly EvalAssertionResult[]
  readonly criterionResults: readonly EvalCriterionResult[]
  readonly objectiveScore?: EvalObjectiveScore
}

export interface EvalDatasetEvaluation {
  readonly datasetId: string
  readonly objectiveStatus: EvalObjectiveStatus
  readonly overallStatus: EvalOverallStatus
  readonly criticalFailures: number
  readonly requiredHumanCriteriaPending: number
  readonly assertionSummary: {
    readonly passed: number
    readonly failed: number
    readonly notEvaluated: number
  }
  readonly criterionSummary: {
    readonly passed: number
    readonly failed: number
    readonly notEvaluated: number
    readonly notApplicable: number
  }
  readonly objectiveScore?: EvalObjectiveScore
  readonly scenarios: readonly EvalScenarioEvaluation[]
}

const ASSERTION_SEVERITY_WEIGHTS = {
  low: 1,
  medium: 2,
  high: 3,
  critical: 4,
} as const

export function createEvalCanonicalData(
  catalog: CatalogRepository,
): EvalCanonicalData {
  return {
    catalog,
    productIndex: createProductSearchIndex(catalog.listAll()),
  }
}

function normalizeText(value: string) {
  return value
    .normalize('NFKD')
    .replace(/\p{Diacritic}/gu, '')
    .toLocaleLowerCase('pt-BR')
    .trim()
    .replace(/\s+/g, ' ')
}

function sameSet<T>(first: readonly T[], second: readonly T[]) {
  return (
    first.length === second.length &&
    first.every((value) => second.includes(value))
  )
}

function includesAll<T>(actual: readonly T[], expected: readonly T[]) {
  return expected.every((value) => actual.includes(value))
}

function assertionResult(
  scenarioId: string,
  assertion: EvalAssertion,
  status: EvalAssertionStatus,
  reason: string,
  evidenceReferences: readonly string[],
): EvalAssertionResult {
  return {
    assertionId: assertion.id,
    criterionId: assertion.criterionId,
    scenarioId,
    turn: assertion.turn,
    type: assertion.type,
    severity: assertion.severity,
    status,
    reason,
    evidenceReferences,
  }
}

function missingTurnResult(scenarioId: string, assertion: EvalAssertion) {
  return assertionResult(
    scenarioId,
    assertion,
    'not_evaluated',
    'O turno não produziu evidência técnica suficiente.',
    [`scenarios.${scenarioId}.turns.${assertion.turn}.technicalStatus`],
  )
}

function responseResult(
  scenarioId: string,
  assertion: EvalAssertion,
  passed: boolean,
  evidenceReferences: readonly string[],
  passedReason: string,
  failedReason: string,
) {
  return assertionResult(
    scenarioId,
    assertion,
    passed ? 'passed' : 'failed',
    passed ? passedReason : failedReason,
    evidenceReferences,
  )
}

function evaluateIdAssertion(
  scenarioId: string,
  assertion: Extract<
    EvalAssertion,
    {
      type:
        | 'product_ids_exact'
        | 'product_ids_include'
        | 'product_ids_exclude'
        | 'product_ids_allowed'
        | 'source_ids_exact'
        | 'source_ids_include'
        | 'source_ids_exclude'
        | 'source_ids_allowed'
    }
  >,
  actual: readonly (number | string)[],
) {
  const expected: readonly (number | string)[] =
    'productIds' in assertion ? assertion.productIds : assertion.sourceIds
  const passed = assertion.type.endsWith('_exact')
    ? actual.length === expected.length &&
      actual.every((value, index) => value === expected[index])
    : assertion.type.endsWith('_include')
      ? includesAll(actual, expected)
      : assertion.type.endsWith('_exclude')
        ? expected.every((value) => !actual.includes(value))
        : actual.every((value) => expected.includes(value))
  const family = assertion.type.startsWith('product_') ? 'productIds' : 'sourceIds'
  return responseResult(
    scenarioId,
    assertion,
    passed,
    [`scenarios.${scenarioId}.turns.${assertion.turn}.response.${family}`],
    'Os identificadores observados atendem à relação de conjuntos declarada.',
    'Os identificadores observados não atendem à relação de conjuntos declarada.',
  )
}

function evaluateCanonicalCards(
  scenarioId: string,
  assertion: Extract<EvalAssertion, { type: 'canonical_product_cards' }>,
  turn: EvalTurnExecution,
  canonical: EvalCanonicalData,
) {
  const response = turn.response
  if (response === undefined) return missingTurnResult(scenarioId, assertion)
  if (response.type === 'text' || response.products.length === 0) {
    return assertionResult(
      scenarioId,
      assertion,
      'failed',
      'A resposta não apresentou cartões de produto.',
      [`scenarios.${scenarioId}.turns.${assertion.turn}.response.products`],
    )
  }
  if (
    response.products.length !== response.productIds.length ||
    response.products.some(
      (card, index) => card.id !== response.productIds[index],
    )
  ) {
    return assertionResult(
      scenarioId,
      assertion,
      'failed',
      'Os cartões não correspondem aos IDs apresentados na resposta.',
      [
        `scenarios.${scenarioId}.turns.${assertion.turn}.response.products`,
        `scenarios.${scenarioId}.turns.${assertion.turn}.response.productIds`,
      ],
    )
  }

  for (const card of response.products) {
    const product = canonical.catalog.findById(card.id)
    const expected =
      product === undefined
        ? undefined
        : toProductCard(product, canonical.catalog)
    if (expected === undefined || !isDeepStrictEqual(card, expected)) {
      return assertionResult(
        scenarioId,
        assertion,
        'failed',
        'Ao menos um cartão diverge da projeção canônica atual.',
        [
          `scenarios.${scenarioId}.turns.${assertion.turn}.response.products`,
          `canonical.products.${card.id}`,
        ],
      )
    }
  }

  return assertionResult(
    scenarioId,
    assertion,
    'passed',
    'Todos os campos dos cartões correspondem às projeções canônicas.',
    [
      `scenarios.${scenarioId}.turns.${assertion.turn}.response.products`,
      'canonical.products',
    ],
  )
}

function evaluateIngredientRestrictions(
  scenarioId: string,
  assertion: Extract<
    EvalAssertion,
    { type: 'products_satisfy_ingredient_restrictions' }
  >,
  turn: EvalTurnExecution,
  canonical: EvalCanonicalData,
) {
  const response = turn.response
  if (response === undefined) return missingTurnResult(scenarioId, assertion)
  const canonicalResolution = canonical.productIndex.resolveIngredientTerms(
    assertion.terms,
  )
  const evidence = [
    `scenarios.${scenarioId}.turns.${assertion.turn}.trace.ingredientResolutions`,
    `scenarios.${scenarioId}.turns.${assertion.turn}.trace.productSearches`,
    `scenarios.${scenarioId}.turns.${assertion.turn}.response.productIds`,
    'canonical.products',
  ]
  if (
    canonicalResolution.resolvedIds.length === 0 ||
    canonicalResolution.unresolvedTerms.length > 0
  ) {
    return assertionResult(
      scenarioId,
      assertion,
      'not_evaluated',
      'Os termos da assertion não possuem resolução canônica conclusiva.',
      evidence,
    )
  }

  const restrictedIds = canonicalResolution.resolvedIds
  const incompatibleProduct = response.productIds.find((productId) => {
    const product = canonical.catalog.findById(productId)
    return (
      product !== undefined &&
      [...productIngredientIds(product)].some((id) =>
        restrictedIds.includes(id),
      )
    )
  })
  if (incompatibleProduct !== undefined) {
    return assertionResult(
      scenarioId,
      assertion,
      'failed',
      'A resposta apresentou produto incompatível com a restrição canônica.',
      evidence,
    )
  }

  const matchingResolution = turn.trace.ingredientResolutions.find((item) =>
    includesAll(item.resolvedIds, restrictedIds),
  )
  if (matchingResolution === undefined) {
    const assertedTerms = assertion.terms.map(normalizeText)
    const explicitUnresolved = turn.trace.ingredientResolutions.some((item) =>
      item.unresolvedTerms.some((term) =>
        assertedTerms.includes(normalizeText(term)),
      ),
    )
    return assertionResult(
      scenarioId,
      assertion,
      explicitUnresolved ? 'failed' : 'not_evaluated',
      explicitUnresolved
        ? 'A execução registrou a restrição como não resolvida.'
        : 'Não há evidência de resolução da restrição durante a execução.',
      evidence,
    )
  }

  const productExecutions = turn.trace.toolExecutions.filter(
    (item) => item.name === 'search_products' && item.executed,
  )
  if (
    productExecutions.length === 0 ||
    productExecutions.some(
      (item) => item.outcome !== 'found' && item.outcome !== 'not_found',
    ) ||
    turn.trace.productSearches.length === 0
  ) {
    return assertionResult(
      scenarioId,
      assertion,
      'not_evaluated',
      'A execução não contém uma busca canônica conclusiva para a restrição.',
      evidence,
    )
  }

  if (
    turn.trace.productSearches.some(
      (search) =>
        !includesAll(search.incompatibleIngredientIds, restrictedIds),
    )
  ) {
    return assertionResult(
      scenarioId,
      assertion,
      'failed',
      'Ao menos uma busca não aplicou todos os ingredientes incompatíveis.',
      evidence,
    )
  }

  for (const search of turn.trace.productSearches) {
    for (const productId of search.resultProductIds) {
      const product = canonical.catalog.findById(productId)
      if (
        product !== undefined &&
        [...productIngredientIds(product)].some((id) =>
          restrictedIds.includes(id),
        )
      ) {
        return assertionResult(
          scenarioId,
          assertion,
          'failed',
          'Uma busca retornou produto incompatível com a restrição aplicada.',
          evidence,
        )
      }
    }
  }

  return assertionResult(
    scenarioId,
    assertion,
    'passed',
    'A restrição foi resolvida, aplicada às buscas e respeitada pelos produtos.',
    evidence,
  )
}

function evaluateAssertion(
  scenario: EvalCase,
  assertion: EvalAssertion,
  turn: EvalTurnExecution | undefined,
  canonical: EvalCanonicalData,
): EvalAssertionResult {
  if (
    turn === undefined ||
    turn.technicalStatus !== 'completed' ||
    turn.response === undefined
  ) {
    return missingTurnResult(scenario.id, assertion)
  }

  const response = turn.response
  switch (assertion.type) {
    case 'response_type_allowed': {
      const typeAllowed = assertion.responseTypes.includes(response.type)
      const reasonAllowed =
        response.type !== 'text' ||
        assertion.textReasons === undefined ||
        (response.reason !== undefined &&
          assertion.textReasons.includes(response.reason))
      return responseResult(
        scenario.id,
        assertion,
        typeAllowed && reasonAllowed,
        [
          `scenarios.${scenario.id}.turns.${assertion.turn}.response.type`,
          `scenarios.${scenario.id}.turns.${assertion.turn}.response.reason`,
        ],
        'O tipo e o motivo estruturado da resposta são permitidos.',
        'O tipo ou o motivo estruturado da resposta não é permitido.',
      )
    }
    case 'product_ids_exact':
    case 'product_ids_include':
    case 'product_ids_exclude':
    case 'product_ids_allowed':
      return evaluateIdAssertion(
        scenario.id,
        assertion,
        response.productIds,
      )
    case 'source_ids_exact':
    case 'source_ids_include':
    case 'source_ids_exclude':
    case 'source_ids_allowed':
      return evaluateIdAssertion(
        scenario.id,
        assertion,
        response.sourceIds,
      )
    case 'canonical_product_cards':
      return evaluateCanonicalCards(
        scenario.id,
        assertion,
        turn,
        canonical,
      )
    case 'text_includes': {
      const actual =
        assertion.match === 'normalized'
          ? normalizeText(response.message)
          : response.message
      const passed = assertion.values.every((value) =>
        actual.includes(
          assertion.match === 'normalized' ? normalizeText(value) : value,
        ),
      )
      return responseResult(
        scenario.id,
        assertion,
        passed,
        [`scenarios.${scenario.id}.turns.${assertion.turn}.response.message`],
        'A mensagem contém todos os trechos declarados.',
        'A mensagem não contém todos os trechos declarados.',
      )
    }
    case 'text_excludes': {
      const actual =
        assertion.match === 'normalized'
          ? normalizeText(response.message)
          : response.message
      const passed = assertion.values.every(
        (value) =>
          !actual.includes(
            assertion.match === 'normalized' ? normalizeText(value) : value,
          ),
      )
      return responseResult(
        scenario.id,
        assertion,
        passed,
        [`scenarios.${scenario.id}.turns.${assertion.turn}.response.message`],
        'A mensagem exclui todos os trechos proibidos.',
        'A mensagem contém ao menos um trecho proibido.',
      )
    }
    case 'max_questions': {
      const questions = response.message.match(/\?+/g)?.length ?? 0
      return responseResult(
        scenario.id,
        assertion,
        questions <= assertion.maximum,
        [`scenarios.${scenario.id}.turns.${assertion.turn}.response.message`],
        'A quantidade de perguntas respeita o limite.',
        'A quantidade de perguntas excede o limite.',
      )
    }
    case 'message_length_between':
      return responseResult(
        scenario.id,
        assertion,
        response.message.length >= assertion.minimum &&
          response.message.length <= assertion.maximum,
        [`scenarios.${scenario.id}.turns.${assertion.turn}.response.message`],
        'O comprimento da mensagem está dentro do intervalo.',
        'O comprimento da mensagem está fora do intervalo.',
      )
    case 'grounding_domains': {
      const observed = (['product', 'faq'] as const).filter(
        (domain) =>
          turn.trace.grounding[domain] === 'found' ||
          turn.trace.grounding[domain] === 'not_found',
      )
      const passed =
        assertion.match === 'exact'
          ? sameSet(observed, assertion.domains)
          : includesAll(observed, assertion.domains)
      return responseResult(
        scenario.id,
        assertion,
        passed,
        [`scenarios.${scenario.id}.turns.${assertion.turn}.trace.grounding`],
        'Os domínios de grounding comprovados atendem à expectativa.',
        'Os domínios de grounding comprovados não atendem à expectativa.',
      )
    }
    case 'tool_called': {
      const executed = turn.trace.toolExecutions.some(
        (item) => item.name === assertion.toolName && item.executed,
      )
      return responseResult(
        scenario.id,
        assertion,
        executed,
        [
          `scenarios.${scenario.id}.turns.${assertion.turn}.trace.toolExecutions`,
        ],
        'A ferramenta possui evidência de execução real.',
        'A ferramenta não possui evidência de execução real.',
      )
    }
    case 'tool_not_called': {
      const executed = turn.trace.toolExecutions.some(
        (item) => item.name === assertion.toolName && item.executed,
      )
      return responseResult(
        scenario.id,
        assertion,
        !executed,
        [
          `scenarios.${scenario.id}.turns.${assertion.turn}.trace.toolExecutions`,
        ],
        'Não existe evidência de execução real da ferramenta.',
        'A ferramenta possui evidência de execução real.',
      )
    }
    case 'max_model_calls':
      return responseResult(
        scenario.id,
        assertion,
        turn.trace.modelCalls <= assertion.maximum,
        [`scenarios.${scenario.id}.turns.${assertion.turn}.trace.modelCalls`],
        'A quantidade de chamadas ao modelo respeita o limite.',
        'A quantidade de chamadas ao modelo excede o limite.',
      )
    case 'products_satisfy_ingredient_restrictions':
      return evaluateIngredientRestrictions(
        scenario.id,
        assertion,
        turn,
        canonical,
      )
  }
}

function roundScore(value: number) {
  return Math.round(value * 100) / 100
}

function scoreAssertions(results: readonly EvalAssertionResult[]) {
  let passedWeight = 0
  let applicableWeight = 0
  for (const result of results) {
    if (result.status === 'not_evaluated') continue
    const weight = ASSERTION_SEVERITY_WEIGHTS[result.severity]
    applicableWeight += weight
    if (result.status === 'passed') passedWeight += weight
  }
  if (applicableWeight === 0) return undefined
  return roundScore(1 + (9 * passedWeight) / applicableWeight)
}

function evaluateCriterion(
  criterion: EvalQualityCriterion,
  assertionResults: readonly EvalAssertionResult[],
): EvalCriterionResult {
  if (criterion.applicability === 'not_applicable') {
    return {
      criterionId: criterion.id,
      criterion: criterion.criterion,
      kind: criterion.kind,
      applicability: criterion.applicability,
      status: 'not_applicable',
      assertionIds: [],
      partial: false,
    }
  }
  if (criterion.kind === 'subjective') {
    return {
      criterionId: criterion.id,
      criterion: criterion.criterion,
      kind: criterion.kind,
      applicability: criterion.applicability,
      status: 'not_evaluated',
      weight: criterion.weight,
      assertionIds: [],
      partial: false,
    }
  }

  const results = criterion.assertionIds.map(
    (assertionId) =>
      assertionResults.find((item) => item.assertionId === assertionId) as
        | EvalAssertionResult
        | undefined,
  )
  const available = results.filter(
    (item): item is EvalAssertionResult => item !== undefined,
  )
  const hasMissing =
    available.length !== criterion.assertionIds.length ||
    available.some((item) => item.status === 'not_evaluated')
  const hasFailure = available.some((item) => item.status === 'failed')
  const score = scoreAssertions(available)
  return {
    criterionId: criterion.id,
    criterion: criterion.criterion,
    kind: criterion.kind,
    applicability: criterion.applicability,
    status: hasFailure
      ? 'failed'
      : hasMissing
        ? 'not_evaluated'
        : 'passed',
    weight: criterion.weight,
    assertionIds: [...criterion.assertionIds],
    ...(score === undefined ? {} : { score }),
    partial: hasMissing && score !== undefined,
  }
}

function aggregateCriterionScores(
  criteria: readonly EvalCriterionResult[],
) {
  const scored = criteria.filter(
    (criterion): criterion is EvalCriterionResult & {
      score: number
      weight: number
    } =>
      criterion.kind === 'objective' &&
      criterion.score !== undefined &&
      criterion.weight !== undefined,
  )
  const totalWeight = scored.reduce(
    (total, criterion) => total + criterion.weight,
    0,
  )
  if (totalWeight === 0) return undefined
  return roundScore(
    scored.reduce(
      (total, criterion) => total + criterion.score * criterion.weight,
      0,
    ) / totalWeight,
  )
}

function evaluateScenario(
  scenario: EvalCase,
  execution: OfflineEvalExecution['scenarios'][number] | undefined,
  canonical: EvalCanonicalData,
): EvalScenarioEvaluation {
  const assertionResults = scenario.assertions.map((assertion) =>
    evaluateAssertion(
      scenario,
      assertion,
      execution?.turns.find((turn) => turn.turn === assertion.turn),
      canonical,
    ),
  )
  const criterionResults = scenario.quality_criteria.map((criterion) =>
    evaluateCriterion(criterion, assertionResults),
  )
  const criticalFailures = assertionResults.filter(
    (result) =>
      result.severity === 'critical' && result.status === 'failed',
  ).length
  const hasFailure = assertionResults.some(
    (result) => result.status === 'failed',
  )
  const hasMissing = assertionResults.some(
    (result) => result.status === 'not_evaluated',
  )
  const objectiveStatus: EvalObjectiveStatus =
    criticalFailures > 0
      ? 'failed_critical'
      : hasFailure
        ? 'failed'
        : hasMissing
          ? 'not_evaluated'
          : 'passed'
  const requiredHumanCriteriaPending = criterionResults.filter(
    (criterion) =>
      criterion.kind === 'subjective' &&
      criterion.applicability === 'required' &&
      criterion.status === 'not_evaluated',
  ).length
  const requiredObjectivePending = criterionResults.some(
    (criterion) =>
      criterion.kind === 'objective' &&
      criterion.applicability === 'required' &&
      criterion.status === 'not_evaluated',
  )
  const requiredObjectiveFailure = criterionResults.some(
    (criterion) =>
      criterion.kind === 'objective' &&
      criterion.applicability === 'required' &&
      criterion.status === 'failed',
  )
  const overallStatus: EvalOverallStatus =
    criticalFailures > 0
      ? 'failed_critical'
      : execution?.technicalStatus !== 'completed' ||
          requiredHumanCriteriaPending > 0 ||
          requiredObjectivePending
        ? 'needs_review'
        : requiredObjectiveFailure
          ? 'failed'
          : 'passed'
  const rawScore = aggregateCriterionScores(criterionResults)
  const scorePartial = criterionResults.some(
    (criterion) =>
      criterion.kind === 'objective' &&
      criterion.applicability !== 'not_applicable' &&
      (criterion.status === 'not_evaluated' || criterion.partial),
  )
  return {
    scenarioId: scenario.id,
    objectiveStatus,
    overallStatus,
    criticalFailures,
    requiredHumanCriteriaPending,
    assertionResults,
    criterionResults,
    ...(rawScore === undefined
      ? {}
      : {
          objectiveScore: {
            raw: rawScore,
            final:
              criticalFailures > 0 ? Math.min(rawScore, 3) : rawScore,
            partial: scorePartial,
          },
        }),
  }
}

function countStatuses<T extends string>(
  values: readonly T[],
  status: T,
) {
  return values.filter((value) => value === status).length
}

export function evaluateOfflineEvalExecution(
  loaded: LoadedEvalDataset,
  execution: OfflineEvalExecution,
  canonical: EvalCanonicalData,
): EvalDatasetEvaluation {
  const scenarios = execution.scenarios.map((scenarioExecution) => {
    const scenario = loaded.data.cases.find(
      (item) => item.id === scenarioExecution.scenarioId,
    )
    if (scenario === undefined) {
      throw new TypeError(
        `Execução referencia cenário ausente: ${scenarioExecution.scenarioId}.`,
      )
    }
    return evaluateScenario(scenario, scenarioExecution, canonical)
  })
  const assertionStatuses = scenarios.flatMap((scenario) =>
    scenario.assertionResults.map((result) => result.status),
  )
  const criterionStatuses = scenarios.flatMap((scenario) =>
    scenario.criterionResults.map((result) => result.status),
  )
  const criticalFailures = scenarios.reduce(
    (total, scenario) => total + scenario.criticalFailures,
    0,
  )
  const requiredHumanCriteriaPending = scenarios.reduce(
    (total, scenario) =>
      total + scenario.requiredHumanCriteriaPending,
    0,
  )
  const objectiveStatus: EvalObjectiveStatus = scenarios.some(
    (scenario) => scenario.objectiveStatus === 'failed_critical',
  )
    ? 'failed_critical'
    : scenarios.some((scenario) => scenario.objectiveStatus === 'failed')
      ? 'failed'
      : scenarios.some(
            (scenario) => scenario.objectiveStatus === 'not_evaluated',
          )
        ? 'not_evaluated'
        : 'passed'
  const overallStatus: EvalOverallStatus = scenarios.some(
    (scenario) => scenario.overallStatus === 'failed_critical',
  )
    ? 'failed_critical'
    : scenarios.some((scenario) => scenario.overallStatus === 'needs_review')
      ? 'needs_review'
      : scenarios.some((scenario) => scenario.overallStatus === 'failed')
        ? 'failed'
        : 'passed'
  const scoredScenarios = scenarios.filter(
    (scenario): scenario is EvalScenarioEvaluation & {
      objectiveScore: EvalObjectiveScore
    } => scenario.objectiveScore !== undefined,
  )
  const rawScore =
    scoredScenarios.length === 0
      ? undefined
      : roundScore(
          scoredScenarios.reduce(
            (total, scenario) => total + scenario.objectiveScore.raw,
            0,
          ) / scoredScenarios.length,
        )
  const scorePartial =
    scoredScenarios.length !== scenarios.length ||
    scoredScenarios.some((scenario) => scenario.objectiveScore.partial)

  return {
    datasetId: loaded.data.dataset.id,
    objectiveStatus,
    overallStatus,
    criticalFailures,
    requiredHumanCriteriaPending,
    assertionSummary: {
      passed: countStatuses(assertionStatuses, 'passed'),
      failed: countStatuses(assertionStatuses, 'failed'),
      notEvaluated: countStatuses(assertionStatuses, 'not_evaluated'),
    },
    criterionSummary: {
      passed: countStatuses(criterionStatuses, 'passed'),
      failed: countStatuses(criterionStatuses, 'failed'),
      notEvaluated: countStatuses(criterionStatuses, 'not_evaluated'),
      notApplicable: countStatuses(criterionStatuses, 'not_applicable'),
    },
    ...(rawScore === undefined
      ? {}
      : {
          objectiveScore: {
            raw: rawScore,
            final: criticalFailures > 0 ? Math.min(rawScore, 3) : rawScore,
            partial: scorePartial,
          },
        }),
    scenarios,
  }
}
