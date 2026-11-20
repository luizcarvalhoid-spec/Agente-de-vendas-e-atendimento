import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { after, before, test } from 'node:test'

import { configuredCanaryAuthorities } from '../src/evals/external-canary-authorities.js'
import {
  canaryEndpointEvidenceSchema,
  compareCanaryEndpointEvidence,
} from '../src/evals/external-canary-compatibility.js'
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
  for (const example of [
    { title: 'modelo e provedor literais', model: modelId, provider: 'azure', succeeds: true },
    { title: 'modelo divergente', model: 'openai/another-fixture', provider: 'azure', succeeds: false },
    { title: 'provedor divergente', model: modelId, provider: 'openai', succeeds: false },
    { title: 'nome de exibição não é slug comprovado', model: modelId, provider: 'Azure', succeeds: false },
    { title: 'provedor ausente', model: modelId, provider: undefined, succeeds: false },
  ]) {
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
      assert.deepEqual(rehearsal.returnedModelIds, [example.model])
      assert.deepEqual(rehearsal.observedProviderIds, example.provider === undefined ? [] : [example.provider])
    })
  }
})
