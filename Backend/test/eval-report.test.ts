import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { promisify } from 'node:util'
import { fileURLToPath } from 'node:url'
import test from 'node:test'

import { loadCatalogRepository } from '../src/catalog/catalog-repository.js'
import {
  createEvalCanonicalData,
  evaluateOfflineEvalExecution,
} from '../src/evals/eval-assertion-engine.js'
import {
  buildEvalReport,
  serializeEvalReportJson,
} from '../src/evals/eval-report-builder.js'
import { renderEvalReportMarkdown } from '../src/evals/eval-report-markdown.js'
import { evalReportSchema } from '../src/evals/eval-report-schema.js'
import {
  evalReportFileNames,
  EvalReportWriteError,
  writeEvalReportFiles,
} from '../src/evals/eval-report-writer.js'
import { loadEvalDataset } from '../src/evals/eval-loader.js'
import {
  resolveOfflineEvalDataset,
  runOfflineEvalDataset,
  type OfflineEvalExecution,
} from '../src/evals/offline-eval-runner.js'

const execFileAsync = promisify(execFile)
const backendRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')

async function evaluatedFixture(
  datasetId = 'universal-core',
  scenarioId?: string,
) {
  const loaded = await loadEvalDataset(resolveOfflineEvalDataset(datasetId))
  const execution = await runOfflineEvalDataset(loaded, {
    evaluateAssertions: true,
    ...(scenarioId === undefined ? {} : { scenarioId }),
  })
  return { loaded, execution, report: buildEvalReport(loaded, execution) }
}

const coreFixture = evaluatedFixture()

test('gera JSON versionado, validável e byte a byte reproduzível', async () => {
  const { report } = await coreFixture
  const first = serializeEvalReportJson(report)
  const second = serializeEvalReportJson(structuredClone(report))
  assert.equal(second, first)
  assert.deepEqual(evalReportSchema.parse(JSON.parse(first)), report)
  assert.equal(report.reportVersion, 1)
  assert.equal(report.execution.generatedAt, undefined)
})

test('gera Markdown a partir do mesmo resultado e preserva o resumo JSON', async () => {
  const { report } = await coreFixture
  const markdown = renderEvalReportMarkdown(report)
  assert.match(markdown, /^# Relatório de avaliação/m)
  assert.match(
    markdown,
    new RegExp(`Assertions aprovadas \\| ${report.summary.assertions.passed}`),
  )
  assert.match(
    markdown,
    new RegExp(`Nota objetiva final \\| ${report.summary.objectiveScore?.final}`),
  )
  assert.equal(
    (markdown.match(/^### /gm) ?? []).length,
    report.scenarios.length,
  )
})

test('preserva notas bruta/final, veto crítico e pendências humanas sem recalcular', async () => {
  const { loaded, execution } = await coreFixture
  assert(execution.evaluation)
  const firstScenario = execution.evaluation.scenarios[0]
  const firstAssertion = firstScenario?.assertionResults[0]
  assert(firstScenario && firstAssertion)
  const criticalExecution: OfflineEvalExecution = {
    ...execution,
    evaluation: {
      ...execution.evaluation,
      objectiveStatus: 'failed_critical',
      overallStatus: 'failed_critical',
      criticalFailures: 1,
      objectiveScore: {
        raw: 9.75,
        final: 3,
        partial: false,
        scope: 'full_dataset',
      },
      scenarios: [
        {
          ...firstScenario,
          objectiveStatus: 'failed_critical',
          overallStatus: 'failed_critical',
          criticalFailures: 1,
          objectiveScore: { raw: 9.75, final: 3, partial: false },
          assertionResults: [
            {
              ...firstAssertion,
              severity: 'critical',
              status: 'failed',
              reason: 'Falha crítica simulada pelo resultado avaliado.',
            },
            ...firstScenario.assertionResults.slice(1),
          ],
        },
        ...execution.evaluation.scenarios.slice(1),
      ],
    },
  }
  const report = buildEvalReport(loaded, criticalExecution)
  const markdown = renderEvalReportMarkdown(report)
  assert.deepEqual(report.summary.objectiveScore, {
    raw: 9.75,
    final: 3,
    partial: false,
  })
  assert.equal(report.summary.criticalFailures, 1)
  assert.ok(report.summary.requiredHumanCriteriaPending > 0)
  assert.match(markdown, /veto limita a nota final a 3/)
})

test('marca avaliação via --scenario como parcial e mantém excluídos', async () => {
  const scenarioId = 'universal.core.incomplete-need.001'
  const { report } = await evaluatedFixture('universal-core', scenarioId)
  assert.equal(report.coverage.scope, 'selected_scenarios')
  assert.equal(report.coverage.datasetCoverage, 'partial')
  assert.equal(report.summary.objectiveScore?.partial, true)
  assert.equal(report.coverage.excludedScenarioIds.length, 1)
  assert.match(renderEvalReportMarkdown(report), /PARCIAL/)
})

test('representa cobertura incompleta e cenários ausentes sem inventar execução', async () => {
  const { loaded, execution } = await coreFixture
  const canonical = createEvalCanonicalData(await loadCatalogRepository())
  const retained = execution.scenarios.slice(0, 1)
  const incompleteExecution: OfflineEvalExecution = {
    ...execution,
    evaluation: undefined,
    scenarios: retained,
    summary: {
      scenarios: retained.length,
      completed: retained.length,
      technicalFailures: 0,
    },
  }
  const evaluation = evaluateOfflineEvalExecution(
    loaded,
    incompleteExecution,
    canonical,
  )
  const report = buildEvalReport(loaded, {
    ...incompleteExecution,
    behavioralEvaluation: evaluation.overallStatus,
    evaluation,
  })
  assert.equal(report.coverage.completeForScope, false)
  assert.equal(report.coverage.missingScenarioIds.length, 1)
  assert.equal(report.summary.scenarios.notExecuted, 1)
  assert.equal(report.scenarios[1]?.technicalStatus, 'not_executed')
})

test('omite nota quando falhas técnicas eliminam toda evidência pontuável', async () => {
  const { loaded, execution } = await coreFixture
  const failedScenarios = execution.scenarios.map((scenario) => ({
    ...scenario,
    technicalStatus: 'technical_failure' as const,
    turns: scenario.turns.map((turn) => ({
      ...turn,
      technicalStatus: 'technical_failure' as const,
      response: undefined,
      error: {
        code: 'OFFLINE_EXECUTION_FAILED',
        message: 'Falha simulada.',
      },
    })),
  }))
  const failedExecution: OfflineEvalExecution = {
    ...execution,
    evaluation: undefined,
    technicalStatus: 'technical_failure',
    scenarios: failedScenarios,
    summary: {
      scenarios: failedScenarios.length,
      completed: 0,
      technicalFailures: failedScenarios.length,
    },
  }
  const evaluation = evaluateOfflineEvalExecution(
    loaded,
    failedExecution,
    createEvalCanonicalData(await loadCatalogRepository()),
  )
  const report = buildEvalReport(loaded, {
    ...failedExecution,
    behavioralEvaluation: evaluation.overallStatus,
    evaluation,
  })
  assert.equal(report.summary.objectiveScore, undefined)
  assert.equal(report.summary.scenarios.technicalFailures, 2)
  assert.match(renderEvalReportMarkdown(report), /Nota objetiva final \| não calculada/)
})

test('minimiza e sanitiza segredos, dados pessoais, caminhos e Markdown dinâmico', async () => {
  const { loaded, execution } = await coreFixture
  assert(execution.evaluation)
  const firstScenario = execution.evaluation.scenarios[0]
  const firstAssertion = firstScenario?.assertionResults[0]
  assert(firstScenario && firstAssertion)
  const unsafeExecution: OfflineEvalExecution = {
    ...execution,
    evaluation: {
      ...execution.evaluation,
      scenarios: [
        {
          ...firstScenario,
          assertionResults: [
            {
              ...firstAssertion,
              reason:
                'sk-or-supersecret andre@example.com C:\\Users\\andre\\secret.txt ![x](https://evil.example) <img src=x>',
              evidenceReferences: [
                'C:\\Users\\andre\\evidence.json',
                '/home/andre/evidence.json',
              ],
            },
            ...firstScenario.assertionResults.slice(1),
          ],
        },
        ...execution.evaluation.scenarios.slice(1),
      ],
    },
  }
  const report = buildEvalReport(loaded, unsafeExecution)
  const json = serializeEvalReportJson(report)
  const markdown = renderEvalReportMarkdown(report)
  for (const output of [json, markdown]) {
    assert.doesNotMatch(output, /supersecret|andre@example\.com|C:\\Users|\/home\/andre/)
  }
  assert.doesNotMatch(markdown, /!\[x\]\(https:/)
  assert.doesNotMatch(markdown, /<img/)
  assert.match(json, /CREDENTIAL_REDACTED/)
  assert.match(markdown, /CREDENTIAL\\_REDACTED/)
  assert.deepEqual(
    report.scenarios[0]?.turns[0]?.assertions[0]?.evidenceReferences,
    ['evidence.redacted'],
  )
  assert.equal('sourcePath' in report.dataset, false)
})

test('ordena cenários, turnos e assertions de modo estável', async () => {
  const { loaded, execution, report } = await coreFixture
  assert.deepEqual(
    report.scenarios.map((scenario) => scenario.id),
    loaded.data.cases.map((scenario) => scenario.id),
  )
  assert.deepEqual(
    report.scenarios[0]?.turns.flatMap((turn) =>
      turn.assertions.map((assertion) => assertion.assertionId),
    ),
    loaded.data.cases[0]?.assertions.map((assertion) => assertion.id),
  )
  assert.equal(
    serializeEvalReportJson(buildEvalReport(loaded, execution)),
    serializeEvalReportJson(report),
  )
})

test('grava JSON e Markdown sem sobrescrever arquivos existentes', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'eval-report-writer-'))
  t.after(() => rm(directory, { recursive: true, force: true }))
  const { report } = await coreFixture
  const written = await writeEvalReportFiles(report, {
    directory,
    format: 'both',
  })
  assert(written.json && written.markdown)
  assert.deepEqual(
    evalReportSchema.parse(JSON.parse(await readFile(written.json, 'utf8'))),
    report,
  )
  assert.equal(await readFile(written.markdown, 'utf8'), renderEvalReportMarkdown(report))
  await assert.rejects(
    writeEvalReportFiles(report, { directory, format: 'both' }),
    (error: unknown) =>
      error instanceof EvalReportWriteError && /já existe/.test(error.message),
  )
})

test('trata destino inválido sem criar artefatos parciais', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'eval-report-invalid-'))
  t.after(() => rm(directory, { recursive: true, force: true }))
  const filePath = join(directory, 'not-a-directory')
  await writeFile(filePath, 'occupied', 'utf8')
  const { report } = await coreFixture
  await assert.rejects(
    writeEvalReportFiles(report, {
      directory: filePath,
      format: 'json',
    }),
    EvalReportWriteError,
  )
})

test('pré-valida colisões de ambos os formatos sem deixar arquivo parcial', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'eval-report-collision-'))
  t.after(() => rm(directory, { recursive: true, force: true }))
  const { report } = await coreFixture
  const names = evalReportFileNames(report)
  await writeEvalReportFiles(report, { directory, format: 'markdown' })
  await assert.rejects(
    writeEvalReportFiles(report, { directory, format: 'both' }),
    EvalReportWriteError,
  )
  await assert.rejects(readFile(join(directory, names.json), 'utf8'))
})

test('CLI antiga continua funcionando sem exportação', async () => {
  const { stdout } = await execFileAsync(
    process.execPath,
    [
      '--import',
      'tsx',
      'src/scripts/run-eval.ts',
      '--mode',
      'offline',
      '--dataset',
      'universal-core',
      '--evaluate',
    ],
    { cwd: backendRoot },
  )
  assert.match(stdout, /objective_score=10/)
  assert.doesNotMatch(stdout, /report_json=|report_markdown=/)
})

test('CLI exporta ambos os formatos uma única vez e exige --evaluate', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'eval-report-cli-'))
  t.after(() => rm(directory, { recursive: true, force: true }))
  const { stdout } = await execFileAsync(
    process.execPath,
    [
      '--import',
      'tsx',
      'src/scripts/run-eval.ts',
      '--mode',
      'offline',
      '--dataset',
      'universal-core',
      '--evaluate',
      '--report-format',
      'both',
      '--report-dir',
      directory,
    ],
    { cwd: backendRoot },
  )
  assert.match(stdout, /report_json=.*\.json/)
  assert.match(stdout, /report_markdown=.*\.md/)

  await assert.rejects(
    execFileAsync(
      process.execPath,
      [
        '--import',
        'tsx',
        'src/scripts/run-eval.ts',
        '--mode',
        'offline',
        '--dataset',
        'universal-core',
        '--report-format',
        'json',
        '--report-dir',
        join(directory, 'without-evaluate'),
      ],
      { cwd: backendRoot },
    ),
    (error: unknown) =>
      typeof error === 'object' &&
      error !== null &&
      'stderr' in error &&
      String(error.stderr).includes('exige a opção --evaluate'),
  )
})

test('geração completa permanece offline e não chama OpenRouter', async () => {
  const originalFetch = globalThis.fetch
  let networkCalls = 0
  globalThis.fetch = async () => {
    networkCalls += 1
    throw new Error('network disabled in eval report test')
  }
  try {
    const { report } = await evaluatedFixture(
      'universal-core',
      'universal.core.informational-no-pressure.001',
    )
    serializeEvalReportJson(report)
    renderEvalReportMarkdown(report)
    assert.equal(networkCalls, 0)
  } finally {
    globalThis.fetch = originalFetch
  }
})
