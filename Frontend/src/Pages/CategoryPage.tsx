import { ChevronLeft, ChevronRight, RefreshCw } from 'lucide-react'
import { useEffect, useMemo } from 'react'
import { useSearchParams } from 'react-router'

import {
  isProductCategory,
  isSubcategoryForCategory,
  subcategoriesByCategory,
  type ProductCategory,
  type ProductSubcategory,
} from '../api/contracts'
import fireIcon from '../assets/Icons/fire_1f525.gif'
import { useCatalogProducts } from '../hooks/useCatalogProducts'
import AnnouncementBar from './AnnouncementBar'
import ChatbotButton from './ChatbotButton'
import Header from './Header'
import ProductCard from './ProductCard'

const pageSize = 12

const categoryOptions: ReadonlyArray<{
  label: string
  value?: ProductCategory
}> = [
  { label: 'Todos' },
  { label: 'Shampoos', value: 'shampoos' },
  { label: 'Sabonetes', value: 'sabonetes' },
  { label: 'Óleos corporais', value: 'oleos-corporais' },
  { label: 'Condicionadores', value: 'condicionadores' },
]

const subcategoryLabels: Record<ProductSubcategory, string> = {
  anticaspa: 'Anticaspa',
  antiqueda: 'Antiqueda',
  antirresiduos: 'Antirresíduos',
  'controle-de-oleosidade': 'Controle de oleosidade',
  hidratacao: 'Hidratação',
  nutricao: 'Nutrição',
  reconstrucao: 'Reconstrução',
  cachos: 'Cachos',
  'uso-diario': 'Uso diário',
  'protecao-termica': 'Proteção térmica',
  kit: 'Kit',
  barra: 'Barra',
  liquido: 'Líquido',
  relaxamento: 'Relaxamento',
  revitalizacao: 'Revitalização',
}

interface CatalogUrlState {
  q?: string
  category?: ProductCategory
  subcategory?: ProductSubcategory
  page: number
}

function readCatalogUrlState(searchParams: URLSearchParams): CatalogUrlState {
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
  const page = Number.isSafeInteger(parsedPage) && parsedPage > 0 ? parsedPage : 1

  return {
    q: rawQuery || undefined,
    category,
    subcategory,
    page,
  }
}

function toSearchParams(state: CatalogUrlState) {
  const params = new URLSearchParams()

  if (state.q) params.set('q', state.q)
  if (state.category) params.set('category', state.category)
  if (state.subcategory) params.set('subcategory', state.subcategory)
  if (state.page > 1) params.set('page', String(state.page))

  return params
}

function getVisiblePages(currentPage: number, totalPages: number) {
  const firstPage = Math.max(1, Math.min(currentPage - 2, totalPages - 4))
  const lastPage = Math.min(totalPages, firstPage + 4)

  return Array.from(
    { length: Math.max(0, lastPage - firstPage + 1) },
    (_, index) => firstPage + index,
  )
}

export default function CategoryPage() {
  const [searchParams, setSearchParams] = useSearchParams()
  const urlState = useMemo(
    () => readCatalogUrlState(searchParams),
    [searchParams],
  )
  const canonicalParams = useMemo(() => toSearchParams(urlState), [urlState])
  const isUrlCanonical = searchParams.toString() === canonicalParams.toString()
  const { state, retry } = useCatalogProducts({
    q: urlState.q,
    category: urlState.category,
    subcategory: urlState.subcategory,
    page: urlState.page,
    pageSize,
  })

  useEffect(() => {
    if (!isUrlCanonical) {
      setSearchParams(canonicalParams, { replace: true })
    }
  }, [canonicalParams, isUrlCanonical, setSearchParams])

  useEffect(() => {
    if (state.status !== 'success') return

    const { totalPages } = state.data.pagination
    const targetPage =
      totalPages === 0 ? 1 : Math.min(urlState.page, totalPages)

    if (targetPage !== urlState.page) {
      setSearchParams(toSearchParams({ ...urlState, page: targetPage }), {
        replace: true,
      })
    }
  }, [setSearchParams, state, urlState])

  const setUrlState = (nextState: CatalogUrlState) => {
    setSearchParams(toSearchParams(nextState))
  }

  const selectCategory = (category?: ProductCategory) => {
    setUrlState({
      ...urlState,
      category,
      subcategory: undefined,
      page: 1,
    })
  }

  const selectAnticaspa = () => {
    setUrlState({
      ...urlState,
      category: 'shampoos',
      subcategory: 'anticaspa',
      page: 1,
    })
  }

  const selectSubcategory = (subcategory?: ProductSubcategory) => {
    setUrlState({ ...urlState, subcategory, page: 1 })
  }

  const clearFilters = () => {
    setUrlState({ page: 1 })
  }

  const pagination =
    state.status === 'success' ? state.data.pagination : undefined
  const isPageBeingCorrected =
    pagination !== undefined &&
    ((pagination.totalPages === 0 && urlState.page !== 1) ||
      (pagination.totalPages > 0 && urlState.page > pagination.totalPages))
  const visiblePages = pagination
    ? getVisiblePages(pagination.page, pagination.totalPages)
    : []
  const availableSubcategories = urlState.category
    ? subcategoriesByCategory[urlState.category]
    : []

  return (
    <div className="min-h-screen bg-gray-50 font-poppins">
      <AnnouncementBar />
      <Header />

      <main className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
        <div className="mb-8">
          <div className="mb-1 flex items-center gap-2">
            <img
              src={fireIcon}
              alt=""
              aria-hidden="true"
              className="h-7 w-7 object-contain sm:h-8 sm:w-8"
            />
            <h1 className="text-2xl font-medium tracking-tight text-gray-900 sm:text-3xl">
              Produtos em destaque
            </h1>
          </div>
          <p
            className="ml-9 text-sm text-gray-500 sm:ml-10"
            aria-live="polite"
          >
            {state.status === 'success' && !isPageBeingCorrected
              ? `${pagination?.totalItems ?? 0} produtos encontrados`
              : state.status === 'error'
                ? 'Não foi possível consultar os produtos'
                : 'Carregando produtos...'}
          </p>
        </div>

        <section aria-labelledby="catalog-filters" className="mb-6">
          <h2 id="catalog-filters" className="sr-only">
            Filtros do catálogo
          </h2>
          <div className="flex items-center gap-2 overflow-x-auto pb-2 scrollbar-hide">
            {categoryOptions.map((option) => {
              const isSelected =
                urlState.category === option.value && !urlState.subcategory

              return (
                <button
                  key={option.label}
                  type="button"
                  aria-pressed={isSelected}
                  onClick={() => selectCategory(option.value)}
                  className={`flex-shrink-0 rounded-full border px-4 py-1.5 text-sm font-medium transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#8BB964] focus-visible:ring-offset-2 ${
                    isSelected
                      ? 'border-[#8BB964] bg-[#8BB964] text-white shadow-sm'
                      : 'border-gray-200 bg-white text-gray-600 hover:border-[#8BB964] hover:text-[#8BB964]'
                  }`}
                >
                  {option.label}
                </button>
              )
            })}
            <button
              type="button"
              aria-pressed={urlState.subcategory === 'anticaspa'}
              onClick={selectAnticaspa}
              className={`flex-shrink-0 rounded-full border px-4 py-1.5 text-sm font-medium transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#8BB964] focus-visible:ring-offset-2 ${
                urlState.subcategory === 'anticaspa'
                  ? 'border-[#8BB964] bg-[#8BB964] text-white shadow-sm'
                  : 'border-gray-200 bg-white text-gray-600 hover:border-[#8BB964] hover:text-[#8BB964]'
              }`}
            >
              Anticaspa
            </button>
          </div>

          {urlState.category && availableSubcategories.length > 0 && (
            <div className="mt-3 flex items-center gap-2">
              <label
                htmlFor="subcategory-filter"
                className="text-sm font-medium text-gray-600"
              >
                Subcategoria
              </label>
              <select
                id="subcategory-filter"
                value={urlState.subcategory ?? ''}
                onChange={(event) =>
                  selectSubcategory(
                    (event.target.value || undefined) as
                      | ProductSubcategory
                      | undefined,
                  )
                }
                className="max-w-full rounded-md border border-gray-200 bg-white px-3 py-2 text-sm text-gray-700 focus:border-[#8BB964] focus:outline-none focus:ring-2 focus:ring-[#8BB964]/40"
              >
                <option value="">Todas</option>
                {availableSubcategories.map((subcategory) => (
                  <option key={subcategory} value={subcategory}>
                    {subcategoryLabels[subcategory]}
                  </option>
                ))}
              </select>
            </div>
          )}
        </section>

        {(state.status === 'loading' || isPageBeingCorrected) && (
          <div
            className="grid grid-cols-1 gap-5 sm:grid-cols-2 sm:gap-6 xl:grid-cols-4"
            aria-label="Carregando catálogo"
            aria-busy="true"
          >
            {Array.from({ length: pageSize }).map((_, index) => (
              <div
                key={index}
                className="h-[430px] animate-pulse rounded-2xl border border-gray-100 bg-white shadow-sm"
              >
                <div className="aspect-square bg-gray-200" />
                <div className="space-y-3 p-4">
                  <div className="h-4 w-4/5 rounded bg-gray-200" />
                  <div className="h-3 w-full rounded bg-gray-100" />
                  <div className="h-6 w-2/5 rounded bg-gray-200" />
                </div>
              </div>
            ))}
          </div>
        )}

        {state.status === 'error' && (
          <div className="rounded-2xl border border-gray-200 bg-white px-6 py-12 text-center shadow-sm">
            <h2 className="text-lg font-semibold text-gray-800">
              A vitrine está temporariamente indisponível
            </h2>
            <p className="mx-auto mt-2 max-w-md text-sm text-gray-500">
              Não foi possível carregar o catálogo. Verifique a conexão e tente novamente.
            </p>
            <button
              type="button"
              onClick={retry}
              className="mt-5 inline-flex items-center gap-2 rounded-full bg-[#8BB964] px-5 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-[#7aa854] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#8BB964] focus-visible:ring-offset-2"
            >
              <RefreshCw size={16} aria-hidden="true" />
              Tentar novamente
            </button>
          </div>
        )}

        {state.status === 'success' &&
          !isPageBeingCorrected &&
          state.data.items.length === 0 && (
            <div className="rounded-2xl border border-gray-200 bg-white px-6 py-12 text-center shadow-sm">
              <h2 className="text-lg font-semibold text-gray-800">
                Nenhum produto encontrado
              </h2>
              <p className="mt-2 text-sm text-gray-500">
                Ajuste a busca ou os filtros para consultar novamente.
              </p>
              <button
                type="button"
                onClick={clearFilters}
                className="mt-5 rounded-full border-2 border-[#8BB964] px-5 py-2 text-sm font-semibold text-[#8BB964] transition-colors hover:bg-[#8BB964] hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#8BB964] focus-visible:ring-offset-2"
              >
                Limpar busca e filtros
              </button>
            </div>
          )}

        {state.status === 'success' &&
          !isPageBeingCorrected &&
          state.data.items.length > 0 && (
            <>
              <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 sm:gap-6 xl:grid-cols-4">
                {state.data.items.map((product) => (
                  <ProductCard key={product.id} product={product} />
                ))}
              </div>

              {pagination && pagination.totalPages > 1 && (
                <nav
                  aria-label="Paginação dos produtos"
                  className="mt-10 flex flex-wrap items-center justify-center gap-2"
                >
                  <button
                    type="button"
                    disabled={!pagination.hasPreviousPage}
                    onClick={() =>
                      setUrlState({ ...urlState, page: pagination.page - 1 })
                    }
                    className="inline-flex h-10 items-center gap-1 rounded-full border border-gray-200 bg-white px-3 text-sm font-medium text-gray-600 transition-colors hover:border-[#8BB964] hover:text-[#8BB964] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#8BB964] disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    <ChevronLeft size={16} aria-hidden="true" />
                    <span className="hidden sm:inline">Anterior</span>
                  </button>

                  {visiblePages.map((page) => (
                    <button
                      key={page}
                      type="button"
                      aria-current={
                        page === pagination.page ? 'page' : undefined
                      }
                      onClick={() => setUrlState({ ...urlState, page })}
                      className={`h-10 min-w-10 rounded-full border px-3 text-sm font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#8BB964] ${
                        page === pagination.page
                          ? 'border-[#8BB964] bg-[#8BB964] text-white'
                          : 'border-gray-200 bg-white text-gray-600 hover:border-[#8BB964] hover:text-[#8BB964]'
                      }`}
                    >
                      {page}
                    </button>
                  ))}

                  <button
                    type="button"
                    disabled={!pagination.hasNextPage}
                    onClick={() =>
                      setUrlState({ ...urlState, page: pagination.page + 1 })
                    }
                    className="inline-flex h-10 items-center gap-1 rounded-full border border-gray-200 bg-white px-3 text-sm font-medium text-gray-600 transition-colors hover:border-[#8BB964] hover:text-[#8BB964] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#8BB964] disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    <span className="hidden sm:inline">Próxima</span>
                    <ChevronRight size={16} aria-hidden="true" />
                  </button>
                </nav>
              )}
            </>
          )}
      </main>

      <ChatbotButton />
    </div>
  )
}
