import { z } from 'zod'

import { sanitizeEvalReportText } from './eval-report-builder.js'
import type { compareCanaryEndpointEvidence } from './external-canary-compatibility.js'

type Comparison = ReturnType<typeof compareCanaryEndpointEvidence>
type Endpoint = Comparison['alternative']['endpoints'][number]

export function inspectCanaryRoutingSelector(selector: string, providerFamilyId: string, endpoints: readonly Endpoint[]) {
  // A documentação descreve matching por prefixo, com exceções para tiers.
  // O catálogo observado não é prova de que o conjunto elegível está completo.
  const family = endpoints.filter((endpoint) => endpoint.providerId === providerFamilyId)
  if (selector !== providerFamilyId && family.some((endpoint) => endpoint.catalogEndpointId === selector)) {
    return { kind: 'catalog_id_only', observedCatalogEntries: [] } as const
  }
  if (selector === providerFamilyId) {
    return { kind: 'provider_family', observedCatalogEntries: family } as const
  }
  const matches = family.filter((endpoint) => endpoint.routingSlug === selector && selector.startsWith(`${providerFamilyId}/`))
  return matches.length > 0
    ? { kind: 'documented_variant_slug', observedCatalogEntries: matches } as const
    : { kind: 'unverified_selector', observedCatalogEntries: [] } as const
}

const generationIdentity = z.object({
  data: z.object({
    id: z.string().regex(/^gen-[0-9A-Za-z-]+$/).max(128),
    model: z.string().min(1).max(200),
    provider_name: z.string().min(1).max(200).nullable().optional(),
  }),
})

// Somente os campos documentados são lidos. O resultado não exporta metadados
// brutos e o nome de exibição jamais satisfaz uma exigência de identidade exata.
export function inspectCanaryGenerationIdentity(raw: unknown, expected: {
  generationId: string
  modelId: string
  providerDisplayName: string
}) {
  const parsed = generationIdentity.safeParse(raw)
  if (!parsed.success) return { status: 'GENERATION_METADATA_INVALID', endpointIdentity: 'unverified' } as const
  const { id, model, provider_name: providerName } = parsed.data.data
  const status = id !== expected.generationId ? 'GENERATION_ID_MISMATCH' :
    model !== expected.modelId ? 'MODEL_IDENTITY_MISMATCH' :
    !providerName ? 'PROVIDER_DISPLAY_NAME_MISSING' :
    providerName !== expected.providerDisplayName ? 'PROVIDER_DISPLAY_NAME_MISMATCH' :
    'PROVIDER_DISPLAY_NAME_ONLY'
  return { status, endpointIdentity: 'unverified' } as const
}

// Ensaio de uma evidência hipotética já vinculada à chamada. Nenhum campo do
// Chat Completions ou de GET /generation é promovido a essa evidência.
export function rehearseCanaryEndpointIdentity(expected: Endpoint, observedCatalogEndpointId: string | undefined) {
  const issues = [...expected.documentedBlockers]
  if (!expected.catalogEndpointId || !observedCatalogEndpointId) issues.push('ENDPOINT_IDENTITY_UNVERIFIED')
  else if (observedCatalogEndpointId !== expected.catalogEndpointId) issues.push('ENDPOINT_IDENTITY_MISMATCH')
  return { provenance: 'synthetic_fixture', issues } as const
}

export function describeCanaryEndpointIdentity(comparison: Comparison) {
  const { alternative, modelId } = comparison
  const providerFamilyId = alternative.routing?.providerId
  const endpoints = alternative.endpoints.map(({ label, routingSlug, catalogEndpointId, scope, documentedBlockers }) => ({
    label, routingSlug, catalogEndpointId, scope, documentedBlockers,
    selectorKind: providerFamilyId && routingSlug
      ? inspectCanaryRoutingSelector(routingSlug, providerFamilyId, alternative.endpoints).kind
      : 'unverified_selector',
  }))
  return {
    version: 1,
    documentedOn: '2026-11-20',
    providerFamilyId,
    expectedModelId: modelId,
    expectedProviderIdentity: providerFamilyId,
    endpoints,
    exactEndpointSelection: 'unverified',
    catalogIdsUsableForRouting: 'not_documented',
    observedModelId: null,
    observedProviderIdentity: null,
    observedCatalogEndpointId: null,
    operationalPricing: 'pending',
    eligibleSetCompleteness: 'unverified',
    metadata: {
      chat: 'O campo provider, quando presente, é comparado literalmente. Nenhuma identidade é derivada da configuração enviada.',
      routing: 'X-OpenRouter-Metadata é opt-in. A lista documenta nome de provedor, modelo e selected, sem UUID de catálogo.',
      generation: 'GET /api/v1/generation requer autenticação e documenta id, model e provider_name, sem UUID de catálogo.',
    },
    requirements: [
      'Documentar um seletor exclusivo para o Azure global e sua relação com o UUID publicado.',
      'Demonstrar um campo de identidade estável, vinculado à mesma geração e ao UUID permitido, distinto do nome de exibição.',
      'Confirmar ZDR only na conta ou guardrail, sem Safety Retention, e os parâmetros obrigatórios na rota exata.',
      'Confirmar a tarifa da rota permitida e vincular seletor, identidade, política e tarifa ao fingerprint de um contrato revisado.',
    ],
    references: {
      router_metadata: 'https://openrouter.ai/docs/guides/routing/routers/router-metadata',
      generation_metadata: 'https://openrouter.ai/docs/api/api-reference/generations/get-generation',
    },
  } as const
}
