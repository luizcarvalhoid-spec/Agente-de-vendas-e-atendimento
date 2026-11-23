import { execFile, execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { readFileSync, realpathSync } from 'node:fs'
import { lstat, readFile, readdir, realpath } from 'node:fs/promises'
import { isAbsolute, join, relative, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'

import { fingerprintEvalValue } from './eval-baseline.js'
import { externalCanaryModuleUrl } from './external-canary.js'
import { externalEvalRunnerModuleUrl } from './external-eval-runner.js'

const exec = promisify(execFile)
const lockfile = 'Backend/pnpm-lock.yaml'
const runtimePaths = [
  'Backend/src', 'Backend/evals', 'Backend/content',
  'Backend/package.json', 'Backend/pnpm-lock.yaml', 'Backend/pnpm-workspace.yaml',
  'Backend/.npmrc', 'Backend/tsconfig.json', 'Backend/tsconfig.build.json',
  '.npmrc', 'package.json', 'pnpm-workspace.yaml',
]

export type CanarySourceIssue =
  | 'SOURCE_UNVERIFIED'
  | 'SOURCE_REVISION_MISMATCH'
  | 'RUNTIME_SOURCE_MISMATCH'
  | 'DIRTY_WORKTREE'
  | 'LOCKFILE_MISMATCH'
  | 'DEPENDENCIES_UNVERIFIED'

export interface CanarySourceIntegrity {
  commit?: string
  runtimeCommit?: string
  worktreeFingerprint?: string
  lockfileFingerprint?: string
  dependenciesFingerprint?: string
  issues: CanarySourceIssue[]
}

function gitEnvironment() {
  const local = Object.fromEntries(Object.entries(process.env).filter(([key]) =>
    /^(path|pathext|systemroot|systemdrive|windir|temp|tmp|tmpdir)$/i.test(key),
  ))
  return {
    ...local,
    GIT_CONFIG_GLOBAL: process.platform === 'win32' ? 'NUL' : '/dev/null',
    GIT_CONFIG_NOSYSTEM: '1',
    GIT_TERMINAL_PROMPT: '0',
  }
}

function gitOptions(directory: string) {
  return {
    cwd: directory,
    env: gitEnvironment(),
    encoding: 'utf8' as const,
    maxBuffer: 16 * 1024 * 1024,
    timeout: 15_000,
    windowsHide: true,
  }
}

const gitLocalOptions = ['--no-optional-locks', '-c', 'core.fsmonitor=false']
const headArgs = ['rev-parse', '--verify', 'HEAD^{commit}']

async function git(directory: string, ...args: string[]) {
  const { stdout } = await exec('git', ['-C', directory, ...gitLocalOptions, ...args], gitOptions(directory))
  return stdout
}

function inside(root: string, path: string) {
  const location = relative(root, path)
  return !isAbsolute(location) && location !== '..' && !location.startsWith(`..${sep}`)
}

// Captura a revisão no carregamento para detectar troca de HEAD com módulos ainda em memória.
function captureRuntimeSource(extraAnchors: readonly (readonly [string, string])[]) {
  try {
    const canonicalPath = realpathSync.native
    const root = canonicalPath(fileURLToPath(new URL('../../../', import.meta.url)))
    const anchors = ([
      [import.meta.url, 'evals/external-canary-integrity.ts'],
      [externalCanaryModuleUrl, 'evals/external-canary.ts'],
      [externalEvalRunnerModuleUrl, 'evals/external-eval-runner.ts'],
      ...extraAnchors,
    ] as const).map(([url, name]) => {
      const path = fileURLToPath(url)
      const resolved = canonicalPath(path)
      if (relative(resolved, join(root, 'Backend', 'src', name)) !== '') throw new Error()
      return { path, resolved, digest: createHash('sha256').update(readFileSync(resolved)).digest('hex') }
    })
    const gitAtLoad = (...args: string[]) => execFileSync(
      'git', ['-C', root, ...gitLocalOptions, ...args], gitOptions(root),
    ).trim()
    if (relative(canonicalPath(gitAtLoad('rev-parse', '--show-toplevel')), root) !== '') throw new Error()
    const commit = gitAtLoad(...headArgs)
    if (!/^[0-9a-f]{40}$/.test(commit)) throw new Error()
    const gitDirectory = canonicalPath(resolve(root, gitAtLoad('rev-parse', '--git-dir')))
    const zodPath = fileURLToPath(import.meta.resolve('zod'))
    return {
      root, commit, anchors, zodPath, zodResolved: canonicalPath(zodPath),
      worktreeFingerprint: fingerprintEvalValue(['canary-worktree-v1', root, gitDirectory]),
    }
  } catch {
    return undefined
  }
}

export function createCanaryRuntimeSourceInspector(anchors: readonly (readonly [string, string])[] = []) {
  const runtimeSource = captureRuntimeSource(anchors)
  return (expectedRevision?: string) => inspectRuntimeSource(runtimeSource, expectedRevision)
}

export const inspectCanaryRuntimeSource = createCanaryRuntimeSourceInspector()

async function inspectRuntimeSource(runtimeSource: ReturnType<typeof captureRuntimeSource>, expectedRevision?: string): Promise<CanarySourceIntegrity> {
  if (runtimeSource === undefined) return { issues: ['RUNTIME_SOURCE_MISMATCH'] }
  const result = await inspectCanarySource(runtimeSource.root, expectedRevision ?? runtimeSource.commit)
  result.runtimeCommit = runtimeSource.commit
  try {
    if (
      result.commit !== runtimeSource.commit ||
      result.worktreeFingerprint !== runtimeSource.worktreeFingerprint ||
      (await git(runtimeSource.root, ...headArgs)).trim() !== runtimeSource.commit
    ) throw new Error()
    for (const anchor of runtimeSource.anchors) {
      if (await realpath(anchor.path) !== anchor.resolved ||
          createHash('sha256').update(await readFile(anchor.resolved)).digest('hex') !== anchor.digest) {
        throw new Error()
      }
    }
  } catch {
    result.issues.push('RUNTIME_SOURCE_MISMATCH')
  }
  if (!result.issues.includes('DEPENDENCIES_UNVERIFIED')) {
    try {
      if (!inside(join(runtimeSource.root, 'Backend', 'node_modules'), runtimeSource.zodResolved) ||
          await realpath(runtimeSource.zodPath) !== runtimeSource.zodResolved) throw new Error()
    } catch {
      result.issues.push('DEPENDENCIES_UNVERIFIED')
    }
  }
  return result
}

async function fingerprintDependencies(backend: string, expectedLock: string) {
  const root = join(backend, 'node_modules')
  const rootInfo = await lstat(root)
  if (!rootInfo.isDirectory() || rootInfo.isSymbolicLink()) throw new Error()
  const storeLock = join(root, '.pnpm', 'lock.yaml')
  const storeInfo = await lstat(storeLock)
  if (!storeInfo.isFile() || storeInfo.size > 16 * 1024 * 1024 || !inside(root, await realpath(storeLock)) ||
      (await readFile(storeLock, 'utf8')).replace(/\r\n/g, '\n') !== expectedLock) {
    throw new Error()
  }

  const hash = createHash('sha256')
  const update = (value: readonly unknown[]) => hash.update(`${JSON.stringify(value)}\n`)
  update([process.platform, process.arch, process.versions.node])
  let entries = 0
  let bytes = 0
  async function visit(directory: string) {
    for (const name of (await readdir(directory)).sort()) {
      if (++entries > 100_000) throw new Error()
      const path = join(directory, name)
      const key = relative(root, path).split(sep).join('/')
      const info = await lstat(path)
      if (info.isSymbolicLink()) {
        const target = await realpath(path)
        if (!inside(root, target)) throw new Error()
        update(['link', key, relative(root, target).split(sep).join('/')])
      } else if (info.isDirectory()) {
        await visit(path)
      } else if (info.isFile()) {
        if ((bytes += info.size) > 512 * 1024 * 1024) throw new Error()
        const contents = await readFile(path)
        if (contents.length !== info.size) throw new Error()
        update(['file', key, info.mode & 0o111, createHash('sha256').update(contents).digest('hex')])
      } else {
        throw new Error()
      }
    }
  }
  await visit(root)
  return `sha256:${hash.digest('hex')}`
}

async function isDirty(root: string) {
  const [status, ignored, tracked, runtimeIndex] = await Promise.all([
    git(root, 'status', '--porcelain=v1', '-z', '--untracked-files=all', '--ignore-submodules=none'),
    git(root, 'ls-files', '-z', '--others', '--ignored', '--exclude-standard', '--', ...runtimePaths),
    git(root, 'ls-files', '-v', '-z'),
    git(root, 'ls-files', '--stage', '-z', '--', ...runtimePaths),
  ])
  // Arquivos com skip-worktree ou assume-unchanged não são prova de um checkout limpo.
  return !!(status || ignored || tracked.split('\0').some((entry) => /^[Sa-z] /.test(entry)) ||
    runtimeIndex.split('\0').some((entry) => /^(120000|160000) /.test(entry)))
}

async function hasGitFilters(root: string) {
  try {
    return !!(await git(root, 'config', '--name-only', '--get-regexp', '^filter\\.'))
  } catch (error) {
    if (typeof error === 'object' && error !== null && 'code' in error && error.code === 1) return false
    throw error
  }
}

export async function inspectCanarySource(
  repositoryRoot: string,
  expectedRevision: string,
): Promise<CanarySourceIntegrity> {
  const result: CanarySourceIntegrity = { issues: [] }
  try {
    const root = await realpath(repositoryRoot)
    if (relative(await realpath((await git(root, 'rev-parse', '--show-toplevel')).trim()), root) !== '') {
      throw new Error()
    }
    const commit = (await git(root, ...headArgs)).trim()
    if (!/^[0-9a-f]{40}$/.test(commit)) throw new Error()
    result.commit = commit
    const gitDirectory = await realpath(resolve(root, (await git(root, 'rev-parse', '--git-dir')).trim()))
    result.worktreeFingerprint = fingerprintEvalValue(['canary-worktree-v1', root, gitDirectory])
    if (commit !== expectedRevision) result.issues.push('SOURCE_REVISION_MISMATCH')
    if (await hasGitFilters(root)) throw new Error()
    if (await isDirty(root)) result.issues.push('DIRTY_WORKTREE')

    const committed = (await git(root, 'show', '--no-textconv', `${commit}:${lockfile}`)).replace(/\r\n/g, '\n')
    result.lockfileFingerprint = fingerprintEvalValue(committed)
    try {
      const path = join(root, lockfile)
      const info = await lstat(path)
      if (!info.isFile() || info.size > 16 * 1024 * 1024 || !inside(root, await realpath(path)) ||
          (await readFile(path, 'utf8')).replace(/\r\n/g, '\n') !== committed) throw new Error()
    } catch {
      result.issues.push('LOCKFILE_MISMATCH')
    }
    try {
      result.dependenciesFingerprint = await fingerprintDependencies(join(root, 'Backend'), committed)
    } catch {
      result.issues.push('DEPENDENCIES_UNVERIFIED')
    }
    if ((await git(root, ...headArgs)).trim() !== commit ||
        (!result.issues.includes('DIRTY_WORKTREE') && await isDirty(root))) {
      result.issues.push('SOURCE_UNVERIFIED')
    }
  } catch {
    result.issues.push('SOURCE_UNVERIFIED')
  }
  return result
}
