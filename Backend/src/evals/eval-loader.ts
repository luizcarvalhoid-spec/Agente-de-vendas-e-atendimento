import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import {
  EVAL_DATASET_SCHEMA_VERSION,
  evalDatasetSchema,
  type EvalCase,
  type EvalDataset,
} from './eval-dataset-schema.js'

export interface EvalDatasetValidationIssue {
  readonly path: string
  readonly message: string
}

export interface LoadedEvalCase {
  readonly index: number
  readonly sourcePath: string
  readonly scenario: EvalCase
}

export interface LoadedEvalDataset {
  readonly sourcePath: string
  readonly data: EvalDataset
  readonly cases: readonly LoadedEvalCase[]
}

export class EvalDatasetLoadError extends Error {
  readonly sourcePath: string
  readonly kind: 'read' | 'json' | 'version' | 'schema'
  readonly issues: readonly EvalDatasetValidationIssue[]

  constructor(options: {
    sourcePath: string
    kind: EvalDatasetLoadError['kind']
    message: string
    issues?: readonly EvalDatasetValidationIssue[]
    cause?: unknown
  }) {
    super(options.message, { cause: options.cause })
    this.name = 'EvalDatasetLoadError'
    this.sourcePath = options.sourcePath
    this.kind = options.kind
    this.issues = options.issues ?? []
  }
}

function formatPath(path: PropertyKey[]) {
  if (path.length === 0) return '<root>'
  return path.reduce<string>((formatted, segment) => {
    if (typeof segment === 'number') return `${formatted}[${segment}]`
    const key = String(segment)
    return formatted.length === 0 ? key : `${formatted}.${key}`
  }, '')
}

function sourcePathFrom(input: string | URL) {
  if (input instanceof URL) {
    if (input.protocol !== 'file:') {
      throw new EvalDatasetLoadError({
        sourcePath: input.toString(),
        kind: 'read',
        message: 'O loader aceita apenas caminhos locais ou URLs file:.',
      })
    }
    return fileURLToPath(input)
  }
  return resolve(input)
}

function assertCompatibleVersion(value: unknown, sourcePath: string) {
  if (
    typeof value === 'object' &&
    value !== null &&
    'schemaVersion' in value &&
    typeof value.schemaVersion === 'number' &&
    value.schemaVersion !== EVAL_DATASET_SCHEMA_VERSION
  ) {
    throw new EvalDatasetLoadError({
      sourcePath,
      kind: 'version',
      message: `Versão de schema incompatível: ${value.schemaVersion}. Versão suportada: ${EVAL_DATASET_SCHEMA_VERSION}.`,
      issues: [
        {
          path: 'schemaVersion',
          message: `Esperado ${EVAL_DATASET_SCHEMA_VERSION}, recebido ${value.schemaVersion}.`,
        },
      ],
    })
  }
}

export function parseEvalDataset(
  value: unknown,
  sourcePath = '<memory>',
): LoadedEvalDataset {
  assertCompatibleVersion(value, sourcePath)
  const result = evalDatasetSchema.safeParse(value)
  if (!result.success) {
    const issues = result.error.issues.map((issue) => ({
      path: formatPath(issue.path),
      message: issue.message,
    }))
    throw new EvalDatasetLoadError({
      sourcePath,
      kind: 'schema',
      message: `Dataset de avaliação inválido em ${sourcePath}: ${issues
        .map((issue) => `${issue.path}: ${issue.message}`)
        .join('; ')}`,
      issues,
      cause: result.error,
    })
  }

  return {
    sourcePath,
    data: result.data,
    cases: result.data.cases.map((scenario, index) => ({
      index,
      sourcePath: `${sourcePath}#cases[${index}](${scenario.id})`,
      scenario,
    })),
  }
}

export async function loadEvalDataset(input: string | URL) {
  const sourcePath = sourcePathFrom(input)
  let raw: string
  try {
    raw = await readFile(sourcePath, 'utf8')
  } catch (error) {
    if (error instanceof EvalDatasetLoadError) throw error
    throw new EvalDatasetLoadError({
      sourcePath,
      kind: 'read',
      message: `Não foi possível ler o dataset de avaliação em ${sourcePath}.`,
      cause: error,
    })
  }

  let value: unknown
  try {
    value = JSON.parse(raw) as unknown
  } catch (error) {
    throw new EvalDatasetLoadError({
      sourcePath,
      kind: 'json',
      message: `JSON inválido no dataset de avaliação em ${sourcePath}.`,
      issues: [{ path: '<root>', message: String(error) }],
      cause: error,
    })
  }

  return parseEvalDataset(value, sourcePath)
}
