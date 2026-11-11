import { ImageOff } from 'lucide-react'
import { useEffect, useState } from 'react'
import { Link, useLocation } from 'react-router'

import {
  ApiRequestError,
  getProductBySlug,
  resolveCatalogImageUrl,
} from '../api/client'
import type {
  ChatComparisonResponse,
  ChatProductCard,
  ChatRecommendationResponse,
} from '../api/chat-contracts'
import type { ProductDetailResponse } from '../api/contracts'
import { getSafeCatalogReturnTo } from '../utils/catalog-navigation'

export const CHAT_PRODUCT_REFRESH_TIMEOUT_MS = 5_000

type ChatProductResponse =
  | ChatRecommendationResponse
  | ChatComparisonResponse

interface ChatProductCardsProps {
  response: ChatProductResponse
  restored: boolean
}

interface DisplayProduct {
  id: number
  slug: string
  name: string
  brand: string
  shortDescription: string
  price: number
  originalPrice?: number
  stock: number
  imageUrl?: string
}

type ProductState =
  | { status: 'fresh'; product: DisplayProduct }
  | { status: 'refreshing'; product: DisplayProduct }
  | { status: 'current'; product: DisplayProduct; commercialDataChanged: boolean }
  | { status: 'removed'; product: DisplayProduct }
  | {
      status: 'failed'
      product: DisplayProduct
      reason: 'timeout' | 'temporary'
    }

const priceFormatter = new Intl.NumberFormat('pt-BR', {
  style: 'currency',
  currency: 'BRL',
})

function safelyResolveImageUrl(path: string) {
  try {
    return resolveCatalogImageUrl(path)
  } catch {
    return undefined
  }
}

function fromSnapshot(snapshot: ChatProductCard): DisplayProduct {
  return {
    id: snapshot.id,
    slug: snapshot.slug,
    name: snapshot.name,
    brand: snapshot.brand,
    shortDescription: snapshot.shortDescription,
    price: snapshot.price,
    ...(snapshot.originalPrice === undefined
      ? {}
      : { originalPrice: snapshot.originalPrice }),
    stock: snapshot.stock,
    imageUrl: safelyResolveImageUrl(snapshot.imageUrl),
  }
}

function fromCanonical(response: ProductDetailResponse): DisplayProduct {
  const { item, media } = response
  return {
    id: item.id,
    slug: item.slug,
    name: item.name,
    brand: item.brand,
    shortDescription: item.shortDescription,
    price: item.price,
    ...(item.originalPrice === undefined
      ? {}
      : { originalPrice: item.originalPrice }),
    stock: item.stock,
    imageUrl: safelyResolveImageUrl(media.primaryUrl),
  }
}

function isRemovedError(error: unknown) {
  return (
    error instanceof ApiRequestError &&
    (error.status === 404 || error.code === 'NOT_FOUND')
  )
}

export default function ChatProductCards({
  response,
  restored,
}: ChatProductCardsProps) {
  const title =
    response.type === 'comparison'
      ? 'Produtos comparados'
      : 'Produto recomendado'

  return (
    <section
      aria-label={title}
      className="ml-8 min-w-0 max-w-[calc(100%_-_2rem)]"
      data-testid="chat-product-cards"
    >
      <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-600">
        {title}
      </h3>
      <div className="grid min-w-0 grid-cols-1 gap-3">
        {response.products.map((product, index) =>
          response.productIds[index] === product.id ? (
            <ChatProductCardItem
              key={`${product.id}:${product.slug}`}
              snapshot={product}
              restored={restored}
            />
          ) : null,
        )}
      </div>
      <p className="mt-2 text-[11px] leading-relaxed text-gray-500">
        Carrinho e checkout demonstrativos serão habilitados nas próximas
        etapas. Nenhuma compra é realizada por estes cartões.
      </p>
    </section>
  )
}

function ChatProductCardItem({
  snapshot,
  restored,
}: {
  snapshot: ChatProductCard
  restored: boolean
}) {
  const location = useLocation()
  const snapshotProduct = fromSnapshot(snapshot)
  const [state, setState] = useState<ProductState>(() =>
    restored
      ? { status: 'refreshing', product: snapshotProduct }
      : { status: 'fresh', product: snapshotProduct },
  )
  const [imageUnavailable, setImageUnavailable] = useState(
    snapshotProduct.imageUrl === undefined,
  )

  useEffect(() => {
    const historicalProduct = fromSnapshot(snapshot)
    if (!restored) {
      setState({ status: 'fresh', product: historicalProduct })
      return
    }

    let acceptingResult = true
    const controller = new AbortController()
    const timeoutId = window.setTimeout(() => {
      if (!acceptingResult) return
      acceptingResult = false
      controller.abort()
      setState({
        status: 'failed',
        product: historicalProduct,
        reason: 'timeout',
      })
    }, CHAT_PRODUCT_REFRESH_TIMEOUT_MS)

    setState({ status: 'refreshing', product: historicalProduct })
    void getProductBySlug(snapshot.slug, controller.signal)
      .then((response) => {
        if (!acceptingResult) return
        acceptingResult = false
        if (
          response.item.id !== snapshot.id ||
          response.item.slug !== snapshot.slug
        ) {
          setState({ status: 'removed', product: historicalProduct })
          return
        }

        setState({
          status: 'current',
          product: fromCanonical(response),
          commercialDataChanged:
            response.item.price !== snapshot.price ||
            response.item.stock !== snapshot.stock,
        })
      })
      .catch((error: unknown) => {
        if (!acceptingResult) return
        acceptingResult = false
        setState(
          isRemovedError(error)
            ? { status: 'removed', product: historicalProduct }
            : {
                status: 'failed',
                product: historicalProduct,
                reason: 'temporary',
              },
        )
      })
      .finally(() => window.clearTimeout(timeoutId))

    return () => {
      acceptingResult = false
      window.clearTimeout(timeoutId)
      controller.abort()
    }
  }, [restored, snapshot])

  const product = state.product
  const isHistorical =
    state.status === 'refreshing' || state.status === 'failed'
  const catalogReturnTo = getSafeCatalogReturnTo(
    `${location.pathname}${location.search}`,
  )

  useEffect(() => {
    setImageUnavailable(product.imageUrl === undefined)
  }, [product.imageUrl])

  return (
    <article
      aria-busy={state.status === 'refreshing'}
      className="min-w-0 max-w-full overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm"
      data-product-id={product.id}
    >
      <div className="aspect-[4/3] w-full overflow-hidden bg-gray-100">
        {imageUnavailable || !product.imageUrl ? (
          <div className="flex h-full flex-col items-center justify-center gap-2 text-gray-600">
            <ImageOff aria-hidden="true" size={26} strokeWidth={1.5} />
            <span className="text-xs font-medium">Imagem indisponível</span>
          </div>
        ) : (
          <img
            src={product.imageUrl}
            alt={product.name}
            className="h-full w-full object-cover"
            loading="lazy"
            onError={() => setImageUnavailable(true)}
          />
        )}
      </div>

      <div className="min-w-0 p-3">
        <p className="text-[10px] font-semibold uppercase tracking-wide text-[#527A36]">
          Catálogo demonstrativo
        </p>
        <p className="mt-1 text-xs font-medium text-gray-500">
          {product.brand}
        </p>
        <h4 className="mt-0.5 break-words text-sm font-semibold leading-snug text-gray-900">
          {product.name}
        </h4>
        <p className="mt-1 text-xs leading-relaxed text-gray-600 line-clamp-2">
          {product.shortDescription}
        </p>

        <CardDataStatus state={state} />

        {state.status !== 'removed' && (
          <div className="mt-3">
            {product.originalPrice !== undefined && (
              <p className="text-[11px] text-gray-500 line-through">
                {priceFormatter.format(product.originalPrice)}
              </p>
            )}
            <p className="text-lg font-bold text-gray-900">
              {priceFormatter.format(product.price)}
            </p>
            <p
              className={`text-xs font-medium ${
                isHistorical
                  ? 'text-amber-800'
                  : product.stock > 0
                    ? 'text-[#527A36]'
                    : 'text-red-700'
              }`}
            >
              {isHistorical
                ? `Estoque registrado: ${product.stock} unidades demonstrativas`
                : product.stock > 0
                  ? `Em estoque — ${product.stock} unidades demonstrativas`
                  : 'Esgotado no catálogo demonstrativo'}
            </p>
          </div>
        )}

        {state.status !== 'removed' && (
          <Link
            to={`/produtos/${product.slug}`}
            state={{ catalogReturnTo }}
            className="mt-3 inline-flex min-h-11 w-full items-center justify-center rounded-full bg-[#527A36] px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-[#466B2D] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#527A36] focus-visible:ring-offset-2"
            aria-label={`Ver detalhes de ${product.name}`}
          >
            Detalhes
          </Link>
        )}
      </div>
    </article>
  )
}

function CardDataStatus({ state }: { state: ProductState }) {
  if (state.status === 'fresh') {
    return (
      <p className="mt-2 text-[11px] font-medium text-sky-800">
        Dados validados da resposta do catálogo
      </p>
    )
  }
  if (state.status === 'refreshing') {
    return (
      <p className="mt-2 text-[11px] font-medium text-amber-800" role="status">
        Snapshot histórico — verificando dados atuais
      </p>
    )
  }
  if (state.status === 'current') {
    return (
      <div className="mt-2 text-[11px] font-medium text-sky-800" role="status">
        <p>Dados atuais confirmados no catálogo</p>
        {state.commercialDataChanged && (
          <p className="mt-1 text-amber-800">
            Preço ou disponibilidade foram atualizados desde a conversa.
          </p>
        )}
      </div>
    )
  }
  if (state.status === 'removed') {
    return (
      <p className="mt-2 text-xs font-semibold text-red-700" role="status">
        Produto indisponível no catálogo atual. Nenhuma ação foi habilitada.
      </p>
    )
  }
  return (
    <p className="mt-2 text-[11px] font-medium text-amber-800" role="status">
      {state.reason === 'timeout'
        ? 'Snapshot histórico — a atualização excedeu o tempo limite.'
        : 'Snapshot histórico — não foi possível confirmar os dados atuais.'}
    </p>
  )
}
