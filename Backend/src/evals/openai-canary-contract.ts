import { z } from 'zod'

import { OPENAI_DIRECT_MODEL } from '../agent/openai/openai-direct-agent-model.js'
import { fingerprintEvalValue } from './eval-baseline.js'
import {
  canaryApprovalPayloadSchema, canaryApprovalSchema, signedCanaryPayloadBytes,
  verifySignedCanaryPayload, type CanaryAuthorityRegistry,
} from './external-canary-approval.js'
import { externalCanaryManifestSchema } from './external-canary-schema.js'
import { openAiDirectCandidateSchema } from './openai-direct-candidate.js'

export const openAiCanaryContractModuleUrl = import.meta.url

const scope = {
  datasetId: 'universal-core',
  scenarioId: 'universal.core.incomplete-need.001',
  timeoutMs: 15_000,
  maxCalls: 2,
  maxInputTokens: 20_000,
  maxOutputTokens: 512,
  maxBudgetUsd: 1,
  margin: 1.25,
} as const
export const openAiCanaryDraftSchema = openAiDirectCandidateSchema.extend({
  contract: z.literal('openai_direct_canary'),
  purpose: z.enum(['external_candidate', 'synthetic_rehearsal']),
  dataset: openAiDirectCandidateSchema.shape.dataset.extend({ id: z.literal(scope.datasetId) }),
  scenarioIds: z.tuple([z.literal(scope.scenarioId)]),
  limits: z.strictObject({
    maxModelCalls: z.literal(scope.maxCalls),
    maxInputTokensPerCall: z.literal(scope.maxInputTokens),
    maxOutputTokensPerCall: z.literal(scope.maxOutputTokens),
    maxExecutionTokens: z.literal(scope.maxCalls * (scope.maxInputTokens + scope.maxOutputTokens)),
    timeoutMs: z.literal(scope.timeoutMs),
    effectiveTimeoutMs: z.literal(scope.timeoutMs),
  }),
  maxBudgetUsd: z.literal(scope.maxBudgetUsd),
  unreportedUsageMultiplier: z.literal(scope.margin),
  dataRetention: z.literal('pending_human_review'),
  dataScope: z.literal('approved_fictional_only'),
  sourceRevision: externalCanaryManifestSchema.shape.sourceRevision.optional(),
})
export const openAiCanaryManifestSchema = openAiCanaryDraftSchema.required({ sourceRevision: true })
export type OpenAiCanaryManifest = z.infer<typeof openAiCanaryManifestSchema>

export function fingerprintOpenAiCanaryManifest(input: unknown) {
  return fingerprintEvalValue(openAiCanaryManifestSchema.parse(input))
}

const base = canaryApprovalPayloadSchema.shape
export const openAiCanaryProjectSchema = z.string().regex(/^proj_[a-zA-Z0-9_-]{1,90}$/)
const verification = z.strictObject({ verifiedAt: base.issuedAt, validUntil: base.expiresAt })
export const openAiCanaryApprovalPayloadSchema = canaryApprovalPayloadSchema.extend({
  modelId: z.literal(OPENAI_DIRECT_MODEL),
  providerId: z.literal('openai'),
  scope: z.enum(['openai_direct_once', 'openai_direct_fixture_once']),
  projectId: openAiCanaryProjectSchema,
  isolation: z.literal('isolated_non_production'),
  providerSpendLimit: verification.extend({
    enforcement: z.enum(['hard_limit', 'alert_only']),
    projectId: openAiCanaryProjectSchema,
    limitUsd: base.approvedBudgetUsd,
    availableUsd: base.approvedBudgetUsd,
  }).optional(),
  retentionDecision: verification.extend({
    projectId: openAiCanaryProjectSchema,
    policy: z.literal('standard_abuse_monitoring_explicitly_accepted'),
    dataScope: z.literal('approved_fictional_only'),
    transcriptPersistence: z.literal('disabled'),
  }).optional(),
  pricingReview: verification.optional(),
})
const approvalSchema = canaryApprovalSchema.extend({ payload: openAiCanaryApprovalPayloadSchema })
export type OpenAiCanaryApproval = z.infer<typeof openAiCanaryApprovalPayloadSchema>
const approvalDomain = 'agent-evals/openai-direct-canary-approval/v1'

export function openAiCanaryApprovalSigningBytes(input: unknown) {
  return signedCanaryPayloadBytes(approvalDomain, openAiCanaryApprovalPayloadSchema.parse(input))
}

export function authenticateOpenAiCanaryApproval(input: unknown, authorities: CanaryAuthorityRegistry) {
  const result = approvalSchema.safeParse(input)
  if (!result.success) return undefined
  const { payload, signature } = result.data
  return verifySignedCanaryPayload(payload, signature, authorities, approvalDomain) ? payload : undefined
}
