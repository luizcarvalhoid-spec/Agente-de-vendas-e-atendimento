import type { AgentToolCall } from '../agent/agent-model-port.js'
import type {
  ProductEligibilityPolicy,
  ProductSearchIndex,
  SearchProductsInput,
} from '../agent/tools/product-tools.js'
import type { AgentToolExecutionContext } from '../agent/tools/agent-tool.js'
import type { ChatOperationalEvent } from '../observability/chat-operational-events.js'
import type {
  FaqSearchIndex,
  FaqSearchResult,
} from '../knowledge/faq-search.js'

export type EvalGroundingDomainStatus =
  | 'not_consulted'
  | 'found'
  | 'not_found'
  | 'failed'

export interface EvalToolCallEvidence {
  readonly name: string
  readonly arguments: Readonly<Record<string, unknown>>
}

export interface EvalIngredientResolutionEvidence {
  readonly terms: readonly string[]
  readonly resolvedIds: readonly string[]
  readonly unresolvedTerms: readonly string[]
}

export interface EvalProductSearchEvidence {
  readonly incompatibleIngredientIds: readonly string[]
  readonly resultProductIds: readonly number[]
}

export interface EvalFaqSearchEvidence {
  readonly sourceIds: readonly string[]
}

export interface EvalRuntimeTrace {
  readonly modelCalls: number
  readonly toolsCalled: readonly string[]
  readonly toolCalls: readonly EvalToolCallEvidence[]
  readonly grounding: {
    readonly requirement:
      | 'not_required'
      | 'product'
      | 'faq'
      | 'any'
      | 'both'
    readonly product: EvalGroundingDomainStatus
    readonly faq: EvalGroundingDomainStatus
  }
  readonly ingredientResolutions: readonly EvalIngredientResolutionEvidence[]
  readonly productSearches: readonly EvalProductSearchEvidence[]
  readonly faqSearches: readonly EvalFaqSearchEvidence[]
}

const emptyGrounding: EvalRuntimeTrace['grounding'] = {
  requirement: 'not_required',
  product: 'not_consulted',
  faq: 'not_consulted',
}

function safeArguments(toolCall: AgentToolCall) {
  let value: unknown
  try {
    value = JSON.parse(toolCall.function.arguments) as unknown
  } catch {
    return {}
  }
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    return {}
  }

  const input = value as Record<string, unknown>
  const output: Record<string, unknown> = {}
  const redact = (text: string) =>
    text
      .replace(
        /\b(?:sk-or-|sk-)[A-Za-z0-9_-]{4,}\b/gi,
        '[CREDENTIAL_REDACTED]',
      )
      .replace(
        /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi,
        '[EMAIL_REDACTED]',
      )
      .replace(
        /\b\d{3}\.?\d{3}\.?\d{3}-?\d{2}\b/g,
        '[IDENTIFIER_REDACTED]',
      )
      .replace(
        /\b(?:\d[ -]?){13,19}\b/g,
        '[PAYMENT_DATA_REDACTED]',
      )
  for (const key of [
    'query',
    'limit',
    'productId',
    'category',
    'subcategory',
    'maxPrice',
    'requireInStock',
    'incompatibleIngredientIds',
  ]) {
    const field = input[key]
    if (typeof field === 'string') {
      output[key] = redact(field)
    } else if (typeof field === 'number' || typeof field === 'boolean') {
      output[key] = field
    } else if (
      Array.isArray(field) &&
      field.every(
        (item) => typeof item === 'string' || typeof item === 'number',
      )
    ) {
      output[key] = field.map((item) =>
        typeof item === 'string' ? redact(item) : item,
      )
    }
  }
  return output
}

export class OfflineEvalTraceCollector {
  private modelCallCount = 0
  private requestedToolCalls: EvalToolCallEvidence[] = []
  private grounding = emptyGrounding
  private ingredientResolutions: EvalIngredientResolutionEvidence[] = []
  private productSearches: EvalProductSearchEvidence[] = []
  private faqSearches: EvalFaqSearchEvidence[] = []

  beginTurn() {
    this.modelCallCount = 0
    this.requestedToolCalls = []
    this.grounding = emptyGrounding
    this.ingredientResolutions = []
    this.productSearches = []
    this.faqSearches = []
  }

  recordModelCall(toolCalls: readonly AgentToolCall[]) {
    this.modelCallCount += 1
    this.requestedToolCalls.push(
      ...toolCalls.map((toolCall) => ({
        name: toolCall.function.name,
        arguments: safeArguments(toolCall),
      })),
    )
  }

  recordOperationalEvent(event: ChatOperationalEvent) {
    if (event.type !== 'orchestrator_termination') return
    this.grounding = {
      requirement: event.groundingRequirement,
      product: event.productGrounding,
      faq: event.faqGrounding,
    }
    this.modelCallCount = event.modelCalls
  }

  recordIngredientResolution(
    terms: readonly string[],
    result: {
      resolvedIds: readonly string[]
      unresolvedTerms: readonly string[]
    },
  ) {
    if (terms.length === 0) return
    this.ingredientResolutions.push({
      terms: [...terms],
      resolvedIds: [...result.resolvedIds],
      unresolvedTerms: [...result.unresolvedTerms],
    })
  }

  recordProductSearch(
    input: SearchProductsInput,
    resultProductIds: readonly number[],
  ) {
    this.productSearches.push({
      incompatibleIngredientIds: [...(input.incompatibleIngredientIds ?? [])],
      resultProductIds: [...resultProductIds],
    })
  }

  recordFaqSearch(results: readonly FaqSearchResult[]) {
    this.faqSearches.push({
      sourceIds: results.map((result) => result.sourceId),
    })
  }

  snapshot(): EvalRuntimeTrace {
    return {
      modelCalls: this.modelCallCount,
      toolsCalled: this.requestedToolCalls.map((call) => call.name),
      toolCalls: this.requestedToolCalls.map((call) => ({
        name: call.name,
        arguments: { ...call.arguments },
      })),
      grounding: { ...this.grounding },
      ingredientResolutions: this.ingredientResolutions.map((item) => ({
        terms: [...item.terms],
        resolvedIds: [...item.resolvedIds],
        unresolvedTerms: [...item.unresolvedTerms],
      })),
      productSearches: this.productSearches.map((item) => ({
        incompatibleIngredientIds: [...item.incompatibleIngredientIds],
        resultProductIds: [...item.resultProductIds],
      })),
      faqSearches: this.faqSearches.map((item) => ({
        sourceIds: [...item.sourceIds],
      })),
    }
  }
}

export function createTracedProductSearchIndex(
  index: ProductSearchIndex,
  trace: OfflineEvalTraceCollector,
): ProductSearchIndex {
  return {
    size: index.size,
    products: index.products,
    ingredientIds: index.ingredientIds,
    findById: (id) => index.findById(id),
    resolveIngredientTerms(terms) {
      const result = index.resolveIngredientTerms(terms)
      trace.recordIngredientResolution(terms, result)
      return result
    },
    search(
      input: SearchProductsInput,
      policy: ProductEligibilityPolicy,
      context: AgentToolExecutionContext,
    ) {
      const results = index.search(input, policy, context)
      trace.recordProductSearch(
        input,
        results.map((result) => result.id),
      )
      return results
    },
  }
}

export function createTracedFaqSearchIndex(
  index: FaqSearchIndex,
  trace: OfflineEvalTraceCollector,
): FaqSearchIndex {
  return {
    size: index.size,
    searchFaq(query, limit) {
      const results = index.searchFaq(query, limit)
      trace.recordFaqSearch(results)
      return results
    },
  }
}
