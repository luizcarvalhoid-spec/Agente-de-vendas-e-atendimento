import { createHash } from 'node:crypto'
import { lstat, mkdir, unlink, writeFile } from 'node:fs/promises'
import { basename, resolve } from 'node:path'

import {
  EXTERNAL_EVAL_REPORT_VERSION,
  externalEvalReportSchema,
  type ExternalEvalReport,
} from './external-eval-schema.js'

export class ExternalEvalReportWriteError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options)
    this.name = 'ExternalEvalReportWriteError'
  }
}

function escapeMarkdown(value: string) {
  return value.replace(/([\\`*_[\]{}()#+.!|>-])/g, '\\$1')
}

function score(value: number | undefined) {
  return value === undefined ? 'não disponível' : String(value)
}

export function serializeExternalEvalReport(reportInput: ExternalEvalReport) {
  return `${JSON.stringify(externalEvalReportSchema.parse(reportInput), null, 2)}\n`
}

export function renderExternalEvalReportMarkdown(
  reportInput: ExternalEvalReport,
) {
  const report = externalEvalReportSchema.parse(reportInput)
  const lines = [
    '# Relatório EVAL-07',
    '',
    '## Identificação',
    '',
    `- Dataset: ${escapeMarkdown(report.dataset.id)} ${escapeMarkdown(report.dataset.version)}`,
    `- Modalidade: ${escapeMarkdown(report.modality)}`,
    `- Proveniência: ${escapeMarkdown(report.provenance)}`,
    `- Evidência de desempenho: ${escapeMarkdown(report.performanceEvidence)}`,
    `- Modelo solicitado: ${escapeMarkdown(report.model.requestedId)}`,
    `- Modelos informados pelo transporte: ${report.model.providerReportedIds.length === 0 ? 'não informado' : report.model.providerReportedIds.map(escapeMarkdown).join(', ')}`,
    '',
    '## Execução',
    '',
    '| Métrica | Valor |',
    '| --- | ---: |',
    `| Cenários | ${report.execution.scenarios} |`,
    `| Cenários concluídos | ${report.execution.completedScenarios} |`,
    `| Falhas técnicas | ${report.execution.technicalFailures} |`,
    `| Turnos concluídos | ${report.execution.completedTurns} |`,
    `| Chamadas ao modelo | ${report.execution.modelCalls} |`,
    `| Ferramentas solicitadas | ${report.execution.toolCallsRequested} |`,
    `| Ferramentas executadas | ${report.execution.toolsExecuted} |`,
    `| Solicitações rejeitadas | ${report.execution.toolRejections} |`,
    `| Falhas de ferramenta | ${report.execution.toolFailures} |`,
    `| Encerramentos antecipados | ${report.execution.earlyCompletions} |`,
    '',
    '## Consumo preventivo',
    '',
    `- Tokens reportados: ${report.consumption.reportedTotalTokens}`,
    `- Tokens reservados/estimados: ${report.consumption.estimatedTokens}`,
    `- Chamadas sem medição completa: ${report.consumption.callsWithoutCompleteUsage}`,
    `- Custo estimado: USD ${report.consumption.estimatedCostUsd}`,
    `- Custo preventivamente contabilizado: USD ${report.consumption.chargedCostUsd}`,
    `- Orçamento: USD ${report.consumption.maxBudgetUsd}`,
    '- O custo é estimado e poderá diferir da cobrança futura do provedor.',
    '',
    '## Avaliação objetiva',
    '',
    `- Assertions aprovadas: ${report.objectiveEvaluation.summary.assertions.passed}`,
    `- Assertions reprovadas: ${report.objectiveEvaluation.summary.assertions.failed}`,
    `- Assertions não avaliadas: ${report.objectiveEvaluation.summary.assertions.notEvaluated}`,
    `- Falhas críticas: ${report.objectiveEvaluation.summary.criticalFailures}`,
    `- Nota bruta: ${score(report.objectiveEvaluation.summary.objectiveScore?.raw)}`,
    `- Nota final: ${score(report.objectiveEvaluation.summary.objectiveScore?.final)}`,
    `- Nota parcial: ${report.objectiveEvaluation.summary.objectiveScore?.partial === true ? 'sim' : 'não'}`,
    `- Critérios humanos pendentes: ${report.objectiveEvaluation.summary.requiredHumanCriteriaPending}`,
    '',
    '## Limitações',
    '',
    ...report.limitations.map((limitation) =>
      `- ${escapeMarkdown(limitation)}`,
    ),
    '',
  ]
  return lines.join('\n')
}

function safeSegment(value: string) {
  if (!/^[A-Za-z0-9._-]+$/.test(value)) {
    throw new ExternalEvalReportWriteError(
      'A identidade do relatório não pode ser usada como nome de arquivo.',
    )
  }
  return value
}

export function externalEvalReportFileNames(reportInput: ExternalEvalReport) {
  const report = externalEvalReportSchema.parse(reportInput)
  const scope = createHash('sha256')
    .update(report.selectedScenarioIds.join('\n'))
    .digest('hex')
    .slice(0, 12)
  const stem = `${safeSegment(report.dataset.id)}-${safeSegment(report.dataset.version)}-${safeSegment(report.modality)}-${scope}.external-eval.v${EXTERNAL_EVAL_REPORT_VERSION}`
  return { json: `${stem}.json`, markdown: `${stem}.md` }
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

export async function writeExternalEvalReports(
  reportInput: ExternalEvalReport,
  directoryInput: string,
) {
  if (directoryInput.trim().length === 0) {
    throw new ExternalEvalReportWriteError(
      'Informe explicitamente o diretório dos relatórios EVAL-07.',
    )
  }
  const report = externalEvalReportSchema.parse(reportInput)
  const directory = resolve(directoryInput)
  const names = externalEvalReportFileNames(report)
  const targets = [
    {
      format: 'json' as const,
      path: resolve(directory, names.json),
      content: serializeExternalEvalReport(report),
    },
    {
      format: 'markdown' as const,
      path: resolve(directory, names.markdown),
      content: renderExternalEvalReportMarkdown(report),
    },
  ]
  try {
    await mkdir(directory, { recursive: true })
    if (!(await lstat(directory)).isDirectory()) {
      throw new ExternalEvalReportWriteError(
        'O destino EVAL-07 não é um diretório.',
      )
    }
    for (const target of targets) {
      if (await exists(target.path)) {
        throw new ExternalEvalReportWriteError(
          `O arquivo ${basename(target.path)} já existe; nada foi sobrescrito.`,
        )
      }
    }
  } catch (error) {
    if (error instanceof ExternalEvalReportWriteError) throw error
    throw new ExternalEvalReportWriteError(
      'Não foi possível preparar os relatórios EVAL-07.',
      { cause: error },
    )
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
          // Rollback best effort limitado aos arquivos desta operação.
        }
      }),
    )
    throw new ExternalEvalReportWriteError(
      'Não foi possível gravar os relatórios EVAL-07.',
      { cause: error },
    )
  }
  return { json: targets[0]!.path, markdown: targets[1]!.path }
}
