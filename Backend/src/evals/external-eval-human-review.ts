import { createHash } from 'node:crypto'

import type { LoadedEvalDataset } from './eval-loader.js'
import type { HumanEvalRubric } from './human-eval-rubric-schema.js'
import { buildHumanReviewPackage } from './human-review-package.js'
import {
  HUMAN_CONVERSATION_SAMPLE_VERSION,
  humanConversationSampleSchema,
} from './human-review-schema.js'
import {
  externalEvalReportSchema,
  type ExternalEvalReport,
} from './external-eval-schema.js'

export class ExternalEvalHumanReviewError extends Error {
  constructor() {
    super('A amostra EVAL-07 não pode ser preparada para revisão humana.')
    this.name = 'ExternalEvalHumanReviewError'
  }
}

export function prepareExternalEvalHumanReview(input: {
  readonly report: ExternalEvalReport
  readonly loaded: LoadedEvalDataset
  readonly rubric: HumanEvalRubric
  readonly scenarioId: string
  readonly assistantTurns: readonly string[]
  readonly authorizedLiveTranscript?: boolean
}) {
  const report = externalEvalReportSchema.parse(input.report)
  const scenario = input.loaded.data.cases.find(
    (candidate) => candidate.id === input.scenarioId,
  )
  if (
    scenario === undefined ||
    !report.selectedScenarioIds.includes(input.scenarioId) ||
    input.assistantTurns.length !== scenario.input.turns.length ||
    report.modality === 'dry_run'
  ) {
    throw new ExternalEvalHumanReviewError()
  }
  if (
    report.modality === 'live_external' &&
    input.authorizedLiveTranscript !== true
  ) {
    throw new ExternalEvalHumanReviewError()
  }
  const origin =
    report.modality === 'live_external'
      ? {
          kind: 'manual_real_test' as const,
          attestation: 'authorized_sanitized_test_transcript' as const,
          performanceEvidence: 'declared_real_test' as const,
        }
      : {
          kind: 'unverified' as const,
          attestation: 'origin_not_proven' as const,
          performanceEvidence: 'not_real_performance' as const,
        }
  const sampleId = `external-${createHash('sha256')
    .update(
      `${report.dataset.id}:${input.scenarioId}:${report.modality}:${report.model.requestedId}`,
    )
    .digest('hex')
    .slice(0, 20)}`
  const sample = humanConversationSampleSchema.parse({
    sampleVersion: HUMAN_CONVERSATION_SAMPLE_VERSION,
    sample: {
      id: sampleId,
      datasetId: report.dataset.id,
      datasetVersion: report.dataset.version,
      scenarioId: input.scenarioId,
      rubricId: input.rubric.rubric.id,
      rubricVersion: input.rubric.rubric.version,
      origin,
    },
    turns: scenario.input.turns.map((turn, index) => ({
      index,
      user: turn.message,
      assistant: input.assistantTurns[index],
    })),
  })
  return buildHumanReviewPackage(input.loaded, input.rubric, sample)
}
