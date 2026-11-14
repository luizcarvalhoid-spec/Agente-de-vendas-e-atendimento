import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import test from 'node:test'
import { promisify } from 'node:util'
import { fileURLToPath } from 'node:url'

import { buildEvalReport } from '../src/evals/eval-report-builder.js'
import { evalReportSchema } from '../src/evals/eval-report-schema.js'
import { loadEvalDataset } from '../src/evals/eval-loader.js'
import {
  loadHumanEvalRubric,
  parseHumanEvalRubric,
} from '../src/evals/human-eval-rubric.js'
import { humanEvalRubricSchema } from '../src/evals/human-eval-rubric-schema.js'
import {
  HumanReviewEvaluationError,
  parseHumanReviewSubmission,
  summarizeHumanReviews,
  validateHumanReviewSubmission,
} from '../src/evals/human-review-evaluation.js'
import {
  buildHumanReviewPackage,
  buildHumanReviewTemplate,
  HumanReviewPackageError,
  loadHumanConversationSample,
  parseHumanConversationSample,
  writeHumanReviewArtifacts,
} from '../src/evals/human-review-package.js'
import {
  humanConversationSampleSchema,
  humanReviewPackageSchema,
  humanReviewSubmissionSchema,
  humanReviewSummarySchema,
  humanReviewTemplateSchema,
  type HumanReviewPackage,
  type HumanReviewSubmission,
} from '../src/evals/human-review-schema.js'
import {
  resolveOfflineEvalDataset,
  runOfflineEvalDataset,
} from '../src/evals/offline-eval-runner.js'

const execFileAsync = promisify(execFile)
const backendRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const syntheticSamplePath = resolve(
  backendRoot,
  'evals/fixtures/human-review/synthetic-conversation.v1.json',
)

async function fixture() {
  const [rubric, sample, loaded] = await Promise.all([
    loadHumanEvalRubric(),
    loadHumanConversationSample(syntheticSamplePath),
    loadEvalDataset(resolveOfflineEvalDataset('universal-core')),
  ])
  const reviewPackage = buildHumanReviewPackage(loaded, rubric, sample)
  return { rubric, sample, loaded, reviewPackage }
}

const fixturePromise = fixture()

function reviewFor(
  reviewPackage: HumanReviewPackage,
  options: {
    id?: string
    reviewerId?: string
    purpose?: 'human_review' | 'synthetic_validation_fixture'
    scores?: readonly number[]
    statuses?: readonly ('evaluated' | 'not_evaluated' | 'not_applicable')[]
    safetyCriterionId?: string
  } = {},
): HumanReviewSubmission {
  return humanReviewSubmissionSchema.parse({
    submissionVersion: 1,
    submission: {
      id: options.id ?? 'review-submission-001',
      purpose: options.purpose ?? 'human_review',
      sampleId: reviewPackage.sample.id,
      datasetId: reviewPackage.sample.datasetId,
      datasetVersion: reviewPackage.sample.datasetVersion,
      scenarioId: reviewPackage.sample.scenarioId,
      rubricId: reviewPackage.rubric.id,
      rubricVersion: reviewPackage.rubric.version,
      reviewerId: options.reviewerId ?? 'reviewer-alpha',
    },
    judgements: reviewPackage.reviewItems.map((item, index) => {
      const status = options.statuses?.[index] ?? 'evaluated'
      const common = {
        evaluationId: item.evaluationId,
        criterionId: item.criterionId,
        criterion: item.criterion,
        scope: { turns: [...item.scope.turns] },
        evidenceReferences:
          status === 'evaluated' ? [{ turn: 0, role: 'assistant' }] : [],
        safetyAlert:
          item.criterionId === options.safetyCriterionId
            ? {
                flagged: true,
                rationale: 'A resposta apresenta uma preocupação semântica observável.',
              }
            : { flagged: false },
        status,
        justification:
          status === 'evaluated'
            ? 'O comportamento foi observado no turno indicado.'
            : 'A dimensão não pôde ser concluída nesta amostra.',
      }
      return status === 'evaluated'
        ? { ...common, score: options.scores?.[index] ?? 8 }
        : common
    }),
  })
}

test('rubrica universal v1 é válida, cobre critérios canônicos e ancora 1 a 10', async () => {
  const { rubric } = await fixturePromise
  assert.deepEqual(humanEvalRubricSchema.parse(rubric), rubric)
  const criteria = new Set(
    rubric.dimensions.flatMap((dimension) => dimension.criteria),
  )
  assert.deepEqual(
    [...criteria].sort(),
    [
      'clarity_utility',
      'consultative_quality',
      'context_continuity',
      'factual_accuracy',
      'naturalness',
      'safety',
    ],
  )
  for (const dimension of rubric.dimensions) {
    assert.equal(dimension.anchors.inadequate.range, '1-3')
    assert.equal(dimension.anchors.partial.range, '4-6')
    assert.equal(dimension.anchors.adequate.range, '7-8')
    assert.equal(dimension.anchors.excellent.range, '9-10')
  }
  assert.throws(
    () => parseHumanEvalRubric({ ...rubric, schemaVersion: 2 }),
    /incompatível/,
  )
})

test('pacote gerado é reproduzível, inclui somente critérios humanos e não inventa notas', async () => {
  const { rubric, sample, loaded, reviewPackage } = await fixturePromise
  const second = buildHumanReviewPackage(loaded, rubric, sample)
  assert.equal(JSON.stringify(second), JSON.stringify(reviewPackage))
  assert.deepEqual(humanReviewPackageSchema.parse(reviewPackage), reviewPackage)
  assert.equal(reviewPackage.packageStatus, 'prepared_not_evaluated')
  assert.ok(
    reviewPackage.reviewItems.every(
      (item) => item.status === 'not_evaluated' && !('score' in item),
    ),
  )
  assert.deepEqual(
    reviewPackage.reviewItems.map((item) => item.criterionId),
    ['naturalness-review', 'clarity-review'],
  )
})

test('template preenchível permanece explicitamente não submetido', async () => {
  const { reviewPackage } = await fixturePromise
  const template = buildHumanReviewTemplate(reviewPackage)
  assert.deepEqual(humanReviewTemplateSchema.parse(template), template)
  assert.equal(template.templateStatus, 'template_not_submitted')
  assert.equal(template.submission.id, null)
  assert.ok(template.judgements.every((item) => item.score === null))
  assert.throws(() => humanReviewSubmissionSchema.parse(template))
})

test('importa transcrição sintética sanitizada e identifica todas as origens', async () => {
  const { sample } = await fixturePromise
  assert.equal(sample.sample.origin.kind, 'manually_simulated')
  const origins = [
    {
      kind: 'manual_real_test',
      attestation: 'authorized_sanitized_test_transcript',
      performanceEvidence: 'declared_real_test',
    },
    {
      kind: 'manually_simulated',
      attestation: 'synthetic_conversation',
      performanceEvidence: 'not_real_performance',
    },
    {
      kind: 'deterministic_offline',
      attestation: 'offline_runner_output',
      performanceEvidence: 'not_real_performance',
    },
    {
      kind: 'unverified',
      attestation: 'origin_not_proven',
      performanceEvidence: 'not_real_performance',
    },
  ]
  for (const origin of origins) {
    assert.equal(
      humanConversationSampleSchema.parse({
        ...sample,
        sample: { ...sample.sample, origin },
      }).sample.origin.kind,
      origin.kind,
    )
  }
})

test('rejeita dados sensíveis na transcrição em vez de persistir correção silenciosa', async () => {
  const { sample } = await fixturePromise
  assert.throws(
    () =>
      parseHumanConversationSample({
        ...sample,
        turns: [
          {
            ...sample.turns[0],
            assistant: 'Contato: pessoa@example.com, token sk-or-supersecret.',
          },
        ],
      }),
    HumanReviewPackageError,
  )
})

test('aceita nota humana inteira de 1 a 10 com justificativa e evidência', async () => {
  const { reviewPackage } = await fixturePromise
  const review = reviewFor(reviewPackage, { scores: [1, 10] })
  const validated = validateHumanReviewSubmission(reviewPackage, review)
  assert.deepEqual(
    validated.judgements.map((item) =>
      item.status === 'evaluated' ? item.score : undefined,
    ),
    [1, 10],
  )
})

test('rejeita nota fora do intervalo, justificativa ou evidência ausente', async () => {
  const { reviewPackage } = await fixturePromise
  const valid = reviewFor(reviewPackage)
  const first = valid.judgements[0]
  assert(first && first.status === 'evaluated')
  assert.throws(() =>
    parseHumanReviewSubmission({
      ...valid,
      judgements: [{ ...first, score: 11 }, ...valid.judgements.slice(1)],
    }),
  )
  assert.throws(() =>
    parseHumanReviewSubmission({
      ...valid,
      judgements: [
        { ...first, justification: '' },
        ...valid.judgements.slice(1),
      ],
    }),
  )
  assert.throws(() =>
    parseHumanReviewSubmission({
      ...valid,
      judgements: [
        { ...first, evidenceReferences: [] },
        ...valid.judgements.slice(1),
      ],
    }),
  )
})

test('not_evaluated não aceita nota e not_applicable respeita aplicabilidade', async () => {
  const { reviewPackage } = await fixturePromise
  const pending = reviewFor(reviewPackage, {
    statuses: ['not_evaluated', 'not_evaluated'],
  })
  assert.deepEqual(
    validateHumanReviewSubmission(reviewPackage, pending).judgements.map(
      (item) => item.status,
    ),
    ['not_evaluated', 'not_evaluated'],
  )
  assert.throws(() =>
    parseHumanReviewSubmission({
      ...pending,
      judgements: [{ ...pending.judgements[0], score: 5 }, pending.judgements[1]],
    }),
  )
  const invalidRequired = reviewFor(reviewPackage, {
    statuses: ['not_applicable', 'not_evaluated'],
  })
  assert.throws(
    () => validateHumanReviewSubmission(reviewPackage, invalidRequired),
    /obrigatório/,
  )
  const validOptional = reviewFor(reviewPackage, {
    statuses: ['not_evaluated', 'not_applicable'],
  })
  assert.equal(
    validateHumanReviewSubmission(reviewPackage, validOptional).judgements[1]
      ?.status,
    'not_applicable',
  )
})

test('rejeita IDs, versões, critérios e turnos incompatíveis', async () => {
  const { reviewPackage } = await fixturePromise
  const review = reviewFor(reviewPackage)
  assert.throws(
    () =>
      validateHumanReviewSubmission(reviewPackage, {
        ...review,
        submission: { ...review.submission, rubricVersion: '2.0.0' },
      }),
    /não corresponde/,
  )
  const first = review.judgements[0]
  assert(first)
  assert.throws(
    () =>
      validateHumanReviewSubmission(reviewPackage, {
        ...review,
        judgements: [
          {
            ...first,
            evidenceReferences: [{ turn: 99, role: 'assistant' }],
          },
          ...review.judgements.slice(1),
        ],
      }),
    /turno inexistente/,
  )
})

test('preserva múltiplos julgamentos e sinaliza divergência sem decidir por média', async () => {
  const { reviewPackage } = await fixturePromise
  const alpha = reviewFor(reviewPackage, {
    id: 'review-alpha-001',
    reviewerId: 'reviewer-alpha',
    scores: [3, 7],
  })
  const beta = reviewFor(reviewPackage, {
    id: 'review-beta-001',
    reviewerId: 'reviewer-beta',
    scores: [8, 8],
  })
  const summary = summarizeHumanReviews(reviewPackage, [alpha, beta])
  assert.deepEqual(humanReviewSummarySchema.parse(summary), summary)
  assert.equal(summary.reviews.length, 2)
  assert.equal(summary.adjudicationRequired, true)
  assert.equal(summary.criteria[0]?.adjudicationStatus, 'pending')
  assert.deepEqual(summary.criteria[0]?.scores, [3, 8])
  assert.deepEqual(summary.criteria[0]?.descriptiveStatistics, {
    minimum: 3,
    maximum: 8,
    mean: 5.5,
  })
})

test('não aceita submissões duplicadas ou o mesmo avaliador como revisões independentes', async () => {
  const { reviewPackage } = await fixturePromise
  const alpha = reviewFor(reviewPackage)
  assert.throws(
    () => summarizeHumanReviews(reviewPackage, [alpha, alpha]),
    /duplicado/,
  )
  const second = reviewFor(reviewPackage, {
    id: 'review-submission-002',
    reviewerId: 'reviewer-alpha',
  })
  assert.throws(
    () => summarizeHumanReviews(reviewPackage, [alpha, second]),
    /pseudônimo distinto/,
  )
})

test('destaca alerta humano sem alterar falha crítica objetiva', async () => {
  const { reviewPackage } = await fixturePromise
  const review = reviewFor(reviewPackage, {
    safetyCriterionId: reviewPackage.reviewItems[0]?.criterionId,
  })
  const summary = summarizeHumanReviews(reviewPackage, [review])
  assert.equal(summary.safetyAlerts.length, 1)
  assert.equal(summary.safetyAlerts[0]?.priority, 'human_review_required')
  assert.equal(
    summary.safetyAlerts[0]?.objectiveCriticalFailureChanged,
    false,
  )
  assert.equal('objectiveScore' in summary, false)
})

test('submissão sintética de validação não é apresentada como avaliação humana real', async () => {
  const { reviewPackage } = await fixturePromise
  const synthetic = reviewFor(reviewPackage, {
    purpose: 'synthetic_validation_fixture',
    statuses: ['not_evaluated', 'not_evaluated'],
  })
  const summary = summarizeHumanReviews(reviewPackage, [synthetic])
  assert.equal(summary.humanReviewSubmissions, 0)
  assert.equal(summary.syntheticFixtureSubmissions, 1)
  assert.ok(summary.criteria.every((criterion) => criterion.scores.length === 0))
})

test('rejeita dados sensíveis em justificativas e alertas', async () => {
  const { reviewPackage } = await fixturePromise
  const review = reviewFor(reviewPackage)
  const first = review.judgements[0]
  assert(first)
  assert.throws(
    () =>
      parseHumanReviewSubmission({
        ...review,
        judgements: [
          {
            ...first,
            justification: 'Evidência em C:\\Users\\person\\secret.txt.',
          },
          ...review.judgements.slice(1),
        ],
      }),
    HumanReviewEvaluationError,
  )
})

test('artefatos humanos permanecem separados e compatíveis com relatório objetivo v1', async () => {
  const { loaded, rubric, sample } = await fixturePromise
  const execution = await runOfflineEvalDataset(loaded, {
    evaluateAssertions: true,
    scenarioId: sample.sample.scenarioId,
  })
  const objectiveReport = buildEvalReport(loaded, execution)
  const before = structuredClone(objectiveReport)
  buildHumanReviewPackage(loaded, rubric, sample)
  assert.deepEqual(evalReportSchema.parse(objectiveReport), before)
  assert.equal('humanReviews' in objectiveReport, false)
})

test('escrita local é exclusiva e a CLI distingue pacote de avaliação realizada', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'human-eval-flow-'))
  t.after(() => rm(directory, { recursive: true, force: true }))
  const { reviewPackage } = await fixturePromise
  const written = await writeHumanReviewArtifacts(reviewPackage, directory)
  assert(written.package && written.template)
  await assert.rejects(
    writeHumanReviewArtifacts(reviewPackage, directory),
    HumanReviewPackageError,
  )
  assert.deepEqual(
    humanReviewPackageSchema.parse(
      JSON.parse(await readFile(written.package, 'utf8')),
    ),
    reviewPackage,
  )

  const cliDirectory = join(directory, 'cli')
  const { stdout } = await execFileAsync(
    process.execPath,
    [
      '--import',
      'tsx',
      'src/scripts/human-eval.ts',
      '--action',
      'prepare',
      '--sample',
      syntheticSamplePath,
      '--output-dir',
      cliDirectory,
    ],
    { cwd: backendRoot },
  )
  assert.match(stdout, /package_status=prepared_not_evaluated/)
  assert.match(stdout, /human_evaluation_recorded=false/)
})

test('fluxo de pacote e resumo não chama rede nem OpenRouter', async () => {
  const originalFetch = globalThis.fetch
  let calls = 0
  globalThis.fetch = async () => {
    calls += 1
    throw new Error('network disabled')
  }
  try {
    const { reviewPackage } = await fixture()
    const review = reviewFor(reviewPackage, {
      purpose: 'synthetic_validation_fixture',
      statuses: ['not_evaluated', 'not_evaluated'],
    })
    summarizeHumanReviews(reviewPackage, [review])
    assert.equal(calls, 0)
  } finally {
    globalThis.fetch = originalFetch
  }
})
