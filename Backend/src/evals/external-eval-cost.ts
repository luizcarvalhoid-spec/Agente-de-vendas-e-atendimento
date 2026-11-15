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

export function externalEvalWorstCaseCost(plan: Pick<
  ExternalEvalPlan,
  'limits' | 'pricing' | 'unreportedUsageMultiplier'
>) {
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

function abortedError(signal: AbortSignal) {
  if (signal.reason instanceof AgentModelError) return signal.reason
  return new AgentModelError('MODEL_CANCELLED', false)
}

export interface ExternalEvalCostControllerOptions {
  readonly requestedModelId: string
  readonly providerModelId?: string
  readonly limits: NonNullable<ExternalEvalPlan['limits']>
  readonly pricing: NonNullable<ExternalEvalPlan['pricing']>
  readonly maxBudgetUsd: number
  readonly unreportedUsageMultiplier: number
}

export class ExternalEvalCostController {
  private readonly events: ExternalEvalModelCall[] = []
  private readonly reached = new Set<string>()
  private chargedTokens = 0
  private chargedCostUsd = 0
  private transportedCalls = 0
  private ordinal = 0

  constructor(private readonly options: ExternalEvalCostControllerOptions) {}

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
          this.rejectedEvent(
            'MODEL_CANCELLED',
            estimatedInputTokens,
            requestedOutputTokens,
          )
          throw abortedError(input.signal)
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
        if (this.transportedCalls >= this.options.limits.maxModelCalls) {
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
          this.chargedTokens + reservedTokens >
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
          roundMoney(this.chargedCostUsd + reservedCost) >
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

        this.transportedCalls += 1
        this.ordinal += 1
        const ordinal = this.ordinal
        try {
          const result = await model.complete({
            ...input,
            maxOutputTokens: requestedOutputTokens,
          })
          const reported = result.usage
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
          this.chargedTokens += chargedTokens
          this.chargedCostUsd = roundMoney(
            this.chargedCostUsd + chargedCost,
          )
          this.markReachedLimits()
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
          })
          return result
        } catch (error) {
          const status = errorStatus(error)
          const transportStarted =
            !(error instanceof AgentModelError) || error.transportStarted
          const chargedCost = transportStarted ? reservedCost : 0
          const chargedTokens = transportStarted ? reservedTokens : 0
          this.chargedCostUsd = roundMoney(
            this.chargedCostUsd + chargedCost,
          )
          this.chargedTokens += chargedTokens
          this.markReachedLimits()
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
          })
          throw error
        }
      },
    }
  }

  snapshot() {
    return {
      calls: this.events.map((event) => ({ ...event })),
      limitsReached: [...this.reached].sort(),
      chargedCostUsd: this.chargedCostUsd,
      chargedTokens: this.chargedTokens,
      transportedCalls: this.transportedCalls,
    }
  }
}
