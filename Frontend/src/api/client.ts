import {
  isApiError,
  isHealthResponse,
  isProductDetailResponse,
  isProductListResponse,
  type ApiErrorCode,
  type HealthResponse,
  type ProductCategory,
  type ProductDetailResponse,
  type ProductListResponse,
  type ProductSubcategory,
} from './contracts'
import {
  isChatResponse,
  parseChatRequest,
  type ChatResponse,
} from './chat-contracts'

export type ApiRequestErrorKind =
  | 'invalid-request'
  | 'configuration'
  | 'network'
  | 'http'
  | 'invalid-response'

export class ApiRequestError extends Error {
  readonly kind: ApiRequestErrorKind
  readonly status?: number
  readonly code?: ApiErrorCode
  readonly requestId?: string
  readonly retryAfterSeconds?: number
  readonly originalCause?: unknown

  constructor(
    kind: ApiRequestErrorKind,
    options: {
      status?: number
      code?: ApiErrorCode
      requestId?: string
      retryAfterSeconds?: number
      cause?: unknown
    } = {},
  ) {
    super('Não foi possível consultar a API.')
    this.name = 'ApiRequestError'
    this.kind = kind
    this.status = options.status
    this.code = options.code
    this.requestId = options.requestId
    this.retryAfterSeconds = options.retryAfterSeconds
    this.originalCause = options.cause
  }
}

function getApiBaseUrl(override?: string) {
  const configuredUrl = (override ?? import.meta.env.VITE_API_URL)?.trim()

  if (!configuredUrl) {
    throw new ApiRequestError('configuration')
  }

  try {
    const url = new URL(configuredUrl)
    const hasValidProtocol = url.protocol === 'http:' || url.protocol === 'https:'
    const isOriginOnly =
      !url.username &&
      !url.password &&
      url.pathname === '/' &&
      !url.search &&
      !url.hash

    if (!hasValidProtocol || !isOriginOnly) {
      throw new ApiRequestError('configuration')
    }

    return url.origin
  } catch (error) {
    if (error instanceof ApiRequestError) {
      throw error
    }

    throw new ApiRequestError('configuration', { cause: error })
  }
}

async function readJson(response: Response): Promise<unknown> {
  try {
    return await response.json()
  } catch (error) {
    throw new ApiRequestError('invalid-response', { cause: error })
  }
}

export type ApiTransport = (
  input: RequestInfo | URL,
  init?: RequestInit,
) => Promise<Response>

export interface ApiRuntime {
  apiUrl?: string
  transport?: ApiTransport
  now?: () => number
}

interface RequestJsonOptions {
  signal?: AbortSignal
  method?: 'GET' | 'POST'
  body?: unknown
  runtime?: ApiRuntime
}

function readRetryAfter(
  value: string | null,
  now: () => number,
): number | undefined {
  if (!value) return undefined
  const seconds = Number(value)
  if (Number.isSafeInteger(seconds) && seconds > 0) return seconds

  const deadline = Date.parse(value)
  if (!Number.isFinite(deadline) || deadline <= now()) return undefined
  return Math.max(1, Math.ceil((deadline - now()) / 1_000))
}

async function requestJson(
  path: string,
  options: RequestJsonOptions = {},
) {
  let response: Response
  const runtime = options.runtime ?? {}
  const signal = options.signal

  try {
    response = await (runtime.transport ?? fetch)(
      `${getApiBaseUrl(runtime.apiUrl)}${path}`,
      {
        method: options.method ?? 'GET',
        headers: {
          Accept: 'application/json',
          ...(options.body === undefined
            ? {}
            : { 'Content-Type': 'application/json' }),
        },
        ...(options.body === undefined
          ? {}
          : { body: JSON.stringify(options.body) }),
        signal,
      },
    )
  } catch (error) {
    if (signal?.aborted) {
      throw error
    }

    if (error instanceof ApiRequestError) {
      throw error
    }

    throw new ApiRequestError('network', { cause: error })
  }

  if (!response.ok) {
    let code: ApiErrorCode | undefined
    let requestId: string | undefined

    try {
      const body = await response.json()
      if (isApiError(body)) {
        code = body.code
        requestId = body.requestId
      }
    } catch {
      // A resposta HTTP continua sendo tratada mesmo sem um corpo JSON válido.
    }

    throw new ApiRequestError('http', {
      status: response.status,
      code,
      requestId,
      retryAfterSeconds:
        response.status === 429
          ? readRetryAfter(
              response.headers.get('Retry-After'),
              runtime.now ?? Date.now,
            )
          : undefined,
    })
  }

  return readJson(response)
}

function resolveApiResourceUrl(path: string) {
  const apiOrigin = getApiBaseUrl()

  try {
    const url = new URL(path, `${apiOrigin}/`)
    const isCatalogImage = url.pathname.startsWith('/api/catalog/images/')

    if (
      url.origin !== apiOrigin ||
      !isCatalogImage ||
      url.username ||
      url.password ||
      url.search ||
      url.hash
    ) {
      throw new ApiRequestError('invalid-response')
    }

    return url.toString()
  } catch (error) {
    if (error instanceof ApiRequestError) {
      throw error
    }

    throw new ApiRequestError('invalid-response', { cause: error })
  }
}

export interface ProductListQuery {
  q?: string
  category?: ProductCategory
  subcategory?: ProductSubcategory
  minPrice?: number
  maxPrice?: number
  page?: number
  pageSize?: number
}

function createProductListPath(query: ProductListQuery) {
  const params = new URLSearchParams()

  if (query.q) params.set('q', query.q)
  if (query.category) params.set('category', query.category)
  if (query.subcategory) params.set('subcategory', query.subcategory)
  if (query.minPrice !== undefined) {
    params.set('minPrice', String(query.minPrice))
  }
  if (query.maxPrice !== undefined) {
    params.set('maxPrice', String(query.maxPrice))
  }
  if (query.page !== undefined) params.set('page', String(query.page))
  if (query.pageSize !== undefined) {
    params.set('pageSize', String(query.pageSize))
  }

  const search = params.toString()
  return search ? `/api/products?${search}` : '/api/products'
}

export async function getHealth(signal?: AbortSignal): Promise<HealthResponse> {
  const body = await requestJson('/api/health', { signal })

  if (!isHealthResponse(body)) {
    throw new ApiRequestError('invalid-response')
  }

  return body
}

export async function getProductBySlug(
  slug: string,
  signal?: AbortSignal,
): Promise<ProductDetailResponse> {
  const body = await requestJson(
    `/api/products/${encodeURIComponent(slug)}`,
    { signal },
  )

  if (!isProductDetailResponse(body)) {
    throw new ApiRequestError('invalid-response')
  }

  return {
    ...body,
    media: {
      primaryUrl: resolveApiResourceUrl(body.media.primaryUrl),
      galleryUrls: body.media.galleryUrls.map(resolveApiResourceUrl),
    },
  }
}

export async function getProducts(
  query: ProductListQuery,
  signal?: AbortSignal,
): Promise<ProductListResponse> {
  const body = await requestJson(createProductListPath(query), { signal })

  if (!isProductListResponse(body)) {
    throw new ApiRequestError('invalid-response')
  }

  return {
    ...body,
    items: body.items.map((product) => ({
      ...product,
      imageUrl: resolveApiResourceUrl(product.imageUrl),
    })),
  }
}

export async function sendChat(
  request: unknown,
  signal?: AbortSignal,
  runtime?: ApiRuntime,
): Promise<ChatResponse> {
  const parsed = parseChatRequest(request)
  if (!parsed) throw new ApiRequestError('invalid-request')

  const body = await requestJson('/api/chat', {
    method: 'POST',
    body: parsed,
    signal,
    runtime,
  })
  if (!isChatResponse(body)) {
    throw new ApiRequestError('invalid-response')
  }
  return body
}
