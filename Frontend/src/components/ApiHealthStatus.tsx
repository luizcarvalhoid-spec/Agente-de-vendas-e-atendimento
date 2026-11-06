import { useEffect, useState } from 'react'

import { getHealth } from '../api/client'

type ApiStatus = 'loading' | 'available' | 'unavailable'

const statusContent: Record<
  ApiStatus,
  { label: string; indicatorClass: string }
> = {
  loading: {
    label: 'Verificando API…',
    indicatorClass: 'bg-amber-400 animate-pulse',
  },
  available: {
    label: 'API disponível',
    indicatorClass: 'bg-emerald-500',
  },
  unavailable: {
    label: 'API indisponível',
    indicatorClass: 'bg-red-500',
  },
}

const requestTimeoutMs = 5_000

export default function ApiHealthStatus() {
  const [status, setStatus] = useState<ApiStatus>('loading')

  useEffect(() => {
    let isMounted = true
    const controller = new AbortController()
    const timeoutId = window.setTimeout(() => {
      controller.abort()
    }, requestTimeoutMs)

    void getHealth(controller.signal)
      .then(() => {
        if (isMounted) {
          setStatus('available')
        }
      })
      .catch(() => {
        if (isMounted) {
          setStatus('unavailable')
        }
      })
      .finally(() => {
        window.clearTimeout(timeoutId)
      })

    return () => {
      isMounted = false
      window.clearTimeout(timeoutId)
      controller.abort()
    }
  }, [])

  const content = statusContent[status]

  return (
    <div
      aria-live="polite"
      role="status"
      className="pointer-events-none fixed bottom-4 left-4 z-40 max-w-[calc(100vw-2rem)] rounded-full border border-gray-200 bg-white/95 px-3 py-2 text-xs font-medium text-gray-700 shadow-md backdrop-blur-sm"
    >
      <span
        aria-hidden="true"
        className={`mr-2 inline-block h-2 w-2 rounded-full ${content.indicatorClass}`}
      />
      {content.label}
    </div>
  )
}
