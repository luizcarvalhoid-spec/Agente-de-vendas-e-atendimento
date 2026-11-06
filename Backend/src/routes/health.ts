import type { FastifyPluginAsync } from 'fastify'

import type { HealthResponse } from '../contracts/api.js'

export const healthRoute: FastifyPluginAsync = async (app) => {
  app.get('/api/health', async () => {
    const response = {
      status: 'ok',
      service: 'hidrasplash-api',
      version: '0.1.0-demo',
    } satisfies HealthResponse

    return response
  })
}
