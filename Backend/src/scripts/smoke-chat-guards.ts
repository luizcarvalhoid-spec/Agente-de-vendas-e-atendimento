import { Buffer } from 'node:buffer'

import type { ReportedModelUsage } from '../agent/usage-budget-controller.js'
import { CHAT_MODEL_INPUT_MARGIN_UNITS } from '../agent/usage-budget-controller.js'
import {
  OPENROUTER_MAX_REQUEST_BYTES,
  type OpenRouterTransport,
} from '../agent/openrouter/openrouter-client.js'

export const SMOKE_MAX_PROVIDER_CALLS = 6
export const SMOKE_MAX_OUTPUT_TOKENS = 128
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

export class SmokeGuardError extends Error {
  constructor() {
    super('O smoke foi interrompido por uma proteção operacional.')
    this.name = 'SmokeGuardError'
  }
}

function positiveFinite(value: number) {
  if (!Number.isFinite(value) || value <= 0) throw new SmokeGuardError()
  return value
}

function positiveInteger(value: number) {
  if (!Number.isSafeInteger(value) || value <= 0) throw new SmokeGuardError()
  return value
}

function parseRequestBody(
  init: RequestInit | undefined,
  maxOutputTokens: number,
  maxInputUnitsPerCall: number,
) {
  if (typeof init?.body !== 'string') throw new SmokeGuardError()

  let body: unknown
  try {
    body = JSON.parse(init.body)
  } catch {
    throw new SmokeGuardError()
  }
  if (
    typeof body !== 'object' ||
    body === null ||
    !('max_completion_tokens' in body) ||
    body.max_completion_tokens !== maxOutputTokens
  ) {
    throw new SmokeGuardError()
  }

  const estimatedInputUnits =
    Buffer.byteLength(init.body, 'utf8') + CHAT_MODEL_INPUT_MARGIN_UNITS
  if (estimatedInputUnits > maxInputUnitsPerCall) {
    throw new SmokeGuardError()
  }
  return estimatedInputUnits
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

  const cost = (inputUnits: number, outputUnits: number) =>
    (inputUnits * inputPrice + outputUnits * outputPrice) / 1_000_000
  const reservedCost = () =>
    pending.reduce(
      (total, reservation) => total + reservation.estimatedMaximumCostUsd,
      0,
    )
  const fail = (): never => {
    blocked = true
    throw new SmokeGuardError()
  }

  return {
    wrapTransport(transport) {
      return async (input, init) => {
        if (blocked || providerCalls >= maxProviderCalls) return fail()
        let estimatedInputUnits: number
        try {
          estimatedInputUnits = parseRequestBody(
            init,
            maxOutputTokens,
            maxInputUnitsPerCall,
          )
        } catch {
          return fail()
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
          return fail()
        }

        pending.push({ estimatedInputUnits, estimatedMaximumCostUsd })
        providerCalls += 1
        return transport(input, init)
      }
    },

    reconcileUsage(usage) {
      const reservation = pending.shift()
      if (!reservation || !validUsage(usage)) return fail()

      const reportedCost = cost(usage.inputTokens, usage.outputTokens)
      usageOverEstimate ||=
        usage.inputTokens > reservation.estimatedInputUnits ||
        usage.outputTokens > maxOutputTokens ||
        reportedCost > reservation.estimatedMaximumCostUsd
      estimatedCommittedCostUsd += reportedCost
      if (estimatedCommittedCostUsd + reservedCost() > monetaryCeiling) fail()
    },

    assertHealthy() {
      if (blocked || pending.length > 0) fail()
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
    throw new SmokeGuardError()
  }
  if (kind === 'product') {
    if (
      termination.groundingRequirement !== 'product' ||
      termination.productGrounding !== 'found' ||
      response.type !== 'recommendation' ||
      response.productIds?.length !== 1
    ) {
      throw new SmokeGuardError()
    }
    return
  }
  if (kind === 'faq') {
    if (
      termination.groundingRequirement !== 'faq' ||
      termination.faqGrounding !== 'found' ||
      response.sourceIds.length === 0
    ) {
      throw new SmokeGuardError()
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
    throw new SmokeGuardError()
  }
}
