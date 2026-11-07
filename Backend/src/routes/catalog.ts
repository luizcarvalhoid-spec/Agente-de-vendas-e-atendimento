import { open } from 'node:fs/promises'

import type { FastifyPluginAsync, FastifyReply } from 'fastify'

import {
  toCatalogImageUrl,
  type CatalogRepository,
} from '../catalog/catalog-repository.js'
import type { Product } from '../catalog/product-schema.js'
import {
  catalogImageParamsSchema,
  productDetailParamsSchema,
  productDetailResponseSchema,
  productListQuerySchema,
  productListResponseSchema,
  type CatalogProductSummary,
  type ProductDetailResponse,
  type ProductListResponse,
} from '../contracts/catalog.js'
import type { ApiError } from '../contracts/api.js'

interface CatalogRoutesOptions {
  catalog: CatalogRepository
}

const notFoundError = {
  code: 'NOT_FOUND',
  message: 'Recurso não encontrado.',
} satisfies ApiError

function sendNotFound(reply: FastifyReply) {
  return reply.status(404).send(notFoundError)
}

function toProductSummary(product: Product): CatalogProductSummary {
  return {
    id: product.id,
    slug: product.slug,
    name: product.name,
    brand: product.brand,
    visibleLabelBrand: product.visibleLabelBrand,
    isDemo: product.isDemo,
    category: product.category,
    subcategory: product.subcategory,
    applicationArea: product.applicationArea,
    productKind: product.productKind,
    shortDescription: product.shortDescription,
    price: product.price,
    originalPrice: product.originalPrice,
    stock: product.stock,
    netContent: product.netContent,
    rating: product.rating,
    reviews: product.reviews,
    imageUrl: toCatalogImageUrl(product.image),
    dataClassification: product.dataClassification,
  }
}

function toProductDetail(product: Product): ProductDetailResponse {
  return {
    item: product,
    media: {
      primaryUrl: toCatalogImageUrl(product.image),
      galleryUrls: (product.images ?? []).map(toCatalogImageUrl),
    },
  }
}

export const catalogRoutes: FastifyPluginAsync<CatalogRoutesOptions> = async (
  app,
  { catalog },
) => {
  app.get('/api/products', async (request) => {
    const query = productListQuerySchema.parse(request.query)
    const page = catalog.list(query)
    const response = {
      items: page.products.map(toProductSummary),
      pagination: {
        page: page.page,
        pageSize: page.pageSize,
        totalItems: page.totalItems,
        totalPages: page.totalPages,
        hasPreviousPage: page.hasPreviousPage,
        hasNextPage: page.hasNextPage,
      },
    } satisfies ProductListResponse

    return productListResponseSchema.parse(response)
  })

  app.get('/api/products/:slug', async (request, reply) => {
    const { slug } = productDetailParamsSchema.parse(request.params)
    const product = catalog.findBySlug(slug)

    if (product === undefined) {
      return sendNotFound(reply)
    }

    return productDetailResponseSchema.parse(toProductDetail(product))
  })

  app.get('/api/catalog/images/*', async (request, reply) => {
    const parsedParams = catalogImageParamsSchema.safeParse(request.params)

    if (!parsedParams.success) {
      return sendNotFound(reply)
    }

    const image = catalog.findImage(parsedParams.data['*'])
    if (image === undefined) {
      return sendNotFound(reply)
    }

    try {
      const imageHandle = await open(image.absolutePath, 'r')
      const imageStats = await imageHandle.stat()

      if (!imageStats.isFile()) {
        await imageHandle.close()
        return sendNotFound(reply)
      }

      reply
        .type(image.contentType)
        .header('X-Content-Type-Options', 'nosniff')
        .header('Cache-Control', 'public, max-age=3600')

      return reply.send(imageHandle.createReadStream())
    } catch {
      return sendNotFound(reply)
    }
  })
}
