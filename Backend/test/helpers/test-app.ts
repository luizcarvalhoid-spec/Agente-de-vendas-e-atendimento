import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import type { FastifyServerOptions } from 'fastify'

import type { ChatService } from '../../src/agent/chat-service.js'
import { buildApp } from '../../src/app.js'
import {
  loadCatalogRepository,
  type CatalogRepository,
} from '../../src/catalog/catalog-repository.js'
import { loadConfig, type AppConfig } from '../../src/config/env.js'

const backendRoot = dirname(dirname(dirname(fileURLToPath(import.meta.url))))
const catalogRoot = join(backendRoot, 'content', 'catalog')
const productsFile = join(catalogRoot, 'products.json')

let catalogPromise: Promise<CatalogRepository> | undefined

export function loadTestCatalog() {
  catalogPromise ??= loadCatalogRepository({ catalogRoot, productsFile })
  return catalogPromise
}

export async function buildTestApp(options: {
  config?: AppConfig
  chatService?: ChatService
  fastify?: FastifyServerOptions
} = {}) {
  const catalog = await loadTestCatalog()

  return buildApp({
    config: options.config ?? loadConfig({}),
    catalog,
    chatService: options.chatService,
    fastify: options.fastify,
  })
}
