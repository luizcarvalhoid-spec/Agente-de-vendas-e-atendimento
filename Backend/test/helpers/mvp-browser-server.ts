import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { buildApp } from '../../src/app.js'
import { createChatService } from '../../src/agent/chat-service.js'
import { createProductSearchIndex } from '../../src/agent/tools/product-tools.js'
import { loadCatalogRepository } from '../../src/catalog/catalog-repository.js'
import { loadConfig } from '../../src/config/env.js'
import { loadFaqDocuments } from '../../src/knowledge/faq-content-loader.js'
import { createFaqSearchIndex } from '../../src/knowledge/faq-search.js'
import { createMvpDeterministicModel } from './mvp-deterministic-model.js'

const backendRoot = dirname(dirname(dirname(fileURLToPath(import.meta.url))))
const host = '127.0.0.1'

function readPort(value: string | undefined) {
  if (value === undefined || value.trim() === '') return 3333
  const port = Number(value)
  if (!Number.isSafeInteger(port) || port < 0 || port > 65_535) {
    throw new Error('HIDRASPLASH_MVP_PORT deve ser um inteiro entre 0 e 65535.')
  }
  return port
}

function readFrontendOrigin(value: string | undefined) {
  const origin = value?.trim() || 'http://127.0.0.1:5173'
  const url = new URL(origin)
  if (
    url.origin !== origin ||
    url.protocol !== 'http:' ||
    (url.hostname !== '127.0.0.1' && url.hostname !== 'localhost')
  ) {
    throw new Error('HIDRASPLASH_MVP_FRONTEND_ORIGIN deve ser uma origem HTTP local.')
  }
  return origin
}

const requestedPort = readPort(process.env.HIDRASPLASH_MVP_PORT)
const frontendOrigin = readFrontendOrigin(
  process.env.HIDRASPLASH_MVP_FRONTEND_ORIGIN,
)
const config = loadConfig({
  PORT: String(requestedPort === 0 ? 3333 : requestedPort),
  FRONTEND_ORIGIN: frontendOrigin,
})
const catalogRoot = join(backendRoot, 'content', 'catalog')
const faqRoot = join(backendRoot, 'content', 'knowledge', 'faq')
const [catalog, faqDocuments] = await Promise.all([
  loadCatalogRepository({
    catalogRoot,
    productsFile: join(catalogRoot, 'products.json'),
  }),
  loadFaqDocuments({ faqRoot }),
])
const chatService = createChatService({
  catalog,
  productIndex: createProductSearchIndex(catalog.listAll()),
  faqIndex: createFaqSearchIndex(faqDocuments),
  faqDocuments,
  model: createMvpDeterministicModel(),
})
const app = buildApp({ config, catalog, chatService })

let closing = false
const close = async () => {
  if (closing) return
  closing = true
  process.off('SIGINT', close)
  process.off('SIGTERM', close)
  await app.close()
}
process.once('SIGINT', close)
process.once('SIGTERM', close)

try {
  const address = await app.listen({ host, port: requestedPort })
  console.log(`HidraSplash MVP determinístico disponível em ${address}`)
  console.log(`CORS restrito a ${frontendOrigin}; OpenRouter desabilitada.`)
} catch (error) {
  await close()
  console.error(error instanceof Error ? error.message : 'Falha ao iniciar a demonstração.')
  process.exitCode = 1
}
