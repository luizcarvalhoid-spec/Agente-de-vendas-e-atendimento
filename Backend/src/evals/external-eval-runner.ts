import { createHash } from 'node:crypto'

import {
  AgentModelError,
  type AgentModelPort,
} from '../agent/agent-model-port.js'
import { isRegisteredExternalAgentModel } from '../agent/agent-model-origin.js'
import {
  createOpenRouterAgentModel,
  type OpenRouterAgentModelObservation,
} from '../agent/openrouter/openrouter-agent-model.js'
import {
  createOpenRouterClient,
  type OpenRouterTransport,
} from '../agent/openrouter/openrouter-client.js'
import { TOOL_ORCHESTRATOR_MAX_MODEL_CALLS } from '../agent/tool-orchestrator.js'
import { loadCatalogRepository } from '../catalog/catalog-repository.js'
import { createEvalCanonicalData } from './eval-assertion-engine.js'
import { ExternalEvalCostController } from './external-eval-cost.js'
import { planExternalEval } from './external-eval-plan.js'
import {
  EXTERNAL_EVAL_REPORT_VERSION,
  externalEvalReportSchema,
  type ExternalEvalPlanRequest,
  type ExternalEvalReport,
} from './external-eval-schema.js'
import {
  buildEvalReport,
  sanitizeEvalReportText,
} from './eval-report-builder.js'
import type { EvalCase } from './eval-dataset-schema.js'
import type { OfflineEvalTraceCollector } from './offline-eval-trace.js'
import {
  createEvalScenarioRuntimeFactory,
  runOfflineEvalDataset,
} from './offline-eval-runner.js'

export const EXTERNAL_EVAL_LIMITATIONS = [
  'A modalidade mock_external usa transporte simulado e não mede desempenho real de um modelo externo.',
  'O isolamento mock exige uma factory registrada e rejeita adaptadores externos conhecidos, mas não transforma código arbitrário injetado em uma sandbox de rede.',
  'A EVAL-07B.1 mantém live_external bloqueado e testa a integração OpenRouter somente com transporte em memória.',
  'O custo é uma estimativa preventiva; a cobrança final futura poderá diferir e deverá ter limites também na conta do provedor.',
  'Chamadas sem usage completo conservam a reserva com a margem configurada.',
  'Assertions determinísticas não substituem a avaliação humana dos critérios subjetivos.',
  'A avaliação objetiva é aplicada às evidências da execução externa, sem alterar o contrato offline EVAL-05.',
] as const

export type ExternalEvalExecutionErrorCode =
  | 'PLAN_BLOCKED'
  | 'MOCK_MODEL_REQUIRED'
  | 'EXTERNAL_MODEL_FORBIDDEN'
  | 'LIVE_EXTERNAL_DISABLED'

export class ExternalEvalExecutionError extends Error {
  readonly code: ExternalEvalExecutionErrorCode

  constructor(code: ExternalEvalExecutionErrorCode) {
    super('A execução EVAL-07 foi bloqueada de forma controlada.')
    this.name = 'ExternalEvalExecutionError'
    this.code = code
  }
}

export interface MockExternalEvalModelContext {
  readonly scenario: EvalCase
  readonly trace: OfflineEvalTraceCollector
}

declare const mockExternalEvalModelBrand: unique symbol

export interface MockExternalEvalModel extends AgentModelPort {
  readonly [mockExternalEvalModelBrand]: true
}

const registeredMockModels = new WeakSet<AgentModelPort>()

export function createMockExternalEvalModel(
  model: AgentModelPort,
): MockExternalEvalModel {
  if (isRegisteredExternalAgentModel(model)) {
    throw new ExternalEvalExecutionError('EXTERNAL_MODEL_FORBIDDEN')
  }
  const mock: AgentModelPort = {
    complete: (input) => model.complete(input),
  }
  registeredMockModels.add(mock)
  return mock as MockExternalEvalModel
}

export interface RunMockExternalEvalOptions {
  readonly createModel: (
    context: MockExternalEvalModelContext,
  ) => MockExternalEvalModel
  readonly providerModelId?: string
}

declare const inMemoryOpenRouterTransportBrand: unique symbol

export type InMemoryOpenRouterTransport = OpenRouterTransport & {
  readonly [inMemoryOpenRouterTransportBrand]: true
}

const registeredInMemoryTransports = new WeakSet<OpenRouterTransport>()

export function createInMemoryOpenRouterTransport(
  handler: OpenRouterTransport,
): InMemoryOpenRouterTransport {
  if (handler === globalThis.fetch) {
    throw new ExternalEvalExecutionError('LIVE_EXTERNAL_DISABLED')
  }
  const transport: OpenRouterTransport = (input, init) =>
    handler(input, init)
  registeredInMemoryTransports.add(transport)
  return transport as InMemoryOpenRouterTransport
}

export interface RunSimulatedOpenRouterExternalEvalOptions {
  readonly transport: InMemoryOpenRouterTransport
}

interface RunControlledExternalEvalOptions {
  readonly createModel: (
    context: MockExternalEvalModelContext & {
      readonly modelId: string
      readonly routing: NonNullable<ExternalEvalReport['routing']> | undefined
    },
  ) => AgentModelPort
  readonly validateModel?: (model: AgentModelPort) => void
  readonly providerModelId?: string
  readonly observations: Array<
    ExternalEvalReport['model']['observations'][number]
  >
  readonly requireRouting?: boolean
}

function tracedModel(
  model: AgentModelPort,
  trace: OfflineEvalTraceCollector,
): AgentModelPort {
  return {
    async complete(input) {
      const result = await model.complete(input)
      trace.recordModelCall(result.message.toolCalls ?? [])
      return result
    },
  }
}

function turnEvidence(
  turn: Awaited<ReturnType<typeof runOfflineEvalDataset>>['scenarios'][number]['turns'][number],
) {
  const toolRejections = turn.trace.toolExecutions.filter(
    (execution) => execution.outcome === 'rejected',
  ).length
  const toolFailures = turn.trace.toolExecutions.filter(
    (execution) => execution.outcome === 'failed',
  ).length
  return {
    index: turn.turn,
    technicalStatus: turn.technicalStatus,
    ...(turn.response === undefined
      ? {}
      : { responseType: turn.response.type }),
    ...(turn.error === undefined
      ? {}
      : { technicalErrorCode: turn.error.code }),
    modelCalls: turn.trace.modelCalls,
    toolCallsRequested: turn.trace.toolCalls.length,
    toolsExecuted: turn.trace.toolExecutions.filter(
      (execution) => execution.executed,
    ).length,
    toolRejections,
    toolFailures,
    earlyCompletion: turn.trace.earlyCompletion !== undefined,
    grounding: { ...turn.trace.grounding },
  }
}

async function runControlledExternalEval(
  request: ExternalEvalPlanRequest,
  options: RunControlledExternalEvalOptions,
): Promise<ExternalEvalReport> {
  const planned = await planExternalEval(request)
  const { plan, loaded } = planned
  if (
    plan.modality !== 'mock_external' ||
    plan.status !== 'ready' ||
    !plan.executionAllowed ||
    loaded === undefined ||
    plan.modelId === undefined ||
    plan.limits === undefined ||
    plan.pricing === undefined ||
    plan.maxBudgetUsd === undefined ||
    plan.unreportedUsageMultiplier === undefined
    || (options.requireRouting === true && plan.routing === undefined)
  ) {
    throw new ExternalEvalExecutionError('PLAN_BLOCKED')
  }

  const catalog = await loadCatalogRepository()
  const sanitizedRequestedModelId = sanitizeEvalReportText(plan.modelId)
  const sanitizedProviderModelId =
    options.providerModelId === undefined
      ? undefined
      : sanitizeEvalReportText(options.providerModelId)
  const costs = new ExternalEvalCostController({
    requestedModelId: sanitizedRequestedModelId,
    ...(sanitizedProviderModelId === undefined
      ? {}
      : { providerModelId: sanitizedProviderModelId }),
    limits: plan.limits,
    pricing: plan.pricing,
    maxBudgetUsd: plan.maxBudgetUsd,
    unreportedUsageMultiplier: plan.unreportedUsageMultiplier,
  })
  const runtimeFactory = await createEvalScenarioRuntimeFactory({
    catalog,
    timeoutMs: plan.limits.timeoutMs,
    maxModelCalls: Math.min(
      plan.limits.maxModelCalls,
      TOOL_ORCHESTRATOR_MAX_MODEL_CALLS,
    ),
    maxOutputTokens: plan.limits.maxOutputTokensPerCall,
    createModel(trace, scenario) {
      const raw = options.createModel({
        scenario,
        trace,
        modelId: plan.modelId!,
        routing: plan.routing,
      })
      options.validateModel?.(raw)
      return costs.wrap(tracedModel(raw, trace))
    },
  })
  const execution = await runOfflineEvalDataset(loaded, {
    scenarioIds: plan.selectedScenarioIds,
    createScenarioRuntime: runtimeFactory,
    evaluateAssertions: true,
    canonicalData: createEvalCanonicalData(catalog),
  })
  const objectiveReport = buildEvalReport(loaded, execution)
  const costSnapshot = costs.snapshot()
  const transportedCalls = costSnapshot.calls.filter(
    (call) => call.status !== 'rejected',
  )
  const reportedInputTokens = costSnapshot.calls.reduce(
    (total, call) => total + (call.reportedInputTokens ?? 0),
    0,
  )
  const reportedOutputTokens = costSnapshot.calls.reduce(
    (total, call) => total + (call.reportedOutputTokens ?? 0),
    0,
  )
  const reportedTotalTokens = costSnapshot.calls.reduce(
    (total, call) => total + (call.reportedTotalTokens ?? 0),
    0,
  )
  const estimatedTokens = transportedCalls.reduce(
    (total, call) =>
      total + call.estimatedInputTokens + call.requestedOutputTokens,
    0,
  )
  const estimatedCostUsd = transportedCalls.reduce(
    (total, call) => total + call.estimatedCostUsd,
    0,
  )
  const scenarios = execution.scenarios.map((scenario) => ({
    id: scenario.scenarioId,
    technicalStatus: scenario.technicalStatus,
    turns: scenario.turns.map(turnEvidence),
  }))
  const turns = scenarios.flatMap((scenario) => scenario.turns)
  const providerReportedIds = [
    ...new Set(
      costSnapshot.calls.flatMap((call) =>
        call.providerModelId === undefined ? [] : [call.providerModelId],
      ),
    ),
  ]
  const providerIds = [
    ...new Set(
      options.observations.flatMap((observation) =>
        observation.providerId === undefined
          ? []
          : [observation.providerId],
      ),
    ),
  ]
  const returnedIds = [
    ...new Set(
      options.observations.length === 0
        ? providerReportedIds
        : options.observations.map(
            (observation) => observation.returnedModelId,
          ),
    ),
  ]
  const executionId = `external-${createHash('sha256')
    .update(JSON.stringify({
      dataset: loaded.data.dataset,
      scenarios: plan.selectedScenarioIds,
      modelId: sanitizedRequestedModelId,
      routing: plan.routing,
      generations: options.observations.map(
        (observation) => observation.generationId,
      ),
    }))
    .digest('hex')
    .slice(0, 20)}`
  return externalEvalReportSchema.parse({
    reportVersion: EXTERNAL_EVAL_REPORT_VERSION,
    modality: 'mock_external',
    provenance: 'simulated_external_transport',
    performanceEvidence: 'not_real_model_performance',
    executionId,
    dataset: {
      id: loaded.data.dataset.id,
      version: loaded.data.dataset.version,
    },
    selectedScenarioIds: [...plan.selectedScenarioIds],
    model: {
      requestedId: sanitizedRequestedModelId,
      providerReportedIds,
      providerIds,
      returnedIds,
      observations: options.observations,
    },
    ...(plan.routing === undefined ? {} : { routing: plan.routing }),
    limits: plan.limits,
    execution: {
      technicalStatus: execution.technicalStatus,
      scenarios: execution.summary.scenarios,
      completedScenarios: execution.summary.completed,
      technicalFailures: execution.summary.technicalFailures,
      completedTurns: turns.filter(
        (turn) => turn.technicalStatus === 'completed',
      ).length,
      modelCalls: transportedCalls.length,
      toolCallsRequested: turns.reduce(
        (total, turn) => total + turn.toolCallsRequested,
        0,
      ),
      toolsExecuted: turns.reduce(
        (total, turn) => total + turn.toolsExecuted,
        0,
      ),
      toolRejections: turns.reduce(
        (total, turn) => total + turn.toolRejections,
        0,
      ),
      toolFailures: turns.reduce(
        (total, turn) => total + turn.toolFailures,
        0,
      ),
      earlyCompletions: turns.filter((turn) => turn.earlyCompletion).length,
      limitsReached: costSnapshot.limitsReached,
    },
    consumption: {
      reportedInputTokens,
      reportedOutputTokens,
      reportedTotalTokens,
      estimatedTokens,
      callsWithoutCompleteUsage: transportedCalls.filter(
        (call) => !call.usageComplete,
      ).length,
      estimatedCostUsd,
      chargedCostUsd: costSnapshot.chargedCostUsd,
      maxBudgetUsd: plan.maxBudgetUsd,
      costIsEstimate: true,
      overReservedTokens: costSnapshot.overReservedTokens,
      overReservedCostUsd: costSnapshot.overReservedCostUsd,
    },
    modelCalls: costSnapshot.calls,
    scenarios,
    objectiveEvaluation: {
      coverage: objectiveReport.coverage,
      summary: objectiveReport.summary,
      scenarios: objectiveReport.scenarios,
    },
    humanReview: {
      pending: objectiveReport.summary.requiredHumanCriteriaPending > 0,
      exportPrepared: false,
    },
    limitations: [...EXTERNAL_EVAL_LIMITATIONS],
  })
}

export async function runMockExternalEval(
  request: ExternalEvalPlanRequest,
  options: RunMockExternalEvalOptions,
) {
  return runControlledExternalEval(request, {
    observations: [],
    ...(options.providerModelId === undefined
      ? {}
      : { providerModelId: options.providerModelId }),
    createModel: ({ scenario, trace }) =>
      options.createModel({ scenario, trace }),
    validateModel(raw) {
      if (
        !registeredMockModels.has(raw) ||
        isRegisteredExternalAgentModel(raw)
      ) {
        throw new ExternalEvalExecutionError(
          isRegisteredExternalAgentModel(raw)
            ? 'EXTERNAL_MODEL_FORBIDDEN'
            : 'MOCK_MODEL_REQUIRED',
        )
      }
    },
  })
}

function reportObservation(
  observation: OpenRouterAgentModelObservation,
  ordinal: number,
): ExternalEvalReport['model']['observations'][number] {
  return {
    ordinal,
    generationId: sanitizeEvalReportText(observation.generationId),
    returnedModelId: sanitizeEvalReportText(
      observation.returnedModelId,
    ),
    ...(observation.providerId === undefined
      ? {}
      : {
          providerId: sanitizeEvalReportText(observation.providerId),
        }),
    finishReason:
      observation.finishReason === null ||
      observation.finishReason.trim().length === 0
        ? null
        : sanitizeEvalReportText(observation.finishReason),
    usageStatus: observation.usageStatus,
    ...(observation.reportedUsage === undefined
      ? {}
      : {
          reportedInputTokens: observation.reportedUsage.inputTokens,
          reportedOutputTokens: observation.reportedUsage.outputTokens,
          reportedTotalTokens: observation.reportedUsage.totalTokens,
        }),
    modelIdentityMatches: observation.modelIdentityMatches === true,
    ...(observation.providerIdentityMatches === undefined
      ? {}
      : {
          providerIdentityMatches:
            observation.providerIdentityMatches,
        }),
  }
}

export async function runSimulatedOpenRouterExternalEval(
  request: ExternalEvalPlanRequest,
  options: RunSimulatedOpenRouterExternalEvalOptions,
) {
  if (
    !registeredInMemoryTransports.has(options.transport) ||
    options.transport === globalThis.fetch
  ) {
    throw new ExternalEvalExecutionError('LIVE_EXTERNAL_DISABLED')
  }
  const observations: ExternalEvalReport['model']['observations'] = []
  let identityDiverged = false
  return runControlledExternalEval(request, {
    requireRouting: true,
    observations,
    createModel({ modelId, routing }) {
      if (routing === undefined) {
        throw new ExternalEvalExecutionError('PLAN_BLOCKED')
      }
      const client = createOpenRouterClient({
        apiKey: 'EVAL_07B_SIMULATED_KEY',
        model: modelId,
        transport: options.transport,
        timeoutMs: request.limits?.timeoutMs,
        maxOutputTokens: request.limits?.maxOutputTokensPerCall,
        evaluationRouting: routing,
      })
      const externalModel = createOpenRouterAgentModel(client, {
        expectedModelId: modelId,
        expectedProviderId: routing.providerId,
        onObservation(observation) {
          observations.push(
            reportObservation(observation, observations.length + 1),
          )
          if (
            observation.modelIdentityMatches === false ||
            observation.providerIdentityMatches === false
          ) {
            identityDiverged = true
          }
        },
      })
      return {
        complete(input) {
          if (identityDiverged) {
            throw new AgentModelError('INVALID_MODEL_RESPONSE', false)
          }
          return externalModel.complete(input)
        },
      }
    },
  })
}

export async function runLiveExternalEval(): Promise<never> {
  throw new ExternalEvalExecutionError('LIVE_EXTERNAL_DISABLED')
}
