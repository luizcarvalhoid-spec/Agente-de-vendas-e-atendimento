import { lstat, open } from 'node:fs/promises'
import { join, resolve } from 'node:path'

import { canaryUseIdSchema } from './external-canary-approval.js'

function isErrorCode(error: unknown, code: string) {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === code
}

export class CanaryAuthorizationUseStore {
  private readonly directory: string

  constructor(directory: string) {
    this.directory = resolve(directory)
  }

  private async recordPath(useId: string) {
    const info = await lstat(this.directory)
    if (!info.isDirectory() || info.isSymbolicLink()) throw new Error()
    return join(this.directory, `${canaryUseIdSchema.parse(useId)}.used`)
  }

  async status(useId: string): Promise<'available' | 'consumed' | 'unavailable'> {
    try {
      const path = await this.recordPath(useId)
      try {
        await lstat(path)
        return 'consumed'
      } catch (error) {
        if (isErrorCode(error, 'ENOENT')) return 'available'
        throw error
      }
    } catch {
      return 'unavailable'
    }
  }

  async consume(useId: string): Promise<'reserved' | 'consumed' | 'unavailable'> {
    try {
      const path = await this.recordPath(useId)
      let entry
      try {
        entry = await open(path, 'wx', 0o600)
      } catch (error) {
        if (isErrorCode(error, 'EEXIST')) return 'consumed'
        throw error
      }
      try {
        await entry.writeFile('{"version":1,"state":"consumed"}\n')
        await entry.sync()
      } finally {
        await entry.close()
      }
      return 'reserved'
    } catch {
      // Um marcador parcial continua impedindo nova tentativa.
      return 'unavailable'
    }
  }
}
