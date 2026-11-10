import { loadEnvFile } from 'node:process'

import { z } from 'zod'

const emptyStringToUndefined = (value: unknown) =>
  typeof value === 'string' && value.trim() === '' ? undefined : value

const optionalNonEmptyString = z.preprocess(
  emptyStringToUndefined,
  z.string().trim().min(1).optional(),
)

const boundedInteger = (defaultValue: number, minimum: number, maximum: number) =>
  z.preprocess(
    emptyStringToUndefined,
    z.coerce.number().int().min(minimum).max(maximum).default(defaultValue),
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
    PORT: boundedInteger(3333, 1, 65_535),
    FRONTEND_ORIGIN: z.preprocess(
      emptyStringToUndefined,
      frontendOriginSchema.default('http://localhost:5173'),
    ),
    OPENROUTER_API_KEY: optionalNonEmptyString,
    OPENROUTER_MODEL: optionalNonEmptyString,
    OPENROUTER_MAX_OUTPUT_TOKENS: boundedInteger(512, 1, 4_096),
    CHAT_RATE_LIMIT_WINDOW_MS: boundedInteger(60_000, 1_000, 3_600_000),
    CHAT_RATE_LIMIT_PER_ORIGIN: boundedInteger(10, 1, 10_000),
    CHAT_RATE_LIMIT_PER_SESSION: boundedInteger(6, 1, 10_000),
    CHAT_LIMITER_MAX_KEYS: boundedInteger(2_000, 1, 100_000),
    CHAT_MAX_CONCURRENT: boundedInteger(4, 1, 1_000),
    CHAT_MAX_CONCURRENT_PER_ORIGIN: boundedInteger(2, 1, 1_000),
    CHAT_EXECUTION_BUDGET_UNITS: boundedInteger(
      120_000,
      1_000,
      10_000_000,
    ),
    CHAT_USAGE_WINDOW_MS: boundedInteger(
      3_600_000,
      60_000,
      86_400_000,
    ),
    CHAT_USAGE_WINDOW_BUDGET_UNITS: boundedInteger(
      500_000,
      1_000,
      100_000_000,
    ),
  })

export interface AppConfig {
  port: number
  frontendOrigin: string
  openRouterApiKey?: string
  openRouterModel?: string
  openRouterStatus: 'disabled' | 'configured' | 'invalid'
  openRouterMaxOutputTokens: number
  chatRateLimitWindowMs: number
  chatRateLimitPerOrigin: number
  chatRateLimitPerSession: number
  chatLimiterMaxKeys: number
  chatMaxConcurrent: number
  chatMaxConcurrentPerOrigin: number
  chatExecutionBudgetUnits: number
  chatUsageWindowMs: number
  chatUsageWindowBudgetUnits: number
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

  const apiKey = result.data.OPENROUTER_API_KEY
  const model = result.data.OPENROUTER_MODEL
  const openRouterStatus =
    apiKey === undefined && model === undefined
      ? 'disabled'
      : apiKey !== undefined &&
          apiKey.length <= 4_096 &&
          model !== undefined &&
          /^[^\s/]+\/[^\s]+$/.test(model)
        ? 'configured'
        : 'invalid'

  if (
    result.data.CHAT_MAX_CONCURRENT_PER_ORIGIN >
    result.data.CHAT_MAX_CONCURRENT
  ) {
    throw new ConfigError(['CHAT_MAX_CONCURRENT_PER_ORIGIN'])
  }

  return {
    port: result.data.PORT,
    frontendOrigin: result.data.FRONTEND_ORIGIN,
    openRouterApiKey: apiKey,
    openRouterModel: model,
    openRouterStatus,
    openRouterMaxOutputTokens: result.data.OPENROUTER_MAX_OUTPUT_TOKENS,
    chatRateLimitWindowMs: result.data.CHAT_RATE_LIMIT_WINDOW_MS,
    chatRateLimitPerOrigin: result.data.CHAT_RATE_LIMIT_PER_ORIGIN,
    chatRateLimitPerSession: result.data.CHAT_RATE_LIMIT_PER_SESSION,
    chatLimiterMaxKeys: result.data.CHAT_LIMITER_MAX_KEYS,
    chatMaxConcurrent: result.data.CHAT_MAX_CONCURRENT,
    chatMaxConcurrentPerOrigin:
      result.data.CHAT_MAX_CONCURRENT_PER_ORIGIN,
    chatExecutionBudgetUnits: result.data.CHAT_EXECUTION_BUDGET_UNITS,
    chatUsageWindowMs: result.data.CHAT_USAGE_WINDOW_MS,
    chatUsageWindowBudgetUnits:
      result.data.CHAT_USAGE_WINDOW_BUDGET_UNITS,
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
