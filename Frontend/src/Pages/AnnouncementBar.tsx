import { BadgeInfo } from 'lucide-react'

export default function AnnouncementBar() {
  return (
    <div className="bg-[#527A36] px-4 py-2 text-center text-xs font-medium text-white">
      <p className="mx-auto flex max-w-7xl items-center justify-center gap-2 leading-relaxed">
        <BadgeInfo aria-hidden="true" className="shrink-0" size={15} />
        <span>
          Loja fictícia de portfólio — compras, pagamentos e atendimento são
          demonstrativos.
        </span>
      </p>
    </div>
  )
}
