import { mkdir, readFile, readdir, stat, writeFile } from 'node:fs/promises'
import path from 'node:path'
import type { AssetResponse, AssetWriteRequest, AssetWriteResponse } from '@shared/types'
import { DRAWING_EXTENSIONS, IMAGE_EXTENSIONS, MAX_FILE_BYTES } from '@shared/types'
import { linkTarget } from '../vaultIndex/scan'
import { atomicWrite, BridgeFailure, byNameCi, fsCall, isSkipped, requireAbsPath, requireDir } from './fsUtils'

/**
 * `window.yaseenDocs.readAsset(root, ref)` / `.writeAsset(req)` (Bases 4E, GRO-2139 — Desktop
 * D10: bridge methods, never routes): the vault's ASSET pipe. Reads resolve a wikilink target or
 * path to a local image or drawing under `root` and answer its bytes base64-encoded with a mime
 * derived from the extension; writes are drawings only (YAZ-876). Pure Node, no Electron import.
 *
 * Assets use this dedicated pipe instead of the supported-file discovery/read capabilities;
 * `.excalidraw` sidecars therefore stay out of the tree, index, and watcher.
 */

const MIME: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
  svg: 'image/svg+xml',
  avif: 'image/avif',
  bmp: 'image/bmp',
  // Excalidraw scene JSON (YAZ-852): a drawing is a JSON document, not an image.
  excalidraw: 'application/json',
}

const READABLE: readonly string[] = [...IMAGE_EXTENSIONS, ...DRAWING_EXTENSIONS]

/**
 * Obsidian's shortest-path rule, deterministically: breadth-first over the tree (a shallower
 * match always wins), each directory's entries sorted case-insensitively, dot-entries and
 * `node_modules` skipped like every other fs call. First case-insensitive basename match wins.
 */
async function findByBasename(root: string, basename: string): Promise<string | null> {
  const want = basename.toLowerCase()
  let level: string[] = [root]
  while (level.length > 0) {
    const next: string[] = []
    for (const dir of level) {
      const dirents = (await readdir(dir, { withFileTypes: true }).catch(() => [])).filter((e) => !isSkipped(e.name)).sort(byNameCi)
      for (const e of dirents) {
        if (e.isFile() && e.name.toLowerCase() === want) return path.join(dir, e.name)
      }
      for (const e of dirents) {
        if (e.isDirectory()) next.push(path.join(dir, e.name))
      }
    }
    level = next
  }
  return null
}

export async function readAsset(root: string, ref: string): Promise<AssetResponse> {
  const dir = requireAbsPath(root, 'root')
  if (typeof ref !== 'string') throw new BridgeFailure('BAD_REQUEST', "missing 'ref'")
  const target = linkTarget(ref)
  if (target === '') throw new BridgeFailure('BAD_REQUEST', "missing 'ref'")
  const ext = path.extname(target).slice(1).toLowerCase()
  const mime = MIME[ext]
  if (mime === undefined || !READABLE.includes(ext)) {
    throw new BridgeFailure('UNSUPPORTED_EXTENSION', 'only image and drawing files are served as assets', { path: target })
  }
  await requireDir(dir)
  let file: string | null = null
  if (target.includes('/')) {
    const rel = path.resolve(dir, target)
    // The vault's edge holds on READS too (YAZ-876 sealed a pre-existing GRO-2139 gap): a ref
    // resolving outside `root` never reaches disk — it falls through to the basename search
    // below, which walks only the tree and so cannot leave it.
    if (rel.startsWith(dir + path.sep)) {
      const st = await stat(rel).catch(() => undefined)
      if (st?.isFile()) file = rel
    }
  }
  if (file === null) file = await findByBasename(dir, path.basename(target))
  if (file === null) throw new BridgeFailure('NOT_FOUND', 'no asset with this name under the root', { path: target })
  const found = file
  return fsCall(found, async () => {
    const st = await stat(found)
    if (st.size > MAX_FILE_BYTES) throw new BridgeFailure('TOO_LARGE', `file exceeds ${MAX_FILE_BYTES} bytes`, { path: found })
    // `mtime` rides along for `writeAsset`'s `expectedMtime` (YAZ-879): the read that produced
    // the bytes is the only honest place to take the guard from.
    return { path: found, mime, data: (await readFile(found)).toString('base64'), size: st.size, mtime: st.mtimeMs }
  })
}

/**
 * Resolves a vault-relative (or absolute-under-root) write target and REFUSES anything that
 * lands outside `dir`. Reads may roam the tree by basename; a write never leaves the vault.
 */
function resolveUnderRoot(dir: string, rel: string): string {
  const p = path.resolve(dir, rel)
  if (!p.startsWith(dir + path.sep)) throw new BridgeFailure('BAD_REQUEST', 'path escapes the vault root', { path: rel })
  return p
}

/**
 * `window.yaseenDocs.writeAsset(req)` — the write half of the asset pipe (YAZ-876, first build
 * unit of the Excalidraw embed YAZ-852). DRAWINGS ONLY: images arrive by other means, so write
 * access to them is deliberately not widened here. The target is an EXPLICIT path — writes are
 * never fuzzy, so `readAsset`'s basename search has no counterpart. Write semantics are
 * `file.ts`'s: atomic tmp+rename, `expectedMtime` → `CONFLICT` with nothing written, and
 * `create` for `createFile`'s never-overwrite `wx`. The request crosses IPC from a sandboxed
 * renderer, so its shape is checked like a request body, not trusted from the type.
 */
export async function writeAsset(req: AssetWriteRequest): Promise<AssetWriteResponse> {
  const raw: unknown = req
  if (typeof raw !== 'object' || raw === null) throw new BridgeFailure('BAD_REQUEST', 'request must be an object')
  const { root, path: rel, content, expectedMtime, create } = raw as Record<string, unknown>
  const dir = requireAbsPath(root, 'root')
  if (typeof rel !== 'string' || rel.trim() === '' || rel.includes('\0')) throw new BridgeFailure('BAD_REQUEST', "missing 'path'")
  const file = resolveUnderRoot(dir, rel)
  const ext = path.extname(file).slice(1).toLowerCase()
  if (!(DRAWING_EXTENSIONS as readonly string[]).includes(ext)) {
    throw new BridgeFailure('UNSUPPORTED_EXTENSION', 'only drawing files can be written as assets', { path: file })
  }
  if (typeof content !== 'string') throw new BridgeFailure('BAD_REQUEST', "'content' must be a string", { path: file })
  if (Buffer.byteLength(content, 'utf8') > MAX_FILE_BYTES) throw new BridgeFailure('TOO_LARGE', `content exceeds ${MAX_FILE_BYTES} bytes`, { path: file })
  if (expectedMtime !== undefined && typeof expectedMtime !== 'number') {
    throw new BridgeFailure('BAD_REQUEST', "'expectedMtime' must be a number", { path: file })
  }
  if (create !== undefined && typeof create !== 'boolean') throw new BridgeFailure('BAD_REQUEST', "'create' must be a boolean", { path: file })
  await requireDir(dir)
  if (expectedMtime !== undefined) {
    const st = await stat(file).catch(() => undefined)
    if (st !== undefined && st.mtimeMs !== expectedMtime) {
      throw new BridgeFailure('CONFLICT', 'drawing changed on disk since last read', { path: file, mtime: st.mtimeMs })
    }
  }
  return fsCall(file, async () => {
    // A drawing's home (`assets/drawings/` by default) is made on the way — unlike `writeFile`,
    // whose parent must already exist: the first drawing in a vault has no folder to write into.
    await mkdir(path.dirname(file), { recursive: true })
    if (create === true) {
      await writeFile(file, content, { flag: 'wx' }) // EEXIST → ALREADY_EXISTS, exactly like createFile
      const st = await stat(file)
      return { path: file, mtime: st.mtimeMs, size: st.size }
    }
    return { path: file, ...(await atomicWrite(file, content)) }
  })
}
