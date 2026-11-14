import { basename } from 'node:path'

import { loadEvalDataset } from '../evals/eval-loader.js'
import {
  HumanEvalRubricError,
  loadHumanEvalRubric,
} from '../evals/human-eval-rubric.js'
import {
  calculateHumanReviewProgress,
  HumanReviewEvaluationError,
  loadHumanReviewPackage,
  loadHumanReviewSubmission,
  serializeHumanReviewSummary,
  summarizeHumanReviews,
  validateHumanReviewSubmission,
} from '../evals/human-review-evaluation.js'
import {
  buildHumanReviewPackage,
  HumanReviewPackageError,
  loadHumanConversationSample,
  writeHumanReviewArtifacts,
} from '../evals/human-review-package.js'
import { resolveOfflineEvalDataset } from '../evals/offline-eval-runner.js'

type HumanEvalAction = 'prepare' | 'validate' | 'summarize'

interface CliOptions {
  action?: HumanEvalAction
  sample?: string
  rubric?: string
  outputDir?: string
  package?: string
  reviews: string[]
  help: boolean
}

function usage() {
  return [
    'Uso:',
    '  pnpm eval:human --action prepare --sample <arquivo> --output-dir <diretório> [--rubric <arquivo>]',
    '  pnpm eval:human --action validate --package <arquivo> --review <arquivo>',
    '  pnpm eval:human --action summarize --package <arquivo> --review <arquivo> [--review <arquivo> ...]',
    '',
    'prepare gera pacote e template, mas não registra avaliação humana.',
    'validate aceita somente submissões preenchidas e compatíveis com o pacote.',
    'summarize preserva julgamentos individuais e sinaliza divergências sem decidir por média.',
  ].join('\n')
}

function parseArguments(args: readonly string[]): CliOptions {
  const options: CliOptions = { reviews: [], help: false }
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index]
    if (argument === '--help' || argument === '-h') {
      options.help = true
      continue
    }
    if (
      argument !== '--action' &&
      argument !== '--sample' &&
      argument !== '--rubric' &&
      argument !== '--output-dir' &&
      argument !== '--package' &&
      argument !== '--review'
    ) {
      throw new TypeError(`Opção desconhecida: ${argument}.`)
    }
    const value = args[index + 1]
    if (!value || value.startsWith('--')) {
      throw new TypeError(`A opção ${argument} exige um valor.`)
    }
    index += 1
    if (argument === '--action') {
      if (
        value !== 'prepare' &&
        value !== 'validate' &&
        value !== 'summarize'
      ) {
        throw new TypeError('--action aceita prepare, validate ou summarize.')
      }
      options.action = value
    }
    if (argument === '--sample') options.sample = value
    if (argument === '--rubric') options.rubric = value
    if (argument === '--output-dir') options.outputDir = value
    if (argument === '--package') options.package = value
    if (argument === '--review') options.reviews.push(value)
  }
  return options
}

async function prepare(options: CliOptions) {
  if (!options.sample || !options.outputDir) {
    throw new TypeError(
      'prepare exige --sample e --output-dir explicitamente.',
    )
  }
  const [sample, rubric] = await Promise.all([
    loadHumanConversationSample(options.sample),
    loadHumanEvalRubric(options.rubric),
  ])
  const loaded = await loadEvalDataset(
    resolveOfflineEvalDataset(sample.sample.datasetId),
  )
  const reviewPackage = buildHumanReviewPackage(loaded, rubric, sample)
  const written = await writeHumanReviewArtifacts(
    reviewPackage,
    options.outputDir,
  )
  console.log(
    `sample=${reviewPackage.sample.id} package_status=${reviewPackage.packageStatus} origin=${reviewPackage.sample.origin.kind}`,
  )
  console.log(
    `human_evaluation_recorded=false review_items=${reviewPackage.reviewItems.length}`,
  )
  console.log(`review_package=${basename(written.package ?? '')}`)
  console.log(`review_template=${basename(written.template ?? '')}`)
}

async function validate(options: CliOptions) {
  if (!options.package || options.reviews.length !== 1) {
    throw new TypeError(
      'validate exige --package e exatamente um --review.',
    )
  }
  const [reviewPackage, review] = await Promise.all([
    loadHumanReviewPackage(options.package),
    loadHumanReviewSubmission(options.reviews[0] ?? ''),
  ])
  const validated = validateHumanReviewSubmission(reviewPackage, review)
  const progress = calculateHumanReviewProgress(reviewPackage, validated)
  console.log(
    `review_status=valid submission=${validated.submission.id} purpose=${validated.submission.purpose}`,
  )
  console.log(
    `human_review_status=${progress.humanReviewStatus} human_evaluation_recorded=${progress.humanEvaluationRecorded} all_applicable_dimensions_completed=${progress.allApplicableDimensionsCompleted}`,
  )
  console.log(
    `dimensions_evaluated=${progress.dimensionCounts.evaluated} dimensions_pending=${progress.dimensionCounts.pending} dimensions_not_applicable=${progress.dimensionCounts.notApplicable}`,
  )
  console.log(
    `sample_origin=${reviewPackage.sample.origin.kind} performance_evidence=${reviewPackage.sample.origin.performanceEvidence}`,
  )
}

async function summarize(options: CliOptions) {
  if (!options.package || options.reviews.length === 0) {
    throw new TypeError(
      'summarize exige --package e ao menos um --review.',
    )
  }
  const [reviewPackage, ...reviews] = await Promise.all([
    loadHumanReviewPackage(options.package),
    ...options.reviews.map(loadHumanReviewSubmission),
  ])
  process.stdout.write(
    serializeHumanReviewSummary(
      summarizeHumanReviews(reviewPackage, reviews),
    ),
  )
}

async function main() {
  const options = parseArguments(process.argv.slice(2))
  if (options.help) {
    console.log(usage())
    return
  }
  if (!options.action) throw new TypeError('Informe --action.')
  if (options.action === 'prepare') return prepare(options)
  if (options.action === 'validate') return validate(options)
  return summarize(options)
}

main().catch((error: unknown) => {
  const message =
    error instanceof TypeError ||
    error instanceof HumanEvalRubricError ||
    error instanceof HumanReviewPackageError ||
    error instanceof HumanReviewEvaluationError
      ? error.message
      : 'Falha no fluxo local de avaliação humana.'
  console.error(`human_eval_error=${message}`)
  console.error(usage())
  process.exitCode = 1
})
