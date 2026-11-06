import type { FastifyInstance } from 'fastify'
import { ZodError } from 'zod'

import type { ApiError } from '../contracts/api.js'

const validationError: ApiError = {
  code: 'VALIDATION_ERROR',
  message: 'Dados de entrada inválidos.',
}

const notFoundError: ApiError = {
  code: 'NOT_FOUND',
  message: 'Recurso não encontrado.',
}

const httpError: ApiError = {
  code: 'HTTP_ERROR',
  message: 'Requisição inválida.',
}

const internalServerError: ApiError = {
  code: 'INTERNAL_SERVER_ERROR',
  message: 'Erro interno do servidor.',
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function hasFastifyValidation(error: unknown) {
  return isRecord(error) && error.validation !== undefined
}

function getClientStatusCode(error: unknown) {
  if (
    isRecord(error) &&
    typeof error.statusCode === 'number' &&
    error.statusCode >= 400 &&
    error.statusCode < 500
  ) {
    return error.statusCode
  }

  return undefined
}

export function registerErrorHandlers(app: FastifyInstance) {
  app.setNotFoundHandler((_request, reply) => {
    return reply.status(404).send(notFoundError)
  })

  app.setErrorHandler((error, request, reply) => {
    if (error instanceof ZodError || hasFastifyValidation(error)) {
      return reply.status(400).send(validationError)
    }

    const statusCode = getClientStatusCode(error) ?? 500

    if (statusCode < 500) {
      return reply.status(statusCode).send(httpError)
    }

    request.log.error({ err: error }, 'Unhandled request error')
    return reply.status(500).send(internalServerError)
  })
}
