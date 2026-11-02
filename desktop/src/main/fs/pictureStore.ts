/**
 * THE PICTURE STORE'S HALF OF THE DRAWING DOORS (`fs/drawing.ts`): the one parse of a scene, the folders a board's
 * pictures sit in, and the one extraction with its landing (`liftEmbedded` + `landAssets`). Settings › Storage's worker
 * (`storageWorker.ts`: `fs/shrink.ts`) imports this, never `drawing.ts`: a save's board ID (4C) pulls the vault index and
 * its `yaml` parser into `drawing.ts`, and the worker uses none of it (YAZ-4071 7B: 21 KB had become 276 KB).
 */
import { link, mkdir, rename, unlink } from 'node:fs/promises'
import path from 'node:path'
import { isRecord } from '@shared/guards'
import { ASSETS_DIR, assetFileName, isValidFileId, parseDataUrl, referencedFileIds, stripEmbeddedScene } from '@shared/drawingAssets'
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
    await fsCall(to, async () => {
      try {
        await writeDurable(tmp, asset.bytes, 'wx')
        await link(tmp, to).catch((err: NodeJS.ErrnoException) => {
          if (err.code !== 'EEXIST') return rename(tmp, to)
        })
      } finally {
        await unlink(tmp).catch(() => undefined)
      }
    })
    persisted.push(asset.fileId)
  }
  return persisted
}
