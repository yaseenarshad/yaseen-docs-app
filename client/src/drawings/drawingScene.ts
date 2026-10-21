/**
 * Reading a drawing back off disk: the note embed's sidecar (YAZ-878) and, since YAZ-3028, the
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
 * preview's ONE broken state (never a crash, `editor/drawing/drawingPreview.ts`). No repair, no
 * partial render: a half-parsed scene would be a lie about what the file holds.
 */
import type { DrawingFileEntry } from '@shared/types'
import { referencedFileIds } from '@shared/drawingAssets'
import { isRecord } from '@shared/guards'
import { api } from '../api'

/** The scene shape a preview needs; deliberately loose — the file is user data, not our type. */
export interface DrawingScene {
  /** Excalidraw elements exactly as the file holds them; validated only as "an array". */
  readonly elements: readonly unknown[]
  /** Optional in the file (YAZ-877 writes `{}`); missing = Excalidraw's own defaults. */
  readonly appState: Record<string, unknown>
  /** The binary-asset map; `null` when the file has none, which is what exportToSvg wants. */
  readonly files: Record<string, unknown> | null
}

/** Embed targets that get a preview — everything else renders exactly as it always has. */
export const DRAWING_EMBED_SUFFIX = '.excalidraw'

/** True for `Sketch.excalidraw` / `assets/drawings/Sketch.excalidraw` (case-insensitive, like readAsset). */
export function isDrawingTarget(target: string): boolean {
  return target.toLowerCase().endsWith(DRAWING_EMBED_SUFFIX)
}

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
  return { elements: scene.elements, appState, files }
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
}

/**
 * Reads `target` under `root` and parses it, keeping the identity a save needs.
 *
 * A scene a drawing TAB saved is lean (YAZ-3028: `files: {}`, its pictures in `<vault>/assets/`), so
 * a picture the scene names but does not carry is filled in from the store through `drawing:load`
 * at the resolved path — one extra read, and only for such a scene: an embed's own sidecar carries
 * its pictures and never pays it. An id found nowhere stays out (the engine's placeholder), and a
 * store read that fails leaves the scene as the sidecar said: a picture must never cost the drawing.
 */
export async function openDrawing(root: string, target: string): Promise<LoadedDrawing> {
  const asset = await api.readAsset(root, target)
  const scene = parseScene(asset.data)
  return { scene: await withStoredFiles(root, asset.path, scene), path: asset.path, mtime: asset.mtime }
}

/** `scene` with every referenced picture it lacks taken from the store (see `openDrawing`). */
async function withStoredFiles(root: string, path: string, scene: DrawingScene): Promise<DrawingScene> {
  const own = scene.files ?? {}
  const missing = [...referencedFileIds(scene.elements)].filter((id) => !(id in own))
  if (missing.length === 0) return scene
  const stored: Record<string, DrawingFileEntry> = await api.drawing.load({ root, path }).then(
    (res) => res.files,
    () => ({}),
  )
  const files: Record<string, unknown> = { ...own }
  const created = Date.now()
  for (const id of missing) {
    const entry = stored[id]
    if (entry !== undefined) files[id] = { id, mimeType: entry.mimeType, dataURL: entry.dataURL, created }
  }
  return { ...scene, files }
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
  return { elements: parsed.elements, appState: isRecord(parsed.appState) ? parsed.appState : {}, files: isRecord(parsed.files) ? parsed.files : {} }
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

/** Reads `target` under `root` and parses it; rejects for the preview's broken state. */
export async function loadDrawingScene(root: string, target: string): Promise<DrawingScene> {
  return (await openDrawing(root, target)).scene
}
