import { realpath, stat } from 'node:fs/promises'
import { isAbsolute, relative, resolve, sep } from 'node:path'

import { z } from 'zod'

import {
  commercialProductCatalogSchema,
  productCatalogSchema,
} from './product-schema.js'

export interface CatalogValidationOptions {
  imageRoot: string
}

interface CatalogImageReference {
  image: string
  images?: string[]
}

function isInsideRoot(root: string, candidate: string) {
  const relativePath = relative(root, candidate)
  return (
    relativePath !== '' &&
    relativePath !== '..' &&
    !relativePath.startsWith(`..${sep}`) &&
    !isAbsolute(relativePath)
  )
}

async function validateCatalogImages(
  products: readonly CatalogImageReference[],
  imageRoot: string,
  ctx: z.RefinementCtx,
) {
  let canonicalRoot: string

  try {
    canonicalRoot = await realpath(imageRoot)
    const rootStats = await stat(canonicalRoot)

    if (!rootStats.isDirectory()) {
      throw new Error('Image root is not a directory.')
    }
  } catch {
    ctx.addIssue({
      code: 'custom',
      path: [],
      message: 'A raiz de imagens não existe ou não é um diretório acessível.',
    })
    return
  }

  for (const [productIndex, product] of products.entries()) {
    const references = [
      { value: product.image, path: [productIndex, 'image'] },
      ...(product.images ?? []).map((value, imageIndex) => ({
        value,
        path: [productIndex, 'images', imageIndex],
      })),
    ]

    for (const reference of references) {
      const candidate = resolve(canonicalRoot, reference.value)

      if (!isInsideRoot(canonicalRoot, candidate)) {
        ctx.addIssue({
          code: 'custom',
          path: reference.path,
          message: 'A imagem deve permanecer dentro da raiz permitida.',
        })
        continue
      }

      try {
        const canonicalImagePath = await realpath(candidate)

        if (!isInsideRoot(canonicalRoot, canonicalImagePath)) {
          ctx.addIssue({
            code: 'custom',
            path: reference.path,
            message:
              'A imagem resolve para fora da raiz permitida, inclusive por link simbólico.',
          })
          continue
        }

        const imageStats = await stat(canonicalImagePath)
        if (!imageStats.isFile()) {
          ctx.addIssue({
            code: 'custom',
            path: reference.path,
            message: 'A referência de imagem não aponta para um arquivo.',
          })
        }
      } catch {
        ctx.addIssue({
          code: 'custom',
          path: reference.path,
          message: 'O arquivo de imagem não existe ou não está acessível.',
        })
      }
    }
  }
}

export async function validateCatalog(
  input: unknown,
  { imageRoot }: CatalogValidationOptions,
) {
  return productCatalogSchema
    .superRefine((products, ctx) =>
      validateCatalogImages(products, imageRoot, ctx),
    )
    .parseAsync(input)
}

export async function validateCommercialCatalog(
  input: unknown,
  { imageRoot }: CatalogValidationOptions,
) {
  return commercialProductCatalogSchema
    .superRefine((products, ctx) =>
      validateCatalogImages(products, imageRoot, ctx),
    )
    .parseAsync(input)
}

export type ProductCatalog = z.infer<typeof productCatalogSchema>
