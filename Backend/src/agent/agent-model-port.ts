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
