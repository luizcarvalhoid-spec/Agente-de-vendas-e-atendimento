import { constants } from 'node:fs'
import { lstat, mkdir, open, realpath } from 'node:fs/promises'
import { userInfo } from 'node:os'
import { join } from 'node:path'
import { parseArgs } from 'node:util'

import { loadCatalogRepository } from '../catalog/catalog-repository.js'
import { CanaryAuthorizationUseStore } from '../evals/external-canary-use-store.js'
import { commercialProviders, CommercialExperimentError, runCommercialExperiment } from '../evals/openrouter-commercial-experiment.js'

const confirmation = 'EVAL-07D.6'
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
    authorize: { type: 'string' },
    provider: { type: 'string' },
    'confirm-zdr-only': { type: 'boolean' },
    help: { type: 'boolean' },
  } })
  if (values.help) {
    console.log('Dry-run (padrão)    pnpm eval:commercial-openrouter')
    console.log('Live autorizado    pnpm eval:commercial-openrouter --live --authorize EVAL-07D.6 --provider <azure/us|azure/eu> --confirm-zdr-only')
    return
  }
  const route = commercialProviders.find((provider) => provider === values.provider)
  if ((!values.live && (values.authorize !== undefined || values.provider !== undefined || values['confirm-zdr-only'])) ||
      (values.live && (values['dry-run'] || values.authorize !== confirmation || route === undefined))) {
    throw new CommercialExperimentError('LIVE_AUTHORIZATION_REQUIRED')
  }
  if (values.live && (!process.stdin.isTTY || !process.stdout.isTTY)) throw new CommercialExperimentError('PRIVATE_TERMINAL_REQUIRED')

  const abort = new AbortController()
  const stop = () => abort.abort()
  process.once('SIGINT', stop)
  process.once('SIGTERM', stop)
  try {
    console.log('EVAL-07D.6 · Teste comercial experimental simplificado')
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
    if (result.response) console.log('\n' + result.response + '\n')
    console.log({
      status: result.status, motivo: result.reason,
      modeloSolicitado: result.requestedModel, modeloRetornado: result.returnedModel ?? unknown,
      rotaSolicitada: result.requestedProvider, provedorObservado: result.observedProvider ?? unknown,
      endpointObservado: result.endpointVerifiedInResponse ? result.requestedProvider : unknown,
      tentativasDeModelo: result.modelAttempts, chamadasDeFerramentas: result.toolCalls, ferramentasExecutadas: result.executedTools,
      idsRecomendados: result.productIds, tokens: result.tokens ?? unknown,
      reservaUsd: result.reservedUsd, custoEstimadoUsd: result.estimatedCostUsd,
      cobrancaEfetivaUsd: result.effectiveChargeUsd ?? unknown,
    })
    if (result.status === 'interrupted') process.exitCode = 1
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
