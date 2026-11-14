import { createHash } from 'node:crypto'
import {
  lstat,
  mkdir,
  unlink,
  writeFile,
} from 'node:fs/promises'
import { basename, resolve } from 'node:path'

import { serializeEvalReportJson } from './eval-report-builder.js'
import { renderEvalReportMarkdown } from './eval-report-markdown.js'
import {
  EVAL_REPORT_FORMAT_VERSION,
  evalReportSchema,
  type EvalReport,
} from './eval-report-schema.js'

export type EvalReportFormat = 'json' | 'markdown' | 'both'

export interface WriteEvalReportOptions {
  readonly directory: string
  readonly format: EvalReportFormat
}

export interface WrittenEvalReports {
  readonly json?: string
  readonly markdown?: string
}

export class EvalReportWriteError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options)
    this.name = 'EvalReportWriteError'
  }
}

function safeFileSegment(value: string, label: string) {
  if (!/^[A-Za-z0-9._-]+$/.test(value)) {
    throw new EvalReportWriteError(
      `${label} não pode ser usado no nome do relatório.`,
    )
  }
  return value
}

export function evalReportFileNames(reportInput: EvalReport) {
  const report = evalReportSchema.parse(reportInput)
  const datasetId = safeFileSegment(report.dataset.id, 'O ID do dataset')
  const datasetVersion = safeFileSegment(
    report.dataset.version,
    'A versão do dataset',
  )
  const scope =
    report.coverage.scope === 'full_dataset'
      ? 'full'
      : `selected-${createHash('sha256')
          .update(report.coverage.expectedScenarioIds.join('\n'))
          .digest('hex')
          .slice(0, 12)}`
  const stem = `${datasetId}-${datasetVersion}-${scope}.eval-report.v${EVAL_REPORT_FORMAT_VERSION}`
  return {
    json: `${stem}.json`,
    markdown: `${stem}.md`,
  }
}

async function pathExists(path: string) {
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

export async function writeEvalReportFiles(
  reportInput: EvalReport,
  options: WriteEvalReportOptions,
): Promise<WrittenEvalReports> {
  if (options.directory.trim().length === 0) {
    throw new EvalReportWriteError(
      'Informe explicitamente um diretório para os relatórios.',
    )
  }
  const report = evalReportSchema.parse(reportInput)
  const directory = resolve(options.directory)
  try {
    await mkdir(directory, { recursive: true })
    const directoryStat = await lstat(directory)
    if (!directoryStat.isDirectory()) {
      throw new EvalReportWriteError(
        'O destino selecionado não é um diretório.',
      )
    }
  } catch (error) {
    if (error instanceof EvalReportWriteError) throw error
    throw new EvalReportWriteError(
      'Não foi possível preparar o diretório de relatórios.',
      { cause: error },
    )
  }

  const names = evalReportFileNames(report)
  const requested =
    options.format === 'both'
      ? (['json', 'markdown'] as const)
      : ([options.format] as const)
  const targets = requested.map((format) => {
    const fileName = format === 'json' ? names.json : names.markdown
    return {
      format,
      fileName,
      path: resolve(directory, fileName),
      content:
        format === 'json'
          ? serializeEvalReportJson(report)
          : renderEvalReportMarkdown(report),
    }
  })

  for (const target of targets) {
    try {
      if (await pathExists(target.path)) {
        throw new EvalReportWriteError(
          `O arquivo ${basename(target.path)} já existe; nada foi sobrescrito.`,
        )
      }
    } catch (error) {
      if (error instanceof EvalReportWriteError) throw error
      throw new EvalReportWriteError(
        'Não foi possível verificar os arquivos de destino.',
        { cause: error },
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
          // O rollback é best effort e se limita aos arquivos desta chamada.
        }
      }),
    )
    throw new EvalReportWriteError(
      'Não foi possível gravar os relatórios; arquivos parciais foram removidos.',
      { cause: error },
    )
  }

  return Object.fromEntries(
    targets.map((target) => [target.format, target.path]),
  )
}
