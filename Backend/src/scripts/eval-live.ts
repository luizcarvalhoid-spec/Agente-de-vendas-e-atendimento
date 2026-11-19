import { planExternalEval } from '../evals/external-eval-plan.js'
import { runLiveExternalEval } from '../evals/external-eval-runner.js'
import type {
  ExternalEvalModality,
  ExternalEvalPlanRequest,
} from '../evals/external-eval-schema.js'

interface CliOptions {
  action: 'plan' | 'run'
  modality: ExternalEvalModality
  dataset?: string
  scenario?: string
  model?: string
  provider?: string
  dataCollection?: 'allow' | 'deny'
  zeroDataRetention?: boolean
  outputDir?: string
  maxCalls?: number
  maxOutputTokens?: number
  maxExecutionTokens?: number
  estimatedInputTokens?: number
  timeoutMs?: number
  inputPrice?: number
  outputPrice?: number
  priceConfirmedAt?: string
  priceSource?: string
  budget?: number
  usageMargin?: number
  help: boolean
}

function usage() {
  return [
    'Uso: pnpm eval:live --action plan --dataset <id> [--scenario <id>] [opções de limites e custo]',
    '',
    'Modalidades: dry_run, mock_external, live_external.',
    'A EVAL-07B.1 executa somente preflight pela CLI; live_external permanece bloqueado.',
    'A existência de OPENROUTER_API_KEY não concede autorização.',
    '',
    'Opções completas:',
    '  --model <id> --output-dir <diretório>',
    '  --provider <slug> --data-collection <allow|deny> --zdr <true|false>',
    '  --max-calls <n> --max-output-tokens <n> --max-execution-tokens <n>',
    '  --estimated-input-tokens <n> --timeout-ms <n>',
    '  --input-price <USD/milhão> --output-price <USD/milhão>',
    '  --price-confirmed-at <ISO-8601> --budget <USD> --usage-margin <multiplicador>',
    '  --price-source <referência documental opcional>',
  ].join('\n')
}

function numeric(value: string, option: string) {
  const parsed = Number(value)
  if (!Number.isFinite(parsed)) {
    throw new TypeError(`${option} exige um número válido.`)
  }
  return parsed
}

function parseArguments(args: readonly string[]) {
  const options: CliOptions = {
    action: 'plan',
    modality: 'dry_run',
    help: false,
  }
  const seen = new Set<string>()
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index]
    if (argument === '--help' || argument === '-h') {
      options.help = true
      continue
    }
    if (argument === undefined || !argument.startsWith('--')) {
      throw new TypeError(`Opção inválida: ${argument}.`)
    }
    if (seen.has(argument)) throw new TypeError(`Opção duplicada: ${argument}.`)
    seen.add(argument)
    const value = args[index + 1]
    if (!value || value.startsWith('--')) {
      throw new TypeError(`${argument} exige um valor.`)
    }
    index += 1
    switch (argument) {
      case '--action':
        if (value !== 'plan' && value !== 'run') {
          throw new TypeError('--action aceita plan ou run.')
        }
        options.action = value
        break
      case '--modality':
        if (
          value !== 'dry_run' &&
          value !== 'mock_external' &&
          value !== 'live_external'
        ) {
          throw new TypeError('--modality inválida.')
        }
        options.modality = value
        break
      case '--dataset': options.dataset = value; break
      case '--scenario': options.scenario = value; break
      case '--model': options.model = value; break
      case '--provider': options.provider = value; break
      case '--data-collection':
        if (value !== 'allow' && value !== 'deny') {
          throw new TypeError('--data-collection aceita allow ou deny.')
        }
        options.dataCollection = value
        break
      case '--zdr':
        if (value !== 'true' && value !== 'false') {
          throw new TypeError('--zdr aceita true ou false.')
        }
        options.zeroDataRetention = value === 'true'
        break
      case '--output-dir': options.outputDir = value; break
      case '--max-calls': options.maxCalls = numeric(value, argument); break
      case '--max-output-tokens': options.maxOutputTokens = numeric(value, argument); break
      case '--max-execution-tokens': options.maxExecutionTokens = numeric(value, argument); break
      case '--estimated-input-tokens': options.estimatedInputTokens = numeric(value, argument); break
      case '--timeout-ms': options.timeoutMs = numeric(value, argument); break
      case '--input-price': options.inputPrice = numeric(value, argument); break
      case '--output-price': options.outputPrice = numeric(value, argument); break
      case '--price-confirmed-at': options.priceConfirmedAt = value; break
      case '--price-source': options.priceSource = value; break
      case '--budget': options.budget = numeric(value, argument); break
      case '--usage-margin': options.usageMargin = numeric(value, argument); break
      default: throw new TypeError(`Opção desconhecida: ${argument}.`)
    }
  }
  return options
}

function requestFrom(options: CliOptions): ExternalEvalPlanRequest {
  if (!options.dataset) throw new TypeError('Informe --dataset.')
  const completeLimits =
    options.maxCalls !== undefined &&
    options.maxOutputTokens !== undefined &&
    options.maxExecutionTokens !== undefined &&
    options.estimatedInputTokens !== undefined &&
    options.timeoutMs !== undefined
  const completePricing =
    options.model !== undefined &&
    options.inputPrice !== undefined &&
    options.outputPrice !== undefined &&
    options.priceConfirmedAt !== undefined
  return {
    modality: options.modality,
    datasetId: options.dataset,
    ...(options.scenario === undefined
      ? {}
      : { scenarioIds: [options.scenario] }),
    ...(options.model === undefined ? {} : { modelId: options.model }),
    ...(options.provider === undefined || options.dataCollection === undefined
      ? {}
      : {
          routing: {
            providerId: options.provider,
            allowFallbacks: false as const,
            requireParameters: true as const,
            dataCollection: options.dataCollection,
            ...(options.zeroDataRetention === undefined
              ? {}
              : { zeroDataRetention: options.zeroDataRetention }),
          },
        }),
    ...(options.outputDir === undefined
      ? {}
      : { outputDirectory: options.outputDir }),
    ...(completeLimits
      ? {
          limits: {
            maxModelCalls: options.maxCalls!,
            maxOutputTokensPerCall: options.maxOutputTokens!,
            maxExecutionTokens: options.maxExecutionTokens!,
            estimatedInputTokensPerCall: options.estimatedInputTokens!,
            timeoutMs: options.timeoutMs!,
          },
        }
      : {}),
    ...(completePricing
      ? {
          pricing: {
            modelId: options.model!,
            currency: 'USD',
            inputUsdPerMillionTokens: options.inputPrice!,
            outputUsdPerMillionTokens: options.outputPrice!,
            confirmedAt: options.priceConfirmedAt!,
            ...(options.provider === undefined
              ? {}
              : { providerId: options.provider }),
            ...(options.priceSource === undefined
              ? {}
              : { source: options.priceSource }),
          },
        }
      : {}),
    ...(options.budget === undefined ? {} : { maxBudgetUsd: options.budget }),
    ...(options.usageMargin === undefined
      ? {}
      : { unreportedUsageMultiplier: options.usageMargin }),
  }
}

async function main() {
  const options = parseArguments(process.argv.slice(2))
  if (options.help) {
    console.log(usage())
    return
  }
  const planned = await planExternalEval(requestFrom(options))
  console.log(JSON.stringify(planned.plan, null, 2))
  if (options.action === 'run') await runLiveExternalEval()
}

main().catch((error: unknown) => {
  const message =
    error instanceof Error
      ? `${error.name}: ${error.message}`
      : 'Falha desconhecida na EVAL-07.'
  console.error(message)
  process.exitCode = 1
})
