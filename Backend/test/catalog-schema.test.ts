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
  imageReferenceSchema,
  productCatalogSchema,
  productSchema,
} from '../src/catalog/product-schema.js'

function makeProduct(overrides: Record<string, unknown> = {}) {
  return {
    id: 1,
    slug: 'shampoo-anticaspa-hidrasplash',
    name: 'Shampoo Anticaspa HidraSplash',
    category: 'shampoos',
    subcategory: 'anticaspa',
    description:
      'Shampoo de demonstração para limpeza do couro cabeludo e cuidado dos fios.',
    shortDescription: 'Limpeza equilibrada para uma rotina de cuidado diário.',
    price: 44.9,
    originalPrice: 59.9,
    image: 'images/shampoo-anticaspa.jpg',
    images: ['images/shampoo-anticaspa-verso.webp'],
    stock: 18,
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
  assert.equal(product.ingredients[0]?.id, 'piritionato-de-zinco')
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
      makeProduct({ restrictions: [], warnings: [], contraindications: [] }),
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
