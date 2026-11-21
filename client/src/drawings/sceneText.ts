/**
 * A DRAWING'S SCENE TEXT → ITS SCENE (YAZ-3028, Draw's YAZ-1810), with no bridge: moved out of `drawingScene.ts` by
 * YAZ-5440, so the phone reads a drawing with the Mac's own rule. `drawingScene.ts` exports it under the same names.
 */
import type { FoldArrowMode } from '@shared/types'
import { BOARD_META_KEY, boardFoldArrowsOf, boardHoverOutlineOf, hoverLinksOff, picturesFolderOf, picturesOut } from '@shared/drawingAssets'
import { isRecord } from '@shared/guards'
import { isDrawingReadOnly } from '@shared/readOnly'

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
export const readOnlyOf = (scene: Record<string, unknown>): { readOnly?: true; picturesOut?: true; picturesFolder?: string; hoverLinksOff?: true; foldArrows?: FoldArrowMode; hoverOutline?: boolean } => ({
  ...(isDrawingReadOnly(scene) ? { readOnly: true } : {}),
  ...(picturesOut(scene[BOARD_META_KEY]) ? { picturesOut: true } : {}),
  ...(picturesFolderOf(scene[BOARD_META_KEY]) === null ? {} : { picturesFolder: picturesFolderOf(scene[BOARD_META_KEY]) as string }),
  ...(hoverLinksOff(scene[BOARD_META_KEY]) ? { hoverLinksOff: true } : {}),
  ...(boardFoldArrowsOf(scene[BOARD_META_KEY]) === null ? {} : { foldArrows: boardFoldArrowsOf(scene[BOARD_META_KEY]) as FoldArrowMode }),
  ...(boardHoverOutlineOf(scene[BOARD_META_KEY]) === null ? {} : { hoverOutline: boardHoverOutlineOf(scene[BOARD_META_KEY]) as boolean }),
})

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
