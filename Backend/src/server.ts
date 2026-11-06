import { buildApp } from './app.js'
import { ConfigError, loadConfig, loadLocalEnvFile } from './config/env.js'

try {
  loadLocalEnvFile()
  const config = loadConfig(process.env)
  const app = buildApp({ config, fastify: { logger: true } })

  await app.listen({ host: '127.0.0.1', port: config.port })
} catch (error) {
  if (error instanceof ConfigError) {
    console.error(error.message, { fields: error.fields })
  } else {
    console.error('Falha ao iniciar a API.')
  }
  process.exitCode = 1
}
