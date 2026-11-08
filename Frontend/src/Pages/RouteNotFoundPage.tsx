import { ArrowLeft, SearchX } from 'lucide-react'
import { Link } from 'react-router'

import StoreRouteFrame from '../components/StoreRouteFrame'

export default function RouteNotFoundPage() {
  return (
    <StoreRouteFrame>
      <section className="mx-auto max-w-2xl rounded-2xl border border-gray-100 bg-white p-6 text-center shadow-sm sm:p-10">
        <SearchX
          aria-hidden="true"
          className="mx-auto mb-4 text-amber-500"
          size={42}
          strokeWidth={1.7}
        />
        <p className="mb-2 text-sm font-semibold uppercase tracking-wide text-[#527A36]">
          Erro 404
        </p>
        <h1 className="text-2xl font-semibold text-gray-900 sm:text-3xl">
          Página não encontrada
        </h1>
        <p className="mt-4 text-sm leading-relaxed text-gray-600 sm:text-base">
          O endereço informado não corresponde a uma página da loja demonstrativa.
        </p>
        <Link
          to="/"
          className="mt-7 inline-flex min-h-11 items-center rounded-full bg-[#527A36] px-5 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-[#466B2D] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#527A36] focus-visible:ring-offset-2"
        >
          <ArrowLeft aria-hidden="true" className="mr-2" size={16} />
          Voltar à vitrine
        </Link>
      </section>
    </StoreRouteFrame>
  )
}
