import { createChatService } from '../agent/chat-service.js'
import { createOpenRouterAgentModel } from '../agent/openrouter/openrouter-agent-model.js'
import {
  createOpenRouterClient,
  type OpenRouterTransport,
} from '../agent/openrouter/openrouter-client.js'
import { createProductSearchIndex } from '../agent/tools/product-tools.js'
import {
  createUsageBudgetController,
  type BudgetedModelUsageEvent,
} from '../agent/usage-budget-controller.js'
import { loadCatalogRepository } from '../catalog/catalog-repository.js'
import { loadConfig, loadLocalEnvFile } from '../config/env.js'
import { loadFaqDocuments } from '../knowledge/faq-content-loader.js'
import { createFaqSearchIndex } from '../knowledge/faq-search.js'
import type { ChatOperationalEvent } from '../observability/chat-operational-events.js'

const CONFIRMATION = 'I_ACCEPT_COST'
const MAX_EXECUTIONS = 3
const MAX_MODEL_CALLS_PER_EXECUTION = 2
const MAX_PROVIDER_CALLS = 6
const MAX_OUTPUT_TOKENS = 128
const MAX_INPUT_UNITS_PER_CALL = 80_000

function requiredPositiveNumber(name: string) {
  const value = Number(process.env[name])
  if (!Number.isFinite(value) || value <= 0) {
    throw new Error(`Variável operacional ausente ou inválida: ${name}.`)
  }
  return value
}

function assertSmokeRequest(init: RequestInit | undefined) {
  if (typeof init?.body !== 'string') {
    throw new Error('O smoke recusou um transporte sem corpo JSON verificável.')
  }
  const body = JSON.parse(init.body) as { max_completion_tokens?: unknown }
  if (body.max_completion_tokens !== MAX_OUTPUT_TOKENS) {
    throw new Error('O smoke recusou um teto de saída diferente de 128 tokens.')
  }
}

try {
  loadLocalEnvFile()
  if (process.env.HIDRASPLASH_SMOKE_CONFIRM !== CONFIRMATION) {
    throw new Error(
      `Confirmação ausente: defina HIDRASPLASH_SMOKE_CONFIRM=${CONFIRMATION}.`,
    )
  }

  const config = loadConfig(process.env)
  if (
    config.openRouterStatus !== 'configured' ||
    !config.openRouterApiKey ||
    !config.openRouterModel
  ) {
    throw new Error('Credencial ou modelo do smoke não estão configurados.')
  }

  const inputPrice = requiredPositiveNumber(
    'HIDRASPLASH_SMOKE_INPUT_USD_PER_MILLION',
  )
  const outputPrice = requiredPositiveNumber(
    'HIDRASPLASH_SMOKE_OUTPUT_USD_PER_MILLION',
  )
  const monetaryCeiling = requiredPositiveNumber(
    'HIDRASPLASH_SMOKE_MAX_USD',
  )
  const estimatedMaximumCost =
    (MAX_PROVIDER_CALLS * MAX_INPUT_UNITS_PER_CALL * inputPrice +
      MAX_PROVIDER_CALLS * MAX_OUTPUT_TOKENS * outputPrice) /
    1_000_000
  if (estimatedMaximumCost > monetaryCeiling) {
    throw new Error(
      'O teto monetário informado não cobre a estimativa conservadora do smoke.',
    )
  }

  let providerCalls = 0
  const transport: OpenRouterTransport = async (input, init) => {
    if (providerCalls >= MAX_PROVIDER_CALLS) {
      throw new Error('O limite absoluto de transportes do smoke foi atingido.')
    }
    assertSmokeRequest(init)
    providerCalls += 1
    return fetch(input, init)
  }
  const client = createOpenRouterClient({
    apiKey: config.openRouterApiKey,
    model: config.openRouterModel,
    maxOutputTokens: MAX_OUTPUT_TOKENS,
    transport,
  })
  const catalog = await loadCatalogRepository()
  const faqDocuments = await loadFaqDocuments()
  const chatService = createChatService({
    catalog,
    productIndex: createProductSearchIndex(catalog.listAll()),
    faqIndex: createFaqSearchIndex(faqDocuments),
    faqDocuments,
    model: createOpenRouterAgentModel(client),
    maxModelCalls: MAX_MODEL_CALLS_PER_EXECUTION,
    maxOutputTokens: MAX_OUTPUT_TOKENS,
  })
  const usageController = createUsageBudgetController()
  const cases = [
    {
      message:
        'Quero um shampoo anticaspa para couro cabeludo oleoso, com sensação refrescante, até R$ 50.',
    },
    { message: 'Qual é a política demonstrativa de frete e entrega?' },
    {
      message:
        'Quero um shampoo anticaspa para couro oleoso, com frescor, até R$ 50, e qual é o prazo de entrega?',
    },
  ] as const
  const usageEvents: BudgetedModelUsageEvent[] = []
  const observer = {
    record(event: ChatOperationalEvent) {
      if (event.type === 'model_usage') usageEvents.push(event)
    },
  }

  for (let index = 0; index < Math.min(cases.length, MAX_EXECUTIONS); index += 1) {
    const before = usageEvents.length
    const result = await chatService.execute(
      {
        message: cases[index]?.message ?? '',
        history: [],
        cart: [],
      },
      {
        requestId: `manual-smoke-${index + 1}`,
        signal: new AbortController().signal,
        usageBudget: usageController.createExecution(),
        observer,
      },
    )
    const executionUsage = usageEvents.slice(before)
    if (
      executionUsage.length === 0 ||
      executionUsage.some((event) => !event.usageComplete)
    ) {
      throw new Error(
        'O smoke foi interrompido porque o provedor não informou uso completo.',
      )
    }
    console.log('Execução manual concluída.', {
      ordinal: index + 1,
      responseType: result.type,
      modelCalls: executionUsage.length,
    })
  }

  const callsBeforeLocalDenial = providerCalls
  let locallyDenied = false
  try {
    await chatService.execute(
      {
        message:
          'Quero um shampoo anticaspa para couro oleoso, com frescor, até R$ 50.',
        history: [],
        cart: [],
      },
      {
        requestId: 'manual-smoke-local-budget',
        signal: new AbortController().signal,
        usageBudget: createUsageBudgetController({
          executionBudgetUnits: 1_000,
          windowBudgetUnits: 1_000,
        }).createExecution(),
      },
    )
  } catch {
    locallyDenied = true
  }
  if (!locallyDenied || providerCalls !== callsBeforeLocalDenial) {
    throw new Error('A verificação local de orçamento falhou.')
  }

  const reportedUsage = usageEvents.reduce(
    (total, event) => ({
      inputTokens: total.inputTokens + (event.reportedUsage?.inputTokens ?? 0),
      outputTokens:
        total.outputTokens + (event.reportedUsage?.outputTokens ?? 0),
    }),
    { inputTokens: 0, outputTokens: 0 },
  )
  const reportedCost =
    (reportedUsage.inputTokens * inputPrice +
      reportedUsage.outputTokens * outputPrice) /
    1_000_000
  console.log('Smoke manual concluído.', {
    executions: MAX_EXECUTIONS,
    providerCalls,
    usageComplete: true,
    reportedUsage,
    reportedCostUsd: reportedCost,
    estimatedMaximumCostUsd: estimatedMaximumCost,
  })
} catch {
  console.error(
    'Smoke manual interrompido: configuração, orçamento, uso ou transporte não atenderam aos requisitos seguros.',
  )
  process.exitCode = 1
}
