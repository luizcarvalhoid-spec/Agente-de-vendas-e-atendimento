import { isClarificationDeferral, normalize, type CustomerNeedsRequest } from './customer-needs.js'
import type { ChatGroundingPlan } from './chat-grounding-planner.js'

const priorities = ['safety', 'restriction', 'ambiguity', 'selection', 'preference'] as const

export interface ClarificationIssue {
  readonly reason: string
  readonly priority: typeof priorities[number]
  readonly attribute: string
  readonly question?: string
  readonly limitation: string
}

export type ClarificationDecision =
  | { readonly action: 'direct' }
  | { readonly action: 'search'; readonly selection: ChatGroundingPlan['presentationIntent']; readonly flexible: boolean; readonly question?: ClarificationIssue }
  | { readonly action: 'ask' | 'explain'; readonly issue: ClarificationIssue }

function wasAsked(issue: ClarificationIssue, message: string) {
  // A reply may contain verified policy text ahead of the question.
  return issue.question !== undefined &&
    (message === issue.question || message.endsWith(`\n\n${issue.question}`))
}

export function decideClarification(input: {
  readonly plan: ChatGroundingPlan
  readonly message: string
  readonly history: CustomerNeedsRequest['history']
  readonly issues: readonly ClarificationIssue[]
  readonly selectionQuestion?: ClarificationIssue
  readonly canChooseWithoutPreference?: boolean
}): ClarificationDecision {
  const { plan, message, history, issues, selectionQuestion } = input
  const issue = priorities.map((priority) => issues.find((candidate) => candidate.priority === priority))
    .find((candidate) => candidate !== undefined)
  const deferred = isClarificationDeferral(message)
  if (issue) {
    return { action: issue.question && !deferred ? 'ask' : 'explain', issue }
  }
  if (plan.groundingRequirement === 'not_required') return { action: 'direct' }
  if (plan.presentationIntent !== 'recommendation' || !selectionQuestion) {
    return { action: 'search', selection: plan.presentationIntent, flexible: false }
  }

  const questionDeclined = history.some((entry, index) => {
    const answer = history[index + 1]
    return entry.role === 'assistant' && wasAsked(selectionQuestion, entry.content) &&
      answer?.role === 'user' && isClarificationDeferral(answer.content)
  })
  if (deferred || questionDeclined) {
    const declined = /^(?:nao quero|prefiro nao) responder\b/.test(normalize(message))
    if (input.canChooseWithoutPreference && !declined) {
      return { action: 'search', selection: 'recommendation', flexible: true }
    }
    return { action: 'explain', issue: selectionQuestion }
  }
  return { action: 'search', selection: 'recommendation', flexible: false, question: selectionQuestion }
}
