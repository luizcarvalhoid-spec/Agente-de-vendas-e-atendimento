import type { StoreResponseProfile } from '../../src/agent/chat-response-composer.js'
import type { Product } from '../../src/catalog/product-schema.js'
import type { FaqDocument } from '../../src/knowledge/faq-document-schema.js'

export const papelariaFaqDocuments = [
  {
    sourceId: 'faq-701',
    title: 'Onde consultar a regra de frete grátis?',
    category: 'frete',
    classification: 'fictional-demo',
    content: 'Na demonstração, esta é a referência editorial da regra vigente de frete grátis.',
  },
  {
    sourceId: 'faq-702',
    title: 'Onde consultar a regra de frete padrão?',
    category: 'frete',
    classification: 'fictional-demo',
    content: 'Na demonstração, esta é a referência editorial da regra vigente de frete padrão.',
  },
] as const satisfies readonly FaqDocument[]

export const papelariaResponseProfile = {
  storeName: 'Papelaria Horizonte',
  domainInstructions: ['Ao comparar cadernos, considere os formatos informados no catálogo.'],
  shipping: {
    rules: {
      standardShippingCents: 850,
      freeShippingThresholdCents: 8_000,
      freeShippingComparison: 'at_or_above',
    },
    freeShippingFaq: {
      sourceId: papelariaFaqDocuments[0].sourceId,
      contentTemplate: papelariaFaqDocuments[0].content,
    },
    standardShippingFaq: {
      sourceId: papelariaFaqDocuments[1].sourceId,
      contentTemplate: papelariaFaqDocuments[1].content,
    },
  },
} as const satisfies StoreResponseProfile

// Only the display fields model stationery. Persisted categories and eligibility remain unchanged.
export function papelariaProduct(product: Product, name: string, price = product.price): Product {
  return {
    ...product,
    name,
    brand: papelariaResponseProfile.storeName,
    shortDescription: 'Caderno pautado.',
    price,
    originalPrice: undefined,
  }
}
