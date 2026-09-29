import { randomBytes } from 'node:crypto'
import { link, open, readdir, rename, stat, unlink } from 'node:fs/promises'
import path from 'node:path'
import type { BridgeError, FileKind, TreeNode } from '@shared/types'
import { ATOMIC_TMP_HEX_LEN, fileKind, isAtomicTmp, isMarkdown, isSupportedFile } from '@shared/fileKind'

export { isMarkdown, isSupportedFile } from '@shared/fileKind'

/**
 * Thrown by the fs layer; `ipc/envelope.ts` turns it into the `BridgeError` the renderer sees.
 * Carries a `BridgeError` code plus the optional `path` / `mtime` the renderer shows.
 */
export class BridgeFailure extends Error {
  readonly path?: string
  /** Current on-disk mtime; only on `CONFLICT`. */
  readonly mtime?: number
  constructor(
    readonly code: BridgeError['code'],
    message: string,
    extra: { path?: string; mtime?: number } = {},
  ) {
    super(message)
    this.path = extra.path
    this.mtime = extra.mtime
  }
}

function isSafeAbsPath(p: unknown): p is string {
  return typeof p === 'string' && path.isAbsolute(p) && !p.includes('\0')
}

/** Validates + normalises a path argument, throwing BAD_REQUEST / NOT_ABSOLUTE when missing/relative. */
export function requireAbsPath(p: unknown, param: string): string {
  if (p === undefined || p === '') {
    throw new BridgeFailure('BAD_REQUEST', `missing '${param}'`)
  }
  if (!isSafeAbsPath(p)) {
    throw new BridgeFailure('NOT_ABSOLUTE', `'${param}' must be an absolute path`, { path: String(p) })
  }
  return path.resolve(p)
}

/** Throws unless `p` has the only editable/creatable extension kind. */
export function requireMarkdownFile(p: string): void {
  if (!isMarkdown(p)) throw new BridgeFailure('UNSUPPORTED_EXTENSION', 'only .md/.markdown files are editable', { path: p })
}

/** Returns the kind for files that can cross the UTF-8 text bridge. PDFs use their own binary bridge. */
export function requireTextReadableFile(p: string): Extract<FileKind, 'markdown' | 'text'> {
  const kind = fileKind(p)
  if (kind !== 'markdown' && kind !== 'text') {
    throw new BridgeFailure('UNSUPPORTED_EXTENSION', 'only Markdown and supported text files can be read as text', { path: p })
  }
  return kind
}

/** Dot-entries and node_modules are invisible to every call. */
export function isSkipped(name: string): boolean {
  return name.startsWith('.') || name === 'node_modules'
}

export function byNameCi<T extends { name: string }>(a: T, b: T): number {
  return a.name.toLowerCase().localeCompare(b.name.toLowerCase())
}

function errnoCode(err: unknown): string | undefined {
  return typeof err === 'object' && err !== null && 'code' in err ? String(err.code) : undefined
}

/** Maps a Node fs error to a BridgeFailure for `p`. */
export function toBridgeFailure(err: unknown, p: string): BridgeFailure {
  if (err instanceof BridgeFailure) return err
  switch (errnoCode(err)) {
    case 'ENOENT':
      return new BridgeFailure('NOT_FOUND', 'path does not exist', { path: p })
    case 'EACCES':
    case 'EPERM':
      return new BridgeFailure('FORBIDDEN', 'permission denied', { path: p })
    case 'ENOTDIR':
      return new BridgeFailure('NOT_A_DIRECTORY', 'expected a directory', { path: p })
    case 'EEXIST':
      return new BridgeFailure('ALREADY_EXISTS', 'path already exists', { path: p })
    case 'EISDIR':
      return new BridgeFailure('NOT_A_FILE', 'expected a file', { path: p })
    default:
      return new BridgeFailure('IO_ERROR', err instanceof Error ? err.message : String(err), { path: p })
  }
}

/**
 * A per-root promise chain: `chained(root, fn)` runs `fn` after everything chained on that root
 * before it, settled or not, so read-modify-writes on one root never interleave.
 */
export function createRootChain(): <T>(root: string, fn: () => Promise<T>) => Promise<T> {
  const chains = new Map<string, Promise<unknown>>()
  return <T>(root: string, fn: () => Promise<T>): Promise<T> => {
    const run = (chains.get(root) ?? Promise.resolve()).then(fn, fn)
    chains.set(
      root,
      run.then(
        () => undefined,
        () => undefined,
      ),
    )
    return run
  }
}

/** Runs `fn`, converting any fs error into a BridgeFailure attributed to `p`. */
export async function fsCall<T>(p: string, fn: () => Promise<T>): Promise<T> {
  try {
    return await fn()
  } catch (err) {
    throw toBridgeFailure(err, p)
  }
}

/** Throws NOT_FOUND / FORBIDDEN / NOT_A_DIRECTORY unless `dir` is a readable directory. */
export async function requireDir(dir: string): Promise<void> {
  await fsCall(dir, async () => {
    if (!(await stat(dir)).isDirectory()) throw new BridgeFailure('NOT_A_DIRECTORY', 'expected a directory', { path: dir })
  })
}

/**
 * Recursive tree of every regular file under `dir`, each carrying its preview `kind` (`null` = no
 * in-app viewer, YAZ-1577 D1). Dirs first, then files, each sorted case-insensitively; every dir
 * shows even when empty, so freshly created folders are visible (GRO-2022 D1). Dot-entries,
 * `node_modules` and crash-left atomic-write tmps (`isAtomicTmp`, YAZ-2179) are skipped;
 * unreadable subdirs are skipped.
 */
export async function buildTree(dir: string): Promise<TreeNode[]> {
  const entries = await readdir(dir, { withFileTypes: true })
  const dirs: TreeNode[] = []
  const files: TreeNode[] = []
  await Promise.all(
    entries.map(async (e) => {
      if (isSkipped(e.name) || isAtomicTmp(e.name)) return
      const full = path.join(dir, e.name)
      if (e.isDirectory()) {
        const children = await buildTree(full).catch(() => null)
        if (children !== null) dirs.push({ type: 'dir', name: e.name, path: full, children })
      } else if (e.isFile()) {
        const st = await stat(full).catch(() => undefined)
        if (st) files.push({ type: 'file', name: e.name, path: full, size: st.size, mtime: st.mtimeMs, kind: fileKind(e.name) })
      }
    }),
  )
  return [...dirs.sort(byNameCi), ...files.sort(byNameCi)]
}

/**
 * Opens, writes and fsyncs before closing (YAZ-2177; libuv issues F_FULLFSYNC on macOS): the bytes
 * are on disk before a rename or link gives them a real name, so a crash or power loss can't
 * surface an empty or torn note, state file or image under it. A string lands as UTF-8; bytes (an
 * image through `writeAsset`, YAZ-1661) land verbatim — `writeFile` ignores the encoding for a view.
 */
async function writeDurable(file: string, content: string | Uint8Array, flag: 'w' | 'wx'): Promise<void> {
  const fh = await open(file, flag)
  try {
    await fh.writeFile(content, 'utf8')
    await fh.sync()
  } finally {
    await fh.close()
  }
}

/** The sibling a write lands in before it takes `file`'s name: same dir, so the rename or link is atomic. */
function tmpSibling(file: string): string {
  return `${file}.tmp-${randomBytes(ATOMIC_TMP_HEX_LEN / 2).toString('hex')}`
}

/** Writes `content` durably to a tmp sibling then renames it over `file`. Parent dir must exist. */
export async function atomicWrite(file: string, content: string | Uint8Array): Promise<{ mtime: number; size: number }> {
  const tmp = tmpSibling(file)
  try {
    await writeDurable(tmp, content, 'w')
    await rename(tmp, file)
  } catch (err) {
    await unlink(tmp).catch(() => undefined)
    throw err
  }
  const st = await stat(file)
  return { mtime: st.mtimeMs, size: st.size }
}

/**
 * Creates `file` durably and never over anything (YAZ-2177): a fsynced tmp sibling is `link`ed to
 * the name, and `link` refuses an existing one with EEXIST exactly like the `wx` write it replaces,
 * so callers still answer ALREADY_EXISTS (and `writeImage` still picks the next suffix). A volume
 * without hard links (exFAT/FAT) gets a fsynced `wx` write straight onto the name instead: still
 * never over anything — a rename could replace a file created in between. Parent dir must exist.
 */
export async function createDurable(file: string, content: string | Uint8Array): Promise<void> {
  const tmp = tmpSibling(file)
  try {
    await writeDurable(tmp, content, 'wx')
    try {
      await link(tmp, file)
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'EEXIST') throw err
      await writeDurable(file, content, 'wx')
    }
  } finally {
    await unlink(tmp).catch(() => undefined)
  }
}
