/**
 * WHAT HAPPENS WHEN A TILE IS CLICKED (YAZ-1818): `excalidraw-app/image-studio/insertShape.ts`
 * ported, plus the image half the web app kept inline in `ImageStudio.tsx`.
 *
 * TWO KINDS OF INSERT, AND THEY ARE NOT THE SAME THING.
 * - A SHAPE becomes native elements: `convertToExcalidrawElements` over the catalog's skeletons,
 *   appended to the scene and left SELECTED, so the next drag or keystroke acts on what was just
 *   placed. Nothing is fetched and nothing is written to disk — a shape is geometry.
 * - An IMAGE becomes a `File` handed to the engine's own `insertImages`, which is the door that
 *   knows how to make an image element, register its bytes and size it. The bytes then become an
 *   `assets/` file through the save path built in YAZ-1811 (🔒 YAZ-1775 D3): the engine's files map grows an id
 *   the store does not hold, `unpersistedFiles` picks it up, and `drawing:save` writes it BEFORE
 *   the scene that names it. Nothing here touches the disk either.
 *
 * `IMAGE_STUDIO_INSERTION` IS COPIED, NOT IMPORTED. The fork exports it from
 * `packages/excalidraw/data/viewportInsertion.ts`, but the vendored build maps that subpath to
 * TYPES ONLY — there is no runtime module behind `@excalidraw/excalidraw/data/viewportInsertion`.
 * The two numbers are copied here with the fork's own values, the way `formFactor.ts` copies the
 * breakpoints, and the TYPE still comes from the package so a change in its shape is a build error.
 *
 * ENGINE-BOUND BY DESIGN: the module takes the LOADED engine as an argument rather than importing
 * the package (`engine.ts`'s lazy rule).
 */
import type { ViewportInsertionRequest } from '@excalidraw/excalidraw/data/viewportInsertion'
import type { MediaImportResponse, StudioItem } from '@shared/types'
import type { ExcalidrawImperativeApi, ExcalidrawModule } from '../drawings/engine'
import type { ShapeCatalogItem, ShapeInsertStyle } from './shapes'

/**
 * How big an Image Studio insert lands: 320 px on its longest side at the current zoom, capped at
 * 55 % of the visible canvas. The fork's own constants
 * (`packages/excalidraw/data/viewportInsertion.ts:6-9`) — a graphic dropped on a board should read
 * as an element, not as a wallpaper.
 */
export const IMAGE_STUDIO_INSERTION: ViewportInsertionRequest = { targetScreenSize: 320, viewportFraction: 0.55 }

/**
 * The slice of the engine's imperative handle an insert uses — narrowed from the engine's OWN
 * type (`engine.ts`'s `ExcalidrawImperativeApi`) rather than re-declared, so a change to any of
 * the four signatures is a build error here instead of a runtime surprise. A test passes a stub
 * through one cast.
 */
export type InsertTarget = Pick<ExcalidrawImperativeApi, 'getAppState' | 'getSceneElementsIncludingDeleted' | 'updateScene' | 'insertImages'>

/** The engine values an insert needs; both are on `@excalidraw/excalidraw`'s own index. */
export type InsertEngine = Pick<ExcalidrawModule, 'convertToExcalidrawElements' | 'CaptureUpdateAction'>

export interface InsertShapeOptions {
  /** Whether stroke width and style scale follow `appState.zoom.value` (Settings › Drawings › New shapes match the zoom). */
  scaleStylesWithZoom?: boolean
}

const STROKE_WIDTH_BY_KEY: Record<string, number> = { thin: 1, medium: 2, bold: 4 }
const VALID_FILL_STYLES = new Set<NonNullable<ShapeInsertStyle['fillStyle']>>(['solid', 'hachure', 'cross-hatch', 'zigzag'])

/** Matches `engine/packages/element/src/screenScale.ts`'s `toBoardSize` without eagerly importing `@excalidraw/element`. */
const toBoardSize = (screen: number, scale: number): number => (scale === 1 ? screen : Number((screen / scale).toPrecision(4)))

/**
 * Place `shape` at the middle of what the user can see, styled from the board's active `currentItem*`
 * properties and scaled to the current zoom, then select it. `CaptureUpdateAction.IMMEDIATELY` puts
 * the insert in the undo stack as one step.
 */
export function insertShape(
  engine: InsertEngine,
  api: InsertTarget,
  shape: ShapeCatalogItem,
  options?: InsertShapeOptions,
): ReturnType<ExcalidrawModule['convertToExcalidrawElements']> {
  const appState = api.getAppState()
  const zoom = Number.isFinite(appState.zoom?.value) && appState.zoom.value > 0 ? appState.zoom.value : 1
  const centerX = appState.width / 2 / zoom - appState.scrollX
  const centerY = appState.height / 2 / zoom - appState.scrollY

  // Size scale: default `1 / zoom` so shapes land at consistent screen size, clamped to 55 % of the visible viewport.
  const baseScale = 1 / zoom
  const longestSide = Math.max(shape.width ?? 200, shape.height ?? 200)
  const minViewport = Math.min(appState.width, appState.height)
  const maxBoardSide = Number.isFinite(minViewport) && minViewport > 0 ? (minViewport * IMAGE_STUDIO_INSERTION.viewportFraction) / zoom : Infinity
  const sizeScale = longestSide > 0 && longestSide * baseScale > maxBoardSide ? maxBoardSide / longestSide : baseScale

  const rawStrokeWidth =
    typeof appState.currentItemVectorStrokeWidth === 'number' && Number.isFinite(appState.currentItemVectorStrokeWidth)
      ? appState.currentItemVectorStrokeWidth
      : typeof appState.currentItemStrokeWidthKey === 'string' && appState.currentItemStrokeWidthKey in STROKE_WIDTH_BY_KEY
        ? STROKE_WIDTH_BY_KEY[appState.currentItemStrokeWidthKey]
        : 2

  const scaleStyles = options?.scaleStylesWithZoom ?? true
  const styleScale = scaleStyles && zoom !== 1 ? Number(zoom.toPrecision(4)) : undefined
  const strokeWidth = scaleStyles && zoom !== 1 ? toBoardSize(rawStrokeWidth, zoom) : rawStrokeWidth

  const fillStyle = VALID_FILL_STYLES.has(appState.currentItemFillStyle as NonNullable<ShapeInsertStyle['fillStyle']>)
    ? (appState.currentItemFillStyle as ShapeInsertStyle['fillStyle'])
    : undefined

  const style: ShapeInsertStyle = {
    strokeColor: typeof appState.currentItemStrokeColor === 'string' && appState.currentItemStrokeColor !== '' ? appState.currentItemStrokeColor : undefined,
    backgroundColor: typeof appState.currentItemBackgroundColor === 'string' && appState.currentItemBackgroundColor !== '' ? appState.currentItemBackgroundColor : undefined,
    fillStyle,
    strokeWidth,
    roughness: typeof appState.currentItemRoughness === 'number' && Number.isFinite(appState.currentItemRoughness) ? appState.currentItemRoughness : undefined,
    sizeScale,
    styleScale,
  }

  const elements = engine.convertToExcalidrawElements(shape.create(centerX, centerY, style))
  const selectedElementIds = Object.fromEntries(elements.map((element) => [element.id, true as const]))
  api.updateScene({
    elements: [...api.getSceneElementsIncludingDeleted(), ...elements],
    appState: { selectedElementIds },
    captureUpdate: engine.CaptureUpdateAction.IMMEDIATELY,
  })
  return elements
}

/** The extension a mime deserves; the engine only cares that the name and the type agree. */
export function extensionForMime(mimeType: string): string {
  switch (mimeType) {
    case 'image/svg+xml':
      return 'svg'
    case 'image/png':
      return 'png'
    case 'image/webp':
      return 'webp'
    case 'image/gif':
      return 'gif'
    default:
      return 'jpg'
  }
}

/** `data:<mime>;base64,<...>` → bytes. Main built the dataURL; this is the only place it is undone. */
export function bytesFromDataUrl(dataURL: string): Uint8Array {
  const comma = dataURL.indexOf(',')
  const binary = atob(dataURL.slice(comma + 1))
  const bytes = new Uint8Array(binary.length)
  for (let index = 0; index < binary.length; index++) bytes[index] = binary.charCodeAt(index)
  return bytes
}

/**
 * The imported bytes as the `File` the engine's image door takes. The name carries the provider id
 * with its colon flattened, so an icon lands on the board as `noto-money-bag.svg` rather than as
 * something the filesystem would argue with — and the engine's own content-addressing (🔒 YAZ-1775 D3)
 * means the same picture twice is still one `assets/` file whatever it was called.
 */
export function fileFromImport(item: Pick<StudioItem, 'providerId'>, imported: Pick<MediaImportResponse, 'mimeType' | 'dataURL'>): File {
  const extension = extensionForMime(imported.mimeType)
  return new File([bytesFromDataUrl(imported.dataURL) as BlobPart], `${item.providerId.replaceAll(':', '-')}.${extension}`, { type: imported.mimeType })
}

/** Hand the file to the engine at Image Studio size; it picks the position and registers the bytes. */
export async function insertImage(api: InsertTarget, file: File): Promise<void> {
  await api.insertImages([file], undefined, undefined, { viewportSizing: IMAGE_STUDIO_INSERTION })
}
