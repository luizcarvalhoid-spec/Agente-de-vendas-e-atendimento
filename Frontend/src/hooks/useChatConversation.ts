import { useCallback, useEffect, useRef, useState } from 'react'

import { ApiRequestError, sendChat } from '../api/client'
import { CHAT_MAX_MESSAGE_CHARACTERS } from '../api/chat-contracts'
import {
  buildChatHistory,
  clearChatSession,
  createChatSessionId,
  createCompletedTurnId,
  loadChatSession,
  saveChatSession,
  type CompletedTurn,
  type StoragePort,
} from '../utils/chat-conversation'

export const CHAT_LOCAL_TIMEOUT_MS = 50_000

export type ChatFailureReason =
  | 'configuration'
  | 'network'
  | 'validation'
  | 'rate-limited'
  | 'unavailable'
  | 'bad-response'
  | 'timeout'
  | 'invalid-response'
  | 'server'

export interface ChatAttempt {
  id: string
  message: string
}

export interface ChatFailedAttempt extends ChatAttempt {
  reason: ChatFailureReason
  canRetry: boolean
  requestId?: string
  retryAt?: number
}

interface ActiveOperation {
  id: string
  controller: AbortController
  timeoutId: number
}

function getSessionStorage(): StoragePort | undefined {
  try {
    return window.sessionStorage
  } catch {
    return undefined
  }
}

function classifyFailure(error: unknown, message: string, id: string) {
  const base = { id, message }
  if (!(error instanceof ApiRequestError)) {
    return {
      ...base,
      reason: 'server',
      canRetry: true,
    } satisfies ChatFailedAttempt
  }

  const diagnostic = error.requestId
    ? { requestId: error.requestId }
    : {}
  if (error.kind === 'configuration') {
    return {
      ...base,
      ...diagnostic,
      reason: 'configuration',
      canRetry: false,
    } satisfies ChatFailedAttempt
  }
  if (error.kind === 'invalid-request' || error.code === 'VALIDATION_ERROR') {
    return {
      ...base,
      ...diagnostic,
      reason: 'validation',
      canRetry: false,
    } satisfies ChatFailedAttempt
  }
  if (error.kind === 'network') {
    return {
      ...base,
      ...diagnostic,
      reason: 'network',
      canRetry: true,
    } satisfies ChatFailedAttempt
  }
  if (error.kind === 'invalid-response') {
    return {
      ...base,
      ...diagnostic,
      reason: 'invalid-response',
      canRetry: true,
    } satisfies ChatFailedAttempt
  }
  if (error.status === 429 || error.code === 'RATE_LIMITED') {
    const retryAt = Date.now() + (error.retryAfterSeconds ?? 1) * 1_000
    return {
      ...base,
      ...diagnostic,
      reason: 'rate-limited',
      canRetry: true,
      retryAt,
    } satisfies ChatFailedAttempt
  }
  if (error.status === 503 || error.code === 'AI_UNAVAILABLE') {
    return {
      ...base,
      ...diagnostic,
      reason: 'unavailable',
      canRetry: true,
    } satisfies ChatFailedAttempt
  }
  if (error.status === 504 || error.code === 'AI_TIMEOUT') {
    return {
      ...base,
      ...diagnostic,
      reason: 'timeout',
      canRetry: true,
    } satisfies ChatFailedAttempt
  }
  if (error.status === 502 || error.code === 'AI_BAD_RESPONSE') {
    return {
      ...base,
      ...diagnostic,
      reason: 'bad-response',
      canRetry: true,
    } satisfies ChatFailedAttempt
  }
  return {
    ...base,
    ...diagnostic,
    reason: 'server',
    canRetry: true,
  } satisfies ChatFailedAttempt
}

export function useChatConversation() {
  const [initial] = useState(() => {
    const storage = getSessionStorage()
    const restored = storage ? loadChatSession(storage) : undefined
    return {
      storage,
      sessionId: restored?.sessionId ?? createChatSessionId(),
      turns: restored?.turns ?? [],
    }
  })
  const storageRef = useRef(initial.storage)
  const [sessionId, setSessionId] = useState(initial.sessionId)
  const [turns, setTurns] = useState<CompletedTurn[]>(initial.turns)
  const [pending, setPending] = useState<ChatAttempt>()
  const [failure, setFailure] = useState<ChatFailedAttempt>()
  const [rateLimitUntil, setRateLimitUntil] = useState<number>()
  const [clock, setClock] = useState(() => Date.now())
  const activeRef = useRef<ActiveOperation>()
  const turnsRef = useRef(turns)
  const sessionIdRef = useRef(sessionId)

  useEffect(() => {
    turnsRef.current = turns
    sessionIdRef.current = sessionId
    if (storageRef.current) {
      saveChatSession(storageRef.current, { sessionId, turns })
    }
  }, [sessionId, turns])

  useEffect(() => {
    if (rateLimitUntil === undefined || rateLimitUntil <= clock) return
    const timer = window.setTimeout(
      () => setClock(Date.now()),
      Math.min(1_000, rateLimitUntil - clock),
    )
    return () => window.clearTimeout(timer)
  }, [clock, rateLimitUntil])

  const cancelActive = useCallback(() => {
    const active = activeRef.current
    if (!active) return
    activeRef.current = undefined
    window.clearTimeout(active.timeoutId)
    active.controller.abort()
    setPending(undefined)
  }, [])

  useEffect(
    () => () => {
      const active = activeRef.current
      if (!active) return
      activeRef.current = undefined
      window.clearTimeout(active.timeoutId)
      active.controller.abort()
    },
    [],
  )

  const startRequest = useCallback((message: string, id: string) => {
    if (activeRef.current) return false
    const normalized = message.trim()
    if (
      normalized.length < 1 ||
      normalized.length > CHAT_MAX_MESSAGE_CHARACTERS ||
      (rateLimitUntil !== undefined && rateLimitUntil > Date.now())
    ) {
      return false
    }

    const controller = new AbortController()
    const operation: ActiveOperation = {
      id,
      controller,
      timeoutId: 0,
    }
    operation.timeoutId = window.setTimeout(() => {
      if (activeRef.current !== operation) return
      activeRef.current = undefined
      controller.abort()
      setPending(undefined)
      setFailure({
        id,
        message: normalized,
        reason: 'timeout',
        canRetry: true,
      })
    }, CHAT_LOCAL_TIMEOUT_MS)
    activeRef.current = operation
    setFailure(undefined)
    setPending({ id, message: normalized })

    const request = {
      message: normalized,
      sessionId: sessionIdRef.current,
      history: buildChatHistory(turnsRef.current, normalized),
    }
    void sendChat(request, controller.signal)
      .then((response) => {
        if (activeRef.current !== operation) return
        setTurns((previous) => [
          ...previous,
          {
            id,
            userMessage: normalized,
            response,
            restored: false,
          },
        ])
        setPending(undefined)
      })
      .catch((error: unknown) => {
        if (activeRef.current !== operation) return
        setPending(undefined)
        const classified = classifyFailure(error, normalized, id)
        if (classified.retryAt !== undefined) {
          setRateLimitUntil(classified.retryAt)
          setClock(Date.now())
        }
        setFailure(classified)
      })
      .finally(() => {
        if (activeRef.current !== operation) return
        window.clearTimeout(operation.timeoutId)
        activeRef.current = undefined
      })
    return true
  }, [rateLimitUntil])

  const send = useCallback(
    (message: string) => startRequest(message, createCompletedTurnId()),
    [startRequest],
  )
  const retry = useCallback(() => {
    if (
      !failure?.canRetry ||
      (failure.retryAt !== undefined && failure.retryAt > Date.now())
    ) {
      return false
    }
    return startRequest(failure.message, failure.id)
  }, [failure, startRequest])
  const takeValidationMessageForEditing = useCallback(() => {
    if (failure?.reason !== 'validation') return undefined
    setFailure(undefined)
    return failure.message
  }, [failure])
  const startNewConversation = useCallback(() => {
    cancelActive()
    if (storageRef.current) clearChatSession(storageRef.current)
    const nextSessionId = createChatSessionId()
    sessionIdRef.current = nextSessionId
    turnsRef.current = []
    setSessionId(nextSessionId)
    setTurns([])
    setPending(undefined)
    setFailure(undefined)
  }, [cancelActive])

  const retryAfterSeconds =
    rateLimitUntil !== undefined && rateLimitUntil > clock
      ? Math.max(1, Math.ceil((rateLimitUntil - clock) / 1_000))
      : 0

  return {
    sessionId,
    turns,
    pending,
    failure,
    isPending: pending !== undefined,
    retryAfterSeconds,
    canSend: pending === undefined && retryAfterSeconds === 0,
    send,
    retry,
    takeValidationMessageForEditing,
    cancelActive,
    startNewConversation,
  }
}
