import {
  ArrowLeft,
  Minus,
  Plus,
  RefreshCw,
  ShoppingCart,
  Trash2,
} from 'lucide-react'
import { useRef, useState } from 'react'
import { Link } from 'react-router'

import StoreRouteFrame from '../components/StoreRouteFrame'
import CartTotalsSummary from '../components/CartTotalsSummary'
import {
  CART_MAX_QUANTITY_PER_PRODUCT,
  calculateCartLineSubtotalCents,
  formatCartCurrency,
  formatCartOperationFeedback,
  formatCartProblemReason,
} from '../cart/cart-model'
import { useCart } from '../cart/useCart'

const primaryLinkClass =
  'inline-flex min-h-11 items-center justify-center rounded-full bg-[#527A36] px-5 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-[#466B2D] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#527A36] focus-visible:ring-offset-2'
const secondaryButtonClass =
  'inline-flex min-h-11 items-center justify-center rounded-full border-2 border-[#527A36] px-5 py-2.5 text-sm font-semibold text-[#527A36] transition-colors hover:bg-[#527A36] hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#527A36] focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:border-gray-300 disabled:bg-gray-100 disabled:text-gray-600'

export default function CartPage() {
  const cart = useCart()
  const headingRef = useRef<HTMLHeadingElement>(null)
  const [feedback, setFeedback] = useState('')
  const [feedbackIsError, setFeedbackIsError] = useState(false)
  const controlsLocked =
    cart.phase === 'hydrating' ||
    cart.checkoutValidationStatus === 'validating'
  const checkoutEligible =
    cart.phase === 'ready' &&
    cart.totalUnits > 0 &&
    cart.issueCount === 0 &&
    !cart.isPartial &&
    cart.checkoutValidationStatus === 'idle'

  function announce(message: string, isError = false) {
    setFeedback(message)
    setFeedbackIsError(isError)
  }

  async function updateQuantity(productId: number, quantity: number, name: string) {
    announce(`Validando a nova quantidade de ${name}.`)
    const result = await cart.setQuantity(productId, quantity)
    if (result.status === 'success') {
      announce(
        `Quantidade de ${name} atualizada para ${result.quantity}.${
          result.priceChanged ? ' O preço atual do catálogo foi aplicado.' : ''
        }`,
      )
      return
    }
    announce(formatCartOperationFeedback(result, name), true)
  }

  async function retryProduct(productId: number, name: string) {
    announce(`Validando novamente ${name}.`)
    const result = await cart.retryValidation(productId)
    if (result.status === 'success') {
      announce(`${name} foi confirmado novamente no catálogo atual.`)
      return
    }
    announce(formatCartOperationFeedback(result, name), true)
  }

  function removeProduct(productId: number, name: string) {
    cart.removeProduct(productId)
    announce(`${name} foi removido do carrinho demonstrativo.`)
    window.requestAnimationFrame(() => headingRef.current?.focus())
  }

  function clearCart() {
    cart.clearCart()
    announce('O carrinho demonstrativo foi limpo.')
    window.requestAnimationFrame(() => headingRef.current?.focus())
  }

  return (
    <StoreRouteFrame>
      <div aria-busy={cart.phase === 'hydrating' || undefined}>
        <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="text-sm font-semibold uppercase tracking-wide text-[#527A36]">
              Demonstração sem compra real
            </p>
            <h1
              ref={headingRef}
              tabIndex={-1}
              className="mt-1 text-2xl font-semibold text-gray-900 outline-none sm:text-3xl"
            >
              Carrinho demonstrativo
            </h1>
          </div>
          {cart.phase === 'ready' && cart.items.length > 0 && (
            <button
              type="button"
              onClick={clearCart}
              className={secondaryButtonClass}
            >
              <Trash2 aria-hidden="true" className="mr-2" size={16} />
              Limpar carrinho
            </button>
          )}
        </div>

        <p
          role={feedbackIsError ? 'alert' : 'status'}
          aria-live="polite"
          className={`mb-5 min-h-6 text-sm font-medium ${
            feedbackIsError ? 'text-red-700' : 'text-[#527A36]'
          }`}
        >
          {feedback}
        </p>

        {cart.persistenceStatus === 'unavailable' && (
          <p className="mb-5 rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm leading-relaxed text-amber-900">
            O carrinho funciona nesta aba, mas não pôde ser salvo para o próximo acesso.
          </p>
        )}

        {cart.phase === 'hydrating' ? (
          <section className="rounded-2xl border border-gray-100 bg-white p-8 text-center shadow-sm" role="status">
            <RefreshCw aria-hidden="true" className="mx-auto animate-spin text-[#527A36]" size={30} />
            <p className="mt-4 font-medium text-gray-700">
              Validando os itens salvos no catálogo atual…
            </p>
          </section>
        ) : cart.items.length === 0 ? (
          <section className="rounded-2xl border border-gray-100 bg-white p-8 text-center shadow-sm sm:p-12">
            <ShoppingCart aria-hidden="true" className="mx-auto text-gray-400" size={42} />
            <h2 className="mt-4 text-xl font-semibold text-gray-900">
              Seu carrinho está vazio
            </h2>
            <p className="mx-auto mt-2 max-w-lg text-sm leading-relaxed text-gray-600">
              Escolha produtos da vitrine, da página de detalhes ou das recomendações do chat.
            </p>
            <Link to="/" className={`${primaryLinkClass} mt-6`}>
              <ArrowLeft aria-hidden="true" className="mr-2" size={16} />
              Continuar comprando
            </Link>
          </section>
        ) : (
          <div className="grid min-w-0 gap-6 lg:grid-cols-[minmax(0,1fr)_22rem] lg:items-start">
            <section aria-labelledby="cart-items-title" className="min-w-0 space-y-4">
              <h2 id="cart-items-title" className="sr-only">Itens do carrinho</h2>
              {cart.items.map((item) => {
                const pending = cart.isProductPending(item.productId)
                if (item.status === 'problem') {
                  const name = item.product?.name ?? `Produto ${item.productId}`
                  return (
                    <article
                      key={item.productId}
                      aria-busy={pending || undefined}
                      className="min-w-0 rounded-2xl border border-amber-300 bg-amber-50 p-5 shadow-sm"
                    >
                      <p className="text-xs font-semibold uppercase tracking-wide text-amber-900">
                        Item fora dos valores confirmados
                      </p>
                      <h3 className="mt-1 break-words text-base font-semibold text-gray-900">{name}</h3>
                      <p className="mt-2 text-sm leading-relaxed text-amber-900">
                        {formatCartProblemReason(item.reason)}
                      </p>
                      <p className="mt-1 text-sm text-gray-700">Quantidade registrada: {item.quantity}</p>
                      <div className="mt-4 flex flex-col gap-2 sm:flex-row">
                        <button
                          type="button"
                          disabled={controlsLocked || pending}
                          onClick={() => void retryProduct(item.productId, name)}
                          className={secondaryButtonClass}
                        >
                          <RefreshCw aria-hidden="true" className="mr-2" size={16} />
                          {pending ? 'Validando…' : 'Tentar validar novamente'}
                        </button>
                        <button
                          type="button"
                          disabled={controlsLocked}
                          onClick={() => removeProduct(item.productId, name)}
                          className={secondaryButtonClass}
                          aria-label={`Remover ${name} do carrinho`}
                        >
                          <Trash2 aria-hidden="true" className="mr-2" size={16} />
                          Remover
                        </button>
                      </div>
                    </article>
                  )
                }

                const { product } = item
                const maximumQuantity = Math.min(
                  product.stock,
                  CART_MAX_QUANTITY_PER_PRODUCT,
                )
                return (
                  <article
                    key={item.productId}
                    aria-busy={pending || undefined}
                    className="grid min-w-0 gap-4 rounded-2xl border border-gray-100 bg-white p-4 shadow-sm sm:grid-cols-[7rem_minmax(0,1fr)]"
                  >
                    <Link
                      to={`/produtos/${item.slug}`}
                      state={{ catalogReturnTo: '/carrinho' }}
                      className="block aspect-square overflow-hidden rounded-xl bg-gray-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#527A36] focus-visible:ring-offset-2"
                      aria-label={`Ver detalhes de ${product.name}`}
                    >
                      <img src={product.imageUrl} alt={product.name} className="h-full w-full object-cover" />
                    </Link>
                    <div className="min-w-0">
                      <Link
                        to={`/produtos/${item.slug}`}
                        state={{ catalogReturnTo: '/carrinho' }}
                        className="break-words font-semibold text-gray-900 hover:text-[#527A36] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#527A36]"
                      >
                        {product.name}
                      </Link>
                      <p className="mt-1 text-sm text-gray-600">
                        Preço unitário: {formatCartCurrency(product.unitPriceCents)}
                      </p>
                      <p className="mt-1 text-sm font-semibold text-gray-900">
                        Subtotal do item: {formatCartCurrency(
                          calculateCartLineSubtotalCents(product.unitPriceCents, item.quantity),
                        )}
                      </p>
                      <div className="mt-4 flex flex-wrap items-center gap-2">
                        <button
                          type="button"
                          disabled={controlsLocked || pending || item.quantity <= 1}
                          onClick={() => void updateQuantity(item.productId, item.quantity - 1, product.name)}
                          className="flex min-h-11 min-w-11 items-center justify-center rounded-full border border-gray-300 text-gray-700 hover:border-[#527A36] hover:text-[#527A36] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#527A36] disabled:cursor-not-allowed disabled:opacity-40"
                          aria-label={`Diminuir quantidade de ${product.name}`}
                        >
                          <Minus aria-hidden="true" size={16} />
                        </button>
                        <span className="min-w-10 text-center font-semibold" aria-label={`Quantidade atual: ${item.quantity}`}>
                          {item.quantity}
                        </span>
                        <button
                          type="button"
                          disabled={controlsLocked || pending || item.quantity >= maximumQuantity}
                          onClick={() => void updateQuantity(item.productId, item.quantity + 1, product.name)}
                          className="flex min-h-11 min-w-11 items-center justify-center rounded-full border border-gray-300 text-gray-700 hover:border-[#527A36] hover:text-[#527A36] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#527A36] disabled:cursor-not-allowed disabled:opacity-40"
                          aria-label={`Aumentar quantidade de ${product.name}`}
                        >
                          <Plus aria-hidden="true" size={16} />
                        </button>
                        <button
                          type="button"
                          disabled={controlsLocked}
                          onClick={() => removeProduct(item.productId, product.name)}
                          className="ml-auto inline-flex min-h-11 items-center rounded-full px-3 text-sm font-semibold text-red-700 hover:bg-red-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-700 disabled:cursor-not-allowed disabled:opacity-40"
                          aria-label={`Remover ${product.name} do carrinho`}
                        >
                          <Trash2 aria-hidden="true" className="mr-2" size={16} />
                          Remover
                        </button>
                      </div>
                    </div>
                  </article>
                )
              })}
            </section>

            <aside className="space-y-4 lg:sticky lg:top-24">
              <CartTotalsSummary
                subtotalCents={cart.subtotalCents}
                shippingCents={cart.shippingCents}
                totalCents={cart.totalCents}
                isPartial={cart.isPartial}
              />
              <div className="rounded-2xl border border-gray-100 bg-white p-5 shadow-sm">
                {checkoutEligible ? (
                  <Link to="/checkout-demo" className={`${primaryLinkClass} w-full`}>
                    Revisar checkout demonstrativo
                  </Link>
                ) : (
                  <button type="button" disabled className={`${secondaryButtonClass} w-full`} aria-describedby="checkout-disabled-reason">
                    Revisar checkout demonstrativo
                  </button>
                )}
                {!checkoutEligible && (
                  <p id="checkout-disabled-reason" className="mt-3 text-sm leading-relaxed text-amber-800">
                    Resolva validações pendentes ou itens problemáticos antes de avançar.
                  </p>
                )}
                <Link to="/" className={`${secondaryButtonClass} mt-3 w-full`}>
                  Continuar comprando
                </Link>
              </div>
            </aside>
          </div>
        )}
      </div>
    </StoreRouteFrame>
  )
}
