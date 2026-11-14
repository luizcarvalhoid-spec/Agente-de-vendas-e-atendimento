import { readFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import {
  HUMAN_EVAL_RUBRIC_SCHEMA_VERSION,
  humanEvalRubricSchema,
  type HumanEvalRubric,
} from './human-eval-rubric-schema.js'

export const DEFAULT_HUMAN_EVAL_RUBRIC =
  'rubrics/universal-conversation.v1.json' as const

export class HumanEvalRubricError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options)
    this.name = 'HumanEvalRubricError'
  }
}

function resolveEvalRoot(moduleUrl: string = import.meta.url) {
  return resolve(dirname(fileURLToPath(moduleUrl)), '../../evals')
}

export function resolveDefaultHumanEvalRubric(
  moduleUrl: string = import.meta.url,
) {
  return resolve(resolveEvalRoot(moduleUrl), DEFAULT_HUMAN_EVAL_RUBRIC)
}

export function parseHumanEvalRubric(value: unknown): HumanEvalRubric {
  if (
    typeof value === 'object' &&
    value !== null &&
    'schemaVersion' in value &&
    value.schemaVersion !== HUMAN_EVAL_RUBRIC_SCHEMA_VERSION
  ) {
    throw new HumanEvalRubricError(
      `Versão de rubrica incompatível; esperado ${HUMAN_EVAL_RUBRIC_SCHEMA_VERSION}.`,
    )
  }
  const result = humanEvalRubricSchema.safeParse(value)
  if (!result.success) {
    throw new HumanEvalRubricError(
      'A rubrica humana não atende ao contrato versionado.',
      { cause: result.error },
    )
  }
  return result.data
}

export async function loadHumanEvalRubric(
  path = resolveDefaultHumanEvalRubric(),
) {
  let raw: string
  try {
    raw = await readFile(path, 'utf8')
  } catch (error) {
    throw new HumanEvalRubricError('Não foi possível ler a rubrica local.', {
      cause: error,
    })
  }
  let value: unknown
  try {
    value = JSON.parse(raw) as unknown
  } catch (error) {
    throw new HumanEvalRubricError('A rubrica local não contém JSON válido.', {
      cause: error,
    })
  }
  return parseHumanEvalRubric(value)
}
