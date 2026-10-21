import type { BoardMeta } from './types'
import { isFiniteNumber, isRecord } from './guards'

/**
 * THE IMAGE STORE'S PURE RULES (Draw's 🔒 YAZ-1775 D3, built in YAZ-1811; ported by YAZ-3028 D2).
 *
 * A `.excalidraw` that a TAB saves carries `files: {}` — image ELEMENTS keep only their `fileId`,
 * and the bytes live at `<vault>/assets/<fileId>.<ext>`. The id is Excalidraw's own (the SHA-1 of
 * the bytes), so the store is content-addressed for free and its files are IMMUTABLE: a second
 * paste of one image writes nothing and two boards share one file. Note images stay in
 * `assets/images/` (YAZ-3028 edge cases); the drawing store is the top of `assets/` only.
 *
 * A note EMBED keeps Docs' own shape (rule 28): the modal writes the scene with its images inside
 * it, through `writeAsset`. Both readers accept both shapes — a tab's `drawing:load` lifts an
 * embedded scene's pictures (and its first save moves them into the store), and the embed's
 * reader resolves a lean scene's ids out of the store — so a drawing open in both places keeps its
 * pictures either way.
 *
 * Both processes need these rules, so they live in `shared/` once, with no fs, no Electron and no
 * engine import; `desktop/src/main/fs/drawingAssets.test.ts` pins them. The doors that USE them are
 * `desktop/src/main/fs/drawing.ts` and `client/src/drawings/DrawingEditor.tsx`; the board's own dates
 * (Draw's 🔒 YAZ-1834, at the end of this file) add `fs/boardDocument.ts`, `fs/boardHead.ts` and
 * `fs/createBoard.ts`.
 *
 * Draw's orphan sweep (`planOrphanSweep`) is NOT ported (YAZ-3028): in Docs the user's own files
 * may sit in `assets/`, and a sweep that trashes unreferenced images there could eat one.
 */

/** Mime → extension for the images the store keeps. Nothing else is an asset. */
const EXT_BY_MIME: Readonly<Record<string, string>> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/gif': 'gif',
  'image/svg+xml': 'svg',
  'image/webp': 'webp',
  'image/avif': 'avif',
}

/** Extension → mime, INCLUDING the spellings `extForMime` never writes (`jpeg`), which it must still read. */
const MIME_BY_EXT: Readonly<Record<string, string>> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  svg: 'image/svg+xml',
  webp: 'image/webp',
  avif: 'image/avif',
}

/** The vault-relative folder the store lives in. Docs keeps it visible in the tree (YAZ-3028 D12). */
export const ASSETS_DIR = 'assets'

/** One stored image as it crosses IPC. Mirrors `DrawingFileEntry` without importing the bridge types. */
export interface DrawingFileData {
  mimeType: string
  dataURL: string
}

export function extForMime(mimeType: string): string | null {
  return EXT_BY_MIME[mimeType] ?? null
}

export function mimeForAssetExt(ext: string): string | null {
  return MIME_BY_EXT[ext.toLowerCase()] ?? null
}

/** `<fileId>.<ext>`, or null when the mime is not one the store keeps. */
export function assetFileName(fileId: string, mimeType: string): string | null {
  const ext = extForMime(mimeType)
  return ext === null ? null : `${fileId}.${ext}`
}

/** The id an asset's NAME carries (its stem); null for a dot-entry or an empty stem. */
export function fileIdOfAssetName(name: string): string | null {
  if (name.startsWith('.')) return null
  const dot = name.lastIndexOf('.')
  const stem = dot === -1 ? name : name.slice(0, dot)
  return stem === '' ? null : stem
}

/**
 * A fileId becomes a path SEGMENT under `assets/` and arrives from a sandboxed renderer, so it
 * is checked like a request body rather than trusted. The engine's ids are hex; the slightly
 * wider `[A-Za-z0-9_-]` still keeps out every separator, every dot and every control character,
 * so nothing here can climb out of the folder or forge an extension.
 */
export function isValidFileId(id: unknown): id is string {
  return typeof id === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(id)
}

/**
 * The fileIds a scene still USES: non-deleted image elements only. A deleted element keeps its
 * `fileId` so undo can bring the picture back, but it does not keep the bytes alive — otherwise
 * nothing would ever become an orphan.
 */
export function referencedFileIds(elements: readonly unknown[]): Set<string> {
  const ids = new Set<string>()
  for (const el of elements) {
    if (typeof el !== 'object' || el === null) continue
    const { type, fileId, isDeleted } = el as Record<string, unknown>
    if (type === 'image' && typeof fileId === 'string' && fileId !== '' && isDeleted !== true) ids.add(fileId)
  }
  return ids
}

/** `data:<mime>;base64,<payload>` → its parts; null for anything else (a remote URL is not bytes). */
export function parseDataUrl(dataURL: string): { mimeType: string; base64: string } | null {
  const m = /^data:([^;,]+);base64,([A-Za-z0-9+/=\s]*)$/.exec(dataURL)
  return m === null ? null : { mimeType: m[1], base64: m[2] }
}

/**
 * A LEGACY scene — an upstream export, or one an older build wrote — embeds its bytes under
 * `files`. Lift every usable entry out and hand back the scene with `files: {}`, the shape every
 * save writes once `serializeBoard` spells it.
 *
 * BYTE-STABLE WHEN NOTHING CHANGED. A scene that is already lean, spelled as main writes it,
 * serializes back as ITSELF, so saving an untouched document never rewrites it into a different
 * spelling — which would show up as a diff in the vault's git history for no reason at all.
 */
export function stripEmbeddedScene(scene: Record<string, unknown>): { lean: Record<string, unknown>; embedded: Record<string, DrawingFileData> } {
  const embedded: Record<string, DrawingFileData> = {}
  const files = scene.files
  if (isRecord(files)) {
    for (const [id, entry] of Object.entries(files)) {
      if (!isRecord(entry)) continue
      const { mimeType, dataURL } = entry
      if (typeof mimeType !== 'string' || typeof dataURL !== 'string' || parseDataUrl(dataURL) === null) continue
      embedded[id] = { mimeType, dataURL }
    }
  }
  return { lean: { ...scene, files: {} }, embedded }
}

/** How every board main writes is spelled: 2-space JSON like Excalidraw's own writer, and the trailing newline a text file in a git vault ends with. */
export const serializeBoard = (scene: Record<string, unknown>): string => `${JSON.stringify(scene, null, 2)}\n`

// ---------- The `yaseendraw` block (🔒 YAZ-1834 D1/D3/D5/D7) ----------

/** The top-level key that carries a board's own dates; always the FIRST key of a file main writes. */
export const BOARD_META_KEY = 'yaseendraw'
/** How much of a board the tree walk reads to find the block: it is ~80 bytes and comes first. */
export const BOARD_META_HEAD_BYTES = 1024

/** The text as a scene object; throws on anything else (the callers decide what that means). */
function parseSceneObject(json: string): Record<string, unknown> {
  const parsed: unknown = JSON.parse(json)
  if (!isRecord(parsed)) throw new Error('not an Excalidraw scene')
  return parsed
}

/** A block as it sits in a file: the two dates, plus whatever the backfill put beside them (D5). */
export type BoardMetaBlock = BoardMeta & Record<string, unknown>

/** `{ "yaseendraw": {` at the very start of a file — the only place a block is read from. */
const BLOCK_OPENS = new RegExp(`^\\s*\\{\\s*"${BOARD_META_KEY}"\\s*:\\s*\\{`)

/** `stampBoardMetaScene` on text: the create door's empty scene (`fs/create.ts`). Throws when the text is not a JSON object. */
export function stampBoardMeta(json: string, at: { createdAt: number; updatedAt: number }, prior: BoardMetaBlock | null = null): string {
  return serializeBoard(stampBoardMetaScene(parseSceneObject(json), at, prior))
}

/**
 * Place and stamp the block on a scene that is on its way to disk (🔒 YAZ-1834 D3). `scene` is the
 * lean scene a save is about to write, or the empty one a create ships; `at` carries the dates the
 * caller has decided on; `prior` is the block the FILE currently holds (the save door reads it off
 * the head), which wins over any block inside `scene` because the disk is the block's truth — the
 * engine's serializer never sends it back. `yaseendraw` comes back as the FIRST key, so once
 * `serializeBoard` writes it the tree can read it back from the file head alone.
 *
 * What survives from the existing block (D5, the backfill contract): a finite `createdAt` is
 * kept over `at.createdAt`; every key the app does not know is kept verbatim (an importer's
 * `cloudId`, say). `updatedAt` is always `at.updatedAt`. A block that is not a plain object is
 * replaced (D7). The block's own key order is normalized — `createdAt, updatedAt, …extras` — so
 * stamping twice with the same `at` is byte-stable. Every other top-level key keeps its order.
 */
export function stampBoardMetaScene(scene: Record<string, unknown>, at: { createdAt: number; updatedAt: number }, prior: BoardMetaBlock | null = null): Record<string, unknown> {
  const { [BOARD_META_KEY]: own, ...rest } = scene
  const existing = prior ?? own
  // `_stale` is pulled out so the old `updatedAt` cannot ride along inside `...extras`.
  const { createdAt, updatedAt: _stale, ...extras } = isRecord(existing) ? existing : {}
  const block = { createdAt: isFiniteNumber(createdAt) ? createdAt : at.createdAt, updatedAt: at.updatedAt, ...extras }
  return { [BOARD_META_KEY]: block, ...rest }
}

/**
 * The block parsed off the HEAD of a file — the first `BOARD_META_HEAD_BYTES` decoded as text,
 * which is a truncated document and must never be `JSON.parse`d whole. Answers the block only
 * when the text is an object whose first key is `yaseendraw` and whose value parses to a plain
 * object with two finite numbers; anything else (no block, block not first, malformed, cut short)
 * is `null` (🔒 YAZ-1834 D7). Extra keys come back with it, so a save can carry them forward (D5).
 */
export function parseBoardMetaBlock(head: string): BoardMetaBlock | null {
  const open = BLOCK_OPENS.exec(head)
  if (open === null) return null
  const end = closingBrace(head, open[0].length - 1)
  if (end === null) return null
  let block: unknown
  try {
    block = JSON.parse(head.slice(open[0].length - 1, end + 1))
  } catch {
    return null
  }
  if (!isRecord(block) || !isFiniteNumber(block.createdAt) || !isFiniteNumber(block.updatedAt)) return null
  return block as BoardMetaBlock
}

/**
 * Index of the `}` that closes the `{` at `start`, or null when the text ends first. String-aware,
 * because an importer's extra value may legitimately contain a brace (`"note": "a }"`).
 */
function closingBrace(text: string, start: number): number | null {
  let depth = 0
  let inString = false
  for (let i = start; i < text.length; i++) {
    const c = text[i]
    if (inString) {
      if (c === '\\') i++
      else if (c === '"') inString = false
    } else if (c === '"') inString = true
    else if (c === '{') depth++
    else if (c === '}' && --depth === 0) return i
  }
  return null
}

/**
 * The renderer's half of a save: which of the engine's current files does the store not have
 * yet? Only files the scene still REFERENCES count — a pasted-then-deleted image must never
 * land — and `persisted` is what the load found plus what earlier saves reported back. Sorted by
 * id so the write order, and the test, are deterministic.
 */
export function unpersistedFiles(files: Record<string, DrawingFileData>, referenced: ReadonlySet<string>, persisted: ReadonlySet<string>): Array<{ fileId: string } & DrawingFileData> {
  return Object.keys(files)
    .filter((id) => referenced.has(id) && !persisted.has(id))
    .sort()
    .map((fileId) => ({ fileId, mimeType: files[fileId].mimeType, dataURL: files[fileId].dataURL }))
}

// ---------- A new drawing (YAZ-877, moved here for `fs:create-board` by YAZ-3028 D9) ----------

/**
 * `source` on every scene this app writes, and the engine's `EXCALIDRAW_EXPORT_SOURCE` pin. Docs'
 * own name (YAZ-3028 D12: Draw writes `yaseen-draw`; both are read the same).
 */
export const DRAWING_SOURCE = 'yaseen-docs'

/**
 * A valid EMPTY Excalidraw scene. `type`/`version`/`source`/`elements`/`appState`/`files` are the
 * shape every Excalidraw export carries, and `restore()` reads all of them. `appState: {}` on
 * purpose: Excalidraw fills its own defaults, so the file states nothing about theme or background
 * it does not mean.
 */
export const EMPTY_SCENE = {
  type: 'excalidraw',
  version: 2,
  source: DRAWING_SOURCE,
  elements: [],
  appState: {},
  files: {},
} as const

/**
 * The bytes a new drawing is written with: pretty-printed, one trailing newline (a text file in a
 * git vault). Never a zero-byte file: a tab calls that the corrupt case.
 */
export const EMPTY_SCENE_JSON = `${JSON.stringify(EMPTY_SCENE, null, 2)}\n`
