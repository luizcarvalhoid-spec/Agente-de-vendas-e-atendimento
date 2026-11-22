import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { after, before, test } from 'node:test'

import { createOpenRouterClient } from '../src/agent/openrouter/openrouter-client.js'
import { configuredCanaryAuthorities } from '../src/evals/external-canary-authorities.js'
import {
  canaryEndpointEvidenceSchema,
  compareCanaryEndpointEvidence,
} from '../src/evals/external-canary-compatibility.js'
import {
  describeCanaryEndpointIdentity,
  inspectCanaryGenerationIdentity,
  inspectCanaryRoutingSelector,
  rehearseCanaryEndpointIdentity,
} from '../src/evals/external-canary-endpoint-identity.js'
import { verifyCanaryOperations } from '../src/evals/external-canary-operations.js'
import { externalCanaryDraftSchema, externalCanaryManifestSchema } from '../src/evals/external-canary-schema.js'
import { CanaryAuthorizationUseStore } from '../src/evals/external-canary-use-store.js'
import {
  fingerprintExternalCanaryManifest,
  prepareExternalCanary,
  rehearseExternalCanary,
} from '../src/evals/external-canary.js'
import { createInMemoryOpenRouterTransport, runLiveExternalEval } from '../src/evals/external-eval-runner.js'

const backend = resolve(import.meta.dirname, '..')
const load = async (file: string): Promise<unknown> => JSON.parse(await readFile(
  resolve(backend, 'evals/canary', file), 'utf8',
))
const original = externalCanaryDraftSchema.parse(await load('gpt-4.1-mini-candidate.v1.json'))
const azure = externalCanaryDraftSchema.parse(await load('gpt-4.1-mini-azure-candidate.v1.json'))
const publicEvidence = canaryEndpointEvidenceSchema.parse(await load('gpt-4.1-mini-endpoint-evidence.v1.json'))
type Evidence = typeof publicEvidence
type Endpoint = Evidence['endpoints'][number]
const modelId = 'openai/gpt-4.1-mini'
const originalFetch = globalThis.fetch
let networkCalls = 0
before(() => {
  globalThis.fetch = async () => {
    networkCalls += 1
    throw new Error('Inferência externa proibida nos testes.')
  }
})
after(() => {
  globalThis.fetch = originalFetch
  assert.equal(networkCalls, 0)
})

function endpoint(overrides: Partial<Endpoint> = {}): Endpoint {
  return {
    modelId,
    providerName: 'Synthetic Azure',
    providerId: 'azure',
    routingSlug: 'azure/synthetic',
    catalogEndpointId: 'synthetic-endpoint',
    label: 'Synthetic endpoint',
    scope: 'global_chat',
    zdr: 'confirmed',
    listedInPublicZdr: true,
    retainsPrompts: false,
    training: false,
    safetyRetention: false,
    parameters: ['max_completion_tokens', 'tools', 'tool_choice'],
    autoToolChoice: true,
    maxCompletionTokens: 600,
    pricing: { currency: 'USD', inputUsdPerMillionTokens: 0.4, outputUsdPerMillionTokens: 1.6 },
    sources: [],
    ...overrides,
  }
}

function evidence(endpoints: Endpoint[], accountPolicy: Evidence['accountPolicy'] = 'unverified'): Evidence {
  return { version: 1, provenance: 'synthetic_fixture', accountPolicy, observations: [], endpoints }
}

test('observações públicas distinguem OpenAI, Azure global, Azure regional e batch', () => {
  const report = compareCanaryEndpointEvidence(original, azure, publicEvidence)
  assert.equal(report.provenance, 'public_catalog')
  assert.equal(report.modelId, modelId)
  assert.equal(report.original.endpoints[0]?.zdr, 'excluded')
  assert(report.original.blockers.includes('ZDR_INCOMPATIBLE'))
  assert(report.original.blockers.includes('MAX_TOKENS_ALIAS_UNVERIFIED'))
  const global = report.alternative.endpoints.find((row) => row.scope === 'global_chat')
  const regional = report.alternative.endpoints.find((row) => row.routingSlug === 'azure/swedencentral')
  assert.equal(global?.listedInPublicZdr, true)
  assert.equal(global.zdr, 'confirmed')
  assert.equal(global.safetyRetention, false)
  assert.deepEqual(global.missingParameters, [])
  assert.equal(global.estimate?.reservedUsdTotal, 0.022048)
  assert.equal(regional?.listedInPublicZdr, false)
  assert.equal(regional.zdr, 'confirmed')
  assert(regional.documentedBlockers.includes('ENDPOINT_OUTSIDE_GLOBAL_CHAT_SCOPE'))
  assert.equal(regional.estimate?.reservedUsdTotal, 0.0242528)
  assert.equal(report.alternative.worstObservedReserveUsd, 0.0242528)
  assert.equal(report.otherCatalogEntries[0]?.scope, 'batch')
  assert.equal(report.responseIdentity, 'not_observed')
  assert(report.alternative.blockers.includes('ACCOUNT_STRICT_ZDR_UNVERIFIED_OR_INCOMPATIBLE'))
  assert(report.alternative.blockers.includes('EXACT_ENDPOINT_SELECTION_UNVERIFIED'))
  assert(report.alternative.blockers.includes('CANDIDATE_PRICING_PENDING'))
})

test('evidência sintética distingue ZDR, Safety Retention, parâmetros e identificadores ausentes', () => {
  const variants = [
    endpoint(),
    endpoint({ zdr: 'unverified', listedInPublicZdr: false }),
    endpoint({ zdr: 'excluded', listedInPublicZdr: false, retainsPrompts: true }),
    endpoint({ safetyRetention: true }),
    endpoint({ routingSlug: undefined, catalogEndpointId: undefined }),
    endpoint({ parameters: ['max_tokens', 'tool_choice'], autoToolChoice: false }),
    endpoint({ retainsPrompts: undefined, training: undefined }),
  ]
  const report = compareCanaryEndpointEvidence(
    original, azure, evidence(variants, 'allows_safety_retention'),
  )
  const rows = report.alternative.endpoints
  assert.equal(rows.length, variants.length)
  assert.deepEqual(rows[0]?.documentedBlockers, [])
  assert(rows[1]?.documentedBlockers.includes('ZDR_UNVERIFIED'))
  assert(rows[2]?.documentedBlockers.includes('ZDR_INCOMPATIBLE'))
  assert(rows[3]?.documentedBlockers.includes('ENDPOINT_SAFETY_RETENTION_UNVERIFIED_OR_PRESENT'))
  assert(rows[4]?.documentedBlockers.includes('ENDPOINT_IDENTIFIER_UNVERIFIED'))
  assert.deepEqual(rows[5]?.missingParameters, ['max_completion_tokens', 'tools'])
  assert(rows[5]?.documentedBlockers.includes('MAX_TOKENS_ALIAS_UNVERIFIED'))
  assert(rows[5]?.documentedBlockers.includes('TOOL_CHOICE_AUTO_UNVERIFIED_OR_UNSUPPORTED'))
  assert(rows[6]?.documentedBlockers.includes('ENDPOINT_DATA_POLICY_UNVERIFIED_OR_INCOMPATIBLE'))
  assert(report.alternative.blockers.includes('ACCOUNT_STRICT_ZDR_UNVERIFIED_OR_INCOMPATIBLE'))
  assert(report.original.blockers.includes('PROVIDER_ID_UNVERIFIED'))
  assert(report.alternative.blockers.includes('LIVE_EXECUTION_DISABLED'))
  assert.equal(report.networkAllowed, false)

  const direct = compareCanaryEndpointEvidence(original, azure, evidence([
    endpoint({ providerName: 'Synthetic OpenAI', providerId: 'openai', routingSlug: 'openai', zdr: 'unverified' }),
  ]))
  assert(direct.original.blockers.includes('ZDR_UNVERIFIED'))
})

test('preços ausentes ou incompatíveis e orçamento insuficiente permanecem explícitos', () => {
  const observed = evidence([
    endpoint(), endpoint({ pricing: { currency: 'USD', inputUsdPerMillionTokens: 0.44, outputUsdPerMillionTokens: 1.76 } }),
    endpoint({ pricing: undefined }),
  ], 'strict_zdr_only')
  const draft = { ...azure, maxBudgetUsd: 0.001, pricing: { ...original.pricing, providerId: 'openai' } }
  const report = compareCanaryEndpointEvidence(original, draft, observed)
  assert.equal(report.alternative.worstObservedReserveUsd, undefined)
  assert(report.alternative.blockers.includes('CANDIDATE_PRICING_MISMATCH'))
  assert(report.alternative.blockers.includes('ENDPOINT_PRICING_UNVERIFIED'))
  assert(report.alternative.blockers.includes('ESTIMATED_COST_EXCEEDS_BUDGET'))
  assert(report.alternative.endpoints.some((row) => row.estimate?.withinProposedBudget === false))
})

test('evidência pública usa allowlist e relatórios omitem payloads privados', () => {
  const key = 'sk-or-fixture-sensitive'
  assert.throws(() => compareCanaryEndpointEvidence(original, azure, evidence([endpoint({ label: key })])))
  assert.throws(() => compareCanaryEndpointEvidence(original, azure, {
    ...publicEvidence, authorization: key,
  }))
  const json = JSON.stringify(compareCanaryEndpointEvidence(original, azure, publicEvidence))
  assert.doesNotMatch(json, /authorization|headers|messages|baseUrl|sk-or-fixture-sensitive/)
})

test('família, variante regional documentada e UUID têm escopos diferentes', async () => {
  const comparison = compareCanaryEndpointEvidence(original, azure, publicEvidence)
  const { endpoints } = comparison.alternative
  const family = inspectCanaryRoutingSelector('azure', 'azure', endpoints)
  assert.equal(family.kind, 'provider_family')
  assert.deepEqual(family.observedCatalogEntries.map((row) => row.routingSlug), ['azure', 'azure/swedencentral'])
  assert.equal(inspectCanaryRoutingSelector('azure', 'azure', [endpoints[0]!]).kind, 'provider_family')
  const regional = inspectCanaryRoutingSelector('azure/swedencentral', 'azure', endpoints)
  assert.equal(regional.kind, 'documented_variant_slug')
  assert.deepEqual(regional.observedCatalogEntries.map((row) => row.scope), ['regional_chat'])
  assert.equal(inspectCanaryRoutingSelector('azure/global', 'azure', endpoints).kind, 'unverified_selector')
  assert.deepEqual(inspectCanaryRoutingSelector(endpoints[0]!.catalogEndpointId!, 'azure', endpoints), {
    kind: 'catalog_id_only', observedCatalogEntries: [],
  })
  const report = describeCanaryEndpointIdentity(comparison)
  assert.equal(report.exactEndpointSelection, 'unverified')
  assert.equal(report.observedCatalogEndpointId, null)
  assert.equal(report.operationalPricing, 'pending')
  assert.equal(report.eligibleSetCompleteness, 'unverified')
  assert.equal(externalCanaryDraftSchema.safeParse({
    ...azure, routing: { ...azure.routing, providerId: 'azure/swedencentral' },
  }).success, false)

  const providerId = 'synthetic-provider/variant/region'
  const requests: unknown[] = []
  const client = createOpenRouterClient({
    apiKey: 'EVAL_SYNTHETIC_VARIANT', model: modelId,
    evaluationRouting: { ...azure.routing!, providerId, dataCollection: 'deny', zeroDataRetention: true },
    transport: createInMemoryOpenRouterTransport(async (_url, init) => {
      requests.push(JSON.parse(String(init?.body)).provider)
      return Response.json({
        id: 'gen-synthetic-variant', model: modelId, created: 0,
        choices: [{ index: 0, finish_reason: 'stop', message: { role: 'assistant', content: 'Synthetic' } }],
      })
    }),
  })
  const response = await client.createChatCompletion({ messages: [{ role: 'user', content: 'Synthetic' }] })
  assert.deepEqual(requests, [{
    order: [providerId], only: [providerId], allow_fallbacks: false,
    require_parameters: true, data_collection: 'deny', zdr: true,
  }])
  assert.equal(response.providerId, undefined)
})

test('geração simulada correlaciona id e modelo, e nome de exibição não comprova endpoint', () => {
  const generationId = 'gen-synthetic-fixture'
  const expected = { generationId, modelId, providerDisplayName: 'Azure' }
  const data = {
    id: generationId, model: modelId, provider_name: 'Azure',
    endpoint_id: publicEvidence.endpoints[1]!.catalogEndpointId,
    provider_responses: [{ privateField: 'sk-or-synthetic-sensitive' }],
    prompt: 'Synthetic private body',
  }
  const cases = [
    [data, 'PROVIDER_DISPLAY_NAME_ONLY'],
    [{ ...data, id: 'gen-synthetic-other' }, 'GENERATION_ID_MISMATCH'],
    [{ ...data, model: 'mock/other' }, 'MODEL_IDENTITY_MISMATCH'],
    [{ ...data, provider_name: 'azure' }, 'PROVIDER_DISPLAY_NAME_MISMATCH'],
    [{ ...data, provider_name: null }, 'PROVIDER_DISPLAY_NAME_MISSING'],
    [undefined, 'GENERATION_METADATA_INVALID'],
  ] as const
  for (const [payload, status] of cases) {
    assert.deepEqual(inspectCanaryGenerationIdentity({ data: payload }, expected), { status, endpointIdentity: 'unverified' })
  }
})

test('ensaio de identidade de endpoint exige UUID permitido e mantém verificações documentais', () => {
  const comparison = compareCanaryEndpointEvidence(original, azure, evidence([
    endpoint(),
    endpoint({ catalogEndpointId: 'synthetic-other', pricing: undefined }),
    endpoint({ catalogEndpointId: 'synthetic-non-zdr', zdr: 'excluded', safetyRetention: true, parameters: [] }),
  ], 'strict_zdr_only'))
  const [expected, withoutPricing, incompatible] = comparison.alternative.endpoints
  assert.deepEqual(rehearseCanaryEndpointIdentity(expected!, expected!.catalogEndpointId), {
    provenance: 'synthetic_fixture', issues: [],
  })
  assert.deepEqual(rehearseCanaryEndpointIdentity(expected!, undefined).issues, ['ENDPOINT_IDENTITY_UNVERIFIED'])
  assert.deepEqual(rehearseCanaryEndpointIdentity(expected!, withoutPricing!.catalogEndpointId).issues, ['ENDPOINT_IDENTITY_MISMATCH'])
  assert(rehearseCanaryEndpointIdentity(withoutPricing!, withoutPricing!.catalogEndpointId).issues.includes('ENDPOINT_PRICING_UNVERIFIED'))
  assert.deepEqual(rehearseCanaryEndpointIdentity(incompatible!, incompatible!.catalogEndpointId).issues, [
    'ZDR_INCOMPATIBLE', 'ENDPOINT_SAFETY_RETENTION_UNVERIFIED_OR_PRESENT', 'REQUIRED_PARAMETERS_NOT_ADVERTISED',
  ])
})

test('variante preserva o escopo, exige revisão e troca de provedor ou preço invalida o fingerprint', async () => {
  assert.equal(original.routing?.providerId, 'openai')
  assert.deepEqual(azure.scenarioIds, ['universal.core.incomplete-need.001'])
  assert.deepEqual(azure.dataset, original.dataset)
  for (const field of [
    'limits', 'maxBudgetUsd', 'unreportedUsageMultiplier', 'transcriptPersistence',
    'generation', 'stopCriteria', 'technicalVersions',
  ] as const) assert.deepEqual(azure[field], original[field])
  assert.deepEqual(azure.routing, {
    providerId: 'azure', allowFallbacks: false, requireParameters: true,
    dataCollection: 'deny', zeroDataRetention: true,
  })
  assert.equal(azure.sourceRevision, undefined)
  assert.equal(azure.pricing, undefined)
  const prep = await prepareExternalCanary(azure)
  assert.equal(prep.status, 'configuration_incomplete')
  assert.equal(prep.manifestFingerprint, undefined)
  assert.equal(prep.budget, undefined)
  assert(prep.stages.includes('data_policy_review_pending'))
  const control = await verifyCanaryOperations({ manifest: azure }, {
    authorities: configuredCanaryAuthorities,
    useStore: new CanaryAuthorizationUseStore(resolve(backend, 'external-eval-reports/canary-control')),
  })
  assert(control.blockers.includes('APPROVAL_AUTHORITY_UNCONFIGURED'))
  assert(control.blockers.includes('LIVE_EXECUTION_DISABLED'))
  assert.equal(control.networkAllowed, false)
  await assert.rejects(runLiveExternalEval(), { code: 'LIVE_EXTERNAL_DISABLED' })

  const complete = externalCanaryManifestSchema.parse({ ...original, sourceRevision: '0'.repeat(40) })
  const fingerprint = fingerprintExternalCanaryManifest(complete)
  assert.notEqual(fingerprintExternalCanaryManifest({
    ...complete, routing: azure.routing, pricing: { ...complete.pricing, providerId: 'azure' },
  }), fingerprint)
  assert.notEqual(fingerprintExternalCanaryManifest({
    ...complete, pricing: { ...complete.pricing, outputUsdPerMillionTokens: 1.76 },
  }), fingerprint)
})

test('ensaio em memória valida serialização e preserva comparação exata de identidade', async (t) => {
  const syntheticManifest = externalCanaryManifestSchema.parse({
    ...azure, experimentId: 'synthetic-azure-transport', purpose: 'synthetic_rehearsal',
    sourceRevision: '0'.repeat(40),
    pricing: {
      modelId, providerId: 'azure', currency: 'USD',
      inputUsdPerMillionTokens: 0.4, outputUsdPerMillionTokens: 1.6,
      confirmedAt: '2025-12-31T00:00:00Z', source: 'https://prices.example.invalid/synthetic',
    },
  })
  const selected = { provider: 'azure', model: modelId, selected: true }
  const cases: Array<{
    title: string
    model: string
    provider: string | undefined
    available?: Array<typeof selected>
    attempt?: number
    rejectedBeforeObservation?: boolean
    succeeds: boolean
  }> = [
    { title: 'modelo e provedor literais', model: modelId, provider: 'azure', succeeds: true },
    { title: 'modelo divergente', model: 'openai/another-fixture', provider: 'azure', succeeds: false },
    { title: 'provedor divergente', model: modelId, provider: 'openai', succeeds: false },
    { title: 'nome de exibição não é slug comprovado', model: modelId, provider: 'Azure', succeeds: false },
    { title: 'provedor ausente', model: modelId, provider: undefined, succeeds: false },
    { title: 'provedor não é normalizado', model: modelId, provider: ' azure ', succeeds: false },
    { title: 'seleção isolada não preenche provider', model: modelId, provider: undefined, available: [selected], succeeds: false },
    { title: 'provider e metadata coerentes no ensaio', model: modelId, provider: 'azure', available: [selected], succeeds: true },
    { title: 'provedores conflitantes', model: modelId, provider: 'azure', available: [{ ...selected, provider: 'openai' }], rejectedBeforeObservation: true, succeeds: false },
    { title: 'modelos conflitantes', model: modelId, provider: 'azure', available: [{ ...selected, model: 'openai/another-fixture' }], rejectedBeforeObservation: true, succeeds: false },
    { title: 'dois endpoints selecionados mesmo com provedor igual', model: modelId, provider: 'azure', available: [selected, selected], rejectedBeforeObservation: true, succeeds: false },
    { title: 'lista sem seleção', model: modelId, provider: 'azure', available: [{ ...selected, selected: false }], rejectedBeforeObservation: true, succeeds: false },
    { title: 'tentativa adicional contradiz fallback desabilitado', model: modelId, provider: 'azure', available: [selected], attempt: 2, rejectedBeforeObservation: true, succeeds: false },
  ]
  for (const example of cases) {
    await t.test(example.title, async () => {
      const requests: Array<Record<string, unknown>> = []
      const transport = createInMemoryOpenRouterTransport(async (_url, init) => {
        requests.push(JSON.parse(String(init?.body)))
        return Response.json({
          id: 'synthetic-azure-generation', model: example.model, provider: example.provider, created: 0,
          choices: [{ index: 0, finish_reason: 'stop', message: {
            role: 'assistant', content: 'O que você gostaria de resolver com o produto?',
          } }],
          usage: { prompt_tokens: 300, completion_tokens: 15, total_tokens: 315 },
          ...(example.available === undefined ? {} : {
            openrouter_metadata: { attempt: example.attempt, endpoints: { available: example.available } },
          }),
        })
      })
      const { rehearsal } = await rehearseExternalCanary(syntheticManifest, { transport })
      assert.equal(requests.length, 1)
      assert.equal(requests[0]?.model, modelId)
      assert.equal(requests[0]?.stream, false)
      assert.equal(requests[0]?.tool_choice, 'auto')
      assert(Array.isArray(requests[0]?.tools))
      assert.equal(requests[0]?.max_completion_tokens, 512)
      assert.equal(Object.hasOwn(requests[0]!, 'max_tokens'), false)
      assert.equal(Object.hasOwn(requests[0]!, 'models'), false)
      assert.deepEqual(requests[0]?.provider, {
        order: ['azure'], only: ['azure'], allow_fallbacks: false,
        require_parameters: true, data_collection: 'deny', zdr: true,
      })
      assert.equal(rehearsal?.provenance, 'simulated_external_transport')
      assert.equal(rehearsal.technicalStatus, example.succeeds ? 'completed' : 'technical_failure')
      if (!example.succeeds) assert(rehearsal.technicalErrorCodes.includes('AI_BAD_RESPONSE'))
      assert.deepEqual(rehearsal.returnedModelIds, example.rejectedBeforeObservation ? [] : [example.model])
      const observedProvider = example.provider === undefined || example.rejectedBeforeObservation ? [] :
        [example.provider === example.provider.trim() ? example.provider : '[IDENTIFIER_REDACTED]']
      assert.deepEqual(rehearsal.observedProviderIds, observedProvider)
    })
  }
})
