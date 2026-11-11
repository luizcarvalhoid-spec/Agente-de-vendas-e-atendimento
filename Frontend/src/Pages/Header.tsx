import { Search, User, ShoppingCart } from 'lucide-react'
import { type FormEvent, useEffect, useState } from 'react'
import {
  Link,
  useLocation,
  useNavigate,
  useSearchParams,
} from 'react-router'

import { useCart } from '../cart/useCart'

export default function Header() {
  const { phase, totalUnits } = useCart()
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
    <header className="sticky top-0 z-50 bg-white shadow-sm">
      <a
        href="#main-content"
        className="sr-only left-2 top-2 z-[60] rounded-md bg-[#527A36] px-4 py-2 text-sm font-semibold text-white shadow-lg focus:not-sr-only focus:fixed focus:outline-none focus:ring-2 focus:ring-[#527A36] focus:ring-offset-2"
      >
        Pular para o conteúdo
      </a>
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex flex-wrap items-center justify-between gap-3 py-3 sm:h-16 sm:flex-nowrap sm:gap-4 sm:py-0">
          
          {/* Logo */}
          <Link
            to="/"
            aria-label="Voltar à vitrine HidraSplash"
            className="flex min-h-11 flex-shrink-0 items-center rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#527A36] focus-visible:ring-offset-2"
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
              className="hidden text-xl font-bold text-[#527A36] tracking-tight"
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
                className="min-h-11 w-full rounded-md border border-gray-300 bg-gray-50 py-2 pl-4 pr-12 text-sm text-gray-700 placeholder-gray-500 transition-all focus:border-[#527A36] focus:outline-none focus:ring-2 focus:ring-[#527A36]/40"
              />
              <button
                type="submit"
                className="absolute right-0 top-0 flex h-full min-w-11 items-center justify-center rounded-r-md text-gray-600 transition-colors hover:text-[#527A36] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[#527A36]"
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
              type="button"
              disabled
              title="Conta indisponível nesta demonstração"
              className="flex min-h-11 min-w-11 cursor-not-allowed flex-col items-center justify-center text-gray-500 opacity-70"
              aria-label="Minha conta — indisponível nesta demonstração"
            >
              <User size={22} strokeWidth={1.8} />
              <span className="mt-0.5 hidden text-[10px] font-medium sm:block">
                Conta
              </span>
            </button>

            {/* Cart */}
            <Link
              to="/carrinho"
              className="group relative flex min-h-11 min-w-11 flex-col items-center justify-center rounded-sm text-gray-600 transition-colors hover:text-[#527A36] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#527A36] focus-visible:ring-offset-2"
              aria-label={
                phase === 'hydrating'
                  ? 'Carrinho de compras — validando itens salvos'
                  : `Carrinho de compras — ${totalUnits} ${
                      totalUnits === 1 ? 'unidade confirmada' : 'unidades confirmadas'
                    }`
              }
            >
              <ShoppingCart size={22} strokeWidth={1.8} />
              <span
                aria-hidden="true"
                className="absolute right-0 top-0 flex min-h-5 min-w-5 items-center justify-center rounded-full bg-[#527A36] px-1 text-[10px] font-bold leading-none text-white"
              >
                {phase === 'hydrating'
                  ? '…'
                  : totalUnits > 99
                    ? '99+'
                    : totalUnits}
              </span>
              <span className="mt-0.5 hidden text-[10px] font-medium group-hover:text-[#527A36] sm:block">
                Carrinho
              </span>
              <span className="sr-only" aria-live="polite">
                {phase === 'ready'
                  ? `${totalUnits} ${
                      totalUnits === 1 ? 'unidade confirmada' : 'unidades confirmadas'
                    }`
                  : 'Validando carrinho salvo'}
              </span>
            </Link>
          </div>
        </div>
      </div>
    </header>
  )
}
