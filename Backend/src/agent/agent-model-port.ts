export interface AgentToolCall {
  readonly id: string
  readonly type: 'function'
  readonly function: {
    readonly name: string
    readonly arguments: string
  }
}

export type AgentMessage =
  | {
      readonly role: 'system' | 'user'
      readonly content: string
    }
  | {
      readonly role: 'assistant'
      readonly content: string | null
      readonly toolCalls?: readonly AgentToolCall[]
    }
  | {
      readonly role: 'tool'
      readonly toolCallId: string
      readonly content: string
    }

export interface AgentFunctionDefinition {
  readonly type: 'function'
  readonly function: {
    readonly name: string
    readonly description: string
    readonly parameters: Readonly<Record<string, unknown>>
  }
}

export interface AgentModelInput {
  readonly messages: readonly AgentMessage[]
  readonly tools: readonly AgentFunctionDefinition[]
  readonly signal: AbortSignal
  readonly maxOutputTokens?: number
}

export interface AgentModelResult {
  readonly message: {
    readonly role: 'assistant'
    readonly content: string | null
    readonly toolCalls?: readonly AgentToolCall[]
  }
  readonly usage?: {
    readonly inputTokens: number
    readonly outputTokens: number
    readonly totalTokens: number
  }
}

export interface AgentModelPort {
  complete(input: AgentModelInput): Promise<AgentModelResult>
}

export type AgentModelErrorCode =
  | 'CONFIGURATION_INVALID'
  | 'AUTHENTICATION_FAILED'
  | 'PROVIDER_RATE_LIMITED'
  | 'PROVIDER_UNAVAILABLE'
  | 'MODEL_TIMEOUT'
  | 'MODEL_CANCELLED'
  | 'INVALID_MODEL_RESPONSE'
  | 'TOOL_CALLING_INCOMPATIBLE'
  | 'LOCAL_BUDGET_EXHAUSTED'

export class AgentModelError extends Error {
  readonly code: AgentModelErrorCode
  readonly transportStarted: boolean

  constructor(code: AgentModelErrorCode, transportStarted: boolean) {
    super('Falha sanitizada do modelo.')
    this.name = 'AgentModelError'
    this.code = code
    this.transportStarted = transportStarted
  }
}
