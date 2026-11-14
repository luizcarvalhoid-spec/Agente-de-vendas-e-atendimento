import { createHash } from 'node:crypto'
import { lstat, mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'

import { loadCatalogRepository } from '../catalog/catalog-repository.js'
import { loadFaqDocuments } from '../knowledge/faq-content-loader.js'
import {
  EVAL_BASELINE_CAPTURE_TOOL,
  EVAL_BASELINE_VERSION,
  evalBaselineSchema,
  type EvalBaseline,
  type EvalReferenceDataFingerprints,
} from './eval-baseline-schema.js'
import type { LoadedEvalDataset } from './eval-loader.js'
import { sanitizeEvalReportText } from './eval-report-builder.js'
import {
  EVAL_REPORT_ENGINE,
  EVAL_REPORT_FORMAT_VERSION,
  evalReportSchema,
  type EvalReport,
} from './eval-report-schema.js'

export class EvalBaselineError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options)
    this.name = 'EvalBaselineError'
  }
}

function assertSanitizedReport(report: EvalReport) {
  for (const scenario of report.scenarios) {
    for (const turn of scenario.turns) {
      if (
        turn.technicalErrorCode !== undefined &&
        sanitizeEvalReportText(turn.technicalErrorCode) !==
          turn.technicalErrorCode
      ) {
        throw new EvalBaselineError(
          'O relatório contém código técnico não sanitizado.',
        )
      }
      for (const assertion of turn.assertions) {
        if (
          sanitizeEvalReportText(assertion.reason) !== assertion.reason ||
          assertion.evidenceReferences.some(
            (reference) =>
              sanitizeEvalReportText(reference) !== reference,
          )
        ) {
          throw new EvalBaselineError(
            'O relatório contém evidência textual não sanitizada.',
          )
        }
      }
    }
  }
}

function stableValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stableValue)
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, item]) => [key, stableValue(item)]),
    )
  }
  return value
}

export function fingerprintEvalValue(value: unknown) {
  const serialized = JSON.stringify(stableValue(value))
  return `sha256:${createHash('sha256').update(serialized).digest('hex')}`
}

export function fingerprintEvalDataset(loaded: LoadedEvalDataset) {
  return fingerprintEvalValue(loaded.data)
}

export async function fingerprintEvalReferenceData(): Promise<EvalReferenceDataFingerprints> {
  const [catalog, faq] = await Promise.all([
    loadCatalogRepository(),
    loadFaqDocuments(),
  ])
  return {
    catalogFingerprint: fingerprintEvalValue(catalog.listAll()),
    faqFingerprint: fingerprintEvalValue(faq),
  }
}

function baselineId(report: EvalReport, datasetFingerprint: string) {
  const scope =
    report.coverage.scope === 'full_dataset'
      ? 'full'
      : `selected-${createHash('sha256')
          .update(report.coverage.expectedScenarioIds.join('\n'))
          .digest('hex')
          .slice(0, 12)}`
  return `${report.dataset.id}.${report.dataset.version}.${scope}.${datasetFingerprint.slice(-12)}`
}

export function buildEvalBaseline(
  loaded: LoadedEvalDataset,
  reportInput: EvalReport,
  referenceData: EvalReferenceDataFingerprints,
): EvalBaseline {
  const report = evalReportSchema.parse(reportInput)
  assertSanitizedReport(report)
  if (
    report.dataset.id !== loaded.data.dataset.id ||
    report.dataset.version !== loaded.data.dataset.version
  ) {
    throw new EvalBaselineError(
      'O relatório não corresponde ao dataset validado.',
    )
  }
  if (
    !report.coverage.completeForScope ||
    report.coverage.missingScenarioIds.length > 0 ||
    report.summary.scenarios.technicalFailures > 0 ||
    report.summary.scenarios.notExecuted > 0
  ) {
    throw new EvalBaselineError(
      'A captura exige execução tecnicamente concluída e cobertura completa para o escopo.',
    )
  }
  const datasetFingerprint = fingerprintEvalDataset(loaded)
  return evalBaselineSchema.parse({
    baselineVersion: EVAL_BASELINE_VERSION,
    baselineId: baselineId(report, datasetFingerprint),
    dataset: {
      id: report.dataset.id,
      version: report.dataset.version,
      fingerprint: datasetFingerprint,
    },
    execution: {
      mode: 'offline',
      reportVersion: EVAL_REPORT_FORMAT_VERSION,
      evaluationEngine: EVAL_REPORT_ENGINE,
      captureTool: EVAL_BASELINE_CAPTURE_TOOL,
    },
    referenceData: { ...referenceData },
    scope: {
      kind: report.coverage.scope,
      completeForScope: true,
      datasetCoverage: report.coverage.datasetCoverage,
      expectedScenarioIds: [...report.coverage.expectedScenarioIds],
    },
    reference: structuredClone(report),
  })
}

export function serializeEvalBaseline(baselineInput: EvalBaseline) {
  return `${JSON.stringify(evalBaselineSchema.parse(baselineInput), null, 2)}\n`
}

export async function loadEvalBaseline(pathInput: string) {
  const path = resolve(pathInput)
  let raw: string
  try {
    raw = await readFile(path, 'utf8')
  } catch (error) {
    throw new EvalBaselineError('Não foi possível ler o baseline local.', {
      cause: error,
    })
  }
  let value: unknown
  try {
    value = JSON.parse(raw) as unknown
  } catch (error) {
    throw new EvalBaselineError('O baseline não contém JSON válido.', {
      cause: error,
    })
  }
  const result = evalBaselineSchema.safeParse(value)
  if (!result.success) {
    throw new EvalBaselineError(
      'O baseline não atende ao contrato versionado.',
      { cause: result.error },
    )
  }
  assertSanitizedReport(result.data.reference)
  return result.data
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

export async function writeEvalBaseline(
  baselineInput: EvalBaseline,
  pathInput: string,
) {
  if (pathInput.trim().length === 0) {
    throw new EvalBaselineError(
      'Informe explicitamente o arquivo de destino do baseline.',
    )
  }
  const baseline = evalBaselineSchema.parse(baselineInput)
  const path = resolve(pathInput)
  try {
    await mkdir(dirname(path), { recursive: true })
    if (await exists(path)) {
      throw new EvalBaselineError(
        'O baseline já existe; referências aprovadas não são sobrescritas.',
      )
    }
    await writeFile(path, serializeEvalBaseline(baseline), {
      encoding: 'utf8',
      flag: 'wx',
    })
  } catch (error) {
    if (error instanceof EvalBaselineError) throw error
    throw new EvalBaselineError('Não foi possível gravar o baseline.', {
      cause: error,
    })
  }
  return path
}
