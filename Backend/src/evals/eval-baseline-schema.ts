import { z } from 'zod'

import {
  EVAL_REPORT_ENGINE,
  EVAL_REPORT_FORMAT_VERSION,
  evalReportSchema,
} from './eval-report-schema.js'

export const EVAL_BASELINE_VERSION = 1 as const
export const EVAL_BASELINE_CAPTURE_TOOL = 'eval-regression-v1' as const

const fingerprintSchema = z
  .string()
  .regex(/^sha256:[a-f0-9]{64}$/)

export const evalBaselineSchema = z
  .object({
    baselineVersion: z.literal(EVAL_BASELINE_VERSION),
    baselineId: z.string().trim().min(1).max(200),
    dataset: z
      .object({
        id: z.string().trim().min(1).max(128),
        version: z.string().trim().min(1).max(128),
        fingerprint: fingerprintSchema,
      })
      .strict(),
    execution: z
      .object({
        mode: z.literal('offline'),
        reportVersion: z.literal(EVAL_REPORT_FORMAT_VERSION),
        evaluationEngine: z.literal(EVAL_REPORT_ENGINE),
        captureTool: z.literal(EVAL_BASELINE_CAPTURE_TOOL),
      })
      .strict(),
    referenceData: z
      .object({
        catalogFingerprint: fingerprintSchema,
        faqFingerprint: fingerprintSchema,
      })
      .strict(),
    scope: z
      .object({
        kind: z.enum(['full_dataset', 'selected_scenarios']),
        completeForScope: z.literal(true),
        datasetCoverage: z.enum(['complete', 'partial']),
        expectedScenarioIds: z.array(z.string().min(1).max(128)).min(1),
      })
      .strict(),
    reference: evalReportSchema,
  })
  .strict()
  .superRefine((baseline, context) => {
    const report = baseline.reference
    const mismatches: Array<[PropertyKey[], string]> = []
    const expectedIds = baseline.scope.expectedScenarioIds
    if (new Set(expectedIds).size !== expectedIds.length) {
      mismatches.push([
        ['scope', 'expectedScenarioIds'],
        'O baseline não aceita cenários esperados duplicados.',
      ])
    }
    if (
      baseline.dataset.id !== report.dataset.id ||
      baseline.dataset.version !== report.dataset.version
    ) {
      mismatches.push([
        ['dataset'],
        'O dataset do baseline deve corresponder ao relatório de referência.',
      ])
    }
    const reportScenarioIds = report.scenarios.map((scenario) => scenario.id)
    if (
      new Set(reportScenarioIds).size !== reportScenarioIds.length ||
      reportScenarioIds.length !== expectedIds.length ||
      reportScenarioIds.some((id, index) => id !== expectedIds[index])
    ) {
      mismatches.push([
        ['reference', 'scenarios'],
        'Os cenários do relatório devem corresponder exatamente ao escopo.',
      ])
    }
    const assertionKeys = new Set<string>()
    for (const [scenarioIndex, scenario] of report.scenarios.entries()) {
      if (
        scenario.technicalStatus !== 'completed' ||
        scenario.turns.some((turn) => turn.technicalStatus !== 'completed')
      ) {
        mismatches.push([
          ['reference', 'scenarios', scenarioIndex, 'technicalStatus'],
          'Todos os cenários e turnos do baseline devem estar concluídos.',
        ])
      }
      for (const turn of scenario.turns) {
        for (const assertion of turn.assertions) {
          const key = `${scenario.id}:${turn.index}:${assertion.assertionId}`
          if (assertionKeys.has(key)) {
            mismatches.push([
              ['reference', 'scenarios', scenarioIndex, 'turns'],
              'O baseline não aceita identidade de assertion duplicada.',
            ])
          }
          assertionKeys.add(key)
        }
      }
    }
    if (
      baseline.execution.mode !== report.execution.mode ||
      baseline.execution.reportVersion !== report.reportVersion ||
      baseline.execution.evaluationEngine !==
        report.execution.evaluationEngine
    ) {
      mismatches.push([
        ['execution'],
        'A execução do baseline deve corresponder ao relatório de referência.',
      ])
    }
    if (
      baseline.scope.kind !== report.coverage.scope ||
      baseline.scope.completeForScope !== report.coverage.completeForScope ||
      baseline.scope.datasetCoverage !== report.coverage.datasetCoverage ||
      baseline.scope.expectedScenarioIds.length !==
        report.coverage.expectedScenarioIds.length ||
      baseline.scope.expectedScenarioIds.some(
        (id, index) => id !== report.coverage.expectedScenarioIds[index],
      )
    ) {
      mismatches.push([
        ['scope'],
        'O escopo do baseline deve corresponder ao relatório de referência.',
      ])
    }
    if (
      report.coverage.completeForScope !== true ||
      report.coverage.missingScenarioIds.length > 0 ||
      report.summary.scenarios.technicalFailures > 0 ||
      report.summary.scenarios.notExecuted > 0
    ) {
      mismatches.push([
        ['reference'],
        'O baseline exige referência tecnicamente concluída e cobertura completa para o escopo.',
      ])
    }
    for (const [path, message] of mismatches) {
      context.addIssue({ code: 'custom', path, message })
    }
  })

export type EvalBaseline = z.infer<typeof evalBaselineSchema>
export type EvalReferenceDataFingerprints = EvalBaseline['referenceData']
