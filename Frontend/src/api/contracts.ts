export type ApiErrorCode =
  | 'VALIDATION_ERROR'
  | 'NOT_FOUND'
  | 'HTTP_ERROR'
  | 'INTERNAL_SERVER_ERROR'

export interface ApiError {
  code: ApiErrorCode
  message: string
}

export interface HealthResponse {
  status: 'ok'
  service: 'hidrasplash-api'
  version: '0.1.0-demo'
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

export function isApiError(value: unknown): value is ApiError {
  if (!isRecord(value)) {
    return false
  }

  const codes: ApiErrorCode[] = [
    'VALIDATION_ERROR',
    'NOT_FOUND',
    'HTTP_ERROR',
    'INTERNAL_SERVER_ERROR',
  ]

  return (
    typeof value.code === 'string' &&
    codes.includes(value.code as ApiErrorCode) &&
    typeof value.message === 'string'
  )
}

export function isHealthResponse(value: unknown): value is HealthResponse {
  return (
    isRecord(value) &&
    value.status === 'ok' &&
    value.service === 'hidrasplash-api' &&
    value.version === '0.1.0-demo'
  )
}
