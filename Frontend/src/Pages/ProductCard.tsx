import { ImageOff, Star } from 'lucide-react'
import { useEffect, useState } from 'react'
import { Link } from 'react-router'

import type { CatalogProductSummary } from '../api/contracts'

interface ProductCardProps {
  product: CatalogProductSummary
}

const priceFormatter = new Intl.NumberFormat('pt-BR', {
  style: 'currency',
  currency: 'BRL',
})

export default function ProductCard({ product }: ProductCardProps) {
  const [imageUnavailable, setImageUnavailable] = useState(false)
  const discount = product.originalPrice
    ? Math.round((1 - product.price / product.originalPrice) * 100)
    : undefined

  useEffect(() => {
    setImageUnavailable(false)
  }, [product.imageUrl])

  return (
    <article className="h-full overflow-hidden rounded-2xl border border-gray-100 bg-white shadow-sm transition-all duration-300 hover:border-[#8BB964]/40 hover:shadow-lg">
      <Link
        to={`/produtos/${product.slug}`}
        className="group flex h-full flex-col rounded-2xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#8BB964] focus-visible:ring-offset-2"
        aria-label={`Ver produto ${product.name}`}
      >
        <div className="relative aspect-square overflow-hidden bg-gray-50">
          {discount !== undefined && discount > 0 && (
            <span className="absolute left-3 top-3 z-10 rounded-full bg-[#8BB964] px-2 py-0.5 text-xs font-semibold text-white shadow">
              -{discount}%
            </span>
          )}

          {imageUnavailable ? (
            <div className="flex h-full w-full flex-col items-center justify-center gap-2 bg-gray-100 text-gray-400">
              <ImageOff aria-hidden="true" size={30} strokeWidth={1.5} />
              <span className="text-xs font-medium">Imagem indisponível</span>
            </div>
          ) : (
            <img
              src={product.imageUrl}
              alt={product.name}
              className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-105"
              loading="lazy"
              onError={() => setImageUnavailable(true)}
            />
          )}

          <span className="absolute inset-x-0 bottom-0 flex translate-y-full items-center justify-center bg-[#8BB964] py-2.5 text-sm font-semibold text-white transition-transform duration-300 group-hover:translate-y-0 group-focus-visible:translate-y-0">
            Ver produto
          </span>
        </div>

        <div className="flex flex-1 flex-col p-4">
          {product.rating !== undefined && product.reviews !== undefined && (
            <div
              className="mb-2 flex items-center gap-1"
              aria-label={`Avaliação ${product.rating} de 5, ${product.reviews} avaliações`}
            >
              {Array.from({ length: 5 }).map((_, index) => (
                <Star
                  key={index}
                  size={12}
                  aria-hidden="true"
                  className={
                    index < Math.floor(product.rating ?? 0)
                      ? 'fill-amber-400 text-amber-400'
                      : 'fill-gray-200 text-gray-200'
                  }
                />
              ))}
              <span className="ml-1 text-xs text-gray-400">
                ({product.reviews})
              </span>
            </div>
          )}

          <h2 className="mb-1 min-h-10 text-sm font-semibold leading-snug text-gray-800 transition-colors line-clamp-2 group-hover:text-[#8BB964]">
            {product.name}
          </h2>
          <p className="mb-3 min-h-10 flex-1 text-xs leading-relaxed text-gray-500 line-clamp-2">
            {product.shortDescription}
          </p>

          <div className="mt-auto">
            {product.originalPrice !== undefined && (
              <p className="text-xs text-gray-400 line-through">
                {priceFormatter.format(product.originalPrice)}
              </p>
            )}
            <p className="text-lg font-bold text-gray-900">
              {priceFormatter.format(product.price)}
            </p>
            <p
              className={`mt-0.5 text-xs font-medium ${
                product.stock > 0 ? 'text-[#6f994c]' : 'text-gray-500'
              }`}
            >
              {product.stock > 0 ? 'Em estoque' : 'Esgotado'}
            </p>
          </div>
        </div>
      </Link>
    </article>
  )
}
