import {
  evalRegressionReportSchema,
  type EvalRegressionReport,
} from './eval-regression-schema.js'

function escapeMarkdown(value: string) {
  return value
    .replace(/\\/g, '\\\\')
    .replace(/([`*_[\]{}()#+.!|<>-])/g, '\\$1')
}

function value(value: string | number | boolean | undefined) {
  return value === undefined ? 'não disponível' : escapeMarkdown(String(value))
}

export function renderEvalRegressionMarkdown(
  reportInput: EvalRegressionReport,
) {
  const report = evalRegressionReportSchema.parse(reportInput)
  const lines = [
    '# Relatório de regressão objetiva',
    '',
    `- Resultado: **${value(report.result)}**`,
    `- Baseline: ${value(report.baseline.id)}`,
    `- Dataset: ${value(report.current.datasetId)} ${value(report.current.datasetVersion)}`,
    `- Compatibilidade: ${value(report.compatibility.status)}`,
    `- Revisões humanas obrigatórias pendentes: ${value(report.current.requiredHumanCriteriaPending)}`,
    '',
    '## Resumo',
    '',
    '| Regressões | Perdas de evidência | Melhorias | Falhas conhecidas | Novas falhas | Novas falhas críticas | Problemas técnicos |',
    '| ---: | ---: | ---: | ---: | ---: | ---: | ---: |',
    `| ${report.summary.regressions} | ${report.summary.evidenceLosses} | ${report.summary.improvements} | ${report.summary.knownFailures} | ${report.summary.newlyDetectedFailures} | ${report.summary.newCriticalFailures} | ${report.summary.technicalProblems} |`,
    '',
    '## Notas objetivas preservadas',
    '',
    '| Medida | Baseline | Atual | Diferença |',
    '| --- | ---: | ---: | ---: |',
    `| Bruta | ${value(report.score.baseline?.raw)} | ${value(report.score.current?.raw)} | ${value(report.score.rawDelta)} |`,
    `| Final | ${value(report.score.baseline?.final)} | ${value(report.score.current?.final)} | ${value(report.score.finalDelta)} |`,
    `| Parcial | ${value(report.score.baseline?.partial)} | ${value(report.score.current?.partial)} | — |`,
    `| Falhas críticas | ${value(report.score.baseline?.criticalFailures)} | ${value(report.score.current?.criticalFailures)} | — |`,
    '',
    '## Compatibilidade e cobertura',
    '',
    `- Escopo do baseline: ${value(report.coverage.baselineScope)}`,
    `- Escopo atual: ${value(report.coverage.currentScope)}`,
    `- Cobertura atual completa: ${value(report.coverage.currentComplete)}`,
    `- Cenários ausentes: ${report.coverage.missingScenarioIds.length === 0 ? 'nenhum' : report.coverage.missingScenarioIds.map(escapeMarkdown).join(', ')}`,
    '',
  ]

  if (report.compatibility.issues.length > 0) {
    lines.push('### Incompatibilidades', '')
    for (const issue of report.compatibility.issues) {
      lines.push(
        `- **${value(issue.code)}**${issue.scenarioId === undefined ? '' : ` em ${value(issue.scenarioId)}`}${issue.assertionId === undefined ? '' : ` / ${value(issue.assertionId)}`}: ${value(issue.detail)}`,
      )
    }
    lines.push('')
  }

  if (report.technicalProblems.length > 0) {
    lines.push('## Problemas técnicos', '')
    for (const problem of report.technicalProblems) {
      lines.push(
        `- **${value(problem.code)}**${problem.scenarioId === undefined ? '' : ` em ${value(problem.scenarioId)}`}${problem.turn === undefined ? '' : ` / turno ${problem.turn}`}: ${value(problem.detail)}`,
      )
    }
    lines.push('')
  }

  lines.push('## Assertions', '')
  for (const scenario of report.scenarios) {
    lines.push(
      `### ${value(scenario.scenarioId)}`,
      '',
      '| Turno | Assertion | Tipo | Severidade | Baseline | Atual | Classificação | Crítica nova |',
      '| ---: | --- | --- | --- | --- | --- | --- | --- |',
    )
    for (const assertion of scenario.assertions) {
      lines.push(
        `| ${assertion.turn} | ${value(assertion.assertionId)} | ${value(assertion.type)} | ${value(assertion.severity)} | ${value(assertion.baselineStatus)} | ${value(assertion.currentStatus)} | ${value(assertion.classification)} | ${assertion.newCriticalFailure ? 'sim' : 'não'} |`,
      )
    }
    lines.push('')
  }

  lines.push('## Limitações', '')
  for (const limitation of report.limitations) {
    lines.push(`- ${value(limitation)}`)
  }
  lines.push('')
  return `${lines.join('\n')}\n`
}
