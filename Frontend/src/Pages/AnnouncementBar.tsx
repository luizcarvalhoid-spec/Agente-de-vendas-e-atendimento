import { Mail, Truck } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'

export default function AnnouncementBar() {
  const [visible, setVisible] = useState(true)
  const lastScrollY = useRef(0)

  useEffect(() => {
    const handleScroll = () => {
      const currentY = window.scrollY

      if (currentY > lastScrollY.current && currentY > 40) {
        // Scrolling DOWN → hide
        setVisible(false)
      } else {
        // Scrolling UP → show
        setVisible(true)
      }

      lastScrollY.current = currentY
    }

    window.addEventListener('scroll', handleScroll, { passive: true })
    return () => window.removeEventListener('scroll', handleScroll)
  }, [])

  return (
    <div
      className={`bg-[#8BB964] text-white text-xs font-medium transition-all duration-300 ease-in-out overflow-hidden ${
        visible ? 'max-h-12 opacity-100' : 'max-h-0 opacity-0'
      }`}
    >
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-9 flex items-center justify-between gap-4">
        {/* Left — Email */}
        <a
          href="mailto:Luizcarvalhoid@gmail.com"
          className="hidden sm:flex items-center gap-1.5 text-white/90 hover:text-white transition-colors whitespace-nowrap"
        >
          <Mail size={13} strokeWidth={2} />
          <span>Luizcarvalhoid@gmail.com</span>
        </a>

        {/* Center — Promo text */}
        <p className="mx-auto flex items-center gap-1.5 text-center text-[10px] font-semibold tracking-wide min-[420px]:text-xs sm:mx-0">
          <Truck size={14} strokeWidth={2.2} className="text-white/90 flex-shrink-0" />
          <span>
            FRETE GRÁTIS{' '}
            <span className="hidden font-normal text-white/90 min-[420px]:inline">
              para compras acima de{' '}
            </span>
            <span className="font-normal text-white/90 min-[420px]:hidden">
              acima de{' '}
            </span>
            R$100
          </span>
        </p>

        {/* Right spacer — mirrors the left column so the center stays truly centered */}
        <div className="hidden sm:block w-[200px] flex-shrink-0" />
      </div>
    </div>
  )
}
