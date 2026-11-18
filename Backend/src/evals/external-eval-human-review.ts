import { createHash } from 'node:crypto'

import type { LoadedEvalDataset } from './eval-loader.js'
import type { HumanEvalRubric } from './human-eval-rubric-schema.js'
import { buildHumanReviewPackage } from './human-review-package.js'
import { sanitizeEvalReportText } from './eval-report-builder.js'
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
  const reportScenarios = report.scenarios.filter(
    (candidate) => candidate.id === input.scenarioId,
  )
  const objectiveScenarios = report.objectiveEvaluation.scenarios.filter(
    (candidate) => candidate.id === input.scenarioId,
  )
  if (
    scenario === undefined ||
    report.dataset.id !== input.loaded.data.dataset.id ||
    report.dataset.version !== input.loaded.data.dataset.version ||
    report.selectedScenarioIds.filter(
      (candidate) => candidate === input.scenarioId,
    ).length !== 1 ||
    reportScenarios.length !== 1 ||
    reportScenarios[0]?.turns.length !== scenario.input.turns.length ||
    objectiveScenarios.length !== 1 ||
    objectiveScenarios[0]?.turns.length !== scenario.input.turns.length ||
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
  const sanitizedAssistantTurns = input.assistantTurns.map(
    sanitizeEvalReportText,
  )
  const transcriptFingerprint = scenario.input.turns.map((turn, index) => ({
    index,
    user: sanitizeEvalReportText(turn.message),
    assistant: sanitizedAssistantTurns[index] ?? '',
  }))
  const sampleId = `external-${createHash('sha256')
    .update(JSON.stringify({
      sampleVersion: HUMAN_CONVERSATION_SAMPLE_VERSION,
      reportVersion: report.reportVersion,
      datasetId: report.dataset.id,
      datasetVersion: report.dataset.version,
      scenarioId: input.scenarioId,
      modality: report.modality,
      modelId: sanitizeEvalReportText(report.model.requestedId),
      rubricId: input.rubric.rubric.id,
      rubricVersion: input.rubric.rubric.version,
      turns: transcriptFingerprint,
    }))
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
      assistant: sanitizedAssistantTurns[index],
    })),
  })
  return buildHumanReviewPackage(input.loaded, input.rubric, sample)
}
