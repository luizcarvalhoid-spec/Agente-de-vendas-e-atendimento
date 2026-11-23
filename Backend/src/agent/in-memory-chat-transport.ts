const transports = new WeakSet<typeof fetch>()

export function registerInMemoryChatTransport(handler: typeof fetch): typeof fetch {
  if (handler === globalThis.fetch) throw new TypeError('Transporte HTTP real desabilitado.')
  const transport: typeof fetch = (input, init) => handler(input, init)
  transports.add(transport)
  return transport
}

export function isInMemoryChatTransport(transport: typeof fetch) {
  return transport !== globalThis.fetch && transports.has(transport)
}
