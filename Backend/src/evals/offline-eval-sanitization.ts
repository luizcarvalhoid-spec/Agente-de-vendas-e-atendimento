export function sanitizeEvalText(value: string) {
  return value
    .replace(
      /\b(?:sk-or-|sk-)[A-Za-z0-9_-]{4,}\b/gi,
      '[CREDENTIAL_REDACTED]',
    )
    .replace(
      /\b(?:gh[pousr]_[A-Za-z0-9]{20,}|AKIA[A-Z0-9]{16})\b/g,
      '[CREDENTIAL_REDACTED]',
    )
    .replace(
      /\bBearer\s+[A-Za-z0-9._~+/=-]{4,}\b/gi,
      '[AUTHORIZATION_REDACTED]',
    )
    .replace(
      /\b(api[_ -]?key|access[_ -]?token|authorization|secret)\s*[:=]\s*["']?[A-Za-z0-9._~+/=-]{4,}["']?/gi,
      '$1=[CREDENTIAL_REDACTED]',
    )
    .replace(
      /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi,
      '[EMAIL_REDACTED]',
    )
    .replace(
      /\b\d{3}\.?\d{3}\.?\d{3}-?\d{2}\b/g,
      '[IDENTIFIER_REDACTED]',
    )
    .replace(
      /\b(?:\d[ -]?){13,19}\b/g,
      '[PAYMENT_DATA_REDACTED]',
    )
}

export function sanitizeEvalEvidence<T>(value: T): T {
  if (typeof value === 'string') {
    return sanitizeEvalText(value) as T
  }
  if (Array.isArray(value)) {
    return value.map((item) => sanitizeEvalEvidence(item)) as T
  }
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [
        key,
        sanitizeEvalEvidence(item),
      ]),
    ) as T
  }
  return value
}
