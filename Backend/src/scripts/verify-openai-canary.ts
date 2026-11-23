import { readFile } from 'node:fs/promises'
import { parseArgs } from 'node:util'

import { writeExclusiveExternalEvalReportPair } from '../evals/external-eval-report.js'
import { verifyOpenAiCanary } from '../evals/openai-canary-operations.js'

async function main() {
  const { values } = parseArgs({ options: { 'output-dir': { type: 'string' } } })
  if (!values['output-dir']) throw new TypeError()
  const manifest: unknown = JSON.parse(await readFile(new URL(
    '../../evals/canary/gpt-6-luna-openai-operational-candidate.v1.json', import.meta.url,
  ), 'utf8'))
  const report = await verifyOpenAiCanary({ manifest })
  const render = (value: string | number | undefined) => value === undefined ? 'pendente' : `\`${value}\``
  const markdown = [
    '# Preflight operacional OpenAI direto',
    '',
    `- Modelo ${render(report.configuration?.modelId)} e cenário ${render(report.configuration?.scenarioIds[0])}.`,
    `- Revisão carregada ${render(report.source.loadedRevision)}. Revisão no manifesto ${render(report.configuration?.sourceRevision)}.`,
    `- Fingerprint operacional ${render(report.manifestFingerprint)}. Preflight ${render(report.preflight)}.`,
    `- Estimativa por chamada em USD ${render(report.financial.estimatedCostPerCallUsd)}. Reserva documental total ${render(report.financial.estimatedReservationUsd)}.`,
    `- Retenção ${render(report.retention)} e autorização de uso ${render(report.authorization.use)}.`,
    `- Bloqueios ${report.blockers.map(render).join(', ')}.`,
    '- Este preflight fez zero inferências reais e não gerou cobranças.',
    '',
    '## Checklist operacional',
    '',
    ...report.checklist.map((item) => `- ${item}`),
    '',
    '## Evidências verificáveis',
    '',
    '- Os testes em memória da EVAL-07C.1 cobrem assinatura, consumo único, retenção, teto externo, identidade, falhas de transporte e reconciliação de custo.',
    '',
  ].join('\n')
  await writeExclusiveExternalEvalReportPair(values['output-dir'], {
    json: 'openai-canary-preflight.v1.json', markdown: 'openai-canary-preflight.v1.md',
  }, { json: `${JSON.stringify(report, null, 2)}\n`, markdown })
}

main().catch(() => {
  console.error('Falha controlada ao gerar o preflight offline OpenAI.')
  process.exitCode = 1
})
