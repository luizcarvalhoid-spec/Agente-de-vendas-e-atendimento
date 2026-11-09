import {
  OpenRouterClientError,
  createOpenRouterClient,
} from '../agent/openrouter/openrouter-client.js'
import {
  ConfigError,
  loadConfig,
  loadLocalEnvFile,
} from '../config/env.js'

const HEALTH_CHECK_TOOL_NAME = 'health_check'

try {
  loadLocalEnvFile()
  const config = loadConfig(process.env)

  if (!config.openRouterApiKey || !config.openRouterModel) {
    console.error(
      'Smoke OpenRouter não executado: configure OPENROUTER_API_KEY e OPENROUTER_MODEL localmente.',
    )
    process.exitCode = 2
  } else {
    const client = createOpenRouterClient({
      apiKey: config.openRouterApiKey,
      model: config.openRouterModel,
      timeoutMs: 10_000,
      maxOutputTokens: 64,
    })
    const result = await client.createChatCompletion({
      messages: [
        {
          role: 'user',
          content:
            'Use a função health_check uma vez para confirmar a compatibilidade.',
        },
      ],
      tools: [
        {
          type: 'function',
          function: {
            name: HEALTH_CHECK_TOOL_NAME,
            description:
              'Função fictícia para validar tool calling sem executar operações.',
            parameters: {
              type: 'object',
              properties: {},
              additionalProperties: false,
            },
          },
        },
      ],
      toolChoice: {
        type: 'function',
        function: { name: HEALTH_CHECK_TOOL_NAME },
      },
    })
    const toolCalls = result.message.toolCalls ?? []

    if (
      toolCalls.length === 0 ||
      toolCalls.some(
        (toolCall) => toolCall.function.name !== HEALTH_CHECK_TOOL_NAME,
      )
    ) {
      throw new OpenRouterClientError(
        'OPENROUTER_TOOL_CALLING_INCOMPATIBLE',
      )
    }

    console.log('Smoke OpenRouter concluído.', {
      model: result.model,
      finishReason: result.finishReason,
      toolCallCount: toolCalls.length,
      usage: result.usage,
    })
  }
} catch (error) {
  if (error instanceof ConfigError) {
    console.error(
      'Smoke OpenRouter não executado: configuração local inválida.',
    )
    process.exitCode = 2
  } else if (error instanceof OpenRouterClientError) {
    console.error('Smoke OpenRouter falhou.', {
      code: error.code,
      statusCode: error.statusCode,
    })
    process.exitCode = 1
  } else {
    console.error('Smoke OpenRouter falhou por um erro inesperado.')
    process.exitCode = 1
  }
}
