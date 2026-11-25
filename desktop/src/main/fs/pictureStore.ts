/**
 * THE PICTURE STORE'S HALF OF THE DRAWING DOORS (`fs/drawing.ts`): the one parse of a scene, the folders a board's
 * pictures sit in, and the one extraction with its landing (`liftEmbedded` + `landAssets`). Settings › Storage's worker
 * (`storageWorker.ts`: `fs/shrink.ts`) imports this, never `drawing.ts`: a save's board ID (4C) pulls the vault index and
 * its `yaml` parser into `drawing.ts`, and the worker uses none of it (YAZ-4071 7B: 21 KB had become 276 KB).
 */
import { link, mkdir, readdir, readFile, rename, unlink } from 'node:fs/promises'
import path from 'node:path'
import type { DrawingFileEntry } from '@shared/types'
import { isRecord } from '@shared/guards'
import { ASSETS_DIR, assetFileName, createdOf, fileIdOfAssetName, isValidFileId, mimeForAssetExt, parseDataUrl, referencedFileIds, stripEmbeddedScene, type EmbeddedFile } from '@shared/drawingAssets'
import { withSuppressedEdit } from './externalEditSuppress'
import { BridgeFailure, fsCall, tmpSibling, writeDurable } from './fsUtils'

/**
 * THE ONE PARSE of a scene (YAZ-2073 5G), and its check: the OUTLINE only (see the module doc), an
 * object carrying an `elements` array. `code` differs by door — a bad file is the disk's fault
 * (`IO_ERROR`), a bad `json` argument is the caller's (`BAD_REQUEST`).
 */
export function parseScene(json: string, file: string, code: 'IO_ERROR' | 'BAD_REQUEST'): { scene: Record<string, unknown>; elements: readonly unknown[] } {
  const bad = (): never => {
    throw new BridgeFailure(code, code === 'IO_ERROR' ? 'file is not an Excalidraw scene' : "'json' is not an Excalidraw scene", { path: file })
  }
  let parsed: unknown
  try {
    parsed = JSON.parse(json)
  } catch {
    return bad()
  }
  if (!isRecord(parsed)) return bad()
  return Array.isArray(parsed.elements) ? { scene: parsed, elements: parsed.elements } : bad()
}

/**
 * The folders a board's pictures may sit in, in the order a read looks (YAZ-3943 demo round 3): the board's own
 * `folder` (vault-relative with `/` separators, or absolute for one outside the vault; validated by
 * `picturesFolderOf`) when it has one, then `<dir>/assets/`. The FIRST is also where a write lands (`landAssets`).
 */
export function storesOf(dir: string, folder: string | null): string[] {
  const assets = path.join(dir, ASSETS_DIR)
  return folder === null ? [assets] : [path.isAbsolute(folder) ? path.resolve(folder) : path.join(dir, ...folder.split('/')), assets]
}

/** One asset to land: validated shape, resolved name, decoded bytes. */
export interface PendingAsset {
  fileId: string
  name: string
  bytes: Buffer
}

/**
 * THE ONE EXTRACTION (Draw's YAZ-1801 D5): a scene's lean text, and the embedded pictures that must
 * land in `assets/` before it. `drawing:save` uses it (a legacy board shrinks on its first save);
 * Settings › Storage's "Move pictures out" (`fs/shrink.ts`) shares it, so the two can never
 * disagree about which bytes survive.
 *
 * Only pictures the scene still REFERENCES are lifted — an embedded entry no live element uses is
 * dropped with the `files` map, never written to the store (it would be an orphan the day it
 * lands). An entry whose dataURL is not base64, or whose mime the store does not keep, is dropped
 * the same way: the engine could not have drawn it either. `exclude` is what the caller already
 * has in hand (the renderer's `newFiles` on a save), so nothing is decoded twice.
 *
 * Works on the parsed scene (YAZ-2073 5G): both callers parsed and validated it already, and
 * serialize the lean result once, with `serializeBoard`.
 */
export function liftEmbedded(scene: Record<string, unknown>, elements: readonly unknown[], exclude: ReadonlySet<string> = new Set()): { lean: Record<string, unknown>; lifted: PendingAsset[] } {
  const { lean, embedded } = stripEmbeddedScene(scene)
  const referenced = referencedFileIds(elements)
  const lifted: PendingAsset[] = []
  for (const [fileId, entry] of Object.entries(embedded)) {
    if (!referenced.has(fileId) || !isValidFileId(fileId) || exclude.has(fileId)) continue
    const data = parseDataUrl(entry.dataURL)
    const name = assetFileName(fileId, entry.mimeType)
    if (data === null || name === null) continue
    lifted.push({ fileId, name, bytes: Buffer.from(data.base64, 'base64') })
  }
  return { lean, lifted }
}

/**
 * Write each asset durably into `<dir>/assets/` — or into the board's own `folder` (demo round 3), made on the
 * way — and answer the ids now in the store. The other half of the one door `liftEmbedded` opens; a failure
 * rejects as a `BridgeFailure` naming the path.
 *
 * The name IS the content hash, so a torn file under it would pass for valid forever. The bytes land
 * on a tmp sibling, are fsynced, and only then `link`ed to the name (YAZ-2073 2B1): a crash at any
 * point leaves at most a tmp file (`isAtomicTmp`: never listed, never committed). `link` never replaces — EEXIST means identical bytes already landed, which is success. Any
 * other refusal (a volume without hard links, exFAT or FAT, says ENOTSUP) renames instead;
 * replacing identical bytes is harmless there.
 */
export async function landAssets(dir: string, pending: readonly PendingAsset[], folder: string | null = null): Promise<string[]> {
  const persisted: string[] = []
  if (pending.length === 0) return persisted
  const [store] = storesOf(dir, folder)
  await fsCall(store, () => mkdir(store, { recursive: true }))
  for (const asset of pending) {
    const to = path.join(store, asset.name)
    const tmp = tmpSibling(to)
    await withSuppressedEdit(to, () =>
      fsCall(to, async () => {
        try {
          await writeDurable(tmp, asset.bytes, 'wx')
          await link(tmp, to).catch((err: NodeJS.ErrnoException) => {
            if (err.code !== 'EEXIST') return rename(tmp, to)
          })
        } finally {
          await unlink(tmp).catch(() => undefined)
        }
      }),
    )
    persisted.push(asset.fileId)
  }
  return persisted
}

/** One store folder as a map fileId → file name (first match wins); an absent folder is an empty store. */
async function listStore(store: string): Promise<Map<string, string>> {
  const found = new Map<string, string>()
  const names = await readdir(store).catch(() => [] as string[])
  // Sorted so a duplicate id spelled two ways (`x.png` and `x.jpg`) always resolves to the same one.
  for (const name of names.sort()) {
    const id = fileIdOfAssetName(name)
    const ext = name.slice(name.lastIndexOf('.') + 1)
    if (id === null || mimeForAssetExt(ext) === null || found.has(id)) continue
    found.set(id, name)
  }
  return found
}

/**
 * The bytes the stores hold for `ids` — the board's own `folder` first, then `assets/` (`storesOf`); an id with no
 * readable bytes in either is absent (the placeholder, not a failed open).
 */
export async function fromStore(dir: string, ids: readonly string[], folder: string | null): Promise<Record<string, DrawingFileEntry>> {
  const found: Record<string, DrawingFileEntry> = {}
  if (ids.length === 0) return found
  for (const store of storesOf(dir, folder)) {
    const names = await listStore(store)
    for (const id of ids) {
      const name = names.get(id)
      if (name === undefined || found[id] !== undefined) continue
      const mimeType = mimeForAssetExt(name.slice(name.lastIndexOf('.') + 1))
      const bytes = await readFile(path.join(store, name)).catch(() => null)
      if (bytes !== null && mimeType !== null) found[id] = { mimeType, dataURL: `data:${mimeType};base64,${bytes.toString('base64')}` }
    }
  }
  return found
}

/**
 * The pictures a scene references, from the board's own `folder` and the vault's `assets/` store — with a
 * legacy scene's own `embedded` entries as the fallback. Shared by `drawing:load` and Version history's old
 * versions (Draw's YAZ-1897 D4; `git/history.ts`), so an old version draws its pictures the way the open board does.
 */
export async function resolveFiles(dir: string, embedded: Record<string, DrawingFileEntry>, elements: readonly unknown[], folder: string | null = null): Promise<{ files: Record<string, DrawingFileEntry>; stored: string[] }> {
  const ids = [...referencedFileIds(elements)].sort()
  const found = await fromStore(dir, ids, folder)
  const files: Record<string, DrawingFileEntry> = {}
  const stored: string[] = []
  for (const id of ids) {
    if (found[id] !== undefined) {
      files[id] = found[id]
      stored.push(id)
    } else if (embedded[id] !== undefined) files[id] = embedded[id]
  }
  return { files, stored }
}

/**
 * The pictures an "inside" board carries (YAZ-3943 D5): each one a live element uses, from the
 * first of `sources` that has it, else from the board's `folder` or `assets/` (an old board takes its
 * pictures inside this way), engine-shaped and sorted by id. `created` stays as `prior` (the file as it
 * is) has it, so an untouched save writes the same bytes. An id found nowhere stays out, as on a load.
 */
export async function embedPictures(dir: string, elements: readonly unknown[], sources: readonly Record<string, DrawingFileEntry>[], prior: Record<string, unknown> | null, folder: string | null = null): Promise<Record<string, EmbeddedFile>> {
  const ids = [...referencedFileIds(elements)].sort()
  const found = (id: string): DrawingFileEntry | undefined => sources.find((s) => s[id] !== undefined)?.[id]
  const stored = await fromStore(dir, ids.filter((id) => found(id) === undefined), folder)
  const now = Date.now()
  const files: Record<string, EmbeddedFile> = {}
  for (const id of ids) {
    const entry = found(id) ?? stored[id]
    if (entry !== undefined) files[id] = { mimeType: entry.mimeType, id, dataURL: entry.dataURL, created: (prior === null ? null : createdOf(prior, id)) ?? now }
  }
  return files
}
