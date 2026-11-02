/**
 * THE DRAWING DOCUMENT'S TWO DOORS (Draw's 🔒 YAZ-1810, ported by YAZ-3028 D2).
 *
 * `drawing:load` and `drawing:save` are the ONLY way a `.excalidraw` opened AS A DOCUMENT reads
 * and writes. One door per DIRECTION, not one per artefact, because a scene and the image bytes
 * it names are ONE thing: a load is "the scene, then its images", a save is "the images, then the
 * scene", and splitting either across two calls would let a renderer land half of it — a scene on
 * disk naming bytes that are not there.
 *
 * The read ceiling is `MAX_DRAWING_BYTES` (200 MiB): a LEGACY scene — an upstream export, or one
 * an older build wrote — embeds its images as base64 and is routinely past 10 MiB before it has
 * been opened once. The cap exists to refuse a file that has stopped being a document, not to
 * police normal ones.
 *
 * THE SCENE IS VALIDATED HERE, not only in the renderer: a corrupt or empty `.excalidraw` comes
 * back as one `IO_ERROR` naming the path, which the editor shows as a readable error pane. The
 * check is deliberately the OUTLINE only (an object with an `elements` array) — the file is user
 * data, and the engine's own `restore()` is what decides whether those elements are a scene.
 *
 * Requests cross IPC from a sandboxed renderer, so their shape is checked like a request body,
 * never trusted from the type.
 *
 * PICTURES INSIDE BY DEFAULT (YAZ-3943 D5, which reverses 🔒 YAZ-1775 D3 "the vault file never
 * embeds"). A board keeps every picture a live element uses in its own `files` map, engine-shaped
 * (`{ mimeType, id, dataURL, created }`), so a board copied alone keeps its pictures. The renderer still
 * sends the small scene (`files: {}`) and only the pictures it has not sent before (`newFiles`), so
 * typing and drawing pay nothing for it: MAIN does the embed. A save reads the current file ONCE,
 * takes the pictures from it (an old board: from `assets/`), adds the new ones, drops the ones no
 * live element uses, and writes the whole file. The `assets/` copies stay; nothing deletes from it.
 * The 50 MB rule: a save that would make the file `PICTURES_INSIDE_MAX_BYTES` or bigger moves the
 * pictures out instead and says so (`movedOut`), so the renderer can show its notice.
 *
 * "PICTURES OUT" (`"pictures": "assets"` in the block; the cog's button, `fs/boardPictures.ts`) keeps
 * the old shape: the scene carries `files: {}`; image elements keep only their `fileId`; the
 * bytes sit at `<root>/assets/<fileId>.<ext>` (the engine's own SHA-1 id, the mime's extension) — or,
 * for a board whose block names its OWN folder (`picturesFolder`, YAZ-3943 demo round 3), at
 * `<root>/<folder>/<fileId>.<ext>` — the folder may be outside the vault, stored absolute: a read looks in
 * that folder first, then in `assets/` (pictures written there before the switch), then in the scene's own
 * `files`; a write lands in that folder, unless it is an outside folder the user never picked
 * (`landingFolder`, `fs/picturesFolders.ts`): then in `assets/`, where the read still finds it.
 * An asset is IMMUTABLE — the same bytes always get the same name — so a save never rewrites one
 * (tmp + fsync + `link`, which never replaces; EEXIST means it is already exactly these bytes). A
 * scene that still embeds `files` opens — its entries come back in `files`, and its `json`
 * without them, so the bytes cross the bridge once (🔒 YAZ-2073 D7); opening it writes nothing — and
 * a "pictures out" board SHRINKS on its next save:
 * `liftEmbedded` takes the referenced bytes out of the scene and `landAssets` writes them into the
 * store, then the scene is written lean. A note embed's sidecar (YAZ-852) keeps its pictures inside
 * as it always has.
 *
 * ASSETS FIRST, THEN THE SCENE. A scene on disk must never name bytes that are not there, so
 * every asset lands before the file that references it. The reverse order would leave a crash
 * window in which the document is broken; this order's worst case is an unreferenced asset (Docs
 * has no orphan sweep: the user's own files may sit in `assets/`, YAZ-3028).
 *
 * A REFERENCED ID WITH NO BYTES ANYWHERE is left OUT of the response rather than raised as an
 * error: the engine draws its missing-image placeholder and the document still opens. Losing a
 * picture must never cost the user the board it was on.
 *
 * THE `yaseendraw` BLOCK (🔒 YAZ-1834 D3) rides the same atomic write. The engine's serializer
 * drops keys it does not know, so the renderer never sends the block back; the save re-reads it
 * off the CURRENT file's head, keeps `createdAt` (and every key the backfill put there, D5), sets
 * `updatedAt` to now, and `stampBoardMetaScene` places it first. A board with no block is born one on
 * this save, aged by its pre-save mtime. This happens after the conflict guard and the assets, so
 * a refused save stamps nothing and a stamped scene never names bytes that are not there.
 *
 * Pure rules (`referencedFileIds`, `stripEmbeddedScene`, `stampBoardMetaScene`, …) live in
 * `shared/drawingAssets.ts`; this file is the fs around them.
 */
import { link, mkdir, readdir, readFile, rename, unlink } from 'node:fs/promises'
import path from 'node:path'
import type { DrawingFileEntry, DrawingLoadResponse, DrawingNewFile, DrawingSaveResponse } from '@shared/types'
import { isRecord } from '@shared/guards'
import { ASSETS_DIR, assetFileName, BOARD_META_HEAD_BYTES, createdOf, extForMime, fileIdOfAssetName, isValidFileId, mimeForAssetExt, parseBoardMetaBlock, parseDataUrl, PICTURES_INSIDE_MAX_BYTES, PICTURES_KEY, PICTURES_OUT, picturesFolderOf, picturesOut, referencedFileIds, serializeBoard, stampBoardMetaScene, BOARD_ID_KEY, boardIdOf, withSwitchTime, stripEmbeddedScene, type BoardMetaBlock, type EmbeddedFile } from '@shared/drawingAssets'
import { vaultNoteId } from '@shared/noteId'
import { mintIds, vaultIds } from '../vaultIndex/mint'
import { BOARDS, boardTarget, guardedStamp } from './boardDocument'
import type { BoardHead } from './boardHead'
import { readBoundedRegularFile } from './boundedRead'
import { atomicWrite, BridgeFailure, fsCall, requireDir, tmpSibling, writeDurable } from './fsUtils'
import { landingFolder } from './picturesFolders'

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
function storesOf(dir: string, folder: string | null): string[] {
  const assets = path.join(dir, ASSETS_DIR)
  return folder === null ? [assets] : [path.isAbsolute(folder) ? path.resolve(folder) : path.join(dir, ...folder.split('/')), assets]
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
 * `drawing:load`. `imageMaxPx` (a PICTURE of the scene, never an editor) is validated here; `fit`,
 * the hover preview's thumbnail cache (`ipc/board.ts`, YAZ-3035), answers it. Without `fit` (tests)
 * the pictures come back as their own bytes.
 */
export async function loadDrawing(req: unknown, fit?: (files: Record<string, DrawingFileEntry>, elements: readonly unknown[], maxPx: number) => Promise<Record<string, DrawingFileEntry>>): Promise<DrawingLoadResponse> {
  const { dir, file, body } = boardTarget(req, 'drawing')
  const { imageMaxPx } = body
  if (imageMaxPx !== undefined && (typeof imageMaxPx !== 'number' || !Number.isInteger(imageMaxPx) || imageMaxPx <= 0)) throw new BridgeFailure('BAD_REQUEST', "'imageMaxPx' must be a positive integer", { path: file })
  await requireDir(dir)
  const snapshot = await readBoundedRegularFile(file, BOARDS.drawing.max, BOARDS.drawing.tooLarge)
  const text = snapshot.data.toString('utf8')
  // The ONE parse: the outline check, the embedded pictures and the lean text all come from it.
  const { scene, elements } = parseScene(text, file, 'IO_ERROR')
  const { lean, embedded } = stripEmbeddedScene(scene)
  const block = headBlock(snapshot.data)
  const { files, stored } = await resolveFiles(dir, embedded, elements, picturesFolderOf(block))
  // 🔒 Draw's YAZ-2073 D7: a legacy scene's pictures travel once, in `files` — the renderer replaces
  // the scene's own map with them anyway. Every other board's text is sent exactly as it sits on disk.
  const json = Object.keys(embedded).length === 0 ? text : serializeBoard(lean)
  const pictures = imageMaxPx === undefined || fit === undefined ? files : await fit(files, elements, imageMaxPx)
  // YAZ-3943 D5: an "inside" board's save finds every picture in the file or the store by itself,
  // so the renderer never ships one of them back; a "pictures out" board's are the store's only.
  const kept = picturesOut(block) ? stored : Object.keys(files).sort()
  return { path: file, json, mtime: snapshot.mtime, size: snapshot.size, files: pictures, stored: kept }
}

/** The `yaseendraw` block off a board's bytes, by the head rule `readBoardHead` reads it with (🔒 YAZ-1834 D7). */
function headBlock(data: Buffer): BoardMetaBlock | null {
  return parseBoardMetaBlock(data.subarray(0, BOARD_META_HEAD_BYTES).toString('utf8'))
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
 * The bytes the stores hold for `ids` — the board's own `folder` first, then `assets/` (`storesOf`); an id with no
 * readable bytes in either is absent (the placeholder, not a failed open).
 */
async function fromStore(dir: string, ids: readonly string[], folder: string | null): Promise<Record<string, DrawingFileEntry>> {
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

/** One `newFiles` entry, checked like a request body — it names a file the renderer wants created. */
function checkAsset(entry: unknown, file: string): PendingAsset {
  if (!isRecord(entry)) throw new BridgeFailure('BAD_REQUEST', 'newFiles entries must be objects', { path: file })
  const { fileId, mimeType, dataURL } = entry
  if (!isValidFileId(fileId)) throw new BridgeFailure('BAD_REQUEST', "'fileId' must be a plain id", { path: file })
  if (typeof mimeType !== 'string' || extForMime(mimeType) === null) throw new BridgeFailure('BAD_REQUEST', `unsupported image type for ${fileId}`, { path: file })
  const data = typeof dataURL === 'string' ? parseDataUrl(dataURL) : null
  if (data === null) throw new BridgeFailure('BAD_REQUEST', `'dataURL' for ${fileId} must be a base64 data URL`, { path: file })
  const name = assetFileName(fileId, mimeType)
  if (name === null) throw new BridgeFailure('BAD_REQUEST', `unsupported image type for ${fileId}`, { path: file })
  return { fileId, name, bytes: Buffer.from(data.base64, 'base64') }
}

/**
 * The board as it is now, read ONCE (YAZ-3943 D5): its head for the stamp and the conflict guard,
 * its bytes for an "inside" save's pictures. A file that is gone is null, as `readBoardHead` answers.
 */
async function readCurrent(file: string): Promise<{ head: BoardHead; data: Buffer } | null> {
  try {
    const snap = await readBoundedRegularFile(file, BOARDS.drawing.max, BOARDS.drawing.tooLarge)
    return { head: { block: headBlock(snap.data), mtime: snap.mtime, size: snap.size }, data: snap.data }
  } catch (err) {
    if (err instanceof BridgeFailure && (err.code === 'NOT_FOUND' || err.code === 'NOT_A_FILE')) return null
    throw err
  }
}

/**
 * The ID a save gives the board (YAZ-3943 4C), or undefined: the vault does not give IDs, or the block holds an ID of
 * this vault already. An ID of another vault, or another tool's, is none, as a note's is (YAZ-2420 D30): the vault's
 * door gives a new one. The door is the note's (`mintIds`), so a board and a note never share a number.
 */
async function boardIdToGive(root: string, block: BoardMetaBlock | null | undefined): Promise<string | undefined> {
  const { answer, letters } = await vaultIds(root)
  if (answer !== true || vaultNoteId(boardIdOf(block), letters) !== undefined) return undefined
  return (await mintIds(root, 1))?.[0]
}

/** `approved` (YAZ-3943 demo round 3): the outside pictures folders the user picked (`AppState.approvedPictureFolders`), the only ones a save writes to. */
export async function saveDrawing(req: unknown, approved: readonly string[] = []): Promise<DrawingSaveResponse> {
  const { dir, file, body } = boardTarget(req, 'drawing')
  const { json, expectedMtime, newFiles } = body
  if (typeof json !== 'string') throw new BridgeFailure('BAD_REQUEST', "'json' must be a string", { path: file })
  if (expectedMtime !== undefined && typeof expectedMtime !== 'number') throw new BridgeFailure('BAD_REQUEST', "'expectedMtime' must be a number", { path: file })
  if (!Array.isArray(newFiles)) throw new BridgeFailure('BAD_REQUEST', "'newFiles' must be an array", { path: file })
  // Every check before any write: a half-landed save is worse than a refused one.
  // The ONE parse of the scene; it is stripped and stamped as an object and serialized once (YAZ-2073 5G).
  const { scene, elements } = parseScene(json, file, 'BAD_REQUEST')
  const pending = newFiles.map((entry) => checkAsset(entry, file))
  await requireDir(dir)
  const current = await readCurrent(file)
  const known = current?.head ?? null
  // A board's ID (YAZ-3943 4C): given on its first save in a vault that gives IDs, never on a save the guard refuses.
  const conflict = expectedMtime !== undefined && known !== null && known.mtime !== expectedMtime
  const id = conflict ? undefined : await boardIdToGive(dir, known?.block)
  const withId = (block: BoardMetaBlock | null): BoardMetaBlock | null => (id === undefined ? block : ({ ...block, [BOARD_ID_KEY]: id } as BoardMetaBlock))
  const given = id === undefined ? {} : { id }

  if (picturesOut(known?.block)) {
    // "Pictures out": a scene's still-embedded bytes shrink into the store on THIS save (see `liftEmbedded`).
    const { lean, lifted } = liftEmbedded(scene, elements, new Set(pending.map((p) => p.fileId)))
    pending.push(...lifted)
    const stamped = await guardedStamp(file, 'drawing', expectedMtime, (at, prior) => serializeBoard(stampBoardMetaScene(lean, at, withId(prior))), known)
    // Assets first (see the module doc), and only once the conflict guard has passed — a refused
    // save must leave the vault exactly as it found it.
    const persisted = await landAssets(dir, pending, landingFolder(picturesFolderOf(known?.block), approved))
    const { mtime, size } = await fsCall(file, () => atomicWrite(file, stamped))
    return { path: file, mtime, size, persisted, ...given }
  }

  // Inside (YAZ-3943 D5): the new pictures, any the scene sent inside itself, the file's own, then the store.
  const fresh: Record<string, DrawingFileEntry> = {}
  for (const { fileId, mimeType, dataURL } of newFiles as DrawingNewFile[]) fresh[fileId] = { mimeType, dataURL }
  const { lean, embedded: sent } = stripEmbeddedScene(scene)
  let prior: Record<string, unknown> | null = null
  try {
    if (current !== null) prior = parseScene(current.data.toString('utf8'), file, 'IO_ERROR').scene
  } catch {
    // A file that is not a scene has no pictures to keep; the save writes over it, as it always has.
  }
  const pictures = await embedPictures(dir, elements, [fresh, sent, prior === null ? {} : stripEmbeddedScene(prior).embedded], prior, picturesFolderOf(known?.block))
  const inside = { ...lean, files: pictures }
  let movedOut = false
  const stamped = await guardedStamp(
    file,
    'drawing',
    expectedMtime,
    (at, held) => {
      const block = withId(held)
      const full = serializeBoard(stampBoardMetaScene(inside, at, block))
      if (Buffer.byteLength(full, 'utf8') < PICTURES_INSIDE_MAX_BYTES) return full
      // The 50 MB rule (D5): the pictures go out, and the block says so from now on.
      movedOut = true
      return serializeBoard(stampBoardMetaScene(lean, at, withSwitchTime({ ...block, [PICTURES_KEY]: PICTURES_OUT }, PICTURES_KEY, at.updatedAt) as BoardMetaBlock))
    },
    known,
  )
  if (!movedOut) {
    const { mtime, size } = await fsCall(file, () => atomicWrite(file, stamped))
    return { path: file, mtime, size, persisted: Object.keys(pictures), inside: true, ...given }
  }
  const persisted = await landAssets(dir, liftEmbedded(inside, elements).lifted)
  const { mtime, size } = await fsCall(file, () => atomicWrite(file, stamped))
  return { path: file, mtime, size, persisted, movedOut: true, ...given }
}
