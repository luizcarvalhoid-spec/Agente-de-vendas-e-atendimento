import { constants } from 'node:fs'
import { open, realpath } from 'node:fs/promises'

export const openAiCanaryCredentialModuleUrl = import.meta.url

const credentialPath = '/run/credentials/openai-canary.service/openai-api-key'

// O secret mount pertence ao usuário do serviço. A CLI não escolhe o caminho.
export async function loadOpenAiCanaryCredential(): Promise<string | undefined> {
  if (process.platform !== 'linux' || process.getuid === undefined) return undefined
  try {
    if (await realpath(credentialPath) !== credentialPath) return undefined
    const file = await open(credentialPath, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK)
    try {
      const info = await file.stat()
      if (!info.isFile() || info.uid !== process.getuid() || (info.mode & 0o077) !== 0 ||
          info.size < 20 || info.size > 4096) return undefined
      const buffer = Buffer.alloc(4097)
      try {
        const { bytesRead } = await file.read(buffer, 0, buffer.length, 0)
        const value = buffer.toString('utf8', 0, bytesRead).replace(/\r?\n$/, '')
        return bytesRead === info.size && /^sk-[A-Za-z0-9_-]{17,4093}$/.test(value) ? value : undefined
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
