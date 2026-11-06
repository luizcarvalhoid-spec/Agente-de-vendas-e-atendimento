import { ShoppingCart, Star } from 'lucide-react'

export interface Product {
  id: number
  name: string
  shortDescription: string
  image: string
  originalPrice?: number
  price: number
  installments: number
  installmentValue: number
  discount?: number
  rating: number
  reviews: number
}

interface ProductCardProps {
  product: Product
}

export default function ProductCard({ product }: ProductCardProps) {
  const formatPrice = (value: number) =>
    value.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })

  return (
    <article className="bg-white rounded-2xl overflow-hidden shadow-sm hover:shadow-lg transition-all duration-300 group flex flex-col cursor-pointer border border-gray-100 hover:border-[#8BB964]/40">
      
      {/* Image Container */}
      <div className="relative overflow-hidden bg-gray-50 aspect-square">
        {product.discount && (
          <span className="absolute top-3 left-3 z-10 bg-[#8BB964] text-white text-xs font-semibold px-2 py-0.5 rounded-full shadow">
            -{product.discount}%
          </span>
        )}
        <img
          src={product.image}
          alt={product.name}
          className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500"
          loading="lazy"
        />

        {/* Quick Add Overlay */}
        <button
          className="absolute bottom-0 left-0 right-0 bg-[#8BB964] text-white text-sm font-semibold py-2.5 translate-y-full group-hover:translate-y-0 transition-transform duration-300 flex items-center justify-center gap-2 hover:bg-[#7aa854]"
          aria-label={`Adicionar ${product.name} ao carrinho`}
        >
          <ShoppingCart size={16} />
          Adicionar ao Carrinho
        </button>
      </div>

      {/* Content */}
      <div className="p-4 flex flex-col flex-1">
        
        {/* Stars */}
        <div className="flex items-center gap-1 mb-2">
          {Array.from({ length: 5 }).map((_, i) => (
            <Star
              key={i}
              size={12}
              className={
                i < Math.floor(product.rating)
                  ? 'fill-amber-400 text-amber-400'
                  : 'fill-gray-200 text-gray-200'
              }
            />
          ))}
          <span className="text-xs text-gray-400 ml-1">({product.reviews})</span>
        </div>

        {/* Name */}
        <h3 className="text-sm font-semibold text-gray-800 leading-snug mb-1 line-clamp-2 group-hover:text-[#8BB964] transition-colors">
          {product.name}
        </h3>

        {/* Description */}
        <p className="text-xs text-gray-500 leading-relaxed mb-3 line-clamp-2 flex-1">
          {product.shortDescription}
        </p>

        {/* Pricing */}
        <div className="mt-auto">
          {product.originalPrice && (
            <p className="text-xs text-gray-400 line-through">
              {formatPrice(product.originalPrice)}
            </p>
          )}
          <p className="text-lg font-bold text-gray-900">
            {formatPrice(product.price)}
          </p>
          <p className="text-xs text-[#8BB964] font-medium mt-0.5">
            Até {product.installments}x de{' '}
            <span className="font-bold">{formatPrice(product.installmentValue)}</span>
            {' '}sem juros
          </p>
        </div>
      </div>
    </article>
  )
}
