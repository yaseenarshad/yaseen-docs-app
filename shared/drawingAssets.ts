import { FOLD_ARROW_MODES, GITHUB_FILE_WARN_BYTES, type BoardMeta, type FoldArrowMode, type NewBoardPictures } from './types'
import { isFiniteNumber, isRecord } from './guards'

/**
 * THE IMAGE STORE'S PURE RULES (Draw's 🔒 YAZ-1775 D3, built in YAZ-1811; ported by YAZ-3028 D2).
 *
 * YAZ-3943 D5 REVERSES 🔒 YAZ-1775 D3 ("the vault file never embeds"): a board keeps every picture
 * it uses INSIDE its own `files` map by default, as normal Excalidraw does, so a copied board keeps
 * its pictures. Only a board whose `yaseendraw` block says `"pictures": "assets"` ("pictures out",
 * the cog's button, the 50 MB rule, Settings › Storage) keeps the old shape below. The rules for
 * "inside" are at the end of this file; main applies them on the save (`fs/drawing.ts`). Since
 * YAZ-3943 demo round 3 a "pictures out" board may name ITS OWN folder for them (`picturesFolder`,
 * vault-relative) in place of the vault's `assets/`; a reader looks there first, then in `assets/`.
 *
 * A "pictures out" `.excalidraw` carries `files: {}` — image ELEMENTS keep only their `fileId`,
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

/**
 * Mime → extension for the images the store keeps. Nothing else is an asset. YAZ-4071 7F: every type the engine accepts
 * (`IMAGE_MIME_TYPES`), so a move out never drops a picture the board draws, and a pasted BMP saves.
 */
const EXT_BY_MIME: Readonly<Record<string, string>> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/gif': 'gif',
  'image/svg+xml': 'svg',
  'image/webp': 'webp',
  'image/avif': 'avif',
  'image/bmp': 'bmp',
  'image/x-icon': 'ico',
  'image/jfif': 'jfif',
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
  bmp: 'image/bmp',
  ico: 'image/x-icon',
  jfif: 'image/jfif',
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

// ---------- A board's ID (YAZ-3943 4C) ----------

/**
 * The block key of a board's ID, as a note's is `id:` in its frontmatter (`NOTE_ID_KEY`): `"id": "YAZ-12"`. The vault's
 * door gives it on the board's first save in a vault that gives IDs (`fs/drawing.ts`); opening never writes it. The
 * index reads it off the head (`vaultIndex/live.ts`), so `[[YAZ-12]]` opens the board after any rename.
 */
export const BOARD_ID_KEY = 'id'

/** The ID a block holds, as written, or undefined. Whether it is an ID of THIS vault is `vaultNoteId`'s to say. */
export function boardIdOf(block: unknown): string | undefined {
  const id = isRecord(block) ? block[BOARD_ID_KEY] : undefined
  return typeof id === 'string' ? id : undefined
}

/**
 * The block key of the IDs a board held before (YAZ-4071 7I): two Macs that each gave the board an ID before a sync
 * keep the lower one (`shared/boardMerge.ts`), and the other one goes here, so a link to it still opens the board.
 */
export const FORMER_IDS_KEY = 'formerIds'

/** The IDs a block held before, as written; none for a block without them. */
export function formerBoardIdsOf(block: unknown): string[] {
  const ids = isRecord(block) ? block[FORMER_IDS_KEY] : undefined
  return Array.isArray(ids) ? ids.filter((id): id is string => typeof id === 'string') : []
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

// ---------- Pictures inside the board (YAZ-3943 D5) ----------

/** The `yaseendraw` block key for "pictures out": `"pictures": "assets"`. No key means inside. */
export const PICTURES_KEY = 'pictures'
export const PICTURES_OUT = 'assets'

/**
 * YAZ-3943 demo round 3: the block key of a board's OWN pictures folder, beside `"pictures": "assets"`:
 * `"picturesFolder": "Projects/Alpha/pictures"`, relative to the VAULT ROOT with `/` separators, so a moved
 * board keeps it — or, for a folder OUTSIDE the vault (the user's pick, anywhere on the Mac), the ABSOLUTE
 * path (`/Users/me/Pictures/Boards`). No key: the vault's `assets/`. It only matters while the pictures are
 * out; a save that sets or clears it records the time under `pictures` (`withSwitchTime`), so 1E treats
 * pictures + folder as ONE switch. An invalid value in a file (`isValidPicturesFolder`) reads as no key.
 *
 * A board file can come from anyone, so a block alone never makes the app WRITE outside the vault: main
 * lands pictures in an outside folder only once the user picked it in the folder window (the approved list
 * in the store, `fs/picturesFolders.ts`); it READS from any folder a block names.
 */
export const PICTURES_FOLDER_KEY = 'picturesFolder'

/** Whether a pictures folder is outside the vault: stored absolute (a leading `/`), not vault-relative. */
export const picturesFolderOutside = (folder: string): boolean => folder.startsWith('/')

/**
 * A pictures folder a board may name (demo round 3): a vault-relative `/` path, or an absolute one for a folder
 * outside the vault; normalized — no empty segment, no `.` or `..`, no dot-segment (`.git`, `.yaseen`, …), not
 * `node_modules` — and never the vault root (`''`) or `/` itself. The value comes from a file or a request, so
 * it is checked like a request body rather than trusted. Which outside folders are BLOCKED (system folders) is
 * main's rule (`fs/picturesFolders.ts`), applied where a folder is picked.
 */
export function isValidPicturesFolder(v: unknown): v is string {
  if (typeof v !== 'string' || v === '' || v.includes('\0')) return false
  return (v.startsWith('/') ? v.slice(1) : v).split('/').every((s) => s.trim() !== '' && !s.startsWith('.') && s !== 'node_modules')
}

/** A path as the app shows it: `~/…` under the user's `home` (the Welcome screen's rule); unchanged otherwise, and always for a vault-relative one. */
export const withHomeTilde = (p: string, home: string): string => (home !== '' && p.startsWith(home) && p[home.length] === '/' ? `~${p.slice(home.length)}` : p)

/** A board's own folder, or null: the vault's `assets/` itself is the default, not a second name for it (YAZ-4074 6A item 15). */
const ownFolder = (folder: string | null): string | null => (folder === ASSETS_DIR ? null : folder)

/** The pictures folder a `yaseendraw` block names, or null: no key, `assets` itself, or one that is not a valid folder. */
export function picturesFolderOf(block: unknown): string | null {
  const folder = isRecord(block) ? block[PICTURES_FOLDER_KEY] : undefined
  return isValidPicturesFolder(folder) ? ownFolder(folder) : null
}

/**
 * YAZ-3943 D5, the 50 MB rule: a save that would make an "inside" board this big or bigger moves its
 * pictures out instead. The same 50 MiB line as GitHub's warning and Settings › Storage's.
 */
export const PICTURES_INSIDE_MAX_BYTES = GITHUB_FILE_WARN_BYTES

/**
 * YAZ-3943 1E: the block key where each switch of the block (Read only, pictures) records when it last changed, in ms:
 * `"switched": { "pictures": 1793570760342 }`. When two Macs changed the block, the newest change of a switch wins
 * (`shared/boardMerge.ts`). A switch with no time is older than any change.
 */
export const SWITCHED_KEY = 'switched'

/** `block` with the change time of the switch `key` set to `at`; every other key kept. */
export function withSwitchTime(block: Record<string, unknown>, key: string, at: number): Record<string, unknown> {
  const times = isRecord(block[SWITCHED_KEY]) ? block[SWITCHED_KEY] : {}
  return { ...block, [SWITCHED_KEY]: { ...times, [key]: at } }
}

/** Whether a `yaseendraw` block says "pictures out". */
export function picturesOut(block: unknown): boolean {
  return isRecord(block) && block[PICTURES_KEY] === PICTURES_OUT
}

/**
 * The scene with "pictures out" on or off; the SAME object when it already is. The rule of
 * `withDrawingReadOnly` (`shared/readOnly.ts`): the block comes back FIRST, a block with no dates gets
 * `bornAt` for both, every other key stays, and the switch records `at` as its change time (1E). So off
 * keeps the block: its time must reach the other Mac.
 *
 * `folder` (demo round 3) is the board's own pictures folder with "out": a path sets `picturesFolder`, null
 * clears it (the vault's `assets/`), undefined keeps what the block has. "Inside" always clears it: the
 * folder key exists only while the pictures are out, so pictures + folder are one switch.
 */
export function withPicturesOut(scene: Record<string, unknown>, out: boolean, bornAt: number, at = Date.now(), folder?: string | null): Record<string, unknown> {
  const { [BOARD_META_KEY]: own, ...rest } = scene
  const held = isRecord(own) ? own : {}
  const nextFolder = out ? (folder === undefined ? picturesFolderOf(held) : ownFolder(folder)) : null
  if (out === picturesOut(own) && (out || !(PICTURES_KEY in held)) && nextFolder === (PICTURES_FOLDER_KEY in held ? held[PICTURES_FOLDER_KEY] : null)) return scene
  const { [PICTURES_KEY]: _old, [PICTURES_FOLDER_KEY]: _oldFolder, createdAt, updatedAt, ...extras } = held
  const dates = { createdAt: isFiniteNumber(createdAt) ? createdAt : bornAt, updatedAt: isFiniteNumber(updatedAt) ? updatedAt : bornAt }
  const switches = out ? { [PICTURES_KEY]: PICTURES_OUT, ...(nextFolder === null ? {} : { [PICTURES_FOLDER_KEY]: nextFolder }) } : {}
  return { [BOARD_META_KEY]: withSwitchTime({ ...dates, ...extras, ...switches }, PICTURES_KEY, at), ...rest }
}

/**
 * The scene JSON of a new board (YAZ-3943 demo 2), from Settings › Files & Links › "New boards keep pictures":
 * "Inside the board" keeps `json` (D5's default); "In the assets folder" is born "pictures out" (`withPicturesOut`,
 * with its 1E switch time at `now`); "In a folder you pick" (demo round 3) names that folder too, and is "assets"
 * while no valid folder is chosen yet. One rule for the client's `createDrawing` and main's `createBoard`
 * (YAZ-4074 6A item 33).
 */
export function newBoardScene(json: string, pictures: NewBoardPictures, folder: string, now: number): string {
  if (pictures === 'inside') return json
  const own = pictures === 'folder' && isValidPicturesFolder(folder) ? folder : null
  return serializeBoard(withPicturesOut(JSON.parse(json) as Record<string, unknown>, true, now, now, own))
}

// ---------- Link preview on hover, per board (YAZ-3943 demo 2) ----------

/** The `yaseendraw` block key of the board's "Link preview on hover" switch: `"hoverLinks": false` when off. No key means on. */
export const HOVER_LINKS_KEY = 'hoverLinks'

/** Whether a `yaseendraw` block turns the board's link preview on hover off. */
export function hoverLinksOff(block: unknown): boolean {
  return isRecord(block) && block[HOVER_LINKS_KEY] === false
}

/**
 * The scene with its link preview on hover on or off; the SAME object when it already is. The rule of
 * `withPicturesOut`: the block comes back first, a block with no dates gets `bornAt`, every other key stays, and
 * the switch records `at` as its change time (1E: the newest change wins a two-Mac merge).
 */
export function withHoverLinks(scene: Record<string, unknown>, on: boolean, bornAt: number, at = Date.now()): Record<string, unknown> {
  const { [BOARD_META_KEY]: own, ...rest } = scene
  if (on !== hoverLinksOff(own) && (!on || !(isRecord(own) && HOVER_LINKS_KEY in own))) return scene
  const { [HOVER_LINKS_KEY]: _old, createdAt, updatedAt, ...extras } = isRecord(own) ? own : {}
  const dates = { createdAt: isFiniteNumber(createdAt) ? createdAt : bornAt, updatedAt: isFiniteNumber(updatedAt) ? updatedAt : bornAt }
  return { [BOARD_META_KEY]: withSwitchTime({ ...dates, ...extras, ...(on ? {} : { [HOVER_LINKS_KEY]: false }) }, HOVER_LINKS_KEY, at), ...rest }
}

// ---------- Fold arrows, per board (YAZ-4277 D5) ----------

/**
 * The `yaseendraw` block key of the board's "Fold arrows": `"foldArrows": "hover"`, `"always"` or `"off"` (YAZ-4277
 * D18: no folding on this board; the saved folds stay in the file) overrides the app's "Fold arrows on open bullets".
 * No key: the app setting.
 */
export const FOLD_ARROWS_KEY = 'foldArrows'

/** The board's own fold arrow mode, or null for the app setting (also for a value the app does not know). */
export function boardFoldArrowsOf(block: unknown): FoldArrowMode | null {
  const value = isRecord(block) ? block[FOLD_ARROWS_KEY] : undefined
  return typeof value === 'string' && (FOLD_ARROW_MODES as readonly string[]).includes(value) ? (value as FoldArrowMode) : null
}

/**
 * The scene with its fold arrow mode (`null`: the app setting); the SAME object when it already is. The rule of
 * `withHoverLinks`: the block comes back first, a block with no dates gets `bornAt`, every other key stays, and the
 * switch records `at` as its change time (1E: the newest change wins a two-Mac merge).
 */
export function withBoardFoldArrows(scene: Record<string, unknown>, value: FoldArrowMode | null, bornAt: number, at = Date.now()): Record<string, unknown> {
  const { [BOARD_META_KEY]: own, ...rest } = scene
  if (boardFoldArrowsOf(own) === value && (value !== null || !(isRecord(own) && FOLD_ARROWS_KEY in own))) return scene
  const { [FOLD_ARROWS_KEY]: _old, createdAt, updatedAt, ...extras } = isRecord(own) ? own : {}
  const dates = { createdAt: isFiniteNumber(createdAt) ? createdAt : bornAt, updatedAt: isFiniteNumber(updatedAt) ? updatedAt : bornAt }
  return { [BOARD_META_KEY]: withSwitchTime({ ...dates, ...extras, ...(value === null ? {} : { [FOLD_ARROWS_KEY]: value }) }, FOLD_ARROWS_KEY, at), ...rest }
}

// ---------- Hover outline, per board (YAZ-4469 demo) ----------

/**
 * The `yaseendraw` block key of the board's "Hover outline": `"hoverOutline": true` or `false` overrides the app's
 * "Hover outline". No key: the app setting.
 */
export const HOVER_OUTLINE_KEY = 'hoverOutline'

/** The board's own hover outline, or null for the app setting (also for a value the app does not know). */
export function boardHoverOutlineOf(block: unknown): boolean | null {
  const value = isRecord(block) ? block[HOVER_OUTLINE_KEY] : undefined
  return typeof value === 'boolean' ? value : null
}

/**
 * The scene with its hover outline (`null`: the app setting); the SAME object when it already is. The rule of
 * `withBoardFoldArrows`.
 */
export function withBoardHoverOutline(scene: Record<string, unknown>, value: boolean | null, bornAt: number, at = Date.now()): Record<string, unknown> {
  const { [BOARD_META_KEY]: own, ...rest } = scene
  if (boardHoverOutlineOf(own) === value && (value !== null || !(isRecord(own) && HOVER_OUTLINE_KEY in own))) return scene
  const { [HOVER_OUTLINE_KEY]: _old, createdAt, updatedAt, ...extras } = isRecord(own) ? own : {}
  const dates = { createdAt: isFiniteNumber(createdAt) ? createdAt : bornAt, updatedAt: isFiniteNumber(updatedAt) ? updatedAt : bornAt }
  return { [BOARD_META_KEY]: withSwitchTime({ ...dates, ...extras, ...(value === null ? {} : { [HOVER_OUTLINE_KEY]: value }) }, HOVER_OUTLINE_KEY, at), ...rest }
}

/** One picture inside a board: the shape the engine's `addFiles` reads (it keys on `id`). */
export interface EmbeddedFile extends DrawingFileData {
  id: string
  created: number
}

/** `created` of a scene's own `files[id]`, when it has a usable one: an untouched save keeps it, so the bytes stay the same. */
export function createdOf(scene: Record<string, unknown>, id: string): number | null {
  const files = scene.files
  const entry = isRecord(files) ? files[id] : undefined
  return isRecord(entry) && isFiniteNumber(entry.created) ? entry.created : null
}

/**
 * The cog's size row (YAZ-3943 D5): how many pictures a live element uses, and their own size in bytes
 * (the base64 of each `dataURL`, decoded by its length, never by decoding it). An id with no entry,
 * or an entry with no `dataURL`, does not count: it is `missing` (1F). The load puts in `files` every
 * picture it found in the file, in the board's own folder or in `assets/`, so a missing one is in none.
 */
export function picturesSize(elements: readonly unknown[], files: Readonly<Record<string, unknown>>): { bytes: number; count: number; missing: number } {
  let bytes = 0
  let count = 0
  let missing = 0
  for (const id of referencedFileIds(elements)) {
    const entry = files[id]
    const dataURL = isRecord(entry) ? entry.dataURL : undefined
    if (typeof dataURL !== 'string') {
      missing += 1
      continue
    }
    const base64 = dataURL.length - dataURL.indexOf(',') - 1
    const padding = dataURL.endsWith('==') ? 2 : dataURL.endsWith('=') ? 1 : 0
    bytes += Math.max(0, Math.floor((base64 * 3) / 4) - padding)
    count += 1
  }
  return { bytes, count, missing }
}

/** "3 pictures are missing" (YAZ-3943 1F): the count first, as the size row says it. */
export const missingPicturesText = (missing: number): string => (missing === 1 ? '1 picture is missing' : `${missing} pictures are missing`)

/** What a board with missing pictures says when it opens, in a tab or the note popup (YAZ-3943 1F, YAZ-4074 6A item 12). */
export const missingPicturesNotice = (missing: number): string => (missing === 1 ? '1 picture of this board is missing' : `${missing} pictures of this board are missing`)

/**
 * Why a picture move is refused while a picture is missing (YAZ-4074 6A item 2): the move would leave it behind, and
 * the block would stop naming the folder where it may come back (an unmounted drive, a renamed folder).
 */
export const picturesMissingRefusal = (missing: number): string => `${missingPicturesText(missing)}. Find ${missing === 1 ? 'it' : 'them'} before you move the pictures.`

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
