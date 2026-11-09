import assert from 'node:assert/strict'
import test from 'node:test'

import {
  OPENROUTER_CHAT_COMPLETIONS_ENDPOINT,
  OPENROUTER_DEFAULT_MAX_OUTPUT_TOKENS,
  OPENROUTER_MAX_MESSAGES,
  OPENROUTER_MAX_REQUEST_BYTES,
  OPENROUTER_MAX_TOOL_ARGUMENT_CHARACTERS,
  OPENROUTER_MAX_TOOLS,
  OpenRouterClientError,
  createOpenRouterClient,
  type OpenRouterChatInput,
  type OpenRouterFunctionTool,
  type OpenRouterTransport,
} from '../src/agent/openrouter/openrouter-client.js'

const testApiKey = 'test-openrouter-key'
const testModel = 'test/provider-model'

function createTool(name: string): OpenRouterFunctionTool {
  return {
    type: 'function',
    function: {
      name,
      description: `Ferramenta fictícia ${name}.`,
      parameters: {
        type: 'object',
        properties: {
          value: { type: 'string' },
        },
        required: ['value'],
        additionalProperties: false,
      },
    },
  }
}

function createProviderPayload(
  options: {
    content?: string | null
    toolCalls?: unknown[]
    model?: string
    finishReason?: string | null
  } = {},
) {
  return {
    id: 'generation-123',
    model: options.model ?? testModel,
    created: 1_800_000_000,
    choices: [
      {
        index: 0,
        finish_reason: options.finishReason ?? 'stop',
        message: {
          role: 'assistant',
          content:
            options.content === undefined ? 'Resposta curta.' : options.content,
          ...(options.toolCalls ? { tool_calls: options.toolCalls } : {}),
        },
      },
    ],
    usage: {
      prompt_tokens: 12,
      completion_tokens: 4,
      total_tokens: 16,
    },
    provider_extra_field: 'ignored',
  }
}

function jsonResponse(payload: unknown, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

function createRecordingTransport(response: Response) {
  const calls: Array<{
    input: Parameters<OpenRouterTransport>[0]
    init?: Parameters<OpenRouterTransport>[1]
  }> = []
  const transport: OpenRouterTransport = async (input, init) => {
    calls.push({ input, init })
    return response
  }

  return { calls, transport }
}

function createClient(transport: OpenRouterTransport, options = {}) {
  return createOpenRouterClient({
    apiKey: testApiKey,
    model: testModel,
    transport,
    ...options,
  })
}

async function assertClientError(
  promise: Promise<unknown>,
  code: OpenRouterClientError['code'],
  statusCode?: number,
) {
  await assert.rejects(promise, (error: unknown) => {
    assert.ok(error instanceof OpenRouterClientError)
    assert.equal(error.code, code)
    assert.equal(error.statusCode, statusCode)
    return true
  })
}

const validInput: OpenRouterChatInput = {
  messages: [{ role: 'user', content: 'Olá.' }],
}

test('sends one typed request with backend model, bearer header and token limit', async () => {
  const { calls, transport } = createRecordingTransport(
    jsonResponse(createProviderPayload()),
  )
  const result = await createClient(transport).createChatCompletion(validInput)

  assert.equal(calls.length, 1)
  assert.equal(String(calls[0]?.input), OPENROUTER_CHAT_COMPLETIONS_ENDPOINT)
  assert.equal(calls[0]?.init?.method, 'POST')
  assert.equal(
    new Headers(calls[0]?.init?.headers).get('Authorization'),
    `Bearer ${testApiKey}`,
  )
  assert.equal(
    new Headers(calls[0]?.init?.headers).get('Content-Type'),
    'application/json',
  )

  const body = JSON.parse(String(calls[0]?.init?.body))
  assert.equal(body.model, testModel)
  assert.equal(
    body.max_completion_tokens,
    OPENROUTER_DEFAULT_MAX_OUTPUT_TOKENS,
  )
  assert.equal(body.stream, false)
  assert.equal('apiKey' in body, false)
  assert.equal('authorization' in body, false)
  assert.deepEqual(result, {
    id: 'generation-123',
    model: testModel,
    created: 1_800_000_000,
    message: { role: 'assistant', content: 'Resposta curta.' },
    finishReason: 'stop',
    usage: { inputTokens: 12, outputTokens: 4, totalTokens: 16 },
  })
})

test('model and output limit are configurable without a hardcoded model', async () => {
  const configuredModel = 'google/gemini-3.1-flash-lite'
  const { calls, transport } = createRecordingTransport(
    jsonResponse(createProviderPayload({ model: configuredModel })),
  )
  const client = createOpenRouterClient({
    apiKey: testApiKey,
    model: configuredModel,
    transport,
    maxOutputTokens: 128,
  })

  await client.createChatCompletion({
    messages: [{ role: 'user', content: 'Teste.' }],
    maxOutputTokens: 64,
  })

  const body = JSON.parse(String(calls[0]?.init?.body))
  assert.equal(body.model, configuredModel)
  assert.equal(body.max_completion_tokens, 64)
})

test('preserves multiple untrusted tool calls without parsing arguments', async () => {
  const toolCalls = [
    {
      id: 'call-a',
      type: 'function',
      function: { name: 'first_tool', arguments: 'not-json' },
    },
    {
      id: 'call-b',
      type: 'function',
      function: { name: 'second_tool', arguments: '{"value":"b"}' },
    },
  ]
  const { transport } = createRecordingTransport(
    jsonResponse(
      createProviderPayload({
        content: null,
        finishReason: 'tool_calls',
        toolCalls,
      }),
    ),
  )
  const result = await createClient(transport).createChatCompletion({
    messages: [{ role: 'user', content: 'Use as ferramentas.' }],
    tools: [createTool('first_tool'), createTool('second_tool')],
    toolChoice: 'required',
  })

  assert.deepEqual(result.message.toolCalls, toolCalls)
  assert.equal(result.message.content, null)
})

test('serializes assistant tool calls for future conversation history', async () => {
  const { calls, transport } = createRecordingTransport(
    jsonResponse(createProviderPayload()),
  )
  await createClient(transport).createChatCompletion({
    messages: [
      {
        role: 'assistant',
        content: null,
        toolCalls: [
          {
            id: 'call-history',
            type: 'function',
            function: { name: 'history_tool', arguments: '{}' },
          },
        ],
      },
    ],
  })

  const body = JSON.parse(String(calls[0]?.init?.body))
  assert.deepEqual(body.messages[0], {
    role: 'assistant',
    content: null,
    tool_calls: [
      {
        id: 'call-history',
        type: 'function',
        function: { name: 'history_tool', arguments: '{}' },
      },
    ],
  })
})

test('accepts ordinary text when tool choice is automatic', async () => {
  const { transport } = createRecordingTransport(
    jsonResponse(createProviderPayload({ content: 'Não preciso da função.' })),
  )
  const result = await createClient(transport).createChatCompletion({
    messages: [{ role: 'user', content: 'Responda se souber.' }],
    tools: [createTool('optional_tool')],
    toolChoice: 'auto',
  })

  assert.equal(result.message.content, 'Não preciso da função.')
  assert.equal(result.message.toolCalls, undefined)
})

test('forced tool choices fail when the expected call is absent or inconsistent', async (t) => {
  await t.test('required without any call', async () => {
    const { transport } = createRecordingTransport(
      jsonResponse(createProviderPayload()),
    )
    await assertClientError(
      createClient(transport).createChatCompletion({
        messages: [{ role: 'user', content: 'Use uma função.' }],
        tools: [createTool('health_check')],
        toolChoice: 'required',
      }),
      'OPENROUTER_TOOL_CALLING_INCOMPATIBLE',
    )
  })

  await t.test('named choice returns another configured function', async () => {
    const { transport } = createRecordingTransport(
      jsonResponse(
        createProviderPayload({
          content: null,
          toolCalls: [
            {
              id: 'call-wrong',
              type: 'function',
              function: { name: 'other_tool', arguments: '{}' },
            },
          ],
        }),
      ),
    )
    await assertClientError(
      createClient(transport).createChatCompletion({
        messages: [{ role: 'user', content: 'Valide.' }],
        tools: [createTool('health_check'), createTool('other_tool')],
        toolChoice: {
          type: 'function',
          function: { name: 'health_check' },
        },
      }),
      'OPENROUTER_TOOL_CALLING_INCOMPATIBLE',
    )
  })

  await t.test('tool call returned when tools are disabled', async () => {
    const { transport } = createRecordingTransport(
      jsonResponse(
        createProviderPayload({
          content: null,
          toolCalls: [
            {
              id: 'call-disabled',
              type: 'function',
              function: { name: 'health_check', arguments: '{}' },
            },
          ],
        }),
      ),
    )
    await assertClientError(
      createClient(transport).createChatCompletion({
        messages: [{ role: 'user', content: 'Não use função.' }],
        tools: [createTool('health_check')],
        toolChoice: 'none',
      }),
      'OPENROUTER_TOOL_CALLING_INCOMPATIBLE',
    )
  })
})

test('input validation rejects inconsistent tools and bounded request sizes before transport', async (t) => {
  const { calls, transport } = createRecordingTransport(
    jsonResponse(createProviderPayload()),
  )
  const client = createClient(transport)

  const invalidInputs: OpenRouterChatInput[] = [
    {
      messages: Array.from({ length: OPENROUTER_MAX_MESSAGES + 1 }, () => ({
        role: 'user' as const,
        content: 'mensagem',
      })),
    },
    {
      messages: [{ role: 'user', content: 'muitas ferramentas' }],
      tools: Array.from({ length: OPENROUTER_MAX_TOOLS + 1 }, (_, index) =>
        createTool(`tool_${index}`),
      ),
    },
    {
      messages: [{ role: 'user', content: 'duplicadas' }],
      tools: [createTool('duplicate'), createTool('duplicate')],
    },
    {
      messages: [{ role: 'user', content: 'escolha ausente' }],
      tools: [createTool('available')],
      toolChoice: {
        type: 'function',
        function: { name: 'missing' },
      },
    },
  ]

  for (const [index, input] of invalidInputs.entries()) {
    await t.test(`invalid bounded input ${index + 1}`, async () => {
      await assertClientError(
        client.createChatCompletion(input),
        'OPENROUTER_INVALID_REQUEST',
      )
    })
  }

  await t.test('aggregate serialized payload', async () => {
    const oversizedInput: OpenRouterChatInput = {
      messages: Array.from({ length: 9 }, (_, index) => ({
        role: 'user' as const,
        content: `${index}${'x'.repeat(11_998)}`,
      })),
    }
    assert.ok(
      Buffer.byteLength(JSON.stringify(oversizedInput), 'utf8') >
        OPENROUTER_MAX_REQUEST_BYTES,
    )
    await assertClientError(
      client.createChatCompletion(oversizedInput),
      'OPENROUTER_INVALID_REQUEST',
    )
  })

  assert.equal(calls.length, 0)
})

test('rejects empty, malformed, oversized and structurally invalid success responses', async (t) => {
  const cases: Array<{
    name: string
    response: Response
    code: OpenRouterClientError['code']
  }> = [
    {
      name: 'invalid JSON',
      response: new Response('{', { status: 200 }),
      code: 'OPENROUTER_INVALID_JSON',
    },
    {
      name: 'missing choices',
      response: jsonResponse({ id: 'x', model: testModel, created: 1 }),
      code: 'OPENROUTER_INVALID_RESPONSE',
    },
    {
      name: 'empty assistant response',
      response: jsonResponse(createProviderPayload({ content: '   ' })),
      code: 'OPENROUTER_INVALID_RESPONSE',
    },
    {
      name: 'oversized body',
      response: new Response('x'.repeat(250_001), { status: 200 }),
      code: 'OPENROUTER_INVALID_RESPONSE',
    },
    {
      name: 'oversized tool arguments',
      response: jsonResponse(
        createProviderPayload({
          content: null,
          toolCalls: [
            {
              id: 'call-large',
              type: 'function',
              function: {
                name: 'health_check',
                arguments: 'x'.repeat(
                  OPENROUTER_MAX_TOOL_ARGUMENT_CHARACTERS + 1,
                ),
              },
            },
          ],
        }),
      ),
      code: 'OPENROUTER_INVALID_RESPONSE',
    },
  ]

  for (const item of cases) {
    await t.test(item.name, async () => {
      const { transport } = createRecordingTransport(item.response)
      await assertClientError(
        createClient(transport).createChatCompletion({
          messages: [{ role: 'user', content: 'Teste.' }],
          ...(item.name === 'oversized tool arguments'
            ? {
                tools: [createTool('health_check')],
                toolChoice: 'required' as const,
              }
            : {}),
        }),
        item.code,
      )
    })
  }
})

test('classifies HTTP failures without interpreting provider error bodies', async (t) => {
  const mappings: Array<{
    status: number
    code: OpenRouterClientError['code']
  }> = [
    { status: 400, code: 'OPENROUTER_INVALID_REQUEST' },
    { status: 401, code: 'OPENROUTER_UNAUTHORIZED' },
    { status: 402, code: 'OPENROUTER_PAYMENT_REQUIRED' },
    { status: 403, code: 'OPENROUTER_ACCESS_DENIED' },
    { status: 404, code: 'OPENROUTER_MODEL_NOT_AVAILABLE' },
    { status: 408, code: 'OPENROUTER_UNAVAILABLE' },
    { status: 413, code: 'OPENROUTER_INVALID_REQUEST' },
    { status: 422, code: 'OPENROUTER_INVALID_REQUEST' },
    { status: 429, code: 'OPENROUTER_RATE_LIMITED' },
    { status: 500, code: 'OPENROUTER_UNAVAILABLE' },
    { status: 502, code: 'OPENROUTER_UNAVAILABLE' },
    { status: 503, code: 'OPENROUTER_UNAVAILABLE' },
    { status: 524, code: 'OPENROUTER_UNAVAILABLE' },
    { status: 529, code: 'OPENROUTER_UNAVAILABLE' },
  ]

  for (const mapping of mappings) {
    await t.test(String(mapping.status), async () => {
      let attempts = 0
      const transport: OpenRouterTransport = async () => {
        attempts += 1
        return new Response(
          'C:\\private\\provider-error OPENROUTER_API_KEY=must-not-leak',
          { status: mapping.status },
        )
      }
      const promise = createClient(transport).createChatCompletion(validInput)

      await assertClientError(promise, mapping.code, mapping.status)
      assert.equal(attempts, 1)
    })
  }
})

test('404 with tools remains model availability failure without unsupported-tools guess', async () => {
  const { transport } = createRecordingTransport(
    new Response('provider routing detail', { status: 404 }),
  )
  await assertClientError(
    createClient(transport).createChatCompletion({
      messages: [{ role: 'user', content: 'Use health_check.' }],
      tools: [createTool('health_check')],
      toolChoice: {
        type: 'function',
        function: { name: 'health_check' },
      },
    }),
    'OPENROUTER_MODEL_NOT_AVAILABLE',
    404,
  )
})

test('local timeout aborts one transport attempt and returns a distinct error', async () => {
  let attempts = 0
  const transport: OpenRouterTransport = async (_input, init) => {
    attempts += 1
    return new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener(
        'abort',
        () => reject(new DOMException('aborted', 'AbortError')),
        { once: true },
      )
    })
  }
  const client = createClient(transport, { timeoutMs: 10 })

  await assertClientError(
    client.createChatCompletion(validInput),
    'OPENROUTER_TIMEOUT',
  )
  assert.equal(attempts, 1)
})

test('caller cancellation is distinct and an already aborted signal prevents transport', async (t) => {
  await t.test('cancellation during request', async () => {
    let attempts = 0
    const transport: OpenRouterTransport = async (_input, init) => {
      attempts += 1
      return new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener(
          'abort',
          () => reject(new DOMException('aborted', 'AbortError')),
          { once: true },
        )
      })
    }
    const controller = new AbortController()
    const promise = createClient(transport).createChatCompletion({
      ...validInput,
      signal: controller.signal,
    })
    controller.abort()

    await assertClientError(promise, 'OPENROUTER_CANCELLED')
    assert.equal(attempts, 1)
  })

  await t.test('signal already aborted', async () => {
    let attempts = 0
    const transport: OpenRouterTransport = async () => {
      attempts += 1
      return jsonResponse(createProviderPayload())
    }
    const controller = new AbortController()
    controller.abort()

    await assertClientError(
      createClient(transport).createChatCompletion({
        ...validInput,
        signal: controller.signal,
      }),
      'OPENROUTER_CANCELLED',
    )
    assert.equal(attempts, 0)
  })
})

test('network failure is sanitized and never retried', async () => {
  let attempts = 0
  const secret = 'must-not-leak-network-secret'
  const transport: OpenRouterTransport = async () => {
    attempts += 1
    throw new Error(`C:\\private\\network ${secret}`)
  }
  const promise = createClient(transport).createChatCompletion(validInput)

  await assert.rejects(promise, (error: unknown) => {
    assert.ok(error instanceof OpenRouterClientError)
    assert.equal(error.code, 'OPENROUTER_NETWORK_ERROR')
    assert.doesNotMatch(String(error), new RegExp(secret))
    assert.doesNotMatch(JSON.stringify(error), /private|secret/i)
    return true
  })
  assert.equal(attempts, 1)
})

test('missing or invalid configuration fails before transport without leaking the key', () => {
  const secret = 'configuration-secret-must-not-leak'
  let attempts = 0
  const transport: OpenRouterTransport = async () => {
    attempts += 1
    return jsonResponse(createProviderPayload())
  }

  for (const options of [
    { apiKey: undefined, model: undefined },
    { apiKey: secret, model: undefined },
    { apiKey: secret, model: 'invalid model value' },
  ]) {
    assert.throws(
      () => createOpenRouterClient({ ...options, transport }),
      (error: unknown) => {
        assert.ok(error instanceof OpenRouterClientError)
        assert.equal(error.code, 'OPENROUTER_CONFIGURATION_ERROR')
        assert.doesNotMatch(String(error), new RegExp(secret))
        assert.doesNotMatch(JSON.stringify(error), new RegExp(secret))
        return true
      },
    )
  }

  assert.equal(attempts, 0)
})
