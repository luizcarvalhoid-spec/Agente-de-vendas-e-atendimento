import { createContext, useContext } from 'react'

import type {
  AddProductReference,
  CartItem,
  CartOperationResult,
  CartPersistenceStatus,
} from './cart-model'

export interface CartContextValue {
  phase: 'hydrating' | 'ready'
  items: readonly CartItem[]
  totalUnits: number
  subtotalCents: number
  shippingCents: number
  totalCents: number
  isPartial: boolean
  issueCount: number
  persistenceStatus: CartPersistenceStatus
  addProduct(
    reference: AddProductReference,
    quantity?: number,
  ): Promise<CartOperationResult>
  setQuantity(productId: number, quantity: number): Promise<CartOperationResult>
  removeProduct(productId: number): void
  clearCart(): void
  retryValidation(productId: number): Promise<CartOperationResult>
  isProductPending(productId: number): boolean
}

export const CartContext = createContext<CartContextValue | undefined>(undefined)

export function useCart() {
  const context = useContext(CartContext)
  if (!context) {
    throw new Error('useCart must be used within CartProvider')
  }
  return context
}
