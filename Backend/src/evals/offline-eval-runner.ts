import { createHash } from 'node:crypto'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import {
  createChatService,
  type ChatService,
  ChatServiceError,
} from '../agent/chat-service.js'
import { createProductSearchIndex } from '../agent/tools/product-tools.js'
import {
  loadCatalogRepository,
  type CatalogRepository,
} from '../catalog/catalog-repository.js'
import {
  chatRequestSchema,
  type ChatPreferences,
  type ChatProductCard,
  type ChatRequest,
  type ChatResponse,
} from '../contracts/chat.js'
import { loadFaqDocuments } from '../knowledge/faq-content-loader.js'
import { createFaqSearchIndex } from '../knowledge/faq-search.js'
import type { ChatOperationalObserver } from '../observability/chat-operational-events.js'
import {
  createEvalCanonicalData,
  evaluateOfflineEvalExecution,
  type EvalCanonicalData,
  type EvalDatasetEvaluation,
  type EvalOverallStatus,
} from './eval-assertion-engine.js'
import type { EvalCase } from './eval-dataset-schema.js'
import {
  loadEvalDataset,
  type LoadedEvalDataset,
} from './eval-loader.js'
import { createOfflineEvalModel } from './offline-eval-model.js'
import {
  sanitizeEvalEvidence,
  sanitizeEvalText,
} from './offline-eval-sanitization.js'
import {
  createTracedFaqSearchIndex,
  createTracedProductSearchIndex,
  OfflineEvalTraceCollector,
  type EvalRuntimeTrace,
} from './offline-eval-trace.js'

export const OFFLINE_EVAL_DATASETS = {
  'universal-core': 'datasets/universal/core.v1.json',
  'universal-safety': 'datasets/universal/safety.v1.json',
  'hidrasplash-recommendations':
    'datasets/stores/hidrasplash/recommendations.v1.json',
  'hidrasplash-conversations':
    'datasets/stores/hidrasplash/conversations.v1.json',
} as const

export type OfflineEvalDatasetId = keyof typeof OFFLINE_EVAL_DATASETS
export type EvalTechnicalStatus = 'completed' | 'technical_failure'

export interface EvalSanitizedError {
  readonly code: string
  readonly message: string
}

export interface EvalAppliedState {
  readonly historyLength: number
  readonly preferences?: ChatPreferences
  readonly cart: ChatRequest['cart']
  readonly recommendationContext?: ChatRequest['recommendationContext']
}

export interface EvalTurnExecution {
  readonly datasetId: string
  readonly scenarioId: string
  readonly turn: number
  readonly message: string
  readonly appliedState: EvalAppliedState
  readonly technicalStatus: EvalTechnicalStatus
  readonly response?: {
    readonly type: ChatResponse['type']
    readonly reason?: 'clarification' | 'not_found' | 'unable_to_verify'
    readonly message: string
    readonly productIds: readonly number[]
    readonly products: readonly ChatProductCard[]
    readonly sourceIds: readonly string[]
  }
  readonly trace: EvalRuntimeTrace
  readonly error?: EvalSanitizedError
}

export interface EvalScenarioExecution {
  readonly scenarioId: string
  readonly technicalStatus: EvalTechnicalStatus
  readonly behavioralEvaluation: 'not_evaluated' | EvalOverallStatus
  readonly turns: readonly EvalTurnExecution[]
}

export interface OfflineEvalExecution {
  readonly mode: 'offline'
  readonly dataset: {
    readonly id: string
    readonly version: string
    readonly sourcePath: string
  }
  readonly technicalStatus: EvalTechnicalStatus
  readonly behavioralEvaluation: 'not_evaluated' | EvalOverallStatus
  readonly scenarios: readonly EvalScenarioExecution[]
  readonly evaluation?: EvalDatasetEvaluation
  readonly summary: {
    readonly scenarios: number
    readonly completed: number
    readonly technicalFailures: number
  }
}

export interface OfflineScenarioRuntime {
  readonly chatService: ChatService
  readonly trace: OfflineEvalTraceCollector
}

export type OfflineScenarioRuntimeFactory = (
  scenario: EvalCase,
) => OfflineScenarioRuntime | Promise<OfflineScenarioRuntime>

export interface RunOfflineEvalOptions {
  readonly scenarioId?: string
  readonly createScenarioRuntime?: OfflineScenarioRuntimeFactory
  readonly evaluateAssertions?: boolean
  readonly canonicalData?: EvalCanonicalData
}

function resolveEvalRoot(moduleUrl: string = import.meta.url) {
  return resolve(dirname(fileURLToPath(moduleUrl)), '../../evals')
}

export function resolveOfflineEvalDataset(
  datasetId: string,
  moduleUrl: string = import.meta.url,
) {
  if (!(datasetId in OFFLINE_EVAL_DATASETS)) {
    throw new TypeError(`Dataset offline desconhecido: ${datasetId}.`)
  }
  return resolve(
    resolveEvalRoot(moduleUrl),
    OFFLINE_EVAL_DATASETS[datasetId as OfflineEvalDatasetId],
  )
}

function deterministicRequestId(datasetId: string, scenarioId: string, turn: number) {
  const hash = createHash('sha256')
    .update(`${datasetId}:${scenarioId}:${turn}`)
    .digest('hex')
  return `${hash.slice(0, 8)}-${hash.slice(8, 12)}-4${hash.slice(13, 16)}-a${hash.slice(17, 20)}-${hash.slice(20, 32)}`
}

function sanitizedError(error: unknown): EvalSanitizedError {
  if (error instanceof ChatServiceError) {
    return {
      code: error.code,
      message: 'O ChatService encerrou o turno com uma falha controlada.',
    }
  }
  if (error instanceof TypeError) {
    return {
      code: 'INVALID_EVAL_EXECUTION',
      message: 'O runner encontrou um estado interno inválido.',
    }
  }
  return {
    code: 'OFFLINE_EXECUTION_FAILED',
    message: 'A execução offline não pôde concluir o turno.',
  }
}

function emptyTrace(): EvalRuntimeTrace {
  return {
    modelCalls: 0,
    toolsRequested: [],
    toolsExecuted: [],
    toolCalls: [],
    toolExecutions: [],
    grounding: {
      requirement: 'not_required',
      product: 'not_consulted',
      faq: 'not_consulted',
    },
    ingredientResolutions: [],
    productSearches: [],
    faqSearches: [],
  }
}

function appliedState(request: ChatRequest): EvalAppliedState {
  return sanitizeEvalEvidence({
    historyLength: request.history.length,
    ...(request.preferences === undefined
      ? {}
      : { preferences: structuredClone(request.preferences) }),
    cart: structuredClone(request.cart),
    ...(request.recommendationContext === undefined
      ? {}
      : {
          recommendationContext: structuredClone(
            request.recommendationContext,
          ),
        }),
  })
}

function responseEvidence(response: ChatResponse) {
  return sanitizeEvalEvidence({
    type: response.type,
    ...('reason' in response && response.reason !== undefined
      ? { reason: response.reason }
      : {}),
    message: response.message,
    productIds:
      response.type === 'text' ? [] : [...response.productIds],
    products:
      response.type === 'text'
        ? []
        : response.products.map((product) => structuredClone(product)),
    sourceIds: [...response.sourceIds],
  })
}

function applyPreferences(
  current: ChatPreferences | undefined,
  operation: EvalCase['input']['turns'][number]['preferences'],
) {
  if (operation.mode === 'preserve') return current
  if (operation.mode === 'clear') return undefined
  return structuredClone(operation.value)
}

function applyCart(
  current: ChatRequest['cart'],
  operation: EvalCase['input']['turns'][number]['cart'],
) {
  if (operation.mode === 'preserve') return current
  if (operation.mode === 'clear') return []
  return structuredClone(operation.value)
}

function applyRecommendationContext(
  automatic: ChatRequest['recommendationContext'] | undefined,
  operation: EvalCase['input']['turns'][number]['recommendationContext'],
) {
  if (operation.mode === 'auto') {
    return {
      requestContext: automatic,
      retainedContext: automatic,
    }
  }
  if (operation.mode === 'clear') {
    return {
      requestContext: undefined,
      retainedContext: undefined,
    }
  }
  const replacement = structuredClone(operation.value)
  return {
    requestContext: replacement,
    retainedContext: replacement,
  }
}

function automaticContextFrom(
  retained: ChatRequest['recommendationContext'] | undefined,
  response: ChatResponse,
) {
  if (response.type === 'text') return retained
  return { productIds: [...response.productIds] }
}

async function createCanonicalRuntimeFactory(
  providedCatalog?: CatalogRepository,
): Promise<OfflineScenarioRuntimeFactory> {
  const [catalog, faqDocuments] = await Promise.all([
    providedCatalog ?? loadCatalogRepository(),
    loadFaqDocuments(),
  ])

  return () => {
    const trace = new OfflineEvalTraceCollector()
    const productIndex = createTracedProductSearchIndex(
      createProductSearchIndex(catalog.listAll()),
      trace,
    )
    const faqIndex = createTracedFaqSearchIndex(
      createFaqSearchIndex(faqDocuments),
      trace,
    )
    const observer: ChatOperationalObserver = {
      record: (event) => trace.recordOperationalEvent(event),
    }
    const service = createChatService({
      catalog,
      productIndex,
      faqIndex,
      faqDocuments,
      model: createOfflineEvalModel(trace),
    })

    return {
      trace,
      chatService: {
        execute: (request, options) =>
          service.execute(request, { ...options, observer }),
      },
    }
  }
}

async function executeScenario(
  datasetId: string,
  scenario: EvalCase,
  createScenarioRuntime: OfflineScenarioRuntimeFactory,
): Promise<EvalScenarioExecution> {
  const runtime = await createScenarioRuntime(scenario)
  let history = structuredClone(scenario.input.initialState.history)
  let cart = structuredClone(scenario.input.initialState.cart)
  let preferences = scenario.input.initialState.preferences
    ? structuredClone(scenario.input.initialState.preferences)
    : undefined
  let automaticRecommendationContext = scenario.input.initialState
    .recommendationContext
    ? structuredClone(scenario.input.initialState.recommendationContext)
    : undefined
  const turns: EvalTurnExecution[] = []

  for (const [turnIndex, turn] of scenario.input.turns.entries()) {
    runtime.trace.beginTurn()
    preferences = applyPreferences(preferences, turn.preferences)
    cart = applyCart(cart, turn.cart)
    const recommendationTransition = applyRecommendationContext(
      automaticRecommendationContext,
      turn.recommendationContext,
    )
    const recommendationContext = recommendationTransition.requestContext
    automaticRecommendationContext = recommendationTransition.retainedContext
    const candidate = {
      message: turn.message,
      history,
      cart,
      ...(preferences === undefined ? {} : { preferences }),
      ...(recommendationContext === undefined
        ? {}
        : { recommendationContext }),
    }
    const parsedRequest = chatRequestSchema.safeParse(candidate)
    if (!parsedRequest.success) {
      turns.push({
        datasetId,
        scenarioId: scenario.id,
        turn: turnIndex,
        message: sanitizeEvalText(turn.message),
        appliedState: sanitizeEvalEvidence({
          historyLength: history.length,
          ...(preferences === undefined
            ? {}
            : { preferences: structuredClone(preferences) }),
          cart: structuredClone(cart),
          ...(recommendationContext === undefined
            ? {}
            : {
                recommendationContext: structuredClone(
                  recommendationContext,
                ),
              }),
        }),
        technicalStatus: 'technical_failure',
        trace: emptyTrace(),
        error: {
          code: 'INVALID_CHAT_REQUEST',
          message: 'O estado projetado excede ou viola o contrato de chat.',
        },
      })
      break
    }

    const request = parsedRequest.data
    try {
      const response = await runtime.chatService.execute(request, {
        requestId: deterministicRequestId(
          datasetId,
          scenario.id,
          turnIndex,
        ),
        signal: new AbortController().signal,
      })
      turns.push({
        datasetId,
        scenarioId: scenario.id,
        turn: turnIndex,
        message: sanitizeEvalText(turn.message),
        appliedState: appliedState(request),
        technicalStatus: 'completed',
        response: responseEvidence(response),
        trace: runtime.trace.snapshot(),
      })
      history = [
        ...request.history,
        { role: 'user', content: request.message },
        { role: 'assistant', content: response.message },
      ]
      automaticRecommendationContext = automaticContextFrom(
        automaticRecommendationContext,
        response,
      )
    } catch (error) {
      turns.push({
        datasetId,
        scenarioId: scenario.id,
        turn: turnIndex,
        message: sanitizeEvalText(turn.message),
        appliedState: appliedState(request),
        technicalStatus: 'technical_failure',
        trace: runtime.trace.snapshot(),
        error: sanitizedError(error),
      })
      break
    }
  }

  const technicalStatus = turns.every(
    (turn) => turn.technicalStatus === 'completed',
  )
    ? 'completed'
    : 'technical_failure'
  return {
    scenarioId: scenario.id,
    technicalStatus,
    behavioralEvaluation: 'not_evaluated',
    turns,
  }
}

export async function runOfflineEvalDataset(
  loaded: LoadedEvalDataset,
  options: RunOfflineEvalOptions = {},
): Promise<OfflineEvalExecution> {
  const selected =
    options.scenarioId === undefined
      ? loaded.data.cases
      : loaded.data.cases.filter((item) => item.id === options.scenarioId)
  if (selected.length === 0) {
    throw new TypeError(
      `Cenário não encontrado no dataset: ${options.scenarioId}.`,
    )
  }
  const evaluationCatalog =
    options.evaluateAssertions === true && options.canonicalData === undefined
      ? await loadCatalogRepository()
      : undefined
  const createScenarioRuntime =
    options.createScenarioRuntime ??
    (await createCanonicalRuntimeFactory(evaluationCatalog))
  const scenarios: EvalScenarioExecution[] = []
  for (const scenario of selected) {
    scenarios.push(
      await executeScenario(
        loaded.data.dataset.id,
        scenario,
        createScenarioRuntime,
      ),
    )
  }
  const completed = scenarios.filter(
    (scenario) => scenario.technicalStatus === 'completed',
  ).length
  const technicalFailures = scenarios.length - completed

  const execution: OfflineEvalExecution = {
    mode: 'offline',
    dataset: {
      id: loaded.data.dataset.id,
      version: loaded.data.dataset.version,
      sourcePath: loaded.sourcePath,
    },
    technicalStatus:
      technicalFailures === 0 ? 'completed' : 'technical_failure',
    behavioralEvaluation: 'not_evaluated',
    scenarios,
    summary: {
      scenarios: scenarios.length,
      completed,
      technicalFailures,
    },
  }
  if (options.evaluateAssertions !== true) return execution

  const canonicalData =
    options.canonicalData ??
    (evaluationCatalog === undefined
      ? undefined
      : createEvalCanonicalData(evaluationCatalog))
  if (canonicalData === undefined) {
    throw new TypeError('Dados canônicos indisponíveis para a avaliação.')
  }
  const evaluation = evaluateOfflineEvalExecution(
    loaded,
    execution,
    canonicalData,
    options.scenarioId === undefined
      ? { kind: 'full_dataset' }
      : {
          kind: 'selected_scenarios',
          scenarioIds: [options.scenarioId],
        },
  )
  return {
    ...execution,
    behavioralEvaluation: evaluation.overallStatus,
    scenarios: execution.scenarios.map((scenario) => ({
      ...scenario,
      behavioralEvaluation:
        evaluation.scenarios.find(
          (item) => item.scenarioId === scenario.scenarioId,
        )?.overallStatus ?? 'not_evaluated',
    })),
    evaluation,
  }
}

export async function runOfflineEval(
  datasetId: string,
  options: RunOfflineEvalOptions = {},
) {
  const path = resolveOfflineEvalDataset(datasetId)
  return runOfflineEvalDataset(await loadEvalDataset(path), options)
}
