import { clarificationReply, matchesClarificationQuestion, type CustomerNeedsRequest } from './customer-needs.js'
import type { ChatGroundingPlan } from './chat-grounding-planner.js'
import type { ClarificationPrompt } from './conversation-language.js'

const priorities = ['safety', 'restriction', 'ambiguity', 'selection', 'preference'] as const

export interface ClarificationIssue {
  readonly reason: string
  readonly priority: typeof priorities[number]
  readonly attribute: string
  readonly question?: ClarificationPrompt
  readonly limitation: string
}

export type ClarificationDecision =
  | { readonly action: 'direct' }
  | { readonly action: 'search'; readonly selection: ChatGroundingPlan['presentationIntent']; readonly flexible: boolean; readonly question?: ClarificationIssue }
  | { readonly action: 'ask' | 'explain'; readonly issue: ClarificationIssue }

function latestReplyForIssue(
  issue: ClarificationIssue,
  history: CustomerNeedsRequest['history'],
  message: string,
) {
  let state: ReturnType<typeof clarificationReply>
  for (let index = 1; index < history.length; index += 1) {
    const entry = history[index]
    const previous = history[index - 1]
    if (entry?.role !== 'user') continue
    const answer = clarificationReply(entry.content)
    if (answer === 'delegated' && state !== undefined) {
      state = answer
      continue
    }
    if (answer && previous?.role === 'assistant' && issue.question &&
      matchesClarificationQuestion(previous.content, issue.question) && state !== 'refused') {
      state = answer
    }
  }
  const current = clarificationReply(message)
  if (current === 'delegated' || current === 'refused' || current === 'ended') return current
  return state === 'refused' ? state : current ?? state
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
  if (issue) {
    const deferred = latestReplyForIssue(issue, history, message)
    return { action: issue.question && !deferred ? 'ask' : 'explain', issue }
  }
  if (plan.groundingRequirement === 'not_required') return { action: 'direct' }
  if (plan.presentationIntent !== 'recommendation' || !selectionQuestion) {
    return { action: 'search', selection: plan.presentationIntent, flexible: false }
  }

  const response = latestReplyForIssue(selectionQuestion, history, message)
  if (response) {
    if (input.canChooseWithoutPreference && response !== 'refused' && response !== 'ended') {
      return { action: 'search', selection: 'recommendation', flexible: true }
    }
    return { action: 'explain', issue: selectionQuestion }
  }
  return { action: 'search', selection: 'recommendation', flexible: false, question: selectionQuestion }
}
