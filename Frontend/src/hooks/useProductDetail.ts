import { useEffect, useRef, useState } from 'react'

import { ApiRequestError, getProductBySlug } from '../api/client'
import type { ProductDetailResponse } from '../api/contracts'

export type ProductDetailErrorReason =
  | 'configuration'
  | 'network'
  | 'timeout'
  | 'server'
  | 'http'
  | 'invalid-response'
  | 'unexpected'

type ProductDetailState =
  | { status: 'loading'; requestKey: string }
  | { status: 'success'; requestKey: string; data: ProductDetailResponse }
  | { status: 'not-found'; requestKey: string }
  | { status: 'invalid-request'; requestKey: string }
  | {
      status: 'error'
      requestKey: string
      reason: ProductDetailErrorReason
      canRetry: boolean
    }

const requestTimeoutMs = 5_000

function classifyApiError(error: unknown):
  | { status: 'not-found' }
  | { status: 'invalid-request' }
  | {
      status: 'error'
      reason: ProductDetailErrorReason
      canRetry: boolean
    } {
  if (!(error instanceof ApiRequestError)) {
    return { status: 'error', reason: 'unexpected', canRetry: true }
  }

  if (error.status === 404 || error.code === 'NOT_FOUND') {
    return { status: 'not-found' }
  }

  if (error.status === 400 || error.code === 'VALIDATION_ERROR') {
    return { status: 'invalid-request' }
  }

  if (error.kind === 'configuration') {
    return { status: 'error', reason: 'configuration', canRetry: false }
  }

  if (error.kind === 'network') {
    return { status: 'error', reason: 'network', canRetry: true }
  }

  if (error.kind === 'invalid-response') {
    return { status: 'error', reason: 'invalid-response', canRetry: true }
  }

  if (error.status !== undefined && error.status >= 500) {
    return { status: 'error', reason: 'server', canRetry: true }
  }

  return { status: 'error', reason: 'http', canRetry: false }
}

export function useProductDetail(slug?: string) {
  const [retryAttempt, setRetryAttempt] = useState(0)
  const latestRequest = useRef(0)
  const requestKey = JSON.stringify([slug, retryAttempt])
  const [state, setState] = useState<ProductDetailState>({
    status: 'loading',
    requestKey,
  })

  useEffect(() => {
    const requestId = latestRequest.current + 1
    latestRequest.current = requestId

    if (!slug) {
      setState({ status: 'invalid-request', requestKey })
      return
    }

    let isMounted = true
    let timedOut = false
    const controller = new AbortController()
    const timeoutId = window.setTimeout(() => {
      timedOut = true
      controller.abort()
    }, requestTimeoutMs)

    setState({ status: 'loading', requestKey })

    void getProductBySlug(slug, controller.signal)
      .then((data) => {
        if (isMounted && latestRequest.current === requestId) {
          setState({ status: 'success', requestKey, data })
        }
      })
      .catch((error: unknown) => {
        if (!isMounted || latestRequest.current !== requestId) {
          return
        }

        if (timedOut && controller.signal.aborted) {
          setState({
            status: 'error',
            requestKey,
            reason: 'timeout',
            canRetry: true,
          })
          return
        }

        const classified = classifyApiError(error)
        setState({ ...classified, requestKey })
      })
      .finally(() => {
        window.clearTimeout(timeoutId)
      })

    return () => {
      isMounted = false
      window.clearTimeout(timeoutId)
      controller.abort()
    }
  }, [requestKey, slug])

  return {
    state:
      state.requestKey === requestKey
        ? state
        : ({ status: 'loading', requestKey } satisfies ProductDetailState),
    retry: () => setRetryAttempt((attempt) => attempt + 1),
  }
}
