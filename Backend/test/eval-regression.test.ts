import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import test from 'node:test'
import { promisify } from 'node:util'
import { fileURLToPath } from 'node:url'

import {
  buildEvalBaseline,
  EvalBaselineError,
  fingerprintEvalReferenceData,
  loadEvalBaseline,
  serializeEvalBaseline,
  writeEvalBaseline,
} from '../src/evals/eval-baseline.js'
import {
  evalBaselineSchema,
  type EvalBaseline,
} from '../src/evals/eval-baseline-schema.js'
import { parseEvalDataset } from '../src/evals/eval-loader.js'
import { buildEvalReport } from '../src/evals/eval-report-builder.js'
import { evalReportSchema, type EvalReport } from '../src/evals/eval-report-schema.js'
import {
  compareEvalBaseline,
  evalRegressionExitCode,
  serializeEvalRegressionReport,
} from '../src/evals/eval-regression.js'
import { renderEvalRegressionMarkdown } from '../src/evals/eval-regression-markdown.js'
import { evalRegressionReportSchema } from '../src/evals/eval-regression-schema.js'
import {
  EvalRegressionWriteError,
  writeEvalRegressionReports,
} from '../src/evals/eval-regression-writer.js'
import {
  resolveOfflineEvalDataset,
  runOfflineEvalDataset,
} from '../src/evals/offline-eval-runner.js'
import { loadEvalDataset } from '../src/evals/eval-loader.js'

const execFileAsync = promisify(execFile)
const backendRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const committedBaselines = [
  'universal-core',
  'universal-safety',
  'hidrasplash-recommendations',
  'hidrasplash-conversations',
] as const

async function fixture(datasetId = 'universal-core') {
  const loaded = await loadEvalDataset(resolveOfflineEvalDataset(datasetId))
  const [execution, referenceData] = await Promise.all([
    runOfflineEvalDataset(loaded, { evaluateAssertions: true }),
    fingerprintEvalReferenceData(),
  ])
  const report = buildEvalReport(loaded, execution)
  const baseline = buildEvalBaseline(loaded, report, referenceData)
  return { loaded, report, baseline, referenceData }
}

const corePromise = fixture()
const safetyPromise = fixture('universal-safety')
const selectedPromise = (async () => {
  const loaded = await loadEvalDataset(
    resolveOfflineEvalDataset('universal-core'),
  )
  const [execution, referenceData] = await Promise.all([
    runOfflineEvalDataset(loaded, {
      evaluateAssertions: true,
      scenarioId: 'universal.core.incomplete-need.001',
    }),
    fingerprintEvalReferenceData(),
  ])
  const report = buildEvalReport(loaded, execution)
  const baseline = buildEvalBaseline(loaded, report, referenceData)
  return { loaded, report, baseline, referenceData }
})()

function firstAssertion(report: EvalReport) {
  const assertion = report.scenarios[0]?.turns[0]?.assertions[0]
  assert(assertion)
  return assertion
}

function currentWithStatus(
  report: EvalReport,
  status: 'passed' | 'failed' | 'not_evaluated',
) {
  const current = structuredClone(report)
  firstAssertion(current).status = status
  return evalReportSchema.parse(current)
}

function baselineWithStatus(
  baseline: EvalBaseline,
  status: 'passed' | 'failed' | 'not_evaluated',
) {
  const changed = structuredClone(baseline)
  firstAssertion(changed.reference).status = status
  return evalBaselineSchema.parse(changed)
}

test('captura baseline v1 reproduzível a partir do relatório EVAL-05', async () => {
  const { loaded, report, baseline, referenceData } = await corePromise
  assert.deepEqual(evalBaselineSchema.parse(baseline), baseline)
  assert.equal(baseline.baselineVersion, 1)
  assert.equal(baseline.execution.reportVersion, report.reportVersion)
  assert.equal(baseline.execution.evaluationEngine, report.execution.evaluationEngine)
  assert.equal(
    serializeEvalBaseline(buildEvalBaseline(loaded, report, referenceData)),
    serializeEvalBaseline(baseline),
  )
})

test('repetição determinística não encontra regressões novas', async () => {
  const { loaded, report, baseline, referenceData } = await corePromise
  const comparison = compareEvalBaseline(
    baseline,
    loaded,
    report,
    referenceData,
  )
  assert.equal(comparison.result, 'no_regressions')
  assert.equal(comparison.summary.regressions, 0)
  assert.equal(comparison.summary.knownFailures, 0)
  assert.equal(comparison.score.finalDelta, 0)
})

test('códigos de saída distinguem regressão, falha técnica e incompatibilidade', () => {
  assert.equal(evalRegressionExitCode('no_regressions'), 0)
  assert.equal(evalRegressionExitCode('known_failures_only'), 0)
  assert.equal(evalRegressionExitCode('regressions_detected'), 2)
  assert.equal(evalRegressionExitCode('scoring_inconsistency'), 2)
  assert.equal(evalRegressionExitCode('technical_failure'), 3)
  assert.equal(evalRegressionExitCode('incompatible'), 4)
})

test('baseline universal-safety preserva duas falhas conhecidas', async () => {
  const { loaded, report, baseline, referenceData } = await safetyPromise
  assert.deepEqual(report.summary.assertions, {
    passed: 5,
    failed: 2,
    notEvaluated: 0,
  })
  const comparison = compareEvalBaseline(
    baseline,
    loaded,
    report,
    referenceData,
  )
  assert.equal(comparison.result, 'known_failures_only')
  assert.equal(comparison.summary.knownFailures, 2)
  assert.equal(comparison.summary.regressions, 0)
})

test('quatro baselines versionados preservam 33 aprovações e duas falhas', async () => {
  let passed = 0
  let failed = 0
  for (const datasetId of committedBaselines) {
    const baseline = await loadEvalBaseline(
      resolve(
        backendRoot,
        `evals/baselines/${datasetId}.v1.json`,
      ),
    )
    assert.equal(baseline.dataset.id, datasetId)
    assert.equal(baseline.scope.kind, 'full_dataset')
    assert.equal(baseline.scope.datasetCoverage, 'complete')
    passed += baseline.reference.summary.assertions.passed
    failed += baseline.reference.summary.assertions.failed
  }
  assert.deepEqual({ passed, failed }, { passed: 33, failed: 2 })
})

test('classifica passed para failed como regressão comprovada', async () => {
  const { loaded, report, baseline, referenceData } = await corePromise
  const comparison = compareEvalBaseline(
    baseline,
    loaded,
    currentWithStatus(report, 'failed'),
    referenceData,
  )
  assert.equal(comparison.result, 'regressions_detected')
  assert.equal(comparison.summary.regressions, 1)
})

test('classifica perda de evidência, melhoria, falha conhecida e nova falha', async () => {
  const { loaded, report, baseline, referenceData } = await corePromise
  const cases = [
    {
      baseline: baselineWithStatus(baseline, 'passed'),
      current: currentWithStatus(report, 'not_evaluated'),
      field: 'evidenceLosses' as const,
    },
    {
      baseline: baselineWithStatus(baseline, 'failed'),
      current: currentWithStatus(report, 'passed'),
      field: 'improvements' as const,
    },
    {
      baseline: baselineWithStatus(baseline, 'failed'),
      current: currentWithStatus(report, 'failed'),
      field: 'knownFailures' as const,
    },
    {
      baseline: baselineWithStatus(baseline, 'not_evaluated'),
      current: currentWithStatus(report, 'failed'),
      field: 'newlyDetectedFailures' as const,
    },
  ]
  for (const item of cases) {
    const comparison = compareEvalBaseline(
      item.baseline,
      loaded,
      item.current,
      referenceData,
    )
    assert.equal(comparison.summary[item.field], 1)
  }
})

test('nova falha crítica bloqueia sem esconder o veto ou a queda de nota', async () => {
  const { loaded, report, baseline, referenceData } = await corePromise
  const criticalBaseline = structuredClone(baseline)
  firstAssertion(criticalBaseline.reference).severity = 'critical'
  const current = structuredClone(report)
  firstAssertion(current).severity = 'critical'
  firstAssertion(current).status = 'failed'
  const scenario = current.scenarios[0]
  assert(scenario?.objectiveScore)
  scenario.criticalFailures = 1
  scenario.objectiveStatus = 'failed_critical'
  scenario.overallStatus = 'failed_critical'
  scenario.objectiveScore.raw = 6
  scenario.objectiveScore.final = 3
  current.summary.criticalFailures = 1
  current.summary.objectiveStatus = 'failed_critical'
  current.summary.overallStatus = 'failed_critical'
  assert(current.summary.objectiveScore)
  current.summary.objectiveScore.raw = 8
  current.summary.objectiveScore.final = 3
  const comparison = compareEvalBaseline(
    evalBaselineSchema.parse(criticalBaseline),
    loaded,
    evalReportSchema.parse(current),
    referenceData,
  )
  assert.equal(comparison.result, 'regressions_detected')
  assert.equal(comparison.summary.newCriticalFailures, 1)
  assert.equal(comparison.score.current?.final, 3)
  assert((comparison.score.finalDelta ?? 0) < 0)
})

test('queda de nota é exibida e não compensa regressão de assertion', async () => {
  const { loaded, report, baseline, referenceData } = await corePromise
  const current = currentWithStatus(report, 'failed')
  assert(current.summary.objectiveScore)
  current.summary.objectiveScore.raw = 8
  current.summary.objectiveScore.final = 8
  const comparison = compareEvalBaseline(
    baseline,
    loaded,
    current,
    referenceData,
  )
  assert.equal(comparison.summary.regressions, 1)
  assert.equal(comparison.score.finalDelta, -2)
  assert.equal(comparison.result, 'regressions_detected')
})

test('falha técnica e turno não executado impedem aprovação', async () => {
  const { loaded, report, baseline, referenceData } = await corePromise
  const current = structuredClone(report)
  const scenario = current.scenarios[0]
  const turn = scenario?.turns[0]
  assert(scenario && turn)
  scenario.technicalStatus = 'technical_failure'
  turn.technicalStatus = 'technical_failure'
  turn.technicalErrorCode = 'OFFLINE_EXECUTION_FAILED'
  current.summary.scenarios.technicalFailures = 1
  current.summary.scenarios.completed -= 1
  const comparison = compareEvalBaseline(
    baseline,
    loaded,
    evalReportSchema.parse(current),
    referenceData,
  )
  assert.equal(comparison.result, 'technical_failure')
  assert(comparison.summary.technicalProblems >= 2)
})

test('detecta dataset de outra versão e conteúdo alterado sem versionamento', async () => {
  const { loaded, report, baseline, referenceData } = await corePromise
  const otherVersion = structuredClone(report)
  otherVersion.dataset.version = '2.0.0'
  const versionComparison = compareEvalBaseline(
    baseline,
    loaded,
    evalReportSchema.parse(otherVersion),
    referenceData,
  )
  assert.equal(versionComparison.result, 'incompatible')
  assert.equal(versionComparison.score.comparable, false)
  assert.equal(versionComparison.score.rawDelta, undefined)
  assert.equal(versionComparison.score.finalDelta, undefined)
  assert(
    versionComparison.scenarios.every(
      (scenario) => scenario.score.comparable === false,
    ),
  )
  assert(
    versionComparison.compatibility.issues.some(
      (issue) => issue.code === 'dataset_version',
    ),
  )

  const raw = structuredClone(loaded.data) as unknown as {
    cases: Array<{ tags: string[] }>
  }
  raw.cases[0]?.tags.push('fingerprint-change')
  const changedDataset = parseEvalDataset(raw)
  const fingerprintComparison = compareEvalBaseline(
    baseline,
    changedDataset,
    report,
    referenceData,
  )
  assert.equal(fingerprintComparison.result, 'incompatible')
  assert.equal(fingerprintComparison.score.comparable, false)
  assert.equal(fingerprintComparison.score.rawDelta, undefined)
  assert(
    fingerprintComparison.compatibility.issues.some(
      (issue) => issue.code === 'dataset_fingerprint',
    ),
  )

  const changedReferenceData = {
    ...referenceData,
    catalogFingerprint: `sha256:${'0'.repeat(64)}`,
  }
  const referenceComparison = compareEvalBaseline(
    baseline,
    loaded,
    report,
    changedReferenceData,
  )
  assert.equal(referenceComparison.result, 'incompatible')
  assert(
    referenceComparison.compatibility.issues.some(
      (issue) => issue.code === 'catalog_fingerprint',
    ),
  )
})

test('assertion removida, adicionada ou modificada torna comparação incompatível', async () => {
  const { loaded, report, baseline, referenceData } = await corePromise
  const variants = []
  const removed = structuredClone(report)
  removed.scenarios[0]?.turns[0]?.assertions.shift()
  variants.push({ report: removed, code: 'assertion_removed' })
  const added = structuredClone(report)
  const existing = firstAssertion(added)
  added.scenarios[0]?.turns[0]?.assertions.push({
    ...existing,
    assertionId: 'controlled-added-assertion',
  })
  variants.push({ report: added, code: 'assertion_added' })
  const modified = structuredClone(report)
  firstAssertion(modified).severity = 'critical'
  variants.push({ report: modified, code: 'assertion_modified' })
  for (const variant of variants) {
    const comparison = compareEvalBaseline(
      baseline,
      loaded,
      evalReportSchema.parse(variant.report),
      referenceData,
    )
    assert.equal(comparison.result, 'incompatible')
    assert(
      comparison.compatibility.issues.some(
        (issue) => issue.code === variant.code,
      ),
    )
  }
})

test('escopo incompatível é distinto de cobertura insuficiente', async () => {
  const { loaded, report, baseline, referenceData } = await corePromise
  const scope = structuredClone(report)
  scope.coverage.scope = 'selected_scenarios'
  scope.coverage.datasetCoverage = 'partial'
  const incompatible = compareEvalBaseline(
    baseline,
    loaded,
    evalReportSchema.parse(scope),
    referenceData,
  )
  assert.equal(incompatible.result, 'incompatible')
  assert.equal(incompatible.score.comparable, false)
  assert.equal(incompatible.score.finalDelta, undefined)

  const incomplete = structuredClone(report)
  const missing = incomplete.coverage.expectedScenarioIds[0]
  assert(missing)
  incomplete.coverage.completeForScope = false
  incomplete.coverage.datasetCoverage = 'partial'
  incomplete.coverage.missingScenarioIds = [missing]
  incomplete.coverage.evaluatedScenarioIds =
    incomplete.coverage.evaluatedScenarioIds.filter((id) => id !== missing)
  incomplete.summary.scenarios.notExecuted = 1
  incomplete.summary.scenarios.evaluated -= 1
  const technical = compareEvalBaseline(
    baseline,
    loaded,
    evalReportSchema.parse(incomplete),
    referenceData,
  )
  assert.equal(technical.result, 'technical_failure')
  assert.equal(technical.score.comparable, false)
  assert.equal(technical.score.finalDelta, undefined)
})

test('escopo parcial intencional e equivalente permite deltas', async () => {
  const { loaded, report, baseline, referenceData } = await selectedPromise
  assert.equal(report.coverage.scope, 'selected_scenarios')
  assert.equal(report.summary.objectiveScore?.partial, true)
  const comparison = compareEvalBaseline(
    baseline,
    loaded,
    report,
    referenceData,
  )
  assert.equal(comparison.result, 'no_regressions')
  assert.equal(comparison.score.comparable, true)
  assert.equal(comparison.score.rawDelta, 0)
  assert.equal(comparison.score.finalDelta, 0)
})

test('mudança de nota sem transição objetiva bloqueia no dataset e no cenário', async () => {
  const { loaded, report, baseline, referenceData } = await corePromise
  const aggregate = structuredClone(report)
  assert(aggregate.summary.objectiveScore)
  aggregate.summary.objectiveScore.raw = 8
  aggregate.summary.objectiveScore.final = 8
  const aggregateComparison = compareEvalBaseline(
    baseline,
    loaded,
    evalReportSchema.parse(aggregate),
    referenceData,
  )
  assert.equal(aggregateComparison.result, 'scoring_inconsistency')
  assert.equal(aggregateComparison.summary.scoringInconsistencies, 1)
  assert.equal(aggregateComparison.scoringIssues[0]?.scope, 'dataset')
  assert.equal(evalRegressionExitCode(aggregateComparison.result), 2)

  const scenarioOnly = structuredClone(report)
  const scenario = scenarioOnly.scenarios[0]
  assert(scenario?.objectiveScore)
  scenario.objectiveScore.raw = 8
  scenario.objectiveScore.final = 8
  const scenarioComparison = compareEvalBaseline(
    baseline,
    loaded,
    evalReportSchema.parse(scenarioOnly),
    referenceData,
  )
  assert.equal(scenarioComparison.result, 'scoring_inconsistency')
  assert.equal(scenarioComparison.summary.scoringInconsistencies, 1)
  assert.equal(scenarioComparison.scoringIssues[0]?.scope, 'scenario')
  assert.equal(
    scenarioComparison.scoringIssues[0]?.scenarioId,
    scenario.id,
  )
})

test('regressão e melhoria com variação coerente mantêm classificação objetiva', async () => {
  const { loaded, report, baseline, referenceData } = await corePromise
  const regression = currentWithStatus(report, 'failed')
  assert(regression.summary.objectiveScore)
  regression.summary.objectiveScore.raw = 8
  regression.summary.objectiveScore.final = 8
  const regressionScenario = regression.scenarios[0]
  assert(regressionScenario?.objectiveScore)
  regressionScenario.objectiveScore.raw = 8
  regressionScenario.objectiveScore.final = 8
  const regressionComparison = compareEvalBaseline(
    baseline,
    loaded,
    regression,
    referenceData,
  )
  assert.equal(regressionComparison.result, 'regressions_detected')
  assert.equal(regressionComparison.summary.regressions, 1)
  assert.equal(regressionComparison.summary.scoringInconsistencies, 0)

  const improvementBaseline = baselineWithStatus(baseline, 'failed')
  assert(improvementBaseline.reference.summary.objectiveScore)
  improvementBaseline.reference.summary.objectiveScore.raw = 8
  improvementBaseline.reference.summary.objectiveScore.final = 8
  const baselineScenario = improvementBaseline.reference.scenarios[0]
  assert(baselineScenario?.objectiveScore)
  baselineScenario.objectiveScore.raw = 8
  baselineScenario.objectiveScore.final = 8
  const improvementComparison = compareEvalBaseline(
    evalBaselineSchema.parse(improvementBaseline),
    loaded,
    report,
    referenceData,
  )
  assert.equal(improvementComparison.summary.improvements, 1)
  assert.equal(improvementComparison.summary.scoringInconsistencies, 0)
  assert.equal(improvementComparison.result, 'no_regressions')
})

test('identidades duplicadas no relatório atual impedem comparação', async () => {
  const { loaded, report, baseline, referenceData } = await corePromise
  const duplicateAssertion = structuredClone(report)
  const assertion = firstAssertion(duplicateAssertion)
  duplicateAssertion.scenarios[0]?.turns[0]?.assertions.push({
    ...assertion,
    status: 'failed',
  })
  const assertionComparison = compareEvalBaseline(
    baseline,
    loaded,
    evalReportSchema.parse(duplicateAssertion),
    referenceData,
  )
  assert.equal(assertionComparison.result, 'incompatible')
  assert.equal(assertionComparison.score.comparable, false)
  assert(
    assertionComparison.compatibility.issues.some(
      (issue) => issue.code === 'duplicate_assertion',
    ),
  )

  const duplicateScenario = structuredClone(report)
  const scenario = duplicateScenario.scenarios[0]
  assert(scenario)
  duplicateScenario.scenarios.push(structuredClone(scenario))
  const scenarioComparison = compareEvalBaseline(
    baseline,
    loaded,
    evalReportSchema.parse(duplicateScenario),
    referenceData,
  )
  assert(
    scenarioComparison.compatibility.issues.some(
      (issue) => issue.code === 'duplicate_scenario',
    ),
  )

  const duplicateTurn = structuredClone(report)
  const turn = duplicateTurn.scenarios[0]?.turns[0]
  assert(turn)
  duplicateTurn.scenarios[0]?.turns.push(structuredClone(turn))
  const turnComparison = compareEvalBaseline(
    baseline,
    loaded,
    evalReportSchema.parse(duplicateTurn),
    referenceData,
  )
  assert(
    turnComparison.compatibility.issues.some(
      (issue) => issue.code === 'duplicate_turn',
    ),
  )
})

test('loader rejeita baseline inexistente, inválido ou corrompido', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'eval-baseline-invalid-'))
  t.after(() => rm(directory, { recursive: true, force: true }))
  await assert.rejects(
    loadEvalBaseline(join(directory, 'missing.json')),
    EvalBaselineError,
  )
  const corrupt = join(directory, 'corrupt.json')
  await writeFile(corrupt, '{')
  await assert.rejects(loadEvalBaseline(corrupt), EvalBaselineError)
  const invalid = join(directory, 'invalid.json')
  await writeFile(invalid, '{}')
  await assert.rejects(loadEvalBaseline(invalid), EvalBaselineError)
})

test('baseline e relatórios nunca sobrescrevem artefatos existentes', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'eval-baseline-write-'))
  t.after(() => rm(directory, { recursive: true, force: true }))
  const { loaded, report, baseline, referenceData } = await corePromise
  const path = join(directory, 'baseline.json')
  await writeEvalBaseline(baseline, path)
  await assert.rejects(
    writeEvalBaseline(baseline, path),
    EvalBaselineError,
  )
  const comparison = compareEvalBaseline(
    baseline,
    loaded,
    report,
    referenceData,
  )
  await writeEvalRegressionReports(comparison, directory)
  await assert.rejects(
    writeEvalRegressionReports(comparison, directory),
    EvalRegressionWriteError,
  )
})

test('JSON e Markdown compartilham resultado, contagens e limitações', async () => {
  const { loaded, report, baseline, referenceData } = await safetyPromise
  const comparison = compareEvalBaseline(
    baseline,
    loaded,
    report,
    referenceData,
  )
  const parsed = evalRegressionReportSchema.parse(
    JSON.parse(serializeEvalRegressionReport(comparison)),
  )
  const markdown = renderEvalRegressionMarkdown(comparison)
  assert.equal(parsed.result, 'known_failures_only')
  assert.match(markdown, /known\\_failures\\_only/)
  assert.match(markdown, /\| 0 \| 0 \| 0 \| 2 \|/)
  assert.match(markdown, /Critérios humanos obrigatórios/)
})

test('artefatos rejeitam evidência sensível e permanecem separados da EVAL-06', async () => {
  const { loaded, report, referenceData } = await corePromise
  const unsafe = structuredClone(report)
  firstAssertion(unsafe).reason = 'Token sk-or-supersecret em C:\\Users\\person\\secret.txt.'
  assert.throws(
    () => buildEvalBaseline(loaded, evalReportSchema.parse(unsafe), referenceData),
    EvalBaselineError,
  )
  const baseline = buildEvalBaseline(loaded, report, referenceData)
  const comparison = compareEvalBaseline(
    baseline,
    loaded,
    report,
    referenceData,
  )
  assert.equal('humanReviews' in comparison, false)
  assert.equal(comparison.current.requiredHumanCriteriaPending > 0, true)
})

test('CLI captura, verifica, protege baseline e não chama rede/OpenRouter', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'eval-regression-cli-'))
  t.after(() => rm(directory, { recursive: true, force: true }))
  const baselinePath = join(directory, 'baseline.json')
  const capture = await execFileAsync(
    process.execPath,
    [
      '--import',
      'tsx',
      'src/scripts/eval-regression.ts',
      '--action',
      'capture',
      '--dataset',
      'universal-core',
      '--output',
      baselinePath,
    ],
    { cwd: backendRoot },
  )
  assert.match(capture.stdout, /action=capture/)
  await assert.rejects(
    execFileAsync(
      process.execPath,
      [
        '--import',
        'tsx',
        'src/scripts/eval-regression.ts',
        '--action',
        'capture',
        '--dataset',
        'universal-core',
        '--output',
        baselinePath,
      ],
      { cwd: backendRoot },
    ),
  )
  const check = await execFileAsync(
    process.execPath,
    [
      '--import',
      'tsx',
      'src/scripts/eval-regression.ts',
      '--action',
      'check',
      '--dataset',
      'universal-core',
      '--baseline',
      baselinePath,
      '--report-dir',
      join(directory, 'reports'),
    ],
    { cwd: backendRoot },
  )
  assert.match(check.stdout, /result=no_regressions/)
  assert.doesNotMatch(check.stdout, /OpenRouter/i)
  assert.equal(
    evalBaselineSchema.parse(
      JSON.parse(await readFile(baselinePath, 'utf8')),
    ).reference.reportVersion,
    1,
  )
})

test('captura e comparação completas não chamam fetch ou OpenRouter', async () => {
  const originalFetch = globalThis.fetch
  let calls = 0
  globalThis.fetch = async () => {
    calls += 1
    throw new Error('network disabled')
  }
  try {
    const { loaded, report, baseline, referenceData } = await fixture()
    compareEvalBaseline(baseline, loaded, report, referenceData)
    assert.equal(calls, 0)
  } finally {
    globalThis.fetch = originalFetch
  }
})
