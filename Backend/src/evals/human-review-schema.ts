import { z } from 'zod'

import { chatRequestSchema } from '../contracts/chat.js'
import { evalCanonicalCriterionSchema } from './eval-dataset-schema.js'
import { humanEvalRubricDimensionSchema } from './human-eval-rubric-schema.js'

export const HUMAN_CONVERSATION_SAMPLE_VERSION = 1 as const
export const HUMAN_REVIEW_PACKAGE_VERSION = 1 as const
export const HUMAN_REVIEW_TEMPLATE_VERSION = 1 as const
export const HUMAN_REVIEW_SUBMISSION_VERSION = 1 as const
export const HUMAN_REVIEW_SUMMARY_VERSION = 1 as const

const identifierSchema = z
  .string()
  .trim()
  .min(1)
  .max(128)
  .regex(/^[a-z0-9]+(?:[._-][a-z0-9]+)*$/)
const semanticVersionSchema = z.string().regex(/^\d+\.\d+\.\d+$/)
const reviewTextSchema = z.string().trim().min(1).max(3_000)

export const humanConversationOriginSchema = z.discriminatedUnion('kind', [
  z
    .object({
      kind: z.literal('manual_real_test'),
      attestation: z.literal('authorized_sanitized_test_transcript'),
      performanceEvidence: z.literal('declared_real_test'),
    })
    .strict(),
  z
    .object({
      kind: z.literal('manually_simulated'),
      attestation: z.literal('synthetic_conversation'),
      performanceEvidence: z.literal('not_real_performance'),
    })
    .strict(),
  z
    .object({
      kind: z.literal('deterministic_offline'),
      attestation: z.literal('offline_runner_output'),
      performanceEvidence: z.literal('not_real_performance'),
    })
    .strict(),
  z
    .object({
      kind: z.literal('unverified'),
      attestation: z.literal('origin_not_proven'),
      performanceEvidence: z.literal('not_real_performance'),
    })
    .strict(),
])

const sampleTurnSchema = z
  .object({
    index: z.number().int().nonnegative(),
    user: chatRequestSchema.shape.message,
    assistant: z.string().trim().min(1).max(4_000),
  })
  .strict()

export const humanConversationSampleSchema = z
  .object({
    sampleVersion: z.literal(HUMAN_CONVERSATION_SAMPLE_VERSION),
    sample: z
      .object({
        id: identifierSchema,
        datasetId: identifierSchema,
        datasetVersion: semanticVersionSchema,
        scenarioId: identifierSchema,
        rubricId: identifierSchema,
        rubricVersion: semanticVersionSchema,
        origin: humanConversationOriginSchema,
      })
      .strict(),
    turns: z.array(sampleTurnSchema).min(1).max(50),
  })
  .strict()
  .superRefine((sample, context) => {
    for (const [index, turn] of sample.turns.entries()) {
      if (turn.index !== index) {
        context.addIssue({
          code: 'custom',
          path: ['turns', index, 'index'],
          message: 'Os turnos devem ser contínuos e começar em zero.',
        })
      }
    }
  })

const reviewScopeSchema = z
  .object({
    turns: z.array(z.number().int().nonnegative()).min(1).max(50),
  })
  .strict()

const packageReviewItemSchema = z
  .object({
    evaluationId: identifierSchema,
    criterionId: identifierSchema,
    criterion: evalCanonicalCriterionSchema,
    applicability: z.enum(['required', 'optional']),
    rubricDimensionIds: z.array(identifierSchema).min(1).max(10),
    scope: reviewScopeSchema,
    status: z.literal('not_evaluated'),
  })
  .strict()

export const humanReviewPackageSchema = z
  .object({
    packageVersion: z.literal(HUMAN_REVIEW_PACKAGE_VERSION),
    packageStatus: z.literal('prepared_not_evaluated'),
    sample: z
      .object({
        id: identifierSchema,
        datasetId: identifierSchema,
        datasetVersion: semanticVersionSchema,
        scenarioId: identifierSchema,
        origin: humanConversationOriginSchema,
      })
      .strict(),
    rubric: z
      .object({
        id: identifierSchema,
        version: semanticVersionSchema,
      })
      .strict(),
    rubricDimensions: z.array(humanEvalRubricDimensionSchema).min(1).max(20),
    turns: z.array(sampleTurnSchema).min(1).max(50),
    reviewItems: z.array(packageReviewItemSchema).min(1).max(100),
    instructions: z
      .object({
        scoreMinimum: z.literal(1),
        scoreMaximum: z.literal(10),
        completedRequiresJustification: z.literal(true),
        completedRequiresEvidence: z.literal(true),
        unobservableStatus: z.literal('not_evaluated'),
        nonApplicableStatus: z.literal('not_applicable'),
        safetyAlertsRequireRationale: z.literal(true),
      })
      .strict(),
    warnings: z.array(z.string().trim().min(1).max(1_000)).min(1).max(20),
  })
  .strict()
  .superRefine((reviewPackage, context) => {
    const ids = new Set<string>()
    const criteria = new Set<string>()
    for (const [index, item] of reviewPackage.reviewItems.entries()) {
      if (ids.has(item.evaluationId)) {
        context.addIssue({
          code: 'custom',
          path: ['reviewItems', index, 'evaluationId'],
          message: 'evaluationId duplicado.',
        })
      }
      if (criteria.has(item.criterionId)) {
        context.addIssue({
          code: 'custom',
          path: ['reviewItems', index, 'criterionId'],
          message: 'Critério duplicado no pacote.',
        })
      }
      ids.add(item.evaluationId)
      criteria.add(item.criterionId)
    }
  })

const evidenceReferenceSchema = z
  .object({
    turn: z.number().int().nonnegative(),
    role: z.enum(['user', 'assistant']),
  })
  .strict()

const reviewTemplateItemSchema = z
  .object({
    evaluationId: identifierSchema,
    criterionId: identifierSchema,
    criterion: evalCanonicalCriterionSchema,
    scope: reviewScopeSchema,
    status: z.null(),
    score: z.null(),
    justification: z.literal(''),
    evidenceReferences: z.array(evidenceReferenceSchema).length(0),
    safetyAlert: z.object({ flagged: z.literal(false) }).strict(),
  })
  .strict()

export const humanReviewTemplateSchema = z
  .object({
    templateVersion: z.literal(HUMAN_REVIEW_TEMPLATE_VERSION),
    templateStatus: z.literal('template_not_submitted'),
    instructions: z.literal(
      'Substitua os campos nulos e vazios; depois valide como humanReviewSubmission.',
    ),
    submission: z
      .object({
        id: z.null(),
        purpose: z.literal('human_review'),
        sampleId: identifierSchema,
        datasetId: identifierSchema,
        datasetVersion: semanticVersionSchema,
        scenarioId: identifierSchema,
        rubricId: identifierSchema,
        rubricVersion: semanticVersionSchema,
        reviewerId: z.null(),
      })
      .strict(),
    judgements: z.array(reviewTemplateItemSchema).min(1).max(100),
  })
  .strict()

const safetyAlertSchema = z.discriminatedUnion('flagged', [
  z.object({ flagged: z.literal(false) }).strict(),
  z
    .object({
      flagged: z.literal(true),
      rationale: reviewTextSchema,
    })
    .strict(),
])

const judgementBase = {
  evaluationId: identifierSchema,
  criterionId: identifierSchema,
  criterion: evalCanonicalCriterionSchema,
  scope: reviewScopeSchema,
  evidenceReferences: z.array(evidenceReferenceSchema).max(50),
  safetyAlert: safetyAlertSchema,
} as const

export const humanReviewJudgementSchema = z.discriminatedUnion('status', [
  z
    .object({
      ...judgementBase,
      status: z.literal('evaluated'),
      score: z.number().int().min(1).max(10),
      justification: reviewTextSchema,
    })
    .strict()
    .refine((item) => item.evidenceReferences.length > 0, {
      path: ['evidenceReferences'],
      message: 'Uma avaliação concluída exige evidência observável.',
    }),
  z
    .object({
      ...judgementBase,
      status: z.literal('not_evaluated'),
      justification: reviewTextSchema,
    })
    .strict(),
  z
    .object({
      ...judgementBase,
      status: z.literal('not_applicable'),
      justification: reviewTextSchema,
    })
    .strict(),
])

export const humanReviewSubmissionSchema = z
  .object({
    submissionVersion: z.literal(HUMAN_REVIEW_SUBMISSION_VERSION),
    submission: z
      .object({
        id: identifierSchema,
        purpose: z.enum(['human_review', 'synthetic_validation_fixture']),
        sampleId: identifierSchema,
        datasetId: identifierSchema,
        datasetVersion: semanticVersionSchema,
        scenarioId: identifierSchema,
        rubricId: identifierSchema,
        rubricVersion: semanticVersionSchema,
        reviewerId: z
          .string()
          .regex(/^reviewer-[a-z0-9]+(?:-[a-z0-9]+)*$/)
          .max(80),
      })
      .strict(),
    judgements: z.array(humanReviewJudgementSchema).min(1).max(100),
  })
  .strict()
  .superRefine((review, context) => {
    const evaluationIds = new Set<string>()
    const criterionIds = new Set<string>()
    for (const [index, judgement] of review.judgements.entries()) {
      if (evaluationIds.has(judgement.evaluationId)) {
        context.addIssue({
          code: 'custom',
          path: ['judgements', index, 'evaluationId'],
          message: 'evaluationId duplicado.',
        })
      }
      if (criterionIds.has(judgement.criterionId)) {
        context.addIssue({
          code: 'custom',
          path: ['judgements', index, 'criterionId'],
          message: 'Critério duplicado na submissão.',
        })
      }
      evaluationIds.add(judgement.evaluationId)
      criterionIds.add(judgement.criterionId)
    }
  })

const criterionSummarySchema = z
  .object({
    criterionId: identifierSchema,
    criterion: evalCanonicalCriterionSchema,
    reviewCount: z.number().int().nonnegative(),
    evaluatedCount: z.number().int().nonnegative(),
    notEvaluatedCount: z.number().int().nonnegative(),
    notApplicableCount: z.number().int().nonnegative(),
    scores: z.array(z.number().int().min(1).max(10)).max(100),
    descriptiveStatistics: z
      .object({
        minimum: z.number().int().min(1).max(10),
        maximum: z.number().int().min(1).max(10),
        mean: z.number().finite().min(1).max(10),
      })
      .strict()
      .optional(),
    adjudicationStatus: z.enum(['not_needed', 'pending']),
  })
  .strict()

export const humanReviewSummarySchema = z
  .object({
    summaryVersion: z.literal(HUMAN_REVIEW_SUMMARY_VERSION),
    sampleId: identifierSchema,
    reviewStatus: z.literal('human_judgements_separate_from_objective_scores'),
    origin: humanConversationOriginSchema,
    submissions: z.number().int().positive(),
    humanReviewSubmissions: z.number().int().nonnegative(),
    syntheticFixtureSubmissions: z.number().int().nonnegative(),
    reviews: z
      .array(
        z
          .object({
            submissionId: identifierSchema,
            reviewerId: z.string().max(80),
            purpose: z.enum(['human_review', 'synthetic_validation_fixture']),
            judgements: z
              .array(
                z
                  .object({
                    evaluationId: identifierSchema,
                    criterionId: identifierSchema,
                    status: z.enum([
                      'evaluated',
                      'not_evaluated',
                      'not_applicable',
                    ]),
                    score: z.number().int().min(1).max(10).optional(),
                    justification: reviewTextSchema,
                    evidenceReferences: z.array(evidenceReferenceSchema).max(50),
                    safetyAlert: safetyAlertSchema,
                  })
                  .strict(),
              )
              .min(1)
              .max(100),
          })
          .strict(),
      )
      .min(1)
      .max(100),
    criteria: z.array(criterionSummarySchema).min(1).max(100),
    safetyAlerts: z
      .array(
        z
          .object({
            submissionId: identifierSchema,
            reviewerId: z.string().max(80),
            criterionId: identifierSchema,
            rationale: reviewTextSchema,
            priority: z.literal('human_review_required'),
            objectiveCriticalFailureChanged: z.literal(false),
          })
          .strict(),
      )
      .max(100),
    adjudicationRequired: z.boolean(),
    limitations: z.array(z.string().min(1).max(1_000)).min(1).max(20),
  })
  .strict()

export type HumanConversationSample = z.infer<typeof humanConversationSampleSchema>
export type HumanReviewPackage = z.infer<typeof humanReviewPackageSchema>
export type HumanReviewTemplate = z.infer<typeof humanReviewTemplateSchema>
export type HumanReviewSubmission = z.infer<typeof humanReviewSubmissionSchema>
export type HumanReviewJudgement = z.infer<typeof humanReviewJudgementSchema>
export type HumanReviewSummary = z.infer<typeof humanReviewSummarySchema>
