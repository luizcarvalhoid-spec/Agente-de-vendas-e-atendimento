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

class CatalogImageValidationError extends Error {}

function isInsideRoot(root: string, candidate: string) {
  const relativePath = relative(root, candidate)
  return (
    relativePath !== '' &&
    relativePath !== '..' &&
    !relativePath.startsWith(`..${sep}`) &&
    !isAbsolute(relativePath)
  )
}

async function resolveCanonicalImageRoot(imageRoot: string) {
  try {
    const canonicalRoot = await realpath(imageRoot)
    const rootStats = await stat(canonicalRoot)

    if (!rootStats.isDirectory()) {
      throw new Error('Image root is not a directory.')
    }

    return canonicalRoot
  } catch {
    throw new CatalogImageValidationError(
      'A raiz de imagens não existe ou não é um diretório acessível.',
    )
  }
}

async function resolveFromCanonicalRoot(
  canonicalRoot: string,
  reference: string,
) {
  const candidate = resolve(canonicalRoot, reference)

  if (!isInsideRoot(canonicalRoot, candidate)) {
    throw new CatalogImageValidationError(
      'A imagem deve permanecer dentro da raiz permitida.',
    )
  }

  try {
    const canonicalImagePath = await realpath(candidate)

    if (!isInsideRoot(canonicalRoot, canonicalImagePath)) {
      throw new CatalogImageValidationError(
        'A imagem resolve para fora da raiz permitida, inclusive por link simbólico.',
      )
    }

    const imageStats = await stat(canonicalImagePath)
    if (!imageStats.isFile()) {
      throw new CatalogImageValidationError(
        'A referência de imagem não aponta para um arquivo.',
      )
    }

    return canonicalImagePath
  } catch (error) {
    if (error instanceof CatalogImageValidationError) {
      throw error
    }

    throw new CatalogImageValidationError(
      'O arquivo de imagem não existe ou não está acessível.',
    )
  }
}

export async function resolveCatalogImagePath(
  imageRoot: string,
  reference: string,
) {
  const canonicalRoot = await resolveCanonicalImageRoot(imageRoot)
  return resolveFromCanonicalRoot(canonicalRoot, reference)
}

async function validateCatalogImages(
  products: readonly CatalogImageReference[],
  imageRoot: string,
  ctx: z.RefinementCtx,
) {
  let canonicalRoot: string

  try {
    canonicalRoot = await resolveCanonicalImageRoot(imageRoot)
  } catch (error) {
    ctx.addIssue({
      code: 'custom',
      path: [],
      message:
        error instanceof CatalogImageValidationError
          ? error.message
          : 'A raiz de imagens não existe ou não é um diretório acessível.',
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
      try {
        await resolveFromCanonicalRoot(canonicalRoot, reference.value)
      } catch (error) {
        ctx.addIssue({
          code: 'custom',
          path: reference.path,
          message:
            error instanceof CatalogImageValidationError
              ? error.message
              : 'O arquivo de imagem não existe ou não está acessível.',
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
