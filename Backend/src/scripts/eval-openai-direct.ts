import { readFile } from 'node:fs/promises'
import { parseArgs } from 'node:util'

import { registerInMemoryChatTransport } from '../agent/in-memory-chat-transport.js'
import { OPENAI_DIRECT_MODEL } from '../agent/openai/openai-direct-agent-model.js'
import { renderExternalEvalReportMarkdown, writeExclusiveExternalEvalReportPair } from '../evals/external-eval-report.js'
import { rehearseOpenAiDirectCandidate } from '../evals/openai-direct-candidate.js'

async function main() {
  const { values } = parseArgs({ options: { 'output-dir': { type: 'string' } } })
  if (!values['output-dir']) throw new TypeError()
  const input: unknown = JSON.parse(await readFile(new URL(
    '../../evals/canary/gpt-6-luna-openai-direct-candidate.v1.json', import.meta.url,
  ), 'utf8'))
  const transport = registerInMemoryChatTransport(async () => Response.json({
    id: 'chatcmpl-synthetic-preparation',
    model: OPENAI_DIRECT_MODEL,
    created: 0,
    choices: [{ index: 0, finish_reason: 'stop', message: {
      role: 'assistant', content: 'O que você procura resolver com esse produto?',
    } }],
    usage: { prompt_tokens: 300, completion_tokens: 15, total_tokens: 315 },
  }))
  const report = await rehearseOpenAiDirectCandidate(input, transport)
  const markdown = [
    '# Preparação offline do GPT-6 Luna via OpenAI',
    '',
    `- Origem configurada \`${report.transportOrigin.configuredProvider}\` com transporte em memória.`,
    `- Endpoint configurado \`${report.transportOrigin.endpoint}\`. Identidade observada do endpoint \`${report.observedEndpointIdentity}\`.`,
    `- Reserva documental de USD ${report.documentaryReserveUsd} para até ${report.candidate.limits.maxModelCalls} chamadas, com teto proposto de USD ${report.candidate.maxBudgetUsd} e margem de ${report.candidate.unreportedUsageMultiplier}.`,
    `- Bloqueios operacionais ${report.operationalBlockers.map((code) => `\`${code}\``).join(', ')}.`,
    '- Sem autorização, rede de inferência, credenciais ou cobranças reais. A política efetiva de retenção aguarda revisão humana.',
    '',
    '[Preços públicos do modelo](https://developers.openai.com/api/docs/models/gpt-6-luna) · [Controles de dados](https://developers.openai.com/api/docs/guides/your-data)',
    '',
    renderExternalEvalReportMarkdown(report.evaluation),
  ].join('\n')
  await writeExclusiveExternalEvalReportPair(values['output-dir'], {
    json: 'gpt-6-luna-openai-direct.preparation.v1.json',
    markdown: 'gpt-6-luna-openai-direct.preparation.v1.md',
  }, { json: `${JSON.stringify(report, null, 2)}\n`, markdown })
}

main().catch(() => {
  console.error('Falha ao gerar os relatórios offline da integração OpenAI.')
  process.exitCode = 1
})
