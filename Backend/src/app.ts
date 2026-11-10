import cors from '@fastify/cors'
import Fastify, { type FastifyServerOptions } from 'fastify'

import type { ChatService } from './agent/chat-service.js'
import type { CatalogRepository } from './catalog/catalog-repository.js'
import type { AppConfig } from './config/env.js'
import { registerErrorHandlers } from './http/error-handler.js'
import { catalogRoutes } from './routes/catalog.js'
import { chatRoutes } from './routes/chat.js'
import { healthRoute } from './routes/health.js'

interface BuildAppOptions {
  config: AppConfig
  catalog: CatalogRepository
  chatService?: ChatService
  fastify?: FastifyServerOptions
}

export function buildApp({
  config,
  catalog,
  chatService,
  fastify = {},
}: BuildAppOptions) {
  const app = Fastify(fastify)

  app.register(cors, {
    origin: [config.frontendOrigin],
    methods: ['GET', 'HEAD', 'POST'],
  })
  registerErrorHandlers(app)
  app.register(healthRoute)
  app.register(catalogRoutes, { catalog })
  app.register(chatRoutes, { chatService })

  return app
}
