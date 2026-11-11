import { ArrowLeft, CheckCircle2, RefreshCw, ShieldCheck } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { Link, useNavigate } from 'react-router'

import CartTotalsSummary from '../components/CartTotalsSummary'
import StoreRouteFrame from '../components/StoreRouteFrame'
import {
  type DemoCheckoutBlockedReason,
  type DemoCheckoutSummary,
  formatCartCurrency,
} from '../cart/cart-model'
import { useCart } from '../cart/useCart'

type CheckoutPageState =
  | { status: 'review' }
  | { status: 'review_required' }
  | { status: 'blocked'; reason: DemoCheckoutBlockedReason }
  | { status: 'confirmed'; summary: DemoCheckoutSummary }

const primaryButtonClass =
  'inline-flex min-h-11 items-center justify-center rounded-full bg-[#527A36] px-5 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-[#466B2D] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#527A36] focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:bg-gray-300 disabled:text-gray-700'
const secondaryLinkClass =
  'inline-flex min-h-11 items-center justify-center rounded-full border-2 border-[#527A36] px-5 py-2.5 text-sm font-semibold text-[#527A36] transition-colors hover:bg-[#527A36] hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#527A36] focus-visible:ring-offset-2'

const blockedMessages: Record<DemoCheckoutBlockedReason, string> = {
  hydrating: 'Aguarde a validação inicial do carrinho.',
  empty: 'O carrinho está vazio. Adicione um produto antes de confirmar.',
  busy: 'Existe uma atualização do carrinho em andamento. Aguarde e tente novamente.',
  problem_items: 'Há itens removidos, esgotados ou divergentes. Revise o carrinho.',
  validation_failed: 'Não foi possível validar todos os itens. Revise o carrinho e tente novamente.',
  cancelled: 'A confirmação foi cancelada porque o carrinho mudou.',
}

export default function CheckoutDemoPage() {
  const cart = useCart()
  const navigate = useNavigate()
  const confirmationHeadingRef = useRef<HTMLHeadingElement>(null)
  const [pageState, setPageState] = useState<CheckoutPageState>({ status: 'review' })
  const validating = cart.checkoutValidationStatus === 'validating'
  const canConfirm =
    cart.phase === 'ready' &&
    cart.totalUnits > 0 &&
    cart.issueCount === 0 &&
    !cart.isPartial &&
    !validating

  useEffect(() => {
    if (pageState.status === 'confirmed') confirmationHeadingRef.current?.focus()
  }, [pageState.status])

  async function confirmDemo() {
    setPageState({ status: 'review' })
    const result = await cart.confirmDemoCheckout()
    if (result.status === 'confirmed') {
      setPageState({ status: 'confirmed', summary: result.summary })
      return
    }
    if (result.status === 'review_required') {
      setPageState({ status: 'review_required' })
      return
    }
    setPageState({ status: 'blocked', reason: result.reason })
  }

  if (pageState.status === 'confirmed') {
    const { summary } = pageState
    return (
      <StoreRouteFrame>
        <section className="mx-auto max-w-3xl rounded-2xl border border-green-200 bg-white p-6 text-center shadow-sm sm:p-10">
          <CheckCircle2 aria-hidden="true" className="mx-auto text-[#527A36]" size={48} />
          <h1
            ref={confirmationHeadingRef}
            tabIndex={-1}
            className="mt-4 text-2xl font-semibold text-gray-900 outline-none sm:text-3xl"
          >
            Pedido demonstrativo gerado — nenhuma compra foi efetuada.
          </h1>
          <p className="mx-auto mt-4 max-w-xl text-sm leading-relaxed text-gray-600">
            A simulação continha {summary.totalUnits} {summary.totalUnits === 1 ? 'unidade' : 'unidades'} e total fictício de {formatCartCurrency(summary.totalCents)}. Nenhum pedido, pagamento ou entrega foi criado.
          </p>
          <button
            type="button"
            onClick={() => navigate('/')}
            className={`${primaryButtonClass} mt-7`}
          >
            Iniciar nova demonstração
          </button>
        </section>
      </StoreRouteFrame>
    )
  }

  return (
    <StoreRouteFrame>
      <div aria-busy={cart.phase === 'hydrating' || validating || undefined}>
        <p className="text-sm font-semibold uppercase tracking-wide text-[#527A36]">
          Revisão final fictícia
        </p>
        <h1 className="mt-1 text-2xl font-semibold text-gray-900 sm:text-3xl">
          Checkout demonstrativo
        </h1>
        <div className="mt-5 flex gap-3 rounded-xl border border-sky-200 bg-sky-50 p-4 text-sm leading-relaxed text-sky-950">
          <ShieldCheck aria-hidden="true" className="mt-0.5 flex-none" size={20} />
          <p>
            Nenhum dado pessoal ou de pagamento é solicitado. Esta página não cria compra, pedido, cobrança, entrega ou reserva de estoque.
          </p>
        </div>

        {pageState.status === 'review_required' && (
          <p role="alert" className="mt-5 rounded-xl border border-amber-300 bg-amber-50 p-4 text-sm font-medium leading-relaxed text-amber-900">
            Preço ou disponibilidade foram atualizados. Revise os novos valores e confirme novamente se desejar continuar a demonstração.
          </p>
        )}
        {pageState.status === 'blocked' && (
          <p role="alert" className="mt-5 rounded-xl border border-red-200 bg-red-50 p-4 text-sm font-medium leading-relaxed text-red-800">
            {blockedMessages[pageState.reason]}
          </p>
        )}

        {cart.phase === 'hydrating' ? (
          <section className="mt-6 rounded-2xl border border-gray-100 bg-white p-8 text-center shadow-sm" role="status">
            <RefreshCw aria-hidden="true" className="mx-auto animate-spin text-[#527A36]" size={30} />
            <p className="mt-4 font-medium text-gray-700">Validando o carrinho salvo…</p>
          </section>
        ) : cart.items.length === 0 ? (
          <section className="mt-6 rounded-2xl border border-gray-100 bg-white p-8 text-center shadow-sm">
            <h2 className="text-xl font-semibold text-gray-900">Nenhum item para revisar</h2>
            <p className="mt-2 text-sm leading-relaxed text-gray-600">
              O checkout não pode ser confirmado com o carrinho vazio.
            </p>
            <Link to="/" className={`${secondaryLinkClass} mt-6`}>
              <ArrowLeft aria-hidden="true" className="mr-2" size={16} />
              Voltar à vitrine
            </Link>
          </section>
        ) : (
          <div className="mt-6 grid min-w-0 gap-6 lg:grid-cols-[minmax(0,1fr)_22rem] lg:items-start">
            <section aria-labelledby="checkout-items-title" className="min-w-0 space-y-3">
              <h2 id="checkout-items-title" className="text-lg font-semibold text-gray-900">Produtos confirmados</h2>
              {cart.items.filter((item) => item.status === 'ready').map((item) => (
                <article key={item.productId} className="flex min-w-0 items-center gap-4 rounded-2xl border border-gray-100 bg-white p-4 shadow-sm">
                  <img src={item.product.imageUrl} alt={item.product.name} className="h-20 w-20 flex-none rounded-xl object-cover" />
                  <div className="min-w-0">
                    <h3 className="break-words font-semibold text-gray-900">{item.product.name}</h3>
                    <p className="mt-1 text-sm text-gray-600">{item.quantity} × {formatCartCurrency(item.product.unitPriceCents)}</p>
                  </div>
                </article>
              ))}
              {cart.issueCount > 0 && (
                <p className="rounded-xl border border-amber-300 bg-amber-50 p-4 text-sm leading-relaxed text-amber-900">
                  Existem {cart.issueCount} {cart.issueCount === 1 ? 'item que precisa' : 'itens que precisam'} de revisão no carrinho. Eles não estão incluídos nos valores.
                </p>
              )}
            </section>
            <aside className="space-y-4 lg:sticky lg:top-24">
              <CartTotalsSummary
                subtotalCents={cart.subtotalCents}
                shippingCents={cart.shippingCents}
                totalCents={cart.totalCents}
                isPartial={cart.isPartial}
              />
              <div className="rounded-2xl border border-gray-100 bg-white p-5 shadow-sm">
                <button
                  type="button"
                  disabled={!canConfirm}
                  onClick={() => void confirmDemo()}
                  className={`${primaryButtonClass} w-full`}
                >
                  {validating ? 'Revalidando catálogo…' : 'Confirmar demonstração'}
                </button>
                {!canConfirm && !validating && (
                  <p className="mt-3 text-sm leading-relaxed text-amber-800">
                    Corrija itens problemáticos ou aguarde atualizações antes de confirmar.
                  </p>
                )}
                <Link to="/carrinho" className={`${secondaryLinkClass} mt-3 w-full`}>
                  Voltar ao carrinho
                </Link>
              </div>
            </aside>
          </div>
        )}
      </div>
    </StoreRouteFrame>
  )
}
