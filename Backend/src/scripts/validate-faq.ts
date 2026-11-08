import { runFaqValidation } from '../knowledge/faq-validation-command.js'

process.exitCode = await runFaqValidation()
