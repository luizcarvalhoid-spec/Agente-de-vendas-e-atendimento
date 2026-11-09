import { randomUUID } from 'node:crypto'

import type { FastifyPluginAsync, FastifyReply } from 'fastify'

import {
  ChatServiceError,
  type ChatService,
} from '../agent/chat-service.js'
import type { ApiError } from '../contracts/api.js'
import {
  CHAT_MAX_BODY_BYTES,
  chatRequestSchema,
  chatResponseSchema,
} from '../contracts/chat.js'

interface ChatRoutesOptions {
  chatService?: ChatService
  requestIdFactory?: () => string
}

type ChatApiError = ApiError & { requestId: string }

const publicErrors = {
  validation: {
    code: 'VALIDATION_ERROR',
    message: 'Dados de entrada inválidos.',
    statusCode: 400,
  },
  unavailable: {
    code: 'AI_UNAVAILABLE',
    message: 'O atendimento consultivo está temporariamente indisponível.',
    statusCode: 503,
  },
  badResponse: {
    code: 'AI_BAD_RESPONSE',
    message: 'Não foi possível produzir uma resposta consultiva válida.',
    statusCode: 502,
  },
  timeout: {
    code: 'AI_TIMEOUT',
    message: 'A consulta excedeu o tempo limite desta demonstração.',
    statusCode: 504,
  },
  internal: {
    code: 'INTERNAL_SERVER_ERROR',
    message: 'Erro interno do servidor.',
    statusCode: 500,
  },
} as const

function sendError(
  reply: FastifyReply,
  error: (typeof publicErrors)[keyof typeof publicErrors],
  requestId: string,
) {
  const body = {
    code: error.code,
    message: error.message,
    requestId,
  } satisfies ChatApiError
  return reply.status(error.statusCode).send(body)
}

export const chatRoutes: FastifyPluginAsync<ChatRoutesOptions> = async (
  app,
  options,
) => {
  const requestIdFactory = options.requestIdFactory ?? randomUUID

  app.post(
    '/api/chat',
    { bodyLimit: CHAT_MAX_BODY_BYTES },
    async (request, reply) => {
      const requestId = requestIdFactory()
      const parsed = chatRequestSchema.safeParse(request.body)
      if (!parsed.success) {
        return sendError(reply, publicErrors.validation, requestId)
      }
      if (!options.chatService) {
        return sendError(reply, publicErrors.unavailable, requestId)
      }

      const controller = new AbortController()
      const abortFromRequest = () => controller.abort()
      const abortFromRequestClose = () => {
        if (
          !reply.raw.writableEnded &&
          (request.raw.aborted || reply.raw.destroyed)
        ) {
          controller.abort()
        }
      }
      const abortFromResponse = () => {
        if (!reply.raw.writableEnded) controller.abort()
      }
      request.raw.once('aborted', abortFromRequest)
      request.raw.once('close', abortFromRequestClose)
      reply.raw.once('close', abortFromResponse)

      try {
        const response = await options.chatService.execute(parsed.data, {
          requestId,
          signal: controller.signal,
        })
        if (controller.signal.aborted || reply.raw.destroyed) return reply
        return reply.status(200).send(chatResponseSchema.parse(response))
      } catch (error) {
        if (controller.signal.aborted || reply.raw.destroyed) return reply
        if (error instanceof ChatServiceError) {
          if (error.code === 'INVALID_REQUEST') {
            return sendError(reply, publicErrors.validation, requestId)
          }
          if (error.code === 'AI_TIMEOUT') {
            return sendError(reply, publicErrors.timeout, requestId)
          }
          if (error.code === 'AI_BAD_RESPONSE') {
            return sendError(reply, publicErrors.badResponse, requestId)
          }
          return sendError(reply, publicErrors.unavailable, requestId)
        }
        request.log.error({ requestId }, 'Chat request failed')
        return sendError(reply, publicErrors.internal, requestId)
      } finally {
        request.raw.removeListener('aborted', abortFromRequest)
        request.raw.removeListener('close', abortFromRequestClose)
        reply.raw.removeListener('close', abortFromResponse)
      }
    },
  )
}
