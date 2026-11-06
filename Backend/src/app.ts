import cors from '@fastify/cors'
import Fastify, { type FastifyServerOptions } from 'fastify'

import { healthRoute } from './routes/health.js'

const viteOrigins = [
  'http://localhost:5173',
  'http://127.0.0.1:5173',
]

export function buildApp(options: FastifyServerOptions = {}) {
  const app = Fastify(options)

  app.register(cors, {
    origin: viteOrigins,
    methods: ['GET', 'HEAD'],
  })
  app.register(healthRoute)

  return app
}
