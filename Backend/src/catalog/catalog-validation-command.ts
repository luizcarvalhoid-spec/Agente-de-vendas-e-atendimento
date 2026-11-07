import { ZodError } from 'zod'

import {
  loadCatalogRepository,
  type LoadCatalogOptions,
} from './catalog-repository.js'

export interface CatalogValidationOutput {
  info(message: string): void
  error(message: string): void
}

export interface CatalogValidationCommandOptions extends LoadCatalogOptions {
  output?: CatalogValidationOutput
}

const consoleOutput: CatalogValidationOutput = {
  info(message) {
    console.log(message)
  },
  error(message) {
    console.error(message)
  },
}

function formatIssuePath(path: PropertyKey[]) {
  return path.reduce<string>((formattedPath, segment) => {
    if (typeof segment === 'number') {
      return `${formattedPath}[${segment}]`
    }

    if (typeof segment === 'symbol') {
      return formattedPath
    }

    return `${formattedPath}.${segment}`
  }, 'products')
}

function isFileAccessError(error: unknown) {
  if (typeof error !== 'object' || error === null || !('code' in error)) {
    return false
  }

  return ['ENOENT', 'EACCES', 'EPERM'].includes(String(error.code))
}

function formatZodError(error: ZodError) {
  return error.issues.map(
    (issue) => `- ${formatIssuePath(issue.path)}: ${issue.message}`,
  )
}

export async function runCatalogValidation(
  options: CatalogValidationCommandOptions = {},
) {
  const output = options.output ?? consoleOutput

  try {
    const catalog = await loadCatalogRepository({
      catalogRoot: options.catalogRoot,
      productsFile: options.productsFile,
    })
    const stats = catalog.getStats()

    output.info('Catálogo válido.')
    output.info(`Produtos: ${stats.productCount}`)
    output.info(`Referências de imagem: ${stats.imageReferenceCount}`)
    output.info('Schemas e arquivos físicos verificados.')
    return 0
  } catch (error) {
    if (error instanceof ZodError) {
      output.error('Catálogo inválido:')
      formatZodError(error).forEach((message) => output.error(message))
      return 1
    }

    if (error instanceof SyntaxError) {
      output.error('Catálogo inválido: products.json não contém JSON válido.')
      return 1
    }

    if (isFileAccessError(error)) {
      output.error(
        'Não foi possível ler products.json ou uma imagem referenciada pelo catálogo.',
      )
      return 1
    }

    output.error('Falha inesperada ao validar o catálogo.')
    return 1
  }
}
