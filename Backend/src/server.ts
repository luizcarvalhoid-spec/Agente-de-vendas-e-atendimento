import { buildApp } from './app.js'
import { createChatService } from './agent/chat-service.js'
import { createOpenRouterAgentModel } from './agent/openrouter/openrouter-agent-model.js'
import { createOpenRouterClient } from './agent/openrouter/openrouter-client.js'
import { createProductSearchIndex } from './agent/tools/product-tools.js'
import { loadCatalogRepository } from './catalog/catalog-repository.js'
import { ConfigError, loadConfig, loadLocalEnvFile } from './config/env.js'
import { loadFaqDocuments } from './knowledge/faq-content-loader.js'
import { createFaqSearchIndex } from './knowledge/faq-search.js'

try {
  loadLocalEnvFile()
  const config = loadConfig(process.env)
  const catalog = await loadCatalogRepository()
  let chatService
  if (config.openRouterApiKey && config.openRouterModel) {
    const faqDocuments = await loadFaqDocuments()
    const productIndex = createProductSearchIndex(catalog.listAll())
    const faqIndex = createFaqSearchIndex(faqDocuments)
    const client = createOpenRouterClient({
      apiKey: config.openRouterApiKey,
      model: config.openRouterModel,
    })
    chatService = createChatService({
      catalog,
      productIndex,
      faqIndex,
      faqDocuments,
      model: createOpenRouterAgentModel(client),
    })
  }
  const app = buildApp({
    config,
    catalog,
    chatService,
    fastify: { logger: true },
  })

  await app.listen({ host: '127.0.0.1', port: config.port })
} catch (error) {
  if (error instanceof ConfigError) {
    console.error(error.message, { fields: error.fields })
  } else {
    console.error('Falha ao iniciar a API.')
  }
  process.exitCode = 1
}
