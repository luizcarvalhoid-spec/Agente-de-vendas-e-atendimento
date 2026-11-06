import cors from '@fastify/cors'
import Fastify, { type FastifyServerOptions } from 'fastify'

import type { AppConfig } from './config/env.js'
import { registerErrorHandlers } from './http/error-handler.js'
import { healthRoute } from './routes/health.js'

interface BuildAppOptions {
  config: AppConfig
  fastify?: FastifyServerOptions
}

export function buildApp({ config, fastify = {} }: BuildAppOptions) {
  const app = Fastify(fastify)

  app.register(cors, {
    origin: [config.frontendOrigin],
    methods: ['GET', 'HEAD'],
  })
  registerErrorHandlers(app)
  app.register(healthRoute)

  return app
}
