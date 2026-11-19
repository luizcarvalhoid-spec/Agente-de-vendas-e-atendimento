import type { CanaryAuthorityRegistry } from './external-canary-approval.js'

// Uma integração futura pode provisionar chaves públicas após revisão da autoridade.
// A CLI não lê o registro de flags, ambiente ou da própria aprovação.
export const configuredCanaryAuthorities: CanaryAuthorityRegistry = new Map()
