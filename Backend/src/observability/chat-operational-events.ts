import type { BudgetedModelUsageEvent } from '../agent/usage-budget-controller.js'
import type { ChatAdmissionRejectionReason } from '../http/chat-admission-controller.js'

export type ChatOperationalEvent =
  | {
      readonly type: 'admission_rejected'
      readonly requestId: string
      readonly reason: ChatAdmissionRejectionReason
      readonly retryAfterSeconds: number
    }
  | {
      readonly type: 'execution_started'
      readonly requestId: string
    }
  | ({
      readonly type: 'model_usage'
      readonly requestId: string
    } & BudgetedModelUsageEvent)
  | {
      readonly type: 'orchestrator_termination'
      readonly requestId: string
      readonly status: string
      readonly modelCalls: number
      readonly toolCalls: number
      readonly toolErrors: number
      readonly inputTokens: number
      readonly outputTokens: number
      readonly totalTokens: number
      readonly usageComplete: boolean
    }
  | {
      readonly type: 'execution_completed'
      readonly requestId: string
      readonly status: 'success' | 'rejected' | 'failed' | 'cancelled'
      readonly code: string
      readonly durationMs: number
    }

export interface ChatOperationalObserver {
  record(event: ChatOperationalEvent): void
}

export function observeChatOperation(
  observer: ChatOperationalObserver | undefined,
  event: ChatOperationalEvent,
) {
  try {
    observer?.record(event)
  } catch {
    // Observabilidade é best-effort e nunca altera o fluxo operacional.
  }
}
