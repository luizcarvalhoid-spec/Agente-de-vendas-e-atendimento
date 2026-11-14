import { z } from 'zod'

export const EVAL_REGRESSION_REPORT_VERSION = 1 as const

const identifierSchema = z.string().trim().min(1).max(200)
const scoreSchema = z.number().finite().min(1).max(10)
const assertionStatusSchema = z.enum([
  'passed',
  'failed',
  'not_evaluated',
])

export const evalRegressionResultSchema = z.enum([
  'no_regressions',
  'known_failures_only',
  'regressions_detected',
  'scoring_inconsistency',
  'technical_failure',
  'incompatible',
])

const compatibilityIssueSchema = z
  .object({
    code: z.enum([
      'dataset_id',
      'dataset_version',
      'dataset_fingerprint',
      'catalog_fingerprint',
      'faq_fingerprint',
      'report_version',
      'evaluation_engine',
      'execution_mode',
      'scope',
      'scenario_set',
      'assertion_added',
      'assertion_removed',
      'assertion_modified',
      'duplicate_scenario',
      'duplicate_turn',
      'duplicate_assertion',
      'baseline_reference',
    ]),
    detail: z.string().min(1).max(1_000),
    scenarioId: identifierSchema.optional(),
    assertionId: identifierSchema.optional(),
  })
  .strict()

const technicalProblemSchema = z
  .object({
    code: z.enum([
      'coverage_reduced',
      'scenario_technical_failure',
      'turn_not_executed',
      'turn_technical_failure',
      'report_technical_failure',
    ]),
    detail: z.string().min(1).max(1_000),
    scenarioId: identifierSchema.optional(),
    turn: z.number().int().nonnegative().optional(),
  })
  .strict()

const scoreSnapshotSchema = z
  .object({
    raw: scoreSchema,
    final: scoreSchema,
    partial: z.boolean(),
    criticalFailures: z.number().int().nonnegative(),
  })
  .strict()

const scoreComparisonSchema = z
  .object({
    baseline: scoreSnapshotSchema.optional(),
    current: scoreSnapshotSchema.optional(),
    rawDelta: z.number().finite().min(-9).max(9).optional(),
    finalDelta: z.number().finite().min(-9).max(9).optional(),
    comparable: z.boolean(),
  })
  .strict()

const scoringIssueSchema = z
  .object({
    code: z.enum([
      'score_changed_without_objective_transition',
      'score_direction_unexplained',
      'critical_failure_count_inconsistent',
    ]),
    scope: z.enum(['dataset', 'scenario']),
    scenarioId: identifierSchema.optional(),
    detail: z.string().min(1).max(1_000),
  })
  .strict()

const assertionComparisonSchema = z
  .object({
    scenarioId: identifierSchema,
    turn: z.number().int().nonnegative(),
    assertionId: identifierSchema,
    criterionId: identifierSchema,
    type: identifierSchema,
    severity: z.enum(['low', 'medium', 'high', 'critical']),
    baselineStatus: assertionStatusSchema,
    currentStatus: assertionStatusSchema,
    classification: z.enum([
      'regression',
      'evidence_loss',
      'improvement',
      'known_failure',
      'newly_detected_failure',
      'unchanged',
    ]),
    reason: z.string().min(1).max(1_000),
    newCriticalFailure: z.boolean(),
  })
  .strict()

const scenarioComparisonSchema = z
  .object({
    scenarioId: identifierSchema,
    baselineTechnicalStatus: z.enum([
      'completed',
      'technical_failure',
      'not_executed',
    ]),
    currentTechnicalStatus: z.enum([
      'completed',
      'technical_failure',
      'not_executed',
    ]),
    baselineCriticalFailures: z.number().int().nonnegative(),
    currentCriticalFailures: z.number().int().nonnegative(),
    score: scoreComparisonSchema,
    assertions: z.array(assertionComparisonSchema).max(500),
  })
  .strict()

export const evalRegressionReportSchema = z
  .object({
    regressionReportVersion: z.literal(EVAL_REGRESSION_REPORT_VERSION),
    result: evalRegressionResultSchema,
    baseline: z
      .object({
        id: identifierSchema,
        datasetId: identifierSchema,
        datasetVersion: identifierSchema,
        datasetFingerprint: z.string().min(1).max(100),
      })
      .strict(),
    current: z
      .object({
        datasetId: identifierSchema,
        datasetVersion: identifierSchema,
        datasetFingerprint: z.string().min(1).max(100),
        reportVersion: z.number().int().positive(),
        evaluationEngine: identifierSchema,
        requiredHumanCriteriaPending: z.number().int().nonnegative(),
      })
      .strict(),
    compatibility: z
      .object({
        status: z.enum(['compatible', 'incompatible']),
        issues: z.array(compatibilityIssueSchema).max(1_000),
      })
      .strict(),
    coverage: z
      .object({
        baselineScope: z.enum(['full_dataset', 'selected_scenarios']),
        currentScope: z.enum(['full_dataset', 'selected_scenarios']),
        baselineComplete: z.boolean(),
        currentComplete: z.boolean(),
        baselineScenarioIds: z.array(identifierSchema).max(1_000),
        currentScenarioIds: z.array(identifierSchema).max(1_000),
        missingScenarioIds: z.array(identifierSchema).max(1_000),
        excludedScenarioIds: z.array(identifierSchema).max(1_000),
      })
      .strict(),
    summary: z
      .object({
        regressions: z.number().int().nonnegative(),
        evidenceLosses: z.number().int().nonnegative(),
        improvements: z.number().int().nonnegative(),
        knownFailures: z.number().int().nonnegative(),
        newlyDetectedFailures: z.number().int().nonnegative(),
        unchanged: z.number().int().nonnegative(),
        newCriticalFailures: z.number().int().nonnegative(),
        technicalProblems: z.number().int().nonnegative(),
        scoringInconsistencies: z.number().int().nonnegative(),
      })
      .strict(),
    score: scoreComparisonSchema,
    technicalProblems: z.array(technicalProblemSchema).max(1_000),
    scoringIssues: z.array(scoringIssueSchema).max(1_000),
    scenarios: z.array(scenarioComparisonSchema).max(1_000),
    limitations: z.array(z.string().min(1).max(1_000)).min(1).max(20),
  })
  .strict()

export type EvalRegressionReport = z.infer<
  typeof evalRegressionReportSchema
>
export type EvalRegressionResult = z.infer<
  typeof evalRegressionResultSchema
>
