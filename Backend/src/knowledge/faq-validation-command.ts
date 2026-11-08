import {
  FaqContentValidationError,
  loadFaqDocuments,
  type LoadFaqDocumentsOptions,
} from './faq-content-loader.js'
import { faqCategories } from './faq-document-schema.js'

export interface FaqValidationOutput {
  info(message: string): void
  error(message: string): void
}

export interface FaqValidationCommandOptions extends LoadFaqDocumentsOptions {
  output?: FaqValidationOutput
}

const consoleOutput: FaqValidationOutput = {
  info(message) {
    console.log(message)
  },
  error(message) {
    console.error(message)
  },
}

export async function runFaqValidation(
  options: FaqValidationCommandOptions = {},
) {
  const output = options.output ?? consoleOutput

  try {
    const documents = await loadFaqDocuments({ faqRoot: options.faqRoot })

    output.info('Base FAQ válida.')
    output.info(`Documentos: ${documents.length}`)
    for (const category of faqCategories) {
      output.info(
        `${category}: ${documents.filter((document) => document.category === category).length}`,
      )
    }
    output.info('Frontmatter, estrutura editorial e unicidade verificados.')
    return 0
  } catch (error) {
    if (error instanceof FaqContentValidationError) {
      output.error('Base FAQ inválida:')
      error.issues.forEach((issue) => {
        const location = issue.file ? `${issue.file}: ` : ''
        output.error(`- ${location}${issue.message}`)
      })
      return 1
    }

    output.error('Falha inesperada ao validar a base FAQ.')
    return 1
  }
}
