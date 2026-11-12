import { randomUUID } from 'node:crypto'

import { createChatService } from '../agent/chat-service.js'
import { createOpenRouterAgentModel } from '../agent/openrouter/openrouter-agent-model.js'
import { createOpenRouterClient } from '../agent/openrouter/openrouter-client.js'
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
import {
  assertSmokeWorstCaseBudget,
  assertSmokeCaseEvidence,
  createSmokeDiagnosticTracker,
  createSmokeCostGuard,
  SMOKE_MAX_EXECUTIONS,
  SMOKE_MAX_MODEL_CALLS_PER_EXECUTION,
  SMOKE_MAX_OUTPUT_TOKENS,
  SmokeGuardError,
  SmokeSetupError,
  type SmokeCaseKind,
  type SmokeCostGuard,
  type SmokeGroundingEvidence,
} from './smoke-chat-guards.js'

const CONFIRMATION = 'I_ACCEPT_COST'
const diagnostics = createSmokeDiagnosticTracker()
let costGuard: SmokeCostGuard | undefined

function requiredPositiveNumber(name: string) {
  const value = Number(process.env[name])
  if (!Number.isFinite(value) || value <= 0) {
    throw new SmokeSetupError('PRICING_CONFIGURATION')
  }
  return value
}

try {
  diagnostics.enter('configuration')
  try {
    loadLocalEnvFile()
  } catch {
    throw new SmokeSetupError('BACKEND_CONFIGURATION')
  }
  if (process.env.HIDRASPLASH_SMOKE_CONFIRM !== CONFIRMATION) {
    throw new SmokeSetupError('CONFIRMATION_REQUIRED')
  }

  let config
  try {
    config = loadConfig(process.env)
  } catch {
    throw new SmokeSetupError('BACKEND_CONFIGURATION')
  }
  if (
    config.openRouterStatus !== 'configured' ||
    !config.openRouterApiKey ||
    !config.openRouterModel
  ) {
    throw new SmokeSetupError('BACKEND_CONFIGURATION')
  }

  diagnostics.enter('budget_preflight')
  const inputPrice = requiredPositiveNumber(
    'HIDRASPLASH_SMOKE_INPUT_USD_PER_MILLION',
  )
  const outputPrice = requiredPositiveNumber(
    'HIDRASPLASH_SMOKE_OUTPUT_USD_PER_MILLION',
  )
  const monetaryCeiling = requiredPositiveNumber(
    'HIDRASPLASH_SMOKE_MAX_USD',
  )
  const worstCaseReservedCostUsd = assertSmokeWorstCaseBudget({
    inputPricePerMillion: inputPrice,
    outputPricePerMillion: outputPrice,
    monetaryCeilingUsd: monetaryCeiling,
  })
  const activeCostGuard = createSmokeCostGuard({
    inputPricePerMillion: inputPrice,
    outputPricePerMillion: outputPrice,
    monetaryCeilingUsd: monetaryCeiling,
  })
  costGuard = activeCostGuard
  const transport = activeCostGuard.wrapTransport(fetch)

  diagnostics.enter('catalog_loading')
  const catalog = await loadCatalogRepository()

  diagnostics.enter('faq_loading')
  const faqDocuments = await loadFaqDocuments()

  diagnostics.enter('service_initialization')
  const client = createOpenRouterClient({
    apiKey: config.openRouterApiKey,
    model: config.openRouterModel,
    maxOutputTokens: SMOKE_MAX_OUTPUT_TOKENS,
    transport,
  })
  const chatService = createChatService({
    catalog,
    productIndex: createProductSearchIndex(catalog.listAll()),
    faqIndex: createFaqSearchIndex(faqDocuments),
    faqDocuments,
    model: createOpenRouterAgentModel(client),
    maxModelCalls: SMOKE_MAX_MODEL_CALLS_PER_EXECUTION,
    maxOutputTokens: SMOKE_MAX_OUTPUT_TOKENS,
  })
  const usageController = createUsageBudgetController()
  const cases = [
    {
      kind: 'product' as const,
      message:
        'Quero um shampoo anticaspa para couro cabeludo oleoso, com sensação refrescante, até R$ 50.',
    },
    {
      kind: 'faq' as const,
      message: 'Qual é a política demonstrativa de frete e entrega?',
    },
    {
      kind: 'mixed' as const,
      message:
        'Quero um shampoo anticaspa para couro oleoso, com frescor, até R$ 50, e qual é o prazo de entrega?',
    },
  ] satisfies readonly { kind: SmokeCaseKind; message: string }[]
  const usageEvents: BudgetedModelUsageEvent[] = []
  const terminationEvents: SmokeGroundingEvidence[] = []
  const observer = {
    record(event: ChatOperationalEvent) {
      if (event.type === 'model_usage') {
        usageEvents.push(event)
        activeCostGuard.reconcileUsage(event.reportedUsage)
      }
      if (event.type === 'orchestrator_termination') {
        diagnostics.recordTermination(event.status)
        terminationEvents.push({
          status: event.status,
          groundingRequirement: event.groundingRequirement,
          productGrounding: event.productGrounding,
          faqGrounding: event.faqGrounding,
        })
      }
    },
  }

  for (
    let index = 0;
    index < Math.min(cases.length, SMOKE_MAX_EXECUTIONS);
    index += 1
  ) {
    const scenarioOrdinal = index + 1
    const before = usageEvents.length
    const terminationsBefore = terminationEvents.length
    diagnostics.enter('scenario_execution', scenarioOrdinal)
    const result = await chatService.execute(
      {
        message: cases[index]?.message ?? '',
        history: [],
        cart: [],
      },
      {
        requestId: randomUUID(),
        signal: new AbortController().signal,
        usageBudget: usageController.createExecution(),
        observer,
      },
    )
    const executionUsage = usageEvents.slice(before)
    diagnostics.enter('usage_reconciliation', scenarioOrdinal)
    activeCostGuard.assertHealthy()
    if (
      executionUsage.length === 0 ||
      executionUsage.some((event) => !event.usageComplete)
    ) {
      throw new SmokeGuardError('USAGE_REPORTING')
    }
    diagnostics.enter('grounding_validation', scenarioOrdinal)
    assertSmokeCaseEvidence({
      kind: cases[index]?.kind ?? 'product',
      response: result,
      termination: terminationEvents.slice(terminationsBefore).at(-1),
    })
    const termination = terminationEvents.at(-1)
    diagnostics.completeScenario()
    console.log('Execução manual concluída.', {
      ordinal: scenarioOrdinal,
      scenario: cases[index]?.kind,
      modelCalls: executionUsage.length,
      productGrounded: termination?.productGrounding === 'found',
      faqGrounded: termination?.faqGrounding === 'found',
      productCount: 'productIds' in result ? result.productIds.length : 0,
      sourceCount: result.sourceIds.length,
    })
  }

  diagnostics.enter('local_budget_check')
  const callsBeforeLocalDenial = activeCostGuard.snapshot().providerCalls
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
        requestId: randomUUID(),
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
  if (
    !locallyDenied ||
    activeCostGuard.snapshot().providerCalls !== callsBeforeLocalDenial
  ) {
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
  activeCostGuard.assertHealthy()
  const costSnapshot = activeCostGuard.snapshot()
  diagnostics.enter('completed')
  console.log('Smoke manual concluído.', {
    executions: SMOKE_MAX_EXECUTIONS,
    providerCalls: costSnapshot.providerCalls,
    usageComplete: true,
    reportedUsage,
    estimatedCostUsd: costSnapshot.estimatedCommittedCostUsd,
    estimateIsNotActualCharge: true,
    usageOverEstimate: costSnapshot.usageOverEstimate,
    worstCaseReservedCostUsd,
  })
} catch (error) {
  console.error(
    'Smoke manual interrompido.',
    diagnostics.failure(error, costGuard?.snapshot().providerCalls ?? 0),
  )
  process.exitCode = 1
}
