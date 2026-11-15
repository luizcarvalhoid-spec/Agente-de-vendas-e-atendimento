import type { AgentModelPort } from '../agent/agent-model-port.js'
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
  'A EVAL-07A bloqueia live_external e não autoriza chamadas de rede ou potencialmente pagas.',
  'O custo é uma estimativa preventiva; a cobrança final futura poderá diferir e deverá ter limites também na conta do provedor.',
  'Chamadas sem usage completo conservam a reserva com a margem configurada.',
  'Assertions determinísticas não substituem a avaliação humana dos critérios subjetivos.',
  'A avaliação objetiva é aplicada às evidências da execução externa, sem alterar o contrato offline EVAL-05.',
] as const

export type ExternalEvalExecutionErrorCode =
  | 'PLAN_BLOCKED'
  | 'MOCK_MODEL_REQUIRED'
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

export interface RunMockExternalEvalOptions {
  readonly createModel: (
    context: MockExternalEvalModelContext,
  ) => AgentModelPort
  readonly providerModelId?: string
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

export async function runMockExternalEval(
  request: ExternalEvalPlanRequest,
  options: RunMockExternalEvalOptions,
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
      const raw = options.createModel({ scenario, trace })
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
  return externalEvalReportSchema.parse({
    reportVersion: EXTERNAL_EVAL_REPORT_VERSION,
    modality: 'mock_external',
    provenance: 'simulated_external_transport',
    performanceEvidence: 'not_real_model_performance',
    dataset: {
      id: loaded.data.dataset.id,
      version: loaded.data.dataset.version,
    },
    selectedScenarioIds: [...plan.selectedScenarioIds],
    model: {
      requestedId: sanitizedRequestedModelId,
      providerReportedIds,
    },
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

export async function runLiveExternalEval(): Promise<never> {
  throw new ExternalEvalExecutionError('LIVE_EXTERNAL_DISABLED')
}
