import { Buffer } from 'node:buffer'

import { z } from 'zod'

import type {
  AgentMessage,
  AgentModelPort,
  AgentToolCall,
} from './agent-model-port.js'
import { AgentModelError } from './agent-model-port.js'
import { createConsultativeSystemInstruction } from './consultative-agent-policy.js'
import {
  createAgentToolExecutionContext,
  type AgentToolRegistry,
} from './tools/agent-tool.js'
import {
  GET_PRODUCT_DETAILS_TOOL_NAME,
  SEARCH_PRODUCTS_TOOL_NAME,
  getProductDetailsExecutionResultSchema,
  searchProductsExecutionResultSchema,
} from './tools/product-tools.js'
import {
  SEARCH_FAQ_TOOL_NAME,
  searchFaqToolExecutionResultSchema,
} from './tools/search-faq-tool.js'

export const TOOL_ORCHESTRATOR_MAX_MODEL_CALLS = 4
export const TOOL_ORCHESTRATOR_MAX_TOOL_ROUNDS = 3
export const TOOL_ORCHESTRATOR_MAX_TOOL_CALLS = 6
export const TOOL_ORCHESTRATOR_MAX_TOOLS_PER_RESPONSE = 3
export const TOOL_ORCHESTRATOR_MAX_ARGUMENT_CHARACTERS = 4_000
export const TOOL_ORCHESTRATOR_MAX_TOOL_RESULT_BYTES = 24_000
export const TOOL_ORCHESTRATOR_MAX_CONTEXT_BYTES = 80_000
export const TOOL_ORCHESTRATOR_MAX_MESSAGES = 32
export const TOOL_ORCHESTRATOR_TIMEOUT_MS = 45_000
export const TOOL_ORCHESTRATOR_DEFAULT_MAX_OUTPUT_TOKENS = 512

const conversationMessageSchema = z
  .object({
    role: z.enum(['user', 'assistant']),
    content: z.string().trim().min(1).max(12_000),
  })
  .strict()

const runInputSchema = z
  .object({
    conversation: z.array(conversationMessageSchema).min(1).max(16),
    groundingRequirement: z.enum([
      'not_required',
      'product',
      'faq',
      'any',
      'both',
    ]),
    signal: z.custom<AbortSignal>(
      (value) => value instanceof AbortSignal,
    ).optional(),
  })
  .strict()

const sanitizedToolError = (
  code:
    | 'INVALID_ARGUMENTS'
    | 'EXECUTION_FAILED'
    | 'TOOL_NOT_FOUND'
    | 'DUPLICATE_TOOL_CALL',
  message: string,
) => ({ ok: false, error: { code, message } })

const aggregateBudgetErrorContent = JSON.stringify(
  sanitizedToolError(
    'EXECUTION_FAILED',
    'O orçamento agregado de resultados foi atingido.',
  ),
)
const aggregateBudgetErrorBytes = Buffer.byteLength(
  aggregateBudgetErrorContent,
  'utf8',
)

export type ToolOrchestratorFallbackReason =
  | 'MODEL_LIMIT'
  | 'TOOL_ROUND_LIMIT'
  | 'TOOL_CALL_LIMIT'
  | 'INVALID_TOOL_BATCH'
  | 'CONTEXT_LIMIT'
  | 'OPERATION_TIMEOUT'
  | 'MODEL_FAILED'
  | 'MODEL_CONFIGURATION_INVALID'
  | 'MODEL_AUTHENTICATION_FAILED'
  | 'MODEL_RATE_LIMITED'
  | 'MODEL_UNAVAILABLE'
  | 'MODEL_TIMEOUT'
  | 'MODEL_CANCELLED'
  | 'MODEL_TOOL_CALLING_INCOMPATIBLE'
  | 'LOCAL_BUDGET_EXHAUSTED'
  | 'INVALID_MODEL_RESPONSE'
  | 'INSUFFICIENT_GROUNDING'

export type ToolOrchestratorGroundingStatus =
  | 'not_required'
  | 'verified'
  | 'not_found'
  | 'insufficient'

export type ToolOrchestratorGroundingRequirement =
  | 'not_required'
  | 'product'
  | 'faq'
  | 'any'
  | 'both'

export type ToolOrchestratorGroundingDomainStatus =
  | 'not_consulted'
  | 'found'
  | 'not_found'
  | 'failed'

export interface ToolOrchestratorGroundingSummary {
  requirement: ToolOrchestratorGroundingRequirement
  status: ToolOrchestratorGroundingStatus
  product: ToolOrchestratorGroundingDomainStatus
  faq: ToolOrchestratorGroundingDomainStatus
}

export type ToolOrchestratorRunInput = z.input<typeof runInputSchema>

interface AggregatedUsage {
  inputTokens: number
  outputTokens: number
  totalTokens: number
  complete: boolean
}

interface SanitizedDiagnostics {
  modelCalls: number
  toolRounds: number
  toolCalls: number
  toolErrors: number
  faqNotFound: boolean
  toolOutcomes: {
    found: number
    notFound: number
    invalidArguments: number
    executionFailed: number
    rejected: number
  }
}

interface GroundedResultFields {
  recommendationProductIds: readonly number[]
  consultedProductIds: readonly number[]
  faqSourceIds: readonly string[]
  usage: AggregatedUsage
  diagnostics: SanitizedDiagnostics
  grounding: ToolOrchestratorGroundingSummary
}

export type ToolOrchestratorResult =
  | (GroundedResultFields & {
      status: 'completed'
      message: string
      fallback: false
      termination: 'ASSISTANT_RESPONSE'
    })
  | (GroundedResultFields & {
      status: 'fallback'
      message: string
      fallback: true
      termination: ToolOrchestratorFallbackReason
    })
  | (GroundedResultFields & {
      status: 'cancelled'
      message: null
      fallback: false
      termination: 'CALLER_CANCELLED'
    })

export interface ToolOrchestratorEvent {
  readonly type: 'tool' | 'termination'
  readonly toolName?: string
  readonly ordinal?: number
  readonly durationMs?: number
  readonly status: string
  readonly executed?: boolean
  readonly outcome?:
    | 'found'
    | 'not_found'
    | 'rejected'
    | 'failed'
    | 'unknown'
  readonly usage?: AggregatedUsage
  readonly modelCalls?: number
  readonly toolCalls?: number
  readonly toolErrors?: number
  readonly grounding?: ToolOrchestratorGroundingSummary
}

export interface CreateToolOrchestratorOptions {
  readonly model: AgentModelPort
  readonly tools: AgentToolRegistry
  readonly systemInstruction?: () => string
  readonly timeoutMs?: number
  readonly maxModelCalls?: number
  readonly maxOutputTokens?: number
  readonly now?: () => number
  readonly log?: (event: ToolOrchestratorEvent) => void
}

export interface ToolOrchestrator {
  run(input: unknown): Promise<ToolOrchestratorResult>
}

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map(canonicalJson).join(',')}]`
  }
  if (value !== null && typeof value === 'object') {
    const record = value as Record<string, unknown>
    return `{${Object.keys(record)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`)
      .join(',')}}`
  }
  return JSON.stringify(value)
}

function raceWithAbort<T>(promise: Promise<T>, signal: AbortSignal) {
  if (signal.aborted) {
    return Promise.reject(new DOMException('Aborted', 'AbortError'))
  }

  return new Promise<T>((resolve, reject) => {
    const abort = () => reject(new DOMException('Aborted', 'AbortError'))
    signal.addEventListener('abort', abort, { once: true })
    promise.then(resolve, reject).finally(() => {
      signal.removeEventListener('abort', abort)
    })
  })
}

function uniquePush<T extends number | string>(target: T[], values: readonly T[]) {
  for (const value of values) {
    if (!target.includes(value)) target.push(value)
  }
}

export function createToolOrchestrator(
  options: CreateToolOrchestratorOptions,
): ToolOrchestrator {
  const systemInstruction =
    options.systemInstruction ?? createConsultativeSystemInstruction
  const timeoutMs = options.timeoutMs ?? TOOL_ORCHESTRATOR_TIMEOUT_MS
  const maxModelCalls =
    options.maxModelCalls ?? TOOL_ORCHESTRATOR_MAX_MODEL_CALLS
  const maxOutputTokens =
    options.maxOutputTokens ?? TOOL_ORCHESTRATOR_DEFAULT_MAX_OUTPUT_TOKENS
  const now = options.now ?? Date.now
  const log = options.log ?? (() => undefined)

  if (!Number.isInteger(timeoutMs) || timeoutMs <= 0 || timeoutMs > 45_000) {
    throw new TypeError('Limite temporal inválido para o orquestrador.')
  }
  if (
    !Number.isInteger(maxModelCalls) ||
    maxModelCalls <= 0 ||
    maxModelCalls > TOOL_ORCHESTRATOR_MAX_MODEL_CALLS
  ) {
    throw new TypeError('Limite de chamadas ao modelo inválido.')
  }
  if (
    !Number.isInteger(maxOutputTokens) ||
    maxOutputTokens <= 0 ||
    maxOutputTokens > 4_096
  ) {
    throw new TypeError('Limite de saída do modelo inválido.')
  }
  if (options.tools.size === 0) {
    throw new TypeError('O orquestrador exige ferramentas registradas.')
  }

  return {
    async run(rawInput) {
      const parsedInput = runInputSchema.safeParse(rawInput)
      if (!parsedInput.success) {
        throw new TypeError('Entrada interna inválida para o orquestrador.')
      }

      const callerSignal = parsedInput.data.signal
      const operationController = new AbortController()
      let callerCancelled = callerSignal?.aborted ?? false
      let operationTimedOut = false
      const cancelFromCaller = () => {
        callerCancelled = true
        operationController.abort(new AgentModelError('MODEL_CANCELLED', true))
      }
      callerSignal?.addEventListener('abort', cancelFromCaller, { once: true })
      if (callerCancelled) {
        operationController.abort(new AgentModelError('MODEL_CANCELLED', true))
      }
      const timeout = setTimeout(() => {
        if (operationController.signal.aborted) return
        operationTimedOut = true
        operationController.abort(new AgentModelError('MODEL_TIMEOUT', true))
      }, timeoutMs)
      const toolExecutionContext = createAgentToolExecutionContext(
        operationController.signal,
      )

      const messages: AgentMessage[] = [
        { role: 'system', content: systemInstruction() },
        ...parsedInput.data.conversation,
      ]
      const recommendationFromSearch: number[] = []
      const recommendationFromDetails: number[] = []
      const consultedProductIds: number[] = []
      const faqSourceIds: string[] = []
      const usedToolCallIds = new Set<string>()
      const executedSignatures = new Set<string>()
      let productSearchCompleted = false
      let modelCalls = 0
      let toolRounds = 0
      let toolCalls = 0
      let toolErrors = 0
      let toolResultBytes = 0
      let faqNotFound = false
      let productFound = false
      let productNotFound = false
      let productFailed = false
      let faqFound = false
      let faqFailed = false
      const toolOutcomes = {
        found: 0,
        notFound: 0,
        invalidArguments: 0,
        executionFailed: 0,
        rejected: 0,
      }
      let usageComplete = true
      const usage = { inputTokens: 0, outputTokens: 0, totalTokens: 0 }

      const domainStatus = (
        found: boolean,
        notFound: boolean,
        failed: boolean,
      ): ToolOrchestratorGroundingDomainStatus => {
        if (found) return 'found'
        if (failed) return 'failed'
        if (notFound) return 'not_found'
        return 'not_consulted'
      }
      const groundingSummary = (): ToolOrchestratorGroundingSummary => {
        const requirement = parsedInput.data.groundingRequirement
        const product = domainStatus(
          productFound,
          productNotFound,
          productFailed,
        )
        const faq = domainStatus(faqFound, faqNotFound, faqFailed)
        let status: ToolOrchestratorGroundingStatus

        if (requirement === 'not_required') {
          status = 'not_required'
        } else if (requirement === 'product') {
          status =
            product === 'found'
              ? 'verified'
              : product === 'not_found'
                ? 'not_found'
                : 'insufficient'
        } else if (requirement === 'faq') {
          status =
            faq === 'found'
              ? 'verified'
              : faq === 'not_found'
                ? 'not_found'
                : 'insufficient'
        } else if (requirement === 'both') {
          const productResolved =
            product === 'found' || product === 'not_found'
          const faqResolved = faq === 'found' || faq === 'not_found'
          status =
            !productResolved || !faqResolved
              ? 'insufficient'
              : product === 'not_found' && faq === 'not_found'
                ? 'not_found'
                : 'verified'
        } else if (product === 'found' || faq === 'found') {
          status = 'verified'
        } else if (
          product !== 'failed' &&
          faq !== 'failed' &&
          (product === 'not_found' || faq === 'not_found')
        ) {
          status = 'not_found'
        } else {
          status = 'insufficient'
        }

        return { requirement, status, product, faq }
      }
      const groundedFields = (): GroundedResultFields => ({
        recommendationProductIds: (
          productSearchCompleted
            ? recommendationFromSearch
            : recommendationFromDetails
        ).filter((id) => {
          const validators = [
            options.tools.get(SEARCH_PRODUCTS_TOOL_NAME),
            options.tools.get(GET_PRODUCT_DETAILS_TOOL_NAME),
          ].filter(
            (tool) => tool?.isRecommendationProductEligible !== undefined,
          )
          return (
            validators.length > 0 &&
            validators.every((tool) =>
              tool?.isRecommendationProductEligible?.(
                id,
                toolExecutionContext,
              ),
            )
          )
        }),
        consultedProductIds,
        faqSourceIds,
        usage: { ...usage, complete: usageComplete },
        diagnostics: {
          modelCalls,
          toolRounds,
          toolCalls,
          toolErrors,
          faqNotFound,
          toolOutcomes: { ...toolOutcomes },
        },
        grounding: groundingSummary(),
      })

      const fallback = (
        reason: ToolOrchestratorFallbackReason,
      ): ToolOrchestratorResult => {
        log({
          type: 'termination',
          status: reason,
          usage: { ...usage, complete: usageComplete },
          modelCalls,
          toolCalls,
          toolErrors,
          grounding: groundingSummary(),
        })
        const timeoutReason = reason === 'OPERATION_TIMEOUT'
        return {
          status: 'fallback',
          message:
            reason === 'INSUFFICIENT_GROUNDING'
              ? 'Não foi possível verificar essa informação nas fontes da demonstração HidraSplash.'
              : timeoutReason
                ? 'A consulta excedeu o tempo seguro desta demonstração. Tente novamente.'
                : 'Não foi possível concluir a consulta dentro dos limites seguros desta demonstração.',
          fallback: true,
          termination: reason,
          ...groundedFields(),
        }
      }

      const cancelled = (): ToolOrchestratorResult => {
        log({
          type: 'termination',
          status: 'CALLER_CANCELLED',
          usage: { ...usage, complete: usageComplete },
          modelCalls,
          toolCalls,
          toolErrors,
          grounding: groundingSummary(),
        })
        return {
          status: 'cancelled',
          message: null,
          fallback: false,
          termination: 'CALLER_CANCELLED',
          ...groundedFields(),
        }
      }

      const abortResult = () =>
        callerCancelled
          ? cancelled()
          : fallback(
              operationTimedOut ? 'OPERATION_TIMEOUT' : 'MODEL_FAILED',
            )

      const collectGrounding = (toolName: string, result: unknown) => {
        if (toolName === SEARCH_PRODUCTS_TOOL_NAME) {
          const parsed = searchProductsExecutionResultSchema.safeParse(result)
          if (!parsed.success || !parsed.data.ok) return
          productSearchCompleted = true
          if (parsed.data.status === 'found') {
            productFound = true
            const ids = parsed.data.products.map((product) => product.id)
            uniquePush(recommendationFromSearch, ids)
            uniquePush(consultedProductIds, ids)
          } else {
            productNotFound = true
          }
          return
        }

        if (toolName === GET_PRODUCT_DETAILS_TOOL_NAME) {
          const parsed = getProductDetailsExecutionResultSchema.safeParse(result)
          if (!parsed.success || !parsed.data.ok || parsed.data.status !== 'found') {
            if (parsed.success && parsed.data.ok) productNotFound = true
            return
          }
          productFound = true
          uniquePush(consultedProductIds, [parsed.data.product.id])
          if (parsed.data.product.eligibility.eligible) {
            uniquePush(recommendationFromDetails, [parsed.data.product.id])
          }
          return
        }

        if (toolName === SEARCH_FAQ_TOOL_NAME) {
          const parsed = searchFaqToolExecutionResultSchema.safeParse(result)
          if (!parsed.success || !parsed.data.ok) return
          if (parsed.data.status === 'not_found') {
            faqNotFound = true
          } else {
            faqFound = true
            uniquePush(
              faqSourceIds,
              parsed.data.sources.map((source) => source.sourceId),
            )
          }
        }
      }

      const processToolCall = async (
        toolCall: AgentToolCall,
        reservedResultBytes: number,
      ) => {
        toolCalls += 1
        const startedAt = now()
        const tool = options.tools.get(toolCall.function.name)
        let result: unknown
        let groundingCandidate: unknown
        let status = 'ok'
        let executed = false

        if (!tool) {
          toolErrors += 1
          status = 'not_found'
          result = sanitizedToolError(
            'TOOL_NOT_FOUND',
            'A ferramenta solicitada não está disponível.',
          )
        } else if (
          toolCall.function.arguments.length >
          TOOL_ORCHESTRATOR_MAX_ARGUMENT_CHARACTERS
        ) {
          toolErrors += 1
          status = 'invalid_arguments'
          result = sanitizedToolError(
            'INVALID_ARGUMENTS',
            'Os argumentos da ferramenta são inválidos.',
          )
        } else {
          let rawArguments: unknown
          try {
            rawArguments = JSON.parse(toolCall.function.arguments) as unknown
          } catch {
            rawArguments = undefined
          }

          const parsedArguments = tool.inputSchema.safeParse(rawArguments)
          if (!parsedArguments.success) {
            toolErrors += 1
            status = 'invalid_arguments'
            result = sanitizedToolError(
              'INVALID_ARGUMENTS',
              'Os argumentos da ferramenta são inválidos.',
            )
          } else {
            const signature = `${tool.name}:${canonicalJson(parsedArguments.data)}`
            if (executedSignatures.has(signature)) {
              toolErrors += 1
              status = 'duplicate'
              result = sanitizedToolError(
                'DUPLICATE_TOOL_CALL',
                'Esta consulta já foi executada nesta operação.',
              )
            } else {
              executedSignatures.add(signature)
              try {
                executed = true
                const rawResult = await raceWithAbort(
                  tool.execute(parsedArguments.data, toolExecutionContext),
                  operationController.signal,
                )
                const parsedResult = tool.outputSchema.safeParse(rawResult)
                if (!parsedResult.success) {
                  throw new TypeError('Invalid tool result')
                }
                result = parsedResult.data
                groundingCandidate = result
              } catch {
                if (operationController.signal.aborted) {
                  log({
                    type: 'tool',
                    toolName: toolCall.function.name,
                    ordinal: toolCalls,
                    durationMs: Math.max(0, now() - startedAt),
                    status: 'cancelled',
                    executed: true,
                    outcome: 'failed',
                  })
                  throw new DOMException('Aborted', 'AbortError')
                }
                toolErrors += 1
                status = 'execution_failed'
                result = sanitizedToolError(
                  'EXECUTION_FAILED',
                  'A ferramenta não pôde produzir um resultado utilizável.',
                )
              }
            }
          }
        }

        let content: string
        try {
          content = JSON.stringify(result)
          if (content === undefined) throw new TypeError('Missing JSON result')
        } catch {
          toolErrors += 1
          status = 'execution_failed'
          result = sanitizedToolError(
            'EXECUTION_FAILED',
            'A ferramenta não pôde produzir um resultado utilizável.',
          )
          groundingCandidate = undefined
          content = JSON.stringify(result)
        }
        if (Buffer.byteLength(content, 'utf8') > 12_000) {
          toolErrors += 1
          status = 'result_too_large'
          result = sanitizedToolError(
            'EXECUTION_FAILED',
            'A ferramenta não pôde produzir um resultado utilizável.',
          )
          groundingCandidate = undefined
          content = JSON.stringify(result)
        }

        const contentBytes = Buffer.byteLength(content, 'utf8')
        if (
          toolResultBytes + contentBytes + reservedResultBytes >
          TOOL_ORCHESTRATOR_MAX_TOOL_RESULT_BYTES
        ) {
          toolErrors += 1
          status = 'aggregate_limit'
          content = aggregateBudgetErrorContent
          groundingCandidate = undefined
        }
        toolResultBytes += Buffer.byteLength(content, 'utf8')
        if (groundingCandidate !== undefined && tool) {
          collectGrounding(tool.name, groundingCandidate)
        }

        const finalResult = JSON.parse(content) as {
          ok?: boolean
          status?: string
          error?: { code?: string }
        }
        const outcome =
          finalResult.ok === true && finalResult.status === 'found'
            ? 'found'
            : finalResult.ok === true && finalResult.status === 'not_found'
              ? 'not_found'
              : finalResult.ok === true
                ? 'unknown'
              : finalResult.error?.code === 'INVALID_ARGUMENTS' ||
                  finalResult.error?.code === 'TOOL_NOT_FOUND' ||
                  finalResult.error?.code === 'DUPLICATE_TOOL_CALL'
                ? 'rejected'
                : 'failed'
        if (finalResult.ok === true && finalResult.status === 'found') {
          toolOutcomes.found += 1
        } else if (
          finalResult.ok === true &&
          finalResult.status === 'not_found'
        ) {
          toolOutcomes.notFound += 1
        } else if (finalResult.error?.code === 'INVALID_ARGUMENTS') {
          toolOutcomes.invalidArguments += 1
        } else if (finalResult.error?.code === 'EXECUTION_FAILED') {
          toolOutcomes.executionFailed += 1
        } else {
          toolOutcomes.rejected += 1
        }
        if (finalResult.ok === false) {
          if (
            toolCall.function.name === SEARCH_PRODUCTS_TOOL_NAME ||
            toolCall.function.name === GET_PRODUCT_DETAILS_TOOL_NAME
          ) {
            productFailed = true
          }
          if (toolCall.function.name === SEARCH_FAQ_TOOL_NAME) {
            faqFailed = true
          }
        }
        log({
          type: 'tool',
          toolName: toolCall.function.name,
          ordinal: toolCalls,
          durationMs: Math.max(0, now() - startedAt),
          status,
          executed,
          outcome,
        })
        return {
          role: 'tool' as const,
          toolCallId: toolCall.id,
          content,
        }
      }

      try {
        while (modelCalls < maxModelCalls) {
          if (operationController.signal.aborted) return abortResult()
          if (messages.length > TOOL_ORCHESTRATOR_MAX_MESSAGES) {
            return fallback('CONTEXT_LIMIT')
          }
          const contextBytes = Buffer.byteLength(
            JSON.stringify({ messages, tools: options.tools.definitions }),
            'utf8',
          )
          if (contextBytes > TOOL_ORCHESTRATOR_MAX_CONTEXT_BYTES) {
            return fallback('CONTEXT_LIMIT')
          }

          let modelResult
          modelCalls += 1
          try {
            modelResult = await raceWithAbort(
              options.model.complete({
                messages,
                tools: options.tools.definitions,
                signal: operationController.signal,
                maxOutputTokens,
              }),
              operationController.signal,
            )
          } catch (error) {
            if (operationController.signal.aborted) return abortResult()
            if (error instanceof AgentModelError) {
              const reasons = {
                CONFIGURATION_INVALID: 'MODEL_CONFIGURATION_INVALID',
                AUTHENTICATION_FAILED: 'MODEL_AUTHENTICATION_FAILED',
                PROVIDER_RATE_LIMITED: 'MODEL_RATE_LIMITED',
                PROVIDER_UNAVAILABLE: 'MODEL_UNAVAILABLE',
                MODEL_TIMEOUT: 'MODEL_TIMEOUT',
                MODEL_CANCELLED: 'MODEL_CANCELLED',
                INVALID_MODEL_RESPONSE: 'INVALID_MODEL_RESPONSE',
                TOOL_CALLING_INCOMPATIBLE:
                  'MODEL_TOOL_CALLING_INCOMPATIBLE',
                LOCAL_BUDGET_EXHAUSTED: 'LOCAL_BUDGET_EXHAUSTED',
              } as const
              return fallback(reasons[error.code])
            }
            return fallback('MODEL_FAILED')
          }
          if (modelResult.usage) {
            usage.inputTokens += modelResult.usage.inputTokens
            usage.outputTokens += modelResult.usage.outputTokens
            usage.totalTokens += modelResult.usage.totalTokens
          } else {
            usageComplete = false
          }

          const calls = modelResult.message.toolCalls ?? []
          if (calls.length === 0) {
            const finalText = modelResult.message.content?.trim()
            if (!finalText) return fallback('INVALID_MODEL_RESPONSE')
            if (groundingSummary().status === 'insufficient') {
              return fallback('INSUFFICIENT_GROUNDING')
            }
            log({
              type: 'termination',
              status: 'ASSISTANT_RESPONSE',
              usage: { ...usage, complete: usageComplete },
              modelCalls,
              toolCalls,
              toolErrors,
              grounding: groundingSummary(),
            })
            return {
              status: 'completed',
              message: finalText,
              fallback: false,
              termination: 'ASSISTANT_RESPONSE',
              ...groundedFields(),
            }
          }

          if (
            calls.length > TOOL_ORCHESTRATOR_MAX_TOOLS_PER_RESPONSE ||
            toolCalls + calls.length > TOOL_ORCHESTRATOR_MAX_TOOL_CALLS ||
            toolRounds >= TOOL_ORCHESTRATOR_MAX_TOOL_ROUNDS
          ) {
            const reason =
              calls.length > TOOL_ORCHESTRATOR_MAX_TOOLS_PER_RESPONSE
                ? 'INVALID_TOOL_BATCH'
                : toolCalls + calls.length > TOOL_ORCHESTRATOR_MAX_TOOL_CALLS
                  ? 'TOOL_CALL_LIMIT'
                  : 'TOOL_ROUND_LIMIT'
            return fallback(reason)
          }
          if (
            toolResultBytes + aggregateBudgetErrorBytes * calls.length >
            TOOL_ORCHESTRATOR_MAX_TOOL_RESULT_BYTES
          ) {
            return fallback('CONTEXT_LIMIT')
          }
          const ids = calls.map((call) => call.id)
          if (
            new Set(ids).size !== ids.length ||
            ids.some((id) => usedToolCallIds.has(id)) ||
            messages.length + calls.length + 1 > TOOL_ORCHESTRATOR_MAX_MESSAGES
          ) {
            return fallback('INVALID_TOOL_BATCH')
          }

          messages.push({
            role: 'assistant',
            content: modelResult.message.content,
            toolCalls: calls,
          })
          ids.forEach((id) => usedToolCallIds.add(id))
          toolRounds += 1
          for (const [index, call] of calls.entries()) {
            if (operationController.signal.aborted) return abortResult()
            try {
              const remainingCalls = calls.length - index - 1
              messages.push(
                await processToolCall(
                  call,
                  remainingCalls * aggregateBudgetErrorBytes,
                ),
              )
            } catch {
              if (operationController.signal.aborted) return abortResult()
              return fallback('INVALID_MODEL_RESPONSE')
            }
          }
        }

        return fallback('MODEL_LIMIT')
      } finally {
        clearTimeout(timeout)
        callerSignal?.removeEventListener('abort', cancelFromCaller)
      }
    },
  }
}
