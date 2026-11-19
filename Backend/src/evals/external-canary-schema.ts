import { z } from 'zod'

import { openRouterEvaluationRoutingSchema } from '../agent/openrouter/openrouter-client.js'
import { EVAL_DATASET_SCHEMA_VERSION } from './eval-dataset-schema.js'
import { sanitizeEvalReportText } from './eval-report-builder.js'
import { EVAL_REPORT_ENGINE, EVAL_REPORT_FORMAT_VERSION } from './eval-report-schema.js'
import {
  EXTERNAL_EVAL_PLAN_VERSION,
  EXTERNAL_EVAL_REPORT_VERSION,
  externalEvalPlanRequestSchema,
} from './external-eval-schema.js'

export const EXTERNAL_CANARY_VERSION = 1 as const
export const EXTERNAL_CANARY_TECHNICAL_VERSIONS = {
  datasetSchema: EVAL_DATASET_SCHEMA_VERSION,
  externalPlan: EXTERNAL_EVAL_PLAN_VERSION,
  externalReport: EXTERNAL_EVAL_REPORT_VERSION,
  objectiveReport: EVAL_REPORT_FORMAT_VERSION,
  objectiveEngine: EVAL_REPORT_ENGINE,
} as const

export const EXTERNAL_CANARY_STOP_CRITERIA = [
  'technical_failure',
  'model_identity_mismatch',
  'provider_identity_mismatch_or_unobserved',
  'preventive_limit_reached',
  'reported_usage_exceeded_reservation',
  'operator_cancellation',
] as const

export const EXTERNAL_CANARY_DEFAULT_DATASET = 'universal-core'
export const EXTERNAL_CANARY_DEFAULT_SCENARIO = 'universal.core.incomplete-need.001'

const safeText = (value: string) => sanitizeEvalReportText(value) === value
const slug = z.string().max(128).regex(/^[a-zA-Z0-9][a-zA-Z0-9._-]*$/).refine(safeText)
const modelId = z.string().max(200).regex(/^[a-zA-Z0-9._-]+\/[a-zA-Z0-9._:-]+$/).refine(safeText)
const sourceUrl = z.string().max(500).refine((value) =>
  /^https:\/\/[a-zA-Z0-9.-]+(?:\/[a-zA-Z0-9._~/-]*)?$/.test(value) &&
  URL.canParse(value) &&
  safeText(value.slice('https://'.length)),
)
const relativeDirectory = z.string().max(180)
  .regex(/^[a-zA-Z0-9_-][a-zA-Z0-9._-]*(?:\/[a-zA-Z0-9_-][a-zA-Z0-9._-]*)*$/)
  .refine(safeText)

export const canaryFingerprintSchema = z.string().regex(/^sha256:[a-f0-9]{64}$/)
const externalFields = externalEvalPlanRequestSchema.shape
const pricing = externalFields.pricing.unwrap().extend({
  modelId,
  providerId: slug,
  source: sourceUrl,
}).strict()
const routing = openRouterEvaluationRoutingSchema.extend({
  providerId: slug,
  zeroDataRetention: z.boolean(),
}).strict()
const limits = externalFields.limits.unwrap().omit({ estimatedInputTokensPerCall: true }).extend({
  maxInputTokensPerCall: externalFields.limits.unwrap().shape.estimatedInputTokensPerCall,
  effectiveTimeoutMs: z.number().int().positive(),
}).strict()

const manifestBase = z.strictObject({
  manifestVersion: z.literal(EXTERNAL_CANARY_VERSION),
  experimentId: slug,
  purpose: z.enum(['external_candidate', 'synthetic_rehearsal']),
  environment: z.literal('isolated_non_production'),
  dataset: z.strictObject({ id: slug, version: slug, fingerprint: canaryFingerprintSchema }),
  scenarioIds: z.tuple([slug]),
  generation: z.strictObject({
    stream: z.literal(false),
    sampling: z.literal('provider_defaults'),
    toolChoice: z.literal('chat_service'),
  }),
  transcriptPersistence: z.literal('disabled'),
  stopCriteria: z.array(z.enum(EXTERNAL_CANARY_STOP_CRITERIA))
    .length(EXTERNAL_CANARY_STOP_CRITERIA.length)
    .refine((items) => items.every((item, index) => item === EXTERNAL_CANARY_STOP_CRITERIA[index])),
  technicalVersions: z.strictObject({
    datasetSchema: z.literal(EXTERNAL_CANARY_TECHNICAL_VERSIONS.datasetSchema),
    externalPlan: z.literal(EXTERNAL_CANARY_TECHNICAL_VERSIONS.externalPlan),
    externalReport: z.literal(EXTERNAL_CANARY_TECHNICAL_VERSIONS.externalReport),
    objectiveReport: z.literal(EXTERNAL_CANARY_TECHNICAL_VERSIONS.objectiveReport),
    objectiveEngine: z.literal(EXTERNAL_CANARY_TECHNICAL_VERSIONS.objectiveEngine),
  }),
})

const explicitConfiguration = z.strictObject({
  modelId,
  routing,
  limits,
  pricing,
  maxBudgetUsd: externalFields.maxBudgetUsd.unwrap(),
  unreportedUsageMultiplier: externalFields.unreportedUsageMultiplier.unwrap(),
  outputDirectory: relativeDirectory,
  sourceRevision: z.string().regex(/^[a-f0-9]{40}$/),
})

export const externalCanaryManifestSchema = manifestBase.extend(explicitConfiguration.shape)

export const externalCanaryDraftSchema = manifestBase.extend({
  ...explicitConfiguration.partial().shape,
  pricing: pricing.partial().optional(),
  routing: routing.partial({ dataCollection: true, zeroDataRetention: true }).optional(),
})

export const externalCanaryReviewItems = [
  'price_and_source',
  'model_and_provider',
  'data_policy',
  'local_budget',
  'provider_account_spend_limit',
  'scope_and_scenario',
  'plan_and_fingerprint',
  'secure_credential_mechanism',
] as const

export const externalCanaryReviewSchema = z.strictObject({
  manifestFingerprint: canaryFingerprintSchema,
  attestations: z.array(z.enum(externalCanaryReviewItems)).max(externalCanaryReviewItems.length)
    .refine((items) => new Set(items).size === items.length),
})

export type ExternalCanaryManifest = z.infer<typeof externalCanaryManifestSchema>
export type ExternalCanaryDraft = z.infer<typeof externalCanaryDraftSchema>
