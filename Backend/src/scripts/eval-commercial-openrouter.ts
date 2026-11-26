import { constants } from 'node:fs'
import { lstat, mkdir, open, realpath } from 'node:fs/promises'
import { userInfo } from 'node:os'
import { join } from 'node:path'
import { parseArgs } from 'node:util'

import { loadCatalogRepository } from '../catalog/catalog-repository.js'
import { CanaryAuthorizationUseStore } from '../evals/external-canary-use-store.js'
import {
  commercialExperimentId, commercialProvider, CommercialExperimentError, hasCommercialKeyFormat, runCommercialExperiment,
} from '../evals/openrouter-commercial-experiment.js'

const unknown = 'não verificado'

async function privateUseStore() {
  const { uid, homedir } = userInfo()
  if (process.platform !== 'linux' || uid <= 0 || await realpath(homedir) !== homedir) throw new Error()
  const home = await lstat(homedir)
  if (!home.isDirectory() || home.uid !== uid || (home.mode & 0o022) !== 0) throw new Error()
  const state = join(homedir, '.hidrasplash-eval-07d6')
  await mkdir(state, { mode: 0o700 }).catch((error: NodeJS.ErrnoException) => {
    if (error.code !== 'EEXIST') throw error
  })
  const stat = await lstat(state)
  if (!stat.isDirectory() || stat.uid !== uid || (stat.mode & 0o077) !== 0 || await realpath(state) !== state) throw new Error()
  const parent = await open(homedir, constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW)
  try {
    await parent.sync()
  } finally {
    await parent.close()
  }
  return new CanaryAuthorizationUseStore(state)
}

async function main() {
  const { values } = parseArgs({ options: {
    live: { type: 'boolean' },
    'dry-run': { type: 'boolean' },
    'check-key': { type: 'boolean' },
    authorize: { type: 'string' },
    provider: { type: 'string' },
    'confirm-zdr-only': { type: 'boolean' },
    help: { type: 'boolean' },
  } })
  if (values.help) {
    console.log('Dry-run (padrão)    pnpm eval:commercial-openrouter')
    console.log('Chave offline      pnpm eval:commercial-openrouter --check-key')
    console.log(`Live autorizado    pnpm eval:commercial-openrouter --live --authorize ${commercialExperimentId} --provider azure --confirm-zdr-only`)
    return
  }
  if (values['check-key']) {
    if (values.live || values['dry-run'] || values.authorize !== undefined || values.provider !== undefined || values['confirm-zdr-only']) {
      throw new CommercialExperimentError('INVALID_KEY_CHECK_OPTIONS')
    }
    const key = process.env.OPENROUTER_API_KEY
    const ready = hasCommercialKeyFormat(key)
    console.log('OPENROUTER_API_KEY', ready ? 'presente, formato compatível' : key ? 'formato incompatível' : 'ausente')
    if (!ready) process.exitCode = 1
    return
  }
  const route = values.provider === commercialProvider ? commercialProvider : undefined
  if ((!values.live && (values.authorize !== undefined || values.provider !== undefined || values['confirm-zdr-only'])) ||
      (values.live && (values['dry-run'] || values.authorize !== commercialExperimentId || route === undefined))) {
    throw new CommercialExperimentError('LIVE_AUTHORIZATION_REQUIRED')
  }
  if (values.live && (!process.stdin.isTTY || !process.stdout.isTTY)) throw new CommercialExperimentError('PRIVATE_TERMINAL_REQUIRED')

  const abort = new AbortController()
  const stop = () => abort.abort()
  process.once('SIGINT', stop)
  process.once('SIGTERM', stop)
  try {
    console.log(`${commercialExperimentId} · Teste comercial experimental simplificado`)
    const result = await runCommercialExperiment({
      live: values.live && route ? { provider: route, authorized: true, accountZdrOnlyConfirmed: Boolean(values['confirm-zdr-only']) } : undefined,
      signal: abort.signal,
    }, {
      loadKey: () => process.env.OPENROUTER_API_KEY,
      createUseStore: privateUseStore,
      loadCatalog: loadCatalogRepository,
      transport: globalThis.fetch,
    })
    console.log(result.question)
    if (result.status === 'dry-run') {
      console.log('Dry-run offline. Reserva histórica D.4 em USD', result.historicalReserveUsd)
      console.log('Catálogo compatível', result.compatibleIds)
      console.log('Solicitações autenticadas e tentativas de modelo', result.authenticatedRequests, result.modelAttempts)
      return
    }
    if (result.response) {
      console.log(result.responseSource === 'model_for_review' ? 'Texto do modelo para revisão comercial' : 'Resposta do agente')
      console.log(result.response)
    }
    console.log({
      statusTecnico: result.status, motivoTecnico: result.reason,
      ...(result.responseValidationFailure === undefined ? {} : { validacaoResposta: result.responseValidationFailure }),
      avaliacaoComercial: result.commercialStatus, motivosComerciais: result.commercialFailures,
      modeloSolicitado: result.requestedModel, modeloRetornado: result.returnedModel ?? unknown,
      rotaSolicitada: result.requestedProvider, provedorObservado: result.observedProvider ?? unknown,
      endpointObservado: unknown,
      tentativasDeModelo: result.modelAttempts, chamadasDeFerramentas: result.toolCalls, ferramentasExecutadas: result.executedTools,
      idsRecomendados: result.productIds, tokens: result.tokens ?? unknown,
      reservaUsd: result.reservedUsd, custoEstimadoUsd: result.estimatedCostUsd,
      cobrancaEfetivaUsd: result.effectiveChargeUsd ?? unknown,
    })
    if (result.status === 'interrupted') process.exitCode = 1
    else if (result.commercialStatus === 'failed') process.exitCode = 2
  } finally {
    process.removeListener('SIGINT', stop)
    process.removeListener('SIGTERM', stop)
  }
}

main().catch((error: unknown) => {
  const code = error instanceof CommercialExperimentError ? error.code : 'EXPERIMENT_CONFIGURATION_OR_TECHNICAL_ERROR'
  console.error('NO-GO', code)
  process.exitCode = 1
})
