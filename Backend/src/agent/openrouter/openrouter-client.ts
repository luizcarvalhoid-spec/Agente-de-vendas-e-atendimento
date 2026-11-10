import { Buffer } from 'node:buffer'

import { z } from 'zod'

export const OPENROUTER_CHAT_COMPLETIONS_ENDPOINT =
  'https://openrouter.ai/api/v1/chat/completions'
export const OPENROUTER_DEFAULT_TIMEOUT_MS = 15_000
export const OPENROUTER_MAX_TIMEOUT_MS = 60_000
export const OPENROUTER_DEFAULT_MAX_OUTPUT_TOKENS = 512
export const OPENROUTER_MAX_OUTPUT_TOKENS = 4_096
export const OPENROUTER_MAX_MESSAGES = 40
export const OPENROUTER_MAX_MESSAGE_CHARACTERS = 12_000
export const OPENROUTER_MAX_REQUEST_BYTES = 100_000
export const OPENROUTER_MAX_TOOLS = 16
export const OPENROUTER_MAX_TOOL_DESCRIPTION_CHARACTERS = 1_000
export const OPENROUTER_MAX_TOOL_ARGUMENT_CHARACTERS = 20_000
export const OPENROUTER_MAX_RESPONSE_BYTES = 250_000

const OPENROUTER_MAX_TOOL_CALLS = 16
const OPENROUTER_MAX_TOOL_NAME_CHARACTERS = 64
const OPENROUTER_MAX_IDENTIFIER_CHARACTERS = 256
const OPENROUTER_MAX_RESPONSE_CONTENT_CHARACTERS = 100_000

const toolNameSchema = z
  .string()
  .trim()
  .min(1)
  .max(OPENROUTER_MAX_TOOL_NAME_CHARACTERS)
  .regex(/^[A-Za-z0-9_-]+$/)

const jsonValueSchema: z.ZodType<unknown> = z.lazy(() =>
  z.union([
    z.string(),
    z.number().finite(),
    z.boolean(),
    z.null(),
    z.array(jsonValueSchema),
    z.record(z.string(), jsonValueSchema),
  ]),
)

const jsonObjectSchema = z.record(z.string(), jsonValueSchema)

export const openRouterToolCallSchema = z
  .object({
    id: z.string().min(1).max(OPENROUTER_MAX_IDENTIFIER_CHARACTERS),
    type: z.literal('function'),
    function: z
      .object({
        name: toolNameSchema,
        arguments: z
          .string()
          .max(OPENROUTER_MAX_TOOL_ARGUMENT_CHARACTERS),
      })
      .strict(),
  })
  .strict()

export const openRouterFunctionToolSchema = z
  .object({
    type: z.literal('function'),
    function: z
      .object({
        name: toolNameSchema,
        description: z
          .string()
          .trim()
          .min(1)
          .max(OPENROUTER_MAX_TOOL_DESCRIPTION_CHARACTERS)
          .optional(),
        parameters: jsonObjectSchema,
      })
      .strict(),
  })
  .strict()

const namedToolChoiceSchema = z
  .object({
    type: z.literal('function'),
    function: z.object({ name: toolNameSchema }).strict(),
  })
  .strict()

export const openRouterToolChoiceSchema = z.union([
  z.enum(['auto', 'none', 'required']),
  namedToolChoiceSchema,
])

const textMessageSchema = z
  .object({
    role: z.enum(['system', 'user']),
    content: z
      .string()
      .trim()
      .min(1)
      .max(OPENROUTER_MAX_MESSAGE_CHARACTERS),
  })
  .strict()

const assistantMessageSchema = z
  .object({
    role: z.literal('assistant'),
    content: z
      .string()
      .max(OPENROUTER_MAX_MESSAGE_CHARACTERS)
      .nullable(),
    toolCalls: z
      .array(openRouterToolCallSchema)
      .min(1)
      .max(OPENROUTER_MAX_TOOL_CALLS)
      .optional(),
  })
  .strict()
  .refine(
    (message) =>
      Boolean(message.content?.trim()) || Boolean(message.toolCalls?.length),
    'A mensagem assistant precisa de conteúdo ou chamadas de ferramenta.',
  )

const toolMessageSchema = z
  .object({
    role: z.literal('tool'),
    toolCallId: z
      .string()
      .trim()
      .min(1)
      .max(OPENROUTER_MAX_IDENTIFIER_CHARACTERS),
    content: z
      .string()
      .trim()
      .min(1)
      .max(OPENROUTER_MAX_MESSAGE_CHARACTERS),
  })
  .strict()

export const openRouterMessageSchema = z.union([
  textMessageSchema,
  assistantMessageSchema,
  toolMessageSchema,
])

export const openRouterChatInputSchema = z
  .object({
    messages: z
      .array(openRouterMessageSchema)
      .min(1)
      .max(OPENROUTER_MAX_MESSAGES),
    tools: z
      .array(openRouterFunctionToolSchema)
      .min(1)
      .max(OPENROUTER_MAX_TOOLS)
      .optional(),
    toolChoice: openRouterToolChoiceSchema.optional(),
    maxOutputTokens: z
      .number()
      .int()
      .min(1)
      .max(OPENROUTER_MAX_OUTPUT_TOKENS)
      .optional(),
    signal: z.custom<AbortSignal>(
      (value) => value instanceof AbortSignal,
    ).optional(),
  })
  .strict()
  .superRefine((input, context) => {
    if (input.toolChoice !== undefined && input.tools === undefined) {
      context.addIssue({
        code: 'custom',
        path: ['toolChoice'],
        message: 'toolChoice exige ao menos uma ferramenta.',
      })
    }

    if (!input.tools) return

    const names = input.tools.map((tool) => tool.function.name)
    if (new Set(names).size !== names.length) {
      context.addIssue({
        code: 'custom',
        path: ['tools'],
        message: 'Os nomes das ferramentas devem ser únicos.',
      })
    }

    if (
      typeof input.toolChoice === 'object' &&
      !names.includes(input.toolChoice.function.name)
    ) {
      context.addIssue({
        code: 'custom',
        path: ['toolChoice', 'function', 'name'],
        message: 'A ferramenta escolhida precisa existir em tools.',
      })
    }
  })

export type OpenRouterToolCall = z.infer<typeof openRouterToolCallSchema>
export type OpenRouterFunctionTool = z.infer<
  typeof openRouterFunctionToolSchema
>
export type OpenRouterToolChoice = z.infer<
  typeof openRouterToolChoiceSchema
>
export type OpenRouterMessage = z.infer<typeof openRouterMessageSchema>
export type OpenRouterChatInput = z.infer<
  typeof openRouterChatInputSchema
>

export interface OpenRouterChatResult {
  readonly id: string
  readonly model: string
  readonly created: number
  readonly message: {
    readonly role: 'assistant'
    readonly content: string | null
    readonly toolCalls?: readonly OpenRouterToolCall[]
  }
  readonly finishReason: string | null
  readonly usage?: {
    readonly inputTokens: number
    readonly outputTokens: number
    readonly totalTokens: number
  }
}

export type OpenRouterErrorCode =
  | 'OPENROUTER_CONFIGURATION_ERROR'
  | 'OPENROUTER_INVALID_REQUEST'
  | 'OPENROUTER_UNAUTHORIZED'
  | 'OPENROUTER_PAYMENT_REQUIRED'
  | 'OPENROUTER_ACCESS_DENIED'
  | 'OPENROUTER_MODEL_NOT_AVAILABLE'
  | 'OPENROUTER_TOOL_CALLING_INCOMPATIBLE'
  | 'OPENROUTER_RATE_LIMITED'
  | 'OPENROUTER_UNAVAILABLE'
  | 'OPENROUTER_TIMEOUT'
  | 'OPENROUTER_CANCELLED'
  | 'OPENROUTER_NETWORK_ERROR'
  | 'OPENROUTER_INVALID_JSON'
  | 'OPENROUTER_INVALID_RESPONSE'

const errorMessages: Record<OpenRouterErrorCode, string> = {
  OPENROUTER_CONFIGURATION_ERROR:
    'A integração OpenRouter não está configurada corretamente.',
  OPENROUTER_INVALID_REQUEST:
    'A solicitação ao provedor é inválida.',
  OPENROUTER_UNAUTHORIZED:
    'As credenciais do provedor foram rejeitadas.',
  OPENROUTER_PAYMENT_REQUIRED:
    'Não há créditos disponíveis para consultar o provedor.',
  OPENROUTER_ACCESS_DENIED:
    'O provedor recusou acesso à operação solicitada.',
  OPENROUTER_MODEL_NOT_AVAILABLE:
    'O modelo configurado não está disponível ou não pôde ser roteado.',
  OPENROUTER_TOOL_CALLING_INCOMPATIBLE:
    'O modelo não produziu chamadas de ferramenta compatíveis com a solicitação.',
  OPENROUTER_RATE_LIMITED:
    'O limite de requisições do provedor foi atingido.',
  OPENROUTER_UNAVAILABLE:
    'O provedor está temporariamente indisponível.',
  OPENROUTER_TIMEOUT:
    'A consulta ao provedor excedeu o tempo limite.',
  OPENROUTER_CANCELLED:
    'A consulta ao provedor foi cancelada.',
  OPENROUTER_NETWORK_ERROR:
    'Não foi possível conectar ao provedor.',
  OPENROUTER_INVALID_JSON:
    'O provedor retornou uma resposta ilegível.',
  OPENROUTER_INVALID_RESPONSE:
    'O provedor retornou uma resposta incompatível.',
}

export class OpenRouterClientError extends Error {
  readonly code: OpenRouterErrorCode
  readonly statusCode?: number
  readonly transportStarted: boolean

  constructor(
    code: OpenRouterErrorCode,
    statusCode?: number,
    transportStarted = statusCode !== undefined,
  ) {
    super(errorMessages[code])
    this.name = 'OpenRouterClientError'
    this.code = code
    this.statusCode = statusCode
    this.transportStarted = transportStarted
  }
}

export type OpenRouterTransport = typeof fetch

export interface CreateOpenRouterClientOptions {
  readonly apiKey?: string
  readonly model?: string
  readonly transport?: OpenRouterTransport
  readonly timeoutMs?: number
  readonly maxOutputTokens?: number
}

export interface OpenRouterClient {
  createChatCompletion(
    input: OpenRouterChatInput,
  ): Promise<OpenRouterChatResult>
}

const clientOptionsSchema = z
  .object({
    apiKey: z.string().trim().min(1).max(4_096),
    model: z
      .string()
      .trim()
      .min(1)
      .max(200)
      .regex(/^[^\s/]+\/[^\s]+$/),
    transport: z
      .custom<OpenRouterTransport>((value) => typeof value === 'function')
      .optional(),
    timeoutMs: z
      .number()
      .int()
      .min(1)
      .max(OPENROUTER_MAX_TIMEOUT_MS)
      .default(OPENROUTER_DEFAULT_TIMEOUT_MS),
    maxOutputTokens: z
      .number()
      .int()
      .min(1)
      .max(OPENROUTER_MAX_OUTPUT_TOKENS)
      .default(OPENROUTER_DEFAULT_MAX_OUTPUT_TOKENS),
  })
  .strict()

const providerToolCallSchema = z
  .object({
    id: z.string().min(1).max(OPENROUTER_MAX_IDENTIFIER_CHARACTERS),
    type: z.literal('function'),
    function: z
      .object({
        name: toolNameSchema,
        arguments: z
          .string()
          .max(OPENROUTER_MAX_TOOL_ARGUMENT_CHARACTERS),
      })
      .passthrough(),
  })
  .passthrough()

const providerResponseSchema = z
  .object({
    id: z.string().min(1).max(OPENROUTER_MAX_IDENTIFIER_CHARACTERS),
    model: z.string().min(1).max(200),
    created: z.number().int().nonnegative(),
    choices: z
      .array(
        z
          .object({
            index: z.number().int().nonnegative(),
            finish_reason: z.string().max(100).nullable(),
            message: z
              .object({
                role: z.literal('assistant'),
                content: z
                  .string()
                  .max(OPENROUTER_MAX_RESPONSE_CONTENT_CHARACTERS)
                  .nullable(),
                tool_calls: z
                  .array(providerToolCallSchema)
                  .max(OPENROUTER_MAX_TOOL_CALLS)
                  .optional(),
              })
              .passthrough(),
          })
          .passthrough(),
      )
      .min(1)
      .max(10),
    usage: z
      .object({
        prompt_tokens: z.number().int().nonnegative(),
        completion_tokens: z.number().int().nonnegative(),
        total_tokens: z.number().int().nonnegative(),
      })
      .passthrough()
      .optional(),
  })
  .passthrough()

function clientError(
  code: OpenRouterErrorCode,
  statusCode?: number,
  transportStarted = statusCode !== undefined,
) {
  return new OpenRouterClientError(code, statusCode, transportStarted)
}

function classifyHttpError(statusCode: number) {
  if (statusCode === 401) {
    return clientError('OPENROUTER_UNAUTHORIZED', statusCode)
  }
  if (statusCode === 402) {
    return clientError('OPENROUTER_PAYMENT_REQUIRED', statusCode)
  }
  if (statusCode === 403) {
    return clientError('OPENROUTER_ACCESS_DENIED', statusCode)
  }
  if (statusCode === 404) {
    return clientError('OPENROUTER_MODEL_NOT_AVAILABLE', statusCode)
  }
  if (statusCode === 429) {
    return clientError('OPENROUTER_RATE_LIMITED', statusCode)
  }
  if ([400, 413, 422].includes(statusCode)) {
    return clientError('OPENROUTER_INVALID_REQUEST', statusCode)
  }
  if (statusCode === 408 || statusCode >= 500) {
    return clientError('OPENROUTER_UNAVAILABLE', statusCode)
  }

  return statusCode >= 400 && statusCode < 500
    ? clientError('OPENROUTER_INVALID_REQUEST', statusCode)
    : clientError('OPENROUTER_UNAVAILABLE', statusCode)
}

function toProviderMessages(messages: readonly OpenRouterMessage[]) {
  return messages.map((message) => {
    if (message.role === 'tool') {
      return {
        role: message.role,
        tool_call_id: message.toolCallId,
        content: message.content,
      }
    }

    if (message.role !== 'assistant') return message

    return {
      role: message.role,
      content: message.content,
      ...(message.toolCalls
        ? {
            tool_calls: message.toolCalls.map((toolCall) => ({
              id: toolCall.id,
              type: toolCall.type,
              function: toolCall.function,
            })),
          }
        : {}),
    }
  })
}

function toProviderToolChoice(toolChoice: OpenRouterToolChoice) {
  if (typeof toolChoice === 'string') return toolChoice

  return {
    type: toolChoice.type,
    function: { name: toolChoice.function.name },
  }
}

function validateToolResponse(
  input: OpenRouterChatInput,
  toolCalls: readonly OpenRouterToolCall[],
) {
  const configuredNames = new Set(
    input.tools?.map((tool) => tool.function.name) ?? [],
  )

  if (toolCalls.length > 0 && configuredNames.size === 0) {
    throw clientError('OPENROUTER_TOOL_CALLING_INCOMPATIBLE', undefined, true)
  }

  if (
    toolCalls.some((toolCall) => !configuredNames.has(toolCall.function.name))
  ) {
    throw clientError('OPENROUTER_TOOL_CALLING_INCOMPATIBLE', undefined, true)
  }

  const toolCallIds = toolCalls.map((toolCall) => toolCall.id)
  if (new Set(toolCallIds).size !== toolCallIds.length) {
    throw clientError('OPENROUTER_INVALID_RESPONSE', undefined, true)
  }

  if (input.toolChoice === 'none' && toolCalls.length > 0) {
    throw clientError('OPENROUTER_TOOL_CALLING_INCOMPATIBLE', undefined, true)
  }

  if (input.toolChoice === 'required' && toolCalls.length === 0) {
    throw clientError('OPENROUTER_TOOL_CALLING_INCOMPATIBLE', undefined, true)
  }

  if (typeof input.toolChoice === 'object') {
    const expectedName = input.toolChoice.function.name
    if (
      toolCalls.length === 0 ||
      toolCalls.some((toolCall) => toolCall.function.name !== expectedName)
    ) {
      throw clientError('OPENROUTER_TOOL_CALLING_INCOMPATIBLE', undefined, true)
    }
  }
}

function parseProviderResponse(
  rawResponse: unknown,
  input: OpenRouterChatInput,
): OpenRouterChatResult {
  const parsed = providerResponseSchema.safeParse(rawResponse)
  if (!parsed.success) {
    throw clientError('OPENROUTER_INVALID_RESPONSE', undefined, true)
  }

  const choice = parsed.data.choices.find((candidate) => candidate.index === 0)
  if (!choice) {
    throw clientError('OPENROUTER_INVALID_RESPONSE', undefined, true)
  }

  const toolCalls: OpenRouterToolCall[] = (choice.message.tool_calls ?? []).map(
    (toolCall) => ({
      id: toolCall.id,
      type: toolCall.type,
      function: {
        name: toolCall.function.name,
        arguments: toolCall.function.arguments,
      },
    }),
  )
  const hasText = Boolean(choice.message.content?.trim())
  if (!hasText && toolCalls.length === 0) {
    throw clientError('OPENROUTER_INVALID_RESPONSE', undefined, true)
  }

  validateToolResponse(input, toolCalls)

  return {
    id: parsed.data.id,
    model: parsed.data.model,
    created: parsed.data.created,
    message: {
      role: 'assistant',
      content: choice.message.content,
      ...(toolCalls.length > 0 ? { toolCalls } : {}),
    },
    finishReason: choice.finish_reason,
    ...(parsed.data.usage
      ? {
          usage: {
            inputTokens: parsed.data.usage.prompt_tokens,
            outputTokens: parsed.data.usage.completion_tokens,
            totalTokens: parsed.data.usage.total_tokens,
          },
        }
      : {}),
  }
}

async function discardErrorBody(response: Response) {
  try {
    await response.body?.cancel()
  } catch {
    // O corpo do erro nunca é necessário nem exposto.
  }
}

async function readStreamChunk(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  signal: AbortSignal,
) {
  if (signal.aborted) throw new DOMException('Aborted', 'AbortError')

  let abortFromSignal: (() => void) | undefined
  const aborted = new Promise<never>((_resolve, reject) => {
    abortFromSignal = () =>
      reject(new DOMException('Aborted', 'AbortError'))
    signal.addEventListener('abort', abortFromSignal, { once: true })
  })

  try {
    return await Promise.race([reader.read(), aborted])
  } finally {
    if (abortFromSignal) {
      signal.removeEventListener('abort', abortFromSignal)
    }
  }
}

async function readResponseBodyWithinLimit(
  response: Response,
  signal: AbortSignal,
) {
  if (!response.body) return ''

  const reader = response.body.getReader()
  const decoder = new TextDecoder('utf-8')
  let bytesRead = 0
  let responseText = ''
  let completed = false

  try {
    while (true) {
      const chunk = await readStreamChunk(reader, signal)
      if (chunk.done) {
        completed = true
        responseText += decoder.decode()
        return responseText
      }

      bytesRead += chunk.value.byteLength
      if (bytesRead > OPENROUTER_MAX_RESPONSE_BYTES) {
        throw clientError('OPENROUTER_INVALID_RESPONSE', undefined, true)
      }

      responseText += decoder.decode(chunk.value, { stream: true })
    }
  } finally {
    if (!completed) {
      try {
        await reader.cancel()
      } catch {
        // Cancelamento e detalhes do stream nunca são expostos.
      }
    }
    reader.releaseLock()
  }
}

export function createOpenRouterClient(
  options: CreateOpenRouterClientOptions,
): OpenRouterClient {
  const parsedOptions = clientOptionsSchema.safeParse(options)
  if (!parsedOptions.success) {
    throw clientError('OPENROUTER_CONFIGURATION_ERROR')
  }

  const {
    apiKey,
    model,
    timeoutMs,
    maxOutputTokens: defaultMaxOutputTokens,
  } = parsedOptions.data
  const transport = parsedOptions.data.transport ?? globalThis.fetch

  return {
    async createChatCompletion(input) {
      const parsedInput = openRouterChatInputSchema.safeParse(input)
      if (!parsedInput.success) {
        throw clientError('OPENROUTER_INVALID_REQUEST')
      }

      const validatedInput = parsedInput.data
      if (validatedInput.signal?.aborted) {
        throw clientError('OPENROUTER_CANCELLED')
      }

      const requestBody = {
        model,
        messages: toProviderMessages(validatedInput.messages),
        max_completion_tokens:
          validatedInput.maxOutputTokens ?? defaultMaxOutputTokens,
        stream: false,
        ...(validatedInput.tools ? { tools: validatedInput.tools } : {}),
        ...(validatedInput.toolChoice
          ? {
              tool_choice: toProviderToolChoice(
                validatedInput.toolChoice,
              ),
            }
          : {}),
      }

      let serializedBody: string
      try {
        serializedBody = JSON.stringify(requestBody)
      } catch {
        throw clientError('OPENROUTER_INVALID_REQUEST')
      }

      if (
        Buffer.byteLength(serializedBody, 'utf8') >
        OPENROUTER_MAX_REQUEST_BYTES
      ) {
        throw clientError('OPENROUTER_INVALID_REQUEST')
      }

      const requestController = new AbortController()
      let timedOut = false
      let cancelled = false
      let transportStarted = false
      const abortFromCaller = () => {
        if (requestController.signal.aborted) return
        cancelled = true
        requestController.abort()
      }
      validatedInput.signal?.addEventListener('abort', abortFromCaller, {
        once: true,
      })
      const timeout = setTimeout(() => {
        if (requestController.signal.aborted) return
        timedOut = true
        requestController.abort()
      }, timeoutMs)

      try {
        transportStarted = true
        const response = await transport(
          OPENROUTER_CHAT_COMPLETIONS_ENDPOINT,
          {
            method: 'POST',
            headers: {
              Authorization: `Bearer ${apiKey}`,
              'Content-Type': 'application/json',
            },
            body: serializedBody,
            signal: requestController.signal,
          },
        )

        if (requestController.signal.aborted) {
          throw clientError(
            timedOut ? 'OPENROUTER_TIMEOUT' : 'OPENROUTER_CANCELLED',
            undefined,
            transportStarted,
          )
        }

        if (!response.ok) {
          await discardErrorBody(response)
          throw classifyHttpError(response.status)
        }

        const responseText = await readResponseBodyWithinLimit(
          response,
          requestController.signal,
        )

        let rawResponse: unknown
        try {
          rawResponse = JSON.parse(responseText)
        } catch {
          throw clientError('OPENROUTER_INVALID_JSON', undefined, true)
        }

        return parseProviderResponse(rawResponse, validatedInput)
      } catch (error) {
        if (error instanceof OpenRouterClientError) throw error
        if (timedOut) {
          throw clientError(
            'OPENROUTER_TIMEOUT',
            undefined,
            transportStarted,
          )
        }
        if (cancelled || validatedInput.signal?.aborted) {
          throw clientError(
            'OPENROUTER_CANCELLED',
            undefined,
            transportStarted,
          )
        }
        throw clientError(
          'OPENROUTER_NETWORK_ERROR',
          undefined,
          transportStarted,
        )
      } finally {
        clearTimeout(timeout)
        validatedInput.signal?.removeEventListener(
          'abort',
          abortFromCaller,
        )
      }
    },
  }
}
