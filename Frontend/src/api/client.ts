import {
  isApiError,
  isHealthResponse,
  isProductListResponse,
  isProductRouteResponse,
  type ApiErrorCode,
  type HealthResponse,
  type ProductCategory,
  type ProductListResponse,
  type ProductRouteResponse,
  type ProductSubcategory,
} from './contracts'

type ApiRequestErrorKind =
  | 'configuration'
  | 'network'
  | 'http'
  | 'invalid-response'

export class ApiRequestError extends Error {
  readonly kind: ApiRequestErrorKind
  readonly status?: number
  readonly code?: ApiErrorCode
  readonly originalCause?: unknown

  constructor(
    kind: ApiRequestErrorKind,
    options: { status?: number; code?: ApiErrorCode; cause?: unknown } = {},
  ) {
    super('Não foi possível consultar a API.')
    this.name = 'ApiRequestError'
    this.kind = kind
    this.status = options.status
    this.code = options.code
    this.originalCause = options.cause
  }
}

function getApiBaseUrl() {
  const configuredUrl = import.meta.env.VITE_API_URL?.trim()

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

async function requestJson(path: string, signal?: AbortSignal) {
  let response: Response

  try {
    response = await fetch(`${getApiBaseUrl()}${path}`, {
      headers: { Accept: 'application/json' },
      signal,
    })
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

    try {
      const body = await response.json()
      code = isApiError(body) ? body.code : undefined
    } catch {
      // A resposta HTTP continua sendo tratada mesmo sem um corpo JSON válido.
    }

    throw new ApiRequestError('http', {
      status: response.status,
      code,
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
  const body = await requestJson('/api/health', signal)

  if (!isHealthResponse(body)) {
    throw new ApiRequestError('invalid-response')
  }

  return body
}

export async function getProductBySlug(
  slug: string,
  signal?: AbortSignal,
): Promise<ProductRouteResponse> {
  const body = await requestJson(
    `/api/products/${encodeURIComponent(slug)}`,
    signal,
  )

  if (!isProductRouteResponse(body)) {
    throw new ApiRequestError('invalid-response')
  }

  return body
}

export async function getProducts(
  query: ProductListQuery,
  signal?: AbortSignal,
): Promise<ProductListResponse> {
  const body = await requestJson(createProductListPath(query), signal)

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
