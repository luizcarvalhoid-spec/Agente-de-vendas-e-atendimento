import assert from 'node:assert/strict'
import {
  mkdir,
  mkdtemp,
  rm,
  symlink,
  writeFile,
} from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test, { type TestContext } from 'node:test'

import { ZodError } from 'zod'

import { validateCatalog } from '../src/catalog/catalog-validator.js'
import {
  commercialProductSchema,
  imageReferenceSchema,
  productCatalogSchema,
  productSchema,
} from '../src/catalog/product-schema.js'

function makeProduct(overrides: Record<string, unknown> = {}) {
  return {
    id: 1,
    slug: 'shampoo-anticaspa-hidrasplash',
    name: 'Shampoo Anticaspa HidraSplash',
    brand: 'HidraSplash',
    isDemo: true,
    dataClassification: {
      commercial: 'fictional-demo',
      compatibility: 'commercial-positioning',
      formulation: 'synthetic-test-data',
      safety: 'not-evaluated',
    },
    category: 'shampoos',
    subcategory: 'anticaspa',
    applicationArea: 'hair',
    productKind: 'single',
    description:
      'Shampoo de demonstração para limpeza do couro cabeludo e cuidado dos fios.',
    shortDescription: 'Limpeza equilibrada para uma rotina de cuidado diário.',
    price: 44.9,
    originalPrice: 59.9,
    image: 'images/shampoo-anticaspa.jpg',
    images: ['images/shampoo-anticaspa-verso.webp'],
    stock: 18,
    netContent: { value: 250, unit: 'ml' },
    variant: {
      name: 'Coco & Blueberry',
      profile: 'hidratacao-equilibrada',
      sensoryNotes: ['Coco', 'Blueberry'],
    },
    tags: ['anticaspa', 'limpeza-equilibrada'],
    indications: ['Cuidado de couro cabeludo com tendência à oleosidade.'],
    hairTypes: ['todos'],
    scalpTypes: ['normal', 'oleoso'],
    concerns: ['caspa', 'oleosidade'],
    benefits: ['Ajuda a manter a sensação de limpeza.'],
    ingredients: [
      { id: 'piritionato-de-zinco', name: 'Piritionato de zinco' },
      { id: 'pantenol', name: 'Pantenol' },
    ],
    usage: 'Aplicar nos cabelos molhados, massagear e enxaguar.',
    restrictions: [],
    warnings: ['Uso externo. Evite contato com os olhos.'],
    contraindications: [
      'Não usar em caso de sensibilidade conhecida aos ingredientes.',
    ],
    rating: 4.5,
    reviews: 128,
    ...overrides,
  }
}

function makeBodyProduct(overrides: Record<string, unknown> = {}) {
  const hairProduct = makeProduct()
  const {
    hairTypes: _hairTypes,
    scalpTypes: _scalpTypes,
    concerns: _concerns,
    ...commonProduct
  } = hairProduct

  return {
    ...commonProduct,
    id: 15,
    slug: 'sabonete-vegetal-avela',
    name: 'Sabonete Vegetal Avelã',
    category: 'sabonetes',
    subcategory: 'barra',
    applicationArea: 'body',
    image: 'images/sabonete-avela.jpg',
    netContent: { value: 90, unit: 'g' },
    variant: { name: 'Avelã', profile: 'aconchegante' },
    soapForm: 'bar',
    skinTypes: ['todos'],
    bodyConcerns: ['limpeza-suave'],
    ...overrides,
  }
}

function assertIssueAt(
  result: ReturnType<typeof productSchema.safeParse>,
  path: Array<string | number>,
) {
  assert.equal(result.success, false)
  if (result.success) return

  assert.ok(
    result.error.issues.some(
      (issue) => JSON.stringify(issue.path) === JSON.stringify(path),
    ),
    `Expected an issue at ${JSON.stringify(path)}. Received: ${JSON.stringify(
      result.error.issues,
    )}`,
  )
}

async function createImageFixture(t: TestContext) {
  const temporaryRoot = await mkdtemp(join(tmpdir(), 'hidrasplash-catalog-'))
  const imageRoot = join(temporaryRoot, 'catalog')
  const imagesDirectory = join(imageRoot, 'images')

  await mkdir(imagesDirectory, { recursive: true })
  await writeFile(join(imagesDirectory, 'shampoo-anticaspa.jpg'), 'primary')
  await writeFile(
    join(imagesDirectory, 'shampoo-anticaspa-verso.webp'),
    'gallery',
  )

  t.after(() => rm(temporaryRoot, { recursive: true, force: true }))

  return { imageRoot, temporaryRoot }
}

test('product schema accepts complete details and normalizes identifiers', () => {
  const product = productSchema.parse(
    makeProduct({
      slug: '  Shampoo-Anticaspa-HidraSplash  ',
      tags: ['  ANTICASPA  ', 'limpeza-equilibrada'],
      ingredients: [
        { id: '  PIRITIONATO-DE-ZINCO  ', name: 'Piritionato de zinco' },
      ],
    }),
  )

  assert.equal(product.slug, 'shampoo-anticaspa-hidrasplash')
  assert.deepEqual(product.tags, ['anticaspa', 'limpeza-equilibrada'])
  assert.equal(product.ingredients?.[0]?.id, 'piritionato-de-zinco')
})

test('schema separates hair products from body products', async (t) => {
  assert.equal(productSchema.safeParse(makeBodyProduct()).success, true)

  await t.test('body product rejects hair compatibility fields', () => {
    assertIssueAt(
      productSchema.safeParse(
        makeBodyProduct({ hairTypes: ['todos'] }),
      ),
      [],
    )
  })

  await t.test('hair product rejects body compatibility fields', () => {
    assertIssueAt(
      productSchema.safeParse(
        makeProduct({ skinTypes: ['todos'] }),
      ),
      [],
    )
  })

  await t.test('application area must match category', () => {
    assertIssueAt(
      productSchema.safeParse(
        makeProduct({ category: 'sabonetes', subcategory: 'barra' }),
      ),
      ['applicationArea'],
    )
  })
})

test('kit is one commercial product with structured contents', async (t) => {
  const {
    ingredients: _ingredients,
    usage: _usage,
    restrictions: _restrictions,
    warnings: _warnings,
    contraindications: _contraindications,
    ...kitBase
  } = makeProduct({
    id: 7,
    slug: 'kit-shampoo-condicionador',
    subcategory: 'kit',
    productKind: 'kit',
  })
  const formulation = {
    basis: 'synthetic-test-data',
    ingredients: [{ id: 'glicerina', name: 'Glicerina' }],
    usage: 'Modo de uso demonstrativo e geral.',
    restrictions: [],
    warnings: ['Dados sintéticos; segurança não avaliada.'],
    contraindications: [],
  }
  const kit = {
    ...kitBase,
    kitContents: [
      {
        name: 'Shampoo demonstrativo',
        quantity: 1,
        netContent: { value: 100, unit: 'ml' },
        formulation,
      },
      {
        name: 'Condicionador demonstrativo',
        quantity: 1,
        netContent: { value: 100, unit: 'ml' },
        formulation: {
          ...formulation,
          ingredients: [
            { id: 'alcool-cetoestearilico', name: 'Álcool cetoestearílico' },
          ],
        },
      },
    ],
  }

  assert.equal(productSchema.safeParse(kit).success, true)

  await t.test('kit without contents', () => {
    assertIssueAt(
      productSchema.safeParse({
        ...kit,
        kitContents: undefined,
      }),
      ['kitContents'],
    )
  })

  await t.test('single product with kit contents', () => {
    assertIssueAt(
      productSchema.safeParse({
        ...kit,
        subcategory: 'uso-diario',
        productKind: 'single',
      }),
      ['kitContents'],
    )
  })

  await t.test('kit rejects one aggregated formulation', () => {
    assertIssueAt(
      productSchema.safeParse({
        ...kit,
        ingredients: [{ id: 'glicerina', name: 'Glicerina' }],
        usage: 'Uso agregado inválido.',
        restrictions: [],
        warnings: ['Aviso agregado inválido.'],
        contraindications: [],
      }),
      ['ingredients'],
    )
  })
})

test('commercial draft is valid but publication rejects missing reviewed fields', () => {
  const {
    ingredients: _ingredients,
    usage: _usage,
    restrictions: _restrictions,
    warnings: _warnings,
    contraindications: _contraindications,
    ...commercialDraft
  } = makeProduct()

  commercialDraft.dataClassification = {
    commercial: 'fictional-demo',
    compatibility: 'commercial-positioning',
    formulation: 'not-provided',
    safety: 'not-evaluated',
  }

  assert.equal(commercialProductSchema.safeParse(commercialDraft).success, true)
  assert.equal(productSchema.safeParse(commercialDraft).success, false)
})

test('data classification distinguishes commercial, synthetic and unevaluated data', async (t) => {
  await t.test('published product requires synthetic formulation data', () => {
    assertIssueAt(
      productSchema.safeParse(
        makeProduct({
          dataClassification: {
            commercial: 'fictional-demo',
            compatibility: 'commercial-positioning',
            formulation: 'not-provided',
            safety: 'not-evaluated',
          },
        }),
      ),
      ['dataClassification', 'formulation'],
    )
  })

  await t.test('synthetic formulation requires structured ingredients', () => {
    assertIssueAt(
      productSchema.safeParse(makeProduct({ ingredients: undefined })),
      ['ingredients'],
    )
  })

  await t.test('formulation cannot be presented as verified', () => {
    assertIssueAt(
      productSchema.safeParse(
        makeProduct({
          dataClassification: {
            commercial: 'fictional-demo',
            compatibility: 'commercial-positioning',
            formulation: 'verified',
            safety: 'not-evaluated',
          },
        }),
      ),
      ['dataClassification', 'formulation'],
    )
  })

  await t.test('safety cannot be presented as evaluated', () => {
    assertIssueAt(
      productSchema.safeParse(
        makeProduct({
          dataClassification: {
            commercial: 'fictional-demo',
            compatibility: 'commercial-positioning',
            formulation: 'synthetic-test-data',
            safety: 'evaluated',
          },
        }),
      ),
      ['dataClassification', 'safety'],
    )
  })

  await t.test('empty restrictions do not remove the unevaluated safety marker', () => {
    const result = productSchema.safeParse(
      makeProduct({ restrictions: [], contraindications: [] }),
    )

    assert.equal(result.success, true)
    if (!result.success) return
    assert.equal(result.data.dataClassification.safety, 'not-evaluated')
    assert.ok((result.data.warnings?.length ?? 0) > 0)
  })
})

test('required product lists cannot be empty', async (t) => {
  const requiredLists = [
    'tags',
    'indications',
    'hairTypes',
    'scalpTypes',
    'concerns',
    'benefits',
    'ingredients',
    'warnings',
  ]

  for (const field of requiredLists) {
    await t.test(field, () => {
      assertIssueAt(productSchema.safeParse(makeProduct({ [field]: [] })), [
        field,
      ])
    })
  }

  assert.equal(
    productSchema.safeParse(
      makeProduct({ restrictions: [], contraindications: [] }),
    ).success,
    true,
  )
})

test('product schema rejects invalid text, commercial values and unknown fields', async (t) => {
  const cases: Array<{
    name: string
    overrides: Record<string, unknown>
    path: Array<string | number>
  }> = [
    { name: 'empty name', overrides: { name: '   ' }, path: ['name'] },
    { name: 'negative price', overrides: { price: -1 }, path: ['price'] },
    {
      name: 'excess price precision',
      overrides: { price: 10.999 },
      path: ['price'],
    },
    {
      name: 'original price not greater',
      overrides: { originalPrice: 44.9 },
      path: ['originalPrice'],
    },
    {
      name: 'fractional stock',
      overrides: { stock: 1.5 },
      path: ['stock'],
    },
    {
      name: 'unknown field',
      overrides: { unexpected: true },
      path: [],
    },
  ]

  for (const item of cases) {
    await t.test(item.name, () => {
      assertIssueAt(productSchema.safeParse(makeProduct(item.overrides)), item.path)
    })
  }
})

test('taxonomy separates scalp types from concerns and rejects contradictions', async (t) => {
  assert.equal(
    productSchema.safeParse(
      makeProduct({ scalpTypes: ['oleoso'], concerns: ['caspa'] }),
    ).success,
    true,
  )

  await t.test('concern used as scalp type', () => {
    assertIssueAt(
      productSchema.safeParse(makeProduct({ scalpTypes: ['caspa'] })),
      ['scalpTypes', 0],
    )
  })

  await t.test('subcategory outside category', () => {
    assertIssueAt(
      productSchema.safeParse(
        makeProduct({ category: 'mascaras', subcategory: 'anticaspa' }),
      ),
      ['subcategory'],
    )
  })

  await t.test('all marker combined with a specific type', () => {
    assertIssueAt(
      productSchema.safeParse(makeProduct({ hairTypes: ['todos', 'cacheados'] })),
      ['hairTypes'],
    )
  })

  await t.test('restriction contradicts compatible scalp type', () => {
    assertIssueAt(
      productSchema.safeParse(
        makeProduct({
          scalpTypes: ['sensivel'],
          restrictions: ['evitar-couro-cabeludo-sensivel'],
        }),
      ),
      ['restrictions', 0],
    )
  })
})

test('normalized duplicates are rejected in text and ingredient lists', async (t) => {
  await t.test('tags', () => {
    assertIssueAt(
      productSchema.safeParse(
        makeProduct({ tags: ['HIDRATACAO', 'hidratacao'] }),
      ),
      ['tags', 1],
    )
  })

  await t.test('free text', () => {
    assertIssueAt(
      productSchema.safeParse(
        makeProduct({ indications: ['Cabelos ressecados', ' cabelos  ressecados '] }),
      ),
      ['indications', 1],
    )
  })

  await t.test('ingredient identifiers', () => {
    assertIssueAt(
      productSchema.safeParse(
        makeProduct({
          ingredients: [
            { id: 'PANTENOL', name: 'Pantenol' },
            { id: 'pantenol', name: 'Pró-vitamina B5' },
          ],
        }),
      ),
      ['ingredients', 1],
    )
  })
})

test('rating and reviews follow one consistent state', async (t) => {
  const cases: Array<{
    name: string
    overrides: Record<string, unknown>
    path: Array<string | number>
  }> = [
    { name: 'rating without reviews', overrides: { reviews: undefined }, path: ['reviews'] },
    { name: 'reviews without rating', overrides: { rating: undefined }, path: ['rating'] },
    {
      name: 'non-zero rating without reviews',
      overrides: { rating: 4, reviews: 0 },
      path: ['rating'],
    },
    {
      name: 'zero rating with reviews',
      overrides: { rating: 0, reviews: 2 },
      path: ['rating'],
    },
  ]

  for (const item of cases) {
    await t.test(item.name, () => {
      assertIssueAt(productSchema.safeParse(makeProduct(item.overrides)), item.path)
    })
  }

  assert.equal(
    productSchema.safeParse(makeProduct({ rating: 0, reviews: 0 })).success,
    true,
  )
  assert.equal(
    productSchema.safeParse(makeProduct({ rating: undefined, reviews: undefined }))
      .success,
    true,
  )
})

test('catalog schema rejects duplicate IDs and normalized slugs', () => {
  const result = productCatalogSchema.safeParse([
    makeProduct(),
    makeProduct({ id: 1, slug: 'SHAMPOO-ANTICASPA-HIDRASPLASH' }),
  ])

  assert.equal(result.success, false)
  if (result.success) return

  assert.ok(
    result.error.issues.some(
      (issue) => JSON.stringify(issue.path) === JSON.stringify([1, 'id']),
    ),
  )
  assert.ok(
    result.error.issues.some(
      (issue) => JSON.stringify(issue.path) === JSON.stringify([1, 'slug']),
    ),
  )
})

test('image references reject unsafe paths and duplicate gallery entries', async (t) => {
  const invalidReferences = [
    '../outside.jpg',
    '/absolute/image.jpg',
    'C:\\images\\product.jpg',
    'https://example.com/product.jpg',
    'images/product.svg',
  ]

  for (const reference of invalidReferences) {
    await t.test(reference, () => {
      assert.equal(imageReferenceSchema.safeParse(reference).success, false)
    })
  }

  assertIssueAt(
    productSchema.safeParse(
      makeProduct({ images: ['images/shampoo-anticaspa.jpg'] }),
    ),
    ['images', 0],
  )
})

test('catalog validator accepts existing images inside the configured root', async (t) => {
  const { imageRoot } = await createImageFixture(t)
  const catalog = await validateCatalog([makeProduct()], { imageRoot })

  assert.equal(catalog.length, 1)
  assert.equal(catalog[0]?.slug, 'shampoo-anticaspa-hidrasplash')
})

test('catalog validator rejects missing images', async (t) => {
  const { imageRoot } = await createImageFixture(t)

  await assert.rejects(
    validateCatalog([makeProduct({ image: 'images/missing.jpg' })], {
      imageRoot,
    }),
    (error: unknown) => {
      assert.ok(error instanceof ZodError)
      assert.ok(
        error.issues.some(
          (issue) => JSON.stringify(issue.path) === JSON.stringify([0, 'image']),
        ),
      )
      return true
    },
  )
})

test('catalog validator rejects symbolic links that escape the image root', async (t) => {
  const { imageRoot, temporaryRoot } = await createImageFixture(t)
  const outsideDirectory = join(temporaryRoot, 'outside')
  const linkedDirectory = join(imageRoot, 'external')

  await mkdir(outsideDirectory)
  await writeFile(join(outsideDirectory, 'outside.jpg'), 'outside')
  await symlink(
    outsideDirectory,
    linkedDirectory,
    process.platform === 'win32' ? 'junction' : 'dir',
  )

  await assert.rejects(
    validateCatalog([makeProduct({ image: 'external/outside.jpg' })], {
      imageRoot,
    }),
    (error: unknown) => {
      assert.ok(error instanceof ZodError)
      assert.ok(
        error.issues.some(
          (issue) =>
            JSON.stringify(issue.path) === JSON.stringify([0, 'image']) &&
            /link simbólico/i.test(issue.message),
        ),
      )
      return true
    },
  )
})
