import { constants } from 'node:fs'
import { open, realpath } from 'node:fs/promises'

export const openRouterCanaryCredentialModuleUrl = import.meta.url

const credentialPath = '/run/credentials/openrouter-canary.service/openrouter-api-key'

export async function loadOpenRouterCanaryCredential(): Promise<string | undefined> {
  const uid = process.getuid?.()
  if (process.platform !== 'linux' || uid === undefined || uid === 0) return undefined
  try {
    if (await realpath(credentialPath) !== credentialPath) return undefined
    const file = await open(credentialPath, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK)
    try {
      const info = await file.stat()
      if (!info.isFile() || info.nlink !== 1 || info.uid !== uid ||
          (info.mode & 0o077) !== 0 || info.size < 26 || info.size > 256) return undefined
      const buffer = Buffer.alloc(257)
      try {
        const { bytesRead } = await file.read(buffer, 0, buffer.length, 0)
        const value = buffer.toString('utf8', 0, bytesRead).replace(/\r?\n$/, '')
        return bytesRead === info.size && /^sk-or-v1-[A-Za-z0-9_-]{17,244}$/.test(value) ? value : undefined
      } finally {
        buffer.fill(0)
      }
    } finally {
      await file.close()
    }
  } catch {
    return undefined
  }
}
