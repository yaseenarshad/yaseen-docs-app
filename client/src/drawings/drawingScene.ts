/**
 * Reading a drawing back off disk: the page embed's sidecar (YAZ-878) and, since YAZ-3028, the
 * scene text a drawing TAB loads through `drawing:load` (`parseSceneText`, `openViewport`, ported
 * from Draw's `drawingScene.ts`).
 *
 * `api.readAsset` is the ONE door (YAZ-876): the embed's raw target goes through untouched —
 * path or bare basename — because readAsset already owns the resolution rule (root-relative when
 * it has a `/`, else Obsidian's shortest-path basename search). The renderer never joins paths.
 *
 * The bytes come back base64 (the asset pipe's shape for images and drawings alike), so a scene
 * is `atob` → UTF-8 → `JSON.parse`. Anything that is not a scene — a missing file, unreadable
 * bytes, invalid JSON, JSON without an `elements` ARRAY — throws, and every throw lands in the
 * popup's ONE error line (never a crash). No repair, no
 * partial render: a half-parsed scene would be a lie about what the file holds.
 */
import type { DrawingFileEntry, FoldArrowMode } from '@shared/types'
import { BOARD_META_KEY, boardFoldArrowsOf, boardHoverOutlineOf, hoverLinksOff, picturesFolderOf, picturesOut, referencedFileIds } from '@shared/drawingAssets'
import { isDrawing } from '@shared/fileKind'
import { isRecord } from '@shared/guards'
import { isDrawingReadOnly } from '@shared/readOnly'
import { api, BridgeRequestError } from '../api'
import { visibleElements } from '../lib/scenePreview'
import { loadExcalidraw, type ExcalidrawModule } from './engine'

/** The scene shape a preview needs; deliberately loose — the file is user data, not our type. */
export interface DrawingScene {
  /** Excalidraw elements exactly as the file holds them; validated only as "an array". */
  readonly elements: readonly unknown[]
  /** Optional in the file (YAZ-877 writes `{}`); missing = Excalidraw's own defaults. */
  readonly appState: Record<string, unknown>
  /** The binary-asset map; `null` when the file has none, which is what exportToSvg wants. */
  readonly files: Record<string, unknown> | null
  /** The file's read-only switch (YAZ-3076 D1, `isDrawingReadOnly`), read in the same parse; absent = editable. */
  readonly readOnly?: boolean
  /** `"pictures": "assets"` in the block (YAZ-3943 D5), read in the same parse; absent = the pictures are inside. */
  readonly picturesOut?: boolean
  /** The board's own pictures folder (`picturesFolder`, YAZ-3943 demo round 3), vault-relative, when the block names a valid one. */
  readonly picturesFolder?: string
  /** `"hoverLinks": false` in the block (YAZ-3943 demo 2): the board's link preview on hover is off; absent = on. */
  readonly hoverLinksOff?: boolean
  /** `"foldArrows"` in the block (YAZ-4277 D5): the board's own fold arrow mode; absent = the app setting. */
  readonly foldArrows?: FoldArrowMode
  /** `"hoverOutline"` in the block (YAZ-4469 demo): the board's own hover outline; absent = the app setting. */
  readonly hoverOutline?: boolean
}

/** The scene's switches, each present only when it is not the default: a plain scene keeps the shape it always had. */
const readOnlyOf = (scene: Record<string, unknown>): { readOnly?: true; picturesOut?: true; picturesFolder?: string; hoverLinksOff?: true; foldArrows?: FoldArrowMode; hoverOutline?: boolean } => ({
  ...(isDrawingReadOnly(scene) ? { readOnly: true } : {}),
  ...(picturesOut(scene[BOARD_META_KEY]) ? { picturesOut: true } : {}),
  ...(picturesFolderOf(scene[BOARD_META_KEY]) === null ? {} : { picturesFolder: picturesFolderOf(scene[BOARD_META_KEY]) as string }),
  ...(hoverLinksOff(scene[BOARD_META_KEY]) ? { hoverLinksOff: true } : {}),
  ...(boardFoldArrowsOf(scene[BOARD_META_KEY]) === null ? {} : { foldArrows: boardFoldArrowsOf(scene[BOARD_META_KEY]) as FoldArrowMode }),
  ...(boardHoverOutlineOf(scene[BOARD_META_KEY]) === null ? {} : { hoverOutline: boardHoverOutlineOf(scene[BOARD_META_KEY]) as boolean }),
})

/** base64 → the UTF-8 text it carries (scene JSON is text, and text can hold non-ASCII). */
function decodeBase64(data: string): string {
  const binary = atob(data)
  const bytes = Uint8Array.from(binary, (c) => c.charCodeAt(0))
  return new TextDecoder().decode(bytes)
}

/** Parses one `AssetResponse.data` payload into a scene; throws on anything that is not one. */
export function parseScene(base64: string): DrawingScene {
  const parsed: unknown = JSON.parse(decodeBase64(base64))
  if (typeof parsed !== 'object' || parsed === null) throw new Error('not an Excalidraw scene')
  const scene = parsed as Record<string, unknown>
  if (!Array.isArray(scene.elements)) throw new Error('not an Excalidraw scene: no elements')
  const appState = typeof scene.appState === 'object' && scene.appState !== null ? (scene.appState as Record<string, unknown>) : {}
  const files = typeof scene.files === 'object' && scene.files !== null ? (scene.files as Record<string, unknown>) : null
  return { elements: scene.elements, appState, files, ...readOnlyOf(scene) }
}

/**
 * A drawing as the MODAL needs it (YAZ-879): the scene plus the two facts a save needs — the
 * ABSOLUTE path the fuzzy target resolved to (writes are never fuzzy, YAZ-876) and the mtime of
 * the read, which is the `expectedMtime` guard the write goes back with.
 */
export interface LoadedDrawing {
  readonly scene: DrawingScene
  readonly path: string
  readonly mtime: number
  /**
   * The ids a save never ships back (YAZ-3943 1A1), by `drawing:load`'s own rule: every picture of a
   * board with its pictures inside (main finds each in the file or the store), only the store's for a
   * "pictures out" board.
   */
  readonly stored: readonly string[]
}

/**
 * Reads `target` under `root` and parses it, keeping the identity a save needs.
 *
 * A scene a drawing TAB saved with its pictures out (YAZ-3943 D5: `"pictures": "assets"`) is lean (`files: {}`, its pictures in `<vault>/assets/`), so
 * a picture the scene names but does not carry is filled in from the store through `drawing:load`
 * at the resolved path — one extra read, and only for such a scene: an embed's own sidecar carries
 * its pictures and never pays it. An id found nowhere stays out (the engine's placeholder), and a
 * store read that fails leaves the scene as the sidecar said: a picture must never cost the drawing.
 */
export async function openDrawing(root: string, target: string): Promise<LoadedDrawing> {
  let asset
  try {
    asset = await api.readAsset(root, target)
  } catch (err) {
    // YAZ-3943 D5: a board keeps its pictures inside, so it can pass the asset pipe's 10 MiB cap. The
    // board's own loader reads it (to 200 MiB), at the path the pipe resolved and named in its refusal.
    if (err instanceof BridgeRequestError && err.code === 'TOO_LARGE' && err.path !== undefined && isDrawing(err.path)) return openLargeDrawing(root, err.path)
    throw err
  }
  const parsed = parseScene(asset.data)
  const { scene, fromStore } = await withStoredFiles(root, asset.path, parsed)
  return { scene, path: asset.path, mtime: asset.mtime, stored: scene.picturesOut === true ? fromStore : Object.keys(scene.files ?? {}) }
}

/** A board past the asset pipe's cap, through `drawing:load`: its scene, its pictures engine-shaped, and the mtime a save guards with. */
async function openLargeDrawing(root: string, path: string): Promise<LoadedDrawing> {
  const res = await api.drawing.load({ root, path })
  const scene = parseSceneText(res.json)
  const files: Record<string, unknown> = {}
  const created = Date.now()
  for (const [id, entry] of Object.entries(res.files)) files[id] = { id, mimeType: entry.mimeType, dataURL: entry.dataURL, created }
  return { scene: { ...scene, files }, path: res.path, mtime: res.mtime, stored: res.stored }
}

/** `scene` with every referenced picture it lacks taken from the store (see `openDrawing`), and the ids that came from there. */
async function withStoredFiles(root: string, path: string, scene: DrawingScene): Promise<{ scene: DrawingScene; fromStore: string[] }> {
  const own = scene.files ?? {}
  const missing = [...referencedFileIds(scene.elements)].filter((id) => !(id in own))
  if (missing.length === 0) return { scene, fromStore: [] }
  const stored: Record<string, DrawingFileEntry> = await api.drawing.load({ root, path }).then(
    (res) => res.files,
    () => ({}),
  )
  const files: Record<string, unknown> = { ...own }
  const fromStore: string[] = []
  const created = Date.now()
  for (const id of missing) {
    const entry = stored[id]
    if (entry === undefined) continue
    files[id] = { id, mimeType: entry.mimeType, dataURL: entry.dataURL, created }
    fromStore.push(id)
  }
  return { scene: { ...scene, files }, fromStore }
}

/**
 * A drawing TAB's scene text (`drawing:load`'s `json`, Draw's 🔒 YAZ-1810) → the canvas's opening
 * scene; throws on anything that is not one, which the tab shows as its ONE readable error pane.
 */
export function parseSceneText(text: string): DrawingScene {
  const parsed: unknown = JSON.parse(text)
  if (!isRecord(parsed)) throw new Error('not an Excalidraw scene')
  if (!Array.isArray(parsed.elements)) throw new Error('not an Excalidraw scene: no elements')
  // The same `isRecord` the whole scene got: a file whose `appState` is an ARRAY carries no prefs, not a list.
  return { elements: parsed.elements, appState: isRecord(parsed.appState) ? parsed.appState : {}, files: isRecord(parsed.files) ? parsed.files : {}, ...readOnlyOf(parsed) }
}

/**
 * The view a drawing OPENS on (Draw's 🔒 YAZ-1855 D1, fit-on-open): the engine's
 * `initialState.viewport`, fitting every live element and never zooming past 100% (`scale-down`;
 * the engine floors it at 10%). An empty drawing has nothing to fit, so `undefined` leaves the
 * engine at its own 100%.
 */
export function openViewport(scene: DrawingScene): { viewport: { target: readonly unknown[]; fit: 'scale-down' } } | undefined {
  const target = scene.elements.filter((e) => isRecord(e) && e.isDeleted !== true)
  return target.length > 0 ? { viewport: { target, fit: 'scale-down' } } : undefined
}

/** A drawing read for a PICTURE (YAZ-4834 A19): the sidebar's hover picture and an embed's window read it this way. */
export interface DrawingForPicture {
  engine: ExcalidrawModule
  /** The file's own appState (its background colour). */
  appState: Record<string, unknown>
  /** Restored as the canvas would, the soft-deleted left out; none means nothing to draw. */
  elements: unknown[]
  /** The image map exactly as the editor builds it (`DrawingEditor`'s `toDocument`). */
  files: Record<string, unknown>
}

/** Reads `path` through `drawing:load` (pictures in it at most `imageMaxPx`) and restores it for a picture. */
export async function readDrawingForPicture(root: string, path: string, imageMaxPx: number): Promise<DrawingForPicture> {
  const [res, engine] = await Promise.all([api.drawing.load({ root, path, imageMaxPx }), loadExcalidraw()])
  const parsed = parseSceneText(res.json)
  const elements = visibleElements(engine.restoreElements(parsed.elements as never, null) as unknown[])
  const files: Record<string, unknown> = {}
  const created = Date.now()
  for (const [id, entry] of Object.entries(res.files)) files[id] = { id, mimeType: entry.mimeType, dataURL: entry.dataURL, created }
  return { engine, appState: parsed.appState, elements, files }
}
