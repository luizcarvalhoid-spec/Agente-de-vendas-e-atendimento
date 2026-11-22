import { z } from 'zod'

import { chatCompletionsLimitsSchema } from '../agent/chat-completions-client.js'
import { OPENAI_DIRECT_MODEL, OPENAI_DIRECT_PROTOCOL } from '../agent/openai/openai-direct-agent-model.js'
import { TOOL_ORCHESTRATOR_MAX_MODEL_CALLS, TOOL_ORCHESTRATOR_TIMEOUT_MS } from '../agent/tool-orchestrator.js'
import { fingerprintEvalDataset, fingerprintEvalValue } from './eval-baseline.js'
import { externalCanaryManifestSchema } from './external-canary-schema.js'
import { planExternalEval } from './external-eval-plan.js'
import { ExternalEvalExecutionError, runSimulatedOpenAiDirectExternalEval } from './external-eval-runner.js'
import type { ExternalEvalPlanRequest } from './external-eval-schema.js'

const modelPage = 'https://developers.openai.com/api/docs/models/gpt-6-luna'
const { limits, pricing } = externalCanaryManifestSchema.shape

export const openAiDirectCandidateSchema = externalCanaryManifestSchema.omit({
  sourceRevision: true, routing: true,
}).extend({
  contract: z.literal('openai_direct_preparation'),
  purpose: z.literal('offline_preparation'),
  providerId: z.literal('openai'),
  modelId: z.literal(OPENAI_DIRECT_MODEL),
  generation: z.strictObject({
    endpoint: z.literal(OPENAI_DIRECT_PROTOCOL.endpoint),
    reasoningEffort: z.literal(OPENAI_DIRECT_PROTOCOL.reasoningEffort),
    stream: z.literal(false),
    store: z.literal(OPENAI_DIRECT_PROTOCOL.store),
    toolChoice: z.literal('chat_service'),
  }),
  dataRetention: z.literal('pending_human_review'),
  limits: limits.refine((value) =>
    value.maxModelCalls <= TOOL_ORCHESTRATOR_MAX_MODEL_CALLS &&
    value.effectiveTimeoutMs === Math.min(value.timeoutMs, TOOL_ORCHESTRATOR_TIMEOUT_MS) &&
    chatCompletionsLimitsSchema.safeParse({ timeoutMs: value.timeoutMs, maxOutputTokens: value.maxOutputTokensPerCall }).success,
  ),
  pricing: pricing.omit({ confirmedAt: true }).extend({
    modelId: z.literal(OPENAI_DIRECT_MODEL),
    providerId: z.literal('openai'),
    observedAt: z.iso.datetime(),
    source: z.literal(modelPage),
  }),
  stopCriteria: z.tuple([
    z.literal('technical_failure'), z.literal('model_identity_mismatch'),
    z.literal('preventive_limit_reached'), z.literal('reported_usage_exceeded_reservation'),
    z.literal('operator_cancellation'),
  ]),
})

async function inspectOpenAiDirectCandidate(input: unknown) {
  const candidate = openAiDirectCandidateSchema.parse(input)
  const { maxInputTokensPerCall, effectiveTimeoutMs: _effectiveTimeout, ...limits } = candidate.limits
  const { observedAt, ...pricing } = candidate.pricing
  const request: ExternalEvalPlanRequest = {
    modality: 'mock_external',
    datasetId: candidate.dataset.id,
    scenarioIds: candidate.scenarioIds,
    modelId: candidate.modelId,
    limits: { ...limits, estimatedInputTokensPerCall: maxInputTokensPerCall },
    pricing: { ...pricing, confirmedAt: observedAt },
    maxBudgetUsd: candidate.maxBudgetUsd,
    unreportedUsageMultiplier: candidate.unreportedUsageMultiplier,
    outputDirectory: candidate.outputDirectory,
  }
  const { plan, loaded } = await planExternalEval(request)
  const datasetMatches = loaded !== undefined && loaded.data.dataset.id === candidate.dataset.id &&
    loaded.data.dataset.version === candidate.dataset.version && fingerprintEvalDataset(loaded) === candidate.dataset.fingerprint
  const preparation = {
    candidate,
    candidateFingerprint: fingerprintEvalValue(candidate),
    transportOrigin: { configuredProvider: candidate.providerId, endpoint: candidate.generation.endpoint, mode: 'in_memory' },
    observedEndpointIdentity: 'not_observed',
    documentaryReserveUsd: plan.estimatedWorstCaseUsd,
    datasetMatches,
    simulationReady: datasetMatches && plan.executionAllowed,
    simulationBlockers: [
      ...plan.blockers.map(({ code }) => code),
      ...(loaded !== undefined && !datasetMatches ? ['DATASET_FINGERPRINT_MISMATCH'] : []),
    ],
    operationalBlockers: ['LIVE_EXECUTION_DISABLED', 'DATA_RETENTION_REVIEW_PENDING', 'AUTHORIZATION_REQUIRED'],
    networkAllowed: false,
    experimentAuthorized: false,
    experimentExecuted: false,
  } as const
  return { request, preparation }
}

export async function prepareOpenAiDirectCandidate(input: unknown) {
  return (await inspectOpenAiDirectCandidate(input)).preparation
}

export async function rehearseOpenAiDirectCandidate(input: unknown, transport: typeof fetch, signal?: AbortSignal) {
  const { request, preparation } = await inspectOpenAiDirectCandidate(input)
  if (!preparation.simulationReady) throw new ExternalEvalExecutionError('PLAN_BLOCKED')
  const evaluation = await runSimulatedOpenAiDirectExternalEval(request, {
    transport, datasetFingerprint: preparation.candidate.dataset.fingerprint, signal,
  })
  return { ...preparation, evaluation }
}
