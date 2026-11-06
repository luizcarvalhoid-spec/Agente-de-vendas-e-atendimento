import type { FastifyPluginAsync } from 'fastify'

export const healthRoute: FastifyPluginAsync = async (app) => {
  app.get('/api/health', async () => ({
    status: 'ok',
    service: 'hidrasplash-api',
    version: '0.1.0-demo',
  }))
}
