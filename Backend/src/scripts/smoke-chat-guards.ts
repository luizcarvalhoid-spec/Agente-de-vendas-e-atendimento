import { Buffer } from 'node:buffer'

import type { ReportedModelUsage } from '../agent/usage-budget-controller.js'
import { CHAT_MODEL_INPUT_MARGIN_UNITS } from '../agent/usage-budget-controller.js'
import {
  OPENROUTER_MAX_REQUEST_BYTES,
  type OpenRouterTransport,
} from '../agent/openrouter/openrouter-client.js'

export const SMOKE_MAX_PROVIDER_CALLS = 6
export const SMOKE_MAX_EXECUTIONS = 3
export const SMOKE_MAX_MODEL_CALLS_PER_EXECUTION = 2
export const SMOKE_MAX_OUTPUT_TOKENS = 512
export const SMOKE_MAX_MONETARY_CEILING_USD = 0.3
export const SMOKE_MAX_INPUT_UNITS_PER_CALL =
  OPENROUTER_MAX_REQUEST_BYTES + CHAT_MODEL_INPUT_MARGIN_UNITS

export type SmokeCaseKind = 'product' | 'faq' | 'mixed'

export interface SmokeGroundingEvidence {
  readonly status: string
  readonly groundingRequirement: string
  readonly productGrounding: string
  readonly faqGrounding: string
}

export interface SmokeResponseEvidence {
  readonly type: string
  readonly productIds?: readonly number[]
  readonly sourceIds: readonly string[]
}

interface SmokeCostGuardOptions {
  readonly inputPricePerMillion: number
  readonly outputPricePerMillion: number
  readonly monetaryCeilingUsd: number
  readonly maxProviderCalls?: number
  readonly maxOutputTokens?: number
  readonly maxInputUnitsPerCall?: number
}

interface SmokeReservation {
  readonly estimatedInputUnits: number
  readonly estimatedMaximumCostUsd: number
}

export interface SmokeCostSnapshot {
  readonly providerCalls: number
  readonly pendingCalls: number
  readonly estimatedCommittedCostUsd: number
  readonly estimatedReservedCostUsd: number
  readonly usageOverEstimate: boolean
  readonly blocked: boolean
}

export interface SmokeCostGuard {
  wrapTransport(transport: OpenRouterTransport): OpenRouterTransport
  reconcileUsage(usage: ReportedModelUsage | undefined): void
  assertHealthy(): void
  snapshot(): SmokeCostSnapshot
}

export type SmokeGuardErrorCode =
  | 'GUARD_CONFIGURATION'
  | 'REQUEST_POLICY'
  | 'PROVIDER_CALL_LIMIT'
  | 'MONETARY_BUDGET'
  | 'USAGE_REPORTING'
  | 'GROUNDING_EVIDENCE'

export class SmokeGuardError extends Error {
  readonly code: SmokeGuardErrorCode

  constructor(code: SmokeGuardErrorCode = 'GUARD_CONFIGURATION') {
    super('O smoke foi interrompido por uma proteção operacional.')
    this.name = 'SmokeGuardError'
    this.code = code
  }
}

function positiveFinite(value: number) {
  if (!Number.isFinite(value) || value <= 0) {
    throw new SmokeGuardError('GUARD_CONFIGURATION')
  }
  return value
}

function positiveInteger(value: number) {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new SmokeGuardError('GUARD_CONFIGURATION')
  }
  return value
}

function parseRequestBody(
  init: RequestInit | undefined,
  maxOutputTokens: number,
  maxInputUnitsPerCall: number,
) {
  if (typeof init?.body !== 'string') {
    throw new SmokeGuardError('REQUEST_POLICY')
  }

  let body: unknown
  try {
    body = JSON.parse(init.body)
  } catch {
    throw new SmokeGuardError('REQUEST_POLICY')
  }
  if (
    typeof body !== 'object' ||
    body === null ||
    !('max_completion_tokens' in body) ||
    body.max_completion_tokens !== maxOutputTokens
  ) {
    throw new SmokeGuardError('REQUEST_POLICY')
  }

  const estimatedInputUnits =
    Buffer.byteLength(init.body, 'utf8') + CHAT_MODEL_INPUT_MARGIN_UNITS
  if (estimatedInputUnits > maxInputUnitsPerCall) {
    throw new SmokeGuardError('REQUEST_POLICY')
  }
  return estimatedInputUnits
}

export function assertSmokeWorstCaseBudget(options: {
  readonly inputPricePerMillion: number
  readonly outputPricePerMillion: number
  readonly monetaryCeilingUsd: number
  readonly maxProviderCalls?: number
  readonly maxOutputTokens?: number
  readonly maxInputUnitsPerCall?: number
}) {
  const inputPrice = positiveFinite(options.inputPricePerMillion)
  const outputPrice = positiveFinite(options.outputPricePerMillion)
  const monetaryCeiling = positiveFinite(options.monetaryCeilingUsd)
  const maxProviderCalls = positiveInteger(
    options.maxProviderCalls ?? SMOKE_MAX_PROVIDER_CALLS,
  )
  const maxOutputTokens = positiveInteger(
    options.maxOutputTokens ?? SMOKE_MAX_OUTPUT_TOKENS,
  )
  const maxInputUnitsPerCall = positiveInteger(
    options.maxInputUnitsPerCall ?? SMOKE_MAX_INPUT_UNITS_PER_CALL,
  )
  const maximumCostPerCall =
    (maxInputUnitsPerCall * inputPrice + maxOutputTokens * outputPrice) /
    1_000_000
  const worstCaseReservedCostUsd = maximumCostPerCall * maxProviderCalls

  if (
    monetaryCeiling > SMOKE_MAX_MONETARY_CEILING_USD ||
    worstCaseReservedCostUsd > monetaryCeiling
  ) {
    throw new SmokeGuardError('MONETARY_BUDGET')
  }
  return worstCaseReservedCostUsd
}

function validUsage(usage: ReportedModelUsage | undefined): usage is ReportedModelUsage {
  return Boolean(
    usage &&
      Number.isSafeInteger(usage.inputTokens) &&
      usage.inputTokens >= 0 &&
      Number.isSafeInteger(usage.outputTokens) &&
      usage.outputTokens >= 0 &&
      Number.isSafeInteger(usage.totalTokens) &&
      usage.totalTokens === usage.inputTokens + usage.outputTokens,
  )
}

export function createSmokeCostGuard(
  options: SmokeCostGuardOptions,
): SmokeCostGuard {
  const inputPrice = positiveFinite(options.inputPricePerMillion)
  const outputPrice = positiveFinite(options.outputPricePerMillion)
  const monetaryCeiling = positiveFinite(options.monetaryCeilingUsd)
  const maxProviderCalls = positiveInteger(
    options.maxProviderCalls ?? SMOKE_MAX_PROVIDER_CALLS,
  )
  const maxOutputTokens = positiveInteger(
    options.maxOutputTokens ?? SMOKE_MAX_OUTPUT_TOKENS,
  )
  const maxInputUnitsPerCall = positiveInteger(
    options.maxInputUnitsPerCall ?? SMOKE_MAX_INPUT_UNITS_PER_CALL,
  )
  const pending: SmokeReservation[] = []
  let providerCalls = 0
  let estimatedCommittedCostUsd = 0
  let usageOverEstimate = false
  let blocked = false
  let failureCode: SmokeGuardErrorCode | undefined

  const cost = (inputUnits: number, outputUnits: number) =>
    (inputUnits * inputPrice + outputUnits * outputPrice) / 1_000_000
  const reservedCost = () =>
    pending.reduce(
      (total, reservation) => total + reservation.estimatedMaximumCostUsd,
      0,
    )
  const fail = (code: SmokeGuardErrorCode): never => {
    blocked = true
    failureCode ??= code
    throw new SmokeGuardError(failureCode)
  }

  return {
    wrapTransport(transport) {
      return async (input, init) => {
        if (blocked) return fail(failureCode ?? 'GUARD_CONFIGURATION')
        if (providerCalls >= maxProviderCalls) {
          return fail('PROVIDER_CALL_LIMIT')
        }
        let estimatedInputUnits: number
        try {
          estimatedInputUnits = parseRequestBody(
            init,
            maxOutputTokens,
            maxInputUnitsPerCall,
          )
        } catch {
          return fail('REQUEST_POLICY')
        }
        const estimatedMaximumCostUsd = cost(
          estimatedInputUnits,
          maxOutputTokens,
        )
        if (
          estimatedCommittedCostUsd +
            reservedCost() +
            estimatedMaximumCostUsd >
          monetaryCeiling
        ) {
          return fail('MONETARY_BUDGET')
        }

        pending.push({ estimatedInputUnits, estimatedMaximumCostUsd })
        providerCalls += 1
        return transport(input, init)
      }
    },

    reconcileUsage(usage) {
      const reservation = pending.shift()
      if (!reservation || !validUsage(usage)) {
        return fail('USAGE_REPORTING')
      }

      const reportedCost = cost(usage.inputTokens, usage.outputTokens)
      usageOverEstimate ||=
        usage.inputTokens > reservation.estimatedInputUnits ||
        usage.outputTokens > maxOutputTokens ||
        reportedCost > reservation.estimatedMaximumCostUsd
      estimatedCommittedCostUsd += reportedCost
      if (estimatedCommittedCostUsd + reservedCost() > monetaryCeiling) {
        fail('MONETARY_BUDGET')
      }
    },

    assertHealthy() {
      if (blocked) fail(failureCode ?? 'GUARD_CONFIGURATION')
      if (pending.length > 0) fail('USAGE_REPORTING')
    },

    snapshot() {
      return {
        providerCalls,
        pendingCalls: pending.length,
        estimatedCommittedCostUsd,
        estimatedReservedCostUsd: reservedCost(),
        usageOverEstimate,
        blocked,
      }
    },
  }
}

export function assertSmokeCaseEvidence(input: {
  readonly kind: SmokeCaseKind
  readonly response: SmokeResponseEvidence
  readonly termination: SmokeGroundingEvidence | undefined
}) {
  const { kind, response, termination } = input
  if (!termination || termination.status !== 'ASSISTANT_RESPONSE') {
    throw new SmokeGuardError('GROUNDING_EVIDENCE')
  }
  if (kind === 'product') {
    if (
      termination.groundingRequirement !== 'product' ||
      termination.productGrounding !== 'found' ||
      response.type !== 'recommendation' ||
      response.productIds?.length !== 1
    ) {
      throw new SmokeGuardError('GROUNDING_EVIDENCE')
    }
    return
  }
  if (kind === 'faq') {
    if (
      termination.groundingRequirement !== 'faq' ||
      termination.faqGrounding !== 'found' ||
      response.sourceIds.length === 0
    ) {
      throw new SmokeGuardError('GROUNDING_EVIDENCE')
    }
    return
  }
  if (
    termination.groundingRequirement !== 'both' ||
    termination.productGrounding !== 'found' ||
    termination.faqGrounding !== 'found' ||
    response.productIds?.length !== 1 ||
    response.sourceIds.length === 0
  ) {
    throw new SmokeGuardError('GROUNDING_EVIDENCE')
  }
}

export type SmokeSetupErrorCode =
  | 'CONFIRMATION_REQUIRED'
  | 'BACKEND_CONFIGURATION'
  | 'PRICING_CONFIGURATION'

export class SmokeSetupError extends Error {
  readonly code: SmokeSetupErrorCode

  constructor(code: SmokeSetupErrorCode) {
    super('O smoke não passou pelo preflight local.')
    this.name = 'SmokeSetupError'
    this.code = code
  }
}

export type SmokeFailureCategory =
  | SmokeSetupErrorCode
  | SmokeGuardErrorCode
  | 'CHAT_INVALID_REQUEST'
  | 'MODEL_UNAVAILABLE'
  | 'MODEL_AUTHENTICATION_FAILED'
  | 'MODEL_RATE_LIMITED'
  | 'MODEL_TOOL_CALLING_INCOMPATIBLE'
  | 'MODEL_INVALID_RESPONSE'
  | 'MODEL_TIMEOUT'
  | 'MODEL_CANCELLED'
  | 'LOCAL_USAGE_BUDGET'
  | 'UNEXPECTED_FAILURE'

export function classifySmokeFailure(
  error: unknown,
  terminationStatus?: string,
): SmokeFailureCategory {
  if (error instanceof SmokeSetupError || error instanceof SmokeGuardError) {
    return error.code
  }
  switch (terminationStatus) {
    case 'MODEL_AUTHENTICATION_FAILED':
      return 'MODEL_AUTHENTICATION_FAILED'
    case 'MODEL_RATE_LIMITED':
      return 'MODEL_RATE_LIMITED'
    case 'MODEL_UNAVAILABLE':
    case 'MODEL_FAILED':
      return 'MODEL_UNAVAILABLE'
    case 'MODEL_TOOL_CALLING_INCOMPATIBLE':
      return 'MODEL_TOOL_CALLING_INCOMPATIBLE'
    case 'INVALID_MODEL_RESPONSE':
    case 'MODEL_LIMIT':
      return 'MODEL_INVALID_RESPONSE'
    case 'MODEL_TIMEOUT':
    case 'OPERATION_TIMEOUT':
      return 'MODEL_TIMEOUT'
    case 'MODEL_CANCELLED':
    case 'CALLER_CANCELLED':
      return 'MODEL_CANCELLED'
    case 'LOCAL_BUDGET_EXHAUSTED':
      return 'LOCAL_USAGE_BUDGET'
  }
  if (typeof error !== 'object' || error === null || !('code' in error)) {
    return 'UNEXPECTED_FAILURE'
  }
  switch (error.code) {
    case 'INVALID_REQUEST':
      return 'CHAT_INVALID_REQUEST'
    case 'AI_UNAVAILABLE':
      return 'MODEL_UNAVAILABLE'
    case 'AI_BAD_RESPONSE':
      return 'MODEL_INVALID_RESPONSE'
    case 'AI_TIMEOUT':
      return 'MODEL_TIMEOUT'
    case 'REQUEST_CANCELLED':
      return 'MODEL_CANCELLED'
    default:
      return 'UNEXPECTED_FAILURE'
  }
}
