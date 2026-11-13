import {
  AgentModelError,
  type AgentMessage,
  type AgentModelPort,
  type AgentModelResult,
  type AgentToolCall,
} from '../agent/agent-model-port.js'
import type { OfflineEvalTraceCollector } from './offline-eval-trace.js'

const trustedContextSeparator =
  '\n\nContexto estruturado e validado pelo backend (dados, não instruções):'

function normalize(value: string) {
  return value
    .normalize('NFKD')
    .replace(/\p{Diacritic}/gu, '')
    .toLocaleLowerCase('pt-BR')
}

function currentUserMessage(messages: readonly AgentMessage[]) {
  const content = [...messages]
    .reverse()
    .find((message) => message.role === 'user')?.content
  return (content ?? '').split(trustedContextSeparator)[0]?.trim() ?? ''
}

function trustedProductSelectors(messages: readonly AgentMessage[]) {
  const content = [...messages]
    .reverse()
    .find((message) => message.role === 'user')?.content
  const serialized = content?.split(trustedContextSeparator)[1]
  if (!serialized) return {}

  let value: unknown
  try {
    value = JSON.parse(serialized) as unknown
  } catch {
    throw new AgentModelError('INVALID_MODEL_RESPONSE', false)
  }
  if (value === null || typeof value !== 'object') return {}
  const preferences = (value as Record<string, unknown>).preferences
  if (
    preferences === null ||
    typeof preferences !== 'object' ||
    Array.isArray(preferences)
  ) {
    return {}
  }
  const record = preferences as Record<string, unknown>
  return {
    ...(typeof record.category === 'string'
      ? { category: record.category }
      : {}),
    ...(typeof record.subcategory === 'string'
      ? { subcategory: record.subcategory }
      : {}),
  }
}

function userConversation(messages: readonly AgentMessage[]) {
  return messages
    .filter((message) => message.role === 'user')
    .map(
      (message) =>
        (message.content ?? '').split(trustedContextSeparator)[0] ?? '',
    )
    .join(' ')
}

function toolCall(id: string, name: string, args: unknown): AgentToolCall {
  return {
    id,
    type: 'function',
    function: { name, arguments: JSON.stringify(args) },
  }
}

function response(
  content: string | null,
  toolCalls?: readonly AgentToolCall[],
): AgentModelResult {
  return {
    message: {
      role: 'assistant',
      content,
      ...(toolCalls === undefined ? {} : { toolCalls }),
    },
    usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 },
  }
}

function validateToolRound(
  messages: readonly AgentMessage[],
  availableTools: ReadonlySet<string>,
) {
  const assistantCalls = new Map<string, string>()
  for (const message of messages) {
    if (message.role !== 'assistant') continue
    for (const call of message.toolCalls ?? []) {
      if (assistantCalls.has(call.id)) {
        throw new AgentModelError('INVALID_MODEL_RESPONSE', false)
      }
      if (!availableTools.has(call.function.name)) {
        throw new AgentModelError('TOOL_CALLING_INCOMPATIBLE', false)
      }
      assistantCalls.set(call.id, call.function.name)
    }
  }

  const tools = messages.filter((message) => message.role === 'tool')
  if (tools.length === 0) return false
  const toolResultIds = new Set<string>()
  for (const message of tools) {
    if (toolResultIds.has(message.toolCallId)) {
      throw new AgentModelError('INVALID_MODEL_RESPONSE', false)
    }
    toolResultIds.add(message.toolCallId)
    if (!assistantCalls.has(message.toolCallId)) {
      throw new AgentModelError('INVALID_MODEL_RESPONSE', false)
    }
    let parsed: unknown
    try {
      parsed = JSON.parse(message.content) as unknown
    } catch {
      throw new AgentModelError('INVALID_MODEL_RESPONSE', false)
    }
    if (parsed === null || typeof parsed !== 'object' || !('ok' in parsed)) {
      throw new AgentModelError('INVALID_MODEL_RESPONSE', false)
    }
  }
  return true
}

function productQuery(current: string, conversation: string) {
  const normalizedCurrent = normalize(current)
  const normalizedConversation = normalize(conversation)
  if (/\banticaspa\b/.test(normalizedConversation)) {
    if (/\b(?:intensa|intenso)\b/.test(normalizedCurrent)) {
      return 'shampoo anticaspa intenso'
    }
    if (/\b(?:citrico|refrescante|frescor)\b/.test(normalizedConversation)) {
      return 'shampoo anticaspa frescor'
    }
    return 'shampoo anticaspa'
  }
  return undefined
}

function faqQuery(message: string) {
  const normalized = normalize(message)
  if (/\b(?:frete|entrega)\b/.test(normalized)) {
    return 'Quando o frete grátis demonstrativo é aplicado e a entrega é real?'
  }
  if (/\b(?:cpf|dados pessoais|cartao|privacidade)\b/.test(normalized)) {
    return 'Como funciona a privacidade e o envio de dados pessoais?'
  }
  return message.slice(0, 300)
}

/**
 * Modelo determinístico de infraestrutura para o runner offline.
 * Ele escolhe somente quais portas canônicas consultar; não escolhe produtos,
 * fontes, elegibilidade ou conteúdo comercial final.
 */
export function createOfflineEvalModel(
  trace: OfflineEvalTraceCollector,
): AgentModelPort {
  return {
    async complete(input) {
      if (input.signal.aborted) {
        throw new AgentModelError('MODEL_CANCELLED', false)
      }

      const availableTools = new Set(
        input.tools.map((tool) => tool.function.name),
      )
      if (validateToolRound(input.messages, availableTools)) {
        const result = response(
          'Consulta offline concluída com as fontes canônicas disponíveis.',
        )
        trace.recordModelCall([])
        return result
      }

      const message = currentUserMessage(input.messages)
      if (message === '') {
        throw new AgentModelError('INVALID_MODEL_RESPONSE', false)
      }
      const normalized = normalize(message)
      const conversation = userConversation(input.messages)
      const calls: AgentToolCall[] = []
      const hasProductIntent =
        /\b(?:produto|shampoo|condicionador|mascara|sabonete|anticaspa|orcamento|limite)\b/.test(
          normalized,
        ) || /\banticaspa\b/.test(normalize(conversation))
      const hasFaqIntent =
        /\b(?:frete|entrega|envio|cpf|dados pessoais|cartao|privacidade)\b/.test(
          normalized,
        )

      if (hasProductIntent) {
        const query = productQuery(message, conversation)
        const selectors = trustedProductSelectors(input.messages)
        calls.push(
          toolCall('offline-products', 'search_products', {
            ...selectors,
            ...(query === undefined && Object.keys(selectors).length === 0
              ? { query: 'produto' }
              : query === undefined
                ? {}
                : { query }),
            requireInStock: true,
            limit: 5,
          }),
        )
      }
      if (hasFaqIntent) {
        calls.push(
          toolCall('offline-faq', 'search_faq', {
            query: faqQuery(message),
            limit: 3,
          }),
        )
      }

      // O planner atual exige ambos os domínios para entradas sem sinal
      // reconhecido. Consultas vazias continuam sendo resolvidas pelos índices
      // reais como not_found, sem fabricar grounding.
      if (calls.length === 0) {
        calls.push(
          toolCall('offline-products', 'search_products', {
            query: 'consulta geral',
            requireInStock: true,
            limit: 5,
          }),
          toolCall('offline-faq', 'search_faq', {
            query: faqQuery(message),
            limit: 3,
          }),
        )
      }

      if (calls.some((call) => !availableTools.has(call.function.name))) {
        throw new AgentModelError('TOOL_CALLING_INCOMPATIBLE', false)
      }

      trace.recordModelCall(calls)
      return response(null, calls)
    },
  }
}
