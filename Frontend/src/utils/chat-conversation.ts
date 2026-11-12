import {
  CHAT_MAX_CONVERSATION_BYTES,
  CHAT_MAX_HISTORY_MESSAGES,
  CHAT_MAX_MESSAGE_CHARACTERS,
  isChatResponse,
  type ChatHistoryMessage,
  type ChatRecommendationContext,
  type ChatResponse,
} from '../api/chat-contracts'

export const CHAT_SESSION_STORAGE_KEY = 'hidrasplash:chat:v1'
export const CHAT_MAX_COMPLETED_TURNS = CHAT_MAX_HISTORY_MESSAGES / 2
export const CHAT_MAX_STORAGE_BYTES = 64 * 1_024

export interface CompletedTurn {
  id: string
  userMessage: string
  response: ChatResponse
  restored: boolean
}

export interface ChatSessionSnapshot {
  sessionId: string
  turns: CompletedTurn[]
}

export interface StoragePort {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
  removeItem(key: string): void
}

const sessionIdPattern = /^[A-Za-z0-9_-]{1,128}$/

function utf8Bytes(value: unknown) {
  return new TextEncoder().encode(JSON.stringify(value)).byteLength
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function hasOnlyKeys(value: Record<string, unknown>, keys: readonly string[]) {
  const actual = Object.keys(value)
  return keys.every((key) => key in value) && actual.every((key) => keys.includes(key))
}

function isUserMessage(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    value === value.trim() &&
    value.length >= 1 &&
    value.length <= CHAT_MAX_MESSAGE_CHARACTERS
  )
}

export function createChatSessionId(
  randomUuid: () => string = () => crypto.randomUUID(),
) {
  return `demo_${randomUuid()}`
}

export function createCompletedTurnId(
  randomUuid: () => string = () => crypto.randomUUID(),
) {
  return `turn_${randomUuid()}`
}

export function buildChatHistory(
  turns: readonly CompletedTurn[],
  currentMessage: string,
): ChatHistoryMessage[] {
  return selectRecentTurns(turns, currentMessage).flatMap<ChatHistoryMessage>(
    (turn) => [
      { role: 'user', content: turn.userMessage },
      { role: 'assistant', content: turn.response.message },
    ],
  )
}

function selectRecentTurns(
  turns: readonly CompletedTurn[],
  currentMessage: string,
) {
  const selected = turns.slice(-CHAT_MAX_COMPLETED_TURNS)

  while (selected.length > 0) {
    const history = selected.flatMap<ChatHistoryMessage>((turn) => [
      { role: 'user', content: turn.userMessage },
      { role: 'assistant', content: turn.response.message },
    ])
    if (
      utf8Bytes({ history, message: currentMessage }) <=
      CHAT_MAX_CONVERSATION_BYTES
    ) {
      return selected
    }
    selected.shift()
  }

  return []
}

function explicitlyInvalidatesProductReference(message: string) {
  const normalized = message
    .normalize('NFKD')
    .replace(/\p{Diacritic}/gu, '')
    .toLocaleLowerCase('pt-BR')
  return /\b(?:agora quero|mudei para|troquei para|outro|outra|nao quero mais esse|nao quero mais esta)\b.*\b(?:produto|shampoo|condicionador|mascara|finalizador|sabonete|oleo|kit)\b/.test(
    normalized,
  )
}

export function buildRecommendationContext(
  turns: readonly CompletedTurn[],
  currentMessage = '',
): ChatRecommendationContext | undefined {
  const recentTurns = selectRecentTurns(turns, currentMessage)
  for (let index = recentTurns.length - 1; index >= 0; index -= 1) {
    const turn = recentTurns[index]
    if (!turn) continue
    if (
      turn.response.type === 'recommendation' ||
      turn.response.type === 'comparison'
    ) {
      return { productIds: [...turn.response.productIds] }
    }
    if (explicitlyInvalidatesProductReference(turn.userMessage)) {
      return undefined
    }
  }
  return undefined
}

export function loadChatSession(
  storage: StoragePort,
): ChatSessionSnapshot | undefined {
  try {
    const raw = storage.getItem(CHAT_SESSION_STORAGE_KEY)
    if (!raw || new TextEncoder().encode(raw).byteLength > CHAT_MAX_STORAGE_BYTES) {
      return undefined
    }
    const value: unknown = JSON.parse(raw)
    if (
      !isRecord(value) ||
      !hasOnlyKeys(value, ['version', 'sessionId', 'turns']) ||
      value.version !== 1 ||
      typeof value.sessionId !== 'string' ||
      !sessionIdPattern.test(value.sessionId) ||
      !Array.isArray(value.turns) ||
      value.turns.length > CHAT_MAX_COMPLETED_TURNS
    ) {
      return undefined
    }

    const turns: CompletedTurn[] = []
    for (const candidate of value.turns) {
      if (
        !isRecord(candidate) ||
        !hasOnlyKeys(candidate, ['id', 'userMessage', 'response']) ||
        typeof candidate.id !== 'string' ||
        !/^turn_[A-Za-z0-9_-]+$/.test(candidate.id) ||
        !isUserMessage(candidate.userMessage) ||
        !isChatResponse(candidate.response)
      ) {
        return undefined
      }
      turns.push({
        id: candidate.id,
        userMessage: candidate.userMessage,
        response: candidate.response,
        restored: true,
      })
    }

    return { sessionId: value.sessionId, turns }
  } catch {
    return undefined
  }
}

export function saveChatSession(
  storage: StoragePort,
  snapshot: ChatSessionSnapshot,
) {
  try {
    const turns = snapshot.turns
      .slice(-CHAT_MAX_COMPLETED_TURNS)
      .map(({ id, userMessage, response }) => ({ id, userMessage, response }))
    let serialized = JSON.stringify({
      version: 1,
      sessionId: snapshot.sessionId,
      turns,
    })

    while (
      turns.length > 0 &&
      new TextEncoder().encode(serialized).byteLength > CHAT_MAX_STORAGE_BYTES
    ) {
      turns.shift()
      serialized = JSON.stringify({
        version: 1,
        sessionId: snapshot.sessionId,
        turns,
      })
    }
    if (new TextEncoder().encode(serialized).byteLength <= CHAT_MAX_STORAGE_BYTES) {
      storage.setItem(CHAT_SESSION_STORAGE_KEY, serialized)
    }
  } catch {
    // O chat continua em memória se sessionStorage estiver indisponível.
  }
}

export function clearChatSession(storage: StoragePort) {
  try {
    storage.removeItem(CHAT_SESSION_STORAGE_KEY)
  } catch {
    // O estado em memória ainda pode ser reiniciado normalmente.
  }
}
