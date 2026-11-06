import { Search, User, ShoppingCart } from 'lucide-react'
import { useState } from 'react'

export default function Header() {
  const [cartCount] = useState(2)
  const [searchValue, setSearchValue] = useState('')

  return (
    <header className="bg-white shadow-sm sticky top-0 z-50">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex items-center justify-between h-16 gap-4">
          
          {/* Logo */}
          <div className="flex-shrink-0 flex items-center">
            <img
              src="/logo (10).svg"
              alt="HidraSplash Logo"
              className="h-7 w-auto"
              onError={(e) => {
                const target = e.currentTarget
                target.style.display = 'none'
                const fallback = target.nextElementSibling as HTMLElement
                if (fallback) fallback.style.display = 'block'
              }}
            />
            <span
              className="hidden text-xl font-bold text-[#8BB964] tracking-tight"
              style={{ display: 'none' }}
            >
              HidraSplash
            </span>
          </div>

          {/* Search Bar */}
          <div className="flex-1 max-w-xl">
            <div className="relative">
              <input
                type="text"
                value={searchValue}
                onChange={(e) => setSearchValue(e.target.value)}
                placeholder="Pesquisar..."
                className="w-full pl-4 pr-10 py-2 border border-gray-200 rounded-md text-sm text-gray-700 placeholder-gray-400 bg-gray-50 focus:outline-none focus:ring-2 focus:ring-[#8BB964]/40 focus:border-[#8BB964] transition-all"
              />
              <button
                className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-[#8BB964] transition-colors"
                aria-label="Buscar"
              >
                <Search size={18} />
              </button>
            </div>
          </div>

          {/* Icons */}
          <div className="flex items-center gap-3 sm:gap-5">
            {/* User */}
            <button
              className="flex flex-col items-center text-gray-500 hover:text-[#8BB964] transition-colors group"
              aria-label="Minha conta"
            >
              <User size={22} strokeWidth={1.8} />
              <span className="hidden sm:block text-[10px] font-medium mt-0.5 group-hover:text-[#8BB964]">
                Conta
              </span>
            </button>

            {/* Cart */}
            <button
              className="flex flex-col items-center relative text-gray-500 hover:text-[#8BB964] transition-colors group"
              aria-label="Carrinho de compras"
            >
              <div className="relative">
                <ShoppingCart size={22} strokeWidth={1.8} />
                {cartCount > 0 && (
                  <span className="absolute -top-2 -right-2 bg-[#8BB964] text-white text-[10px] font-bold rounded-full w-4 h-4 flex items-center justify-center leading-none">
                    {cartCount}
                  </span>
                )}
              </div>
              <span className="hidden sm:block text-[10px] font-medium mt-0.5 group-hover:text-[#8BB964]">
                Carrinho
              </span>
            </button>
          </div>
        </div>
      </div>
    </header>
  )
}
