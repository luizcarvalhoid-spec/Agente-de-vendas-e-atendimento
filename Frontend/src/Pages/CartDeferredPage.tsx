import { ArrowLeft, Construction, ShoppingCart } from 'lucide-react'
import { Link } from 'react-router'

import StoreRouteFrame from '../components/StoreRouteFrame'
import { useCart } from '../cart/useCart'

const linkClassName =
  'inline-flex min-h-11 items-center justify-center rounded-full border-2 border-[#527A36] px-5 py-2.5 text-sm font-semibold text-[#527A36] transition-colors hover:bg-[#527A36] hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#527A36] focus-visible:ring-offset-2'

export default function CartDeferredPage() {
  const {
    phase,
    totalUnits,
    issueCount,
    persistenceStatus,
    isPartial,
  } = useCart()

  let status = 'Seu carrinho demonstrativo está vazio.'
  if (phase === 'hydrating') {
    status = 'Validando os itens salvos do carrinho demonstrativo.'
  } else if (totalUnits > 0) {
    status = `${totalUnits} ${
      totalUnits === 1 ? 'unidade confirmada' : 'unidades confirmadas'
    } no carrinho demonstrativo.`
  } else if (issueCount > 0) {
    status = 'Nenhuma unidade pôde ser confirmada no catálogo atual.'
  } else if (isPartial) {
    status = 'Validando uma atualização do carrinho demonstrativo.'
  }

  return (
    <StoreRouteFrame>
      <section className="mx-auto max-w-2xl rounded-2xl border border-gray-100 bg-white p-6 text-center shadow-sm sm:p-10">
        {phase === 'hydrating' ? (
          <ShoppingCart
            aria-hidden="true"
            className="mx-auto mb-4 animate-pulse text-[#527A36]"
            size={42}
            strokeWidth={1.7}
          />
        ) : (
          <Construction
            aria-hidden="true"
            className="mx-auto mb-4 text-amber-500"
            size={42}
            strokeWidth={1.7}
          />
        )}
        <p className="mb-2 text-sm font-semibold uppercase tracking-wide text-[#527A36]">
          Prévia do carrinho
        </p>
        <h1 className="text-2xl font-semibold text-gray-900 sm:text-3xl">
          Carrinho demonstrativo
        </h1>
        <p
          role="status"
          aria-live="polite"
          className="mx-auto mt-4 max-w-xl text-sm font-medium leading-relaxed text-gray-700 sm:text-base"
        >
          {status}
        </p>
        {phase === 'ready' && issueCount > 0 && (
          <p className="mx-auto mt-3 max-w-xl text-sm leading-relaxed text-amber-800">
            {issueCount} {issueCount === 1 ? 'referência precisa' : 'referências precisam'} de revisão. Valores confirmados são parciais e itens com problema não entram nos totais.
          </p>
        )}
        {phase === 'ready' && isPartial && issueCount === 0 && totalUnits > 0 && (
          <p className="mx-auto mt-3 max-w-xl text-sm leading-relaxed text-amber-800">
            Uma atualização ainda está em andamento; os valores atuais são parciais.
          </p>
        )}
        {persistenceStatus === 'unavailable' && (
          <p className="mx-auto mt-3 max-w-xl text-sm leading-relaxed text-amber-800">
            O carrinho funciona nesta aba, mas não pôde ser salvo para o próximo acesso.
          </p>
        )}
        <p className="mx-auto mt-4 max-w-xl text-sm leading-relaxed text-gray-600">
          A edição completa de quantidades e o checkout fictício serão disponibilizados na próxima etapa. Nenhum pedido, pagamento ou entrega real é criado aqui.
        </p>
        <div className="mt-7 flex justify-center">
          <Link to="/" className={linkClassName}>
            <ArrowLeft aria-hidden="true" className="mr-2" size={16} />
            Voltar à vitrine
          </Link>
        </div>
      </section>
    </StoreRouteFrame>
  )
}
