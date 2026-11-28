/**
 * THE SHAPES CATALOG (YAZ-1818, YAZ-6669): `excalidraw-app/image-studio/shapes.ts` from the web app, ported.
 * Seven basic shapes drawn by hand, plus all 47 engine Smart Shapes across five categories (basic, arrows,
 * brackets & braces, callouts, banners & flow) — each inserted as a NATIVE element with the `yasinSmartShape`
 * metadata that makes its handles work, not as a picture of one.
 *
 * TWO HALVES, BECAUSE ONE OF THEM COSTS 300 kB. The basics need nothing but arithmetic, so they
 * are a module constant. The Smart Shapes need `SMART_SHAPE_DEFINITIONS` and the point generator
 * out of `@excalidraw/element`, which is why `buildShapeCatalog` takes that module as an argument
 * (`engine.ts`'s `loadExcalidrawElement()` supplies it, lazily): the view renders the basics at
 * once and grows the rest when the package lands. It also makes the whole catalog testable with a
 * hand-written stand-in and no engine at all.
 *
 * PREVIEWS ARE PRECOMPUTED. The web app called `getSmartShapePreview(kind)` from inside the
 * render and re-derived a polygon per tile per frame; building the same polygon once, when the
 * catalog is built, is the same picture — and it is what lets a test assert the geometry without
 * a DOM.
 *
 * `pointFrom` IS COPIED, NOT IMPORTED (`@excalidraw/math`'s one-liner: the tuple, branded). Its
 * package is engine tree too, and the `formFactor.ts` precedent applies — a value import would
 * pull it into the entry chunk for the sake of `[x, y]`.
 */
import type { ExcalidrawElementSkeleton, SmartShapeDefinition, SmartShapeId, SmartShapeMetadata } from '@excalidraw/element'
import type { LocalPoint } from '@excalidraw/math'

/** The three values the Smart Shapes need out of `@excalidraw/element`, and nothing else. */
export interface SmartShapeApi {
  SMART_SHAPE_DEFINITIONS: readonly SmartShapeDefinition[]
  generateSmartShapePoints: (id: SmartShapeId, width: number, height: number, parameters: Record<string, number>) => LocalPoint[]
  createSmartShapeMetadata: (id: SmartShapeId) => SmartShapeMetadata
}

/** The seven hand-drawn tile pictures; a smart shape draws its own polygon instead. */
export type BasicPreviewShape = 'rectangle' | 'rounded-rectangle' | 'ellipse' | 'diamond' | 'triangle' | 'hexagon' | 'star'

/** The five browser sections in the Add › Shapes view (YAZ-6676 D5). */
export type ShapeCategory = 'basic' | 'arrows' | 'brackets' | 'callouts' | 'banners'

export const SHAPE_CATEGORIES: readonly ShapeCategory[] = ['basic', 'arrows', 'brackets', 'callouts', 'banners']

export const SHAPE_CATEGORY_LABELS: Record<ShapeCategory, string> = {
  basic: 'Basic',
  arrows: 'Arrows',
  brackets: 'Brackets & Braces',
  callouts: 'Callouts',
  banners: 'Banners & Flow',
}

/** Board style and zoom scaling applied when a shape is inserted from the Add panel (YAZ-6675 D3). */
export interface ShapeInsertStyle {
  strokeColor?: string
  backgroundColor?: string
  fillStyle?: 'solid' | 'hachure' | 'cross-hatch' | 'zigzag'
  strokeWidth?: number
  roughness?: number
  sizeScale?: number
  styleScale?: number
}

/** What a tile draws: one of the seven stock outlines, or a smart shape's own generated path. */
export type ShapePreview = { type: 'basic'; shape: BasicPreviewShape } | { type: 'smart'; closed: boolean; points: string; viewBox: string }

export interface ShapeCatalogItem {
  id: string
  title: string
  preview: ShapePreview
  category: ShapeCategory
  kind: string
  width: number
  height: number
  direction?: 'right' | 'left' | 'up' | 'down'
  aliases: readonly string[]
  /** The skeletons to insert, centred on a scene point. */
  create: (x: number, y: number, style?: ShapeInsertStyle) => ExcalidrawElementSkeleton[]
}

/** `pointFrom<LocalPoint>(x, y)` — the branded tuple, without importing the package for it. */
const localPoint = (x: number, y: number): LocalPoint => [x, y] as unknown as LocalPoint

const validPositive = (value: number | undefined, fallback: number): number =>
  value !== undefined && Number.isFinite(value) && value > 0 ? value : fallback

const resolvedStyleScale = (value: number | undefined): number | undefined =>
  value !== undefined && Number.isFinite(value) && value > 0 && value !== 1 ? value : undefined

/** Default stroke when no board style is passed: Architect (`roughness: 0`, YAZ-6675 D3). */
const common = {
  strokeColor: '#1b1b1f',
  backgroundColor: 'transparent',
  fillStyle: 'solid' as const,
  strokeWidth: 2 as const,
  roughness: 0 as const,
}

function resolveBasicStyle(style?: ShapeInsertStyle) {
  return {
    strokeColor: style?.strokeColor ?? common.strokeColor,
    backgroundColor: style?.backgroundColor ?? common.backgroundColor,
    fillStyle: style?.fillStyle ?? common.fillStyle,
    strokeWidth: style?.strokeWidth ?? common.strokeWidth,
    roughness: style?.roughness ?? common.roughness,
    sizeScale: validPositive(style?.sizeScale, 1),
    styleScale: resolvedStyleScale(style?.styleScale),
  }
}

const box = (type: 'rectangle' | 'ellipse' | 'diamond', x: number, y: number, style?: ShapeInsertStyle): ExcalidrawElementSkeleton[] => {
  const { strokeColor, backgroundColor, fillStyle, strokeWidth, roughness, sizeScale, styleScale } = resolveBasicStyle(style)
  const width = 160 * sizeScale
  const height = 110 * sizeScale
  return [
    {
      type,
      x: x - width / 2,
      y: y - height / 2,
      width,
      height,
      strokeColor,
      backgroundColor,
      fillStyle,
      strokeWidth,
      roughness,
      ...(styleScale !== undefined ? { customData: { styleScale } } : {}),
    },
  ]
}

/** A closed outline: the ring is shut HERE, so no caller has to repeat its first point as its last. */
const polygon = (x: number, y: number, points: readonly (readonly [number, number])[], style?: ShapeInsertStyle): ExcalidrawElementSkeleton[] => {
  const { strokeColor, backgroundColor, fillStyle, strokeWidth, roughness, sizeScale, styleScale } = resolveBasicStyle(style)
  const width = 160 * sizeScale
  const height = 140 * sizeScale
  return [
    {
      type: 'line',
      x: x - width / 2,
      y: y - height / 2,
      width,
      height,
      points: [...points, points[0]].map(([pointX, pointY]) => localPoint(pointX * sizeScale, pointY * sizeScale)),
      strokeColor,
      backgroundColor,
      fillStyle,
      strokeWidth,
      roughness,
      ...(styleScale !== undefined ? { customData: { styleScale } } : {}),
    },
  ]
}

const basic = (shape: BasicPreviewShape): ShapePreview => ({ type: 'basic', shape })

/** The seven the engine has no definition for; no package needed to draw or to insert them. */
export const BASIC_SHAPES: readonly ShapeCatalogItem[] = [
  { id: 'rectangle', title: 'Rectangle', preview: basic('rectangle'), category: 'basic', kind: 'basic', width: 160, height: 110, aliases: ['box', 'square'], create: (x, y, style) => box('rectangle', x, y, style) },
  {
    id: 'rounded-rectangle',
    title: 'Rounded rectangle',
    preview: basic('rounded-rectangle'),
    category: 'basic',
    kind: 'basic',
    width: 160,
    height: 110,
    aliases: ['rounded box'],
    create: (x, y, style) => [{ ...box('rectangle', x, y, style)[0], roundness: { type: 3 } } as ExcalidrawElementSkeleton],
  },
  { id: 'circle', title: 'Circle', preview: basic('ellipse'), category: 'basic', kind: 'basic', width: 160, height: 110, aliases: ['ellipse', 'oval'], create: (x, y, style) => box('ellipse', x, y, style) },
  { id: 'diamond', title: 'Diamond', preview: basic('diamond'), category: 'basic', kind: 'basic', width: 160, height: 110, aliases: ['rhombus', 'decision'], create: (x, y, style) => box('diamond', x, y, style) },
  {
    id: 'triangle',
    title: 'Triangle',
    preview: basic('triangle'),
    category: 'basic',
    kind: 'polygon',
    width: 160,
    height: 140,
    aliases: ['three sided'],
    create: (x, y, style) =>
      polygon(
        x,
        y,
        [
          [80, 0],
          [160, 140],
          [0, 140],
        ],
        style,
      ),
  },
  {
    id: 'hexagon',
    title: 'Hexagon',
    preview: basic('hexagon'),
    category: 'basic',
    kind: 'polygon',
    width: 160,
    height: 140,
    aliases: ['six sided'],
    create: (x, y, style) =>
      polygon(
        x,
        y,
        [
          [40, 0],
          [120, 0],
          [160, 70],
          [120, 140],
          [40, 140],
          [0, 70],
        ],
        style,
      ),
  },
  {
    id: 'star',
    title: 'Star',
    preview: basic('star'),
    category: 'basic',
    kind: 'polygon',
    width: 160,
    height: 140,
    aliases: ['favorite'],
    create: (x, y, style) =>
      polygon(
        x,
        y,
        [
          [80, 0],
          [99, 52],
          [156, 54],
          [111, 88],
          [127, 140],
          [80, 109],
          [33, 140],
          [49, 88],
          [4, 54],
          [61, 52],
        ],
        style,
      ),
  },
]

/** `arrow-right` → `right`; a shape with no direction in its id has none. */
export function shapeDirection(id: string): ShapeCatalogItem['direction'] {
  const direction = id.match(/-(right|left|up|down)$/)?.[1]
  return direction === 'right' || direction === 'left' || direction === 'up' || direction === 'down' ? direction : undefined
}

/** The words someone would search for that are not already in the title — one set per smart kind. */
export function smartShapeAliases(kind: string): readonly string[] {
  switch (kind) {
    case 'filled-arrow':
      return ['arrow', 'pointer', 'filled']
    case 'curved-arrow':
      return ['arrow', 'curve', 'bend', 'turn']
    case 'u-turn-arrow':
      return ['arrow', 'u turn', 'uturn', 'return', 'back']
    case 'double-arrow':
      return ['arrow', 'two way', 'both ways', 'bidirectional']
    case 'circle-arrow':
      return ['arrow', 'circular', 'refresh', 'rotate', 'cycle', 'loop']
    case 'bent-arrow':
      return ['arrow', 'elbow', 'l arrow', 'turn', 'corner', 'right angle']
    case 'pentagon-arrow':
      return ['arrow', 'process', 'step', 'flow', 'block', 'banner']
    case 'notched-arrow':
      return ['arrow', 'chevron', 'process', 'step', 'flow', 'block']
    case 'chevron':
      return ['arrowhead', 'direction', 'angle']
    case 'brace':
      return ['curly', 'curly bracket', 'group']
    case 'bracket':
      return ['square bracket', 'group']
    case 'parenthesis':
      return ['paren', 'round bracket']
    case 'callout':
      return ['speech', 'bubble', 'annotation', 'label', 'comment']
    case 'cloud':
      return ['thought', 'bubble', 'weather', 'sky', 'callout']
    case 'note-fold':
      return ['sticky', 'page', 'memo', 'corner', 'paper', 'sheet']
    case 'document':
      return ['page', 'file', 'paper', 'sheet', 'wave', 'report']
    case 'pill':
      return ['capsule', 'stadium', 'lozenge', 'button', 'badge', 'rounded']
    case 'right-triangle':
      return ['triangle', 'corner', 'wedge', '90']
    case 'pentagon':
      return ['five sided', 'polygon', 'house']
    case 'octagon':
      return ['eight sided', 'polygon', 'stop', 'sign']
    case 'parallelogram':
      return ['slanted', 'skew', 'flowchart', 'input', 'output', 'data']
    case 'trapezoid':
      return ['trapezium', 'funnel', 'stage', 'polygon']
    case 'plus':
      return ['cross', 'add', 'medical', 'positive']
    case 'star-4':
      return ['sparkle', 'diamond star', 'four point', 'twinkle', 'glint']
    case 'starburst':
      return ['seal', 'badge', 'burst', 'explosion', 'sticker', 'sunburst']
    case 'heart':
      return ['love', 'like', 'favorite', 'card']
    case 'semicircle':
      return ['half circle', 'arch', 'dome', 'arc']
    case 'bookmark':
      return ['ribbon', 'flag', 'save', 'marker', 'banner']
    case 'tag':
      return ['label', 'price', 'badge', 'ticket']
    case 'shield':
      return ['security', 'badge', 'protect', 'crest', 'guard']
    case 'ribbon':
      return ['banner', 'flag', 'scroll', 'award', 'title']
    case 'cylinder':
      return ['database', 'drum', 'can', 'storage', 'flowchart', 'db']
    default:
      return []
  }
}

/**
 * The tile drawing for one smart shape: the engine's own points, in a viewBox padded by 8 % of the
 * larger side so a stroke is never clipped.
 */
export function smartShapePreview(smart: SmartShapeApi, definition: SmartShapeDefinition): Extract<ShapePreview, { type: 'smart' }> {
  const points = smart.generateSmartShapePoints(definition.id, definition.width, definition.height, definition.defaults)
  const xValues = points.map(([x]) => x)
  const yValues = points.map(([, y]) => y)
  const minX = Math.min(...xValues)
  const minY = Math.min(...yValues)
  const maxX = Math.max(...xValues)
  const maxY = Math.max(...yValues)
  const padding = Math.max(maxX - minX, maxY - minY) * 0.08
  return {
    type: 'smart',
    closed: definition.closed,
    points: points.map(([x, y]) => `${x},${y}`).join(' '),
    viewBox: `${minX - padding} ${minY - padding} ${maxX - minX + padding * 2} ${maxY - minY + padding * 2}`,
  }
}

/**
 * ONE line element carrying the engine's `yasinSmartShape` metadata — which is what makes the
 * inserted shape a real smart shape with its own handles, rather than a frozen polygon.
 */
function smartShapeSkeleton(smart: SmartShapeApi, definition: SmartShapeDefinition, x: number, y: number, style?: ShapeInsertStyle): ExcalidrawElementSkeleton[] {
  const strokeColor = style?.strokeColor ?? common.strokeColor
  const backgroundColor = !definition.closed
    ? 'transparent'
    : style?.backgroundColor && style.backgroundColor !== 'transparent'
      ? style.backgroundColor
      : strokeColor
  const fillStyle = style?.fillStyle ?? common.fillStyle
  const strokeWidth = style?.strokeWidth ?? common.strokeWidth
  const roughness = style?.roughness ?? common.roughness
  const sizeScale = validPositive(style?.sizeScale, 1)
  const styleScale = resolvedStyleScale(style?.styleScale)
  const width = definition.width * sizeScale
  const height = definition.height * sizeScale
  const points = smart.generateSmartShapePoints(definition.id, width, height, definition.defaults)
  let minX = Infinity
  let minY = Infinity
  for (const [pointX, pointY] of points) {
    if (pointX < minX) minX = pointX
    if (pointY < minY) minY = pointY
  }
  const offsetX = Number.isFinite(minX) ? minX : 0
  const offsetY = Number.isFinite(minY) ? minY : 0
  return [
    {
      type: 'line',
      x: x - width / 2 - offsetX,
      y: y - height / 2 - offsetY,
      width,
      height,
      points,
      strokeColor,
      backgroundColor,
      fillStyle,
      strokeWidth,
      roughness,
      roundness: definition.roundness,
      customData: {
        yasinSmartShape: smart.createSmartShapeMetadata(definition.id),
        ...(styleScale !== undefined ? { styleScale } : {}),
      },
    } as ExcalidrawElementSkeleton,
  ]
}

/** The Smart Shapes, from whatever the engine defines — the app never lists them by name. */
export function smartShapeCatalog(smart: SmartShapeApi): ShapeCatalogItem[] {
  return smart.SMART_SHAPE_DEFINITIONS.map((definition) => ({
    id: `smart:${definition.id}`,
    title: definition.title,
    preview: smartShapePreview(smart, definition),
    category: definition.category,
    kind: definition.kind,
    width: definition.width,
    height: definition.height,
    direction: shapeDirection(definition.id),
    aliases: smartShapeAliases(definition.kind),
    create: (x: number, y: number, style?: ShapeInsertStyle) => smartShapeSkeleton(smart, definition, x, y, style),
  }))
}

/** The whole catalog; `null` is "the element package has not landed yet", not an error. */
export function buildShapeCatalog(smart: SmartShapeApi | null): ShapeCatalogItem[] {
  return smart === null ? [...BASIC_SHAPES] : [...BASIC_SHAPES, ...smartShapeCatalog(smart)]
}

/** The names a shape answers to besides its title — `rankItems`' aliases (YAZ-4157 D4): its id, kind, direction and alias words. */
export function shapeAliases(shape: ShapeCatalogItem): string[] {
  return [shape.id, shape.kind, ...(shape.direction ? [shape.direction] : []), ...shape.aliases]
}

export function getShape(catalog: readonly ShapeCatalogItem[], id: string): ShapeCatalogItem | undefined {
  return catalog.find((shape) => shape.id === id)
}
