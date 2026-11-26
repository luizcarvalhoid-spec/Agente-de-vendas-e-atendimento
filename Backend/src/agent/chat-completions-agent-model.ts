import {
  AgentModelError,
  type AgentMessage,
  type AgentModelErrorCode,
  type AgentModelPort,
  type AgentModelResult,
} from './agent-model-port.js'
import { registerExternalAgentModel } from './agent-model-origin.js'
import {
  OpenRouterClientError,
  matchesChatCompletionModelId,
  openRouterFunctionToolSchema,
  type ChatCompletionResponseValidationFailure,
  type OpenRouterClient,
  type OpenRouterMessage,
} from './chat-completions-client.js'

export const chatCompletionsAgentModelModuleUrl = import.meta.url

export interface ChatCompletionsModelObservation {
  readonly requestedModelId?: string
  readonly returnedModelId: string
  readonly generationId: string
  readonly providerId?: string
  readonly finishReason: string | null
  readonly usageStatus: 'complete' | 'missing' | 'inconsistent'
  readonly reportedUsage?: NonNullable<AgentModelResult['usage']>
  readonly modelIdentityMatches?: boolean
  readonly providerIdentityMatches?: boolean
}

export interface ChatCompletionsAgentModelOptions {
  readonly expectedModelId?: string
  readonly verifiedCanonicalModelId?: string
  readonly expectedProviderId?: string
  readonly defaultMaxOutputTokens?: number
  readonly onObservation?: (
    observation: ChatCompletionsModelObservation,
  ) => void
  readonly onResponseValidationFailure?: (failure: ChatCompletionResponseValidationFailure) => void
}

function toOpenRouterMessage(message: AgentMessage): OpenRouterMessage {
  return message as OpenRouterMessage
}

function mapErrorCode(error: OpenRouterClientError): AgentModelErrorCode {
  switch (error.code) {
    case 'OPENROUTER_CONFIGURATION_ERROR':
    case 'OPENROUTER_INVALID_REQUEST':
      return 'CONFIGURATION_INVALID'
    case 'OPENROUTER_UNAUTHORIZED':
    case 'OPENROUTER_PAYMENT_REQUIRED':
    case 'OPENROUTER_ACCESS_DENIED':
      return 'AUTHENTICATION_FAILED'
    case 'OPENROUTER_RATE_LIMITED':
      return 'PROVIDER_RATE_LIMITED'
    case 'OPENROUTER_MODEL_NOT_AVAILABLE':
    case 'OPENROUTER_UNAVAILABLE':
    case 'OPENROUTER_NETWORK_ERROR':
      return 'PROVIDER_UNAVAILABLE'
    case 'OPENROUTER_TIMEOUT':
      return 'MODEL_TIMEOUT'
    case 'OPENROUTER_CANCELLED':
      return 'MODEL_CANCELLED'
    case 'OPENROUTER_TOOL_CALLING_INCOMPATIBLE':
      return 'TOOL_CALLING_INCOMPATIBLE'
    case 'OPENROUTER_INVALID_JSON':
    case 'OPENROUTER_INVALID_RESPONSE':
      return 'INVALID_MODEL_RESPONSE'
  }
}

function completeUsage(
  usage: Awaited<ReturnType<OpenRouterClient['createChatCompletion']>>['usage'],
) {
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

export function createChatCompletionsAgentModel(
  client: Pick<OpenRouterClient, 'createChatCompletion'>,
  options: ChatCompletionsAgentModelOptions = {},
): AgentModelPort {
  let identityDiverged = false
  return registerExternalAgentModel({
    async complete(input) {
      if (identityDiverged) {
        throw new AgentModelError('INVALID_MODEL_RESPONSE', false)
      }
      let tools
      try {
        tools = input.tools.map((tool) =>
          openRouterFunctionToolSchema.parse(tool),
        )
      } catch {
        throw new AgentModelError('CONFIGURATION_INVALID', false)
      }

      let result
      try {
        result = await client.createChatCompletion({
          messages: input.messages.map(toOpenRouterMessage),
          tools,
          toolChoice: 'auto',
          maxOutputTokens: input.maxOutputTokens ?? options.defaultMaxOutputTokens ?? 512,
          signal: input.signal,
        })
      } catch (error) {
        if (error instanceof AgentModelError) throw error
        if (error instanceof OpenRouterClientError) {
          if (error.responseValidationFailure !== undefined) {
            try {
              options.onResponseValidationFailure?.(error.responseValidationFailure)
            } catch {
              // Observabilidade nunca altera o resultado do adaptador.
            }
          }
          throw new AgentModelError(
            mapErrorCode(error),
            error.transportStarted,
          )
        }
        throw new AgentModelError('PROVIDER_UNAVAILABLE', true)
      }

      const usage = completeUsage(result.usage)
      const modelIdentityMatches =
        options.expectedModelId === undefined
          ? undefined
          : matchesChatCompletionModelId(result.model, options.expectedModelId, options.verifiedCanonicalModelId)
      const providerIdentityMatches =
        options.expectedProviderId === undefined ||
        result.providerId === undefined
          ? undefined
          : result.providerId === options.expectedProviderId
      const observation: ChatCompletionsModelObservation = {
        ...(options.expectedModelId === undefined
          ? {}
          : { requestedModelId: options.expectedModelId }),
        returnedModelId: result.model,
        generationId: result.id,
        ...(result.providerId === undefined
          ? {}
          : { providerId: result.providerId }),
        finishReason: result.finishReason,
        usageStatus:
          result.usage === undefined
            ? 'missing'
            : usage === undefined
              ? 'inconsistent'
              : 'complete',
        ...(usage === undefined ? {} : { reportedUsage: usage }),
        ...(modelIdentityMatches === undefined
          ? {}
          : { modelIdentityMatches }),
        ...(providerIdentityMatches === undefined
          ? {}
          : { providerIdentityMatches }),
      }
      try {
        options.onObservation?.(observation)
      } catch {
        // Observabilidade nunca altera o resultado do adaptador.
      }
      if (
        modelIdentityMatches === false ||
        providerIdentityMatches === false
      ) {
        identityDiverged = true
        throw new AgentModelError('INVALID_MODEL_RESPONSE', true)
      }

      return {
        message: result.message,
        ...(usage === undefined ? {} : { usage }),
      }
    },
  })
}
