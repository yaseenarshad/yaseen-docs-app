/**
 * A DRAWING'S PICTURE, ITS PURE CORE (YAZ-5440): the engine's `exportToSvg` with the embed's padding, background and
 * dark mode, and the picture's bounds and frames. Moved out of `editor/embed/boardPictures.ts` (YAZ-4825) with no
 * change, so the Mac's embed window and the phone's reader draw a drawing with ONE piece of code. No bridge, no
 * storage, no engine import, not even its type (the phone's typecheck would follow `engine.ts` into the editor): the
 * engine comes in as an argument (`engine.ts`'s lazy rule; on the phone, its own drawing chunk).
 */

/** The engine's `DEFAULT_EXPORT_PADDING`, which `exportToSvg` adds around the board. */
export const DRAWING_PADDING = 10

/** The engine values a picture needs (`ExcalidrawModule` has them). */
export interface PictureEngine {
  exportToSvg: (opts: never) => Promise<SVGSVGElement>
  getCommonBounds: (elements: never) => readonly [number, number, number, number]
  restoreElements: (elements: never, local: null) => readonly unknown[]
}

/** The elements a picture draws: everything not soft-deleted. None left means there is nothing to draw. */
export function visibleElements<T>(elements: readonly T[]): T[] {
  return elements.filter((element) => !(typeof element === 'object' && element !== null && (element as { isDeleted?: boolean }).isDeleted === true))
}

/** The board rectangle a picture covers, in board units: left, top, width, height. */
export interface PictureBounds {
  x: number
  y: number
  width: number
  height: number
}

/** A drawing's frame (YAZ-4825 item 1): "Frame ▸" fits the window to it. Board units. */
export interface BoardFrame {
  id: string
  name: string
  x: number
  y: number
  width: number
  height: number
}

export interface SceneElement {
  id: string
  type: string
  x: number
  y: number
  width: number
  height: number
  name?: string | null
  frameId?: string | null
  text?: string
  link?: string | null
}

/** The frames of a drawing, in scene order (item 1); a frame with no name gets the engine's default. */
export function framesOf(elements: readonly SceneElement[]): BoardFrame[] {
  return elements
    .filter((e) => e.type === 'frame' || e.type === 'magicframe')
    .map((e) => ({ id: e.id, name: e.name ?? (e.type === 'magicframe' ? 'AI Frame' : 'Frame'), x: e.x, y: e.y, width: e.width, height: e.height }))
}

/** A file's elements restored as the canvas would, the soft-deleted left out (the sidebar's hover picture's rule). */
export function restoreForPicture(engine: Pick<PictureEngine, 'restoreElements'>, elements: readonly unknown[]): unknown[] {
  return visibleElements(engine.restoreElements(elements as never, null) as unknown[])
}

/** A drawn picture: the SVG element the engine made, its bounds, its frames. */
export interface DrawnDrawing {
  svgEl: SVGSVGElement
  bounds: PictureBounds
  frames: BoardFrame[]
}

/**
 * Draws restored `elements` (not empty) as the embed's picture: the background, the theme's dark mode, the padding.
 * `opts` goes to the engine as it is (the phone passes `skipInliningFonts` and inlines its own fonts).
 */
export async function drawingSvg(
  engine: PictureEngine,
  scene: { elements: readonly unknown[]; appState: Record<string, unknown>; files: Record<string, unknown> | null },
  theme: 'light' | 'dark',
  opts?: { skipInliningFonts?: true },
): Promise<DrawnDrawing> {
  const elements = scene.elements as SceneElement[]
  const svgEl = await engine.exportToSvg({
    elements,
    appState: { ...scene.appState, exportBackground: true, exportWithDarkMode: theme === 'dark', exportPadding: DRAWING_PADDING },
    files: scene.files,
    ...(opts ?? {}),
  } as never)
  // The engine's canvas size (`getCanvasSize`): the common bounds of the root elements, plus the padding each side.
  const frameIds = new Set(elements.filter((e) => e.type === 'frame' || e.type === 'magicframe').map((e) => e.id))
  const roots = elements.filter((e) => frameIds.has(e.id) || !e.frameId || !frameIds.has(e.frameId))
  const [, , maxX, maxY] = engine.getCommonBounds(roots as never)
  const [, , width, height] = (svgEl.getAttribute('viewBox') ?? '0 0 0 0').split(/\s+/).map(Number)
  return { svgEl, bounds: { x: maxX + DRAWING_PADDING - width, y: maxY + DRAWING_PADDING - height, width, height }, frames: framesOf(elements) }
}
