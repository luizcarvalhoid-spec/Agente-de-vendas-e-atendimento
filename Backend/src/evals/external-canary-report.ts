import { writeExclusiveExternalEvalReportPair } from './external-eval-report.js'
import type { ExternalCanaryPreparation } from './external-canary.js'

function escapeMarkdown(value: string) {
  return value.replace(/[&<>]/g, (character) =>
    character === '&' ? '&amp;' : character === '<' ? '&lt;' : '&gt;',
  ).replace(/([\\`*_[\]{}()#+.!|>-])/g, '\\$1').replace(/[\r\n]/g, ' ')
}

export function serializeExternalCanaryPreparation(report: ExternalCanaryPreparation) {
  return `${JSON.stringify(report, null, 2)}\n`
}

export function renderExternalCanaryPreparationMarkdown(report: ExternalCanaryPreparation) {
  const { draft, budget, rehearsal } = report
  const text = (value: string | undefined) => value === undefined ? 'pendente' : escapeMarkdown(value)
  const money = (value: number | undefined) => value === undefined ? 'pendente' : `USD ${value}`
  const list = (values: readonly string[]) => values.length ? values.map(escapeMarkdown).join(', ') : 'não observado'
  return [
    '# Preparação do canário externo',
    '',
    `- Experimento: ${text(draft?.experimentId)}`,
    `- Finalidade: ${text(draft?.purpose)}`,
    `- Fingerprint do manifesto: ${text(report.manifestFingerprint)}`,
    `- Dataset: ${text(draft?.dataset.id)} / ${text(draft?.dataset.version)}`,
    `- Fingerprint do dataset: ${text(draft?.dataset.fingerprint)}`,
    `- Cenário: ${text(draft?.scenarioIds[0])}`,
    `- Modelo: ${text(draft?.modelId)}`,
    `- Provedor: ${text(draft?.routing?.providerId)}`,
    `- Revisão técnica do código: ${text(draft?.sourceRevision)}`,
    `- Estado: ${text(report.status)}`,
    `- Preparação técnica concluída: ${report.technicalPreparationComplete ? 'sim' : 'não'}`,
    '- Experimento autorizado: não',
    '- Experimento executado: não',
    '',
    '## Configuração',
    '',
    `- Isolamento: ${text(draft?.environment)}`,
    `- Roteamento: provedor único, fallback desabilitado e parâmetros obrigatórios${draft?.routing === undefined ? ' (configuração pendente)' : ''}.`,
    `- Coleta de dados: ${text(draft?.routing?.dataCollection)}`,
    `- Retenção zero: ${draft?.routing?.zeroDataRetention === undefined ? 'pendente' : draft.routing.zeroDataRetention ? 'exigida' : 'não exigida'}`,
    ...(draft?.routing?.zeroDataRetention === true && report.requirements.data_policy === 'pending'
      ? ['- Elegibilidade ZDR do endpoint: pendente de verificação.']
      : []),
    `- Amostragem: ${text(draft?.generation.sampling)}. Streaming desabilitado.`,
    `- Escolha de ferramentas: ${text(draft?.generation.toolChoice)}`,
    `- Persistência de transcrições: ${text(draft?.transcriptPersistence)}`,
    `- Destino planejado: ${text(draft?.outputDirectory)}`,
    ...(draft?.limits === undefined ? ['- Limites técnicos pendentes.'] : [
      `- Chamadas máximas: ${draft.limits.maxModelCalls}`,
      `- Tokens de entrada estimados e de saída por chamada: ${draft.limits.maxInputTokensPerCall} / ${draft.limits.maxOutputTokensPerCall}`,
      `- Tokens totais: ${draft.limits.maxExecutionTokens}`,
      `- Timeout configurado e efetivo por turno: ${draft.limits.timeoutMs} / ${draft.limits.effectiveTimeoutMs} ms`,
    ]),
    `- Preços de entrada e saída por milhão de tokens: ${money(draft?.pricing?.inputUsdPerMillionTokens)} / ${money(draft?.pricing?.outputUsdPerMillionTokens)}`,
    `- Fonte e data de confirmação: ${text(draft?.pricing?.source)} / ${text(draft?.pricing?.confirmedAt)}`,
    `- Margem de segurança: ${draft?.unreportedUsageMultiplier ?? 'pendente'}`,
    `- Orçamento configurado: ${money(draft?.maxBudgetUsd)}`,
    ...(budget === undefined ? [] : [
      ...(report.status === 'configuration_incomplete' ? ['- Estimativa de rascunho para revisão.'] : []),
      `- Estimativa por chamada e total: ${money(budget.estimatedUsdPerCall)} / ${money(budget.estimatedUsdTotal)}`,
      `- Reserva por chamada e total: ${money(budget.reservedUsdPerCall)} / ${money(budget.reservedUsdTotal)}`,
      `- Orçamento atestado: ${money(budget.approvedMaxBudgetUsd)}`,
      `- Saldo preventivo: ${money(budget.preventiveBalanceUsd)}`,
    ]),
    '',
    '## Preflight e condições de autorização',
    '',
    `- Estados: ${list(report.stages)}`,
    ...report.issues.map((issue) => `- ${text(issue.code)}${issue.field === undefined ? '' : ` (${text(issue.field)})`}`),
    ...Object.entries(report.requirements).map(([item, status]) => `- ${text(item)}: ${text(status)}`),
    `- Critérios de interrupção: ${list(draft?.stopCriteria ?? [])}`,
    '',
    '## Ensaio em memória',
    '',
    ...(rehearsal === undefined ? ['Ensaio pendente.'] : [
      `- Proveniência: ${text(rehearsal.provenance)}. Evidência: ${text(rehearsal.evidence)}.`,
      `- Execução técnica: ${text(rehearsal.executionId)} / ${text(rehearsal.technicalStatus)}`,
      `- Códigos de falha técnica: ${list(rehearsal.technicalErrorCodes)}.`,
      `- Modelo retornado: ${list(rehearsal.returnedModelIds)}. Provedor observado: ${list(rehearsal.observedProviderIds)}.`,
      `- Chamadas ao modelo: ${rehearsal.modelCalls}. Ferramentas solicitadas/executadas: ${rehearsal.toolCallsRequested}/${rehearsal.toolsExecuted}.`,
      `- Limites atingidos: ${list(rehearsal.limitsReached)}. Cancelamento operacional: ${rehearsal.operatorCancelled ? 'sim' : 'não'}.`,
      `- Tokens reportados e estimados: ${rehearsal.consumption.reportedTotalTokens} / ${rehearsal.consumption.estimatedTokens}`,
      `- Custo preventivamente contabilizado: ${money(rehearsal.consumption.chargedCostUsd)}`,
      `- Assertions aprovadas, reprovadas e pendentes: ${rehearsal.assertions.passed} / ${rehearsal.assertions.failed} / ${rehearsal.assertions.notEvaluated}`,
      `- Falhas críticas: ${rehearsal.criticalFailures}. Critérios humanos pendentes: ${rehearsal.requiredHumanCriteriaPending}.`,
    ]),
    '',
    '## Checklist operacional',
    '',
    ...report.checklist.map((item) => `- [ ] ${text(item)}`),
    '',
    '## Limitações e riscos residuais',
    '',
    ...report.limitations.map((item) => `- ${text(item)}`),
    '',
  ].join('\n')
}

export async function writeExternalCanaryPreparationReports(
  report: ExternalCanaryPreparation,
  directory: string,
) {
  const experiment = report.draft?.experimentId ?? 'invalid-manifest'
  const fingerprint = report.manifestFingerprint?.slice('sha256:'.length) ?? 'draft'
  const phase = report.rehearsal === undefined ? 'prepare' : 'rehearsal'
  const stem = `${experiment}.${fingerprint}.${phase}.canary.v${report.reportVersion}`
  return writeExclusiveExternalEvalReportPair(
    directory,
    { json: `${stem}.json`, markdown: `${stem}.md` },
    { json: serializeExternalCanaryPreparation(report), markdown: renderExternalCanaryPreparationMarkdown(report) },
  )
}
