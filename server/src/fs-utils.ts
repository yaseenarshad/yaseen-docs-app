import { randomBytes } from 'node:crypto'
import { readdir, rename, stat, unlink, writeFile } from 'node:fs/promises'
import path from 'node:path'
import type { ContentfulStatusCode } from 'hono/utils/http-status'
import type { ApiErrorCode, DirEntry, TreeNode } from '@shared/types'
import { fileKind } from '@shared/fileKind'

/** Thrown by routes/helpers; mapped to `{ error: { code, message, path } }` by `app.onError`. */
export class ApiFailure extends Error {
  constructor(
    readonly status: ContentfulStatusCode,
    readonly code: ApiErrorCode,
    message: string,
    readonly path?: string,
  ) {
    super(message)
  }
}

export function isSafeAbsPath(p: unknown): p is string {
  return typeof p === 'string' && path.isAbsolute(p) && !p.includes('\0')
}

/** Validates + normalises a path query param, throwing 400 when missing/relative. */
export function requireAbsPath(p: unknown, param: string): string {
  if (p === undefined || p === '') {
    throw new ApiFailure(400, 'BAD_REQUEST', `missing '${param}' query parameter`)
  }
  if (!isSafeAbsPath(p)) {
    throw new ApiFailure(400, 'NOT_ABSOLUTE', `'${param}' must be an absolute path`, String(p))
  }
  return path.resolve(p)
}

export function isMarkdown(name: string): boolean {
  return fileKind(name) === 'markdown'
}

export function isBase(name: string): boolean {
  return fileKind(name) === 'base'
}

/** Markdown or `.base` — the files the tree, watcher and file routes serve. */
export function isVaultFile(name: string): boolean {
  return fileKind(name) !== null
}

/** Dot-entries and node_modules are invisible to every endpoint. */
export function isSkipped(name: string): boolean {
  return name.startsWith('.') || name === 'node_modules'
}

export function byNameCi<T extends { name: string }>(a: T, b: T): number {
  return a.name.toLowerCase().localeCompare(b.name.toLowerCase())
}

function errnoCode(err: unknown): string | undefined {
  return typeof err === 'object' && err !== null && 'code' in err ? String(err.code) : undefined
}

/** Maps a Node fs error to an ApiFailure for `p`. */
export function toApiFailure(err: unknown, p: string): ApiFailure {
  if (err instanceof ApiFailure) return err
  switch (errnoCode(err)) {
    case 'ENOENT':
      return new ApiFailure(404, 'NOT_FOUND', 'path does not exist', p)
    case 'EACCES':
    case 'EPERM':
      return new ApiFailure(403, 'FORBIDDEN', 'permission denied', p)
    case 'ENOTDIR':
      return new ApiFailure(400, 'NOT_A_DIRECTORY', 'expected a directory', p)
    case 'EEXIST':
      return new ApiFailure(409, 'ALREADY_EXISTS', 'path already exists', p)
    case 'EISDIR':
      return new ApiFailure(400, 'NOT_A_FILE', 'expected a file', p)
    default:
      return new ApiFailure(500, 'IO_ERROR', err instanceof Error ? err.message : String(err), p)
  }
}

/** Runs `fn`, converting any fs error into an ApiFailure attributed to `p`. */
export async function fsCall<T>(p: string, fn: () => Promise<T>): Promise<T> {
  try {
    return await fn()
  } catch (err) {
    throw toApiFailure(err, p)
  }
}

/** Throws 404 / 403 / 400 NOT_A_DIRECTORY unless `dir` is a readable directory. */
export async function requireDir(dir: string): Promise<void> {
  await fsCall(dir, async () => {
    if (!(await stat(dir)).isDirectory()) throw new ApiFailure(400, 'NOT_A_DIRECTORY', 'expected a directory', dir)
  })
}

/** Immediate child directories of `dir` (no dot-dirs / node_modules), sorted case-insensitively. */
export async function listDirs(dir: string): Promise<DirEntry[]> {
  await requireDir(dir)
  return fsCall(dir, async () => {
    const entries = await readdir(dir, { withFileTypes: true })
    return entries
      .filter((e) => e.isDirectory() && !isSkipped(e.name))
      .map((e) => ({ name: e.name, path: path.join(dir, e.name) }))
      .sort(byNameCi)
  })
}

/**
 * Recursive tree of vault files (`.md`/`.markdown`/`.base`, each tagged with its `kind`) under
 * `dir`. Dirs first, then files, each sorted case-insensitively; every dir shows even with no
 * vault file beneath, so freshly created folders are visible (GRO-2022 D1). Unreadable subdirs
 * are skipped.
 */
export async function buildTree(dir: string): Promise<TreeNode[]> {
  const entries = await readdir(dir, { withFileTypes: true })
  const dirs: TreeNode[] = []
  const files: TreeNode[] = []
  await Promise.all(
    entries.map(async (e) => {
      if (isSkipped(e.name)) return
      const full = path.join(dir, e.name)
      if (e.isDirectory()) {
        const children = await buildTree(full).catch(() => null)
        if (children !== null) dirs.push({ type: 'dir', name: e.name, path: full, children })
      } else if (e.isFile()) {
        const kind = fileKind(e.name)
        if (kind === null) return
        const st = await stat(full).catch(() => undefined)
        if (st) files.push({ type: 'file', name: e.name, path: full, size: st.size, mtime: st.mtimeMs, kind })
      }
    }),
  )
  return [...dirs.sort(byNameCi), ...files.sort(byNameCi)]
}

/** Writes `content` to `<file>.tmp-<rand>` then renames over `file`. Parent dir must exist. */
export async function atomicWrite(file: string, content: string): Promise<{ mtime: number; size: number }> {
  const tmp = `${file}.tmp-${randomBytes(6).toString('hex')}`
  try {
    await writeFile(tmp, content, 'utf8')
    await rename(tmp, file)
  } catch (err) {
    await unlink(tmp).catch(() => undefined)
    throw err
  }
  const st = await stat(file)
  return { mtime: st.mtimeMs, size: st.size }
}
