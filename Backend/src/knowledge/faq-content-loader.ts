import { lstat, readFile, readdir, realpath, stat } from 'node:fs/promises'
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

import { z } from 'zod'

import {
  faqCategories,
  faqDocumentSchema,
  type FaqCategory,
  type FaqDocument,
} from './faq-document-schema.js'

const metadataKeys = [
  'sourceId',
  'category',
  'title',
  'classification',
] as const
const metadataKeySet = new Set<string>(metadataKeys)
const faqFileNamePattern = /^faq-\d{3}\.md$/

export interface FaqValidationIssue {
  file?: string
  message: string
}

export class FaqContentValidationError extends Error {
  readonly issues: readonly FaqValidationIssue[]

  constructor(issues: readonly FaqValidationIssue[]) {
    super('Base FAQ inválida.')
    this.name = 'FaqContentValidationError'
    this.issues = issues
  }
}

export interface LoadFaqDocumentsOptions {
  faqRoot?: string
}

function normalizeTitle(value: string) {
  return value
    .normalize('NFKD')
    .replace(/\p{Diacritic}/gu, '')
    .trim()
    .replace(/\s+/g, ' ')
    .toLocaleLowerCase('pt-BR')
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

function formatZodIssue(issue: z.core.$ZodIssue) {
  const field = issue.path.length > 0 ? `${issue.path.join('.')}: ` : ''
  return `${field}${issue.message}`
}

export function parseFaqDocumentSource(
  rawSource: string,
  file = 'documento',
): FaqDocument {
  const source = rawSource.replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n')
  const lines = source.split('\n')
  const issues: FaqValidationIssue[] = []

  if (lines[0] !== '---') {
    throw new FaqContentValidationError([
      { file, message: 'O documento deve começar com frontmatter delimitado por `---`.' },
    ])
  }

  const closingDelimiter = lines.indexOf('---', 1)
  if (closingDelimiter < 2) {
    throw new FaqContentValidationError([
      { file, message: 'O frontmatter deve terminar com uma segunda linha `---`.' },
    ])
  }

  const metadata: Record<string, string> = {}
  for (const line of lines.slice(1, closingDelimiter)) {
    const separator = line.indexOf(':')
    const key = separator > 0 ? line.slice(0, separator).trim() : ''
    const value = separator > 0 ? line.slice(separator + 1).trim() : ''

    if (!/^[A-Za-z][A-Za-z0-9]*$/.test(key) || value === '') {
      issues.push({
        file,
        message: 'Cada metadado deve usar uma linha plana no formato `chave: valor`.',
      })
      continue
    }

    if (!metadataKeySet.has(key)) {
      issues.push({ file, message: `Metadado desconhecido: ${key}.` })
      continue
    }

    if (metadata[key] !== undefined) {
      issues.push({ file, message: `Metadado duplicado: ${key}.` })
      continue
    }

    metadata[key] = value
  }

  for (const key of metadataKeys) {
    if (metadata[key] === undefined) {
      issues.push({ file, message: `Metadado obrigatório ausente: ${key}.` })
    }
  }

  const content = lines.slice(closingDelimiter + 1).join('\n').trim()
  const result = faqDocumentSchema.safeParse({ ...metadata, content })
  if (!result.success) {
    result.error.issues.forEach((issue) =>
      issues.push({ file, message: formatZodIssue(issue) }),
    )
  }

  if (issues.length > 0 || !result.success) {
    throw new FaqContentValidationError(issues)
  }

  return result.data
}

export function resolveDefaultFaqRoot(moduleUrl: string = import.meta.url) {
  const moduleDirectory = dirname(fileURLToPath(moduleUrl))
  return resolve(moduleDirectory, '../../content/knowledge/faq')
}

async function resolveFaqRoot(faqRoot: string) {
  try {
    const canonicalRoot = await realpath(faqRoot)
    const rootStats = await stat(canonicalRoot)

    if (!rootStats.isDirectory()) throw new Error('not-directory')
    return canonicalRoot
  } catch {
    throw new FaqContentValidationError([
      { message: 'A raiz da FAQ não existe ou não é um diretório acessível.' },
    ])
  }
}

async function inspectCategory(
  canonicalRoot: string,
  category: FaqCategory,
) {
  const issues: FaqValidationIssue[] = []
  const documents: Array<{ document: FaqDocument; file: string }> = []
  const categoryPath = join(canonicalRoot, category)

  try {
    const categoryStats = await lstat(categoryPath)
    if (categoryStats.isSymbolicLink()) {
      return {
        documents,
        issues: [
          {
            file: category,
            message: 'Links simbólicos não são permitidos na base FAQ.',
          },
        ],
      }
    }
    if (!categoryStats.isDirectory()) throw new Error('invalid-category')
  } catch {
    return {
      documents,
      issues: [
        {
          file: category,
          message: 'A categoria deve existir como diretório físico dentro da raiz FAQ.',
        },
      ],
    }
  }

  try {
    const canonicalCategoryPath = await realpath(categoryPath)
    if (!isInsideRoot(canonicalRoot, canonicalCategoryPath)) {
      throw new Error('category-outside-root')
    }

    const entries = await readdir(canonicalCategoryPath, { withFileTypes: true })
    for (const entry of entries.sort((first, second) =>
      first.name.localeCompare(second.name, 'en-US'),
    )) {
      const relativeFile = `${category}/${entry.name}`

      if (entry.isSymbolicLink()) {
        issues.push({
          file: relativeFile,
          message: 'Links simbólicos não são permitidos na base FAQ.',
        })
        continue
      }

      if (!entry.isFile() || !faqFileNamePattern.test(entry.name)) {
        issues.push({
          file: relativeFile,
          message: 'Somente arquivos faq-NNN.md são permitidos nas categorias.',
        })
        continue
      }

      const candidate = join(canonicalCategoryPath, entry.name)
      try {
        const canonicalFile = await realpath(candidate)
        if (!isInsideRoot(canonicalRoot, canonicalFile)) {
          throw new Error('file-outside-root')
        }

        const fileStats = await stat(canonicalFile)
        if (!fileStats.isFile()) throw new Error('not-file')

        const document = parseFaqDocumentSource(
          await readFile(canonicalFile, 'utf8'),
          relativeFile,
        )

        if (`${document.sourceId}.md` !== basename(entry.name)) {
          issues.push({
            file: relativeFile,
            message: 'O nome do arquivo deve corresponder ao sourceId.',
          })
        }
        if (document.category !== category) {
          issues.push({
            file: relativeFile,
            message: 'A categoria do frontmatter deve corresponder ao diretório.',
          })
        }

        documents.push({ document, file: relativeFile })
      } catch (error) {
        if (error instanceof FaqContentValidationError) {
          issues.push(...error.issues)
        } else {
          issues.push({
            file: relativeFile,
            message: 'Não foi possível ler o documento dentro da raiz autorizada.',
          })
        }
      }
    }
  } catch {
    issues.push({
      file: category,
      message: 'A categoria deve existir como diretório físico dentro da raiz FAQ.',
    })
  }

  return { documents, issues }
}

export async function loadFaqDocuments(
  options: LoadFaqDocumentsOptions = {},
): Promise<readonly FaqDocument[]> {
  const canonicalRoot = await resolveFaqRoot(
    resolve(options.faqRoot ?? resolveDefaultFaqRoot()),
  )
  const issues: FaqValidationIssue[] = []
  const indexedDocuments: Array<{ document: FaqDocument; file: string }> = []

  const rootEntries = await readdir(canonicalRoot, { withFileTypes: true })
  const expectedCategories = new Set<string>(faqCategories)
  for (const entry of rootEntries) {
    if (!expectedCategories.has(entry.name)) {
      issues.push({
        file: entry.name,
        message: 'A raiz FAQ deve conter somente os diretórios de categoria permitidos.',
      })
    }
  }

  for (const category of faqCategories) {
    const result = await inspectCategory(canonicalRoot, category)
    issues.push(...result.issues)
    indexedDocuments.push(...result.documents)
  }

  const sourceIds = new Map<string, string>()
  const titles = new Map<string, string>()
  for (const { document, file } of indexedDocuments) {
    const existingSource = sourceIds.get(document.sourceId)
    if (existingSource) {
      issues.push({
        file,
        message: `sourceId duplicado; já utilizado em ${existingSource}.`,
      })
    } else {
      sourceIds.set(document.sourceId, file)
    }

    const normalizedTitle = normalizeTitle(document.title)
    const existingTitle = titles.get(normalizedTitle)
    if (existingTitle) {
      issues.push({
        file,
        message: `Título duplicado; já utilizado em ${existingTitle}.`,
      })
    } else {
      titles.set(normalizedTitle, file)
    }
  }

  if (issues.length > 0) throw new FaqContentValidationError(issues)

  return indexedDocuments
    .map(({ document }) => document)
    .sort((first, second) => first.sourceId.localeCompare(second.sourceId, 'en-US'))
}
