import { Buffer } from 'node:buffer'

import {
  AgentModelError,
  type AgentModelPort,
  type AgentModelResult,
} from './agent-model-port.js'

export const CHAT_EXECUTION_BUDGET_UNITS = 120_000
export const CHAT_USAGE_WINDOW_MS = 60 * 60_000
export const CHAT_USAGE_WINDOW_BUDGET_UNITS = 500_000
export const CHAT_USAGE_LEDGER_MAX_ENTRIES = 2_000
export const CHAT_MODEL_INPUT_MARGIN_UNITS = 2_048

export interface ReportedModelUsage {
  readonly inputTokens: number
  readonly outputTokens: number
  readonly totalTokens: number
}

export type UsageReconciliationOutcome =
  | { readonly kind: 'not_sent' }
  | { readonly kind: 'reported'; readonly usage: ReportedModelUsage }
  | { readonly kind: 'sent_without_usage' }
  | { readonly kind: 'possibly_sent' }
  | { readonly kind: 'timeout' }
  | { readonly kind: 'cancelled' }

export interface UsageReconciliation {
  readonly reservedUnits: number
  readonly chargedUnits: number
  readonly usageComplete: boolean
  readonly overReservationUnits: number
  readonly outcome: UsageReconciliationOutcome['kind']
}

export interface UsageReservation {
  readonly reservedUnits: number
  reconcile(outcome: UsageReconciliationOutcome): UsageReconciliation
}

export type UsageReservationResult =
  | { readonly reserved: true; readonly reservation: UsageReservation }
  | {
      readonly reserved: false
      readonly reason: 'execution_budget' | 'window_budget' | 'ledger_capacity'
      readonly retryAfterSeconds: number
    }

export interface UsageBudgetExecution {
  reserve(input: {
    estimatedInputTokens: number
    maxOutputTokens: number
  }): UsageReservationResult
}

export interface UsageBudgetController {
  createExecution(): UsageBudgetExecution
}

export interface CreateUsageBudgetControllerOptions {
  readonly executionBudgetUnits?: number
  readonly windowMs?: number
  readonly windowBudgetUnits?: number
  readonly maxLedgerEntries?: number
  readonly now?: () => number
}

export interface BudgetedModelUsageEvent {
  readonly reservedUnits: number
  readonly chargedUnits: number
  readonly estimatedInputTokens: number
  readonly requestedOutputTokens: number
  readonly reportedUsage?: ReportedModelUsage
  readonly usageComplete: boolean
  readonly overReservationUnits: number
  readonly outcome: UsageReconciliationOutcome['kind']
}

interface LedgerEntry {
  at: number
  units: number
}

function positiveInteger(value: number, name: string) {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new TypeError(`${name} inválido.`)
  }
  return value
}

export function createUsageBudgetController(
  options: CreateUsageBudgetControllerOptions = {},
): UsageBudgetController {
  const executionBudgetUnits = positiveInteger(
    options.executionBudgetUnits ?? CHAT_EXECUTION_BUDGET_UNITS,
    'Orçamento por execução',
  )
  const windowMs = positiveInteger(
    options.windowMs ?? CHAT_USAGE_WINDOW_MS,
    'Janela de uso',
  )
  const windowBudgetUnits = positiveInteger(
    options.windowBudgetUnits ?? CHAT_USAGE_WINDOW_BUDGET_UNITS,
    'Orçamento da janela',
  )
  const maxLedgerEntries = positiveInteger(
    options.maxLedgerEntries ?? CHAT_USAGE_LEDGER_MAX_ENTRIES,
    'Limite do ledger',
  )
  const now = options.now ?? Date.now
  const ledger: LedgerEntry[] = []
  let activeReservedUnits = 0

  const cleanup = (timestamp: number) => {
    const threshold = timestamp - windowMs
    while (ledger[0] !== undefined && ledger[0].at <= threshold) {
      ledger.shift()
    }
  }
  const committedUnits = () =>
    ledger.reduce((total, entry) => total + entry.units, 0)
  const retryAfter = (timestamp: number) =>
    Math.max(
      1,
      Math.ceil(((ledger[0]?.at ?? timestamp) + windowMs - timestamp) / 1_000),
    )

  return {
    createExecution() {
      let executionChargedUnits = 0
      let executionActiveUnits = 0

      return {
        reserve(input) {
          const estimatedInputTokens = positiveInteger(
            input.estimatedInputTokens,
            'Estimativa de entrada',
          )
          const maxOutputTokens = positiveInteger(
            input.maxOutputTokens,
            'Teto de saída',
          )
          const requestedUnits = estimatedInputTokens + maxOutputTokens
          const timestamp = now()
          cleanup(timestamp)

          if (
            executionChargedUnits + executionActiveUnits + requestedUnits >
            executionBudgetUnits
          ) {
            return {
              reserved: false,
              reason: 'execution_budget',
              retryAfterSeconds: 1,
            }
          }
          if (ledger.length >= maxLedgerEntries) {
            return {
              reserved: false,
              reason: 'ledger_capacity',
              retryAfterSeconds: retryAfter(timestamp),
            }
          }
          if (
            committedUnits() + activeReservedUnits + requestedUnits >
            windowBudgetUnits
          ) {
            return {
              reserved: false,
              reason: 'window_budget',
              retryAfterSeconds: retryAfter(timestamp),
            }
          }

          activeReservedUnits += requestedUnits
          executionActiveUnits += requestedUnits
          let reconciliation: UsageReconciliation | undefined

          return {
            reserved: true,
            reservation: {
              reservedUnits: requestedUnits,
              reconcile(outcome) {
                if (reconciliation) return reconciliation

                let chargedUnits = requestedUnits
                let usageComplete = false
                if (outcome.kind === 'not_sent') {
                  chargedUnits = 0
                  usageComplete = true
                } else if (outcome.kind === 'reported') {
                  chargedUnits = Math.max(0, outcome.usage.totalTokens)
                  usageComplete = true
                }

                activeReservedUnits = Math.max(
                  0,
                  activeReservedUnits - requestedUnits,
                )
                executionActiveUnits = Math.max(
                  0,
                  executionActiveUnits - requestedUnits,
                )
                executionChargedUnits += chargedUnits
                if (chargedUnits > 0) {
                  const timestamp = now()
                  if (ledger.length >= maxLedgerEntries) {
                    const last = ledger.at(-1)
                    if (last) {
                      last.at = timestamp
                      last.units += chargedUnits
                    }
                  } else {
                    ledger.push({ at: timestamp, units: chargedUnits })
                  }
                }
                reconciliation = {
                  reservedUnits: requestedUnits,
                  chargedUnits,
                  usageComplete,
                  overReservationUnits: Math.max(
                    0,
                    chargedUnits - requestedUnits,
                  ),
                  outcome: outcome.kind,
                }
                return reconciliation
              },
            },
          }
        },
      }
    },
  }
}

export function estimateModelInputTokens(input: {
  readonly messages: unknown
  readonly tools: unknown
}) {
  return (
    Buffer.byteLength(JSON.stringify(input), 'utf8') +
    CHAT_MODEL_INPUT_MARGIN_UNITS
  )
}

function failureOutcome(error: unknown): UsageReconciliationOutcome {
  if (error instanceof AgentModelError) {
    if (!error.transportStarted) return { kind: 'not_sent' }
    if (error.code === 'MODEL_TIMEOUT') return { kind: 'timeout' }
    if (error.code === 'MODEL_CANCELLED') return { kind: 'cancelled' }
  }
  return { kind: 'possibly_sent' }
}

function abortError(signal: AbortSignal) {
  if (signal.reason instanceof AgentModelError) return signal.reason
  return new AgentModelError('MODEL_CANCELLED', true)
}

function raceModelWithAbort(
  promise: Promise<AgentModelResult>,
  signal: AbortSignal,
) {
  if (signal.aborted) return Promise.reject(abortError(signal))

  return new Promise<AgentModelResult>((resolve, reject) => {
    const abort = () => {
      signal.removeEventListener('abort', abort)
      reject(abortError(signal))
    }
    signal.addEventListener('abort', abort, { once: true })
    promise.then(
      (result) => {
        signal.removeEventListener('abort', abort)
        resolve(result)
      },
      (error: unknown) => {
        signal.removeEventListener('abort', abort)
        reject(error)
      },
    )
  })
}

export function createBudgetedAgentModel(options: {
  readonly model: AgentModelPort
  readonly budget: UsageBudgetExecution
  readonly onUsage?: (event: BudgetedModelUsageEvent) => void
}): AgentModelPort {
  const notify = (event: BudgetedModelUsageEvent) => {
    try {
      options.onUsage?.(event)
    } catch {
      // Observabilidade nunca altera contabilização ou resposta.
    }
  }

  return {
    async complete(input): Promise<AgentModelResult> {
      if (input.signal.aborted) throw abortError(input.signal)
      const maxOutputTokens = input.maxOutputTokens ?? 512
      const estimatedInputTokens = estimateModelInputTokens(input)
      const reserved = options.budget.reserve({
        estimatedInputTokens,
        maxOutputTokens,
      })
      if (!reserved.reserved) {
        throw new AgentModelError('LOCAL_BUDGET_EXHAUSTED', false)
      }

      try {
        const result = await raceModelWithAbort(
          options.model.complete({
            ...input,
            maxOutputTokens,
          }),
          input.signal,
        )
        const outcome: UsageReconciliationOutcome = result.usage
          ? { kind: 'reported', usage: result.usage }
          : { kind: 'sent_without_usage' }
        const reconciled = reserved.reservation.reconcile(outcome)
        notify({
          ...reconciled,
          estimatedInputTokens,
          requestedOutputTokens: maxOutputTokens,
          ...(result.usage ? { reportedUsage: result.usage } : {}),
        })
        return result
      } catch (error) {
        const reconciled = reserved.reservation.reconcile(
          failureOutcome(error),
        )
        notify({
          ...reconciled,
          estimatedInputTokens,
          requestedOutputTokens: maxOutputTokens,
        })
        throw error
      }
    },
  }
}
