import { useEffect } from 'react'
import { useLocation } from 'react-router'

export default function RouteFocusManager() {
  const { pathname } = useLocation()

  useEffect(() => {
    const animationFrame = window.requestAnimationFrame(() => {
      window.scrollTo({ top: 0, left: 0, behavior: 'auto' })
      document.getElementById('main-content')?.focus({ preventScroll: true })
    })

    return () => window.cancelAnimationFrame(animationFrame)
  }, [pathname])

  return null
}
