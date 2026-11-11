import { formatCartCurrency } from '../cart/cart-model'

interface CartTotalsSummaryProps {
  subtotalCents: number
  shippingCents: number
  totalCents: number
  isPartial: boolean
}

export default function CartTotalsSummary({
  subtotalCents,
  shippingCents,
  totalCents,
  isPartial,
}: CartTotalsSummaryProps) {
  return (
    <section
      aria-labelledby="cart-totals-title"
      className="rounded-2xl border border-gray-100 bg-white p-5 shadow-sm"
    >
      <h2 id="cart-totals-title" className="text-lg font-semibold text-gray-900">
        {isPartial ? 'Valores confirmados parciais' : 'Resumo demonstrativo'}
      </h2>
      <dl className="mt-4 space-y-3 text-sm">
        <div className="flex items-center justify-between gap-4">
          <dt className="text-gray-600">
            {isPartial ? 'Subtotal confirmado' : 'Subtotal'}
          </dt>
          <dd className="font-semibold text-gray-900">
            {formatCartCurrency(subtotalCents)}
          </dd>
        </div>
        <div className="flex items-center justify-between gap-4">
          <dt className="text-gray-600">Frete demonstrativo</dt>
          <dd className="font-semibold text-gray-900">
            {shippingCents === 0 && subtotalCents > 0
              ? 'Grátis'
              : formatCartCurrency(shippingCents)}
          </dd>
        </div>
        <div className="flex items-center justify-between gap-4 border-t border-gray-200 pt-3 text-base">
          <dt className="font-semibold text-gray-900">
            {isPartial ? 'Total parcial' : 'Total estimado'}
          </dt>
          <dd className="font-bold text-[#527A36]">
            {formatCartCurrency(totalCents)}
          </dd>
        </div>
      </dl>
      {isPartial && (
        <p className="mt-4 text-sm leading-relaxed text-amber-800" role="status">
          Referências pendentes ou problemáticas não estão incluídas nestes valores.
        </p>
      )}
      <p className="mt-4 text-xs leading-relaxed text-gray-500">
        Valores exclusivamente fictícios. Nenhuma cobrança, entrega ou reserva de estoque é realizada.
      </p>
    </section>
  )
}
