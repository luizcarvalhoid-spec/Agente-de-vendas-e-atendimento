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
import type { UsageBudgetController } from '../agent/usage-budget-controller.js'
import type { ChatAdmissionController } from '../http/chat-admission-controller.js'
import {
  observeChatOperation,
  type ChatOperationalObserver,
} from '../observability/chat-operational-events.js'

interface ChatRoutesOptions {
  chatService?: ChatService
  requestIdFactory?: () => string
  admissionController: ChatAdmissionController
  usageBudgetController: UsageBudgetController
  observer?: ChatOperationalObserver
  now?: () => number
}

type ChatApiError = ApiError & { requestId: string }

const publicErrors = {
  validation: {
    code: 'VALIDATION_ERROR',
    message: 'Dados de entrada inválidos.',
    statusCode: 400,
  },
  rateLimited: {
    code: 'RATE_LIMITED',
    message:
      'Muitas solicitações foram recebidas. Aguarde alguns segundos e tente novamente.',
    statusCode: 429,
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
  retryAfterSeconds?: number,
) {
  const body = {
    code: error.code,
    message: error.message,
    requestId,
  } satisfies ChatApiError
  if (retryAfterSeconds !== undefined) {
    reply.header('Retry-After', String(Math.max(1, retryAfterSeconds)))
  }
  return reply.status(error.statusCode).send(body)
}

export const chatRoutes: FastifyPluginAsync<ChatRoutesOptions> = async (
  app,
  options,
) => {
  const requestIdFactory = options.requestIdFactory ?? randomUUID
  const now = options.now ?? Date.now
  const observer =
    options.observer ??
    ({
      record(event) {
        app.log.info({ chat: event }, 'Chat operational event')
      },
    } satisfies ChatOperationalObserver)

  app.post(
    '/api/chat',
    { bodyLimit: CHAT_MAX_BODY_BYTES },
    async (request, reply) => {
      const requestId = requestIdFactory()
      const parsed = chatRequestSchema.safeParse(request.body)
      if (!parsed.success) {
        return sendError(reply, publicErrors.validation, requestId)
      }

      const rate = options.admissionController.checkRate({
        origin: request.ip,
        ...(parsed.data.sessionId !== undefined
          ? { sessionId: parsed.data.sessionId }
          : {}),
      })
      if (!rate.allowed) {
        observeChatOperation(observer, {
          type: 'admission_rejected',
          requestId,
          reason: rate.reason,
          retryAfterSeconds: rate.retryAfterSeconds,
        })
        return sendError(
          reply,
          publicErrors.rateLimited,
          requestId,
          rate.retryAfterSeconds,
        )
      }
      if (!options.chatService) {
        return sendError(reply, publicErrors.unavailable, requestId)
      }

      const concurrency = options.admissionController.acquireConcurrency(
        request.ip,
      )
      if (!concurrency.acquired) {
        observeChatOperation(observer, {
          type: 'admission_rejected',
          requestId,
          reason: concurrency.reason,
          retryAfterSeconds: concurrency.retryAfterSeconds,
        })
        return sendError(
          reply,
          concurrency.reason === 'origin_concurrency_limit'
            ? publicErrors.rateLimited
            : publicErrors.unavailable,
          requestId,
          concurrency.retryAfterSeconds,
        )
      }

      const startedAt = now()
      let finalStatus: 'success' | 'rejected' | 'failed' | 'cancelled' =
        'failed'
      let finalCode = 'INTERNAL_SERVER_ERROR'
      observeChatOperation(observer, { type: 'execution_started', requestId })

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
          usageBudget: options.usageBudgetController.createExecution(),
          observer,
        })
        if (controller.signal.aborted || reply.raw.destroyed) {
          finalStatus = 'cancelled'
          finalCode = 'REQUEST_CANCELLED'
          return reply
        }
        const publicResponse = chatResponseSchema.parse(response)
        finalStatus = 'success'
        finalCode = 'OK'
        return reply.status(200).send(publicResponse)
      } catch (error) {
        if (controller.signal.aborted || reply.raw.destroyed) {
          finalStatus = 'cancelled'
          finalCode = 'REQUEST_CANCELLED'
          return reply
        }
        if (error instanceof ChatServiceError) {
          if (error.code === 'INVALID_REQUEST') {
            finalStatus = 'rejected'
            finalCode = 'VALIDATION_ERROR'
            return sendError(reply, publicErrors.validation, requestId)
          }
          if (error.code === 'AI_TIMEOUT') {
            finalCode = 'AI_TIMEOUT'
            return sendError(reply, publicErrors.timeout, requestId)
          }
          if (error.code === 'AI_BAD_RESPONSE') {
            finalCode = 'AI_BAD_RESPONSE'
            return sendError(reply, publicErrors.badResponse, requestId)
          }
          finalCode = 'AI_UNAVAILABLE'
          return sendError(reply, publicErrors.unavailable, requestId)
        }
        request.log.error({ requestId }, 'Chat request failed')
        finalCode = 'INTERNAL_SERVER_ERROR'
        return sendError(reply, publicErrors.internal, requestId)
      } finally {
        request.raw.removeListener('aborted', abortFromRequest)
        request.raw.removeListener('close', abortFromRequestClose)
        reply.raw.removeListener('close', abortFromResponse)
        concurrency.lease.release()
        observeChatOperation(observer, {
          type: 'execution_completed',
          requestId,
          status: finalStatus,
          code: finalCode,
          durationMs: Math.max(0, now() - startedAt),
        })
      }
    },
  )
}
