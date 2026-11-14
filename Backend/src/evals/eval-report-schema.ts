import { z } from 'zod'

export const EVAL_REPORT_FORMAT_VERSION = 1 as const
export const EVAL_REPORT_ENGINE = 'deterministic-assertion-engine-v1' as const

const identifierSchema = z.string().trim().min(1).max(128)
const scoreSchema = z.number().finite().min(1).max(10)
const technicalStatusSchema = z.enum([
  'completed',
  'technical_failure',
  'not_executed',
])
const assertionStatusSchema = z.enum([
  'passed',
  'failed',
  'not_evaluated',
])
const criterionStatusSchema = z.enum([
  'passed',
  'failed',
  'not_evaluated',
  'not_applicable',
])
const objectiveStatusSchema = z.enum([
  'passed',
  'failed',
  'not_evaluated',
  'failed_critical',
])
const overallStatusSchema = z.enum([
  'passed',
  'failed',
  'needs_review',
  'failed_critical',
])

const objectiveScoreSchema = z
  .object({
    raw: scoreSchema,
    final: scoreSchema,
    partial: z.boolean(),
  })
  .strict()

const assertionResultSchema = z
  .object({
    assertionId: identifierSchema,
    criterionId: identifierSchema,
    type: identifierSchema,
    severity: z.enum(['low', 'medium', 'high', 'critical']),
    status: assertionStatusSchema,
    reason: z.string().min(1).max(2_000),
    evidenceReferences: z.array(z.string().min(1).max(500)).max(50),
  })
  .strict()

const criterionResultSchema = z
  .object({
    criterionId: identifierSchema,
    criterion: z.enum([
      'factual_accuracy',
      'safety',
      'context_continuity',
      'naturalness',
      'clarity_utility',
      'consultative_quality',
    ]),
    kind: z.enum(['objective', 'subjective']),
    applicability: z.enum(['required', 'optional', 'not_applicable']),
    status: criterionStatusSchema,
    humanReviewPending: z.boolean(),
    assertionIds: z.array(identifierSchema).max(200),
    weight: z.number().finite().positive().max(100).optional(),
    score: scoreSchema.optional(),
    partial: z.boolean(),
  })
  .strict()

const turnResultSchema = z
  .object({
    index: z.number().int().nonnegative(),
    scenarioId: identifierSchema,
    technicalStatus: technicalStatusSchema,
    responseType: z
      .enum(['text', 'recommendation', 'comparison'])
      .optional(),
    technicalErrorCode: identifierSchema.optional(),
    assertions: z.array(assertionResultSchema).max(200),
  })
  .strict()

const scenarioResultSchema = z
  .object({
    id: identifierSchema,
    category: identifierSchema,
    difficulty: z.enum(['easy', 'medium', 'hard', 'adversarial']),
    severity: z.enum(['low', 'medium', 'high', 'critical']),
    technicalStatus: technicalStatusSchema,
    objectiveStatus: objectiveStatusSchema,
    overallStatus: overallStatusSchema,
    criticalFailures: z.number().int().nonnegative(),
    requiredHumanCriteriaPending: z.number().int().nonnegative(),
    objectiveScore: objectiveScoreSchema.optional(),
    criteria: z.array(criterionResultSchema).max(100),
    turns: z.array(turnResultSchema).max(50),
  })
  .strict()

export const evalReportSchema = z
  .object({
    reportVersion: z.literal(EVAL_REPORT_FORMAT_VERSION),
    dataset: z
      .object({
        id: identifierSchema,
        version: z.string().trim().min(1).max(128),
      })
      .strict(),
    execution: z
      .object({
        mode: z.literal('offline'),
        evaluationEngine: z.literal(EVAL_REPORT_ENGINE),
        generatedAt: z.string().datetime({ offset: true }).optional(),
      })
      .strict(),
    coverage: z
      .object({
        scope: z.enum(['full_dataset', 'selected_scenarios']),
        completeForScope: z.boolean(),
        datasetCoverage: z.enum(['complete', 'partial']),
        expectedScenarioIds: z.array(identifierSchema).max(1_000),
        evaluatedScenarioIds: z.array(identifierSchema).max(1_000),
        missingScenarioIds: z.array(identifierSchema).max(1_000),
        excludedScenarioIds: z.array(identifierSchema).max(1_000),
      })
      .strict(),
    summary: z
      .object({
        scenarios: z
          .object({
            expected: z.number().int().nonnegative(),
            evaluated: z.number().int().nonnegative(),
            completed: z.number().int().nonnegative(),
            technicalFailures: z.number().int().nonnegative(),
            notExecuted: z.number().int().nonnegative(),
          })
          .strict(),
        assertions: z
          .object({
            passed: z.number().int().nonnegative(),
            failed: z.number().int().nonnegative(),
            notEvaluated: z.number().int().nonnegative(),
          })
          .strict(),
        criteria: z
          .object({
            passed: z.number().int().nonnegative(),
            failed: z.number().int().nonnegative(),
            notEvaluated: z.number().int().nonnegative(),
            notApplicable: z.number().int().nonnegative(),
          })
          .strict(),
        criticalFailures: z.number().int().nonnegative(),
        requiredHumanCriteriaPending: z.number().int().nonnegative(),
        objectiveStatus: objectiveStatusSchema,
        overallStatus: overallStatusSchema,
        objectiveScore: objectiveScoreSchema.optional(),
      })
      .strict(),
    scenarios: z.array(scenarioResultSchema).max(1_000),
    limitations: z.array(z.string().min(1).max(1_000)).min(1).max(20),
  })
  .strict()

export type EvalReport = z.infer<typeof evalReportSchema>
export type EvalReportAssertion = z.infer<typeof assertionResultSchema>
