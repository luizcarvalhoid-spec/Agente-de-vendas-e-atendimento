import { open } from 'node:fs/promises'
import { parseArgs } from 'node:util'

import { writeExternalCanaryPreparationReports } from '../evals/external-canary-report.js'
import {
  EXTERNAL_CANARY_DEFAULT_DATASET,
  EXTERNAL_CANARY_DEFAULT_SCENARIO,
  externalCanaryManifestSchema,
} from '../evals/external-canary-schema.js'
import { prepareExternalCanary, rehearseExternalCanary } from '../evals/external-canary.js'
import { createInMemoryOpenRouterTransport } from '../evals/external-eval-runner.js'

async function readJson(path: string): Promise<unknown> {
  const file = await open(path, 'r')
  try {
    const info = await file.stat()
    if (!info.isFile() || info.size > 32_768) throw new TypeError('Arquivo inválido.')
    const buffer = Buffer.alloc(32_769)
    let offset = 0
    while (offset < buffer.length) {
      const { bytesRead } = await file.read(buffer, offset, buffer.length - offset, null)
      if (!bytesRead) break
      offset += bytesRead
    }
    if (offset === buffer.length) throw new TypeError('Arquivo inválido.')
    return JSON.parse(buffer.toString('utf8', 0, offset))
  } finally {
    await file.close()
  }
}

async function main() {
  const { values } = parseArgs({
    options: {
      action: { type: 'string', default: 'prepare' },
      manifest: { type: 'string' },
      review: { type: 'string' },
      'output-dir': { type: 'string' },
      help: { type: 'boolean' },
    },
  })
  if (values.help) {
    console.log('pnpm eval:canary --action prepare|rehearse --manifest <json> --output-dir <diretório> [--review <json>]')
    return
  }
  const action = values.action
  if ((action !== 'prepare' && action !== 'rehearse') || !values.manifest || !values['output-dir']) {
    throw new TypeError('Comando de preparação inválido.')
  }
  const input = await readJson(values.manifest)
  let report
  if (action === 'prepare') {
    const review = values.review === undefined ? undefined : await readJson(values.review)
    report = await prepareExternalCanary(input, review)
  } else {
    const manifest = externalCanaryManifestSchema.parse(input)
    if (
      values.review !== undefined ||
      manifest.purpose !== 'synthetic_rehearsal' ||
      manifest.dataset.id !== EXTERNAL_CANARY_DEFAULT_DATASET ||
      manifest.scenarioIds[0] !== EXTERNAL_CANARY_DEFAULT_SCENARIO
    ) throw new TypeError('A CLI ensaia somente o cenário inicial sintético.')

    const transport = createInMemoryOpenRouterTransport(async () => Response.json({
      id: 'canary-synthetic-generation',
      model: manifest.modelId,
      provider: manifest.routing.providerId,
      created: 0,
      choices: [{
        index: 0,
        finish_reason: 'stop',
        message: { role: 'assistant', content: 'O que você gostaria de resolver com o produto?' },
      }],
      usage: { prompt_tokens: 300, completion_tokens: 15, total_tokens: 315 },
    }))
    report = await rehearseExternalCanary(manifest, { transport })
  }
  await writeExternalCanaryPreparationReports(report, values['output-dir'])
  console.log(JSON.stringify({
    status: report.status,
    technicalPreparationComplete: report.technicalPreparationComplete,
    experimentAuthorized: report.experimentAuthorized,
    experimentExecuted: report.experimentExecuted,
    rehearsalStatus: report.rehearsal?.technicalStatus,
  }))
  if (report.status === 'blocked' || report.rehearsal?.technicalStatus === 'technical_failure') {
    process.exitCode = 1
  }
}

main().catch(() => {
  console.error('A preparação do canário falhou. Verifique argumentos, arquivos e destino exclusivo.')
  process.exitCode = 1
})
