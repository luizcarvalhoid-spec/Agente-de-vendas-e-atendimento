import type {
  FaqCategory,
  FaqDocument,
} from './faq-document-schema.js'

const DEFAULT_RESULT_LIMIT = 3
const MAX_RESULT_LIMIT = 5
const MAX_QUERY_LENGTH = 300

const TITLE_MATCH_WEIGHT = 3
const CONTENT_MATCH_WEIGHT = 1
const TITLE_BIGRAM_WEIGHT = 1.5
const CONTENT_BIGRAM_WEIGHT = 0.5

// Calibrated against the canonical positive cases and both unknown-query sets.
// Coverage is deliberately strict: unsupported concepts must keep a partial
// lexical overlap from becoming a source.
const MIN_WEIGHTED_COVERAGE = 0.62
const MIN_SCORE = 0.4

const stopWords = new Set([
  'a',
  'ao',
  'aos',
  'as',
  'com',
  'como',
  'da',
  'das',
  'de',
  'do',
  'dos',
  'e',
  'ela',
  'ele',
  'em',
  'entre',
  'existe',
  'existem',
  'essa',
  'esse',
  'esta',
  'este',
  'eu',
  'ha',
  'isso',
  'informar',
  'me',
  'meu',
  'minha',
  'na',
  'nas',
  'no',
  'nos',
  'o',
  'oferece',
  'oferecem',
  'os',
  'ou',
  'para',
  'pela',
  'pelas',
  'pelo',
  'pelos',
  'pode',
  'podem',
  'posso',
  'por',
  'qual',
  'quais',
  'quando',
  'quanto',
  'que',
  'quero',
  'receber',
  'recebi',
  'recebido',
  'se',
  'sem',
  'ser',
  'seu',
  'sua',
  'tem',
  'têm',
  'ter',
  'um',
  'uma',
  'voces',
  'voce',
])

const editorialNoise = new Set([
  'aplicacao',
  'cenario',
  'demonstracao',
  'demonstrativa',
  'demonstrativo',
  'ficticia',
  'ficticio',
  'hidrasplash',
  'ilustrativa',
  'ilustrativo',
  'portifolio',
  'simulada',
  'simulado',
])

const aliases: Readonly<Record<string, string>> = {
  alergias: 'alergia',
  alergica: 'alergia',
  alergico: 'alergia',
  avariada: 'danificado',
  avariado: 'danificado',
  cancelamento: 'cancelar',
  cancelamentos: 'cancelar',
  cartoes: 'cartao',
  cem: '100',
  cobranca: 'pagamento',
  cobrancas: 'pagamento',
  comprovantes: 'comprovante',
  custa: 'valor',
  custo: 'valor',
  custos: 'valor',
  cupons: 'cupom',
  danificada: 'danificado',
  danificados: 'danificado',
  devolucoes: 'devolucao',
  devolver: 'devolucao',
  desistir: 'devolucao',
  desistencia: 'devolucao',
  diagnosticar: 'diagnostico',
  entregam: 'entrega',
  entregar: 'entrega',
  entregas: 'entrega',
  envios: 'frete',
  envio: 'frete',
  estornar: 'estorno',
  estornos: 'estorno',
  gratuita: 'gratis',
  gratuitas: 'gratis',
  gratuito: 'gratis',
  gratuitos: 'gratis',
  incorreta: 'incorreto',
  incorretos: 'incorreto',
  informacoes: 'informacao',
  janela: 'prazo',
  janelas: 'prazo',
  pagamentos: 'pagamento',
  pagar: 'pagamento',
  pago: 'pagamento',
  pedidos: 'pedido',
  pessoais: 'pessoal',
  precos: 'preco',
  prazos: 'prazo',
  quebrada: 'danificado',
  quebrado: 'danificado',
  rastrear: 'rastreamento',
  rastreio: 'rastreamento',
  reembolsar: 'estorno',
  reembolso: 'estorno',
  segura: 'seguranca',
  seguro: 'seguranca',
  sensibilidades: 'sensibilidade',
  trocas: 'troca',
  trocar: 'troca',
  valores: 'valor',
}

interface IndexedFaqDocument {
  document: FaqDocument
  titleConcepts: ReadonlySet<string>
  contentConcepts: ReadonlySet<string>
  titleBigrams: ReadonlySet<string>
  contentBigrams: ReadonlySet<string>
}

interface ScoredFaqDocument {
  document: FaqDocument
  score: number
  titleEvidenceCount: number
}

export interface FaqSearchResult {
  sourceId: string
  title: string
  category: FaqCategory
  classification: 'fictional-demo'
  content: string
  /** Relative lexical ranking value; it is not a probability or confidence. */
  score: number
}

export interface FaqSearchIndex {
  readonly size: number
  searchFaq(query: string, limit?: number): readonly FaqSearchResult[]
}

function normalizeText(value: string) {
  return value
    .normalize('NFKD')
    .replace(/\p{Diacritic}/gu, '')
    .toLocaleLowerCase('pt-BR')
}

function normalizeNumber(token: string) {
  if (!/^\d+(?:[.,]\d+)?$/.test(token)) return token

  const [integer, decimal] = token.replace(',', '.').split('.')
  if (decimal === undefined || /^0+$/.test(decimal)) return integer

  return `${integer}.${decimal.replace(/0+$/, '')}`
}

function toConcept(token: string) {
  const normalizedNumber = normalizeNumber(token)
  return aliases[normalizedNumber] ?? normalizedNumber
}

function tokenize(value: string) {
  const tokens =
    normalizeText(value).match(/[\p{L}\p{N}]+(?:[.,]\p{N}+)?/gu) ?? []

  return tokens
    .map(toConcept)
    .filter(
      (token) =>
        (token.length > 1 || /^\d+$/.test(token)) &&
        !stopWords.has(token) &&
        !editorialNoise.has(token),
    )
}

function createBigrams(concepts: readonly string[]) {
  const bigrams = new Set<string>()

  for (let index = 0; index < concepts.length - 1; index += 1) {
    bigrams.add(`${concepts[index]}\u0000${concepts[index + 1]}`)
  }

  return bigrams
}

function inverseDocumentFrequency(documentCount: number, frequency: number) {
  return Math.log(
    1 + (documentCount - frequency + 0.5) / (frequency + 0.5),
  )
}

function roundScore(value: number) {
  return Math.round(value * 1_000_000) / 1_000_000
}

function resolveLimit(limit: number | undefined) {
  if (limit === undefined) return DEFAULT_RESULT_LIMIT
  if (!Number.isInteger(limit) || limit <= 0) {
    throw new RangeError('O limite da busca FAQ deve ser um inteiro positivo.')
  }

  return Math.min(limit, MAX_RESULT_LIMIT)
}

function indexDocument(document: FaqDocument): IndexedFaqDocument {
  const titleSequence = tokenize(document.title)
  const contentSequence = tokenize(document.content)

  return {
    document,
    titleConcepts: new Set(titleSequence),
    contentConcepts: new Set(contentSequence),
    titleBigrams: createBigrams(titleSequence),
    contentBigrams: createBigrams(contentSequence),
  }
}

function createResult(document: FaqDocument, score: number): FaqSearchResult {
  return {
    sourceId: document.sourceId,
    title: document.title,
    category: document.category,
    classification: document.classification,
    content: document.content,
    score,
  }
}

export function createFaqSearchIndex(
  documents: readonly FaqDocument[],
): FaqSearchIndex {
  const indexedDocuments = [...documents]
    .sort((first, second) =>
      first.sourceId.localeCompare(second.sourceId, 'en-US'),
    )
    .map(indexDocument)
  const documentFrequencies = new Map<string, number>()

  for (const document of indexedDocuments) {
    const concepts = new Set([
      ...document.titleConcepts,
      ...document.contentConcepts,
    ])
    for (const concept of concepts) {
      documentFrequencies.set(
        concept,
        (documentFrequencies.get(concept) ?? 0) + 1,
      )
    }
  }

  return {
    size: indexedDocuments.length,
    searchFaq(query, limit) {
      const resultLimit = resolveLimit(limit)
      if (query.trim() === '' || query.length > MAX_QUERY_LENGTH) return []

      const querySequence = tokenize(query)
      const queryConcepts = [...new Set(querySequence)]
      if (queryConcepts.length === 0 || indexedDocuments.length === 0) return []

      const queryWeights = new Map(
        queryConcepts.map((concept) => [
          concept,
          inverseDocumentFrequency(
            indexedDocuments.length,
            documentFrequencies.get(concept) ?? 0,
          ),
        ]),
      )
      const totalQueryWeight = [...queryWeights.values()].reduce(
        (total, weight) => total + weight,
        0,
      )
      const queryBigrams = createBigrams(querySequence)
      const scoredDocuments: ScoredFaqDocument[] = []

      for (const document of indexedDocuments) {
        let rawScore = 0
        let matchedWeight = 0
        let matchedConceptCount = 0
        let titleEvidenceCount = 0
        let onlyMatchedConcept: string | undefined

        for (const concept of queryConcepts) {
          const weight = queryWeights.get(concept) ?? 0
          const titleMatch = document.titleConcepts.has(concept)
          const contentMatch = document.contentConcepts.has(concept)

          if (!titleMatch && !contentMatch) continue

          matchedWeight += weight
          matchedConceptCount += 1
          onlyMatchedConcept = concept

          if (titleMatch) {
            rawScore += TITLE_MATCH_WEIGHT * weight
            titleEvidenceCount += 1
          }
          if (contentMatch) rawScore += CONTENT_MATCH_WEIGHT * weight
        }

        for (const bigram of queryBigrams) {
          const [first, second] = bigram.split('\u0000')
          const averageWeight =
            ((queryWeights.get(first) ?? 0) +
              (queryWeights.get(second) ?? 0)) /
            2

          if (document.titleBigrams.has(bigram)) {
            rawScore += TITLE_BIGRAM_WEIGHT * averageWeight
          } else if (document.contentBigrams.has(bigram)) {
            rawScore += CONTENT_BIGRAM_WEIGHT * averageWeight
          }
        }

        const coverage =
          totalQueryWeight === 0 ? 0 : matchedWeight / totalQueryWeight
        if (coverage < MIN_WEIGHTED_COVERAGE) continue

        const singleConceptEvidence =
          queryConcepts.length === 1 &&
          matchedConceptCount === 1 &&
          onlyMatchedConcept !== undefined &&
          (documentFrequencies.get(onlyMatchedConcept) ?? 0) <= 1
        const sufficientEvidence =
          matchedConceptCount >= 2 || singleConceptEvidence
        if (!sufficientEvidence) continue

        const score = roundScore(rawScore * coverage)
        if (score < MIN_SCORE) continue

        scoredDocuments.push({
          document: document.document,
          score,
          titleEvidenceCount,
        })
      }

      return scoredDocuments
        .sort(
          (first, second) =>
            second.score - first.score ||
            second.titleEvidenceCount - first.titleEvidenceCount ||
            first.document.sourceId.localeCompare(
              second.document.sourceId,
              'en-US',
            ),
        )
        .slice(0, resultLimit)
        .map(({ document, score }) => createResult(document, score))
    },
  }
}
