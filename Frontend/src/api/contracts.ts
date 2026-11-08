export type ApiErrorCode =
  | 'VALIDATION_ERROR'
  | 'NOT_FOUND'
  | 'HTTP_ERROR'
  | 'INTERNAL_SERVER_ERROR'

export interface ApiError {
  code: ApiErrorCode
  message: string
}

export interface HealthResponse {
  status: 'ok'
  service: 'hidrasplash-api'
  version: '0.1.0-demo'
}

export interface ProductRouteIdentity {
  id: number
  slug: string
  name: string
}

export interface ProductRouteResponse {
  item: ProductRouteIdentity
}

export const productCategories = [
  'shampoos',
  'condicionadores',
  'mascaras',
  'finalizadores',
  'sabonetes',
  'oleos-corporais',
] as const

export const productSubcategories = [
  'anticaspa',
  'antiqueda',
  'antirresiduos',
  'controle-de-oleosidade',
  'hidratacao',
  'nutricao',
  'reconstrucao',
  'cachos',
  'uso-diario',
  'protecao-termica',
  'kit',
  'barra',
  'liquido',
  'relaxamento',
  'revitalizacao',
] as const

export type ProductCategory = (typeof productCategories)[number]
export type ProductSubcategory = (typeof productSubcategories)[number]

export const subcategoriesByCategory = {
  shampoos: [
    'anticaspa',
    'antiqueda',
    'antirresiduos',
    'controle-de-oleosidade',
    'hidratacao',
    'nutricao',
    'reconstrucao',
    'cachos',
    'uso-diario',
    'kit',
  ],
  condicionadores: [
    'hidratacao',
    'nutricao',
    'reconstrucao',
    'cachos',
    'uso-diario',
  ],
  mascaras: ['hidratacao', 'nutricao', 'reconstrucao', 'cachos'],
  finalizadores: [
    'hidratacao',
    'nutricao',
    'reconstrucao',
    'cachos',
    'protecao-termica',
  ],
  sabonetes: ['barra', 'liquido'],
  'oleos-corporais': [
    'hidratacao',
    'nutricao',
    'relaxamento',
    'revitalizacao',
  ],
} as const satisfies Record<ProductCategory, readonly ProductSubcategory[]>

export interface CatalogProductSummary {
  id: number
  slug: string
  name: string
  brand: string
  visibleLabelBrand?: string
  isDemo: true
  category: ProductCategory
  subcategory: ProductSubcategory
  applicationArea: 'hair' | 'body'
  productKind: 'single' | 'kit'
  shortDescription: string
  price: number
  originalPrice?: number
  stock: number
  netContent?: {
    value: number
    unit: 'ml' | 'g'
  }
  rating?: number
  reviews?: number
  imageUrl: string
  dataClassification: {
    commercial: 'fictional-demo'
    compatibility: 'commercial-positioning'
    formulation: 'synthetic-test-data'
    safety: 'not-evaluated'
  }
}

export interface PaginationMetadata {
  page: number
  pageSize: number
  totalItems: number
  totalPages: number
  hasPreviousPage: boolean
  hasNextPage: boolean
}

export interface ProductListResponse {
  items: CatalogProductSummary[]
  pagination: PaginationMetadata
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

export function isProductCategory(value: unknown): value is ProductCategory {
  return (
    typeof value === 'string' &&
    (productCategories as readonly string[]).includes(value)
  )
}

export function isProductSubcategory(
  value: unknown,
): value is ProductSubcategory {
  return (
    typeof value === 'string' &&
    (productSubcategories as readonly string[]).includes(value)
  )
}

export function isSubcategoryForCategory(
  category: ProductCategory,
  subcategory: unknown,
): subcategory is ProductSubcategory {
  return (
    isProductSubcategory(subcategory) &&
    (subcategoriesByCategory[category] as readonly ProductSubcategory[]).includes(
      subcategory,
    )
  )
}

export function isApiError(value: unknown): value is ApiError {
  if (!isRecord(value)) {
    return false
  }

  const codes: ApiErrorCode[] = [
    'VALIDATION_ERROR',
    'NOT_FOUND',
    'HTTP_ERROR',
    'INTERNAL_SERVER_ERROR',
  ]

  return (
    typeof value.code === 'string' &&
    codes.includes(value.code as ApiErrorCode) &&
    typeof value.message === 'string'
  )
}

export function isHealthResponse(value: unknown): value is HealthResponse {
  return (
    isRecord(value) &&
    value.status === 'ok' &&
    value.service === 'hidrasplash-api' &&
    value.version === '0.1.0-demo'
  )
}

export function isProductRouteResponse(
  value: unknown,
): value is ProductRouteResponse {
  if (!isRecord(value) || !isRecord(value.item)) {
    return false
  }

  return (
    Number.isInteger(value.item.id) &&
    typeof value.item.id === 'number' &&
    value.item.id > 0 &&
    typeof value.item.slug === 'string' &&
    value.item.slug.trim().length > 0 &&
    typeof value.item.name === 'string' &&
    value.item.name.trim().length > 0
  )
}

const normalizedIdentifierPattern = /^[a-z0-9]+(?:-[a-z0-9]+)*$/
const catalogImagePattern =
  /^\/api\/catalog\/images\/(?:[a-zA-Z0-9][a-zA-Z0-9._-]*\/)*[a-zA-Z0-9][a-zA-Z0-9._-]*\.(?:jpe?g|png|webp)$/i

function isOptionalFiniteNumber(
  value: unknown,
): value is number | undefined {
  return value === undefined || (typeof value === 'number' && Number.isFinite(value))
}

function isOptionalNetContent(
  value: unknown,
): value is CatalogProductSummary['netContent'] {
  return (
    value === undefined ||
    (isRecord(value) &&
      typeof value.value === 'number' &&
      Number.isFinite(value.value) &&
      value.value > 0 &&
      (value.unit === 'ml' || value.unit === 'g'))
  )
}

function isPublishedDataClassification(
  value: unknown,
): value is CatalogProductSummary['dataClassification'] {
  return (
    isRecord(value) &&
    value.commercial === 'fictional-demo' &&
    value.compatibility === 'commercial-positioning' &&
    value.formulation === 'synthetic-test-data' &&
    value.safety === 'not-evaluated'
  )
}

function isCatalogProductSummary(
  value: unknown,
): value is CatalogProductSummary {
  if (!isRecord(value)) {
    return false
  }

  const hasRating = value.rating !== undefined
  const hasReviews = value.reviews !== undefined
  const hasConsistentReviews =
    hasRating === hasReviews &&
    (!hasRating ||
      (typeof value.rating === 'number' &&
        Number.isFinite(value.rating) &&
        value.rating >= 0 &&
        value.rating <= 5 &&
        typeof value.reviews === 'number' &&
        Number.isInteger(value.reviews) &&
        value.reviews >= 0))

  return (
    typeof value.id === 'number' &&
    Number.isInteger(value.id) &&
    value.id > 0 &&
    typeof value.slug === 'string' &&
    normalizedIdentifierPattern.test(value.slug) &&
    typeof value.name === 'string' &&
    value.name.trim().length > 0 &&
    typeof value.brand === 'string' &&
    value.brand.trim().length > 0 &&
    (value.visibleLabelBrand === undefined ||
      (typeof value.visibleLabelBrand === 'string' &&
        value.visibleLabelBrand.trim().length > 0)) &&
    value.isDemo === true &&
    isProductCategory(value.category) &&
    isSubcategoryForCategory(value.category, value.subcategory) &&
    (value.applicationArea === 'hair' || value.applicationArea === 'body') &&
    (value.productKind === 'single' || value.productKind === 'kit') &&
    typeof value.shortDescription === 'string' &&
    value.shortDescription.trim().length > 0 &&
    typeof value.price === 'number' &&
    Number.isFinite(value.price) &&
    value.price >= 0 &&
    isOptionalFiniteNumber(value.originalPrice) &&
    (value.originalPrice === undefined || value.originalPrice > value.price) &&
    typeof value.stock === 'number' &&
    Number.isInteger(value.stock) &&
    value.stock >= 0 &&
    isOptionalNetContent(value.netContent) &&
    hasConsistentReviews &&
    typeof value.imageUrl === 'string' &&
    catalogImagePattern.test(value.imageUrl) &&
    isPublishedDataClassification(value.dataClassification)
  )
}

function isPaginationMetadata(value: unknown): value is PaginationMetadata {
  return (
    isRecord(value) &&
    typeof value.page === 'number' &&
    Number.isInteger(value.page) &&
    value.page > 0 &&
    typeof value.pageSize === 'number' &&
    Number.isInteger(value.pageSize) &&
    value.pageSize > 0 &&
    value.pageSize <= 100 &&
    typeof value.totalItems === 'number' &&
    Number.isInteger(value.totalItems) &&
    value.totalItems >= 0 &&
    typeof value.totalPages === 'number' &&
    Number.isInteger(value.totalPages) &&
    value.totalPages >= 0 &&
    typeof value.hasPreviousPage === 'boolean' &&
    typeof value.hasNextPage === 'boolean'
  )
}

export function isProductListResponse(
  value: unknown,
): value is ProductListResponse {
  return (
    isRecord(value) &&
    Array.isArray(value.items) &&
    value.items.every(isCatalogProductSummary) &&
    isPaginationMetadata(value.pagination)
  )
}
