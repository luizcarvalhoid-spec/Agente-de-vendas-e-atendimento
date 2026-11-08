import { ArrowLeft, RefreshCw, SearchX } from 'lucide-react'
import { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router'

import { ApiRequestError, getProductBySlug } from '../api/client'
import type { ProductRouteIdentity } from '../api/contracts'
import StoreRouteFrame from '../components/StoreRouteFrame'

type ProductRouteState =
  | { status: 'loading' }
  | { status: 'found'; product: ProductRouteIdentity }
  | { status: 'not-found' }
  | { status: 'error' }

const requestTimeoutMs = 5_000

const actionClassName =
  'inline-flex items-center justify-center rounded-full px-5 py-2.5 text-sm font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#8BB964] focus-visible:ring-offset-2'

function isMissingProduct(error: unknown) {
  return (
    error instanceof ApiRequestError &&
    (error.status === 404 ||
      error.code === 'NOT_FOUND' ||
      error.code === 'VALIDATION_ERROR')
  )
}

export default function ProductRoutePage() {
  const { slug } = useParams()
  const [requestAttempt, setRequestAttempt] = useState(0)
  const [state, setState] = useState<ProductRouteState>({ status: 'loading' })

  useEffect(() => {
    if (!slug) {
      setState({ status: 'not-found' })
      return
    }

    let isMounted = true
    const controller = new AbortController()
    const timeoutId = window.setTimeout(() => {
      controller.abort()
    }, requestTimeoutMs)

    setState({ status: 'loading' })

    void getProductBySlug(slug, controller.signal)
      .then(({ item }) => {
        if (isMounted) {
          setState({ status: 'found', product: item })
        }
      })
      .catch((error: unknown) => {
        if (!isMounted) {
          return
        }

        setState({ status: isMissingProduct(error) ? 'not-found' : 'error' })
      })
      .finally(() => {
        window.clearTimeout(timeoutId)
      })

    return () => {
      isMounted = false
      window.clearTimeout(timeoutId)
      controller.abort()
    }
  }, [requestAttempt, slug])

  return (
    <StoreRouteFrame>
      <section
        aria-live="polite"
        className="mx-auto max-w-2xl rounded-2xl border border-gray-100 bg-white p-6 text-center shadow-sm sm:p-10"
      >
        {state.status === 'loading' && (
          <>
            <span
              aria-hidden="true"
              className="mx-auto mb-5 block h-10 w-10 animate-spin rounded-full border-4 border-gray-200 border-t-[#8BB964]"
            />
            <h1 className="text-2xl font-semibold text-gray-900">
              Consultando o catálogo…
            </h1>
            <p className="mt-3 text-sm text-gray-600">
              Estamos verificando este produto na API HidraSplash.
            </p>
          </>
        )}

        {state.status === 'found' && (
          <>
            <p className="mb-2 text-sm font-semibold uppercase tracking-wide text-[#8BB964]">
              Produto localizado
            </p>
            <h1 className="text-2xl font-semibold text-gray-900 sm:text-3xl">
              {state.product.name}
            </h1>
            <p className="mt-4 text-sm leading-relaxed text-gray-600 sm:text-base">
              Este produto está disponível no catálogo demonstrativo. Os detalhes completos serão apresentados em uma próxima etapa.
            </p>
          </>
        )}

        {state.status === 'not-found' && (
          <>
            <SearchX
              aria-hidden="true"
              className="mx-auto mb-4 text-amber-500"
              size={42}
              strokeWidth={1.7}
            />
            <p className="mb-2 text-sm font-semibold uppercase tracking-wide text-[#8BB964]">
              Erro 404
            </p>
            <h1 className="text-2xl font-semibold text-gray-900 sm:text-3xl">
              Produto não encontrado
            </h1>
            <p className="mt-4 text-sm leading-relaxed text-gray-600 sm:text-base">
              Não encontramos um produto com este endereço no catálogo HidraSplash.
            </p>
          </>
        )}

        {state.status === 'error' && (
          <>
            <h1 className="text-2xl font-semibold text-gray-900 sm:text-3xl">
              Não foi possível carregar este produto
            </h1>
            <p className="mt-4 text-sm leading-relaxed text-gray-600 sm:text-base">
              Verifique a conexão com a API e tente novamente. A vitrine continua disponível.
            </p>
            <button
              type="button"
              onClick={() => setRequestAttempt((attempt) => attempt + 1)}
              className={`${actionClassName} mt-6 bg-[#8BB964] text-white hover:bg-[#7aa854]`}
            >
              <RefreshCw aria-hidden="true" className="mr-2" size={16} />
              Tentar novamente
            </button>
          </>
        )}

        {state.status !== 'loading' && (
          <div className="mt-7">
            <Link
              to="/"
              className={`${actionClassName} border-2 border-[#8BB964] text-[#8BB964] hover:bg-[#8BB964] hover:text-white`}
            >
              <ArrowLeft aria-hidden="true" className="mr-2" size={16} />
              Voltar à vitrine
            </Link>
          </div>
        )}
      </section>
    </StoreRouteFrame>
  )
}
