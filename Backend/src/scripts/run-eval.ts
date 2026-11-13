import {
  OFFLINE_EVAL_DATASETS,
  runOfflineEval,
} from '../evals/offline-eval-runner.js'

interface CliOptions {
  mode: string
  dataset?: string
  scenario?: string
  evaluate: boolean
  help: boolean
}

function usage() {
  return [
    'Uso: pnpm eval --mode offline --dataset <id> [--scenario <id>] [--evaluate]',
    '',
    `Datasets: ${Object.keys(OFFLINE_EVAL_DATASETS).join(', ')}`,
    '',
    'Use --evaluate para executar assertions determinísticas e calcular a nota objetiva diagnóstica.',
  ].join('\n')
}

function parseArguments(args: readonly string[]): CliOptions {
  const options: CliOptions = {
    mode: 'offline',
    evaluate: false,
    help: false,
  }
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index]
    if (argument === '--help' || argument === '-h') {
      options.help = true
      continue
    }
    if (argument === '--evaluate') {
      options.evaluate = true
      continue
    }
    if (
      argument !== '--mode' &&
      argument !== '--dataset' &&
      argument !== '--scenario'
    ) {
      throw new TypeError(`Opção desconhecida: ${argument}.`)
    }
    const value = args[index + 1]
    if (!value || value.startsWith('--')) {
      throw new TypeError(`A opção ${argument} exige um valor.`)
    }
    index += 1
    if (argument === '--mode') options.mode = value
    if (argument === '--dataset') options.dataset = value
    if (argument === '--scenario') options.scenario = value
  }
  return options
}

async function main() {
  const options = parseArguments(process.argv.slice(2))
  if (options.help) {
    console.log(usage())
    return
  }
  if (options.mode !== 'offline') {
    throw new TypeError('Somente o modo offline está disponível na EVAL-03.')
  }
  if (!options.dataset) {
    throw new TypeError('Informe um dataset com --dataset.')
  }

  const execution = await runOfflineEval(options.dataset, {
    ...(options.scenario === undefined
      ? {}
      : { scenarioId: options.scenario }),
    evaluateAssertions: options.evaluate,
  })
  console.log(
    `dataset=${execution.dataset.id} mode=${execution.mode} technical_status=${execution.technicalStatus}`,
  )
  for (const scenario of execution.scenarios) {
    console.log(
      `scenario=${scenario.scenarioId} technical_status=${scenario.technicalStatus} turns=${scenario.turns.length} behavioral_evaluation=${scenario.behavioralEvaluation}`,
    )
  }
  console.log(
    `completed=${execution.summary.completed} technical_failures=${execution.summary.technicalFailures} behavioral_evaluation=${execution.behavioralEvaluation}`,
  )
  if (execution.evaluation !== undefined) {
    const evaluation = execution.evaluation
    console.log(
      `assertions_passed=${evaluation.assertionSummary.passed} assertions_failed=${evaluation.assertionSummary.failed} assertions_not_evaluated=${evaluation.assertionSummary.notEvaluated} critical_failures=${evaluation.criticalFailures}`,
    )
    console.log(
      `objective_score=${evaluation.objectiveScore?.final ?? 'not_evaluated'} objective_score_raw=${evaluation.objectiveScore?.raw ?? 'not_evaluated'} objective_score_partial=${evaluation.objectiveScore?.partial ?? false} overall_status=${evaluation.overallStatus} required_human_review=${evaluation.requiredHumanCriteriaPending}`,
    )
  }
  if (execution.technicalStatus !== 'completed') process.exitCode = 1
}

main().catch((error: unknown) => {
  const message =
    error instanceof TypeError ? error.message : 'Falha ao executar o dataset.'
  console.error(`eval_error=${message}`)
  console.error(usage())
  process.exitCode = 1
})
