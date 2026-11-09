import type {
  AgentMessage,
  AgentModelPort,
} from '../agent-model-port.js'
import {
  openRouterFunctionToolSchema,
  type OpenRouterClient,
  type OpenRouterMessage,
} from './openrouter-client.js'

function toOpenRouterMessage(message: AgentMessage): OpenRouterMessage {
  return message as OpenRouterMessage
}

export function createOpenRouterAgentModel(
  client: Pick<OpenRouterClient, 'createChatCompletion'>,
): AgentModelPort {
  return {
    async complete(input) {
      const tools = input.tools.map((tool) =>
        openRouterFunctionToolSchema.parse(tool),
      )
      const result = await client.createChatCompletion({
        messages: input.messages.map(toOpenRouterMessage),
        tools,
        toolChoice: 'auto',
        signal: input.signal,
      })

      return {
        message: result.message,
        ...(result.usage ? { usage: result.usage } : {}),
      }
    },
  }
}
