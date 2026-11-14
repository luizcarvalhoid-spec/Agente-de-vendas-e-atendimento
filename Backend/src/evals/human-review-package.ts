import { createHash } from 'node:crypto'
import { lstat, mkdir, readFile, unlink, writeFile } from 'node:fs/promises'
import { basename, resolve } from 'node:path'

import type { LoadedEvalDataset } from './eval-loader.js'
import { sanitizeEvalReportText } from './eval-report-builder.js'
import type { HumanEvalRubric } from './human-eval-rubric-schema.js'
import {
  HUMAN_REVIEW_PACKAGE_VERSION,
  HUMAN_REVIEW_TEMPLATE_VERSION,
  humanConversationSampleSchema,
  humanReviewPackageSchema,
  humanReviewTemplateSchema,
  type HumanConversationSample,
  type HumanReviewPackage,
  type HumanReviewTemplate,
} from './human-review-schema.js'

export class HumanReviewPackageError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options)
    this.name = 'HumanReviewPackageError'
  }
}

function assertSanitizedSample(sample: HumanConversationSample) {
  for (const [index, turn] of sample.turns.entries()) {
    for (const [role, value] of [
      ['user', turn.user],
      ['assistant', turn.assistant],
    ] as const) {
      if (sanitizeEvalReportText(value) !== value) {
        throw new HumanReviewPackageError(
          `O turno ${index} (${role}) contém dado sensível ou caminho local; sanitize o arquivo antes da importação.`,
        )
      }
    }
  }
}

export function parseHumanConversationSample(value: unknown) {
  const result = humanConversationSampleSchema.safeParse(value)
  if (!result.success) {
    throw new HumanReviewPackageError(
      'A amostra não atende ao contrato de transcrição sanitizada.',
      { cause: result.error },
    )
  }
  assertSanitizedSample(result.data)
  return result.data
}

export async function loadHumanConversationSample(path: string) {
  let raw: string
  try {
    raw = await readFile(resolve(path), 'utf8')
  } catch (error) {
    throw new HumanReviewPackageError(
      'Não foi possível ler a amostra local.',
      { cause: error },
    )
  }
  let value: unknown
  try {
    value = JSON.parse(raw) as unknown
  } catch (error) {
    throw new HumanReviewPackageError(
      'A amostra local não contém JSON válido.',
      { cause: error },
    )
  }
  return parseHumanConversationSample(value)
}

function originWarning(origin: HumanConversationSample['sample']['origin']) {
  switch (origin.kind) {
    case 'manual_real_test':
      return 'A origem é uma transcrição de teste declarada como autorizada e sanitizada; a procedência depende dessa declaração humana.'
    case 'manually_simulated':
      return 'A conversa foi escrita manualmente e não representa desempenho real de um modelo.'
    case 'deterministic_offline':
      return 'A saída determinística offline serve para calibrar o fluxo e não mede naturalidade de um modelo externo.'
    case 'unverified':
      return 'A origem não foi comprovada e não pode ser apresentada como evidência de desempenho real.'
  }
}

function evaluationId(
  sampleId: string,
  criterionId: string,
  dimensionId: string,
) {
  return `human-${createHash('sha256')
    .update(`${sampleId}:${criterionId}:${dimensionId}`)
    .digest('hex')
    .slice(0, 20)}`
}

export function buildHumanReviewPackage(
  loaded: LoadedEvalDataset,
  rubric: HumanEvalRubric,
  sampleInput: HumanConversationSample,
): HumanReviewPackage {
  const sample = parseHumanConversationSample(sampleInput)
  if (
    sample.sample.datasetId !== loaded.data.dataset.id ||
    sample.sample.datasetVersion !== loaded.data.dataset.version
  ) {
    throw new HumanReviewPackageError(
      'A amostra não corresponde ao ID e à versão do dataset.',
    )
  }
  if (
    sample.sample.rubricId !== rubric.rubric.id ||
    sample.sample.rubricVersion !== rubric.rubric.version
  ) {
    throw new HumanReviewPackageError(
      'A amostra referencia uma versão de rubrica incompatível.',
    )
  }
  const scenario = loaded.data.cases.find(
    (item) => item.id === sample.sample.scenarioId,
  )
  if (scenario === undefined) {
    throw new HumanReviewPackageError(
      'O cenário da amostra não existe no dataset informado.',
    )
  }
  if (
    sample.turns.length !== scenario.input.turns.length ||
    sample.turns.some(
      (turn, index) => turn.user !== scenario.input.turns[index]?.message,
    )
  ) {
    throw new HumanReviewPackageError(
      'Os turnos da amostra não correspondem às entradas do cenário.',
    )
  }

  const humanCriteria = scenario.quality_criteria.filter(
    (criterion) =>
      criterion.kind === 'subjective' &&
      criterion.applicability !== 'not_applicable' &&
      criterion.evaluation === 'human',
  )
  if (humanCriteria.length === 0) {
    throw new HumanReviewPackageError(
      'O cenário não possui critérios subjetivos configurados para avaliação humana.',
    )
  }
  const reviewItems = humanCriteria.flatMap((criterion) => {
    const dimensions = rubric.dimensions.filter((dimension) =>
      dimension.criteria.includes(criterion.criterion),
    )
    if (dimensions.length === 0) {
      throw new HumanReviewPackageError(
        `A rubrica não cobre o critério ${criterion.criterion}.`,
      )
    }
    return dimensions.map((dimension) => ({
      evaluationId: evaluationId(
        sample.sample.id,
        criterion.id,
        dimension.id,
      ),
      criterionId: criterion.id,
      criterion: criterion.criterion,
      applicability: criterion.applicability,
      dimensionId: dimension.id,
      scope: { turns: sample.turns.map((turn) => turn.index) },
      status: 'not_evaluated' as const,
    }))
  })
  const applicableDimensionIds = new Set(
    reviewItems.map((item) => item.dimensionId),
  )

  return humanReviewPackageSchema.parse({
    packageVersion: HUMAN_REVIEW_PACKAGE_VERSION,
    packageStatus: 'prepared_not_evaluated',
    sample: {
      id: sample.sample.id,
      datasetId: sample.sample.datasetId,
      datasetVersion: sample.sample.datasetVersion,
      scenarioId: sample.sample.scenarioId,
      origin: { ...sample.sample.origin },
    },
    rubric: {
      id: rubric.rubric.id,
      version: rubric.rubric.version,
    },
    rubricDimensions: rubric.dimensions
      .filter((dimension) => applicableDimensionIds.has(dimension.id))
      .map((dimension) => structuredClone(dimension)),
    turns: sample.turns.map((turn) => ({ ...turn })),
    reviewItems,
    instructions: {
      scoreMinimum: 1,
      scoreMaximum: 10,
      completedRequiresJustification: true,
      completedRequiresEvidence: true,
      unobservableStatus: 'not_evaluated',
      nonApplicableStatus: 'not_applicable',
      safetyAlertsRequireRationale: true,
    },
    warnings: [
      originWarning(sample.sample.origin),
      'Este pacote está preparado, mas não contém avaliação humana realizada.',
      'Critérios configurados exclusivamente como llm_judge não são incluídos neste fluxo.',
      'Alertas humanos de segurança exigem revisão prioritária e não alteram falhas críticas objetivas.',
    ],
  })
}

export function buildHumanReviewTemplate(
  reviewPackageInput: HumanReviewPackage,
): HumanReviewTemplate {
  const reviewPackage = humanReviewPackageSchema.parse(reviewPackageInput)
  return humanReviewTemplateSchema.parse({
    templateVersion: HUMAN_REVIEW_TEMPLATE_VERSION,
    templateStatus: 'template_not_submitted',
    instructions:
      'Substitua os campos nulos e vazios; depois valide como humanReviewSubmission.',
    submission: {
      id: null,
      purpose: 'human_review',
      sampleId: reviewPackage.sample.id,
      datasetId: reviewPackage.sample.datasetId,
      datasetVersion: reviewPackage.sample.datasetVersion,
      scenarioId: reviewPackage.sample.scenarioId,
      rubricId: reviewPackage.rubric.id,
      rubricVersion: reviewPackage.rubric.version,
      reviewerId: null,
    },
    judgements: reviewPackage.reviewItems.map((item) => ({
      evaluationId: item.evaluationId,
      criterionId: item.criterionId,
      criterion: item.criterion,
      dimensionId: item.dimensionId,
      scope: { turns: [...item.scope.turns] },
      status: null,
      score: null,
      justification: '',
      evidenceReferences: [],
      safetyAlert: { flagged: false },
    })),
  })
}

function serialize(value: unknown) {
  return `${JSON.stringify(value, null, 2)}\n`
}

async function exists(path: string) {
  try {
    await lstat(path)
    return true
  } catch (error) {
    if (
      typeof error === 'object' &&
      error !== null &&
      'code' in error &&
      error.code === 'ENOENT'
    ) {
      return false
    }
    throw error
  }
}

export async function writeHumanReviewArtifacts(
  reviewPackageInput: HumanReviewPackage,
  directoryInput: string,
) {
  if (directoryInput.trim().length === 0) {
    throw new HumanReviewPackageError(
      'Informe explicitamente o diretório dos artefatos humanos.',
    )
  }
  const reviewPackage = humanReviewPackageSchema.parse(reviewPackageInput)
  const template = buildHumanReviewTemplate(reviewPackage)
  const directory = resolve(directoryInput)
  try {
    await mkdir(directory, { recursive: true })
    if (!(await lstat(directory)).isDirectory()) {
      throw new Error('not_directory')
    }
  } catch (error) {
    throw new HumanReviewPackageError(
      'Não foi possível preparar o diretório dos artefatos humanos.',
      { cause: error },
    )
  }
  const stem = reviewPackage.sample.id
  if (!/^[a-z0-9]+(?:[._-][a-z0-9]+)*$/.test(stem)) {
    throw new HumanReviewPackageError('O ID da amostra não gera nome seguro.')
  }
  const targets = [
    {
      kind: 'package' as const,
      path: resolve(directory, `${stem}.review-package.v1.json`),
      content: serialize(reviewPackage),
    },
    {
      kind: 'template' as const,
      path: resolve(directory, `${stem}.review-template.v1.json`),
      content: serialize(template),
    },
  ]
  for (const target of targets) {
    if (await exists(target.path)) {
      throw new HumanReviewPackageError(
        `O arquivo ${basename(target.path)} já existe; nada foi sobrescrito.`,
      )
    }
  }
  const created: string[] = []
  try {
    for (const target of targets) {
      await writeFile(target.path, target.content, {
        encoding: 'utf8',
        flag: 'wx',
      })
      created.push(target.path)
    }
  } catch (error) {
    await Promise.all(
      created.map(async (path) => {
        try {
          await unlink(path)
        } catch {
          // Rollback restrito aos arquivos criados nesta chamada.
        }
      }),
    )
    throw new HumanReviewPackageError(
      'Não foi possível gravar os artefatos humanos.',
      { cause: error },
    )
  }
  return Object.fromEntries(targets.map((target) => [target.kind, target.path]))
}
