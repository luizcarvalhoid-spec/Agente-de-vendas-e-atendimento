import { basename } from 'node:path'

import {
  buildEvalBaseline,
  EvalBaselineError,
  fingerprintEvalReferenceData,
  loadEvalBaseline,
  writeEvalBaseline,
} from '../evals/eval-baseline.js'
import { loadEvalDataset } from '../evals/eval-loader.js'
import { buildEvalReport } from '../evals/eval-report-builder.js'
import {
  compareEvalBaseline,
  evalRegressionExitCode,
} from '../evals/eval-regression.js'
import { EvalRegressionWriteError, writeEvalRegressionReports } from '../evals/eval-regression-writer.js'
import {
  OFFLINE_EVAL_DATASETS,
  resolveOfflineEvalDataset,
  runOfflineEvalDataset,
} from '../evals/offline-eval-runner.js'

type Action = 'capture' | 'check'

interface Options {
  action?: Action
  dataset?: string
  output?: string
  baseline?: string
  reportDir?: string
  help: boolean
}

function usage() {
  return [
    'Uso:',
    '  pnpm eval:regression --action capture --dataset <id> --output <arquivo.json>',
    '  pnpm eval:regression --action check --dataset <id> --baseline <arquivo.json> --report-dir <diretório>',
    '',
    `Datasets: ${Object.keys(OFFLINE_EVAL_DATASETS).join(', ')}`,
    '',
    'capture exige execução objetiva completa e nunca sobrescreve o baseline.',
    'check executa o dataset uma vez, preserva falhas conhecidas e grava JSON e Markdown.',
    'Códigos: 0 sem regressões novas; 2 regressão ou scoring inconsistente; 3 falha técnica; 4 incompatível; 1 erro operacional.',
  ].join('\n')
}

function parseArguments(args: readonly string[]) {
  const options: Options = { help: false }
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index]
    if (argument === '--help' || argument === '-h') {
      options.help = true
      continue
    }
    if (
      argument !== '--action' &&
      argument !== '--dataset' &&
      argument !== '--output' &&
      argument !== '--baseline' &&
      argument !== '--report-dir'
    ) {
      throw new TypeError(`Opção desconhecida: ${argument}.`)
    }
    const value = args[index + 1]
    if (!value || value.startsWith('--')) {
      throw new TypeError(`A opção ${argument} exige um valor.`)
    }
    index += 1
    if (argument === '--action') {
      if (value !== 'capture' && value !== 'check') {
        throw new TypeError('--action aceita capture ou check.')
      }
      options.action = value
    }
    if (argument === '--dataset') options.dataset = value
    if (argument === '--output') options.output = value
    if (argument === '--baseline') options.baseline = value
    if (argument === '--report-dir') options.reportDir = value
  }
  return options
}

async function evaluatedReport(datasetId: string) {
  const loaded = await loadEvalDataset(resolveOfflineEvalDataset(datasetId))
  const execution = await runOfflineEvalDataset(loaded, {
    evaluateAssertions: true,
  })
  return {
    loaded,
    execution,
    report: buildEvalReport(loaded, execution),
  }
}

async function capture(options: Options) {
  if (!options.dataset || !options.output) {
    throw new TypeError('capture exige --dataset e --output.')
  }
  if (options.baseline || options.reportDir) {
    throw new TypeError(
      'capture não aceita --baseline ou --report-dir.',
    )
  }
  const [{ loaded, report }, referenceData] = await Promise.all([
    evaluatedReport(options.dataset),
    fingerprintEvalReferenceData(),
  ])
  const baseline = buildEvalBaseline(loaded, report, referenceData)
  const written = await writeEvalBaseline(baseline, options.output)
  console.log(
    `action=capture dataset=${baseline.dataset.id} baseline=${baseline.baselineId}`,
  )
  console.log(
    `assertions_passed=${report.summary.assertions.passed} assertions_failed=${report.summary.assertions.failed} assertions_not_evaluated=${report.summary.assertions.notEvaluated} objective_score=${report.summary.objectiveScore?.final ?? 'not_evaluated'}`,
  )
  console.log(`baseline_file=${basename(written)}`)
}

async function check(options: Options) {
  if (!options.dataset || !options.baseline || !options.reportDir) {
    throw new TypeError(
      'check exige --dataset, --baseline e --report-dir.',
    )
  }
  if (options.output) {
    throw new TypeError('check não aceita --output.')
  }
  const baseline = await loadEvalBaseline(options.baseline)
  const [{ loaded, report }, referenceData] = await Promise.all([
    evaluatedReport(options.dataset),
    fingerprintEvalReferenceData(),
  ])
  const comparison = compareEvalBaseline(
    baseline,
    loaded,
    report,
    referenceData,
  )
  const written = await writeEvalRegressionReports(
    comparison,
    options.reportDir,
  )
  console.log(
    `action=check dataset=${comparison.current.datasetId} result=${comparison.result} compatibility=${comparison.compatibility.status}`,
  )
  console.log(
    `regressions=${comparison.summary.regressions} evidence_losses=${comparison.summary.evidenceLosses} improvements=${comparison.summary.improvements} known_failures=${comparison.summary.knownFailures} newly_detected_failures=${comparison.summary.newlyDetectedFailures} new_critical_failures=${comparison.summary.newCriticalFailures} technical_problems=${comparison.summary.technicalProblems} scoring_inconsistencies=${comparison.summary.scoringInconsistencies}`,
  )
  console.log(
    `score_before=${comparison.score.baseline?.final ?? 'not_evaluated'} score_current=${comparison.score.current?.final ?? 'not_evaluated'} score_delta=${comparison.score.finalDelta ?? 'not_comparable'} required_human_review=${comparison.current.requiredHumanCriteriaPending}`,
  )
  console.log(`regression_json=${basename(written.json ?? '')}`)
  console.log(`regression_markdown=${basename(written.markdown ?? '')}`)
  process.exitCode = evalRegressionExitCode(comparison.result)
}

async function main() {
  const options = parseArguments(process.argv.slice(2))
  if (options.help) {
    console.log(usage())
    return
  }
  if (!options.action) throw new TypeError('Informe --action.')
  if (options.action === 'capture') return capture(options)
  return check(options)
}

main().catch((error: unknown) => {
  const message =
    error instanceof TypeError ||
    error instanceof EvalBaselineError ||
    error instanceof EvalRegressionWriteError
      ? error.message
      : 'Falha no fluxo de regressão objetiva.'
  console.error(`eval_regression_error=${message}`)
  console.error(usage())
  process.exitCode = 1
})
