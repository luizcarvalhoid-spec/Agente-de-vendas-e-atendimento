import {
  isProductCategory,
  isSubcategoryForCategory,
  type ProductCategory,
  type ProductSubcategory,
} from '../api/contracts.ts'

export interface CatalogUrlState {
  q?: string
  category?: ProductCategory
  subcategory?: ProductSubcategory
  page: number
}

const catalogParameterNames = new Set([
  'q',
  'category',
  'subcategory',
  'page',
])
const internalOrigin = 'https://hidrasplash.internal'

export function readCatalogUrlState(
  searchParams: URLSearchParams,
): CatalogUrlState {
  const rawQuery = searchParams.get('q')?.trim().slice(0, 100)
  const rawCategory = searchParams.get('category')
  const category = isProductCategory(rawCategory) ? rawCategory : undefined
  const rawSubcategory = searchParams.get('subcategory')
  const subcategory =
    category && isSubcategoryForCategory(category, rawSubcategory)
      ? rawSubcategory
      : undefined
  const rawPage = searchParams.get('page')
  const parsedPage = rawPage && /^\d+$/.test(rawPage) ? Number(rawPage) : 1
  const page =
    Number.isSafeInteger(parsedPage) && parsedPage > 0 ? parsedPage : 1

  return {
    q: rawQuery || undefined,
    category,
    subcategory,
    page,
  }
}

export function toCatalogSearchParams(state: CatalogUrlState) {
  const params = new URLSearchParams()

  if (state.q) params.set('q', state.q)
  if (state.category) params.set('category', state.category)
  if (state.subcategory) params.set('subcategory', state.subcategory)
  if (state.page > 1) params.set('page', String(state.page))

  return params
}

export function formatProductCount(count: number) {
  return count === 1 ? '1 produto encontrado' : `${count} produtos encontrados`
}

export function getSafeCatalogReturnTo(value: unknown) {
  if (
    typeof value !== 'string' ||
    !value.startsWith('/') ||
    value.startsWith('//')
  ) {
    return '/'
  }

  const url = new URL(value, internalOrigin)
  const keys = [...url.searchParams.keys()]
  const hasDuplicateKeys = new Set(keys).size !== keys.length

  if (
    url.origin !== internalOrigin ||
    url.pathname !== '/' ||
    url.hash ||
    hasDuplicateKeys ||
    keys.some((key) => !catalogParameterNames.has(key))
  ) {
    return '/'
  }

  const canonicalParams = toCatalogSearchParams(
    readCatalogUrlState(url.searchParams),
  )
  const canonicalPath = canonicalParams.size
    ? `/?${canonicalParams.toString()}`
    : '/'

  return `${url.pathname}${url.search}` === canonicalPath ? canonicalPath : '/'
}
