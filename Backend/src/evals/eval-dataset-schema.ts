import { z } from 'zod'

import {
  CHAT_MAX_CART_ITEMS,
  CHAT_MAX_HISTORY_MESSAGES,
  CHAT_MAX_MESSAGE_CHARACTERS,
  CHAT_MAX_RECOMMENDED_PRODUCT_REFERENCES,
  CHAT_MAX_SOURCES,
  chatCartItemSchema,
  chatHistoryMessageSchema,
  chatPreferencesSchema,
  chatRecommendationContextSchema,
  chatRequestSchema,
} from '../contracts/chat.js'

export const EVAL_DATASET_SCHEMA_VERSION = 1 as const

const identifierSchema = z
  .string()
  .trim()
  .min(1)
  .max(128)
  .regex(
    /^[a-z0-9]+(?:[._-][a-z0-9]+)*$/,
    'Use apenas letras minúsculas, números, pontos, sublinhados e hífens.',
  )

const semanticVersionSchema = z
  .string()
  .regex(
    /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/,
    'A versão deve seguir o formato SemVer.',
  )

const uniqueArray = <T extends z.ZodType>(schema: T, maximum: number) =>
  z
    .array(schema)
    .min(1)
    .max(maximum)
    .refine((values) => new Set(values).size === values.length, {
      message: 'Os valores não podem se repetir.',
    })

const productIdSchema = z.number().int().positive()
const sourceIdSchema = z
  .string()
  .regex(/^faq-\d{3}$/, 'O sourceId deve seguir o formato faq-NNN.')
const assertionTextSchema = z.string().trim().min(1).max(500)

const cartSchema = z
  .array(chatCartItemSchema)
  .max(CHAT_MAX_CART_ITEMS)
  .refine(
    (items) => new Set(items.map((item) => item.productId)).size === items.length,
    { message: 'Cada produto deve aparecer uma única vez no carrinho.' },
  )

export const evalDatasetMetadataSchema = z.discriminatedUnion('scope', [
  z
    .object({
      id: identifierSchema,
      version: semanticVersionSchema,
      scope: z.literal('universal'),
      locale: z.string().trim().min(2).max(35),
    })
    .strict(),
  z
    .object({
      id: identifierSchema,
      version: semanticVersionSchema,
      scope: z.literal('store'),
      locale: z.string().trim().min(2).max(35),
      storeProfile: identifierSchema,
    })
    .strict(),
])

const preserveOperationSchema = z.object({ mode: z.literal('preserve') }).strict()
const clearOperationSchema = z.object({ mode: z.literal('clear') }).strict()

export const evalPreferencesOperationSchema = z.discriminatedUnion('mode', [
  preserveOperationSchema,
  clearOperationSchema,
  z
    .object({
      mode: z.literal('replace'),
      value: chatPreferencesSchema,
    })
    .strict(),
])

export const evalCartOperationSchema = z.discriminatedUnion('mode', [
  preserveOperationSchema,
  clearOperationSchema,
  z
    .object({
      mode: z.literal('replace'),
      value: cartSchema,
    })
    .strict(),
])

export const evalRecommendationContextOperationSchema = z.discriminatedUnion(
  'mode',
  [
    z.object({ mode: z.literal('auto') }).strict(),
    clearOperationSchema,
    z
      .object({
        mode: z.literal('replace'),
        value: chatRecommendationContextSchema,
      })
      .strict(),
  ],
)

const initialStateSchema = z
  .object({
    history: z.array(chatHistoryMessageSchema).max(CHAT_MAX_HISTORY_MESSAGES),
    cart: cartSchema,
    preferences: chatPreferencesSchema.optional(),
    recommendationContext: chatRecommendationContextSchema.optional(),
  })
  .strict()

const evalTurnSchema = z
  .object({
    message: chatRequestSchema.shape.message,
    preferences: evalPreferencesOperationSchema,
    cart: evalCartOperationSchema,
    recommendationContext: evalRecommendationContextOperationSchema,
  })
  .strict()

const assertionBase = {
  id: identifierSchema,
  criterionId: identifierSchema,
  turn: z.number().int().nonnegative(),
  severity: z.enum(['low', 'medium', 'high', 'critical']),
} as const

const responseTypeAssertionSchema = z
  .object({
    ...assertionBase,
    type: z.literal('response_type_allowed'),
    responseTypes: uniqueArray(
      z.enum(['text', 'recommendation', 'comparison']),
      3,
    ),
    textReasons: uniqueArray(
      z.enum(['clarification', 'not_found', 'unable_to_verify']),
      3,
    ).optional(),
  })
  .strict()

const productIdsAssertionSchemas = [
  z
    .object({
      ...assertionBase,
      type: z.literal('product_ids_exact'),
      productIds: z
        .array(productIdSchema)
        .max(CHAT_MAX_RECOMMENDED_PRODUCT_REFERENCES)
        .refine((values) => new Set(values).size === values.length, {
          message: 'Os IDs de produtos não podem se repetir.',
        }),
    })
    .strict(),
  z
    .object({
      ...assertionBase,
      type: z.literal('product_ids_include'),
      productIds: uniqueArray(productIdSchema, 50),
    })
    .strict(),
  z
    .object({
      ...assertionBase,
      type: z.literal('product_ids_exclude'),
      productIds: uniqueArray(productIdSchema, 50),
    })
    .strict(),
  z
    .object({
      ...assertionBase,
      type: z.literal('product_ids_allowed'),
      productIds: uniqueArray(productIdSchema, 100),
    })
    .strict(),
] as const

const sourceIdsAssertionSchemas = [
  z
    .object({
      ...assertionBase,
      type: z.literal('source_ids_exact'),
      sourceIds: z
        .array(sourceIdSchema)
        .max(CHAT_MAX_SOURCES)
        .refine((values) => new Set(values).size === values.length, {
          message: 'Os IDs de fontes não podem se repetir.',
        }),
    })
    .strict(),
  z
    .object({
      ...assertionBase,
      type: z.literal('source_ids_include'),
      sourceIds: uniqueArray(sourceIdSchema, CHAT_MAX_SOURCES),
    })
    .strict(),
  z
    .object({
      ...assertionBase,
      type: z.literal('source_ids_exclude'),
      sourceIds: uniqueArray(sourceIdSchema, 50),
    })
    .strict(),
  z
    .object({
      ...assertionBase,
      type: z.literal('source_ids_allowed'),
      sourceIds: uniqueArray(sourceIdSchema, 100),
    })
    .strict(),
] as const

export const evalAssertionSchema = z.discriminatedUnion('type', [
  responseTypeAssertionSchema,
  ...productIdsAssertionSchemas,
  ...sourceIdsAssertionSchemas,
  z
    .object({
      ...assertionBase,
      type: z.literal('canonical_product_cards'),
    })
    .strict(),
  z
    .object({
      ...assertionBase,
      type: z.literal('text_includes'),
      values: uniqueArray(assertionTextSchema, 20),
      match: z.enum(['exact', 'normalized']),
    })
    .strict(),
  z
    .object({
      ...assertionBase,
      type: z.literal('text_excludes'),
      values: uniqueArray(assertionTextSchema, 20),
      match: z.enum(['exact', 'normalized']),
    })
    .strict(),
  z
    .object({
      ...assertionBase,
      type: z.literal('max_questions'),
      maximum: z.number().int().min(0).max(10),
    })
    .strict(),
  z
    .object({
      ...assertionBase,
      type: z.literal('message_length_between'),
      minimum: z.number().int().nonnegative(),
      maximum: z
        .number()
        .int()
        .positive()
        .max(CHAT_MAX_MESSAGE_CHARACTERS),
    })
    .strict(),
  z
    .object({
      ...assertionBase,
      type: z.literal('grounding_domains'),
      domains: uniqueArray(z.enum(['product', 'faq']), 2),
      match: z.enum(['include', 'exact']),
    })
    .strict(),
  z
    .object({
      ...assertionBase,
      type: z.literal('tool_called'),
      toolName: z.enum([
        'search_products',
        'get_product_details',
        'search_faq',
      ]),
    })
    .strict(),
  z
    .object({
      ...assertionBase,
      type: z.literal('tool_not_called'),
      toolName: z.enum([
        'search_products',
        'get_product_details',
        'search_faq',
      ]),
    })
    .strict(),
  z
    .object({
      ...assertionBase,
      type: z.literal('max_model_calls'),
      maximum: z.number().int().min(0).max(100),
    })
    .strict(),
  z
    .object({
      ...assertionBase,
      type: z.literal('no_unsupported_claims'),
    })
    .strict(),
  z
    .object({
      ...assertionBase,
      type: z.literal('products_satisfy_ingredient_restrictions'),
      terms: chatPreferencesSchema.shape.avoidIngredients.unwrap(),
    })
    .strict(),
])

const qualityCriterionBase = {
  id: identifierSchema,
  criterion: z.enum([
    'factual_accuracy',
    'safety',
    'context_continuity',
    'naturalness',
    'clarity_utility',
    'consultative_quality',
  ]),
} as const

const applicableObjectiveCriterionSchema = z
  .object({
    ...qualityCriterionBase,
    kind: z.literal('objective'),
    applicability: z.enum(['required', 'optional']),
    evaluation: z.literal('deterministic'),
    status: z.literal('not_evaluated'),
    weight: z.number().finite().positive().max(100),
    assertionIds: uniqueArray(identifierSchema, 100),
  })
  .strict()

const applicableSubjectiveCriterionSchema = z
  .object({
    ...qualityCriterionBase,
    kind: z.literal('subjective'),
    applicability: z.enum(['required', 'optional']),
    evaluation: z.enum(['human', 'llm_judge']),
    status: z.literal('not_evaluated'),
    weight: z.number().finite().positive().max(100),
  })
  .strict()

const notApplicableCriterionSchema = z
  .object({
    ...qualityCriterionBase,
    kind: z.enum(['objective', 'subjective']),
    applicability: z.literal('not_applicable'),
    status: z.literal('not_applicable'),
    reason: z.string().trim().min(1).max(500),
  })
  .strict()

export const evalQualityCriterionSchema = z.union([
  applicableObjectiveCriterionSchema,
  applicableSubjectiveCriterionSchema,
  notApplicableCriterionSchema,
])

const expectedBehaviorSchema = z
  .object({
    action: z.enum([
      'ask_clarification',
      'recommend',
      'compare',
      'answer',
      'safe_fallback',
      'refuse',
      'clinical_boundary',
      'resist_injection',
      'alternative_or_safe_fallback',
    ]),
    description: z.string().trim().min(1).max(1_000),
    requiredGrounding: z
      .array(z.enum(['product', 'faq']))
      .max(2)
      .refine((values) => new Set(values).size === values.length, {
        message: 'Os domínios de grounding não podem se repetir.',
      }),
  })
  .strict()

const evalCaseSchema = z
  .object({
    id: identifierSchema,
    category: identifierSchema,
    difficulty: z.enum(['easy', 'medium', 'hard', 'adversarial']),
    severity: z.enum(['low', 'medium', 'high', 'critical']),
    tags: uniqueArray(identifierSchema, 20),
    input: z
      .object({
        initialState: initialStateSchema,
        turns: z.array(evalTurnSchema).min(1).max(50),
      })
      .strict(),
    expected_behavior: expectedBehaviorSchema,
    assertions: z.array(evalAssertionSchema).min(1).max(200),
    quality_criteria: z.array(evalQualityCriterionSchema).min(1).max(50),
  })
  .strict()
  .superRefine((scenario, context) => {
    const assertionIds = new Map<string, number>()
    const assertionSignatures = new Map<string, number>()
    for (const [index, assertion] of scenario.assertions.entries()) {
      const previousIdIndex = assertionIds.get(assertion.id)
      if (previousIdIndex !== undefined) {
        context.addIssue({
          code: 'custom',
          path: ['assertions', index, 'id'],
          message: `ID de assertion duplicado; já usado em assertions[${previousIdIndex}].`,
        })
      } else {
        assertionIds.set(assertion.id, index)
      }

      const { id: _id, ...logicalAssertion } = assertion
      const signature = JSON.stringify(logicalAssertion)
      const previousSignatureIndex = assertionSignatures.get(signature)
      if (previousSignatureIndex !== undefined) {
        context.addIssue({
          code: 'custom',
          path: ['assertions', index],
          message: `Assertion duplicada logicamente; equivale a assertions[${previousSignatureIndex}].`,
        })
      } else {
        assertionSignatures.set(signature, index)
      }

      if (assertion.turn >= scenario.input.turns.length) {
        context.addIssue({
          code: 'custom',
          path: ['assertions', index, 'turn'],
          message: `O turno ${assertion.turn} não existe neste cenário.`,
        })
      }

      if (
        assertion.type === 'response_type_allowed' &&
        assertion.textReasons !== undefined &&
        !assertion.responseTypes.includes('text')
      ) {
        context.addIssue({
          code: 'custom',
          path: ['assertions', index, 'textReasons'],
          message: 'textReasons exige que responseTypes inclua text.',
        })
      }

      if (
        assertion.type === 'message_length_between' &&
        assertion.minimum > assertion.maximum
      ) {
        context.addIssue({
          code: 'custom',
          path: ['assertions', index, 'minimum'],
          message: 'minimum não pode ser maior que maximum.',
        })
      }
    }

    const criteriaById = new Map<string, (typeof scenario.quality_criteria)[number]>()
    for (const [index, criterion] of scenario.quality_criteria.entries()) {
      if (criteriaById.has(criterion.id)) {
        context.addIssue({
          code: 'custom',
          path: ['quality_criteria', index, 'id'],
          message: 'ID de critério duplicado.',
        })
      } else {
        criteriaById.set(criterion.id, criterion)
      }

      if (criterion.kind === 'objective' && criterion.status === 'not_evaluated') {
        for (const [assertionIndex, assertionId] of criterion.assertionIds.entries()) {
          const referencedAssertionIndex = assertionIds.get(assertionId)
          if (referencedAssertionIndex === undefined) {
            context.addIssue({
              code: 'custom',
              path: ['quality_criteria', index, 'assertionIds', assertionIndex],
              message: `A assertion ${assertionId} não existe neste cenário.`,
            })
          } else if (
            scenario.assertions[referencedAssertionIndex]?.criterionId !==
            criterion.id
          ) {
            context.addIssue({
              code: 'custom',
              path: ['quality_criteria', index, 'assertionIds', assertionIndex],
              message: `A assertion ${assertionId} referencia outro critério.`,
            })
          }
        }
      }
    }

    for (const [index, assertion] of scenario.assertions.entries()) {
      const criterion = criteriaById.get(assertion.criterionId)
      if (criterion === undefined) {
        context.addIssue({
          code: 'custom',
          path: ['assertions', index, 'criterionId'],
          message: `O critério ${assertion.criterionId} não existe neste cenário.`,
        })
        continue
      }
      if (
        criterion.kind !== 'objective' ||
        criterion.status !== 'not_evaluated' ||
        !criterion.assertionIds.includes(assertion.id)
      ) {
        context.addIssue({
          code: 'custom',
          path: ['assertions', index, 'criterionId'],
          message: `A assertion deve ser referenciada pelo critério objetivo ${assertion.criterionId}.`,
        })
      }
    }

    let history = [...scenario.input.initialState.history]
    let cart = scenario.input.initialState.cart
    let preferences = scenario.input.initialState.preferences
    let recommendationContext = scenario.input.initialState.recommendationContext

    for (const [turnIndex, turn] of scenario.input.turns.entries()) {
      if (turn.preferences.mode === 'replace') preferences = turn.preferences.value
      if (turn.preferences.mode === 'clear') preferences = undefined
      if (turn.cart.mode === 'replace') cart = turn.cart.value
      if (turn.cart.mode === 'clear') cart = []
      if (turn.recommendationContext.mode === 'replace') {
        recommendationContext = turn.recommendationContext.value
      }
      if (turn.recommendationContext.mode === 'clear') {
        recommendationContext = undefined
      }

      const requestResult = chatRequestSchema.safeParse({
        message: turn.message,
        history,
        cart,
        ...(preferences === undefined ? {} : { preferences }),
        ...(recommendationContext === undefined ? {} : { recommendationContext }),
      })
      if (!requestResult.success) {
        for (const issue of requestResult.error.issues) {
          const statePath = issue.path[0]
          const path =
            statePath === 'message'
              ? ['input', 'turns', turnIndex, ...issue.path]
              : statePath === 'history' && turnIndex > 0
                ? ['input', 'turns', turnIndex]
                : ['input', 'initialState', ...issue.path]
          context.addIssue({
            code: 'custom',
            path,
            message:
              statePath === 'history' && turnIndex > 0
                ? `Histórico projetado inválido no turno ${turnIndex}: ${issue.message}`
                : `Estado inválido no turno ${turnIndex}: ${issue.message}`,
          })
        }
      }

      if (turnIndex < scenario.input.turns.length - 1) {
        history = [
          ...history,
          { role: 'user' as const, content: turn.message },
          {
            role: 'assistant' as const,
            content: `[resposta de avaliação do turno ${turnIndex}]`,
          },
        ]
        // A resposta real, indisponível na validação estrutural, determinará
        // o contexto quando o próximo turno usar auto.
        recommendationContext = undefined
      }
    }
  })

export const evalDatasetSchema = z
  .object({
    schemaVersion: z.literal(EVAL_DATASET_SCHEMA_VERSION),
    dataset: evalDatasetMetadataSchema,
    cases: z.array(evalCaseSchema).min(1).max(1_000),
  })
  .strict()
  .superRefine((dataset, context) => {
    const caseIds = new Map<string, number>()
    for (const [index, scenario] of dataset.cases.entries()) {
      const previousIndex = caseIds.get(scenario.id)
      if (previousIndex !== undefined) {
        context.addIssue({
          code: 'custom',
          path: ['cases', index, 'id'],
          message: `ID de cenário duplicado; já usado em cases[${previousIndex}].`,
        })
      } else {
        caseIds.set(scenario.id, index)
      }
    }
  })

export type EvalDataset = z.infer<typeof evalDatasetSchema>
export type EvalCase = EvalDataset['cases'][number]
export type EvalAssertion = z.infer<typeof evalAssertionSchema>
export type EvalQualityCriterion = z.infer<typeof evalQualityCriterionSchema>
