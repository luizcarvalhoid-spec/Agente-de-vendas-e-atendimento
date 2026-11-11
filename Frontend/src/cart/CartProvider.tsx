import {
  type ReactNode,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react'

import { ApiRequestError, getProductBySlug } from '../api/client'
import type { ProductDetailResponse } from '../api/contracts'
import {
  CART_MAX_DISTINCT_PRODUCTS,
  type AddProductReference,
  type CanonicalCartProduct,
  type CartItem,
  type CartOperationRejectionReason,
  type CartOperationResult,
  type CartProblemReason,
  type CartReference,
  type CartStorage,
  calculateCartTotals,
  clearStoredCart,
  isValidCartProductId,
  isValidCartQuantity,
  isValidCartSlug,
  priceToCents,
  readStoredCart,
  writeStoredCart,
} from './cart-model'
import { CartContext, type CartContextValue } from './useCart'

type ProductLoader = (
  slug: string,
  signal?: AbortSignal,
) => Promise<ProductDetailResponse>

interface CartProviderProps {
  children: ReactNode
  loadProduct?: ProductLoader
  storage?: CartStorage | null
}

interface CartState {
  phase: 'hydrating' | 'ready'
  items: CartItem[]
  pendingProductIds: ReadonlySet<number>
  persistenceStatus: 'available' | 'unavailable'
}

interface ActiveOperation {
  controller: AbortController
  token: number
  generation: number
}

function getBrowserStorage(): CartStorage | null {
  try {
    return window.localStorage
  } catch {
    return null
  }
}

function toCanonicalProduct(
  response: ProductDetailResponse,
): CanonicalCartProduct | undefined {
  const unitPriceCents = priceToCents(response.item.price)
  if (unitPriceCents === undefined) return undefined

  return {
    productId: response.item.id,
    slug: response.item.slug,
    name: response.item.name,
    unitPriceCents,
    stock: response.item.stock,
    imageUrl: response.media.primaryUrl,
    dataClassification: response.item.dataClassification,
  }
}

function isRemovedError(error: unknown) {
  return (
    error instanceof ApiRequestError &&
    (error.status === 404 || error.code === 'NOT_FOUND')
  )
}

function createProblemItem(
  reference: CartReference,
  reason: CartProblemReason,
  product?: CanonicalCartProduct,
): CartItem {
  return {
    ...reference,
    status: 'problem',
    reason,
    ...(product ? { product } : {}),
  }
}

async function validateStoredReference(
  reference: CartReference,
  loadProduct: ProductLoader,
  signal: AbortSignal,
): Promise<CartItem> {
  try {
    const response = await loadProduct(reference.slug, signal)
    if (
      response.item.id !== reference.productId ||
      response.item.slug !== reference.slug
    ) {
      return createProblemItem(reference, 'identity_mismatch')
    }

    const product = toCanonicalProduct(response)
    if (!product) return createProblemItem(reference, 'validation_failed')
    if (product.stock === 0) {
      return createProblemItem(reference, 'out_of_stock', product)
    }
    if (reference.quantity > product.stock) {
      return createProblemItem(reference, 'insufficient_stock', product)
    }
    return { ...reference, status: 'ready', product }
  } catch (error) {
    return createProblemItem(
      reference,
      isRemovedError(error) ? 'removed' : 'validation_failed',
    )
  }
}

export default function CartProvider({
  children,
  loadProduct = getProductBySlug,
  storage: storageOverride,
}: CartProviderProps) {
  const storage = useMemo(
    () =>
      storageOverride === undefined ? getBrowserStorage() : storageOverride,
    [storageOverride],
  )
  const initialState: CartState = {
    phase: 'hydrating',
    items: [],
    pendingProductIds: new Set(),
    persistenceStatus: storage ? 'available' : 'unavailable',
  }
  const [state, setState] = useState<CartState>(initialState)
  const stateRef = useRef(state)
  const mountedRef = useRef(true)
  const generationRef = useRef(0)
  const operationTokenRef = useRef(0)
  const activeOperationsRef = useRef(new Map<number, ActiveOperation>())
  const hydrationControllersRef = useRef(new Set<AbortController>())

  const commitState = useCallback(
    (
      update: (current: CartState) => CartState,
      persistence: 'none' | 'write' | 'clear' = 'none',
    ) => {
      const next = update(stateRef.current)
      const persistenceStatus =
        persistence === 'write'
          ? writeStoredCart(storage, next.items)
          : persistence === 'clear'
            ? clearStoredCart(storage)
            : next.persistenceStatus
      const committed = { ...next, persistenceStatus }
      stateRef.current = committed
      if (mountedRef.current) setState(committed)
    },
    [storage],
  )

  useEffect(() => {
    const hydrationControllers = hydrationControllersRef.current
    const activeOperations = activeOperationsRef.current
    mountedRef.current = true
    return () => {
      mountedRef.current = false
      generationRef.current += 1
      for (const controller of hydrationControllers) {
        controller.abort()
      }
      hydrationControllers.clear()
      for (const operation of activeOperations.values()) {
        operation.controller.abort()
      }
      activeOperations.clear()
    }
  }, [])

  useEffect(() => {
    const hydrationControllers = hydrationControllersRef.current
    const generation = generationRef.current + 1
    generationRef.current = generation
    const stored = readStoredCart(storage)

    commitState(() => ({
      phase: 'hydrating',
      items: [],
      pendingProductIds: new Set(),
      persistenceStatus: stored.status,
    }))

    if (stored.references.length === 0) {
      commitState((current) => ({ ...current, phase: 'ready' }))
      return
    }

    const validations = stored.references.map((reference) => {
      const controller = new AbortController()
      hydrationControllers.add(controller)
      return validateStoredReference(reference, loadProduct, controller.signal)
        .finally(() => hydrationControllers.delete(controller))
    })

    void Promise.all(validations).then((items) => {
      if (
        mountedRef.current &&
        generationRef.current === generation
      ) {
        commitState((current) => ({ ...current, phase: 'ready', items }))
      }
    })

    return () => {
      for (const controller of hydrationControllers) {
        controller.abort()
      }
      hydrationControllers.clear()
    }
  }, [commitState, loadProduct, storage])

  const finishOperation = useCallback(
    (productId: number, token: number) => {
      const active = activeOperationsRef.current.get(productId)
      if (!active || active.token !== token) return
      activeOperationsRef.current.delete(productId)
      commitState(
        (current) => {
          const pendingProductIds = new Set(current.pendingProductIds)
          pendingProductIds.delete(productId)
          return { ...current, pendingProductIds }
        },
        'none',
      )
    },
    [commitState],
  )

  const validateAndCommit = useCallback(
    async (
      reference: AddProductReference,
      quantity: number,
      expectedExistingQuantity?: number,
    ): Promise<CartOperationResult> => {
      const current = stateRef.current
      if (current.phase === 'hydrating') {
        return { status: 'rejected', reason: 'hydrating' }
      }
      if (
        !isValidCartProductId(reference.productId) ||
        !isValidCartSlug(reference.slug)
      ) {
        return { status: 'rejected', reason: 'invalid_reference' }
      }
      if (!isValidCartQuantity(quantity)) {
        return { status: 'rejected', reason: 'quantity_limit' }
      }
      if (activeOperationsRef.current.has(reference.productId)) {
        return { status: 'rejected', reason: 'busy' }
      }

      const existing = current.items.find(
        (item) => item.productId === reference.productId,
      )
      if (
        !existing &&
        current.items.length >= CART_MAX_DISTINCT_PRODUCTS
      ) {
        return { status: 'rejected', reason: 'cart_limit' }
      }
      if (existing && existing.slug !== reference.slug) {
        return { status: 'rejected', reason: 'identity_mismatch' }
      }

      const desiredQuantity =
        expectedExistingQuantity === undefined
          ? (existing?.quantity ?? 0) + quantity
          : quantity
      if (!isValidCartQuantity(desiredQuantity)) {
        return { status: 'rejected', reason: 'quantity_limit' }
      }
      if (
        expectedExistingQuantity !== undefined &&
        (!existing || existing.quantity !== expectedExistingQuantity)
      ) {
        return { status: 'rejected', reason: 'invalid_reference' }
      }

      const controller = new AbortController()
      const token = operationTokenRef.current + 1
      operationTokenRef.current = token
      const generation = generationRef.current
      activeOperationsRef.current.set(reference.productId, {
        controller,
        token,
        generation,
      })
      commitState((latest) => ({
        ...latest,
        pendingProductIds: new Set(latest.pendingProductIds).add(
          reference.productId,
        ),
      }))

      try {
        const response = await loadProduct(reference.slug, controller.signal)
        const active = activeOperationsRef.current.get(reference.productId)
        if (
          !active ||
          active.token !== token ||
          active.generation !== generation ||
          generationRef.current !== generation
        ) {
          return { status: 'rejected', reason: 'cancelled' }
        }
        if (
          response.item.id !== reference.productId ||
          response.item.slug !== reference.slug
        ) {
          return { status: 'rejected', reason: 'identity_mismatch' }
        }

        const product = toCanonicalProduct(response)
        if (!product) {
          return { status: 'rejected', reason: 'validation_failed' }
        }
        if (product.stock === 0) {
          return { status: 'rejected', reason: 'out_of_stock' }
        }
        if (desiredQuantity > product.stock) {
          return { status: 'rejected', reason: 'insufficient_stock' }
        }

        const latest = stateRef.current
        const latestExisting = latest.items.find(
          (item) => item.productId === reference.productId,
        )
        if (
          (!latestExisting && latest.items.length >= CART_MAX_DISTINCT_PRODUCTS) ||
          (latestExisting && latestExisting.slug !== reference.slug)
        ) {
          return {
            status: 'rejected',
            reason: latestExisting ? 'identity_mismatch' : 'cart_limit',
          }
        }
        if (
          (expectedExistingQuantity === undefined &&
            (latestExisting?.quantity ?? 0) !== (existing?.quantity ?? 0)) ||
          (expectedExistingQuantity !== undefined &&
            latestExisting?.quantity !== expectedExistingQuantity)
        ) {
          return { status: 'rejected', reason: 'cancelled' }
        }

        const observedPrice = reference.observedPriceCents
        const priceChanged =
          (typeof observedPrice === 'number' &&
            Number.isSafeInteger(observedPrice) &&
            observedPrice >= 0 &&
            observedPrice !== product.unitPriceCents) ||
          (latestExisting?.status === 'ready' &&
            latestExisting.product.unitPriceCents !== product.unitPriceCents)

        const nextItem: CartItem = {
          productId: reference.productId,
          slug: reference.slug,
          quantity: desiredQuantity,
          status: 'ready',
          product,
        }
        commitState(
          (latestState) => ({
            ...latestState,
            items: latestExisting
              ? latestState.items.map((item) =>
                  item.productId === reference.productId ? nextItem : item,
                )
              : [...latestState.items, nextItem],
          }),
          'write',
        )
        return { status: 'success', quantity: desiredQuantity, priceChanged }
      } catch (error) {
        if (controller.signal.aborted) {
          return { status: 'rejected', reason: 'cancelled' }
        }
        const reason: CartOperationRejectionReason = isRemovedError(error)
          ? 'removed'
          : 'validation_failed'
        return { status: 'rejected', reason }
      } finally {
        finishOperation(reference.productId, token)
      }
    },
    [commitState, finishOperation, loadProduct],
  )

  const addProduct = useCallback(
    (reference: AddProductReference, quantity = 1) =>
      validateAndCommit(reference, quantity),
    [validateAndCommit],
  )

  const setQuantity = useCallback(
    (productId: number, quantity: number): Promise<CartOperationResult> => {
      if (stateRef.current.phase === 'hydrating') {
        return Promise.resolve({ status: 'rejected', reason: 'hydrating' })
      }
      const existing = stateRef.current.items.find(
        (item) => item.productId === productId,
      )
      if (!existing) {
        return Promise.resolve({
          status: 'rejected',
          reason: 'invalid_reference',
        })
      }
      return validateAndCommit(
        { productId, slug: existing.slug },
        quantity,
        existing.quantity,
      )
    },
    [validateAndCommit],
  )

  const removeProduct = useCallback(
    (productId: number) => {
      if (stateRef.current.phase === 'hydrating') return
      const active = activeOperationsRef.current.get(productId)
      if (active) {
        active.controller.abort()
        activeOperationsRef.current.delete(productId)
      }
      commitState(
        (current) => {
          const pendingProductIds = new Set(current.pendingProductIds)
          pendingProductIds.delete(productId)
          return {
            ...current,
            items: current.items.filter((item) => item.productId !== productId),
            pendingProductIds,
          }
        },
        'write',
      )
    },
    [commitState],
  )

  const clearCart = useCallback(() => {
    generationRef.current += 1
    for (const controller of hydrationControllersRef.current) {
      controller.abort()
    }
    hydrationControllersRef.current.clear()
    for (const operation of activeOperationsRef.current.values()) {
      operation.controller.abort()
    }
    activeOperationsRef.current.clear()
    commitState(
      (current) => ({
        ...current,
        phase: 'ready',
        items: [],
        pendingProductIds: new Set(),
      }),
      'clear',
    )
  }, [commitState])

  const retryValidation = useCallback(
    (productId: number): Promise<CartOperationResult> => {
      if (stateRef.current.phase === 'hydrating') {
        return Promise.resolve({ status: 'rejected', reason: 'hydrating' })
      }
      const existing = stateRef.current.items.find(
        (item) => item.productId === productId,
      )
      if (!existing) {
        return Promise.resolve({
          status: 'rejected',
          reason: 'invalid_reference',
        })
      }
      return validateAndCommit(
        { productId, slug: existing.slug },
        existing.quantity,
        existing.quantity,
      )
    },
    [validateAndCommit],
  )

  const totals = calculateCartTotals(state.items)
  const value = useMemo<CartContextValue>(
    () => ({
      phase: state.phase,
      items: state.items,
      totalUnits: totals.totalUnits,
      subtotalCents: totals.subtotalCents,
      shippingCents: totals.shippingCents,
      totalCents: totals.totalCents,
      isPartial:
        totals.isPartial ||
        state.phase === 'hydrating' ||
        state.pendingProductIds.size > 0,
      issueCount: state.items.filter((item) => item.status === 'problem').length,
      persistenceStatus: state.persistenceStatus,
      addProduct,
      setQuantity,
      removeProduct,
      clearCart,
      retryValidation,
      isProductPending: (productId) => state.pendingProductIds.has(productId),
    }),
    [
      addProduct,
      clearCart,
      removeProduct,
      retryValidation,
      setQuantity,
      state,
      totals.isPartial,
      totals.shippingCents,
      totals.subtotalCents,
      totals.totalCents,
      totals.totalUnits,
    ],
  )

  return <CartContext.Provider value={value}>{children}</CartContext.Provider>
}
