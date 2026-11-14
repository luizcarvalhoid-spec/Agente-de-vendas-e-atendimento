import { lstat, mkdir, unlink, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'

import { serializeEvalRegressionReport } from './eval-regression.js'
import { renderEvalRegressionMarkdown } from './eval-regression-markdown.js'
import {
  EVAL_REGRESSION_REPORT_VERSION,
  evalRegressionReportSchema,
  type EvalRegressionReport,
} from './eval-regression-schema.js'

export class EvalRegressionWriteError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options)
    this.name = 'EvalRegressionWriteError'
  }
}

async function exists(path: string) {
  try {
    await lstat(path)
    return true
  } catch (error) {
    if (
      typeof error === 'object' &&
      error !== null &&
      'code' in error &&
      error.code === 'ENOENT'
    ) {
      return false
    }
    throw error
  }
}

function safe(value: string) {
  if (!/^[A-Za-z0-9._-]+$/.test(value)) {
    throw new EvalRegressionWriteError(
      'O identificador do dataset não gera um nome de arquivo seguro.',
    )
  }
  return value
}

export async function writeEvalRegressionReports(
  reportInput: EvalRegressionReport,
  directoryInput: string,
) {
  if (directoryInput.trim().length === 0) {
    throw new EvalRegressionWriteError(
      'Informe explicitamente o diretório dos relatórios de regressão.',
    )
  }
  const report = evalRegressionReportSchema.parse(reportInput)
  const directory = resolve(directoryInput)
  await mkdir(directory, { recursive: true })
  const stem = `${safe(report.current.datasetId)}-${safe(report.current.datasetVersion)}.regression-report.v${EVAL_REGRESSION_REPORT_VERSION}`
  const targets = [
    {
      kind: 'json' as const,
      path: resolve(directory, `${stem}.json`),
      content: serializeEvalRegressionReport(report),
    },
    {
      kind: 'markdown' as const,
      path: resolve(directory, `${stem}.md`),
      content: renderEvalRegressionMarkdown(report),
    },
  ]
  for (const target of targets) {
    if (await exists(target.path)) {
      throw new EvalRegressionWriteError(
        'Um relatório de regressão já existe; nada foi sobrescrito.',
      )
    }
  }
  const created: string[] = []
  try {
    for (const target of targets) {
      await writeFile(target.path, target.content, {
        encoding: 'utf8',
        flag: 'wx',
      })
      created.push(target.path)
    }
  } catch (error) {
    await Promise.all(
      created.map(async (path) => {
        try {
          await unlink(path)
        } catch {
          // Rollback restrito aos arquivos criados nesta chamada.
        }
      }),
    )
    throw new EvalRegressionWriteError(
      'Não foi possível gravar os relatórios de regressão.',
      { cause: error },
    )
  }
  return Object.fromEntries(
    targets.map((target) => [target.kind, target.path]),
  )
}
