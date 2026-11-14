import { isDeepStrictEqual } from 'node:util'
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'

import { sanitizeEvalReportText } from './eval-report-builder.js'
import {
  HUMAN_REVIEW_SUMMARY_VERSION,
  humanReviewPackageSchema,
  humanReviewSubmissionSchema,
  humanReviewSummarySchema,
  type HumanReviewPackage,
  type HumanReviewSubmission,
  type HumanReviewSummary,
} from './human-review-schema.js'

export const HUMAN_REVIEW_DIVERGENCE_THRESHOLD = 3 as const

export class HumanReviewEvaluationError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options)
    this.name = 'HumanReviewEvaluationError'
  }
}

function assertSanitizedReview(review: HumanReviewSubmission) {
  for (const judgement of review.judgements) {
    if (sanitizeEvalReportText(judgement.justification) !== judgement.justification) {
      throw new HumanReviewEvaluationError(
        `A justificativa de ${judgement.evaluationId} contém dado sensível ou caminho local.`,
      )
    }
    if (
      judgement.safetyAlert.flagged &&
      sanitizeEvalReportText(judgement.safetyAlert.rationale) !==
        judgement.safetyAlert.rationale
    ) {
      throw new HumanReviewEvaluationError(
        `O alerta de ${judgement.evaluationId} contém dado sensível ou caminho local.`,
      )
    }
  }
}

export function parseHumanReviewSubmission(value: unknown) {
  const result = humanReviewSubmissionSchema.safeParse(value)
  if (!result.success) {
    throw new HumanReviewEvaluationError(
      'A submissão humana não atende ao contrato versionado.',
      { cause: result.error },
    )
  }
  assertSanitizedReview(result.data)
  return result.data
}

async function loadJson(path: string, label: string) {
  let raw: string
  try {
    raw = await readFile(resolve(path), 'utf8')
  } catch (error) {
    throw new HumanReviewEvaluationError(
      `Não foi possível ler ${label} local.`,
      { cause: error },
    )
  }
  try {
    return JSON.parse(raw) as unknown
  } catch (error) {
    throw new HumanReviewEvaluationError(
      `${label} local não contém JSON válido.`,
      { cause: error },
    )
  }
}

export async function loadHumanReviewPackage(path: string) {
  const result = humanReviewPackageSchema.safeParse(
    await loadJson(path, 'o pacote de revisão'),
  )
  if (!result.success) {
    throw new HumanReviewEvaluationError(
      'O pacote de revisão não atende ao contrato versionado.',
      { cause: result.error },
    )
  }
  return result.data
}

export async function loadHumanReviewSubmission(path: string) {
  return parseHumanReviewSubmission(
    await loadJson(path, 'a submissão humana'),
  )
}

export function validateHumanReviewSubmission(
  reviewPackageInput: HumanReviewPackage,
  reviewInput: HumanReviewSubmission,
) {
  const reviewPackage = humanReviewPackageSchema.parse(reviewPackageInput)
  const review = parseHumanReviewSubmission(reviewInput)
  if (
    review.submission.sampleId !== reviewPackage.sample.id ||
    review.submission.datasetId !== reviewPackage.sample.datasetId ||
    review.submission.datasetVersion !== reviewPackage.sample.datasetVersion ||
    review.submission.scenarioId !== reviewPackage.sample.scenarioId ||
    review.submission.rubricId !== reviewPackage.rubric.id ||
    review.submission.rubricVersion !== reviewPackage.rubric.version
  ) {
    throw new HumanReviewEvaluationError(
      'A submissão não corresponde à amostra, dataset, cenário ou rubrica do pacote.',
    )
  }
  if (review.judgements.length !== reviewPackage.reviewItems.length) {
    throw new HumanReviewEvaluationError(
      'A submissão deve registrar exatamente todos os critérios do pacote.',
    )
  }

  const validTurns = new Set(reviewPackage.turns.map((turn) => turn.index))
  for (const item of reviewPackage.reviewItems) {
    const judgement = review.judgements.find(
      (candidate) => candidate.evaluationId === item.evaluationId,
    )
    if (
      judgement === undefined ||
      judgement.criterionId !== item.criterionId ||
      judgement.criterion !== item.criterion ||
      !isDeepStrictEqual(judgement.scope.turns, item.scope.turns)
    ) {
      throw new HumanReviewEvaluationError(
        `O julgamento ${item.evaluationId} não corresponde ao pacote.`,
      )
    }
    if (
      judgement.status === 'not_applicable' &&
      item.applicability === 'required'
    ) {
      throw new HumanReviewEvaluationError(
        `O critério obrigatório ${item.criterionId} não pode ser marcado como not_applicable.`,
      )
    }
    if (
      judgement.evidenceReferences.some(
        (reference) => !validTurns.has(reference.turn),
      )
    ) {
      throw new HumanReviewEvaluationError(
        `O julgamento ${item.evaluationId} referencia turno inexistente.`,
      )
    }
  }
  return review
}

function round(value: number) {
  return Math.round((value + Number.EPSILON) * 100) / 100
}

export function summarizeHumanReviews(
  reviewPackageInput: HumanReviewPackage,
  reviewInputs: readonly HumanReviewSubmission[],
): HumanReviewSummary {
  const reviewPackage = humanReviewPackageSchema.parse(reviewPackageInput)
  if (reviewInputs.length === 0) {
    throw new HumanReviewEvaluationError(
      'Informe ao menos uma submissão para produzir o resumo.',
    )
  }
  const reviews = reviewInputs.map((review) =>
    validateHumanReviewSubmission(reviewPackage, review),
  )
  const submissionIds = new Set<string>()
  const reviewerIds = new Set<string>()
  for (const review of reviews) {
    if (submissionIds.has(review.submission.id)) {
      throw new HumanReviewEvaluationError('ID de submissão duplicado.')
    }
    if (reviewerIds.has(review.submission.reviewerId)) {
      throw new HumanReviewEvaluationError(
        'Cada submissão independente deve usar um avaliador pseudônimo distinto.',
      )
    }
    submissionIds.add(review.submission.id)
    reviewerIds.add(review.submission.reviewerId)
  }

  const humanReviews = reviews.filter(
    (review) => review.submission.purpose === 'human_review',
  )
  const criteria = reviewPackage.reviewItems.map((item) => {
    const judgements = humanReviews.map((review) =>
      review.judgements.find(
        (judgement) => judgement.evaluationId === item.evaluationId,
      ),
    )
    const scores = judgements.flatMap((judgement) =>
      judgement?.status === 'evaluated' ? [judgement.score] : [],
    )
    const minimum = scores.length === 0 ? undefined : Math.min(...scores)
    const maximum = scores.length === 0 ? undefined : Math.max(...scores)
    const adjudicationStatus =
      minimum !== undefined &&
      maximum !== undefined &&
      maximum - minimum >= HUMAN_REVIEW_DIVERGENCE_THRESHOLD
        ? 'pending'
        : 'not_needed'
    return {
      criterionId: item.criterionId,
      criterion: item.criterion,
      reviewCount: judgements.filter(Boolean).length,
      evaluatedCount: judgements.filter(
        (judgement) => judgement?.status === 'evaluated',
      ).length,
      notEvaluatedCount: judgements.filter(
        (judgement) => judgement?.status === 'not_evaluated',
      ).length,
      notApplicableCount: judgements.filter(
        (judgement) => judgement?.status === 'not_applicable',
      ).length,
      scores,
      ...(minimum === undefined || maximum === undefined
        ? {}
        : {
            descriptiveStatistics: {
              minimum,
              maximum,
              mean: round(
                scores.reduce((total, score) => total + score, 0) /
                  scores.length,
              ),
            },
          }),
      adjudicationStatus,
    }
  })
  const safetyAlerts = humanReviews.flatMap((review) =>
    review.judgements.flatMap((judgement) =>
      judgement.safetyAlert.flagged
        ? [
            {
              submissionId: review.submission.id,
              reviewerId: review.submission.reviewerId,
              criterionId: judgement.criterionId,
              rationale: judgement.safetyAlert.rationale,
              priority: 'human_review_required' as const,
              objectiveCriticalFailureChanged: false as const,
            },
          ]
        : [],
    ),
  )

  return humanReviewSummarySchema.parse({
    summaryVersion: HUMAN_REVIEW_SUMMARY_VERSION,
    sampleId: reviewPackage.sample.id,
    reviewStatus: 'human_judgements_separate_from_objective_scores',
    origin: { ...reviewPackage.sample.origin },
    submissions: reviews.length,
    humanReviewSubmissions: humanReviews.length,
    syntheticFixtureSubmissions: reviews.length - humanReviews.length,
    reviews: reviews.map((review) => ({
      submissionId: review.submission.id,
      reviewerId: review.submission.reviewerId,
      purpose: review.submission.purpose,
      judgements: review.judgements.map((judgement) => ({
        evaluationId: judgement.evaluationId,
        criterionId: judgement.criterionId,
        status: judgement.status,
        ...(judgement.status === 'evaluated'
          ? { score: judgement.score }
          : {}),
        justification: judgement.justification,
        evidenceReferences: judgement.evidenceReferences.map((reference) => ({
          ...reference,
        })),
        safetyAlert: { ...judgement.safetyAlert },
      })),
    })),
    criteria,
    safetyAlerts,
    adjudicationRequired: criteria.some(
      (criterion) => criterion.adjudicationStatus === 'pending',
    ),
    limitations: [
      'Estatísticas são descritivas e não constituem decisão final ou média combinada com scores objetivos.',
      'Divergências marcadas como pending exigem revisão ou adjudicação humana.',
      'Alertas humanos de segurança não alteram automaticamente falhas críticas objetivas.',
      reviewPackage.sample.origin.performanceEvidence === 'not_real_performance'
        ? 'A origem desta amostra não permite alegar desempenho real de um modelo externo.'
        : 'A procedência real depende da declaração de autorização e sanitização registrada na amostra.',
    ],
  })
}

export function serializeHumanReviewSummary(summary: HumanReviewSummary) {
  return `${JSON.stringify(humanReviewSummarySchema.parse(summary), null, 2)}\n`
}
