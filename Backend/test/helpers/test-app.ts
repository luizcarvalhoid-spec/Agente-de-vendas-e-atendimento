import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import type { FastifyServerOptions } from 'fastify'

import type { ChatService } from '../../src/agent/chat-service.js'
import type { UsageBudgetController } from '../../src/agent/usage-budget-controller.js'
import { buildApp } from '../../src/app.js'
import {
  loadCatalogRepository,
  type CatalogRepository,
} from '../../src/catalog/catalog-repository.js'
import { loadConfig, type AppConfig } from '../../src/config/env.js'
import type { ChatAdmissionController } from '../../src/http/chat-admission-controller.js'
import type { ChatOperationalObserver } from '../../src/observability/chat-operational-events.js'

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
  admissionController?: ChatAdmissionController
  usageBudgetController?: UsageBudgetController
  observer?: ChatOperationalObserver
} = {}) {
  const catalog = await loadTestCatalog()

  return buildApp({
    config: options.config ?? loadConfig({}),
    catalog,
    chatService: options.chatService,
    fastify: options.fastify,
    admissionController: options.admissionController,
    usageBudgetController: options.usageBudgetController,
    observer: options.observer,
  })
}
