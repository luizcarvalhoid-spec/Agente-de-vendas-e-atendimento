import cors from '@fastify/cors'
import Fastify, {
  LogController,
  type FastifyServerOptions,
} from 'fastify'

import type { ChatService } from './agent/chat-service.js'
import {
  createUsageBudgetController,
  type UsageBudgetController,
} from './agent/usage-budget-controller.js'
import type { CatalogRepository } from './catalog/catalog-repository.js'
import type { AppConfig } from './config/env.js'
import { registerErrorHandlers } from './http/error-handler.js'
import {
  createChatAdmissionController,
  type ChatAdmissionController,
} from './http/chat-admission-controller.js'
import type { ChatOperationalObserver } from './observability/chat-operational-events.js'
import { catalogRoutes } from './routes/catalog.js'
import { chatRoutes } from './routes/chat.js'
import { healthRoute } from './routes/health.js'

interface BuildAppOptions {
  config: AppConfig
  catalog: CatalogRepository
  chatService?: ChatService
  fastify?: FastifyServerOptions
  admissionController?: ChatAdmissionController
  usageBudgetController?: UsageBudgetController
  observer?: ChatOperationalObserver
}

export function buildApp({
  config,
  catalog,
  chatService,
  fastify = {},
  admissionController,
  usageBudgetController,
  observer,
}: BuildAppOptions) {
  const app = Fastify({
    ...fastify,
    trustProxy: false,
    logController: new LogController({ disableRequestLogging: true }),
  })
  const admission =
    admissionController ??
    createChatAdmissionController({
      windowMs: config.chatRateLimitWindowMs,
      perOrigin: config.chatRateLimitPerOrigin,
      perSession: config.chatRateLimitPerSession,
      maxKeys: config.chatLimiterMaxKeys,
      maxConcurrent: config.chatMaxConcurrent,
      maxConcurrentPerOrigin: config.chatMaxConcurrentPerOrigin,
    })
  const usageBudget =
    usageBudgetController ??
    createUsageBudgetController({
      executionBudgetUnits: config.chatExecutionBudgetUnits,
      windowMs: config.chatUsageWindowMs,
      windowBudgetUnits: config.chatUsageWindowBudgetUnits,
    })

  app.register(cors, {
    origin: [config.frontendOrigin],
    methods: ['GET', 'HEAD', 'POST'],
    exposedHeaders: ['Retry-After'],
  })
  registerErrorHandlers(app)
  app.register(healthRoute)
  app.register(catalogRoutes, { catalog })
  app.register(chatRoutes, {
    chatService,
    admissionController: admission,
    usageBudgetController: usageBudget,
    observer,
  })

  return app
}
