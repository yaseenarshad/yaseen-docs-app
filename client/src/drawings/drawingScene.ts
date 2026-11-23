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
import type { DrawingFileEntry } from '@shared/types'
import { referencedFileIds } from '@shared/drawingAssets'
import { isDrawing } from '@shared/fileKind'
import { isRecord } from '@shared/guards'
import { api, BridgeRequestError } from '../api'
import { restoreForPicture } from './drawingPicture'
import { loadExcalidraw, type ExcalidrawModule } from './engine'
import { parseSceneText, readOnlyOf, type DrawingScene } from './sceneText'

// YAZ-5440: the scene text's parse is the phone's too, so it lives in `sceneText.ts` (no bridge); its name stays here.
export { parseSceneText, type DrawingScene }

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
  const elements = restoreForPicture(engine, parsed.elements)
  const files: Record<string, unknown> = {}
  const created = Date.now()
  for (const [id, entry] of Object.entries(res.files)) files[id] = { id, mimeType: entry.mimeType, dataURL: entry.dataURL, created }
  return { engine, appState: parsed.appState, elements, files }
}

/** Opens an inline Excalidraw drawing from `.md` JSON text, resolving any referenced images from `<root>/assets/` (YAZ-5040). */
export async function openInlineDrawing(root: string, json: string, pagePath: string): Promise<LoadedDrawing> {
  const parsed = parseSceneText(json)
  const own = parsed.files ?? {}
  const missing = [...referencedFileIds(parsed.elements)].filter((id) => !(id in own))
  const files: Record<string, unknown> = { ...own }
  const stored: string[] = []
  if (missing.length > 0 && root !== '') {
    const resolved = await api.drawing.resolveAssets({ root, fileIds: missing }).catch(() => ({ files: {} as Record<string, DrawingFileEntry>, stored: [] as string[] }))
    const created = Date.now()
    for (const [id, entry] of Object.entries(resolved.files)) {
      files[id] = { id, mimeType: entry.mimeType, dataURL: entry.dataURL, created }
    }
    stored.push(...resolved.stored)
  }
  return { scene: { ...parsed, files }, path: pagePath, mtime: 0, stored }
}

/** Reads an inline Excalidraw JSON string for a preview window picture, resolving images from `<root>/assets/` (YAZ-5040). */
export async function readInlineDrawingForPicture(root: string, json: string, imageMaxPx: number): Promise<DrawingForPicture> {
  const parsed = parseSceneText(json)
  const missing = [...referencedFileIds(parsed.elements)].filter((id) => parsed.files === null || !(id in parsed.files))
  const [resolved, engine] = await Promise.all([
    missing.length > 0 && root !== ''
      ? api.drawing.resolveAssets({ root, fileIds: missing, imageMaxPx }).catch(() => ({ files: {} as Record<string, DrawingFileEntry>, stored: [] as string[] }))
      : Promise.resolve({ files: {} as Record<string, DrawingFileEntry>, stored: [] as string[] }),
    loadExcalidraw(),
  ])
  const elements = restoreForPicture(engine, parsed.elements)
  const files: Record<string, unknown> = { ...parsed.files }
  const created = Date.now()
  for (const [id, entry] of Object.entries(resolved.files)) {
    files[id] = { id, mimeType: entry.mimeType, dataURL: entry.dataURL, created }
  }
  return { engine, appState: parsed.appState, elements, files }
}
