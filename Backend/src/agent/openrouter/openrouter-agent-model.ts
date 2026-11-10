import {
  AgentModelError,
  type AgentMessage,
  type AgentModelErrorCode,
  type AgentModelPort,
} from '../agent-model-port.js'
import {
  OpenRouterClientError,
  openRouterFunctionToolSchema,
  type OpenRouterClient,
  type OpenRouterMessage,
} from './openrouter-client.js'

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

export function createOpenRouterAgentModel(
  client: Pick<OpenRouterClient, 'createChatCompletion'>,
): AgentModelPort {
  return {
    async complete(input) {
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
          maxOutputTokens: input.maxOutputTokens ?? 512,
          signal: input.signal,
        })
      } catch (error) {
        if (error instanceof OpenRouterClientError) {
          throw new AgentModelError(
            mapErrorCode(error),
            error.transportStarted,
          )
        }
        throw new AgentModelError('PROVIDER_UNAVAILABLE', true)
      }

      return {
        message: result.message,
        ...(result.usage ? { usage: result.usage } : {}),
      }
    },
  }
}
