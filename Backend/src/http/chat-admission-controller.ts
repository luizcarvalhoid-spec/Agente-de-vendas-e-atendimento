import { createHmac, randomBytes } from 'node:crypto'

export const CHAT_RATE_LIMIT_WINDOW_MS = 60_000
export const CHAT_RATE_LIMIT_PER_ORIGIN = 10
export const CHAT_RATE_LIMIT_PER_SESSION = 6
export const CHAT_RATE_LIMIT_MAX_KEYS = 2_000
export const CHAT_MAX_CONCURRENT = 4
export const CHAT_MAX_CONCURRENT_PER_ORIGIN = 2

interface RateEntry {
  timestamps: number[]
}

export type ChatAdmissionRejectionReason =
  | 'origin_rate_limit'
  | 'session_rate_limit'
  | 'rate_limit_capacity'
  | 'origin_concurrency_limit'
  | 'global_concurrency_limit'

export type ChatRateLimitResult =
  | { allowed: true }
  | {
      allowed: false
      reason: Exclude<
        ChatAdmissionRejectionReason,
        'origin_concurrency_limit' | 'global_concurrency_limit'
      >
      retryAfterSeconds: number
    }

export interface ChatConcurrencyLease {
  release(): void
}

export type ChatConcurrencyResult =
  | { acquired: true; lease: ChatConcurrencyLease }
  | {
      acquired: false
      reason:
        | 'origin_concurrency_limit'
        | 'global_concurrency_limit'
      retryAfterSeconds: number
    }

export interface ChatAdmissionController {
  checkRate(input: { origin: string; sessionId?: string }): ChatRateLimitResult
  acquireConcurrency(origin: string): ChatConcurrencyResult
}

export interface CreateChatAdmissionControllerOptions {
  readonly windowMs?: number
  readonly perOrigin?: number
  readonly perSession?: number
  readonly maxKeys?: number
  readonly maxConcurrent?: number
  readonly maxConcurrentPerOrigin?: number
  readonly now?: () => number
  readonly secret?: Uint8Array
}

function positiveInteger(value: number, name: string) {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new TypeError(`${name} inválido.`)
  }
  return value
}

export function createChatAdmissionController(
  options: CreateChatAdmissionControllerOptions = {},
): ChatAdmissionController {
  const windowMs = positiveInteger(
    options.windowMs ?? CHAT_RATE_LIMIT_WINDOW_MS,
    'Janela do rate limiter',
  )
  const perOrigin = positiveInteger(
    options.perOrigin ?? CHAT_RATE_LIMIT_PER_ORIGIN,
    'Limite por origem',
  )
  const perSession = positiveInteger(
    options.perSession ?? CHAT_RATE_LIMIT_PER_SESSION,
    'Limite por sessão',
  )
  const maxKeys = positiveInteger(
    options.maxKeys ?? CHAT_RATE_LIMIT_MAX_KEYS,
    'Limite de chaves',
  )
  const maxConcurrent = positiveInteger(
    options.maxConcurrent ?? CHAT_MAX_CONCURRENT,
    'Limite de concorrência global',
  )
  const maxConcurrentPerOrigin = positiveInteger(
    options.maxConcurrentPerOrigin ?? CHAT_MAX_CONCURRENT_PER_ORIGIN,
    'Limite de concorrência por origem',
  )
  if (maxConcurrentPerOrigin > maxConcurrent) {
    throw new TypeError('O limite por origem excede o limite global.')
  }

  const now = options.now ?? Date.now
  const secret = options.secret ?? randomBytes(32)
  const originEntries = new Map<string, RateEntry>()
  const sessionEntries = new Map<string, RateEntry>()
  const concurrentByOrigin = new Map<string, number>()
  let concurrent = 0
  let operations = 0

  const key = (namespace: string, value: string) =>
    createHmac('sha256', secret)
      .update(namespace)
      .update('\0')
      .update(value)
      .digest('base64url')

  const pruneEntry = (entry: RateEntry, timestamp: number) => {
    const threshold = timestamp - windowMs
    while (
      entry.timestamps[0] !== undefined &&
      entry.timestamps[0] <= threshold
    ) {
      entry.timestamps.shift()
    }
  }

  const cleanup = (table: Map<string, RateEntry>, timestamp: number) => {
    for (const [entryKey, entry] of table) {
      pruneEntry(entry, timestamp)
      if (entry.timestamps.length === 0) table.delete(entryKey)
    }
  }

  const earliestRetry = (table: Map<string, RateEntry>, timestamp: number) => {
    let earliest = Number.POSITIVE_INFINITY
    for (const entry of table.values()) {
      const first = entry.timestamps[0]
      if (first !== undefined) earliest = Math.min(earliest, first)
    }
    return Number.isFinite(earliest)
      ? Math.max(1, Math.ceil((earliest + windowMs - timestamp) / 1_000))
      : Math.max(1, Math.ceil(windowMs / 1_000))
  }

  const consume = (
    table: Map<string, RateEntry>,
    entryKey: string,
    limit: number,
    rateReason: 'origin_rate_limit' | 'session_rate_limit',
    timestamp: number,
  ): ChatRateLimitResult => {
    let entry = table.get(entryKey)
    if (entry) pruneEntry(entry, timestamp)
    if (entry?.timestamps.length === 0) {
      table.delete(entryKey)
      entry = undefined
    }

    if (!entry && table.size >= maxKeys) cleanup(table, timestamp)
    if (!entry && table.size >= maxKeys) {
      return {
        allowed: false,
        reason: 'rate_limit_capacity',
        retryAfterSeconds: earliestRetry(table, timestamp),
      }
    }

    entry ??= { timestamps: [] }
    if (entry.timestamps.length >= limit) {
      const first = entry.timestamps[0] ?? timestamp
      return {
        allowed: false,
        reason: rateReason,
        retryAfterSeconds: Math.max(
          1,
          Math.ceil((first + windowMs - timestamp) / 1_000),
        ),
      }
    }

    entry.timestamps.push(timestamp)
    table.set(entryKey, entry)
    return { allowed: true }
  }

  return {
    checkRate(input) {
      const timestamp = now()
      operations += 1
      if (operations % 64 === 0) {
        cleanup(originEntries, timestamp)
        cleanup(sessionEntries, timestamp)
      }

      const originKey = key('origin', input.origin)
      const originResult = consume(
        originEntries,
        originKey,
        perOrigin,
        'origin_rate_limit',
        timestamp,
      )
      if (!originResult.allowed) return originResult

      if (input.sessionId !== undefined) {
        const sessionKey = key(
          'session',
          `${originKey}\0${input.sessionId}`,
        )
        const sessionResult = consume(
          sessionEntries,
          sessionKey,
          perSession,
          'session_rate_limit',
          timestamp,
        )
        if (!sessionResult.allowed) return sessionResult
      }
      return { allowed: true }
    },

    acquireConcurrency(origin) {
      const originKey = key('concurrency', origin)
      const originCount = concurrentByOrigin.get(originKey) ?? 0
      if (originCount >= maxConcurrentPerOrigin) {
        return {
          acquired: false,
          reason: 'origin_concurrency_limit',
          retryAfterSeconds: 1,
        }
      }
      if (concurrent >= maxConcurrent) {
        return {
          acquired: false,
          reason: 'global_concurrency_limit',
          retryAfterSeconds: 1,
        }
      }

      concurrent += 1
      concurrentByOrigin.set(originKey, originCount + 1)
      let released = false
      return {
        acquired: true,
        lease: {
          release() {
            if (released) return
            released = true
            concurrent = Math.max(0, concurrent - 1)
            const current = concurrentByOrigin.get(originKey) ?? 0
            if (current <= 1) concurrentByOrigin.delete(originKey)
            else concurrentByOrigin.set(originKey, current - 1)
          },
        },
      }
    },
  }
}
