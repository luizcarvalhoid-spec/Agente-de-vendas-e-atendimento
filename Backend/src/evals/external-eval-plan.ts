import { OPENROUTER_MAX_TIMEOUT_MS } from '../agent/openrouter/openrouter-client.js'
import { loadEvalDataset, type LoadedEvalDataset } from './eval-loader.js'
import { sanitizeEvalReportText } from './eval-report-builder.js'
import { resolveOfflineEvalDataset } from './offline-eval-runner.js'
import { externalEvalWorstCaseCost } from './external-eval-cost.js'
import {
  EXTERNAL_EVAL_PLAN_VERSION,
  externalEvalPlanRequestSchema,
  externalEvalPlanSchema,
  type ExternalEvalPlan,
  type ExternalEvalPlanRequest,
} from './external-eval-schema.js'

export class ExternalEvalPlanError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options)
    this.name = 'ExternalEvalPlanError'
  }
}

function blocker(
  code: ExternalEvalPlan['blockers'][number]['code'],
  detail: string,
) {
  return { code, detail }
}

async function tryLoadDataset(datasetId: string) {
  try {
    return await loadEvalDataset(resolveOfflineEvalDataset(datasetId))
  } catch {
    return undefined
  }
}

export interface PlannedExternalEval {
  readonly plan: ExternalEvalPlan
  readonly loaded?: LoadedEvalDataset
}

export async function planExternalEval(
  input: ExternalEvalPlanRequest,
): Promise<PlannedExternalEval> {
  const parsed = externalEvalPlanRequestSchema.safeParse(input)
  if (!parsed.success) {
    throw new ExternalEvalPlanError(
      'A configuração do preflight EVAL-07 é inválida.',
      { cause: parsed.error },
    )
  }
  const request = parsed.data
  const blockers: ExternalEvalPlan['blockers'][number][] = []
  const loaded = await tryLoadDataset(request.datasetId)
  if (loaded === undefined) {
    blockers.push(
      blocker(
        'DATASET_NOT_FOUND',
        'O dataset solicitado não existe ou não passou na validação.',
      ),
    )
  }

  let selectedScenarioIds = request.scenarioIds ?? []
  if (loaded !== undefined) {
    selectedScenarioIds =
      request.scenarioIds ?? loaded.data.cases.map((scenario) => scenario.id)
    if (new Set(selectedScenarioIds).size !== selectedScenarioIds.length) {
      blockers.push(
        blocker(
          'SCENARIO_DUPLICATED',
          'A seleção contém identificadores de cenário duplicados.',
        ),
      )
    }
    if (
      selectedScenarioIds.some(
        (scenarioId) =>
          !loaded.data.cases.some((scenario) => scenario.id === scenarioId),
      )
    ) {
      blockers.push(
        blocker(
          'SCENARIO_NOT_FOUND',
          'Ao menos um cenário selecionado não existe no dataset.',
        ),
      )
    }
  }

  if (request.modelId === undefined) {
    blockers.push(blocker('MODEL_REQUIRED', 'Informe explicitamente o modelo.'))
  }
  if (request.limits === undefined) {
    blockers.push(
      blocker('LIMITS_REQUIRED', 'Informe todos os limites da execução.'),
    )
  } else if (
    request.limits.maxExecutionTokens <
    request.limits.maxModelCalls *
      (request.limits.estimatedInputTokensPerCall +
        request.limits.maxOutputTokensPerCall)
  ) {
    blockers.push(
      blocker(
        'TOKEN_LIMIT_INCONSISTENT',
        'O limite total de tokens não cobre o pior caso configurado.',
      ),
    )
  }
  if (request.routing !== undefined) {
    if (
      request.limits !== undefined &&
      request.limits.timeoutMs > OPENROUTER_MAX_TIMEOUT_MS
    ) {
      blockers.push(
        blocker(
          'OPENROUTER_TIMEOUT_EXCEEDS_LIMIT',
          `O timeout de ${request.limits.timeoutMs} ms excede o máximo de ${OPENROUTER_MAX_TIMEOUT_MS} ms do cliente OpenRouter.`,
        ),
      )
    }
    if (request.pricing?.providerId === undefined) {
      blockers.push(
        blocker(
          'PRICING_PROVIDER_REQUIRED',
          'Vincule explicitamente o preço ao provedor selecionado.',
        ),
      )
    } else if (request.pricing.providerId !== request.routing.providerId) {
      blockers.push(
        blocker(
          'PRICING_PROVIDER_MISMATCH',
          'O provedor da tabela de preços difere do roteamento selecionado.',
        ),
      )
    }
  }
  if (request.pricing === undefined) {
    blockers.push(
      blocker(
        'PRICING_REQUIRED',
        'Informe preços confirmados e vinculados ao modelo selecionado.',
      ),
    )
  } else if (
    request.modelId !== undefined &&
    request.pricing.modelId !== request.modelId
  ) {
    blockers.push(
      blocker(
        'PRICING_MODEL_MISMATCH',
        'A tabela de preços não corresponde ao modelo selecionado.',
      ),
    )
  }
  if (request.maxBudgetUsd === undefined) {
    blockers.push(
      blocker('BUDGET_REQUIRED', 'Informe um orçamento financeiro máximo.'),
    )
  }
  if (request.unreportedUsageMultiplier === undefined) {
    blockers.push(
      blocker(
        'USAGE_MARGIN_REQUIRED',
        'Informe a margem para chamadas sem medição completa de uso.',
      ),
    )
  }
  if (request.outputDirectory === undefined) {
    blockers.push(
      blocker(
        'OUTPUT_DIRECTORY_REQUIRED',
        'Informe explicitamente o diretório de saída.',
      ),
    )
  }

  const provisional = {
    limits: request.limits,
    pricing: request.pricing,
    unreportedUsageMultiplier: request.unreportedUsageMultiplier,
  }
  const estimatedWorstCaseUsd = externalEvalWorstCaseCost(provisional)
  if (
    estimatedWorstCaseUsd !== undefined &&
    request.maxBudgetUsd !== undefined &&
    estimatedWorstCaseUsd > request.maxBudgetUsd
  ) {
    blockers.push(
      blocker(
        'ESTIMATED_COST_EXCEEDS_BUDGET',
        'A estimativa conservadora excede o orçamento configurado.',
      ),
    )
  }

  if (request.modality === 'live_external') {
    if (request.routing === undefined) {
      blockers.push(
        blocker(
          'ROUTING_REQUIRED',
          'A integração externa exige roteamento reprodutível explícito.',
        ),
      )
    }
    if (
      request.liveAuthorization?.enabled !== true ||
      request.liveAuthorization.confirmation !==
        'I_AUTHORIZE_LIVE_EXTERNAL_EVAL'
    ) {
      blockers.push(
        blocker(
          'LIVE_AUTHORIZATION_REQUIRED',
          'A execução real exige habilitação e confirmação explícitas.',
        ),
      )
    }
    blockers.push(
      blocker(
        'LIVE_EXTERNAL_DISABLED',
        'A EVAL-07B.1 prepara a integração, mas não autoriza conexão externa real.',
      ),
    )
  }

  const scenarioCount =
    loaded === undefined
      ? 0
      : selectedScenarioIds.filter((scenarioId) =>
          loaded.data.cases.some((scenario) => scenario.id === scenarioId),
        ).length
  const turnCount =
    loaded === undefined
      ? 0
      : loaded.data.cases
          .filter((scenario) => selectedScenarioIds.includes(scenario.id))
          .reduce(
            (total, scenario) => total + scenario.input.turns.length,
            0,
          )
  const status = blockers.length === 0 ? 'ready' : 'blocked'
  const plan = externalEvalPlanSchema.parse({
    planVersion: EXTERNAL_EVAL_PLAN_VERSION,
    modality: request.modality,
    status,
    executionAllowed:
      status === 'ready' && request.modality === 'mock_external',
    networkAllowed: false,
    dataset: {
      id: request.datasetId,
      ...(loaded === undefined
        ? {}
        : { version: loaded.data.dataset.version }),
    },
    selectedScenarioIds,
    scenarioCount,
    turnCount,
    ...(request.modelId === undefined
      ? {}
      : { modelId: sanitizeEvalReportText(request.modelId) }),
    ...(request.routing === undefined
      ? {}
      : {
          routing: {
            ...request.routing,
            providerId: sanitizeEvalReportText(
              request.routing.providerId,
            ),
          },
        }),
    ...(request.outputDirectory === undefined
      ? {}
      : {
          outputDirectory: sanitizeEvalReportText(
            request.outputDirectory,
          ),
        }),
    ...(request.limits === undefined ? {} : { limits: request.limits }),
    ...(request.pricing === undefined
      ? {}
      : {
          pricing: {
            ...request.pricing,
            modelId: sanitizeEvalReportText(request.pricing.modelId),
            ...(request.pricing.providerId === undefined
              ? {}
              : {
                  providerId: sanitizeEvalReportText(
                    request.pricing.providerId,
                  ),
                }),
            ...(request.pricing.source === undefined
              ? {}
              : {
                  source: sanitizeEvalReportText(
                    request.pricing.source,
                  ),
                }),
          },
        }),
    ...(request.maxBudgetUsd === undefined
      ? {}
      : { maxBudgetUsd: request.maxBudgetUsd }),
    ...(request.unreportedUsageMultiplier === undefined
      ? {}
      : {
          unreportedUsageMultiplier: request.unreportedUsageMultiplier,
        }),
    ...(estimatedWorstCaseUsd === undefined
      ? {}
      : { estimatedWorstCaseUsd }),
    blockers,
  })
  return { plan, ...(loaded === undefined ? {} : { loaded }) }
}
