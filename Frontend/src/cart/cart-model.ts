import type { ProductDataClassification } from '../api/contracts'
import {
  calculateDemoCommercialTotals,
  DEMO_FREE_SHIPPING_THRESHOLD_CENTS,
  DEMO_STANDARD_SHIPPING_CENTS,
  demoPriceToCents,
} from '../../../Backend/src/commercial/demo-commercial-rules.ts'

export const CART_STORAGE_KEY = 'hidrasplash:cart:v1'
export const CART_STORAGE_VERSION = 1
export const CART_MAX_DISTINCT_PRODUCTS = 20
export const CART_MAX_QUANTITY_PER_PRODUCT = 20
export const CART_MAX_STORAGE_BYTES = 16 * 1024
export const CART_MAX_SLUG_CHARACTERS = 256
export const CART_FREE_SHIPPING_THRESHOLD_CENTS =
  DEMO_FREE_SHIPPING_THRESHOLD_CENTS
export const CART_STANDARD_SHIPPING_CENTS = DEMO_STANDARD_SHIPPING_CENTS
export const CART_VALIDATION_TIMEOUT_MS = 5_000

const normalizedSlugPattern = /^[a-z0-9]+(?:-[a-z0-9]+)*$/

export interface CartReference {
  productId: number
  slug: string
  quantity: number
}

export interface AddProductReference {
  productId: number
  slug: string
  observedPriceCents?: number
}

export interface CanonicalCartProduct {
  productId: number
  slug: string
  name: string
  unitPriceCents: number
  stock: number
  imageUrl: string
  dataClassification: ProductDataClassification
}

export interface ReadyCartItem extends CartReference {
  status: 'ready'
  product: CanonicalCartProduct
}

export type CartProblemReason =
  | 'removed'
  | 'out_of_stock'
  | 'insufficient_stock'
  | 'identity_mismatch'
  | 'validation_failed'

export interface ProblemCartItem extends CartReference {
  status: 'problem'
  reason: CartProblemReason
  product?: CanonicalCartProduct
}

export type CartItem = ReadyCartItem | ProblemCartItem

export type CartOperationRejectionReason =
  | 'hydrating'
  | 'busy'
  | 'invalid_reference'
  | 'cart_limit'
  | 'quantity_limit'
  | 'removed'
  | 'out_of_stock'
  | 'insufficient_stock'
  | 'identity_mismatch'
  | 'validation_failed'
  | 'cancelled'

export type CartOperationResult =
  | {
      status: 'success'
      quantity: number
      priceChanged: boolean
    }
  | {
      status: 'rejected'
      reason: CartOperationRejectionReason
    }

export interface CartTotals {
  totalUnits: number
  subtotalCents: number
  shippingCents: number
  totalCents: number
  isPartial: boolean
}

export interface DemoCheckoutSummaryItem {
  productId: number
  slug: string
  name: string
  imageUrl: string
  quantity: number
  unitPriceCents: number
  lineSubtotalCents: number
}

export interface DemoCheckoutSummary {
  items: DemoCheckoutSummaryItem[]
  totalUnits: number
  subtotalCents: number
  shippingCents: number
  totalCents: number
}

export type DemoCheckoutCommercialChange = {
  productId: number
  kind: 'price' | 'stock'
}

export type DemoCheckoutBlockedReason =
  | 'hydrating'
  | 'empty'
  | 'busy'
  | 'problem_items'
  | 'validation_failed'
  | 'cancelled'

export type DemoCheckoutResult =
  | { status: 'confirmed'; summary: DemoCheckoutSummary }
  | {
      status: 'review_required'
      changes: DemoCheckoutCommercialChange[]
    }
  | { status: 'blocked'; reason: DemoCheckoutBlockedReason }

export type CartPersistenceStatus = 'available' | 'unavailable'

export interface CartStorage {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
  removeItem(key: string): void
}

export type StoredCartReadResult =
  | { status: 'available'; references: CartReference[]; corrupted: boolean }
  | { status: 'unavailable'; references: [] }

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function hasOnlyKeys(value: Record<string, unknown>, keys: readonly string[]) {
  const actualKeys = Object.keys(value)
  return (
    actualKeys.length === keys.length &&
    actualKeys.every((key) => keys.includes(key))
  )
}

export function isValidCartProductId(value: unknown): value is number {
  return Number.isSafeInteger(value) && typeof value === 'number' && value > 0
}

export function isValidCartSlug(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    value.length > 0 &&
    value.length <= CART_MAX_SLUG_CHARACTERS &&
    normalizedSlugPattern.test(value)
  )
}

export function isValidCartQuantity(value: unknown): value is number {
  return (
    typeof value === 'number' &&
    Number.isInteger(value) &&
    value >= 1 &&
    value <= CART_MAX_QUANTITY_PER_PRODUCT
  )
}

export function priceToCents(price: number): number | undefined {
  return demoPriceToCents(price)
}

export function calculateCartTotals(items: readonly CartItem[]): CartTotals {
  const totals = calculateDemoCommercialTotals(
    items.flatMap((item) =>
      item.status === 'ready'
        ? [{ unitPriceCents: item.product.unitPriceCents, quantity: item.quantity }]
        : [],
    ),
  )

  return {
    ...totals,
    isPartial: items.some((item) => item.status === 'problem'),
  }
}

export function calculateCartLineSubtotalCents(
  unitPriceCents: number,
  quantity: number,
) {
  return unitPriceCents * quantity
}

const brlFormatter = new Intl.NumberFormat('pt-BR', {
  style: 'currency',
  currency: 'BRL',
})

export function formatCartCurrency(cents: number) {
  return brlFormatter.format(cents / 100)
}

export function formatCartProblemReason(reason: CartProblemReason) {
  const messages: Record<CartProblemReason, string> = {
    removed: 'O produto não está mais disponível no catálogo.',
    out_of_stock: 'O produto está esgotado no catálogo atual.',
    insufficient_stock: 'A quantidade salva supera o estoque atual.',
    identity_mismatch: 'A identidade atual do produto não pôde ser confirmada.',
    validation_failed: 'Não foi possível validar o produto no catálogo atual.',
  }
  return messages[reason]
}

function parseStoredReference(value: unknown): CartReference | undefined {
  if (!isRecord(value) || !hasOnlyKeys(value, ['productId', 'slug', 'quantity'])) {
    return undefined
  }
  if (
    !isValidCartProductId(value.productId) ||
    !isValidCartSlug(value.slug) ||
    !isValidCartQuantity(value.quantity)
  ) {
    return undefined
  }
  return {
    productId: value.productId,
    slug: value.slug,
    quantity: value.quantity,
  }
}

export function parseStoredCart(raw: string): CartReference[] | undefined {
  if (new TextEncoder().encode(raw).byteLength > CART_MAX_STORAGE_BYTES) {
    return undefined
  }

  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return undefined
  }

  if (
    !isRecord(parsed) ||
    !hasOnlyKeys(parsed, ['version', 'items']) ||
    parsed.version !== CART_STORAGE_VERSION ||
    !Array.isArray(parsed.items) ||
    parsed.items.length > CART_MAX_DISTINCT_PRODUCTS
  ) {
    return undefined
  }

  const references: CartReference[] = []
  const productIds = new Set<number>()
  const slugs = new Set<string>()

  for (const value of parsed.items) {
    const reference = parseStoredReference(value)
    if (
      !reference ||
      productIds.has(reference.productId) ||
      slugs.has(reference.slug)
    ) {
      return undefined
    }
    productIds.add(reference.productId)
    slugs.add(reference.slug)
    references.push(reference)
  }

  return references
}

export function readStoredCart(storage: CartStorage | null): StoredCartReadResult {
  if (!storage) return { status: 'unavailable', references: [] }

  try {
    const raw = storage.getItem(CART_STORAGE_KEY)
    if (raw === null) {
      return { status: 'available', references: [], corrupted: false }
    }
    const references = parseStoredCart(raw)
    if (!references) {
      try {
        storage.removeItem(CART_STORAGE_KEY)
      } catch {
        return { status: 'unavailable', references: [] }
      }
      return { status: 'available', references: [], corrupted: true }
    }
    return { status: 'available', references, corrupted: false }
  } catch {
    return { status: 'unavailable', references: [] }
  }
}

export function serializeCartItems(items: readonly CartItem[]): string | undefined {
  if (items.length > CART_MAX_DISTINCT_PRODUCTS) return undefined
  const productIds = new Set<number>()
  const slugs = new Set<string>()
  for (const item of items) {
    if (
      !isValidCartProductId(item.productId) ||
      !isValidCartSlug(item.slug) ||
      !isValidCartQuantity(item.quantity) ||
      productIds.has(item.productId) ||
      slugs.has(item.slug)
    ) {
      return undefined
    }
    productIds.add(item.productId)
    slugs.add(item.slug)
  }
  const references = items.map(({ productId, slug, quantity }) => ({
    productId,
    slug,
    quantity,
  }))
  const raw = JSON.stringify({ version: CART_STORAGE_VERSION, items: references })
  return new TextEncoder().encode(raw).byteLength <= CART_MAX_STORAGE_BYTES
    ? raw
    : undefined
}

export function writeStoredCart(
  storage: CartStorage | null,
  items: readonly CartItem[],
): CartPersistenceStatus {
  if (!storage) return 'unavailable'
  const raw = serializeCartItems(items)
  if (!raw) return 'unavailable'

  try {
    storage.setItem(CART_STORAGE_KEY, raw)
    return 'available'
  } catch {
    return 'unavailable'
  }
}

export function clearStoredCart(storage: CartStorage | null): CartPersistenceStatus {
  if (!storage) return 'unavailable'
  try {
    storage.removeItem(CART_STORAGE_KEY)
    return 'available'
  } catch {
    return 'unavailable'
  }
}

export function formatCartOperationFeedback(
  result: CartOperationResult,
  productName: string,
) {
  if (result.status === 'success') {
    const priceNotice = result.priceChanged
      ? ' O preço atual do catálogo foi aplicado.'
      : ''
    return `${productName} foi adicionado ao carrinho demonstrativo.${priceNotice}`
  }

  const messages: Record<CartOperationRejectionReason, string> = {
    hydrating: 'Aguarde enquanto o carrinho salvo é validado.',
    busy: 'Este produto já está sendo atualizado. Aguarde a conclusão.',
    invalid_reference: 'Não foi possível identificar este produto com segurança.',
    cart_limit: 'O carrinho demonstrativo atingiu o limite de 20 produtos.',
    quantity_limit: 'O limite é de 20 unidades por produto.',
    removed: 'Este produto não está mais disponível no catálogo.',
    out_of_stock: 'Este produto está esgotado no catálogo atual.',
    insufficient_stock: 'O catálogo atual não possui unidades suficientes.',
    identity_mismatch: 'A identidade atual do produto não pôde ser confirmada.',
    validation_failed: 'Não foi possível validar o produto agora. Tente novamente.',
    cancelled: 'A atualização do carrinho foi cancelada.',
  }
  return messages[result.reason]
}
