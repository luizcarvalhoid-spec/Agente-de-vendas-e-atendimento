import { readFile } from 'node:fs/promises'
import { dirname, extname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import type { ProductListQuery } from '../contracts/catalog.js'
import {
  resolveCatalogImagePath,
  validateCatalog,
} from './catalog-validator.js'
import type { Product } from './product-schema.js'

export interface CatalogPaths {
  catalogRoot: string
  productsFile: string
}

export interface LoadCatalogOptions {
  catalogRoot?: string
  productsFile?: string
}

export interface CatalogImage {
  reference: string
  publicPath: string
  absolutePath: string
  contentType: string
}

export interface ProductPage {
  products: readonly Product[]
  page: number
  pageSize: number
  totalItems: number
  totalPages: number
  hasPreviousPage: boolean
  hasNextPage: boolean
}

export interface CatalogStats {
  productCount: number
  imageReferenceCount: number
}

export interface CatalogRepository {
  listAll(): readonly Product[]
  list(query: ProductListQuery): ProductPage
  findById(id: number): Product | undefined
  findBySlug(slug: string): Product | undefined
  findImage(publicPath: string): CatalogImage | undefined
  getStats(): CatalogStats
}

interface IndexedProduct {
  product: Product
  searchText: string
}

const IMAGE_CONTENT_TYPES: Readonly<Record<string, string>> = {
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.webp': 'image/webp',
}

export function resolveDefaultCatalogPaths(
  moduleUrl: string = import.meta.url,
): CatalogPaths {
  const moduleDirectory = dirname(fileURLToPath(moduleUrl))
  const catalogRoot = resolve(moduleDirectory, '../../content/catalog')

  return {
    catalogRoot,
    productsFile: join(catalogRoot, 'products.json'),
  }
}

function normalizeSearchText(value: string) {
  return value
    .normalize('NFKD')
    .replace(/\p{Diacritic}/gu, '')
    .trim()
    .replace(/\s+/g, ' ')
    .toLocaleLowerCase('pt-BR')
}

function createSearchText(product: Product) {
  return normalizeSearchText(
    [
      product.slug,
      product.name,
      product.brand,
      product.visibleLabelBrand,
      product.category,
      product.subcategory,
      product.description,
      product.shortDescription,
      product.variant.name,
      product.variant.profile,
      ...(product.variant.sensoryNotes ?? []),
      ...product.tags,
      ...product.indications,
      ...product.benefits,
    ]
      .filter((value): value is string => value !== undefined)
      .join(' '),
  )
}

function referenceToPublicPath(reference: string) {
  const prefix = 'images/'

  if (!reference.startsWith(prefix)) {
    throw new Error('A referência de imagem não pertence à pasta pública.')
  }

  return reference.slice(prefix.length)
}

export function toCatalogImageUrl(reference: string) {
  const publicPath = referenceToPublicPath(reference)
  const encodedPath = publicPath
    .split('/')
    .map((segment) => encodeURIComponent(segment))
    .join('/')

  return `/api/catalog/images/${encodedPath}`
}

async function createImageIndex(
  products: readonly Product[],
  catalogRoot: string,
) {
  const references = new Set<string>()

  for (const product of products) {
    references.add(product.image)
    product.images?.forEach((reference) => references.add(reference))
  }

  const images = new Map<string, CatalogImage>()

  for (const reference of references) {
    const publicPath = referenceToPublicPath(reference)
    const extension = extname(reference).toLocaleLowerCase('en-US')
    const contentType = IMAGE_CONTENT_TYPES[extension]

    if (contentType === undefined) {
      throw new Error('A imagem possui um tipo de conteúdo não autorizado.')
    }

    const absolutePath = await resolveCatalogImagePath(catalogRoot, reference)
    images.set(publicPath, {
      reference,
      publicPath,
      absolutePath,
      contentType,
    })
  }

  return images
}

async function createCatalogRepository(
  products: readonly Product[],
  catalogRoot: string,
): Promise<CatalogRepository> {
  const sortedProducts = [...products].sort((first, second) => first.id - second.id)
  const indexedProducts: IndexedProduct[] = sortedProducts.map((product) => ({
    product,
    searchText: createSearchText(product),
  }))
  const productsById = new Map(
    sortedProducts.map((product) => [product.id, product] as const),
  )
  const productsBySlug = new Map(
    sortedProducts.map((product) => [product.slug, product] as const),
  )
  const imagesByPublicPath = await createImageIndex(sortedProducts, catalogRoot)

  return {
    listAll() {
      return sortedProducts
    },
    list(query) {
      const normalizedQuery =
        query.q === undefined ? undefined : normalizeSearchText(query.q)
      const filteredProducts = indexedProducts
        .filter(({ product, searchText }) => {
          if (
            normalizedQuery !== undefined &&
            !searchText.includes(normalizedQuery)
          ) {
            return false
          }

          if (
            query.category !== undefined &&
            product.category !== query.category
          ) {
            return false
          }

          if (
            query.subcategory !== undefined &&
            product.subcategory !== query.subcategory
          ) {
            return false
          }

          if (query.minPrice !== undefined && product.price < query.minPrice) {
            return false
          }

          if (query.maxPrice !== undefined && product.price > query.maxPrice) {
            return false
          }

          return true
        })
        .map(({ product }) => product)

      const totalItems = filteredProducts.length
      const totalPages =
        totalItems === 0 ? 0 : Math.ceil(totalItems / query.pageSize)
      const firstItemIndex = (query.page - 1) * query.pageSize
      const productsForPage = filteredProducts.slice(
        firstItemIndex,
        firstItemIndex + query.pageSize,
      )

      return {
        products: productsForPage,
        page: query.page,
        pageSize: query.pageSize,
        totalItems,
        totalPages,
        hasPreviousPage: query.page > 1 && totalPages > 0,
        hasNextPage: query.page < totalPages,
      }
    },
    findById(id) {
      return productsById.get(id)
    },
    findBySlug(slug) {
      return productsBySlug.get(slug)
    },
    findImage(publicPath) {
      return imagesByPublicPath.get(publicPath)
    },
    getStats() {
      return {
        productCount: sortedProducts.length,
        imageReferenceCount: imagesByPublicPath.size,
      }
    },
  }
}

export async function loadCatalogRepository(
  options: LoadCatalogOptions = {},
) {
  const defaultPaths = resolveDefaultCatalogPaths()
  const catalogRoot = resolve(options.catalogRoot ?? defaultPaths.catalogRoot)
  const productsFile = resolve(
    options.productsFile ?? join(catalogRoot, 'products.json'),
  )
  const source = await readFile(productsFile, 'utf8')
  const input = JSON.parse(source) as unknown
  const products = await validateCatalog(input, { imageRoot: catalogRoot })

  return createCatalogRepository(products, catalogRoot)
}
