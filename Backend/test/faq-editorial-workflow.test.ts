import assert from 'node:assert/strict'
import {
  cp,
  mkdtemp,
  readFile,
  rename,
  rm,
  symlink,
  writeFile,
} from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { pathToFileURL, fileURLToPath } from 'node:url'
import test, { type TestContext } from 'node:test'

import {
  FaqContentValidationError,
  loadFaqDocuments,
  parseFaqDocumentSource,
  resolveDefaultFaqRoot,
} from '../src/knowledge/faq-content-loader.js'
import {
  runFaqValidation,
  type FaqValidationOutput,
} from '../src/knowledge/faq-validation-command.js'

const backendRoot = dirname(dirname(fileURLToPath(import.meta.url)))
const canonicalFaqRoot = join(backendRoot, 'content', 'knowledge', 'faq')

const validSource = `---
sourceId: faq-999
category: frete
title: Esta pergunta demonstrativa é válida?
classification: fictional-demo
---

Esta é uma resposta fictícia de demonstração com conteúdo editorial suficiente.`

function createOutputCollector() {
  const info: string[] = []
  const errors: string[] = []
  const output: FaqValidationOutput = {
    info(message) {
      info.push(message)
    },
    error(message) {
      errors.push(message)
    },
  }
  return { errors, info, output }
}

async function createFaqFixture(t: TestContext) {
  const temporaryRoot = await mkdtemp(join(tmpdir(), 'hidrasplash-faq-'))
  const faqRoot = join(temporaryRoot, 'faq')
  await cp(canonicalFaqRoot, faqRoot, { recursive: true })
  t.after(() => rm(temporaryRoot, { recursive: true, force: true }))
  return { faqRoot, temporaryRoot }
}

function assertFaqError(action: () => unknown, expected: RegExp) {
  assert.throws(action, (error: unknown) => {
    assert.ok(error instanceof FaqContentValidationError)
    assert.match(error.issues.map((issue) => issue.message).join('\n'), expected)
    return true
  })
}

test('flat frontmatter parser accepts only the controlled metadata format', () => {
  assert.deepEqual(parseFaqDocumentSource(validSource), {
    sourceId: 'faq-999',
    category: 'frete',
    title: 'Esta pergunta demonstrativa é válida?',
    classification: 'fictional-demo',
    content:
      'Esta é uma resposta fictícia de demonstração com conteúdo editorial suficiente.',
  })

  const invalidCases: Array<{ source: string; expected: RegExp }> = [
    {
      source: validSource.replace(
        'category: frete',
        'category: frete\ncategory: pagamento',
      ),
      expected: /Metadado duplicado: category/,
    },
    {
      source: validSource.replace(
        'classification: fictional-demo',
        'audience: customer\nclassification: fictional-demo',
      ),
      expected: /Metadado desconhecido: audience/,
    },
    {
      source: validSource.replace('title: Esta pergunta demonstrativa é válida?\n', ''),
      expected: /Metadado obrigatório ausente: title/,
    },
    {
      source: validSource.replace('classification: fictional-demo', 'classification: verified'),
      expected: /classification/,
    },
    {
      source: validSource.replace('é válida?', 'é válida'),
      expected: /interrogação/,
    },
    {
      source: validSource.replace(/fictícia de demonstração/, 'editorial controlado'),
      expected: /caráter fictício ou demonstrativo/,
    },
  ]

  for (const invalidCase of invalidCases) {
    assertFaqError(
      () => parseFaqDocumentSource(invalidCase.source),
      invalidCase.expected,
    )
  }
})

test('validate:faq reports canonical counts without exposing paths', async () => {
  const collector = createOutputCollector()
  const exitCode = await runFaqValidation({
    faqRoot: canonicalFaqRoot,
    output: collector.output,
  })

  assert.equal(exitCode, 0)
  assert.deepEqual(collector.errors, [])
  assert.ok(collector.info.includes('Base FAQ válida.'))
  assert.ok(collector.info.includes('Documentos: 25'))
  assert.ok(collector.info.includes('frete: 4'))
  assert.ok(collector.info.includes('pagamento: 4'))
  assert.ok(collector.info.includes('trocas: 5'))
  assert.ok(collector.info.includes('produtos: 5'))
  assert.ok(collector.info.includes('pedidos: 4'))
  assert.ok(collector.info.includes('privacidade: 3'))
})

test('loader rejects filename, category, duplicate and unexpected entries', async (t) => {
  await t.test('filename differs from sourceId', async (t) => {
    const { faqRoot } = await createFaqFixture(t)
    await rename(
      join(faqRoot, 'frete', 'faq-001.md'),
      join(faqRoot, 'frete', 'faq-999.md'),
    )
    await assert.rejects(
      loadFaqDocuments({ faqRoot }),
      (error: unknown) =>
        error instanceof FaqContentValidationError &&
        error.issues.some((issue) => /nome do arquivo/.test(issue.message)),
    )
  })

  await t.test('category differs from directory', async (t) => {
    const { faqRoot } = await createFaqFixture(t)
    const file = join(faqRoot, 'frete', 'faq-001.md')
    await writeFile(
      file,
      (await readFile(file, 'utf8')).replace('category: frete', 'category: pedidos'),
      'utf8',
    )
    await assert.rejects(
      loadFaqDocuments({ faqRoot }),
      (error: unknown) =>
        error instanceof FaqContentValidationError &&
        error.issues.some((issue) => /corresponder ao diretório/.test(issue.message)),
    )
  })

  await t.test('duplicate sourceId', async (t) => {
    const { faqRoot } = await createFaqFixture(t)
    const source = (await readFile(join(faqRoot, 'frete', 'faq-001.md'), 'utf8'))
      .replace('category: frete', 'category: pagamento')
      .replace(
        'title: A HidraSplash realiza entregas reais?',
        'title: Esta duplicata técnica possui outro título?',
      )
    await writeFile(join(faqRoot, 'pagamento', 'faq-001.md'), source, 'utf8')
    await assert.rejects(
      loadFaqDocuments({ faqRoot }),
      (error: unknown) =>
        error instanceof FaqContentValidationError &&
        error.issues.some((issue) => /sourceId duplicado/.test(issue.message)),
    )
  })

  await t.test('normalized duplicate title', async (t) => {
    const { faqRoot } = await createFaqFixture(t)
    const firstTitle = 'A loja processa pagamentos reais?'
    const file = join(faqRoot, 'pagamento', 'faq-006.md')
    await writeFile(
      file,
      (await readFile(file, 'utf8')).replace(
        'É necessário informar cartão, chave PIX ou boleto?',
        firstTitle.toLocaleUpperCase('pt-BR'),
      ),
      'utf8',
    )
    await assert.rejects(
      loadFaqDocuments({ faqRoot }),
      (error: unknown) =>
        error instanceof FaqContentValidationError &&
        error.issues.some((issue) => /Título duplicado/.test(issue.message)),
    )
  })

  await t.test('unexpected file', async (t) => {
    const { faqRoot } = await createFaqFixture(t)
    await writeFile(join(faqRoot, 'frete', 'notes.txt'), 'unexpected', 'utf8')
    await assert.rejects(
      loadFaqDocuments({ faqRoot }),
      (error: unknown) =>
        error instanceof FaqContentValidationError &&
        error.issues.some((issue) => /Somente arquivos faq-NNN\.md/.test(issue.message)),
    )
  })
})

test('loader rejects a symbolic link without following it outside the FAQ root', async (t) => {
  const { faqRoot, temporaryRoot } = await createFaqFixture(t)
  const outsideCategory = join(temporaryRoot, 'outside-frete')
  await cp(join(faqRoot, 'frete'), outsideCategory, { recursive: true })
  await rm(join(faqRoot, 'frete'), { recursive: true, force: true })
  await symlink(outsideCategory, join(faqRoot, 'frete'), 'junction')

  await assert.rejects(
    loadFaqDocuments({ faqRoot }),
    (error: unknown) =>
      error instanceof FaqContentValidationError &&
      error.issues.some((issue) => /Links simbólicos não são permitidos/.test(issue.message)),
  )
})

test('validation errors expose only sanitized relative locations', async (t) => {
  const { faqRoot, temporaryRoot } = await createFaqFixture(t)
  await writeFile(join(faqRoot, 'frete', 'notes.txt'), 'unexpected', 'utf8')
  const collector = createOutputCollector()
  const exitCode = await runFaqValidation({ faqRoot, output: collector.output })

  assert.equal(exitCode, 1)
  assert.deepEqual(collector.info, [])
  assert.ok(collector.errors.some((message) => message.includes('frete/notes.txt')))
  assert.ok(collector.errors.every((message) => !message.includes(temporaryRoot)))
  assert.ok(collector.errors.every((message) => !message.includes('    at ')))
})

test('default FAQ root works for both src and dist module locations', () => {
  const srcModule = pathToFileURL(
    join(backendRoot, 'src', 'knowledge', 'faq-content-loader.ts'),
  ).href
  const distModule = pathToFileURL(
    join(backendRoot, 'dist', 'knowledge', 'faq-content-loader.js'),
  ).href

  assert.equal(resolveDefaultFaqRoot(srcModule), canonicalFaqRoot)
  assert.equal(resolveDefaultFaqRoot(distModule), canonicalFaqRoot)
})
