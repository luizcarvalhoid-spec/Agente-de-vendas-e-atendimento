import { z } from 'zod'

import { evalCanonicalCriterionSchema } from './eval-dataset-schema.js'

export const HUMAN_EVAL_RUBRIC_SCHEMA_VERSION = 1 as const

const identifierSchema = z
  .string()
  .trim()
  .min(1)
  .max(128)
  .regex(/^[a-z0-9]+(?:[._-][a-z0-9]+)*$/)

const anchorSchema = z
  .object({
    range: z.string().regex(/^\d+-\d+$/),
    description: z.string().trim().min(1).max(1_500),
    distinguishingBehaviors: z.array(z.string().trim().min(1).max(500)).min(1).max(10),
  })
  .strict()

export const humanEvalRubricDimensionSchema = z
  .object({
    id: identifierSchema,
    title: z.string().trim().min(1).max(200),
    criteria: z.array(evalCanonicalCriterionSchema).min(1).max(3),
    instructions: z.string().trim().min(1).max(2_000),
    observableBehaviors: z.array(z.string().trim().min(1).max(500)).min(1).max(20),
    genericExamples: z
      .object({
        adequate: z.array(z.string().trim().min(1).max(500)).min(1).max(10),
        concerning: z.array(z.string().trim().min(1).max(500)).min(1).max(10),
      })
      .strict(),
    limitations: z.array(z.string().trim().min(1).max(700)).min(1).max(10),
    anchors: z
      .object({
        inadequate: anchorSchema,
        partial: anchorSchema,
        adequate: anchorSchema,
        excellent: anchorSchema,
      })
      .strict(),
  })
  .strict()

export const humanEvalRubricSchema = z
  .object({
    schemaVersion: z.literal(HUMAN_EVAL_RUBRIC_SCHEMA_VERSION),
    rubric: z
      .object({
        id: identifierSchema,
        version: z.string().regex(/^\d+\.\d+\.\d+$/),
        locale: z.string().trim().min(2).max(35),
        scope: z.literal('universal'),
      })
      .strict(),
    scoringInstructions: z
      .object({
        completedRequiresEvidence: z.literal(true),
        unobservableStatus: z.literal('not_evaluated'),
        nonApplicableStatus: z.literal('not_applicable'),
        noAutomaticScores: z.literal(true),
        guidance: z.array(z.string().trim().min(1).max(700)).min(1).max(20),
      })
      .strict(),
    dimensions: z.array(humanEvalRubricDimensionSchema).min(6).max(20),
  })
  .strict()
  .superRefine((rubric, context) => {
    const dimensionIds = new Set<string>()
    const coveredCriteria = new Set<string>()
    for (const [index, dimension] of rubric.dimensions.entries()) {
      if (dimensionIds.has(dimension.id)) {
        context.addIssue({
          code: 'custom',
          path: ['dimensions', index, 'id'],
          message: 'ID de dimensão duplicado.',
        })
      }
      dimensionIds.add(dimension.id)
      dimension.criteria.forEach((criterion) => coveredCriteria.add(criterion))
      if (
        dimension.anchors.inadequate.range !== '1-3' ||
        dimension.anchors.partial.range !== '4-6' ||
        dimension.anchors.adequate.range !== '7-8' ||
        dimension.anchors.excellent.range !== '9-10'
      ) {
        context.addIssue({
          code: 'custom',
          path: ['dimensions', index, 'anchors'],
          message: 'As faixas devem ser 1-3, 4-6, 7-8 e 9-10.',
        })
      }
    }
    for (const criterion of evalCanonicalCriterionSchema.options) {
      if (!coveredCriteria.has(criterion)) {
        context.addIssue({
          code: 'custom',
          path: ['dimensions'],
          message: `O critério canônico ${criterion} não está coberto.`,
        })
      }
    }
  })

export type HumanEvalRubric = z.infer<typeof humanEvalRubricSchema>
export type HumanEvalRubricDimension = HumanEvalRubric['dimensions'][number]
