import { mkdir, open } from 'node:fs/promises'
import { join } from 'node:path'
import { isatty } from 'node:tty'
import { fileURLToPath } from 'node:url'
import { parseArgs } from 'node:util'

import { configuredCanaryAuthorities } from '../evals/external-canary-authorities.js'
import { writeCanaryOperationalReports } from '../evals/external-canary-operational-report.js'
import { verifyCanaryOperations } from '../evals/external-canary-operations.js'
import { writeExternalCanaryPreparationReports } from '../evals/external-canary-report.js'
import {
  EXTERNAL_CANARY_DEFAULT_DATASET,
  EXTERNAL_CANARY_DEFAULT_SCENARIO,
  externalCanaryManifestSchema,
} from '../evals/external-canary-schema.js'
import { prepareExternalCanary, rehearseExternalCanary } from '../evals/external-canary.js'
import { CanaryAuthorizationUseStore } from '../evals/external-canary-use-store.js'
import { createInMemoryOpenRouterTransport } from '../evals/external-eval-runner.js'
import { executeOpenRouterLunaCanary, verifyOpenRouterLunaCanary } from '../evals/openrouter-luna-canary.js'

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
      approval: { type: 'string' },
      'output-dir': { type: 'string' },
      observe: { type: 'boolean' },
      help: { type: 'boolean' },
    },
  })
  if (values.help) {
    console.log('pnpm eval:canary --action prepare|rehearse|verify|verify-openrouter|execute-openrouter --manifest <json> --output-dir <diretório> [--review <json>] [--approval <json> em ações de verificação e execução] [--observe em execute-openrouter]')
    return
  }
  const action = values.action
  const openRouter = action === 'verify-openrouter' || action === 'execute-openrouter'
  if ((!openRouter && action !== 'prepare' && action !== 'rehearse' && action !== 'verify') ||
      !values.manifest || !values['output-dir'] || (!openRouter && action !== 'verify' && values.approval) ||
      (values.observe && action !== 'execute-openrouter')) {
    throw new TypeError('Comando de preparação inválido.')
  }
  const input = await readJson(values.manifest)
  if (openRouter) {
    if (!import.meta.url.endsWith('/src/scripts/eval-canary.ts')) {
      throw new TypeError('Execute o canário a partir do código-fonte rastreado.')
    }
    const options = {
      manifest: input,
      review: values.review === undefined ? undefined : await readJson(values.review),
      approval: values.approval === undefined ? undefined : await readJson(values.approval),
    }
    const cancellation = new AbortController()
    const cancel = () => cancellation.abort()
    process.once('SIGINT', cancel)
    process.once('SIGTERM', cancel)
    let terminal: Awaited<ReturnType<typeof open>> | undefined
    try {
      if (values.observe) {
        terminal = await open('/dev/tty', 'r+')
        if (!isatty(terminal.fd)) throw new TypeError('A observação requer um terminal interativo privado.')
      }
      const interactiveTerminal = terminal
      const observe = interactiveTerminal && (async (message: string) => {
        const text = message.replace(/[\x00-\x09\x0b-\x1f\x7f-\x9f]/g, '')
        await interactiveTerminal.write('\nResposta final para revisão humana\n\n' + text + '\n\n')
      })
      await mkdir(values['output-dir'], { recursive: true, mode: 0o700 })
      const file = await open(join(values['output-dir'], `${action}.v1.json`), 'wx', 0o600)
      try {
        const report = action === 'verify-openrouter'
          ? await verifyOpenRouterLunaCanary(options)
          : await executeOpenRouterLunaCanary(options, cancellation.signal, observe)
        await file.writeFile(`${JSON.stringify(report, null, 2)}\n`)
        console.log(JSON.stringify({
          blockers: report.blockers, networkAllowed: report.networkAllowed, realInferenceAttempts: report.realInferenceAttempts,
        }))
        if (report.blockers.length) process.exitCode = 1
      } finally {
        await file.close()
      }
    } finally {
      process.removeListener('SIGINT', cancel)
      process.removeListener('SIGTERM', cancel)
      await terminal?.close()
    }
    return
  }
  if (action === 'verify') {
    if (!import.meta.url.endsWith('/src/scripts/eval-canary.ts')) {
      throw new TypeError('Execute a verificação a partir do código-fonte rastreado.')
    }
    const report = await verifyCanaryOperations({
      manifest: input,
      review: values.review === undefined ? undefined : await readJson(values.review),
      approval: values.approval === undefined ? undefined : await readJson(values.approval),
    }, {
      authorities: configuredCanaryAuthorities,
      useStore: new CanaryAuthorizationUseStore(
        fileURLToPath(new URL('../../external-eval-reports/canary-control/', import.meta.url)),
      ),
    })
    await writeCanaryOperationalReports(report, values['output-dir'])
    console.log(JSON.stringify({ blockers: report.blockers, networkAllowed: report.networkAllowed }))
    process.exitCode = 1
    return
  }
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
