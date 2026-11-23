import { AgentModelError } from '../agent-model-port.js'
import { createChatCompletionsAgentModel, type ChatCompletionsAgentModelOptions } from '../chat-completions-agent-model.js'
import { chatCompletionsLimitsSchema, createChatCompletionsClient } from '../chat-completions-client.js'
import { isInMemoryChatTransport } from '../in-memory-chat-transport.js'

export const openAiDirectAgentModelModuleUrl = import.meta.url

export const OPENAI_DIRECT_MODEL = 'gpt-6-luna'
export const OPENAI_DIRECT_PROTOCOL = {
  kind: 'direct_offline',
  endpoint: 'https://api.openai.com/v1/chat/completions',
  reasoningEffort: 'none',
  store: false,
} as const

export function createOpenAiDirectAgentModel(options: {
  readonly transport: typeof fetch
  readonly limits?: { readonly timeoutMs?: number; readonly maxOutputTokens?: number }
  readonly onObservation?: ChatCompletionsAgentModelOptions['onObservation']
}) {
  const limits = chatCompletionsLimitsSchema.safeParse(options.limits ?? {})
  if (!isInMemoryChatTransport(options.transport) || !limits.success) {
    throw new AgentModelError('CONFIGURATION_INVALID', false)
  }

  return createChatCompletionsAgentModel(createChatCompletionsClient({
    ...limits.data,
    model: OPENAI_DIRECT_MODEL,
    protocol: OPENAI_DIRECT_PROTOCOL,
    transport: options.transport,
  }), {
    expectedModelId: OPENAI_DIRECT_MODEL,
    defaultMaxOutputTokens: limits.data.maxOutputTokens,
    onObservation: options.onObservation,
  })
}
