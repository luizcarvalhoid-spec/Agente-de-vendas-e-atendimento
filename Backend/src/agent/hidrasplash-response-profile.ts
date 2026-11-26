import type { Product } from '../catalog/product-schema.js'
import { DEMO_SHIPPING_RULES } from '../commercial/demo-commercial-rules.js'
import type { FaqDocument } from '../knowledge/faq-document-schema.js'
import type { CommercialPresentationContext, StoreResponseProfile } from './chat-response-composer.js'
import { hidrasplashConsultativeProfile } from './hidrasplash-consultative-profile.js'

function normalize(value: string) {
  return value
    .normalize('NFKD')
    .replace(/\p{Diacritic}/gu, '')
    .toLocaleLowerCase('pt-BR')
    .replace(/\s+/g, ' ')
    .trim()
}

const scalpLabels = {
  oleoso: 'couro cabeludo com tendência à oleosidade',
  seco: 'couro cabeludo com tendência ao ressecamento',
  normal: 'couro cabeludo de perfil normal',
  sensivel: 'couro cabeludo de perfil sensível',
  todos: 'diferentes perfis de couro cabeludo',
} as const

const concernLabels = {
  caspa: 'o objetivo anticaspa',
  descamacao: 'o cuidado com descamação',
  oleosidade: 'o controle de oleosidade',
  ressecamento: 'o cuidado com ressecamento',
  sensibilidade: 'o cuidado com sensibilidade',
  'queda-e-quebra': 'o cuidado com queda e quebra',
  frizz: 'o cuidado com frizz',
  danos: 'o cuidado com danos',
  'falta-de-brilho': 'a busca por brilho',
  'definicao-de-cachos': 'a busca por definição de cachos',
  'acumulo-de-residuos': 'o cuidado com acúmulo de resíduos',
} as const

function canonicalProductText(product: Product) {
  return normalize(
    [
      product.name,
      product.variant.name,
      product.variant.profile,
      ...(product.variant.sensoryNotes ?? []),
      ...product.tags,
    ].join(' '),
  )
}

const sensoryEvidence = [
  {
    requested: /\b(?:frescor|refrescante)\b/,
    canonical: /\bfresc/,
    label: 'a preferência por frescor',
  },
  {
    requested: /\bcitrico\b/,
    canonical: /\bcitric/,
    label: 'a preferência por um perfil cítrico',
  },
  {
    requested: /\bherbal\b/,
    canonical: /\bherbal\b/,
    label: 'a preferência por um perfil herbal',
  },
  {
    requested: /\bsuave\b/,
    canonical: /\bsuav/,
    label: 'a preferência por uma experiência suave',
  },
  {
    requested: /\bintenso\b/,
    canonical: /\bintens/,
    label: 'a preferência por uma experiência intensa',
  },
  {
    requested: /\bhortela\b/,
    canonical: /\bhortela\b/,
    label: 'a preferência por hortelã',
  },
  {
    requested: /\blimao\b/,
    canonical: /\blimao\b/,
    label: 'a preferência por limão',
  },
] as const

function recommendationReasons(
  product: Product,
  context: CommercialPresentationContext,
) {
  const reasons: string[] = []
  const input = context.searchInput
  let concernReason: string | undefined

  if (product.applicationArea === 'hair') {
    const matchedScalp = input.scalpTypes?.find(
      (type) =>
        product.scalpTypes.includes(type) || product.scalpTypes.includes('todos'),
    )
    if (matchedScalp) {
      reasons.push(
        `tem posicionamento comercial para ${scalpLabels[matchedScalp]}`,
      )
    }

    const matchedConcern = input.hairConcerns?.find((concern) =>
      product.concerns.includes(concern),
    )
    if (matchedConcern) {
      concernReason = `está alinhado com ${concernLabels[matchedConcern]}`
    }
  }

  const requestedSensory = normalize(context.sensoryTerms.join(' '))
  const productText = canonicalProductText(product)
  const sensory = sensoryEvidence.find(
    (evidence) =>
      evidence.requested.test(requestedSensory) &&
      evidence.canonical.test(productText),
  )
  if (sensory) reasons.push(`combina com ${sensory.label}`)

  return { primary: reasons, secondary: concernReason ? [concernReason] : [] }
}

function clinicalBoundary(
  question: string,
  previousUserMessages: readonly string[],
): string | undefined {
  const normalized = normalize(question)
  const adverseReaction =
    /\b(?:reac(?:ao|oes)|dores?|doendo|ardor|ardendo|inch(?:aco|acos|ado|ada|ados|adas)|feridas?|sangramento|sangrando|secrec(?:ao|oes)|sintomas? intensos?|piorando|piora)\b/.test(
      normalized,
    )
  const productContext = normalize(
    [...previousUserMessages, question].join(' '),
  )
  const unsupportedGuarantee =
    /\b(?:shampoo|cosmetico|produto|pele|couro|cabelo|caspa|alergia|dermatolog)/.test(
      productContext,
    ) &&
    /\b(?:garant(?:e|ia|ido|ida)|curar|cura|segur(?:o|a|os|as)|seguranca dermatologica|hipoalergen(?:ico|ica)|sem alergia|nao causa alergia|eficacia terapeutica)\b/.test(
      normalized,
    )

  if (adverseReaction) {
    return 'Não posso diagnosticar essa reação nem indicar outro cosmético como solução. Diante de dor, inchaço, ardor, feridas, sangramento, secreção ou sintomas intensos, persistentes ou em piora, procure um profissional de saúde externo.'
  }
  if (unsupportedGuarantee) {
    return 'Não posso garantir cura, eficácia terapêutica, segurança dermatológica ou ausência de alergias. Os produtos e ingredientes desta demonstração têm posicionamento cosmético e formulação sintética de teste, sem avaliação clínica.'
  }
  return undefined
}

const cosmeticProfiles = new Map(Object.entries({
  aconchegante: 'aconchegante',
  'brilho-e-maciez': 'de brilho e maciez',
  'cachos-definidos': 'de definição de cachos',
  'cachos-hidratados': 'de hidratação para cachos',
  'citrico-hidratante': 'cítrico e hidratante',
  'citrico-refrescante': 'cítrico e refrescante',
  'dupla-capilar': 'de cuidado capilar em dupla',
  'equilibrio-herbal': 'herbal equilibrado',
  'floral-suave': 'floral suave',
  fortalecimento: 'de fortalecimento',
  'frescor-citrico': 'de frescor cítrico',
  'frutado-vibrante': 'frutado vibrante',
  'herbal-equilibrante': 'herbal equilibrante',
  'hidratacao-conforto': 'de hidratação e conforto',
  'hidratacao-equilibrada': 'de hidratação equilibrada',
  'hidratacao-fresca': 'de hidratação com frescor',
  'hidratacao-leve': 'de hidratação leve',
  'limpeza-intensa': 'de limpeza intensa',
  'limpeza-profunda': 'de limpeza profunda',
  'limpeza-suave': 'de limpeza suave',
  'nutricao-envolvente': 'de nutrição envolvente',
  'nutricao-intensa': 'de nutrição intensa',
  'oleosidade-frescor': 'refrescante para couro com tendência à oleosidade',
  'reconstrucao-intensa': 'de reconstrução intensa',
  'relaxamento-floral': 'floral relaxante',
  'revigorante-amadeirado': 'amadeirado revigorante',
  revitalizacao: 'de revitalização',
}))

function describeProduct(product: Product) {
  const label = cosmeticProfiles.get(product.variant.profile ?? '')
  return label ? `perfil comercial ${label}` : undefined
}

function describeIngredients(product: Product) {
  const ingredients = product.ingredients?.map((ingredient) => ingredient.name)
  const description = ingredients && ingredients.length > 0
    ? `Os ingredientes demonstrativos registrados são: ${ingredients.join(', ')}.`
    : 'Não há uma formulação individual publicada para este item demonstrativo.'
  return `${description} A formulação é sintética e não comprova segurança clínica, ausência de alergias ou adequação dermatológica.`
}

function presentFaq(document: FaqDocument) {
  if (document.sourceId === 'faq-001' && document.category === 'frete') {
    return 'Como esta é uma simulação, nenhuma mercadoria é separada, despachada ou entregue de verdade.'
  }
  return document.content
    .replace(/^No cenário demonstrativo da HidraSplash,\s*/i, 'Aqui no HidraSplash, ')
    .replace(/^(?:Na demonstração|No fluxo fictício|Para fins de demonstração),\s*/i, 'Na simulação, ')
    .replace(
      /^O cenário demonstrativo apresenta um prazo total de\s*/i,
      'Na simulação, o prazo apresentado é de ',
    )
}

export const hidrasplashResponseProfile = {
  ...hidrasplashConsultativeProfile,
  shipping: {
    rules: DEMO_SHIPPING_RULES,
    freeShippingFaq: {
      sourceId: 'faq-002',
      contentTemplate: 'Na demonstração, o frete grátis é ilustrado somente quando o subtotal, calculado com os preços atuais dos produtos e antes do frete, for {freeComparison} {threshold}. Um subtotal de {threshold} exatos {atThreshold} frete grátis, e a regra não gera uma entrega real.',
    },
    standardShippingFaq: {
      sourceId: 'faq-003',
      contentTemplate: 'No fluxo fictício, subtotais {standardComparison} {threshold} exibem um frete padrão de {fee}. O valor serve exclusivamente para testar cálculos e mensagens da aplicação; não constitui cotação logística nem cobrança real.',
    },
  },
  // Digest of the reviewed body as returned by loadFaqDocuments. Review editorial
  // changes before allowing the new body to appear in deterministic answers.
  reviewedFaqs: {
    'faq-001': '77ec0b586766a4fcf871a5cc0e376caa637731b8e9209d318b2b92e136067732',
    'faq-004': '9c233e72b8cdb466f5603e2ad397a8c4fd6bd1f6ae3e4c4706ee04957d8aacab',
    'faq-005': '27095d776b13698606dd36d88580e6d4a234772f9bb8d61348128699a1dcce72',
    'faq-006': '1ada78c46e045e6a64589cab73a7e53e391eff81619c2582c68b9fc80e850487',
    'faq-007': '0f5248a27d9bddd96ae32c23f5e79daf029cde71119ffbb721bab1c039d78b97',
    'faq-008': '68f11aadd053f3e8402ab780c496c4364973f644c20ac5eb0d83eb8419c89d35',
    'faq-009': '0985eb2b8b72794d560d85c4285b2db9b01c16a183059f2eeecbda6754afdedc',
    'faq-010': '374c3d6b3b17d588ce11ed97e86622efba1a5598f086df5ebe312379a6273d02',
    'faq-011': '3ac01b3c2f17131c46a89f57d5b9f58503d443c3c5ea59cbc6910224b90dde73',
    'faq-012': '64bb6dbaadd97570bfcf9ee3cf3cee15d8103f712061e87355328546cdc295e3',
    'faq-013': 'be57bf0c44a6f9557b70703d3355a233d3335067db02e3763d86366eada3cf7b',
    'faq-014': '22480fa028c980548a7ef78e52dda16d85baf0419bc816a3445962cc1107c880',
    'faq-015': '677ff1dec0540a6045139fff9977de3e6047c47db282350d7c987de55c943eab',
    'faq-016': '9357867db8b765e06ccc08042ec86f5d90540a1723b4ae2a0abac1668ea8d200',
    'faq-017': '98d1fc7e649104fbbe8a3e8d570520f155b7d781022c6f24b4dc811f58da81c7',
    'faq-018': '802936e1978fd3bca845e6b2618211ad76d92b54d71aa1ea8cb5b824b4d4e4e5',
    'faq-019': '78eb932e9727f0eb67373539a34a56e76493017a28ab9fcbe67359915da6f8d9',
    'faq-020': '3795aaacc822681c389ea8d97172be7b5d91daacf7fc282c6b247ded47a9beea',
    'faq-021': '3420fa483aa619af48b787153cea4f4d0d83e17b5cfdf4263609e5899bc7e4a4',
    'faq-022': 'c6f7c4c2594f2bdb4a315f7cd08e596903ef242ef6686da6b3e562cfb9a6c541',
    'faq-023': '738b20c405af6406eabfc52b28341c7870b4e437adc7a8253522854e27088a17',
    'faq-024': '6cd1e56ed5033782e1d7a0d1bdf02ee39ec57d7b667deb9d045226014a1349e4',
    'faq-025': '91bbe55bf826f49fa391f3910c606bbf4377a32ef691d234199f225d61513787',
  },
  presentation: {
    shippingLabel: 'frete demonstrativo',
    shippingNotice: 'O frete é apenas ilustrativo e não gera cobrança ou entrega real.',
    quoteNotice: 'Esta é apenas uma simulação fictícia, sem compra, cobrança, reserva ou entrega real. O produto não foi adicionado ao carrinho.',
    comparisonNotice: 'Assim você pode comparar os perfis sem tratar nenhuma delas como clinicamente superior.',
    describeProduct,
    recommendationReasons,
    presentFaq,
    clinicalBoundary,
    describeIngredients,
  },
} satisfies StoreResponseProfile
