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

export const hairTypes = [
  'todos',
  'lisos',
  'ondulados',
  'cacheados',
  'crespos',
] as const
export const scalpTypes = [
  'todos',
  'normal',
  'seco',
  'oleoso',
  'sensivel',
] as const
export const productConcerns = [
  'caspa',
  'descamacao',
  'oleosidade',
  'ressecamento',
  'sensibilidade',
  'queda-e-quebra',
  'frizz',
  'danos',
  'falta-de-brilho',
  'definicao-de-cachos',
  'acumulo-de-residuos',
] as const
export const skinTypes = [
  'todos',
  'normal',
  'seca',
  'oleosa',
  'mista',
  'sensivel',
] as const
export const bodyConcerns = [
  'ressecamento',
  'sensibilidade',
  'aspereza',
  'limpeza-suave',
  'nutricao',
  'relaxamento',
  'revitalizacao',
] as const
export const restrictionCodes = [
  'evitar-couro-cabeludo-sensivel',
  'evitar-couro-cabeludo-seco',
  'evitar-couro-cabeludo-oleoso',
  'evitar-cabelos-coloridos',
  'evitar-cabelos-quimicamente-tratados',
  'evitar-sensibilidade-a-fragrancia',
] as const

export type HairType = (typeof hairTypes)[number]
export type ScalpType = (typeof scalpTypes)[number]
export type ProductConcern = (typeof productConcerns)[number]
export type SkinType = (typeof skinTypes)[number]
export type BodyConcern = (typeof bodyConcerns)[number]
export type RestrictionCode = (typeof restrictionCodes)[number]

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
  netContent?: NetContent
  rating?: number
  reviews?: number
  imageUrl: string
  dataClassification: ProductDataClassification
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

export interface NetContent {
  value: number
  unit: 'ml' | 'g'
}

export interface ProductDataClassification {
  commercial: 'fictional-demo'
  compatibility: 'commercial-positioning'
  formulation: 'synthetic-test-data'
  safety: 'not-evaluated'
}

export interface ProductIngredient {
  id: string
  name: string
}

export interface ProductVariant {
  name: string
  profile?: string
  sensoryNotes?: string[]
}

export interface SyntheticFormulation {
  basis: 'synthetic-test-data'
  ingredients: ProductIngredient[]
  usage: string
  restrictions: RestrictionCode[]
  warnings: string[]
  contraindications: string[]
}

export interface KitContent {
  name: string
  quantity: number
  netContent?: NetContent
  formulation: SyntheticFormulation
}

interface ProductDetailCommon {
  id: number
  slug: string
  name: string
  brand: string
  visibleLabelBrand?: string
  isDemo: true
  dataClassification: ProductDataClassification
  category: ProductCategory
  subcategory: ProductSubcategory
  applicationArea: 'hair' | 'body'
  productKind: 'single' | 'kit'
  description: string
  shortDescription: string
  price: number
  originalPrice?: number
  image: string
  images?: string[]
  stock: number
  netContent?: NetContent
  variant: ProductVariant
  soapForm?: 'bar' | 'liquid'
  tags: string[]
  indications: string[]
  benefits: string[]
  rating?: number
  reviews?: number
}

interface HairCompatibility {
  applicationArea: 'hair'
  hairTypes: HairType[]
  scalpTypes: ScalpType[]
  concerns: ProductConcern[]
}

interface BodyCompatibility {
  applicationArea: 'body'
  skinTypes: SkinType[]
  bodyConcerns: BodyConcern[]
}

interface SingleProductFormulation {
  productKind: 'single'
  ingredients: ProductIngredient[]
  usage: string
  restrictions: RestrictionCode[]
  warnings: string[]
  contraindications: string[]
}

interface KitProductFormulation {
  productKind: 'kit'
  kitContents: KitContent[]
}

export type CatalogProductDetail = ProductDetailCommon &
  (HairCompatibility | BodyCompatibility) &
  (SingleProductFormulation | KitProductFormulation)

export interface ProductMedia {
  primaryUrl: string
  galleryUrls: string[]
}

export interface ProductDetailResponse {
  item: CatalogProductDetail
  media: ProductMedia
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

const normalizedIdentifierPattern = /^[a-z0-9]+(?:-[a-z0-9]+)*$/
const catalogImagePattern =
  /^\/api\/catalog\/images\/(?:[a-zA-Z0-9][a-zA-Z0-9._-]*\/)*[a-zA-Z0-9][a-zA-Z0-9._-]*\.(?:jpe?g|png|webp)$/i
const catalogImageReferencePattern =
  /^(?:[a-zA-Z0-9][a-zA-Z0-9._-]*\/)*[a-zA-Z0-9][a-zA-Z0-9._-]*\.(?:jpe?g|png|webp)$/i

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0
}

function isNonEmptyStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.length > 0 && value.every(isNonEmptyString)
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every(isNonEmptyString)
}

function isEnumValue<T extends string>(
  value: unknown,
  values: readonly T[],
): value is T {
  return typeof value === 'string' && values.includes(value as T)
}

function isEnumArray<T extends string>(
  value: unknown,
  values: readonly T[],
  allowEmpty = false,
): value is T[] {
  return (
    Array.isArray(value) &&
    (allowEmpty || value.length > 0) &&
    value.every((item) => isEnumValue(item, values))
  )
}

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

function hasConsistentRating(value: Record<string, unknown>) {
  const hasRating = value.rating !== undefined
  const hasReviews = value.reviews !== undefined

  return (
    hasRating === hasReviews &&
    (!hasRating ||
      (typeof value.rating === 'number' &&
        Number.isFinite(value.rating) &&
        value.rating >= 0 &&
        value.rating <= 5 &&
        typeof value.reviews === 'number' &&
        Number.isInteger(value.reviews) &&
        value.reviews >= 0 &&
        ((value.reviews === 0 && value.rating === 0) ||
          (value.reviews > 0 && value.rating > 0))))
  )
}

function isCatalogProductSummary(
  value: unknown,
): value is CatalogProductSummary {
  if (!isRecord(value)) {
    return false
  }

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
    hasConsistentRating(value) &&
    typeof value.imageUrl === 'string' &&
    catalogImagePattern.test(value.imageUrl) &&
    isPublishedDataClassification(value.dataClassification)
  )
}

function isIngredient(value: unknown): value is ProductIngredient {
  return (
    isRecord(value) &&
    isNonEmptyString(value.id) &&
    normalizedIdentifierPattern.test(value.id) &&
    isNonEmptyString(value.name)
  )
}

function isIngredientArray(value: unknown): value is ProductIngredient[] {
  return Array.isArray(value) && value.length > 0 && value.every(isIngredient)
}

function isVariant(value: unknown): value is ProductVariant {
  return (
    isRecord(value) &&
    isNonEmptyString(value.name) &&
    (value.profile === undefined ||
      (isNonEmptyString(value.profile) &&
        normalizedIdentifierPattern.test(value.profile))) &&
    (value.sensoryNotes === undefined ||
      isNonEmptyStringArray(value.sensoryNotes))
  )
}

function isSyntheticFormulation(
  value: unknown,
): value is SyntheticFormulation {
  return (
    isRecord(value) &&
    value.basis === 'synthetic-test-data' &&
    isIngredientArray(value.ingredients) &&
    isNonEmptyString(value.usage) &&
    isEnumArray(value.restrictions, restrictionCodes, true) &&
    isNonEmptyStringArray(value.warnings) &&
    isStringArray(value.contraindications)
  )
}

function isKitContent(value: unknown): value is KitContent {
  return (
    isRecord(value) &&
    isNonEmptyString(value.name) &&
    typeof value.quantity === 'number' &&
    Number.isInteger(value.quantity) &&
    value.quantity > 0 &&
    isOptionalNetContent(value.netContent) &&
    isSyntheticFormulation(value.formulation)
  )
}

function categoryMatchesApplicationArea(
  category: ProductCategory,
  applicationArea: unknown,
) {
  const hairCategories: readonly ProductCategory[] = [
    'shampoos',
    'condicionadores',
    'mascaras',
    'finalizadores',
  ]

  return hairCategories.includes(category)
    ? applicationArea === 'hair'
    : applicationArea === 'body'
}

function hasValidProductFormulation(value: Record<string, unknown>) {
  if (value.productKind === 'single') {
    return (
      value.kitContents === undefined &&
      isIngredientArray(value.ingredients) &&
      isNonEmptyString(value.usage) &&
      isEnumArray(value.restrictions, restrictionCodes, true) &&
      isNonEmptyStringArray(value.warnings) &&
      isStringArray(value.contraindications)
    )
  }

  return (
    value.productKind === 'kit' &&
    value.subcategory === 'kit' &&
    Array.isArray(value.kitContents) &&
    value.kitContents.length > 0 &&
    value.kitContents.every(isKitContent) &&
    value.ingredients === undefined &&
    value.usage === undefined &&
    value.restrictions === undefined &&
    value.warnings === undefined &&
    value.contraindications === undefined
  )
}

function hasValidCompatibility(value: Record<string, unknown>) {
  if (value.applicationArea === 'hair') {
    return (
      value.skinTypes === undefined &&
      value.bodyConcerns === undefined &&
      isEnumArray(value.hairTypes, hairTypes) &&
      isEnumArray(value.scalpTypes, scalpTypes) &&
      isEnumArray(value.concerns, productConcerns)
    )
  }

  return (
    value.applicationArea === 'body' &&
    value.hairTypes === undefined &&
    value.scalpTypes === undefined &&
    value.concerns === undefined &&
    isEnumArray(value.skinTypes, skinTypes) &&
    isEnumArray(value.bodyConcerns, bodyConcerns)
  )
}

function isCatalogProductDetail(
  value: unknown,
): value is CatalogProductDetail {
  if (!isRecord(value) || !isProductCategory(value.category)) {
    return false
  }

  const hasValidImages =
    isNonEmptyString(value.image) &&
    catalogImageReferencePattern.test(value.image) &&
    (value.images === undefined ||
      (Array.isArray(value.images) &&
        value.images.length > 0 &&
        value.images.every(
          (image) =>
            isNonEmptyString(image) && catalogImageReferencePattern.test(image),
        )))
  const hasValidSoapForm =
    value.category === 'sabonetes'
      ? value.soapForm === 'bar' || value.soapForm === 'liquid'
      : value.soapForm === undefined

  return (
    typeof value.id === 'number' &&
    Number.isInteger(value.id) &&
    value.id > 0 &&
    isNonEmptyString(value.slug) &&
    normalizedIdentifierPattern.test(value.slug) &&
    isNonEmptyString(value.name) &&
    isNonEmptyString(value.brand) &&
    (value.visibleLabelBrand === undefined ||
      isNonEmptyString(value.visibleLabelBrand)) &&
    value.isDemo === true &&
    isPublishedDataClassification(value.dataClassification) &&
    isSubcategoryForCategory(value.category, value.subcategory) &&
    categoryMatchesApplicationArea(value.category, value.applicationArea) &&
    (value.productKind === 'single' || value.productKind === 'kit') &&
    isNonEmptyString(value.description) &&
    isNonEmptyString(value.shortDescription) &&
    typeof value.price === 'number' &&
    Number.isFinite(value.price) &&
    value.price >= 0 &&
    isOptionalFiniteNumber(value.originalPrice) &&
    (value.originalPrice === undefined || value.originalPrice > value.price) &&
    hasValidImages &&
    typeof value.stock === 'number' &&
    Number.isInteger(value.stock) &&
    value.stock >= 0 &&
    isOptionalNetContent(value.netContent) &&
    isVariant(value.variant) &&
    hasValidSoapForm &&
    isNonEmptyStringArray(value.tags) &&
    value.tags.every((tag) => normalizedIdentifierPattern.test(tag)) &&
    isNonEmptyStringArray(value.indications) &&
    isNonEmptyStringArray(value.benefits) &&
    hasConsistentRating(value) &&
    hasValidCompatibility(value) &&
    hasValidProductFormulation(value)
  )
}

function isProductMedia(value: unknown): value is ProductMedia {
  return (
    isRecord(value) &&
    isNonEmptyString(value.primaryUrl) &&
    catalogImagePattern.test(value.primaryUrl) &&
    Array.isArray(value.galleryUrls) &&
    value.galleryUrls.every(
      (url) => isNonEmptyString(url) && catalogImagePattern.test(url),
    )
  )
}

export function isProductDetailResponse(
  value: unknown,
): value is ProductDetailResponse {
  return (
    isRecord(value) &&
    isCatalogProductDetail(value.item) &&
    isProductMedia(value.media)
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
