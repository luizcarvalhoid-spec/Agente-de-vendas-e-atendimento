import {
  AgentModelError,
  type AgentModelPort,
  type AgentModelResult,
} from '../agent/agent-model-port.js'
import { estimateModelInputTokens } from '../agent/usage-budget-controller.js'
import type {
  ExternalEvalModelCall,
  ExternalEvalPlan,
} from './external-eval-schema.js'

function roundMoney(value: number) {
  return Math.round((value + Number.EPSILON) * 100_000_000) / 100_000_000
}

export function estimateExternalEvalCost(input: {
  readonly inputTokens: number
  readonly outputTokens: number
  readonly inputUsdPerMillionTokens: number
  readonly outputUsdPerMillionTokens: number
  readonly multiplier?: number
}) {
  const base =
    (input.inputTokens * input.inputUsdPerMillionTokens +
      input.outputTokens * input.outputUsdPerMillionTokens) /
    1_000_000
  return roundMoney(base * (input.multiplier ?? 1))
}

export function externalEvalWorstCaseCost(plan:
  Pick<ExternalEvalPlan, 'limits' | 'unreportedUsageMultiplier'> & {
    pricing?: Pick<NonNullable<ExternalEvalPlan['pricing']>, 'inputUsdPerMillionTokens' | 'outputUsdPerMillionTokens'>
  }
) {
  if (
    plan.limits === undefined ||
    plan.pricing === undefined ||
    plan.unreportedUsageMultiplier === undefined
  ) {
    return undefined
  }
  return roundMoney(
    plan.limits.maxModelCalls *
      estimateExternalEvalCost({
        inputTokens: plan.limits.estimatedInputTokensPerCall,
        outputTokens: plan.limits.maxOutputTokensPerCall,
        inputUsdPerMillionTokens:
          plan.pricing.inputUsdPerMillionTokens,
        outputUsdPerMillionTokens:
          plan.pricing.outputUsdPerMillionTokens,
        multiplier: plan.unreportedUsageMultiplier,
      }),
  )
}

function errorStatus(error: unknown): ExternalEvalModelCall['status'] {
  if (!(error instanceof AgentModelError)) return 'failed'
  if (!error.transportStarted) return 'rejected'
  if (error.code === 'MODEL_TIMEOUT') return 'timeout'
  if (error.code === 'MODEL_CANCELLED') return 'cancelled'
  return 'failed'
}

function errorCode(error: unknown) {
  return error instanceof AgentModelError
    ? error.code
    : 'UNEXPECTED_MODEL_FAILURE'
}

function abortedError(signal: AbortSignal, transportStarted: boolean) {
  if (signal.reason instanceof AgentModelError) {
    if (!transportStarted || signal.reason.transportStarted) {
      return signal.reason
    }
    return new AgentModelError(signal.reason.code, true)
  }
  return new AgentModelError('MODEL_CANCELLED', transportStarted)
}

function raceModelWithAbort(
  promise: Promise<AgentModelResult>,
  signal: AbortSignal,
) {
  if (signal.aborted) {
    // A chamada assíncrona pode ter acionado o cancelamento antes de devolver a promessa.
    void promise.catch(() => undefined)
    return Promise.reject(abortedError(signal, true))
  }
  return new Promise<AgentModelResult>((resolve, reject) => {
    const abort = () => {
      signal.removeEventListener('abort', abort)
      reject(abortedError(signal, true))
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

function completeUsage(
  usage: AgentModelResult['usage'],
): NonNullable<AgentModelResult['usage']> | undefined {
  if (
    usage === undefined ||
    !Number.isSafeInteger(usage.inputTokens) ||
    !Number.isSafeInteger(usage.outputTokens) ||
    !Number.isSafeInteger(usage.totalTokens) ||
    usage.inputTokens < 0 ||
    usage.outputTokens < 0 ||
    usage.totalTokens !== usage.inputTokens + usage.outputTokens
  ) {
    return undefined
  }
  return usage
}

interface ActiveReservation {
  readonly tokens: number
  readonly costUsd: number
}

export interface ExternalEvalCostControllerOptions {
  readonly requestedModelId: string
  readonly providerModelId?: string
  readonly limits: NonNullable<ExternalEvalPlan['limits']>
  readonly pricing: NonNullable<ExternalEvalPlan['pricing']>
  readonly maxBudgetUsd: number
  readonly unreportedUsageMultiplier: number
  readonly maxInputTokensPerCall?: number
  readonly cancellableBeforeTransport?: boolean
}

export class ExternalEvalCostController {
  private readonly events: ExternalEvalModelCall[] = []
  private readonly reached = new Set<string>()
  private readonly activeReservations = new Map<number, ActiveReservation>()
  private chargedTokens = 0
  private chargedCostUsd = 0
  private transportedCalls = 0
  private ordinal = 0

  constructor(private readonly options: ExternalEvalCostControllerOptions) {}

  private activeReservedTokens() {
    return [...this.activeReservations.values()].reduce(
      (total, reservation) => total + reservation.tokens,
      0,
    )
  }

  private activeReservedCostUsd() {
    return roundMoney(
      [...this.activeReservations.values()].reduce(
        (total, reservation) => total + reservation.costUsd,
        0,
      ),
    )
  }

  private markReachedLimits() {
    if (this.transportedCalls >= this.options.limits.maxModelCalls) {
      this.reached.add('max_model_calls')
    }
    if (this.chargedTokens >= this.options.limits.maxExecutionTokens) {
      this.reached.add('max_execution_tokens')
    }
    if (this.chargedCostUsd >= this.options.maxBudgetUsd) {
      this.reached.add('max_budget_usd')
    }
  }

  private reserveCost(inputTokens: number, outputTokens: number) {
    return estimateExternalEvalCost({
      inputTokens,
      outputTokens,
      inputUsdPerMillionTokens:
        this.options.pricing.inputUsdPerMillionTokens,
      outputUsdPerMillionTokens:
        this.options.pricing.outputUsdPerMillionTokens,
      multiplier: this.options.unreportedUsageMultiplier,
    })
  }

  private reconcile(
    ordinal: number,
    input: {
      readonly transportStarted: boolean
      readonly chargedTokens: number
      readonly chargedCostUsd: number
      readonly overReservedTokens: number
      readonly overReservedCostUsd: number
    },
  ) {
    if (!this.activeReservations.delete(ordinal)) {
      throw new TypeError('A reserva da avaliação externa já foi reconciliada.')
    }
    if (input.transportStarted) {
      this.transportedCalls += 1
      this.chargedTokens += input.chargedTokens
      this.chargedCostUsd = roundMoney(
        this.chargedCostUsd + input.chargedCostUsd,
      )
    }
    if (
      input.overReservedTokens > 0 ||
      input.overReservedCostUsd > 0
    ) {
      this.reached.add('reported_usage_exceeded_reservation')
    }
    this.markReachedLimits()
  }

  private rejectedEvent(
    errorCodeValue: string,
    estimatedInputTokens: number,
    requestedOutputTokens: number,
  ) {
    this.ordinal += 1
    this.events.push({
      ordinal: this.ordinal,
      requestedModelId: this.options.requestedModelId,
      ...(this.options.providerModelId === undefined
        ? {}
        : { providerModelId: this.options.providerModelId }),
      status: 'rejected',
      errorCode: errorCodeValue,
      estimatedInputTokens,
      requestedOutputTokens,
      usageComplete: true,
      estimatedCostUsd: 0,
      chargedCostUsd: 0,
      overReservedTokens: 0,
      overReservedCostUsd: 0,
    })
  }

  wrap(model: AgentModelPort): AgentModelPort {
    return {
      complete: async (input): Promise<AgentModelResult> => {
        const requestedOutputTokens =
          input.maxOutputTokens ?? this.options.limits.maxOutputTokensPerCall
        const estimatedInputTokens = Math.max(
          this.options.limits.estimatedInputTokensPerCall,
          estimateModelInputTokens(input),
        )
        if (input.signal.aborted) {
          const error = abortedError(input.signal, false)
          this.rejectedEvent(
            error.code,
            estimatedInputTokens,
            requestedOutputTokens,
          )
          throw error
        }
        if (this.reached.has('reported_usage_exceeded_reservation')) {
          this.rejectedEvent(
            'LOCAL_BUDGET_EXHAUSTED',
            estimatedInputTokens,
            requestedOutputTokens,
          )
          throw new AgentModelError('LOCAL_BUDGET_EXHAUSTED', false)
        }
        if (
          this.options.maxInputTokensPerCall !== undefined &&
          estimatedInputTokens > this.options.maxInputTokensPerCall
        ) {
          this.reached.add('max_input_tokens_per_call')
          this.rejectedEvent(
            'LOCAL_BUDGET_EXHAUSTED',
            estimatedInputTokens,
            requestedOutputTokens,
          )
          throw new AgentModelError('LOCAL_BUDGET_EXHAUSTED', false)
        }
        if (
          requestedOutputTokens >
          this.options.limits.maxOutputTokensPerCall
        ) {
          this.reached.add('max_output_tokens_per_call')
          this.rejectedEvent(
            'LOCAL_BUDGET_EXHAUSTED',
            estimatedInputTokens,
            requestedOutputTokens,
          )
          throw new AgentModelError('LOCAL_BUDGET_EXHAUSTED', false)
        }
        if (
          this.transportedCalls + this.activeReservations.size >=
          this.options.limits.maxModelCalls
        ) {
          this.reached.add('max_model_calls')
          this.rejectedEvent(
            'LOCAL_BUDGET_EXHAUSTED',
            estimatedInputTokens,
            requestedOutputTokens,
          )
          throw new AgentModelError('LOCAL_BUDGET_EXHAUSTED', false)
        }

        const reservedTokens =
          estimatedInputTokens + requestedOutputTokens
        if (
          this.chargedTokens +
            this.activeReservedTokens() +
            reservedTokens >
          this.options.limits.maxExecutionTokens
        ) {
          this.reached.add('max_execution_tokens')
          this.rejectedEvent(
            'LOCAL_BUDGET_EXHAUSTED',
            estimatedInputTokens,
            requestedOutputTokens,
          )
          throw new AgentModelError('LOCAL_BUDGET_EXHAUSTED', false)
        }
        const reservedCost = this.reserveCost(
          estimatedInputTokens,
          requestedOutputTokens,
        )
        if (
          roundMoney(
            this.chargedCostUsd +
              this.activeReservedCostUsd() +
              reservedCost,
          ) >
          this.options.maxBudgetUsd
        ) {
          this.reached.add('max_budget_usd')
          this.rejectedEvent(
            'LOCAL_BUDGET_EXHAUSTED',
            estimatedInputTokens,
            requestedOutputTokens,
          )
          throw new AgentModelError('LOCAL_BUDGET_EXHAUSTED', false)
        }

        this.ordinal += 1
        const ordinal = this.ordinal
        this.activeReservations.set(ordinal, {
          tokens: reservedTokens,
          costUsd: reservedCost,
        })
        let result: AgentModelResult
        try {
          if (this.options.cancellableBeforeTransport) {
            await Promise.resolve()
            if (input.signal.aborted) {
              throw new AgentModelError(abortedError(input.signal, false).code, false)
            }
          }
          result = await raceModelWithAbort(
            model.complete({
              ...input,
              maxOutputTokens: requestedOutputTokens,
            }),
            input.signal,
          )
        } catch (error) {
          const status = errorStatus(error)
          const transportStarted =
            !(error instanceof AgentModelError) || error.transportStarted
          const chargedCost = transportStarted ? reservedCost : 0
          const chargedTokens = transportStarted ? reservedTokens : 0
          this.reconcile(ordinal, {
            transportStarted,
            chargedTokens,
            chargedCostUsd: chargedCost,
            overReservedTokens: 0,
            overReservedCostUsd: 0,
          })
          this.events.push({
            ordinal,
            requestedModelId: this.options.requestedModelId,
            ...(this.options.providerModelId === undefined
              ? {}
              : { providerModelId: this.options.providerModelId }),
            status,
            errorCode: errorCode(error),
            estimatedInputTokens,
            requestedOutputTokens,
            usageComplete: !transportStarted,
            estimatedCostUsd: reservedCost,
            chargedCostUsd: chargedCost,
            overReservedTokens: 0,
            overReservedCostUsd: 0,
          })
          throw error
        }
        const reported = completeUsage(result.usage)
        const chargedTokens = reported?.totalTokens ?? reservedTokens
        const chargedCost = reported
          ? estimateExternalEvalCost({
              inputTokens: reported.inputTokens,
              outputTokens: reported.outputTokens,
              inputUsdPerMillionTokens:
                this.options.pricing.inputUsdPerMillionTokens,
              outputUsdPerMillionTokens:
                this.options.pricing.outputUsdPerMillionTokens,
            })
          : reservedCost
        const overReservedTokens = Math.max(
          0,
          chargedTokens - reservedTokens,
        )
        const overReservedCostUsd = roundMoney(
          Math.max(0, chargedCost - reservedCost),
        )
        this.reconcile(ordinal, {
          transportStarted: true,
          chargedTokens,
          chargedCostUsd: chargedCost,
          overReservedTokens,
          overReservedCostUsd,
        })
        this.events.push({
          ordinal,
          requestedModelId: this.options.requestedModelId,
          ...(this.options.providerModelId === undefined
            ? {}
            : { providerModelId: this.options.providerModelId }),
          status: 'completed',
          estimatedInputTokens,
          requestedOutputTokens,
          ...(reported === undefined
            ? {}
            : {
                reportedInputTokens: reported.inputTokens,
                reportedOutputTokens: reported.outputTokens,
                reportedTotalTokens: reported.totalTokens,
              }),
          usageComplete: reported !== undefined,
          estimatedCostUsd: reservedCost,
          chargedCostUsd: chargedCost,
          overReservedTokens,
          overReservedCostUsd,
        })
        return result
      },
    }
  }

  snapshot() {
    const activeReservedTokens = this.activeReservedTokens()
    const activeReservedCostUsd = this.activeReservedCostUsd()
    const overReservedTokens = this.events.reduce(
      (total, event) => total + event.overReservedTokens,
      0,
    )
    const overReservedCostUsd = roundMoney(
      this.events.reduce(
        (total, event) => total + event.overReservedCostUsd,
        0,
      ),
    )
    return {
      calls: this.events
        .map((event) => ({ ...event }))
        .sort((left, right) => left.ordinal - right.ordinal),
      limitsReached: [...this.reached].sort(),
      chargedCostUsd: this.chargedCostUsd,
      chargedTokens: this.chargedTokens,
      transportedCalls: this.transportedCalls,
      overReservedTokens,
      overReservedCostUsd,
      activeReservations: this.activeReservations.size,
      activeReservedTokens,
      activeReservedCostUsd,
      preventiveAvailableCalls: Math.max(
        0,
        this.options.limits.maxModelCalls -
          this.transportedCalls -
          this.activeReservations.size,
      ),
      preventiveAvailableTokens: Math.max(
        0,
        this.options.limits.maxExecutionTokens -
          this.chargedTokens -
          activeReservedTokens,
      ),
      preventiveAvailableCostUsd: Math.max(
        0,
        roundMoney(
          this.options.maxBudgetUsd -
            this.chargedCostUsd -
            activeReservedCostUsd,
        ),
      ),
    }
  }
}
