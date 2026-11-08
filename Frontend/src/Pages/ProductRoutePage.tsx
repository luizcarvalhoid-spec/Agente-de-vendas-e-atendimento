import { AlertTriangle, ArrowLeft, RefreshCw, SearchX } from 'lucide-react'
import { Link, useParams } from 'react-router'

import ProductDetailView from '../components/ProductDetailView'
import StoreRouteFrame from '../components/StoreRouteFrame'
import {
  useProductDetail,
  type ProductDetailErrorReason,
} from '../hooks/useProductDetail'

const actionClassName =
  'inline-flex items-center justify-center rounded-full px-5 py-2.5 text-sm font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#8BB964] focus-visible:ring-offset-2'

const errorMessages: Record<ProductDetailErrorReason, string> = {
  configuration:
    'A URL pública da API não está configurada corretamente. A vitrine continua disponível.',
  network:
    'Não foi possível alcançar a API. Verifique a conexão e tente novamente.',
  timeout:
    'A consulta demorou mais que o esperado e foi cancelada. Tente novamente.',
  server:
    'A API encontrou uma falha temporária ao consultar o produto. Tente novamente.',
  http: 'A API recusou esta consulta. A vitrine continua disponível.',
  'invalid-response':
    'A API respondeu em um formato inesperado. Nenhum dado incompleto foi exibido.',
  unexpected:
    'Ocorreu uma falha inesperada durante a consulta. Tente novamente.',
}

export default function ProductRoutePage() {
  const { slug } = useParams()
  const { state, retry } = useProductDetail(slug)

  return (
    <StoreRouteFrame>
      {state.status === 'loading' && (
        <section aria-live="polite" aria-busy="true">
          <span className="sr-only">Carregando detalhes do produto</span>
          <div className="mb-6 h-5 w-64 animate-pulse rounded bg-gray-200" />
          <div className="grid gap-8 lg:grid-cols-2">
            <div className="aspect-square animate-pulse rounded-3xl bg-gray-200" />
            <div className="min-h-[430px] animate-pulse rounded-3xl bg-white p-8 shadow-sm">
              <div className="h-5 w-36 rounded bg-gray-200" />
              <div className="mt-6 h-9 w-4/5 rounded bg-gray-200" />
              <div className="mt-3 h-9 w-3/5 rounded bg-gray-200" />
              <div className="mt-10 h-16 w-2/5 rounded bg-gray-200" />
              <div className="mt-10 h-12 w-full rounded-full bg-gray-200" />
            </div>
          </div>
        </section>
      )}

      {state.status === 'success' && (
        <ProductDetailView key={state.data.item.slug} response={state.data} />
      )}

      {state.status === 'not-found' && (
        <RouteMessage
          icon="not-found"
          eyebrow="Erro 404"
          title="Produto não encontrado"
          description="Não encontramos um produto com este endereço no catálogo HidraSplash."
        />
      )}

      {state.status === 'invalid-request' && (
        <RouteMessage
          icon="warning"
          eyebrow="Endereço inválido"
          title="Não foi possível consultar este produto"
          description="O endereço informado não corresponde ao formato de slug aceito pelo catálogo."
        />
      )}

      {state.status === 'error' && (
        <RouteMessage
          icon="warning"
          eyebrow="Falha na consulta"
          title="Não foi possível carregar este produto"
          description={errorMessages[state.reason]}
          retry={state.canRetry ? retry : undefined}
        />
      )}
    </StoreRouteFrame>
  )
}

interface RouteMessageProps {
  icon: 'not-found' | 'warning'
  eyebrow: string
  title: string
  description: string
  retry?: () => void
}

function RouteMessage({
  icon,
  eyebrow,
  title,
  description,
  retry,
}: RouteMessageProps) {
  return (
    <section
      aria-live="polite"
      className="mx-auto max-w-2xl rounded-2xl border border-gray-100 bg-white p-6 text-center shadow-sm sm:p-10"
    >
      {icon === 'not-found' ? (
        <SearchX
          aria-hidden="true"
          className="mx-auto mb-4 text-amber-500"
          size={42}
          strokeWidth={1.7}
        />
      ) : (
        <AlertTriangle
          aria-hidden="true"
          className="mx-auto mb-4 text-amber-500"
          size={42}
          strokeWidth={1.7}
        />
      )}
      <p className="mb-2 text-sm font-semibold uppercase tracking-wide text-[#8BB964]">
        {eyebrow}
      </p>
      <h1 className="text-2xl font-semibold text-gray-900 sm:text-3xl">
        {title}
      </h1>
      <p className="mt-4 text-sm leading-relaxed text-gray-600 sm:text-base">
        {description}
      </p>

      <div className="mt-7 flex flex-wrap justify-center gap-3">
        {retry && (
          <button
            type="button"
            onClick={retry}
            className={`${actionClassName} bg-[#8BB964] text-white hover:bg-[#7aa854]`}
          >
            <RefreshCw aria-hidden="true" className="mr-2" size={16} />
            Tentar novamente
          </button>
        )}
        <Link
          to="/"
          className={`${actionClassName} border-2 border-[#8BB964] text-[#8BB964] hover:bg-[#8BB964] hover:text-white`}
        >
          <ArrowLeft aria-hidden="true" className="mr-2" size={16} />
          Voltar à vitrine
        </Link>
      </div>
    </section>
  )
}
