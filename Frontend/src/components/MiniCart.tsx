import { ImageOff, ShoppingCart, Trash2, X } from 'lucide-react'
import {
  type RefObject,
  useEffect,
  useId,
  useRef,
  useState,
} from 'react'
import { Link, useLocation } from 'react-router'

import { formatCartCurrency } from '../cart/cart-model'
import { useCart } from '../cart/useCart'

const focusableElementSelector = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(',')

function getFocusableElements(container: HTMLElement) {
  return Array.from(
    container.querySelectorAll<HTMLElement>(focusableElementSelector),
  ).filter(
    (element) =>
      !element.hasAttribute('hidden') &&
      element.getAttribute('aria-hidden') !== 'true',
  )
}

interface MiniCartProps {
  open: boolean
  triggerRef: RefObject<HTMLButtonElement>
  onClose(restoreFocus?: boolean): void
}

export default function MiniCart({
  open,
  triggerRef,
  onClose,
}: MiniCartProps) {
  const {
    phase,
    items,
    totalUnits,
    subtotalCents,
    shippingCents,
    totalCents,
    isPartial,
    issueCount,
    checkoutValidationStatus,
    removeProduct,
  } = useCart()
  const location = useLocation()
  const dialogRef = useRef<HTMLElement>(null)
  const closeButtonRef = useRef<HTMLButtonElement>(null)
  const titleId = useId()
  const descriptionId = useId()
  const previousLocationRef = useRef(
    `${location.pathname}${location.search}${location.hash}`,
  )

  const readyItems = items.filter((item) => item.status === 'ready')
  const canCheckout =
    phase === 'ready' &&
    totalUnits > 0 &&
    issueCount === 0 &&
    !isPartial &&
    checkoutValidationStatus === 'idle'

  useEffect(() => {
    const currentLocation = `${location.pathname}${location.search}${location.hash}`
    if (previousLocationRef.current !== currentLocation) {
      previousLocationRef.current = currentLocation
      if (open) onClose(false)
    }
  }, [location.hash, location.pathname, location.search, onClose, open])

  useEffect(() => {
    if (!open) return
    closeButtonRef.current?.focus()

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault()
        onClose()
        return
      }
      if (event.key !== 'Tab' || !dialogRef.current) return

      const focusableElements = getFocusableElements(dialogRef.current)
      if (focusableElements.length === 0) {
        event.preventDefault()
        dialogRef.current.focus()
        return
      }

      const firstElement = focusableElements[0]
      const lastElement = focusableElements[focusableElements.length - 1]
      const activeElement = document.activeElement
      const focusIsOutsideDialog =
        !(activeElement instanceof Node) ||
        !dialogRef.current.contains(activeElement)

      if (event.shiftKey && (activeElement === firstElement || focusIsOutsideDialog)) {
        event.preventDefault()
        lastElement.focus()
      } else if (
        !event.shiftKey &&
        (activeElement === lastElement || focusIsOutsideDialog)
      ) {
        event.preventDefault()
        firstElement.focus()
      }
    }
    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target
      if (!(target instanceof Node)) return
      if (
        dialogRef.current?.contains(target) ||
        triggerRef.current?.contains(target)
      ) {
        return
      }
      onClose()
    }

    document.addEventListener('keydown', handleKeyDown)
    document.addEventListener('pointerdown', handlePointerDown)
    return () => {
      document.removeEventListener('keydown', handleKeyDown)
      document.removeEventListener('pointerdown', handlePointerDown)
    }
  }, [onClose, open, triggerRef])

  if (!open) return null

  return (
    <>
      <div
        aria-hidden="true"
        className="fixed inset-0 z-[60] bg-gray-950/30 sm:bg-transparent"
      />
      <section
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={descriptionId}
        tabIndex={-1}
        className="fixed inset-x-3 bottom-3 z-[70] flex max-h-[calc(100dvh-1.5rem)] flex-col overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-2xl sm:absolute sm:inset-x-auto sm:bottom-auto sm:right-0 sm:top-[calc(100%+0.5rem)] sm:w-[24rem] sm:max-w-[calc(100vw-2rem)] sm:max-h-[min(34rem,calc(100dvh-5rem))]"
      >
        <div className="flex flex-shrink-0 items-start justify-between gap-3 border-b border-gray-200 px-4 py-3">
          <div>
            <h2 id={titleId} className="text-base font-semibold text-gray-900">
              Seu carrinho
            </h2>
            <p id={descriptionId} className="mt-0.5 text-xs text-gray-600">
              Resumo demonstrativo. Revise tudo na página completa.
            </p>
          </div>
          <button
            ref={closeButtonRef}
            type="button"
            onClick={() => onClose()}
            className="flex min-h-11 min-w-11 flex-shrink-0 items-center justify-center rounded-full text-gray-600 transition-colors hover:bg-gray-100 hover:text-gray-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#527A36]"
            aria-label="Fechar resumo do carrinho"
          >
            <X aria-hidden="true" size={20} />
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 py-3">
          {phase === 'hydrating' && (
            <p className="rounded-xl bg-sky-50 p-3 text-sm text-sky-900" role="status">
              Validando os itens salvos antes de calcular o resumo.
            </p>
          )}

          {phase === 'ready' && readyItems.length === 0 && issueCount === 0 && (
            <div className="py-6 text-center">
              <ShoppingCart
                aria-hidden="true"
                className="mx-auto text-gray-400"
                size={30}
                strokeWidth={1.5}
              />
              <p className="mt-3 font-semibold text-gray-900">
                Seu carrinho está vazio
              </p>
              <p className="mt-1 text-sm text-gray-600">
                Adicione produtos para ver o resumo aqui.
              </p>
            </div>
          )}

          {readyItems.length > 0 && (
            <ul className="space-y-3" aria-label="Itens confirmados do carrinho">
              {readyItems.map((item) => (
                <li
                  key={`${item.productId}:${item.slug}`}
                  className="flex min-w-0 gap-3 rounded-xl border border-gray-200 p-3"
                >
                  <MiniCartItemImage
                    productId={item.productId}
                    name={item.product.name}
                    imageUrl={item.product.imageUrl}
                  />
                  <div className="min-w-0 flex-1">
                    <p className="break-words text-sm font-semibold leading-snug text-gray-900">
                      {item.product.name}
                    </p>
                    <p className="mt-1 text-xs text-gray-600">
                      {item.quantity} {item.quantity === 1 ? 'unidade' : 'unidades'}
                    </p>
                    <p className="mt-1 text-sm font-semibold text-[#527A36]">
                      {formatCartCurrency(item.product.unitPriceCents * item.quantity)}
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={(event) => {
                      if (document.activeElement === event.currentTarget) {
                        closeButtonRef.current?.focus()
                      }
                      removeProduct(item.productId)
                    }}
                    className="flex min-h-11 min-w-11 flex-shrink-0 items-center justify-center self-center rounded-full text-gray-500 transition-colors hover:bg-red-50 hover:text-red-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-700"
                    aria-label={`Remover ${item.product.name} do carrinho`}
                  >
                    <Trash2 aria-hidden="true" size={17} />
                  </button>
                </li>
              ))}
            </ul>
          )}

          {issueCount > 0 && (
            <div className="mt-3 rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-950" role="status">
              <p className="font-semibold">
                {issueCount} {issueCount === 1 ? 'item precisa' : 'itens precisam'} de revisão
              </p>
              <p className="mt-1 text-xs leading-relaxed">
                Itens não confirmados não entram nos valores abaixo. Abra o carrinho para revisar ou remover as referências.
              </p>
            </div>
          )}
        </div>

        <div className="flex-shrink-0 border-t border-gray-200 bg-gray-50 px-4 py-3">
          <dl className="space-y-2 text-sm">
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
            <div className="flex items-center justify-between gap-4 border-t border-gray-200 pt-2">
              <dt className="font-semibold text-gray-900">
                {isPartial ? 'Total parcial' : 'Total demonstrativo'}
              </dt>
              <dd className="text-base font-bold text-[#527A36]">
                {formatCartCurrency(totalCents)}
              </dd>
            </div>
          </dl>

          <div className="mt-3 grid gap-2 sm:grid-cols-2">
            <Link
              to="/carrinho"
              onClick={() => onClose(false)}
              className="inline-flex min-h-11 items-center justify-center rounded-full border-2 border-[#527A36] px-3 py-2 text-center text-sm font-semibold text-[#527A36] transition-colors hover:bg-[#527A36] hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#527A36] focus-visible:ring-offset-2"
            >
              Ir para o carrinho
            </Link>
            {canCheckout ? (
              <Link
                to="/checkout-demo"
                onClick={() => onClose(false)}
                className="inline-flex min-h-11 items-center justify-center rounded-full bg-[#527A36] px-3 py-2 text-center text-sm font-semibold text-white transition-colors hover:bg-[#466B2D] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#527A36] focus-visible:ring-offset-2"
              >
                Finalizar compra
              </Link>
            ) : (
              <button
                type="button"
                disabled
                className="inline-flex min-h-11 cursor-not-allowed items-center justify-center rounded-full bg-gray-200 px-3 py-2 text-center text-sm font-semibold text-gray-600"
              >
                Finalizar compra
              </button>
            )}
          </div>
          <p className="mt-2 text-[11px] leading-relaxed text-gray-500">
            Nenhuma cobrança, entrega ou reserva de estoque é realizada nesta demonstração.
          </p>
        </div>
      </section>
    </>
  )
}

function MiniCartItemImage({
  productId,
  name,
  imageUrl,
}: {
  productId: number
  name: string
  imageUrl: string
}) {
  const [imageFailed, setImageFailed] = useState(!imageUrl)

  useEffect(() => {
    setImageFailed(!imageUrl)
  }, [imageUrl, productId])

  return (
    <div className="flex h-16 w-14 flex-shrink-0 items-center justify-center overflow-hidden rounded-lg bg-gray-50 p-1">
      {imageFailed || !imageUrl ? (
        <div
          role="img"
          aria-label={`Imagem indisponível para ${name}`}
          className="flex h-full w-full items-center justify-center"
        >
          <ImageOff aria-hidden="true" className="text-gray-400" size={22} />
        </div>
      ) : (
        <img
          src={imageUrl}
          alt=""
          className="h-full w-full object-contain"
          onError={() => setImageFailed(true)}
        />
      )}
    </div>
  )
}
