import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { parseArgs } from 'node:util'

import { configuredCanaryAuthorities } from '../evals/external-canary-authorities.js'
import { compareCanaryEndpointEvidence } from '../evals/external-canary-compatibility.js'
import { verifyCanaryOperations } from '../evals/external-canary-operations.js'
import { CanaryAuthorizationUseStore } from '../evals/external-canary-use-store.js'
import { prepareExternalCanary } from '../evals/external-canary.js'
import { writeExclusiveExternalEvalReportPair } from '../evals/external-eval-report.js'

function quoted(value: string | number | undefined) {
  return value === undefined ? 'não informado' : `\`${value}\``
}

async function main() {
  const { values } = parseArgs({ options: { 'output-dir': { type: 'string' } } })
  if (!values['output-dir']) throw new TypeError()
  const read = async (name: string): Promise<unknown> =>
    JSON.parse(await readFile(new URL(`../../evals/canary/${name}`, import.meta.url), 'utf8'))
  const [original, alternative, evidence] = await Promise.all([
    read('gpt-4.1-mini-candidate.v1.json'),
    read('gpt-4.1-mini-azure-candidate.v1.json'),
    read('gpt-4.1-mini-endpoint-evidence.v1.json'),
  ])
  const comparison = compareCanaryEndpointEvidence(original, alternative, evidence)
  const [preparation, operations] = await Promise.all([
    prepareExternalCanary(alternative),
    verifyCanaryOperations({ manifest: alternative }, {
      authorities: configuredCanaryAuthorities,
      useStore: new CanaryAuthorizationUseStore(fileURLToPath(
        new URL('../../external-eval-reports/canary-control/', import.meta.url),
      )),
    }),
  ])
  const report = {
    ...comparison,
    offlinePreflight: {
      status: preparation.status,
      stages: preparation.stages,
      issues: preparation.issues,
      requirements: preparation.requirements,
      manifestFingerprint: preparation.manifestFingerprint,
      budget: preparation.budget,
      operationalBlockers: operations.blockers,
      networkAllowed: operations.networkAllowed,
      executionAllowed: operations.executionAllowed,
    },
  }
  const entries = [...report.original.endpoints, ...report.alternative.endpoints, ...report.otherCatalogEntries]
  const markdown = [
    '# Compatibilidade offline do canário GPT-4.1 Mini',
    '',
    `Modelo comparado ${quoted(report.modelId)}. Cenário ${quoted(report.alternative.scenarioIds[0])}.`,
    `Orçamento proposto em USD ${quoted(report.alternative.proposedBudgetUsd)}.`,
    `O cliente envia ${report.requestContract.endpointParameters.map(quoted).join(', ')}, com ${quoted('tool_choice: auto')} e ${quoted('stream: false')}.`,
    `A variante usa ${quoted(report.alternative.routing?.providerId)} em ${quoted('order')} e ${quoted('only')}, sem fallback, com parâmetros obrigatórios e ZDR exigida.`,
    'Os valores da tabela são tarifas em USD por milhão de tokens e reservas documentais em USD.',
    '',
    '| Provedor | Slug publicado | ID de catálogo | Escopo | ZDR documentado | Safety Retention | Retém prompts | Entrada | Saída | Reserva |',
    '| --- | --- | --- | --- | --- | --- | --- | ---: | ---: | ---: |',
    ...entries.map((endpoint) => [
      endpoint.providerName.replaceAll('|', '\\|'),
      quoted(endpoint.routingSlug),
      quoted(endpoint.catalogEndpointId),
      quoted(endpoint.scope),
      quoted(endpoint.zdr),
      endpoint.safetyRetention === undefined ? 'não informado' : endpoint.safetyRetention ? 'sim' : 'não',
      endpoint.retainsPrompts === undefined ? 'não informado' : endpoint.retainsPrompts ? 'sim' : 'não',
      quoted(endpoint.pricing?.inputUsdPerMillionTokens),
      quoted(endpoint.pricing?.outputUsdPerMillionTokens),
      quoted(endpoint.estimate?.reservedUsdTotal),
    ].join(' | ')).map((row) => `| ${row} |`),
    '',
    ...entries.map((endpoint) =>
      `- ${quoted(endpoint.catalogEndpointId)} anuncia ${endpoint.parameters.map(quoted).join(', ')}. Escolha automática de ferramenta ${quoted(endpoint.autoToolChoice === undefined ? undefined : String(endpoint.autoToolChoice))}. Presença na lista ZDR ${endpoint.listedInPublicZdr ? 'sim' : 'não'}.`,
    ),
    '',
    `Maior reserva observada na família Azure em USD ${quoted(report.alternative.worstObservedReserveUsd)}.`,
    `Política da conta ${quoted(report.accountPolicy)}. Identidade de resposta ${quoted(report.responseIdentity)}.`,
    `Preflight Azure ${quoted(report.offlinePreflight.status)}. Autorização, execução e rede permanecem desabilitadas.`,
    '',
    '## Bloqueios',
    '',
    ...[report.original, report.alternative].map((candidate) =>
      `- ${quoted(candidate.routing?.providerId)}: ${candidate.blockers.map(quoted).join(', ')}.`,
    ),
    `- Gate operacional: ${report.offlinePreflight.operationalBlockers.map(quoted).join(', ')}.`,
    '',
    '## Limitações e recomendação',
    '',
    ...report.limitations.map((item) => `- ${item}`),
    '- Manter a execução externa bloqueada e revisar a rota exata, a identidade da resposta e as condições da conta antes de obter novas aprovações.',
    '',
    '## Evidências e referências',
    '',
    ...report.sourceObservations.map(({ source, url, observedAt }) => `- [${source}](${url}) — ${observedAt}`),
    ...Object.entries(report.references)
      .filter(([source]) => !report.sourceObservations.some((item) => item.source === source))
      .map(([source, url]) => `- [${source}](${url})`),
    '',
  ].join('\n')
  await writeExclusiveExternalEvalReportPair(values['output-dir'], {
    json: 'gpt-4.1-mini-azure.compatibility.v1.json',
    markdown: 'gpt-4.1-mini-azure.compatibility.v1.md',
  }, { json: `${JSON.stringify(report, null, 2)}\n`, markdown })
}

main().catch(() => {
  console.error('Falha ao gerar o relatório offline de compatibilidade. Verifique as evidências e o destino exclusivo.')
  process.exitCode = 1
})
