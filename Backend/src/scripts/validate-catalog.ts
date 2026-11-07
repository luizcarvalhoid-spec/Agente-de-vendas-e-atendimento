import { runCatalogValidation } from '../catalog/catalog-validation-command.js'

process.exitCode = await runCatalogValidation()
