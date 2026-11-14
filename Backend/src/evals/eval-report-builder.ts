import type { EvalCase } from './eval-dataset-schema.js'
import type { LoadedEvalDataset } from './eval-loader.js'
import {
  EVAL_REPORT_ENGINE,
  EVAL_REPORT_FORMAT_VERSION,
  evalReportSchema,
  type EvalReport,
  type EvalReportAssertion,
} from './eval-report-schema.js'
import { sanitizeEvalText } from './offline-eval-sanitization.js'
import type {
  EvalScenarioExecution,
  OfflineEvalExecution,
} from './offline-eval-runner.js'

export interface BuildEvalReportOptions {
  readonly generatedAt?: string
}

export const EVAL_REPORT_LIMITATIONS = [
  'A execução offline usa um modelo determinístico e não comprova o comportamento de modelos externos.',
  'Critérios subjetivos obrigatórios permanecem pendentes de avaliação humana.',
  'Assertions determinísticas não comprovam, isoladamente, naturalidade, empatia ou correção semântica geral.',
  'Mensagens completas, argumentos e resultados brutos de ferramentas são omitidos por minimização de dados.',
] as const

function removeAbsolutePaths(value: string) {
  return value
    .replace(
      /[A-Za-z]:[\\/](?:[^<>:"|?*\r\n]+[\\/])*[^<>:"|?*\r\n\s]+/g,
      '[LOCAL_PATH_REDACTED]',
    )
    .replace(
      /(?<![:\w])\/(?:[^/\s]+\/)*[^/\s]+/g,
      '[LOCAL_PATH_REDACTED]',
    )
}

export function sanitizeEvalReportText(value: string) {
  return removeAbsolutePaths(sanitizeEvalText(value))
}

function sanitizeEvidenceReference(value: string) {
  const sanitized = sanitizeEvalReportText(value)
  return /^[a-z][A-Za-z0-9_-]*(?:\.[A-Za-z0-9_-]+)+$/.test(sanitized)
    ? sanitized
    : 'evidence.redacted'
}

function reportAssertion(
  assertion: NonNullable<
    OfflineEvalExecution['evaluation']
  >['scenarios'][number]['assertionResults'][number],
): EvalReportAssertion {
  return {
    assertionId: sanitizeEvalReportText(assertion.assertionId),
    criterionId: sanitizeEvalReportText(assertion.criterionId),
    type: assertion.type,
    severity: assertion.severity,
    status: assertion.status,
    reason: sanitizeEvalReportText(assertion.reason),
    evidenceReferences: [
      ...new Set(
        assertion.evidenceReferences.map(sanitizeEvidenceReference),
      ),
    ],
  }
}

function buildScenario(
  scenario: EvalCase,
  execution: EvalScenarioExecution | undefined,
  evaluation: NonNullable<
    OfflineEvalExecution['evaluation']
  >['scenarios'][number],
): EvalReport['scenarios'][number] {
  const assertionById = new Map(
    evaluation.assertionResults.map((assertion) => [
      assertion.assertionId,
      assertion,
    ]),
  )
  const assertionsInDatasetOrder = scenario.assertions.map((assertion) => {
    const result = assertionById.get(assertion.id)
    if (result === undefined) {
      throw new TypeError(
        `A avaliação não contém a assertion ${assertion.id}.`,
      )
    }
    return result
  })
  const criterionById = new Map(
    evaluation.criterionResults.map((criterion) => [
      criterion.criterionId,
      criterion,
    ]),
  )

  return {
    id: scenario.id,
    category: scenario.category,
    difficulty: scenario.difficulty,
    severity: scenario.severity,
    technicalStatus: execution?.technicalStatus ?? 'not_executed',
    objectiveStatus: evaluation.objectiveStatus,
    overallStatus: evaluation.overallStatus,
    criticalFailures: evaluation.criticalFailures,
    requiredHumanCriteriaPending:
      evaluation.requiredHumanCriteriaPending,
    ...(evaluation.objectiveScore === undefined
      ? {}
      : { objectiveScore: { ...evaluation.objectiveScore } }),
    criteria: scenario.quality_criteria.map((criterion) => {
      const result = criterionById.get(criterion.id)
      if (result === undefined) {
        throw new TypeError(
          `A avaliação não contém o critério ${criterion.id}.`,
        )
      }
      return {
        criterionId: sanitizeEvalReportText(result.criterionId),
        criterion: result.criterion,
        kind: result.kind,
        applicability: result.applicability,
        status: result.status,
        humanReviewPending:
          result.kind === 'subjective' &&
          result.applicability === 'required' &&
          result.status === 'not_evaluated',
        assertionIds: result.assertionIds.map(sanitizeEvalReportText),
        ...(result.weight === undefined ? {} : { weight: result.weight }),
        ...(result.score === undefined ? {} : { score: result.score }),
        partial: result.partial,
      }
    }),
    turns: scenario.input.turns.map((_turn, index) => {
      const turnExecution = execution?.turns.find(
        (turn) => turn.turn === index,
      )
      return {
        index,
        scenarioId: scenario.id,
        technicalStatus:
          turnExecution?.technicalStatus ?? 'not_executed',
        ...(turnExecution?.response === undefined
          ? {}
          : { responseType: turnExecution.response.type }),
        ...(turnExecution?.error === undefined
          ? {}
          : {
              technicalErrorCode: sanitizeEvalReportText(
                turnExecution.error.code,
              ),
            }),
        assertions: assertionsInDatasetOrder
          .filter((assertion) => assertion.turn === index)
          .map(reportAssertion),
      }
    }),
  }
}

export function buildEvalReport(
  loaded: LoadedEvalDataset,
  execution: OfflineEvalExecution,
  options: BuildEvalReportOptions = {},
): EvalReport {
  const evaluation = execution.evaluation
  if (evaluation === undefined) {
    throw new TypeError(
      'A geração de relatório exige uma execução com avaliação objetiva.',
    )
  }
  if (
    execution.dataset.id !== loaded.data.dataset.id ||
    execution.dataset.version !== loaded.data.dataset.version ||
    evaluation.datasetId !== loaded.data.dataset.id
  ) {
    throw new TypeError('Dataset e avaliação não correspondem entre si.')
  }

  const datasetCases = new Map(
    loaded.data.cases.map((scenario) => [scenario.id, scenario]),
  )
  const scenarioExecutions = new Map(
    execution.scenarios.map((scenario) => [scenario.scenarioId, scenario]),
  )
  const scenarioEvaluations = new Map(
    evaluation.scenarios.map((scenario) => [scenario.scenarioId, scenario]),
  )
  const scenarios = evaluation.coverage.expectedScenarioIds.map(
    (scenarioId) => {
      const scenario = datasetCases.get(scenarioId)
      const scenarioEvaluation = scenarioEvaluations.get(scenarioId)
      if (scenario === undefined || scenarioEvaluation === undefined) {
        throw new TypeError(
          `O relatório não encontrou o cenário avaliado ${scenarioId}.`,
        )
      }
      return buildScenario(
        scenario,
        scenarioExecutions.get(scenarioId),
        scenarioEvaluation,
      )
    },
  )

  return evalReportSchema.parse({
    reportVersion: EVAL_REPORT_FORMAT_VERSION,
    dataset: {
      id: loaded.data.dataset.id,
      version: loaded.data.dataset.version,
    },
    execution: {
      mode: 'offline',
      evaluationEngine: EVAL_REPORT_ENGINE,
      ...(options.generatedAt === undefined
        ? {}
        : { generatedAt: options.generatedAt }),
    },
    coverage: {
      scope: evaluation.coverage.scope,
      completeForScope: evaluation.coverage.completeForScope,
      datasetCoverage: evaluation.coverage.datasetCoverage,
      expectedScenarioIds: [...evaluation.coverage.expectedScenarioIds],
      evaluatedScenarioIds: [...evaluation.coverage.evaluatedScenarioIds],
      missingScenarioIds: [...evaluation.coverage.missingScenarioIds],
      excludedScenarioIds: [...evaluation.coverage.excludedScenarioIds],
    },
    summary: {
      scenarios: {
        expected: evaluation.coverage.expectedScenarioIds.length,
        evaluated: evaluation.coverage.evaluatedScenarioIds.length,
        completed: execution.summary.completed,
        technicalFailures: execution.summary.technicalFailures,
        notExecuted: evaluation.coverage.missingScenarioIds.length,
      },
      assertions: { ...evaluation.assertionSummary },
      criteria: { ...evaluation.criterionSummary },
      criticalFailures: evaluation.criticalFailures,
      requiredHumanCriteriaPending:
        evaluation.requiredHumanCriteriaPending,
      objectiveStatus: evaluation.objectiveStatus,
      overallStatus: evaluation.overallStatus,
      ...(evaluation.objectiveScore === undefined
        ? {}
        : {
            objectiveScore: {
              raw: evaluation.objectiveScore.raw,
              final: evaluation.objectiveScore.final,
              partial: evaluation.objectiveScore.partial,
            },
          }),
    },
    scenarios,
    limitations: [...EVAL_REPORT_LIMITATIONS],
  })
}

export function serializeEvalReportJson(report: EvalReport) {
  return `${JSON.stringify(evalReportSchema.parse(report), null, 2)}\n`
}
