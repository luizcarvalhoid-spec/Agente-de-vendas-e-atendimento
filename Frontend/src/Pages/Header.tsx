import { Search, User, ShoppingCart } from 'lucide-react'
import { type FormEvent, useEffect, useState } from 'react'
import {
  Link,
  useLocation,
  useNavigate,
  useSearchParams,
} from 'react-router'

export default function Header() {
  const location = useLocation()
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const queryFromUrl = searchParams.get('q') ?? ''
  const [searchValue, setSearchValue] = useState(queryFromUrl)

  useEffect(() => {
    setSearchValue(queryFromUrl)
  }, [queryFromUrl])

  function handleSearch(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const nextParams =
      location.pathname === '/'
        ? new URLSearchParams(searchParams)
        : new URLSearchParams()
    const normalizedSearch = searchValue.trim().slice(0, 100)

    nextParams.delete('page')

    if (normalizedSearch) {
      nextParams.set('q', normalizedSearch)
    } else {
      nextParams.delete('q')
    }

    const search = nextParams.toString()
    navigate(search ? `/?${search}` : '/')
  }

  return (
    <header className="bg-white shadow-sm sticky top-0 z-50">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex flex-wrap items-center justify-between gap-3 py-3 sm:h-16 sm:flex-nowrap sm:gap-4 sm:py-0">
          
          {/* Logo */}
          <Link
            to="/"
            aria-label="Voltar à vitrine HidraSplash"
            className="flex flex-shrink-0 items-center rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#8BB964] focus-visible:ring-offset-2"
          >
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
          </Link>

          {/* Search Bar */}
          <form
            className="order-3 w-full min-w-0 sm:order-none sm:max-w-xl sm:flex-1"
            role="search"
            onSubmit={handleSearch}
          >
            <div className="relative">
              <label htmlFor="catalog-search" className="sr-only">
                Pesquisar produtos
              </label>
              <input
                id="catalog-search"
                type="text"
                value={searchValue}
                onChange={(e) => setSearchValue(e.target.value)}
                placeholder="Pesquisar..."
                maxLength={100}
                className="w-full pl-4 pr-10 py-2 border border-gray-200 rounded-md text-sm text-gray-700 placeholder-gray-400 bg-gray-50 focus:outline-none focus:ring-2 focus:ring-[#8BB964]/40 focus:border-[#8BB964] transition-all"
              />
              <button
                type="submit"
                className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-[#8BB964] transition-colors"
                aria-label="Buscar"
              >
                <Search size={18} />
              </button>
            </div>
          </form>

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
            <Link
              to="/carrinho"
              className="flex flex-col items-center relative text-gray-500 hover:text-[#8BB964] transition-colors group"
              aria-label="Carrinho de compras"
            >
              <ShoppingCart size={22} strokeWidth={1.8} />
              <span className="hidden sm:block text-[10px] font-medium mt-0.5 group-hover:text-[#8BB964]">
                Carrinho
              </span>
            </Link>
          </div>
        </div>
      </div>
    </header>
  )
}
