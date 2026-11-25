import { verify, type KeyObject } from 'node:crypto'
import { z } from 'zod'

import { fingerprintEvalValue } from './eval-baseline.js'
import { sanitizeEvalReportText } from './eval-report-builder.js'
import { canaryFingerprintSchema, externalCanaryManifestSchema } from './external-canary-schema.js'

const manifest = externalCanaryManifestSchema.shape
const safeId = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._-]{0,79}$/)
  .refine((value) => sanitizeEvalReportText(value) === value)
const timestamp = z.iso.datetime({ offset: true })
export const canaryUseIdSchema = z.string().regex(/^[a-f0-9]{32}$/)
const scope = z.enum(['synthetic_canary_once', 'external_canary_once'])
const evidenceWindow = { verifiedAt: timestamp, validUntil: timestamp }
const rate = z.number().finite().nonnegative()

const openRouterEvidence = z.strictObject({
  routingDecision: z.strictObject({
    scope: z.literal('azure_family_fictional_data_only'),
    ...evidenceWindow,
  }).optional(),
  privacy: z.strictObject({
    zdrOnly: z.literal(true),
    safetyRetention: z.literal(false),
    dataCollection: z.literal('deny'),
    ...evidenceWindow,
  }).optional(),
  account: z.strictObject({
    keyFingerprint: canaryFingerprintSchema,
    availableCreditsUsd: rate,
    limitReset: z.null(),
    autoTopUp: z.literal(false),
    dedicatedKey: z.literal(true),
    byok: z.literal(false),
    ...evidenceWindow,
  }).optional(),
  pricing: z.strictObject({
    variantsAndCacheReviewed: z.literal(true),
    tokenPricingOnly: z.literal(true),
    maximumPromptUsdPerMillion: rate,
    maximumCacheReadUsdPerMillion: rate,
    maximumCacheWriteUsdPerMillion: rate,
    maximumOutputUsdPerMillion: rate,
    ...evidenceWindow,
  }).optional(),
})

export const canaryApprovalPayloadSchema = z.strictObject({
  version: z.literal(1),
  authorizationId: safeId,
  useId: canaryUseIdSchema,
  experimentId: manifest.experimentId,
  manifestFingerprint: canaryFingerprintSchema,
  dataset: manifest.dataset,
  scenarioIds: manifest.scenarioIds,
  modelId: manifest.modelId,
  providerId: manifest.routing.shape.providerId,
  approvedBudgetUsd: manifest.maxBudgetUsd,
  sourceRevision: manifest.sourceRevision,
  worktreeFingerprint: canaryFingerprintSchema,
  dependenciesFingerprint: canaryFingerprintSchema,
  authorityId: safeId,
  approverId: safeId,
  issuedAt: timestamp,
  expiresAt: timestamp,
  scope,
  providerSpendLimit: z.strictObject({
    origin: z.enum(['synthetic_fixture', 'operator_account_console']),
    providerId: manifest.routing.shape.providerId,
    manifestFingerprint: canaryFingerprintSchema,
    limitUsd: manifest.maxBudgetUsd,
    verifiedAt: timestamp,
    validUntil: timestamp,
  }).optional(),
  openRouterEvidence: openRouterEvidence.optional(),
})

export const canaryApprovalSchema = z.strictObject({
  payload: canaryApprovalPayloadSchema,
  signature: z.string().regex(/^[A-Za-z0-9_-]{86}$/),
})

export type CanaryApprovalPayload = z.infer<typeof canaryApprovalPayloadSchema>
export type CanaryApproval = z.infer<typeof canaryApprovalSchema>

export interface CanaryAuthority {
  readonly publicKey: KeyObject
  readonly approverId: string
  readonly scope: z.infer<typeof scope> | 'openai_direct_once' | 'openai_direct_fixture_once'
}

export type CanaryAuthorityRegistry = ReadonlyMap<string, CanaryAuthority>

export function canaryApprovalSigningBytes(payload: unknown) {
  const validated = canaryApprovalPayloadSchema.parse(payload)
  return signedCanaryPayloadBytes('agent-evals/canary-approval/v1', validated)
}

export function signedCanaryPayloadBytes(domain: string, payload: unknown) {
  return Buffer.from(`${domain}\n${fingerprintEvalValue(payload)}\n`)
}

export function verifySignedCanaryPayload(
  payload: { authorityId: string; approverId: string; scope: CanaryAuthority['scope'] },
  signature: string,
  authorities: CanaryAuthorityRegistry,
  domain: string,
) {
  const authority = authorities.get(payload.authorityId)
  if (authority?.publicKey.type !== 'public' || authority.publicKey.asymmetricKeyType !== 'ed25519' ||
      authority.approverId !== payload.approverId || authority.scope !== payload.scope) {
    return false
  }
  try {
    const decoded = Buffer.from(signature, 'base64url')
    return decoded.toString('base64url') === signature &&
      verify(null, signedCanaryPayloadBytes(domain, payload), authority.publicKey, decoded)
  } catch {
    return false
  }
}

export function authenticateCanaryApproval(input: unknown, authorities: CanaryAuthorityRegistry) {
  const parsed = canaryApprovalSchema.safeParse(input)
  if (!parsed.success) return undefined
  const { payload, signature } = parsed.data
  return verifySignedCanaryPayload(payload, signature, authorities, 'agent-evals/canary-approval/v1') ? payload : undefined
}
