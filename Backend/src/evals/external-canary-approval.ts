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
  readonly scope: z.infer<typeof scope>
}

export type CanaryAuthorityRegistry = ReadonlyMap<string, CanaryAuthority>

export function canaryApprovalSigningBytes(payload: unknown) {
  const validated = canaryApprovalPayloadSchema.parse(payload)
  return Buffer.from(`hidrasplash/canary-approval/v1\n${fingerprintEvalValue(validated)}\n`)
}

export function authenticateCanaryApproval(input: unknown, authorities: CanaryAuthorityRegistry) {
  const parsed = canaryApprovalSchema.safeParse(input)
  if (!parsed.success) return undefined
  const { payload, signature } = parsed.data
  const authority = authorities.get(payload.authorityId)
  if (authority?.publicKey.type !== 'public' || authority.publicKey.asymmetricKeyType !== 'ed25519' ||
      authority.approverId !== payload.approverId || authority.scope !== payload.scope) {
    return undefined
  }
  try {
    const bytes = Buffer.from(signature, 'base64url')
    return bytes.toString('base64url') === signature &&
      verify(null, canaryApprovalSigningBytes(payload), authority.publicKey, bytes)
      ? payload
      : undefined
  } catch {
    return undefined
  }
}
