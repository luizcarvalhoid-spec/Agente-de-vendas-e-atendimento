import { ArrowLeft, Construction } from 'lucide-react'
import { Link } from 'react-router'

import StoreRouteFrame from '../components/StoreRouteFrame'

interface DeferredFeaturePageProps {
  title: string
  description: string
  relatedLink?: {
    to: string
    label: string
  }
}

const linkClassName =
  'inline-flex items-center justify-center rounded-full border-2 border-[#8BB964] px-5 py-2.5 text-sm font-semibold text-[#8BB964] transition-colors hover:bg-[#8BB964] hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#8BB964] focus-visible:ring-offset-2'

export default function DeferredFeaturePage({
  title,
  description,
  relatedLink,
}: DeferredFeaturePageProps) {
  return (
    <StoreRouteFrame>
      <section className="mx-auto max-w-2xl rounded-2xl border border-gray-100 bg-white p-6 text-center shadow-sm sm:p-10">
        <Construction
          aria-hidden="true"
          className="mx-auto mb-4 text-amber-500"
          size={42}
          strokeWidth={1.7}
        />
        <p className="mb-2 text-sm font-semibold uppercase tracking-wide text-[#8BB964]">
          Funcionalidade futura
        </p>
        <h1 className="text-2xl font-semibold text-gray-900 sm:text-3xl">
          {title}
        </h1>
        <p className="mx-auto mt-4 max-w-xl text-sm leading-relaxed text-gray-600 sm:text-base">
          {description}
        </p>
        <div className="mt-7 flex flex-col items-center justify-center gap-3 sm:flex-row">
          <Link to="/" className={linkClassName}>
            <ArrowLeft aria-hidden="true" className="mr-2" size={16} />
            Voltar à vitrine
          </Link>
          {relatedLink && (
            <Link to={relatedLink.to} className={linkClassName}>
              {relatedLink.label}
            </Link>
          )}
        </div>
      </section>
    </StoreRouteFrame>
  )
}
