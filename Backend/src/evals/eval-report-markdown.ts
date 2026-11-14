import { sanitizeEvalReportText } from './eval-report-builder.js'
import {
  evalReportSchema,
  type EvalReport,
  type EvalReportAssertion,
} from './eval-report-schema.js'

function escapeMarkdown(value: string | number | boolean) {
  return sanitizeEvalReportText(String(value))
    .replace(/\r?\n/g, ' ')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/:/g, '&#58;')
    .replace(/@/g, '&#64;')
    .replace(/([\\`*_{}\[\]()#+.!|~-])/g, '\\$1')
}

function listValue(values: readonly string[]) {
  return values.length === 0
    ? 'nenhum'
    : values.map(escapeMarkdown).join(', ')
}

function scoreValue(value: number | undefined) {
  return value === undefined ? 'não calculada' : String(value)
}

interface LocatedAssertion {
  readonly scenarioId: string
  readonly turn: number
  readonly assertion: EvalReportAssertion
}

function assertionRows(assertions: readonly LocatedAssertion[]) {
  if (assertions.length === 0) return ['Nenhuma.']
  return [
    '| Cenário | Turno | Assertion | Critério | Tipo | Severidade | Justificativa | Evidências |',
    '| --- | ---: | --- | --- | --- | --- | --- | --- |',
    ...assertions.map(
      ({ scenarioId, turn, assertion }) =>
        `| ${escapeMarkdown(scenarioId)} | ${turn} | ${escapeMarkdown(assertion.assertionId)} | ${escapeMarkdown(assertion.criterionId)} | ${escapeMarkdown(assertion.type)} | ${escapeMarkdown(assertion.severity)} | ${escapeMarkdown(assertion.reason)} | ${listValue(assertion.evidenceReferences)} |`,
    ),
  ]
}

export function renderEvalReportMarkdown(input: EvalReport) {
  const report = evalReportSchema.parse(input)
  const partial =
    report.coverage.datasetCoverage === 'partial' ||
    report.summary.objectiveScore?.partial === true
  const failedAssertions = report.scenarios.flatMap((scenario) =>
    scenario.turns.flatMap((turn) =>
      turn.assertions
        .filter((assertion) => assertion.status === 'failed')
        .map((assertion) => ({
          scenarioId: scenario.id,
          turn: turn.index,
          assertion,
        })),
    ),
  )
  const notEvaluatedAssertions = report.scenarios.flatMap((scenario) =>
    scenario.turns.flatMap((turn) =>
      turn.assertions.filter(
        (assertion) => assertion.status === 'not_evaluated',
      ).map((assertion) => ({
        scenarioId: scenario.id,
        turn: turn.index,
        assertion,
      })),
    ),
  )
  const criticalFailures = failedAssertions.filter(
    ({ assertion }) => assertion.severity === 'critical',
  )
  const humanPending = report.scenarios.flatMap((scenario) =>
    scenario.criteria
      .filter((criterion) => criterion.humanReviewPending)
      .map((criterion) => ({ scenarioId: scenario.id, criterion })),
  )

  const lines = [
    `# Relatório de avaliação${partial ? ' — PARCIAL' : ''}`,
    '',
    `Dataset: **${escapeMarkdown(report.dataset.id)}** — versão ${escapeMarkdown(report.dataset.version)}`,
    '',
    '> Limitação: esta execução offline utiliza um modelo determinístico. Aprovação objetiva não equivale a uma avaliação completa de naturalidade ou qualidade conversacional.',
    '',
    '## Identificação',
    '',
    `- Formato do relatório: ${report.reportVersion}`,
    `- Modo: ${escapeMarkdown(report.execution.mode)}`,
    `- Mecanismo: ${escapeMarkdown(report.execution.evaluationEngine)}`,
    `- Escopo: ${escapeMarkdown(report.coverage.scope)}`,
    `- Cobertura do dataset: ${escapeMarkdown(report.coverage.datasetCoverage)}`,
    `- Escopo concluído: ${report.coverage.completeForScope ? 'sim' : 'não'}`,
    ...(report.execution.generatedAt === undefined
      ? []
      : [`- Gerado em: ${escapeMarkdown(report.execution.generatedAt)}`]),
    '',
    '## Cobertura',
    '',
    `- Cenários esperados: ${listValue(report.coverage.expectedScenarioIds)}`,
    `- Cenários avaliados: ${listValue(report.coverage.evaluatedScenarioIds)}`,
    `- Cenários ausentes: ${listValue(report.coverage.missingScenarioIds)}`,
    `- Cenários excluídos: ${listValue(report.coverage.excludedScenarioIds)}`,
    '',
    '## Resumo executivo',
    '',
    '| Métrica | Valor |',
    '| --- | ---: |',
    `| Cenários esperados | ${report.summary.scenarios.expected} |`,
    `| Cenários avaliados | ${report.summary.scenarios.evaluated} |`,
    `| Execuções concluídas | ${report.summary.scenarios.completed} |`,
    `| Falhas técnicas | ${report.summary.scenarios.technicalFailures} |`,
    `| Não executados | ${report.summary.scenarios.notExecuted} |`,
    `| Assertions aprovadas | ${report.summary.assertions.passed} |`,
    `| Assertions reprovadas | ${report.summary.assertions.failed} |`,
    `| Assertions não avaliadas | ${report.summary.assertions.notEvaluated} |`,
    `| Falhas críticas | ${report.summary.criticalFailures} |`,
    `| Critérios humanos obrigatórios pendentes | ${report.summary.requiredHumanCriteriaPending} |`,
    `| Status objetivo | ${escapeMarkdown(report.summary.objectiveStatus)} |`,
    `| Status geral | ${escapeMarkdown(report.summary.overallStatus)} |`,
    `| Nota objetiva bruta | ${scoreValue(report.summary.objectiveScore?.raw)} |`,
    `| Nota objetiva final | ${scoreValue(report.summary.objectiveScore?.final)} |`,
    `| Nota parcial | ${report.summary.objectiveScore?.partial === true ? 'sim' : 'não'} |`,
    '',
    '## Resultados por cenário',
    '',
    '| Cenário | Categoria | Dificuldade | Severidade | Técnico | Objetivo | Nota final | Parcial |',
    '| --- | --- | --- | --- | --- | --- | ---: | --- |',
    ...report.scenarios.map(
      (scenario) =>
        `| ${escapeMarkdown(scenario.id)} | ${escapeMarkdown(scenario.category)} | ${escapeMarkdown(scenario.difficulty)} | ${escapeMarkdown(scenario.severity)} | ${escapeMarkdown(scenario.technicalStatus)} | ${escapeMarkdown(scenario.objectiveStatus)} | ${scoreValue(scenario.objectiveScore?.final)} | ${scenario.objectiveScore?.partial === true ? 'sim' : 'não'} |`,
    ),
    '',
    '## Notas objetivas',
    '',
    `- Nota bruta: ${scoreValue(report.summary.objectiveScore?.raw)}`,
    `- Nota final: ${scoreValue(report.summary.objectiveScore?.final)}`,
    `- Parcial: ${report.summary.objectiveScore?.partial === true ? 'sim' : 'não'}`,
    '',
    '## Falhas críticas',
    '',
    ...(criticalFailures.length === 0
      ? ['Nenhuma falha crítica.']
      : [
          `**Foram encontradas ${criticalFailures.length} falhas críticas. O veto limita a nota final a 3 sem alterar a nota bruta.**`,
          '',
          ...assertionRows(criticalFailures),
        ]),
    '',
    '## Assertions reprovadas',
    '',
    ...assertionRows(failedAssertions),
    '',
    '## Assertions não avaliadas',
    '',
    ...assertionRows(notEvaluatedAssertions),
    '',
    '## Pendências humanas',
    '',
    ...(humanPending.length === 0
      ? ['Nenhuma pendência humana obrigatória.']
      : [
          '| Cenário | Critério | Tipo | Status |',
          '| --- | --- | --- | --- |',
          ...humanPending.map(
            ({ scenarioId, criterion }) =>
              `| ${escapeMarkdown(scenarioId)} | ${escapeMarkdown(criterion.criterionId)} | ${escapeMarkdown(criterion.criterion)} | ${escapeMarkdown(criterion.status)} |`,
          ),
        ]),
    '',
    '## Detalhamento',
    '',
  ]

  for (const scenario of report.scenarios) {
    lines.push(
      `### ${escapeMarkdown(scenario.id)}`,
      '',
      `- Status técnico: ${escapeMarkdown(scenario.technicalStatus)}`,
      `- Status objetivo: ${escapeMarkdown(scenario.objectiveStatus)}`,
      `- Status geral: ${escapeMarkdown(scenario.overallStatus)}`,
      `- Nota bruta: ${scoreValue(scenario.objectiveScore?.raw)}`,
      `- Nota final: ${scoreValue(scenario.objectiveScore?.final)}`,
      `- Falhas críticas: ${scenario.criticalFailures}`,
      `- Pendências humanas obrigatórias: ${scenario.requiredHumanCriteriaPending}`,
      '',
      '#### Critérios',
      '',
      '| ID | Critério | Tipo | Aplicabilidade | Status | Peso | Assertions | Nota | Parcial | Revisão humana |',
      '| --- | --- | --- | --- | --- | ---: | --- | ---: | --- | --- |',
      ...scenario.criteria.map(
        (criterion) =>
          `| ${escapeMarkdown(criterion.criterionId)} | ${escapeMarkdown(criterion.criterion)} | ${escapeMarkdown(criterion.kind)} | ${escapeMarkdown(criterion.applicability)} | ${escapeMarkdown(criterion.status)} | ${criterion.weight ?? '—'} | ${listValue(criterion.assertionIds)} | ${scoreValue(criterion.score)} | ${criterion.partial ? 'sim' : 'não'} | ${criterion.humanReviewPending ? 'pendente' : 'não'} |`,
      ),
      '',
    )

    for (const turn of scenario.turns) {
      lines.push(
        `#### Turno ${turn.index}`,
        '',
        `- Cenário: ${escapeMarkdown(turn.scenarioId)}`,
        `- Status técnico: ${escapeMarkdown(turn.technicalStatus)}`,
        `- Tipo de resposta: ${turn.responseType === undefined ? 'indisponível' : escapeMarkdown(turn.responseType)}`,
        ...(turn.technicalErrorCode === undefined
          ? []
          : [
              `- Código de falha técnica: ${escapeMarkdown(turn.technicalErrorCode)}`,
            ]),
        '',
        '| Assertion | Critério | Tipo | Severidade | Status | Justificativa | Evidências |',
        '| --- | --- | --- | --- | --- | --- | --- |',
        ...(turn.assertions.length === 0
          ? ['| nenhuma | — | — | — | — | — | — |']
          : turn.assertions.map(
              (assertion) =>
                `| ${escapeMarkdown(assertion.assertionId)} | ${escapeMarkdown(assertion.criterionId)} | ${escapeMarkdown(assertion.type)} | ${escapeMarkdown(assertion.severity)} | ${escapeMarkdown(assertion.status)} | ${escapeMarkdown(assertion.reason)} | ${listValue(assertion.evidenceReferences)} |`,
            )),
        '',
      )
    }
  }

  lines.push(
    '## Limitações da avaliação',
    '',
    ...report.limitations.map(
      (limitation) => `- ${escapeMarkdown(limitation)}`,
    ),
    '',
  )

  return lines.join('\n')
}
