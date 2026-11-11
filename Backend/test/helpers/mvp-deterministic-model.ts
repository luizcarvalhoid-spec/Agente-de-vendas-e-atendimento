import type {
  AgentMessage,
  AgentModelPort,
  AgentModelResult,
  AgentToolCall,
} from '../../src/agent/agent-model-port.js'

function normalize(value: string) {
  return value
    .normalize('NFKD')
    .replace(/\p{Diacritic}/gu, '')
    .toLocaleLowerCase('pt-BR')
}

function lastUserMessage(messages: readonly AgentMessage[]) {
  return [...messages]
    .reverse()
    .find((message) => message.role === 'user')?.content ?? ''
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
      ...(toolCalls ? { toolCalls } : {}),
    },
    usage: { inputTokens: 100, outputTokens: 20, totalTokens: 120 },
  }
}

function faqToolCall(query: string) {
  return toolCall('mvp-faq', 'search_faq', { query, limit: 1 })
}

function productSearchToolCall(input: Record<string, unknown>) {
  return toolCall('mvp-products', 'search_products', {
    requireInStock: true,
    limit: 5,
    ...input,
  })
}

export function createMvpDeterministicModel(): AgentModelPort {
  return {
    async complete(input) {
      if (input.signal.aborted) throw input.signal.reason

      if (input.messages.some((message) => message.role === 'tool')) {
        return response('Resposta demonstrativa fundamentada nas ferramentas.')
      }

      const rawMessage = lastUserMessage(input.messages)
      const message = normalize(rawMessage)

      if (/compar/.test(message) && /\b9\b/.test(message) && /\b13\b/.test(message)) {
        return response(null, [
          toolCall('mvp-details-9', 'get_product_details', { productId: 9 }),
          toolCall('mvp-details-13', 'get_product_details', { productId: 13 }),
        ])
      }

      if (/entrega real|entregas reais/.test(message)) {
        return response(null, [faqToolCall('A HidraSplash realiza entregas reais?')])
      }
      if (/frete gratis|r\$?\s*100,?00/.test(message)) {
        return response(null, [
          faqToolCall('Quando o frete grátis demonstrativo é aplicado?'),
        ])
      }
      if (/valor do frete|frete abaixo|frete padrao|r\$?\s*12,?90/.test(message)) {
        return response(null, [
          faqToolCall('Qual é o valor do frete abaixo do limite gratuito?'),
        ])
      }
      if (/troca|devolu/.test(message) && /real|reais/.test(message)) {
        return response(null, [
          faqToolCall('A HidraSplash realiza trocas ou devoluções reais?'),
        ])
      }
      if (/danific|quebrad|incorret/.test(message)) {
        return response(null, [
          faqToolCall('Como funciona o cenário de item danificado ou incorreto?'),
        ])
      }
      if (/portugal|presente|fidelidade|atacado|certificacao ambiental/.test(message)) {
        return response(null, [faqToolCall(rawMessage)])
      }

      if (/\banticaspa\b/.test(message) && /\b(?:r\$\s*)?1\b/.test(message)) {
        return response(null, [
          productSearchToolCall({
            query: 'anticaspa',
            category: 'shampoos',
            subcategory: 'anticaspa',
            maxPrice: 1,
          }),
        ])
      }
      if (/\banticaspa\b/.test(message) && /seco|suave|hidrat/.test(message)) {
        return response(null, [
          productSearchToolCall({
            query: 'anticaspa suave hidratante',
            category: 'shampoos',
            subcategory: 'anticaspa',
            scalpTypes: ['seco'],
            hairConcerns: ['caspa', 'ressecamento'],
            maxPrice: 55,
          }),
        ])
      }
      if (/\banticaspa\b/.test(message) && /oleos/.test(message)) {
        return response(null, [
          productSearchToolCall({
            query: 'anticaspa frescor',
            category: 'shampoos',
            subcategory: 'anticaspa',
            scalpTypes: ['oleoso'],
            hairConcerns: ['caspa', 'oleosidade'],
            maxPrice: 50,
          }),
        ])
      }
      if (/\banticaspa\b/.test(message)) {
        return response(null, [
          productSearchToolCall({
            query: 'anticaspa',
            category: 'shampoos',
            subcategory: 'anticaspa',
          }),
        ])
      }

      return response('Como posso ajudar nesta demonstração?')
    },
  }
}
