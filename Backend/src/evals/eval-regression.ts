import {
  evalBaselineSchema,
  type EvalBaseline,
  type EvalReferenceDataFingerprints,
} from './eval-baseline-schema.js'
import { fingerprintEvalDataset } from './eval-baseline.js'
import type { LoadedEvalDataset } from './eval-loader.js'
import { sanitizeEvalReportText } from './eval-report-builder.js'
import {
  evalReportSchema,
  type EvalReport,
  type EvalReportAssertion,
} from './eval-report-schema.js'
import {
  EVAL_REGRESSION_REPORT_VERSION,
  evalRegressionReportSchema,
  type EvalRegressionReport,
  type EvalRegressionResult,
} from './eval-regression-schema.js'

export const EVAL_REGRESSION_LIMITATIONS = [
  'A comparação usa resultados objetivos produzidos offline e não comprova comportamento de modelos externos.',
  'Falhas conhecidas permanecem pendentes; ausência de regressão nova não equivale à aprovação integral.',
  'Critérios humanos obrigatórios continuam separados e não são alterados pelo comparador.',
  'O comparador não recalcula assertions, pesos, notas ou vetos críticos da EVAL-04.',
] as const

type CompatibilityIssue = EvalRegressionReport['compatibility']['issues'][number]
type TechnicalProblem = EvalRegressionReport['technicalProblems'][number]
type ScoringIssue = EvalRegressionReport['scoringIssues'][number]

interface AssertionEntry {
  readonly scenarioId: string
  readonly turn: number
  readonly assertion: EvalReportAssertion
}

function sameArray(left: readonly string[], right: readonly string[]) {
  return (
    left.length === right.length &&
    left.every((value, index) => value === right[index])
  )
}

function assertionKey(entry: AssertionEntry) {
  return `${entry.scenarioId}\u0000${entry.turn}\u0000${entry.assertion.assertionId}`
}

function assertionEntries(report: EvalReport) {
  return report.scenarios.flatMap((scenario) =>
    scenario.turns.flatMap((turn) =>
      turn.assertions.map((assertion) => ({
        scenarioId: scenario.id,
        turn: turn.index,
        assertion,
      })),
    ),
  )
}

function reportIntegrityIssues(report: EvalReport) {
  const issues: CompatibilityIssue[] = []
  const scenarioIds = new Set<string>()
  const assertionIdentities = new Set<string>()
  for (const scenario of report.scenarios) {
    if (scenarioIds.has(scenario.id)) {
      issues.push(
        compatibilityIssue(
          'duplicate_scenario',
          'O relatório atual contém ID de cenário duplicado.',
          { scenarioId: scenario.id },
        ),
      )
    }
    scenarioIds.add(scenario.id)
    const turns = new Set<number>()
    for (const turn of scenario.turns) {
      if (turns.has(turn.index)) {
        issues.push(
          compatibilityIssue(
            'duplicate_turn',
            'O relatório atual contém índice de turno duplicado no cenário.',
            { scenarioId: scenario.id },
          ),
        )
      }
      turns.add(turn.index)
      for (const assertion of turn.assertions) {
        const identity = `${scenario.id}\u0000${turn.index}\u0000${assertion.assertionId}`
        if (assertionIdentities.has(identity)) {
          issues.push(
            compatibilityIssue(
              'duplicate_assertion',
              'O relatório atual contém identidade de assertion duplicada.',
              {
                scenarioId: scenario.id,
                assertionId: assertion.assertionId,
              },
            ),
          )
        }
        assertionIdentities.add(identity)
      }
    }
  }
  return issues
}

function compatibilityIssue(
  code: CompatibilityIssue['code'],
  detail: string,
  context: Pick<CompatibilityIssue, 'scenarioId' | 'assertionId'> = {},
): CompatibilityIssue {
  return {
    code,
    detail: sanitizeEvalReportText(detail),
    ...context,
  }
}

function technicalProblem(
  code: TechnicalProblem['code'],
  detail: string,
  context: Pick<TechnicalProblem, 'scenarioId' | 'turn'> = {},
): TechnicalProblem {
  return {
    code,
    detail: sanitizeEvalReportText(detail),
    ...context,
  }
}

function round(value: number) {
  return Math.round((value + Number.EPSILON) * 100) / 100
}

function datasetScoreSnapshot(report: EvalReport) {
  const score = report.summary.objectiveScore
  return score === undefined
    ? undefined
    : {
        raw: score.raw,
        final: score.final,
        partial: score.partial,
        criticalFailures: report.summary.criticalFailures,
      }
}

function scenarioScoreSnapshot(
  scenario: EvalReport['scenarios'][number] | undefined,
) {
  if (scenario?.objectiveScore === undefined) return undefined
  return {
    raw: scenario.objectiveScore.raw,
    final: scenario.objectiveScore.final,
    partial: scenario.objectiveScore.partial,
    criticalFailures: scenario.criticalFailures,
  }
}

function compareScore(
  baseline: ReturnType<typeof datasetScoreSnapshot>,
  current: ReturnType<typeof datasetScoreSnapshot>,
  comparisonAllowed: boolean,
) {
  const comparable =
    comparisonAllowed && baseline !== undefined && current !== undefined
  return {
    ...(baseline === undefined ? {} : { baseline }),
    ...(current === undefined ? {} : { current }),
    ...(comparable
      ? {
          rawDelta: round(current.raw - baseline.raw),
          finalDelta: round(current.final - baseline.final),
        }
      : {}),
    comparable,
  }
}

function scoringIssue(
  code: ScoringIssue['code'],
  scope: ScoringIssue['scope'],
  detail: string,
  scenarioId?: string,
): ScoringIssue {
  return {
    code,
    scope,
    detail: sanitizeEvalReportText(detail),
    ...(scenarioId === undefined ? {} : { scenarioId }),
  }
}

function hasCompleteScenarioObjectiveEvidence(
  scenario: EvalReport['scenarios'][number],
) {
  return (
    scenario.objectiveScore !== undefined &&
    !scenario.objectiveScore.partial &&
    scenario.turns.every((turn) =>
      turn.assertions.every((assertion) => assertion.status !== 'not_evaluated'),
    ) &&
    scenario.criteria.every(
      (criterion) =>
        criterion.kind !== 'objective' ||
        criterion.applicability === 'not_applicable' ||
        (criterion.status !== 'not_evaluated' && !criterion.partial),
    )
  )
}

function hasCompleteObjectiveEvidence(report: EvalReport) {
  return (
    report.summary.assertions.notEvaluated === 0 &&
    report.scenarios.every(hasCompleteScenarioObjectiveEvidence)
  )
}

function datasetScoreComparisonAllowed(
  comparisonBaseAllowed: boolean,
  baseline: EvalReport,
  current: EvalReport,
) {
  const baselineScore = baseline.summary.objectiveScore
  const currentScore = current.summary.objectiveScore
  if (
    !comparisonBaseAllowed ||
    baselineScore === undefined ||
    currentScore === undefined ||
    !hasCompleteObjectiveEvidence(baseline) ||
    !hasCompleteObjectiveEvidence(current)
  ) {
    return false
  }
  if (!baselineScore.partial && !currentScore.partial) return true
  return (
    baseline.coverage.scope === 'selected_scenarios' &&
    current.coverage.scope === 'selected_scenarios' &&
    baselineScore.partial &&
    currentScore.partial
  )
}

function scenarioScoreComparisonAllowed(
  comparisonBaseAllowed: boolean,
  baseline: EvalReport['scenarios'][number],
  current: EvalReport['scenarios'][number],
) {
  return (
    comparisonBaseAllowed &&
    hasCompleteScenarioObjectiveEvidence(baseline) &&
    hasCompleteScenarioObjectiveEvidence(current)
  )
}

function detectScoringIssue(
  scope: 'dataset' | 'scenario',
  score: ReturnType<typeof compareScore>,
  assertions: readonly {
    readonly classification:
      | 'regression'
      | 'evidence_loss'
      | 'improvement'
      | 'known_failure'
      | 'newly_detected_failure'
      | 'unchanged'
    readonly severity: 'low' | 'medium' | 'high' | 'critical'
    readonly baselineStatus: 'passed' | 'failed' | 'not_evaluated'
    readonly currentStatus: 'passed' | 'failed' | 'not_evaluated'
    readonly newCriticalFailure: boolean
  }[],
  scenarioId?: string,
) {
  if (!score.comparable || score.baseline === undefined || score.current === undefined) {
    return []
  }
  const issues: ScoringIssue[] = []
  const rawDelta = score.rawDelta ?? 0
  const finalDelta = score.finalDelta ?? 0
  const scoreChanged = rawDelta !== 0 || finalDelta !== 0
  const negativeTransition = assertions.some(
    (assertion) =>
      assertion.classification === 'regression' ||
      assertion.classification === 'newly_detected_failure',
  )
  const positiveTransition = assertions.some(
    (assertion) => assertion.classification === 'improvement',
  )
  if (scoreChanged) {
    const directionExplained =
      ((rawDelta < 0 || finalDelta < 0) && negativeTransition) ||
      ((rawDelta > 0 || finalDelta > 0) && positiveTransition)
    if (!directionExplained) {
      const hasObjectiveTransition = negativeTransition || positiveTransition
      issues.push(
        scoringIssue(
          hasObjectiveTransition
            ? 'score_direction_unexplained'
            : 'score_changed_without_objective_transition',
          scope,
          hasObjectiveTransition
            ? 'A direção da variação de nota não é explicada pelas transições objetivas.'
            : 'A nota mudou sem transição objetiva que justifique a variação.',
          scenarioId,
        ),
      )
    }
  }
  const criticalDelta =
    score.current.criticalFailures - score.baseline.criticalFailures
  const criticalIncreaseExplained = assertions.some(
    (assertion) => assertion.newCriticalFailure,
  )
  const criticalDecreaseExplained = assertions.some(
    (assertion) =>
      assertion.severity === 'critical' &&
      assertion.baselineStatus === 'failed' &&
      assertion.currentStatus === 'passed',
  )
  if (
    criticalDelta !== 0 &&
    !(
      (criticalDelta > 0 && criticalIncreaseExplained) ||
      (criticalDelta < 0 && criticalDecreaseExplained)
    )
  ) {
    issues.push(
      scoringIssue(
        'critical_failure_count_inconsistent',
        scope,
        'A quantidade de falhas críticas mudou sem transição crítica correspondente.',
        scenarioId,
      ),
    )
  }
  return issues
}

function classifyTransition(
  baselineStatus: EvalReportAssertion['status'],
  currentStatus: EvalReportAssertion['status'],
) {
  if (baselineStatus === 'passed' && currentStatus === 'failed') {
    return {
      classification: 'regression' as const,
      reason: 'Uma assertion anteriormente aprovada passou a falhar.',
    }
  }
  if (
    currentStatus === 'not_evaluated' &&
    baselineStatus !== 'not_evaluated'
  ) {
    return {
      classification: 'evidence_loss' as const,
      reason: 'Uma assertion anteriormente avaliável perdeu evidência conclusiva.',
    }
  }
  if (
    currentStatus === 'passed' &&
    baselineStatus !== 'passed'
  ) {
    return {
      classification: 'improvement' as const,
      reason: 'A execução atual passou uma assertion que não estava aprovada.',
    }
  }
  if (baselineStatus === 'failed' && currentStatus === 'failed') {
    return {
      classification: 'known_failure' as const,
      reason: 'A falha já existia no baseline e continua presente.',
    }
  }
  if (
    baselineStatus === 'not_evaluated' &&
    currentStatus === 'failed'
  ) {
    return {
      classification: 'newly_detected_failure' as const,
      reason: 'Nova evidência permitiu comprovar uma falha antes não avaliada.',
    }
  }
  return {
    classification: 'unchanged' as const,
    reason: 'O status objetivo permaneceu equivalente ao baseline.',
  }
}

export function compareEvalBaseline(
  baselineInput: EvalBaseline,
  loaded: LoadedEvalDataset,
  currentReportInput: EvalReport,
  referenceData: EvalReferenceDataFingerprints,
): EvalRegressionReport {
  const baseline = evalBaselineSchema.parse(baselineInput)
  const current = evalReportSchema.parse(currentReportInput)
  const reference = baseline.reference
  const currentDatasetFingerprint = fingerprintEvalDataset(loaded)
  const issues: CompatibilityIssue[] = []

  if (baseline.dataset.id !== current.dataset.id) {
    issues.push(
      compatibilityIssue('dataset_id', 'O ID do dataset atual difere do baseline.'),
    )
  }
  if (baseline.dataset.version !== current.dataset.version) {
    issues.push(
      compatibilityIssue(
        'dataset_version',
        'A versão do dataset atual difere do baseline.',
      ),
    )
  }
  if (baseline.dataset.fingerprint !== currentDatasetFingerprint) {
    issues.push(
      compatibilityIssue(
        'dataset_fingerprint',
        'O conteúdo validado do dataset mudou sem baseline equivalente.',
      ),
    )
  }
  if (
    baseline.referenceData.catalogFingerprint !==
    referenceData.catalogFingerprint
  ) {
    issues.push(
      compatibilityIssue(
        'catalog_fingerprint',
        'Os dados canônicos de catálogo diferem da referência.',
      ),
    )
  }
  if (
    baseline.referenceData.faqFingerprint !== referenceData.faqFingerprint
  ) {
    issues.push(
      compatibilityIssue(
        'faq_fingerprint',
        'Os dados canônicos de FAQ diferem da referência.',
      ),
    )
  }
  if (baseline.execution.reportVersion !== current.reportVersion) {
    issues.push(
      compatibilityIssue(
        'report_version',
        'A versão do relatório atual difere da referência.',
      ),
    )
  }
  if (
    baseline.execution.evaluationEngine !==
    current.execution.evaluationEngine
  ) {
    issues.push(
      compatibilityIssue(
        'evaluation_engine',
        'O motor de avaliação atual difere da referência.',
      ),
    )
  }
  if (baseline.execution.mode !== current.execution.mode) {
    issues.push(
      compatibilityIssue(
        'execution_mode',
        'O modo de execução atual difere da referência.',
      ),
    )
  }
  if (
    baseline.scope.kind !== current.coverage.scope ||
    !sameArray(
      baseline.scope.expectedScenarioIds,
      current.coverage.expectedScenarioIds,
    )
  ) {
    issues.push(
      compatibilityIssue(
        'scope',
        'O escopo ou a seleção de cenários atual difere do baseline.',
      ),
    )
  }

  issues.push(...reportIntegrityIssues(current))

  const baselineScenarioIds = reference.scenarios.map((scenario) => scenario.id)
  const currentScenarioIds = current.scenarios.map((scenario) => scenario.id)
  if (!sameArray(baselineScenarioIds, currentScenarioIds)) {
    issues.push(
      compatibilityIssue(
        'scenario_set',
        'O conjunto ou a ordem dos cenários do relatório mudou.',
      ),
    )
  }

  const baselineEntries = assertionEntries(reference)
  const currentEntries = assertionEntries(current)
  const baselineByKey = new Map(
    baselineEntries.map((entry) => [assertionKey(entry), entry]),
  )
  const currentByKey = new Map(
    currentEntries.map((entry) => [assertionKey(entry), entry]),
  )
  for (const entry of baselineEntries) {
    const key = assertionKey(entry)
    const candidate = currentByKey.get(key)
    if (candidate === undefined) {
      issues.push(
        compatibilityIssue(
          'assertion_removed',
          'Uma assertion do baseline não existe no relatório atual.',
          {
            scenarioId: entry.scenarioId,
            assertionId: entry.assertion.assertionId,
          },
        ),
      )
      continue
    }
    if (
      candidate.assertion.type !== entry.assertion.type ||
      candidate.assertion.severity !== entry.assertion.severity ||
      candidate.assertion.criterionId !== entry.assertion.criterionId
    ) {
      issues.push(
        compatibilityIssue(
          'assertion_modified',
          'Tipo, severidade ou critério da assertion mudou.',
          {
            scenarioId: entry.scenarioId,
            assertionId: entry.assertion.assertionId,
          },
        ),
      )
    }
  }
  for (const entry of currentEntries) {
    if (!baselineByKey.has(assertionKey(entry))) {
      issues.push(
        compatibilityIssue(
          'assertion_added',
          'O relatório atual contém assertion ausente no baseline.',
          {
            scenarioId: entry.scenarioId,
            assertionId: entry.assertion.assertionId,
          },
        ),
      )
    }
  }

  const compatible = issues.length === 0
  const technicalProblems: TechnicalProblem[] = []
  const coverageEquivalent =
    compatible &&
    reference.coverage.completeForScope &&
    current.coverage.completeForScope &&
    sameArray(
      reference.coverage.evaluatedScenarioIds,
      current.coverage.evaluatedScenarioIds,
    ) &&
    sameArray(
      reference.coverage.missingScenarioIds,
      current.coverage.missingScenarioIds,
    ) &&
    sameArray(
      reference.coverage.excludedScenarioIds,
      current.coverage.excludedScenarioIds,
    )
  if (
    !current.coverage.completeForScope ||
    current.coverage.missingScenarioIds.length > 0 ||
    current.coverage.evaluatedScenarioIds.length <
      reference.coverage.evaluatedScenarioIds.length
  ) {
    technicalProblems.push(
      technicalProblem(
        'coverage_reduced',
        'A execução atual perdeu cobertura esperada do baseline.',
      ),
    )
  }
  if (
    current.summary.scenarios.technicalFailures > 0 ||
    current.summary.scenarios.notExecuted > 0
  ) {
    technicalProblems.push(
      technicalProblem(
        'report_technical_failure',
        'O relatório atual contém falhas técnicas ou cenários não executados.',
      ),
    )
  }

  if (compatible) {
    for (const baselineScenario of reference.scenarios) {
      const currentScenario = current.scenarios.find(
        (scenario) => scenario.id === baselineScenario.id,
      )
      if (currentScenario === undefined) continue
      if (
        baselineScenario.technicalStatus === 'completed' &&
        currentScenario.technicalStatus === 'technical_failure'
      ) {
        technicalProblems.push(
          technicalProblem(
            'scenario_technical_failure',
            'Cenário antes concluído apresentou falha técnica.',
            { scenarioId: baselineScenario.id },
          ),
        )
      }
      for (const baselineTurn of baselineScenario.turns) {
        const currentTurn = currentScenario.turns.find(
          (turn) => turn.index === baselineTurn.index,
        )
        if (
          baselineTurn.technicalStatus === 'completed' &&
          currentTurn?.technicalStatus !== 'completed'
        ) {
          technicalProblems.push(
            technicalProblem(
              currentTurn?.technicalStatus === 'technical_failure'
                ? 'turn_technical_failure'
                : 'turn_not_executed',
              'Turno antes concluído não foi concluído na execução atual.',
              {
                scenarioId: baselineScenario.id,
                turn: baselineTurn.index,
              },
            ),
          )
        }
      }
    }
  }

  const aggregateScoreAllowed = datasetScoreComparisonAllowed(
    compatible && coverageEquivalent && technicalProblems.length === 0,
    reference,
    current,
  )

  const scenarios = reference.scenarios.map((baselineScenario) => {
        const currentScenario = current.scenarios.find(
          (scenario) => scenario.id === baselineScenario.id,
        )
        if (currentScenario === undefined) {
          return {
            scenarioId: baselineScenario.id,
            baselineTechnicalStatus: baselineScenario.technicalStatus,
            currentTechnicalStatus: 'not_executed' as const,
            baselineCriticalFailures: baselineScenario.criticalFailures,
            currentCriticalFailures: 0,
            score: compareScore(
              scenarioScoreSnapshot(baselineScenario),
              undefined,
              false,
            ),
            assertions: [],
          }
        }
        const scenarioAssertions = compatible
          ? baselineEntries
              .filter((entry) => entry.scenarioId === baselineScenario.id)
              .map((entry) => {
                const currentEntry = currentByKey.get(assertionKey(entry))
                if (currentEntry === undefined) return undefined
                const transition = classifyTransition(
                  entry.assertion.status,
                  currentEntry.assertion.status,
                )
                return {
                  scenarioId: entry.scenarioId,
                  turn: entry.turn,
                  assertionId: entry.assertion.assertionId,
                  criterionId: entry.assertion.criterionId,
                  type: entry.assertion.type,
                  severity: entry.assertion.severity,
                  baselineStatus: entry.assertion.status,
                  currentStatus: currentEntry.assertion.status,
                  ...transition,
                  newCriticalFailure:
                    entry.assertion.severity === 'critical' &&
                    entry.assertion.status !== 'failed' &&
                    currentEntry.assertion.status === 'failed',
                }
              })
              .filter((item) => item !== undefined)
          : []
        return {
          scenarioId: baselineScenario.id,
          baselineTechnicalStatus: baselineScenario.technicalStatus,
          currentTechnicalStatus: currentScenario.technicalStatus,
          baselineCriticalFailures: baselineScenario.criticalFailures,
          currentCriticalFailures: currentScenario.criticalFailures,
          score: compareScore(
            scenarioScoreSnapshot(baselineScenario),
            scenarioScoreSnapshot(currentScenario),
            scenarioScoreComparisonAllowed(
              coverageEquivalent &&
                baselineScenario.technicalStatus === 'completed' &&
                currentScenario.technicalStatus === 'completed' &&
                currentScenario.turns.every(
                  (turn) => turn.technicalStatus === 'completed',
                ),
              baselineScenario,
              currentScenario,
            ),
          ),
          assertions: scenarioAssertions,
        }
      })

  const assertionComparisons = scenarios.flatMap(
    (scenario) => scenario.assertions,
  )
  const aggregateScore = compareScore(
    datasetScoreSnapshot(reference),
    datasetScoreSnapshot(current),
    aggregateScoreAllowed,
  )
  const scoringIssues = [
    ...detectScoringIssue(
      'dataset',
      aggregateScore,
      assertionComparisons,
    ),
    ...scenarios.flatMap((scenario) =>
      detectScoringIssue(
        'scenario',
        scenario.score,
        scenario.assertions,
        scenario.scenarioId,
      ),
    ),
  ]
  const count = (classification: typeof assertionComparisons[number]['classification']) =>
    assertionComparisons.filter(
      (assertion) => assertion.classification === classification,
    ).length
  const summary = {
    regressions: count('regression'),
    evidenceLosses: count('evidence_loss'),
    improvements: count('improvement'),
    knownFailures: count('known_failure'),
    newlyDetectedFailures: count('newly_detected_failure'),
    unchanged: count('unchanged'),
    newCriticalFailures: assertionComparisons.filter(
      (assertion) => assertion.newCriticalFailure,
    ).length,
    technicalProblems: technicalProblems.length,
    scoringInconsistencies: scoringIssues.length,
  }
  const result = !compatible
    ? ('incompatible' as const)
    : technicalProblems.length > 0
      ? ('technical_failure' as const)
      : scoringIssues.length > 0
        ? ('scoring_inconsistency' as const)
      : summary.regressions > 0 ||
          summary.evidenceLosses > 0 ||
          summary.newlyDetectedFailures > 0 ||
          summary.newCriticalFailures > 0
        ? ('regressions_detected' as const)
        : summary.knownFailures > 0
          ? ('known_failures_only' as const)
          : ('no_regressions' as const)

  return evalRegressionReportSchema.parse({
    regressionReportVersion: EVAL_REGRESSION_REPORT_VERSION,
    result,
    baseline: {
      id: baseline.baselineId,
      datasetId: baseline.dataset.id,
      datasetVersion: baseline.dataset.version,
      datasetFingerprint: baseline.dataset.fingerprint,
    },
    current: {
      datasetId: current.dataset.id,
      datasetVersion: current.dataset.version,
      datasetFingerprint: currentDatasetFingerprint,
      reportVersion: current.reportVersion,
      evaluationEngine: current.execution.evaluationEngine,
      requiredHumanCriteriaPending:
        current.summary.requiredHumanCriteriaPending,
    },
    compatibility: {
      status: compatible ? 'compatible' : 'incompatible',
      issues,
    },
    coverage: {
      baselineScope: reference.coverage.scope,
      currentScope: current.coverage.scope,
      baselineComplete: reference.coverage.completeForScope,
      currentComplete: current.coverage.completeForScope,
      baselineScenarioIds: [...reference.coverage.expectedScenarioIds],
      currentScenarioIds: [...current.coverage.evaluatedScenarioIds],
      missingScenarioIds: [...current.coverage.missingScenarioIds],
      excludedScenarioIds: [...current.coverage.excludedScenarioIds],
    },
    summary,
    score: aggregateScore,
    technicalProblems,
    scoringIssues,
    scenarios,
    limitations: [...EVAL_REGRESSION_LIMITATIONS],
  })
}

export function serializeEvalRegressionReport(
  reportInput: EvalRegressionReport,
) {
  return `${JSON.stringify(evalRegressionReportSchema.parse(reportInput), null, 2)}\n`
}

export function evalRegressionExitCode(result: EvalRegressionResult) {
  if (
    result === 'regressions_detected' ||
    result === 'scoring_inconsistency'
  ) {
    return 2
  }
  if (result === 'technical_failure') return 3
  if (result === 'incompatible') return 4
  return 0
}
