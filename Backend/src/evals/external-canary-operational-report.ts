import type { CanaryOperationalReport } from './external-canary-operations.js'
import { writeExclusiveExternalEvalReportPair } from './external-eval-report.js'

function text(value: string | undefined) {
  return value === undefined ? 'pendente' : value
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/([\\`*_[\]{}()#+.!|-])/g, '\\$1').replace(/[\r\n]/g, ' ')
}

export function serializeCanaryOperationalReport(report: CanaryOperationalReport) {
  return `${JSON.stringify(report, null, 2)}\n`
}

export function renderCanaryOperationalMarkdown(report: CanaryOperationalReport) {
  const { plan, source, approval, rehearsal, financial } = report
  const money = (value?: number) => value === undefined ? 'pendente' : `USD ${value}`
  return [
    '# Prontidão operacional do canário',
    '',
    `- Contrato: v${report.reportVersion}`,
    `- Experimento: ${text(plan.experimentId)}`,
    `- Fingerprint: ${text(plan.manifestFingerprint)}`,
    `- Dataset e cenário: ${text(plan.datasetId)} / ${text(plan.scenarioId)}`,
    `- Modelo e provedor: ${text(plan.modelId)} / ${text(plan.providerId)}`,
    `- Commit aprovado: ${text(plan.approvedCodeRevision)}`,
    `- Commit verificado: ${text(source?.commit)}`,
    `- Fingerprint do checkout: ${text(source?.worktreeFingerprint)}`,
    `- Fingerprints do lockfile e das dependências: ${text(source?.lockfileFingerprint)} / ${text(source?.dependenciesFingerprint)}`,
    `- Aprovação, autoridade e escopo: ${text(approval?.authorizationId)} / ${text(approval?.authorityId)} / ${text(approval?.scope)}`,
    `- Validade até: ${text(approval?.expiresAt)}`,
    `- Estado da autorização de uso único: ${text(report.authorizationUse)}`,
    '- Execução externa autorizada: não',
    '- Execução externa realizada: não',
    '',
    '## Verificações e pendências',
    '',
    ...Object.entries(report.checks).map(([name, passed]) => `- ${text(name)}: ${passed ? 'sim' : 'não'}`),
    ...Object.entries(plan.requirements).map(([name, status]) => `- ${text(name)}: ${text(status)}`),
    ...plan.issues.map((issue) => `- ${text(issue.code)}${issue.field ? ` (${text(issue.field)})` : ''}`),
    '',
    '## Bloqueios',
    '',
    ...report.blockers.map((code) => `- ${text(code)}`),
    '',
    '## Financeiro',
    '',
    `- Orçamento do manifesto: ${money(financial.manifestBudgetUsd)}`,
    `- Orçamento assinado pela autoridade: ${money(financial.authorityBudgetUsd)}`,
    `- Teto de conta atestado: ${money(financial.providerAccountLimitUsd)}`,
    `- Reserva estimada: ${money(financial.estimatedReservationUsd)}`,
    '- Cobrança efetiva: não verificada',
    '',
    '## Condições de interrupção',
    '',
    ...report.stopCriteria.map((code) => `- ${text(code)}`),
    '',
    '## Ensaio em memória',
    '',
    ...(rehearsal === undefined ? ['Sem ensaio registrado.'] : [
      `- Proveniência e evidência: ${text(rehearsal.provenance)} / ${text(rehearsal.evidence)}`,
      `- Execução e resultado técnico: ${text(rehearsal.executionId)} / ${text(rehearsal.technicalStatus)}`,
      `- Cancelamento solicitado: ${rehearsal.operatorCancelled ? 'sim' : 'não'}`,
      `- Chamadas ao modelo: ${rehearsal.modelCalls}`,
      `- Modelos observados: ${text(rehearsal.returnedModelIds.join(', ') || undefined)}`,
      `- Provedores observados: ${text(rehearsal.observedProviderIds.join(', ') || undefined)}`,
      `- Ferramentas solicitadas/executadas: ${rehearsal.toolCallsRequested}/${rehearsal.toolsExecuted}`,
      `- Tokens estimados e reportados: ${rehearsal.consumption.estimatedTokens} / ${rehearsal.consumption.reportedTotalTokens}`,
      `- Uso sem medição completa: ${rehearsal.consumption.callsWithoutCompleteUsage}`,
      `- Custo contabilizado na simulação: ${money(rehearsal.consumption.chargedCostUsd)}`,
      `- Assertions aprovadas, reprovadas e pendentes: ${rehearsal.assertions.passed} / ${rehearsal.assertions.failed} / ${rehearsal.assertions.notEvaluated}`,
      `- Falhas críticas e critérios humanos pendentes: ${rehearsal.criticalFailures} / ${rehearsal.requiredHumanCriteriaPending}`,
      ...rehearsal.technicalErrorCodes.map((code) => `- Falha técnica: ${text(code)}`),
      ...rehearsal.limitsReached.map((code) => `- Limite: ${text(code)}`),
    ]),
    '',
    '## Limitações',
    '',
    ...report.limitations.map((item) => `- ${text(item)}`),
    '',
  ].join('\n')
}

export async function writeCanaryOperationalReports(report: CanaryOperationalReport, directory: string) {
  const fingerprint = report.plan.manifestFingerprint?.slice('sha256:'.length) ?? 'incomplete'
  const phase = report.rehearsal === undefined ? 'verify' : 'rehearsal'
  const stem = `canary-operations.${fingerprint}.${phase}.v${report.reportVersion}`
  return writeExclusiveExternalEvalReportPair(
    directory,
    { json: `${stem}.json`, markdown: `${stem}.md` },
    { json: serializeCanaryOperationalReport(report), markdown: renderCanaryOperationalMarkdown(report) },
  )
}
