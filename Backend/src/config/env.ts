import { loadEnvFile } from 'node:process'

import { z } from 'zod'

const emptyStringToUndefined = (value: unknown) =>
  typeof value === 'string' && value.trim() === '' ? undefined : value

const optionalNonEmptyString = z.preprocess(
  emptyStringToUndefined,
  z.string().trim().min(1).optional(),
)

const frontendOriginSchema = z
  .string()
  .trim()
  .url()
  .refine((value) => {
    const url = new URL(value)
    return (
      (url.protocol === 'http:' || url.protocol === 'https:') &&
      value === url.origin
    )
  }, 'Deve ser uma origem HTTP ou HTTPS sem caminho, query, fragmento ou credenciais.')

const environmentSchema = z
  .object({
    PORT: z.preprocess(
      emptyStringToUndefined,
      z.coerce.number().int().min(1).max(65_535).default(3333),
    ),
    FRONTEND_ORIGIN: z.preprocess(
      emptyStringToUndefined,
      frontendOriginSchema.default('http://localhost:5173'),
    ),
    OPENROUTER_API_KEY: optionalNonEmptyString,
    OPENROUTER_MODEL: optionalNonEmptyString,
  })
  .refine(
    ({ OPENROUTER_API_KEY, OPENROUTER_MODEL }) =>
      Boolean(OPENROUTER_API_KEY) === Boolean(OPENROUTER_MODEL),
    {
      message: 'OPENROUTER_API_KEY e OPENROUTER_MODEL devem ser definidos juntos.',
      path: ['OPENROUTER_API_KEY'],
    },
  )

export interface AppConfig {
  port: number
  frontendOrigin: string
  openRouterApiKey?: string
  openRouterModel?: string
}

export class ConfigError extends Error {
  readonly fields: string[]

  constructor(fields: string[]) {
    super('Configuração de ambiente inválida.')
    this.name = 'ConfigError'
    this.fields = fields
  }
}

export function loadConfig(env: NodeJS.ProcessEnv): AppConfig {
  const result = environmentSchema.safeParse(env)

  if (!result.success) {
    const fields = [
      ...new Set(
        result.error.issues.map((issue) => issue.path.join('.') || 'environment'),
      ),
    ]
    throw new ConfigError(fields)
  }

  return {
    port: result.data.PORT,
    frontendOrigin: result.data.FRONTEND_ORIGIN,
    openRouterApiKey: result.data.OPENROUTER_API_KEY,
    openRouterModel: result.data.OPENROUTER_MODEL,
  }
}

export function loadLocalEnvFile(path = '.env') {
  try {
    loadEnvFile(path)
  } catch (error) {
    const code =
      typeof error === 'object' && error !== null && 'code' in error
        ? error.code
        : undefined

    if (code !== 'ENOENT') {
      throw new ConfigError([path])
    }
  }
}
