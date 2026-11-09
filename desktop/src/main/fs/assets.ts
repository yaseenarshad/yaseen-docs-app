import { mkdir, readdir, stat } from 'node:fs/promises'
import path from 'node:path'
import type { AssetResponse, AssetWriteRequest, AssetWriteResponse } from '@shared/types'
import { DRAWING_EXTENSIONS, IMAGE_EXTENSIONS, MAX_FILE_BYTES } from '@shared/types'
import { linkTarget } from '../vaultIndex/scan'
import { atomicWrite, BridgeFailure, byNameCi, createDurable, fsCall, isSkipped, requireAbsPath, requireDir, resolveUnderRoot } from './fsUtils'
import { requireRequest } from './validate'
import { readBoundedRegularFile } from './boundedRead'
import { revisionOf, serializeFile } from './revision'
import { parseScene } from './pictureStore'

/**
 * `window.yaseenDocs.readAsset(root, ref)` / `.writeAsset(req)` (Bases 4E, GRO-2139 — Desktop
 * D10: bridge methods, never routes): the vault's ASSET pipe. Reads resolve a wikilink target or
 * path to a local image or drawing under `root` and answer its bytes base64-encoded with a mime
 * derived from the extension; writes take drawing JSON (YAZ-876) or image bytes (YAZ-1661).
 * Pure Node, no Electron import — `resolveAsset` and `mimeFor` are shared with the `app://vault`
 * image protocol (`main/vaultProtocol.ts`, YAZ-1658), which is why they are exported.
 *
 * Assets use this dedicated pipe instead of the supported-file read capabilities: neither kind is
 * a supported file, so a `.excalidraw` sidecar or a pasted image lists in the tree with
 * `kind: null` (YAZ-1577 D4), stays out of the Markdown index, and opens in the OS default app.
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

/** The asset pipe's one MIME table, by extension without the dot (any case); unknown → undefined. */
export function mimeFor(ext: string): string | undefined {
  return MIME[ext.toLowerCase()]
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

/** `rel` resolved against `dir` when it is a regular file INSIDE the vault; null for an escape or a miss. */
async function existingUnderRoot(dir: string, ...rel: string[]): Promise<string | null> {
  const p = path.resolve(dir, ...rel)
  // The vault's edge holds on READS too (YAZ-876 sealed a pre-existing GRO-2139 gap): a ref
  // resolving outside `root` never reaches disk — it falls through to the basename search,
  // which walks only the tree and so cannot leave it.
  if (!p.startsWith(dir + path.sep)) return null
  const st = await stat(p).catch(() => undefined)
  return st?.isFile() ? p : null
}

/**
 * Obsidian's link resolution order (YAZ-1658, YAZ-1656 D1), shared by `readAsset` and the `app://vault`
 * image protocol: (1) relative to the linking note's directory `from` when given — a note's own
 * `./pic.png` must beat a same-named file elsewhere; (2) relative to the root; (3) the
 * shortest-path basename walk above. Steps 1 and 2 require a REGULAR FILE inside the vault;
 * anything escaping `root` skips to the walk, which cannot leave it. `root` is absolute and
 * `target` is the bare link target (alias / heading already stripped). Null = nothing found.
 * Extension policy is the caller's: this only says WHERE a name lands.
 */
export async function resolveAsset(root: string, target: string, from?: string): Promise<string | null> {
  if (target === '') return null
  if (from !== undefined) {
    const viaNote = await existingUnderRoot(root, from, target)
    if (viaNote !== null) return viaNote
  }
  return (await existingUnderRoot(root, target)) ?? findByBasename(root, path.basename(target))
}

export async function readAsset(root: string, ref: string, includeRevision = false): Promise<AssetResponse & { revision?: string }> {
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
  const file = await resolveAsset(dir, target)
  if (file === null) throw new BridgeFailure('NOT_FOUND', 'no asset with this name under the root', { path: target })
  return readAssetFile(file, includeRevision)
}

/** Exact paths from automation must not be parsed as wikilinks or fall back to another basename. */
export async function readAssetFile(file: string, includeRevision = false): Promise<AssetResponse & { revision?: string }> {
  const found = requireAbsPath(file, 'path'), ext = path.extname(found).slice(1).toLowerCase()
  const mime = MIME[ext]
  if (mime === undefined || !READABLE.includes(ext)) throw new BridgeFailure('UNSUPPORTED_EXTENSION', 'only image and drawing files are served as assets', { path: found })
  return fsCall(found, async () => {
    const snapshot = await readBoundedRegularFile(found, MAX_FILE_BYTES, `file exceeds ${MAX_FILE_BYTES} bytes`)
    // `mtime` rides along for `writeAsset`'s `expectedMtime` (YAZ-879): the read that produced
    // the bytes is the only honest place to take the guard from.
    return { path: found, mime, data: snapshot.data.toString('base64'), size: snapshot.size, mtime: snapshot.mtime, ...(includeRevision ? { revision: revisionOf(snapshot.data, snapshot.mtime) } : {}) }
  })
}

/**
 * `window.yaseenDocs.writeAsset(req)` — the write half of the asset pipe (YAZ-876, first build
 * unit of the Excalidraw embed YAZ-852; widened to image bytes by YAZ-1661, images-as-first-
 * class-citizens YAZ-1656 D5). THE BODY'S TYPE PICKS THE FILE KIND: a string is scene JSON and
 * may only land on a `DRAWING_EXTENSIONS` path; bytes are an image and may only land on an
 * `IMAGE_EXTENSIONS` path — a string `.png` or a byte `.excalidraw` is `UNSUPPORTED_EXTENSION`,
 * because a text body can never be a valid PNG and the mismatch is always a caller bug worth
 * surfacing. The target is an EXPLICIT path — writes are never fuzzy, so `readAsset`'s basename
 * search has no counterpart. Write semantics are `file.ts`'s: atomic tmp+rename, `expectedMtime`
 * → `CONFLICT` with nothing written, and `create` for `createFile`'s never-overwrite `wx`. The
 * request crosses IPC from a sandboxed renderer, so its shape is checked like a request body,
 * not trusted from the type. So is its content (YAZ-4571): a drawing must parse as a scene, as
 * `drawing:save` demands, and picture bytes must carry a picture's header (`isPicture`).
 */
export async function writeAsset(req: AssetWriteRequest & { expectedRevision?: string }): Promise<AssetWriteResponse> {
  const body = requireRequest(req)
  const root = requireAbsPath(body.root, 'root')
  if (typeof body.path !== 'string' || body.path.trim() === '' || body.path.includes('\0')) throw new BridgeFailure('BAD_REQUEST', "missing 'path'")
  const file = resolveUnderRoot(root, body.path)
  return serializeFile(file, () => writeAssetUnlocked(req))
}

/**
 * The headers of the `IMAGE_EXTENSIONS` formats, read as latin1 (one char per byte). A raster name takes any raster
 * header: the app names a paste by the system's MIME type, which can disagree with the bytes, and the browser
 * shows such a file anyway (a pasted .ico saves as .png, YAZ-4600). An SVG is text, so it needs an `<svg` element.
 */
const RASTER_HEAD = /^(?:\x89PNG\r\n\x1a\n|\xff\xd8\xff|GIF8|RIFF[^]{4}WEBP|[^]{4}ftyp|BM|\x00\x00[\x01\x02]\x00)/
function isPicture(ext: string, bytes: Uint8Array): boolean {
  const buf = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  return ext === 'svg' ? buf.includes('<svg') : RASTER_HEAD.test(buf.toString('latin1', 0, 12))
}

async function writeAssetUnlocked(req: AssetWriteRequest & { expectedRevision?: string }): Promise<AssetWriteResponse> {
  const { root, path: rel, content, expectedMtime, expectedRevision, create } = requireRequest(req)
  const dir = requireAbsPath(root, 'root')
  if (typeof rel !== 'string' || rel.trim() === '' || rel.includes('\0')) throw new BridgeFailure('BAD_REQUEST', "missing 'path'")
  const file = resolveUnderRoot(dir, rel)
  const ext = path.extname(file).slice(1).toLowerCase()
  let body: string | Uint8Array
  if (typeof content === 'string') {
    if (!(DRAWING_EXTENSIONS as readonly string[]).includes(ext)) {
      throw new BridgeFailure('UNSUPPORTED_EXTENSION', 'a text body writes drawing files only', { path: file })
    }
    body = content
  } else if (ArrayBuffer.isView(content)) {
    if (!(IMAGE_EXTENSIONS as readonly string[]).includes(ext)) {
      throw new BridgeFailure('UNSUPPORTED_EXTENSION', 'a byte body writes image files only', { path: file })
    }
    // The preload hands the renderer's `Uint8Array` to `ipcRenderer.invoke` as-is and structured
    // clone delivers a typed-array view, so "bytes" is any ArrayBuffer view — a `Buffer` included
    // — taken over the view's OWN byte range: a `subarray` must land as its slice, not its
    // backing buffer.
    body = new Uint8Array(content.buffer, content.byteOffset, content.byteLength)
  } else {
    throw new BridgeFailure('BAD_REQUEST', "'content' must be a string or a Uint8Array", { path: file })
  }
  const size = typeof body === 'string' ? Buffer.byteLength(body, 'utf8') : body.byteLength
  if (size > MAX_FILE_BYTES) throw new BridgeFailure('TOO_LARGE', `content exceeds ${MAX_FILE_BYTES} bytes`, { path: file })
  if (typeof body === 'string') parseScene(body, file, 'BAD_REQUEST')
  else if (!isPicture(ext, body)) throw new BridgeFailure('BAD_REQUEST', ext === 'svg' ? 'the text is not an SVG picture' : 'the bytes are not a PNG, JPEG, GIF, WebP, AVIF, BMP or ICO picture', { path: file })
  if (expectedMtime !== undefined && typeof expectedMtime !== 'number') {
    throw new BridgeFailure('BAD_REQUEST', "'expectedMtime' must be a number", { path: file })
  }
  if (create !== undefined && typeof create !== 'boolean') throw new BridgeFailure('BAD_REQUEST', "'create' must be a boolean", { path: file })
  await requireDir(dir)
  // The mtime the checks accept, checked again right before the rename (YAZ-4576).
  let accepted = expectedMtime
  if (expectedRevision !== undefined) {
    if (typeof expectedRevision !== 'string' || create === true) throw new BridgeFailure('BAD_REQUEST', 'a saved revision requires a replacement')
    const snapshot = await readBoundedRegularFile(file, MAX_FILE_BYTES, `file exceeds ${MAX_FILE_BYTES} bytes`)
    if (revisionOf(snapshot.data, snapshot.mtime) !== expectedRevision) throw new BridgeFailure('CONFLICT', 'asset changed on disk since last read', { path: file, mtime: snapshot.mtime })
    accepted ??= snapshot.mtime
  }
  if (expectedMtime !== undefined) {
    const st = await stat(file).catch(() => undefined)
    if (st !== undefined && st.mtimeMs !== expectedMtime) {
      throw new BridgeFailure('CONFLICT', 'asset changed on disk since last read', { path: file, mtime: st.mtimeMs })
    }
  }
  return fsCall(file, async () => {
    // An asset's home (`assets/drawings/`, `assets/images/`) is made on the way — unlike
    // `writeFile`, whose parent must already exist: the first drawing or pasted image in a vault
    // has no folder to write into.
    await mkdir(path.dirname(file), { recursive: true })
    if (create === true) {
      await createDurable(file, body) // EEXIST → ALREADY_EXISTS, exactly like createFile
      const st = await stat(file)
      return { path: file, mtime: st.mtimeMs, size: st.size }
    }
    return { path: file, ...(await atomicWrite(file, body, undefined, accepted)) }
  })
}
