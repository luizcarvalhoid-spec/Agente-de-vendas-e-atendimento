import { z } from 'zod'

import type { AgentFunctionDefinition } from '../agent-model-port.js'

const TOOL_NAME_PATTERN = /^[A-Za-z0-9_-]+$/

export interface AgentToolExecutionContext {
  readonly signal: AbortSignal
  getState<T>(key: symbol, initialize: () => T): T
}

export interface AgentTool {
  readonly name: string
  readonly description: string
  readonly inputSchema: z.ZodType
  readonly outputSchema: z.ZodType
  isRecommendationProductEligible?(
    productId: number,
    context: AgentToolExecutionContext,
  ): boolean
  execute(
    input: unknown,
    context: AgentToolExecutionContext,
  ): Promise<unknown>
}

export function createAgentToolExecutionContext(
  signal: AbortSignal,
): AgentToolExecutionContext {
  const state = new Map<symbol, unknown>()

  return {
    signal,
    getState<T>(key: symbol, initialize: () => T) {
      if (!state.has(key)) state.set(key, initialize())
      return state.get(key) as T
    },
  }
}

export interface AgentToolRegistry {
  readonly size: number
  readonly definitions: readonly AgentFunctionDefinition[]
  get(name: string): AgentTool | undefined
}

function createFunctionDefinition(tool: AgentTool): AgentFunctionDefinition {
  const parameters = z.toJSONSchema(tool.inputSchema, {
    io: 'input',
    unrepresentable: 'throw',
  })

  if (
    typeof parameters !== 'object' ||
    parameters === null ||
    Array.isArray(parameters) ||
    parameters.type !== 'object'
  ) {
    throw new TypeError('O schema de entrada da ferramenta deve ser um objeto.')
  }

  return {
    type: 'function',
    function: {
      name: tool.name,
      description: tool.description,
      parameters: parameters as Record<string, unknown>,
    },
  }
}

export function createAgentToolRegistry(
  tools: readonly AgentTool[],
): AgentToolRegistry {
  if (tools.length > 16) {
    throw new TypeError('O registro excede o limite de ferramentas.')
  }

  const toolsByName = new Map<string, AgentTool>()
  const definitions: AgentFunctionDefinition[] = []

  for (const tool of tools) {
    if (
      !TOOL_NAME_PATTERN.test(tool.name) ||
      tool.name.length > 64 ||
      tool.description.trim() === '' ||
      tool.description.length > 1_000 ||
      toolsByName.has(tool.name)
    ) {
      throw new TypeError('Registro de ferramentas inválido.')
    }

    toolsByName.set(tool.name, tool)
    definitions.push(createFunctionDefinition(tool))
  }

  return {
    size: toolsByName.size,
    definitions,
    get(name) {
      return toolsByName.get(name)
    },
  }
}
