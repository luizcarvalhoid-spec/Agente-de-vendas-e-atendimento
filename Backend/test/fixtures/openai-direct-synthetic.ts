import { OPENAI_DIRECT_MODEL } from '../../src/agent/openai/openai-direct-agent-model.js'

export function functionCall(name: string, args: unknown, id = `call-${name}`) {
  return { id, type: 'function', function: { name, arguments: JSON.stringify(args) } }
}

export function syntheticCompletion(content: string | null, options: {
  toolCalls?: readonly ReturnType<typeof functionCall>[]
  finishReason?: string
  refusal?: string
  model?: string
  id?: string
  usage?: { prompt_tokens: number; completion_tokens: number; total_tokens: number }
} = {}) {
  return {
    id: options.id ?? 'chatcmpl-synthetic-fixture',
    created: 0,
    model: options.model ?? OPENAI_DIRECT_MODEL,
    object: 'chat.completion',
    choices: [{ index: 0, finish_reason: options.finishReason ?? (options.toolCalls ? 'tool_calls' : 'stop'), message: {
      role: 'assistant', content,
      ...(options.refusal === undefined ? {} : { refusal: options.refusal }),
      ...(options.toolCalls === undefined ? {} : { tool_calls: options.toolCalls }),
    } }],
    ...(options.usage === undefined ? {} : { usage: options.usage }),
  }
}
