import { useEffect, useRef, useState } from 'react'

import {
  getProducts,
  type ProductListQuery,
} from '../api/client'
import type { ProductListResponse } from '../api/contracts'

type CatalogProductsState =
  | { status: 'loading'; requestKey: string }
  | { status: 'success'; requestKey: string; data: ProductListResponse }
  | { status: 'error'; requestKey: string }

const requestTimeoutMs = 5_000

export function useCatalogProducts(query: ProductListQuery) {
  const [retryAttempt, setRetryAttempt] = useState(0)
  const latestRequest = useRef(0)
  const {
    q,
    category,
    subcategory,
    minPrice,
    maxPrice,
    page,
    pageSize,
  } = query
  const requestKey = JSON.stringify([
    q,
    category,
    subcategory,
    minPrice,
    maxPrice,
    page,
    pageSize,
    retryAttempt,
  ])
  const [state, setState] = useState<CatalogProductsState>({
    status: 'loading',
    requestKey,
  })

  useEffect(() => {
    const requestId = latestRequest.current + 1
    latestRequest.current = requestId
    let isMounted = true
    const controller = new AbortController()
    const timeoutId = window.setTimeout(() => {
      controller.abort()
    }, requestTimeoutMs)

    setState({ status: 'loading', requestKey })

    void getProducts(
      { q, category, subcategory, minPrice, maxPrice, page, pageSize },
      controller.signal,
    )
      .then((data) => {
        if (isMounted && latestRequest.current === requestId) {
          setState({ status: 'success', requestKey, data })
        }
      })
      .catch(() => {
        if (isMounted && latestRequest.current === requestId) {
          setState({ status: 'error', requestKey })
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
  }, [
    category,
    maxPrice,
    minPrice,
    page,
    pageSize,
    q,
    retryAttempt,
    requestKey,
    subcategory,
  ])

  return {
    state:
      state.requestKey === requestKey
        ? state
        : ({ status: 'loading', requestKey } satisfies CatalogProductsState),
    retry: () => setRetryAttempt((attempt) => attempt + 1),
  }
}
