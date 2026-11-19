import { z } from 'zod'

import { openRouterEvaluationRoutingSchema } from '../agent/openrouter/openrouter-client.js'
import { evalReportSchema } from './eval-report-schema.js'

export const EXTERNAL_EVAL_PLAN_VERSION = 2 as const
export const EXTERNAL_EVAL_REPORT_VERSION = 2 as const

const identifierSchema = z.string().trim().min(1).max(200)
const positiveIntegerSchema = z.number().int().positive().max(10_000_000)
const moneySchema = z.number().finite().positive().max(1_000_000)
const nonnegativeMoneySchema = z.number().finite().nonnegative().max(1_000_000)

export const externalEvalModalitySchema = z.enum([
  'dry_run',
  'mock_external',
  'live_external',
])

export const externalEvalPlanRequestSchema = z
  .object({
    modality: externalEvalModalitySchema,
    datasetId: identifierSchema,
    scenarioIds: z.array(identifierSchema).min(1).max(100).optional(),
    modelId: identifierSchema.optional(),
    routing: openRouterEvaluationRoutingSchema.optional(),
    outputDirectory: z.string().trim().min(1).max(1_000).optional(),
    limits: z
      .object({
        maxModelCalls: positiveIntegerSchema.max(100),
        maxOutputTokensPerCall: positiveIntegerSchema.max(4_096),
        maxExecutionTokens: positiveIntegerSchema,
        estimatedInputTokensPerCall: positiveIntegerSchema,
        timeoutMs: positiveIntegerSchema.max(300_000),
      })
      .strict()
      .optional(),
    pricing: z
      .object({
        modelId: identifierSchema,
        currency: z.literal('USD'),
        inputUsdPerMillionTokens: moneySchema,
        outputUsdPerMillionTokens: moneySchema,
        confirmedAt: z.string().datetime({ offset: true }),
        providerId: identifierSchema.optional(),
        source: z.string().trim().min(1).max(500).optional(),
      })
      .strict()
      .optional(),
    maxBudgetUsd: moneySchema.optional(),
    unreportedUsageMultiplier: z
      .number()
      .finite()
      .min(1)
      .max(10)
      .optional(),
    liveAuthorization: z
      .object({
        enabled: z.boolean(),
        confirmation: z.literal('I_AUTHORIZE_LIVE_EXTERNAL_EVAL').optional(),
      })
      .strict()
      .optional(),
  })
  .strict()

export const externalEvalBlockerCodeSchema = z.enum([
  'DATASET_NOT_FOUND',
  'SCENARIO_NOT_FOUND',
  'SCENARIO_DUPLICATED',
  'MODEL_REQUIRED',
  'LIMITS_REQUIRED',
  'TOKEN_LIMIT_INCONSISTENT',
  'OPENROUTER_TIMEOUT_EXCEEDS_LIMIT',
  'PRICING_REQUIRED',
  'PRICING_MODEL_MISMATCH',
  'ROUTING_REQUIRED',
  'PRICING_PROVIDER_REQUIRED',
  'PRICING_PROVIDER_MISMATCH',
  'BUDGET_REQUIRED',
  'USAGE_MARGIN_REQUIRED',
  'OUTPUT_DIRECTORY_REQUIRED',
  'ESTIMATED_COST_EXCEEDS_BUDGET',
  'LIVE_AUTHORIZATION_REQUIRED',
  'LIVE_EXTERNAL_DISABLED',
])

const externalEvalBlockerSchema = z
  .object({
    code: externalEvalBlockerCodeSchema,
    detail: z.string().trim().min(1).max(500),
  })
  .strict()

export const externalEvalPlanSchema = z
  .object({
    planVersion: z.literal(EXTERNAL_EVAL_PLAN_VERSION),
    modality: externalEvalModalitySchema,
    status: z.enum(['ready', 'blocked']),
    executionAllowed: z.boolean(),
    networkAllowed: z.literal(false),
    dataset: z
      .object({
        id: identifierSchema,
        version: z.string().trim().min(1).max(128).optional(),
      })
      .strict(),
    selectedScenarioIds: z.array(identifierSchema).max(100),
    scenarioCount: z.number().int().nonnegative(),
    turnCount: z.number().int().nonnegative(),
    modelId: identifierSchema.optional(),
    routing: openRouterEvaluationRoutingSchema.optional(),
    outputDirectory: z.string().trim().min(1).max(1_000).optional(),
    limits: externalEvalPlanRequestSchema.shape.limits.optional(),
    pricing: externalEvalPlanRequestSchema.shape.pricing.optional(),
    maxBudgetUsd: moneySchema.optional(),
    unreportedUsageMultiplier: z.number().finite().min(1).max(10).optional(),
    estimatedWorstCaseUsd: nonnegativeMoneySchema.optional(),
    blockers: z.array(externalEvalBlockerSchema).max(30),
  })
  .strict()

const modelCallSchema = z
  .object({
    ordinal: z.number().int().positive(),
    requestedModelId: identifierSchema,
    providerModelId: identifierSchema.optional(),
    status: z.enum([
      'completed',
      'rejected',
      'failed',
      'timeout',
      'cancelled',
    ]),
    errorCode: identifierSchema.optional(),
    estimatedInputTokens: z.number().int().nonnegative(),
    requestedOutputTokens: z.number().int().nonnegative(),
    reportedInputTokens: z.number().int().nonnegative().optional(),
    reportedOutputTokens: z.number().int().nonnegative().optional(),
    reportedTotalTokens: z.number().int().nonnegative().optional(),
    usageComplete: z.boolean(),
    estimatedCostUsd: nonnegativeMoneySchema,
    chargedCostUsd: nonnegativeMoneySchema,
    overReservedTokens: z.number().int().nonnegative(),
    overReservedCostUsd: nonnegativeMoneySchema,
  })
  .strict()

const modelObservationSchema = z
  .object({
    ordinal: z.number().int().positive(),
    generationId: identifierSchema,
    returnedModelId: identifierSchema,
    providerId: identifierSchema.optional(),
    finishReason: z.string().trim().min(1).max(100).nullable(),
    usageStatus: z.enum(['complete', 'missing', 'inconsistent']),
    reportedInputTokens: z.number().int().nonnegative().optional(),
    reportedOutputTokens: z.number().int().nonnegative().optional(),
    reportedTotalTokens: z.number().int().nonnegative().optional(),
    modelIdentityMatches: z.boolean(),
    providerIdentityMatches: z.boolean().optional(),
  })
  .strict()

const turnSchema = z
  .object({
    index: z.number().int().nonnegative(),
    technicalStatus: z.enum(['completed', 'technical_failure']),
    responseType: z.enum(['text', 'recommendation', 'comparison']).optional(),
    technicalErrorCode: identifierSchema.optional(),
    modelCalls: z.number().int().nonnegative(),
    toolCallsRequested: z.number().int().nonnegative(),
    toolsExecuted: z.number().int().nonnegative(),
    toolRejections: z.number().int().nonnegative(),
    toolFailures: z.number().int().nonnegative(),
    earlyCompletion: z.boolean(),
    grounding: z
      .object({
        requirement: z.enum(['not_required', 'product', 'faq', 'any', 'both']),
        product: z.enum(['not_consulted', 'found', 'not_found', 'failed']),
        faq: z.enum(['not_consulted', 'found', 'not_found', 'failed']),
      })
      .strict(),
  })
  .strict()

const scenarioSchema = z
  .object({
    id: identifierSchema,
    technicalStatus: z.enum(['completed', 'technical_failure']),
    turns: z.array(turnSchema).max(50),
  })
  .strict()

const objectiveEvaluationSchema = evalReportSchema.pick({
  coverage: true,
  summary: true,
  scenarios: true,
})

export const externalEvalReportSchema = z
  .object({
    reportVersion: z.literal(EXTERNAL_EVAL_REPORT_VERSION),
    modality: externalEvalModalitySchema,
    provenance: z.enum([
      'planning_only',
      'simulated_external_transport',
      'authorized_external_provider',
    ]),
    performanceEvidence: z.enum([
      'not_executed',
      'not_real_model_performance',
      'declared_external_execution',
    ]),
    executionId: identifierSchema,
    dataset: z
      .object({
        id: identifierSchema,
        version: z.string().trim().min(1).max(128),
      })
      .strict(),
    selectedScenarioIds: z.array(identifierSchema).min(1).max(100),
    model: z
      .object({
        requestedId: identifierSchema,
        providerReportedIds: z.array(identifierSchema).max(20),
        providerIds: z.array(identifierSchema).max(20),
        returnedIds: z.array(identifierSchema).max(20),
        observations: z.array(modelObservationSchema).max(1_000),
      })
      .strict(),
    routing: openRouterEvaluationRoutingSchema.optional(),
    limits: externalEvalPlanRequestSchema.shape.limits.unwrap(),
    execution: z
      .object({
        technicalStatus: z.enum(['completed', 'technical_failure']),
        scenarios: z.number().int().nonnegative(),
        completedScenarios: z.number().int().nonnegative(),
        technicalFailures: z.number().int().nonnegative(),
        completedTurns: z.number().int().nonnegative(),
        modelCalls: z.number().int().nonnegative(),
        toolCallsRequested: z.number().int().nonnegative(),
        toolsExecuted: z.number().int().nonnegative(),
        toolRejections: z.number().int().nonnegative(),
        toolFailures: z.number().int().nonnegative(),
        earlyCompletions: z.number().int().nonnegative(),
        limitsReached: z.array(identifierSchema).max(20),
      })
      .strict(),
    consumption: z
      .object({
        reportedInputTokens: z.number().int().nonnegative(),
        reportedOutputTokens: z.number().int().nonnegative(),
        reportedTotalTokens: z.number().int().nonnegative(),
        estimatedTokens: z.number().int().nonnegative(),
        callsWithoutCompleteUsage: z.number().int().nonnegative(),
        estimatedCostUsd: nonnegativeMoneySchema,
        chargedCostUsd: nonnegativeMoneySchema,
        maxBudgetUsd: moneySchema,
        costIsEstimate: z.literal(true),
        overReservedTokens: z.number().int().nonnegative(),
        overReservedCostUsd: nonnegativeMoneySchema,
      })
      .strict(),
    modelCalls: z.array(modelCallSchema).max(1_000),
    scenarios: z.array(scenarioSchema).max(100),
    objectiveEvaluation: objectiveEvaluationSchema,
    humanReview: z
      .object({
        pending: z.boolean(),
        exportPrepared: z.boolean(),
      })
      .strict(),
    limitations: z.array(z.string().trim().min(1).max(1_000)).min(1).max(20),
  })
  .strict()

export type ExternalEvalModality = z.infer<typeof externalEvalModalitySchema>
export type ExternalEvalPlanRequest = z.infer<
  typeof externalEvalPlanRequestSchema
>
export type ExternalEvalPlan = z.infer<typeof externalEvalPlanSchema>
export type ExternalEvalReport = z.infer<typeof externalEvalReportSchema>
export type ExternalEvalModelCall = ExternalEvalReport['modelCalls'][number]
