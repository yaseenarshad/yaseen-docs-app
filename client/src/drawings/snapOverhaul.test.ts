/**
 * Unit tests for the YAZ-5986 Smart Snapping & Layout Overhaul (D1–D8, Adj #1, #3, #6, #8).
 */
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { DEFAULT_CANVAS_PREFS, SNAP_COLOR_PRESETS, SNAP_GAP_STYLES, type CanvasPrefs } from '@shared/types'
import { appStateToPrefs, isCanvasPrefs, prefsToAppState, sanitizeCanvasPrefs } from '@shared/canvasPrefs'

// Engine exports loaded via `@excalidraw/excalidraw` (built by `npm run engine:build`).
// Typed structurally here so `client/tsconfig.json` stays decoupled from engine internals.
type GlobalPoint = [number, number]
type InclusiveRange = [number, number]

type PointSnapLine = {
  type: 'points'
  points: GlobalPoint[]
  role?: 'edge' | 'center'
}

type PointerSnapLine = {
  type: 'pointer'
  points: [GlobalPoint, GlobalPoint]
  direction: 'horizontal' | 'vertical'
}

type GapSnapLine = {
  type: 'gap'
  direction: 'horizontal' | 'vertical'
  points: [GlobalPoint, GlobalPoint]
  distance?: number
  bandSpan?: InclusiveRange
  alwaysShowPill?: boolean
}

type SnapLine = PointSnapLine | GapSnapLine | PointerSnapLine

type Gap = {
  startBounds: [number, number, number, number]
  endBounds: [number, number, number, number]
  startSide: [GlobalPoint, GlobalPoint]
  endSide: [GlobalPoint, GlobalPoint]
  overlap: InclusiveRange
  length: number
}

type SnapEngine = {
  SnapCache: {
    setReferenceSnapPoints(points: GlobalPoint[] | null): void
    getReferenceSnapPoints(): GlobalPoint[] | null
    setReferenceSnapBoxes(boxes: unknown[] | null): void
    getReferenceSnapBoxes(): Array<{ minX: number; minY: number; maxX: number; maxY: number; cx: number; cy: number; isFrame?: boolean }> | null
    setVisibleGaps(gaps: { verticalGaps: Gap[]; horizontalGaps: Gap[] } | null): void
    getVisibleGaps(): { verticalGaps: Gap[]; horizontalGaps: Gap[] } | null
    destroy(): void
  }
  getSnapBounds(
    elements: readonly TestElement[],
    elementsMap: Map<string, TestElement>,
    dragOffset?: { x: number; y: number },
  ): [number, number, number, number]
  getSnapDistance(zoomValue: number): number
  getReferenceSnapPoints(elements: readonly TestElement[], selectedElements: readonly TestElement[], appState: TestAppState, elementsMap: Map<string, TestElement>): GlobalPoint[]
  getVisibleGaps(elements: readonly TestElement[], selectedElements: readonly TestElement[], appState: TestAppState, elementsMap: Map<string, TestElement>): { horizontalGaps: Gap[]; verticalGaps: Gap[] }
  snapDraggedElements(
    elements: TestElement[],
    dragOffset: { x: number; y: number },
    app: { props: { gridModeEnabled?: boolean }; state: TestAppState },
    event: { ctrlKey: boolean; metaKey: boolean; shiftKey: boolean; altKey: boolean },
    elementsMap: Map<string, TestElement>,
  ): { snapOffset: { x: number; y: number }; snapLines: SnapLine[] }
  getSnapLinesAtPointer(
    elements: readonly TestElement[],
    app: { props: { gridModeEnabled?: boolean }; state: TestAppState },
    pointer: { x: number; y: number },
    event: { ctrlKey: boolean; metaKey: boolean; shiftKey: boolean; altKey: boolean },
    elementsMap: Map<string, TestElement>,
  ): { originOffset: { x: number; y: number }; snapLines: PointerSnapLine[] }
  renderSnaps(context: CanvasRenderingContext2D, appState: TestAppState): void
  renderResizeSizeBadge(context: CanvasRenderingContext2D, appState: TestAppState, selectedElements: readonly TestElement[]): void
  preCompensateDarkFilter(hex: string): string
  SNAP_COLOR_LIGHT: string
  SNAP_COLOR_DARK: string
  snapResizingElements(
    selectedElements: readonly TestElement[],
    selectedOriginalElements: readonly TestElement[],
    app: { props: { gridModeEnabled?: boolean }; state: TestAppState },
    event: { ctrlKey: boolean; metaKey: boolean; shiftKey: boolean; altKey: boolean },
    dragOffset: { x: number; y: number },
    transformHandle: 'n' | 's' | 'e' | 'w' | 'ne' | 'nw' | 'se' | 'sw' | null,
  ): { snapOffset: { x: number; y: number }; snapLines: SnapLine[] }
  getAltHoverMeasureLines(
    selectedElements: readonly TestElement[],
    hoveredElement: TestElement | null,
    elements: readonly TestElement[],
    elementsMap: Map<string, TestElement>,
  ): GapSnapLine[]
  tidyUpElements(
    selectedElements: readonly TestElement[],
    elementsMap: Map<string, TestElement>,
    appState: Readonly<TestAppState>,
    scene: {
      mutateElement(el: TestElement, updates: Partial<TestElement>): TestElement
      getNonDeletedElementsMap(): Map<string, TestElement>
      getElementsMapIncludingDeleted(): Map<string, TestElement>
    },
  ): TestElement[]
  actionTidyUp: {
    name: string
    label: string
    keyTest?: (event: { altKey: boolean; ctrlKey: boolean; metaKey: boolean; shiftKey?: boolean; code: string }) => boolean
  }
}

type TestElement = {
  id: string
  type: 'rectangle' | 'ellipse' | 'diamond' | 'frame' | 'arrow' | 'line' | 'freedraw' | 'text'
  x: number
  y: number
  width: number
  height: number
  angle: number
  isDeleted: boolean
  groupIds: string[]
  frameId: string | null
  boundElements: null | Array<{ id: string; type: string }>
  containerId?: string | null
  roundness: null
  version: number
  versionNonce: number
  index: string
  seed: number
  updated: number
  link: null
  locked: boolean
  strokeColor: string
  backgroundColor: string
  fillStyle: string
  strokeWidth: number
  strokeStyle: string
  roughness: number
  opacity: number
  points?: Array<[number, number]>
  lastCommittedPoint?: null
  startBinding?: null
  endBinding?: null
  startArrowhead?: null
  endArrowhead?: string | null
  pressures?: number[]
  simulatePressure?: boolean
  name?: string | null
  text?: string
  originalText?: string
  fontSize?: number
  fontFamily?: number
  lineHeight?: number
  textAlign?: 'left' | 'center' | 'right'
  verticalAlign?: 'top' | 'middle' | 'bottom'
  autoResize?: boolean
}

type TestAppState = {
  width: number
  height: number
  scrollX: number
  scrollY: number
  offsetLeft: number
  offsetTop: number
  zoom: { value: number }
  objectsSnapModeEnabled: boolean
  gridModeEnabled: boolean
  activeTool: {
    type: string
    customType: null
    locked: boolean
    fromSelection: boolean
    lastActiveTool: null
  }
  selectedElementIds: Record<string, true>
  selectedGroupIds: Record<string, boolean>
  selectedElementsAreBeingDragged: boolean
  theme: 'light' | 'dark'
  zenModeEnabled: boolean
  snapLines: SnapLine[]
  snapGapStyle: 'pill' | 'bracket' | 'band'
  snapColor?: string
  showResizeSizeBadge?: boolean
  isResizing?: boolean
  resizingElement?: TestElement | null
}

let snap: SnapEngine

beforeAll(async () => {
  snap = (await import('@excalidraw/excalidraw')) as unknown as SnapEngine
})

afterEach(() => {
  snap?.SnapCache?.destroy()
})

let nextId = 1
function makeEl(
  type: TestElement['type'],
  x: number,
  y: number,
  width: number,
  height: number,
  extra: Partial<TestElement> = {},
): TestElement {
  const id = extra.id ?? `${type}-${nextId++}`
  const base: TestElement = {
    id,
    type,
    x,
    y,
    width,
    height,
    angle: 0,
    isDeleted: false,
    groupIds: [],
    frameId: null,
    boundElements: null,
    roundness: null,
    version: 1,
    versionNonce: 1,
    index: `a${nextId}`,
    seed: nextId,
    updated: 1,
    link: null,
    locked: false,
    strokeColor: '#1e1e1e',
    backgroundColor: 'transparent',
    fillStyle: 'solid',
    strokeWidth: 2,
    strokeStyle: 'solid',
    roughness: 0,
    opacity: 100,
    ...extra,
  }
  if (type === 'arrow' || type === 'line') {
    base.points ??= [
      [0, 0],
      [width, height],
    ]
    base.lastCommittedPoint = null
    base.startBinding = null
    base.endBinding = null
    base.startArrowhead = null
    base.endArrowhead = type === 'arrow' ? 'arrow' : null
  } else if (type === 'freedraw') {
    base.points ??= [
      [0, 0],
      [width / 2, height / 2],
      [width, height],
    ]
    base.pressures = []
    base.simulatePressure = true
    base.lastCommittedPoint = null
  } else if (type === 'frame') {
    base.name = extra.name ?? 'Frame'
  }
  return base
}

function makeAppState(over: Partial<TestAppState> = {}): TestAppState {
  return {
    width: 4000,
    height: 4000,
    scrollX: 0,
    scrollY: 0,
    offsetLeft: 0,
    offsetTop: 0,
    zoom: { value: 1 },
    objectsSnapModeEnabled: true,
    gridModeEnabled: false,
    activeTool: {
      type: 'selection',
      customType: null,
      locked: false,
      fromSelection: false,
      lastActiveTool: null,
    },
    selectedElementIds: {},
    selectedGroupIds: {},
    selectedElementsAreBeingDragged: false,
    theme: 'light',
    zenModeEnabled: false,
    snapLines: [],
    snapGapStyle: 'pill',
    ...over,
  }
}

const NO_MODIFIERS = { ctrlKey: false, metaKey: false, shiftKey: false, altKey: false }

function toMap(elements: readonly TestElement[]) {
  return new Map(elements.map((el) => [el.id, el]))
}

function prepareAndSnap(
  elements: TestElement[],
  selectedIds: string[],
  dragOffset: { x: number; y: number },
  appStateOver: Partial<TestAppState> = {},
  event = NO_MODIFIERS,
) {
  const selectedElementIds: Record<string, true> = {}
  for (const id of selectedIds) selectedElementIds[id] = true
  const appState = makeAppState({ selectedElementIds, ...appStateOver })
  const elementsMap = toMap(elements)
  const selectedElements = elements.filter((el) => selectedElementIds[el.id])

  const refPoints = snap.getReferenceSnapPoints(elements, selectedElements, appState, elementsMap)
  snap.SnapCache.setReferenceSnapPoints(refPoints)
  snap.SnapCache.setVisibleGaps(snap.getVisibleGaps(elements, selectedElements, appState, elementsMap))

  return snap.snapDraggedElements(elements, { ...dragOffset }, { props: {}, state: appState }, event, elementsMap)
}

interface RecordedCtx {
  ctx: CanvasRenderingContext2D
  calls: Array<{ method: string; args: unknown[]; strokeStyle: string; fillStyle: string; globalAlpha: number; lineDash: number[] }>
}

function makeMockCanvasContext(): RecordedCtx {
  const calls: RecordedCtx['calls'] = []
  let strokeStyle = '#000000'
  let fillStyle = '#000000'
  let globalAlpha = 1
  let lineWidth = 1
  let font = ''
  let textAlign = 'start'
  let textBaseline = 'alphabetic'
  let lineDash: number[] = []
  const stack: Array<{ strokeStyle: string; fillStyle: string; globalAlpha: number; lineWidth: number; lineDash: number[] }> = []

  const record = (method: string, args: unknown[]) => {
    calls.push({ method, args, strokeStyle, fillStyle, globalAlpha, lineDash: [...lineDash] })
  }

  const ctx = {
    get strokeStyle() {
      return strokeStyle
    },
    set strokeStyle(v: string) {
      strokeStyle = v
    },
    get fillStyle() {
      return fillStyle
    },
    set fillStyle(v: string) {
      fillStyle = v
    },
    get globalAlpha() {
      return globalAlpha
    },
    set globalAlpha(v: number) {
      globalAlpha = v
    },
    get lineWidth() {
      return lineWidth
    },
    set lineWidth(v: number) {
      lineWidth = v
    },
    get font() {
      return font
    },
    set font(v: string) {
      font = v
    },
    get textAlign() {
      return textAlign
    },
    set textAlign(v: string) {
      textAlign = v
    },
    get textBaseline() {
      return textBaseline
    },
    set textBaseline(v: string) {
      textBaseline = v
    },
    save: vi.fn(() => {
      stack.push({ strokeStyle, fillStyle, globalAlpha, lineWidth, lineDash: [...lineDash] })
      record('save', [])
    }),
    restore: vi.fn(() => {
      const prev = stack.pop()
      if (prev) {
        strokeStyle = prev.strokeStyle
        fillStyle = prev.fillStyle
        globalAlpha = prev.globalAlpha
        lineWidth = prev.lineWidth
        lineDash = prev.lineDash
      }
      record('restore', [])
    }),
    translate: vi.fn((x: number, y: number) => record('translate', [x, y])),
    setLineDash: vi.fn((segments: number[]) => {
      lineDash = [...segments]
      record('setLineDash', [segments])
    }),
    beginPath: vi.fn(() => record('beginPath', [])),
    closePath: vi.fn(() => record('closePath', [])),
    moveTo: vi.fn((x: number, y: number) => record('moveTo', [x, y])),
    lineTo: vi.fn((x: number, y: number) => record('lineTo', [x, y])),
    arcTo: vi.fn((x1: number, y1: number, x2: number, y2: number, r: number) => record('arcTo', [x1, y1, x2, y2, r])),
    stroke: vi.fn(() => record('stroke', [])),
    fill: vi.fn(() => record('fill', [])),
    fillRect: vi.fn((x: number, y: number, w: number, h: number) => record('fillRect', [x, y, w, h])),
    fillText: vi.fn((text: string, x: number, y: number) => record('fillText', [text, x, y])),
    measureText: vi.fn((text: string) => ({ width: text.length * 6 })),
  } as unknown as CanvasRenderingContext2D

  return { ctx, calls }
}

// -----------------------------------------------------------------------------
// D1: Reference filtering (non-layout shapes & visually nested elements)
// -----------------------------------------------------------------------------

describe('D1: Reference filtering in getReferenceSnapPoints & snapDraggedElements', () => {
  it('ignores arrow, line, and freedraw elements as snap targets', () => {
    const dragged = makeEl('rectangle', 100, 100, 80, 50)
    const arrow = makeEl('arrow', 102, 200, 100, 0)
    const line = makeEl('line', 101, 260, 100, 0)
    const freedraw = makeEl('freedraw', 99, 320, 60, 30)
    const elements = [dragged, arrow, line, freedraw]

    const appState = makeAppState({ selectedElementIds: { [dragged.id]: true } })
    const refPoints = snap.getReferenceSnapPoints(elements, [dragged], appState, toMap(elements))
    expect(refPoints).toEqual([])
    expect(snap.SnapCache.getReferenceSnapBoxes()).toEqual([])

    const res = prepareAndSnap(elements, [dragged.id], { x: 0, y: 0 })
    expect(res.snapOffset).toEqual({ x: 0, y: 0 })
    expect(res.snapLines).toEqual([])
  })

  it('ignores tiny shapes visually nested inside a larger unselected rectangle or frame when dragging outside', () => {
    const outerCard = makeEl('rectangle', 0, 0, 300, 200)
    const innerPill = makeEl('rectangle', 42, 60, 28, 12)
    const outerFrame = makeEl('frame', 400, 0, 300, 200)
    const frameChild = makeEl('rectangle', 450, 50, 40, 20, { frameId: outerFrame.id })
    // Dragged card is outside both containers, with minX=40 (within 2px of innerPill.minX=42)
    const dragged = makeEl('rectangle', 40, 300, 100, 60)
    const elements = [outerCard, innerPill, outerFrame, frameChild, dragged]

    const appState = makeAppState({ selectedElementIds: { [dragged.id]: true } })
    snap.getReferenceSnapPoints(elements, [dragged], appState, toMap(elements))
    const boxes = snap.SnapCache.getReferenceSnapBoxes()!
    // Only the two outer containers should be in reference boxes, neither nested child
    expect(boxes).toHaveLength(2)
    expect(boxes.map((b) => b.minX).sort((a, b) => a - b)).toEqual([0, 400])

    // Dragging near innerPill.minX (42) must NOT snap
    const res = prepareAndSnap(elements, [dragged.id], { x: 0, y: 0 })
    expect(res.snapOffset).toEqual({ x: 0, y: 0 })
  })

  it('keeps sibling shapes when dragging an element inside the same container', () => {
    const outerCard = makeEl('rectangle', 0, 0, 400, 300)
    const sibling = makeEl('rectangle', 60, 40, 80, 40)
    // Dragged shape is also strictly inside outerCard, 2px off sibling's left edge
    const dragged = makeEl('rectangle', 62, 120, 80, 40)
    const elements = [outerCard, sibling, dragged]

    const res = prepareAndSnap(elements, [dragged.id], { x: 0, y: 0 })
    expect(res.snapOffset.x).toBe(-2)
    expect(res.snapLines.some((l) => l.type === 'points' && l.points[0][0] === 60)).toBe(true)
  })
})

// -----------------------------------------------------------------------------
// D2: SNAP_DISTANCE = 5, same-role matching, nearest-neighbor tie-break
// -----------------------------------------------------------------------------

describe('D2: Tighter threshold (5px), same-role matching, and nearest-neighbor tie-break', () => {
  it('uses SNAP_DISTANCE = 5 scaled by zoom', () => {
    expect(snap.getSnapDistance(1)).toBe(5)
    expect(snap.getSnapDistance(2)).toBe(2.5)
    expect(snap.getSnapDistance(0.5)).toBe(10)
  })

  it('snaps at 5px offset but does NOT snap at 6px offset (zoom = 1)', () => {
    const ref = makeEl('rectangle', 100, 100, 100, 60)
    // width=60 so only minX (105 vs 100) is within 5px (cx=135 vs 150, maxX=165 vs 200)
    const dragged = makeEl('rectangle', 105, 250, 60, 60)
    const elements = [ref, dragged]

    const at5 = prepareAndSnap(elements, [dragged.id], { x: 0, y: 0 })
    expect(at5.snapOffset.x).toBe(-5)

    const at6 = prepareAndSnap(elements, [dragged.id], { x: 1, y: 0 })
    expect(at6.snapOffset.x).toBe(0)
    expect(at6.snapLines).toEqual([])
  })

  it('matches same roles: center-center, edge-edge, and flush left-right, without cross-snapping center to edge', () => {
    const ref = makeEl('rectangle', 100, 100, 100, 60) // minX=100, cx=150, maxX=200

    // Center-to-center: dragged width=60, x=118 => cx=148 (2px from ref cx=150)
    const centerDragged = makeEl('rectangle', 118, 250, 60, 40)
    const centerRes = prepareAndSnap([ref, centerDragged], [centerDragged.id], { x: 0, y: 0 })
    expect(centerRes.snapOffset.x).toBe(2)
    expect(centerRes.snapLines).toEqual(
      expect.arrayContaining([expect.objectContaining({ type: 'points', role: 'center' })]),
    )

    // Edge-to-edge: dragged minX=103 (3px from ref minX=100)
    const edgeDragged = makeEl('rectangle', 103, 250, 60, 40)
    const edgeRes = prepareAndSnap([ref, edgeDragged], [edgeDragged.id], { x: 0, y: 0 })
    expect(edgeRes.snapOffset.x).toBe(-3)
    expect(edgeRes.snapLines).toEqual(
      expect.arrayContaining([expect.objectContaining({ type: 'points', role: 'edge' })]),
    )

    // Flush left-to-right: dragged minX=203 (3px from ref maxX=200)
    const flushDragged = makeEl('rectangle', 203, 250, 60, 40)
    const flushRes = prepareAndSnap([ref, flushDragged], [flushDragged.id], { x: 0, y: 0 })
    expect(flushRes.snapOffset.x).toBe(-3)
    expect(flushRes.snapLines).toEqual(
      expect.arrayContaining([expect.objectContaining({ type: 'points', role: 'edge' })]),
    )

    // No cross-role center-to-edge: dragged x=51, width=100 => minX=51, cx=101 (1px from ref minX=100), maxX=151 (far from 100/200)
    const crossDragged = makeEl('rectangle', 51, 250, 100, 40)
    const crossRes = prepareAndSnap([ref, crossDragged], [crossDragged.id], { x: 0, y: 0 })
    expect(crossRes.snapOffset.x).toBe(0)
  })

  it('breaks ties within the 1.5px tie band in favor of the visually nearest neighbor', () => {
    // Far shape at y=1000 has minX=100 (offset = 0)
    // Near shape at y=120 has minX=101 (offset = +1, within 1.5px tie band, much closer in Y)
    const farRef = makeEl('rectangle', 100, 1000, 80, 40)
    const nearRef = makeEl('rectangle', 101, 120, 80, 40)
    const dragged = makeEl('rectangle', 100, 200, 60, 40)

    const res = prepareAndSnap([farRef, nearRef, dragged], [dragged.id], { x: 0, y: 0 })
    expect(res.snapOffset.x).toBe(1)
  })
})

// -----------------------------------------------------------------------------
// D3: Adjacent-only visible gaps (>= 4px) & at most 1 best gap pair per axis
// -----------------------------------------------------------------------------

describe('D3: Direct-neighbor visible gaps (>= 4px) and 1 gap pair per axis', () => {
  it('computes only direct-neighbor (unoccluded) gaps and skips gaps < 4px', () => {
    const a = makeEl('rectangle', 0, 100, 100, 60) // 0..100
    const b = makeEl('rectangle', 120, 100, 100, 60) // 120..220 (gap A-B = 20)
    const c = makeEl('rectangle', 240, 100, 100, 60) // 240..340 (gap B-C = 20; A-C = 140 is occluded by B)
    const d = makeEl('rectangle', 343, 100, 100, 60) // 343..443 (gap C-D = 3 < 4px, skipped)
    const dragged = makeEl('rectangle', 800, 800, 50, 50)
    const elements = [a, b, c, d, dragged]

    const appState = makeAppState({ selectedElementIds: { [dragged.id]: true } })
    const { horizontalGaps } = snap.getVisibleGaps(elements, [dragged], appState, toMap(elements))

    // Only A-B (20) and B-C (20); neither occluded A-C (140) nor tiny C-D (3)
    expect(horizontalGaps.map((g) => g.length)).toEqual([20, 20])
  })

  it('skips occluded vertical gaps and < 4px vertical gaps', () => {
    const top = makeEl('rectangle', 100, 0, 80, 50) // 0..50
    const mid = makeEl('rectangle', 100, 80, 80, 50) // 80..130 (gap 30)
    const bot = makeEl('rectangle', 100, 160, 80, 50) // 160..210 (gap 30; top-bot occluded)
    const tiny = makeEl('rectangle', 100, 212, 80, 50) // 212..262 (gap 2 < 4px)
    const dragged = makeEl('rectangle', 800, 800, 50, 50)
    const elements = [top, mid, bot, tiny, dragged]

    const appState = makeAppState({ selectedElementIds: { [dragged.id]: true } })
    const { verticalGaps } = snap.getVisibleGaps(elements, [dragged], appState, toMap(elements))
    expect(verticalGaps.map((g) => g.length)).toEqual([30, 30])
  })

  it('emits at most 1 best gap pair (2 GapSnapLine segments) per axis when multiple gaps match', () => {
    // Row 1: A (0..100), B (140..240), C (280..380) — two equal 40px gaps
    const a = makeEl('rectangle', 0, 100, 100, 60)
    const b = makeEl('rectangle', 140, 100, 100, 60)
    const c = makeEl('rectangle', 280, 100, 100, 60)
    // Dragged box placed to the right of C at x=422 (42px from C -> snaps by -2px to 40px)
    const dragged = makeEl('rectangle', 422, 100, 100, 60)
    const elements = [a, b, c, dragged]

    const res = prepareAndSnap(elements, [dragged.id], { x: 0, y: 0 })
    expect(res.snapOffset.x).toBe(-2)
    const horizontalGapLines = res.snapLines.filter((l): l is GapSnapLine => l.type === 'gap' && l.direction === 'horizontal')
    expect(horizontalGapLines).toHaveLength(2)
    expect(horizontalGapLines.every((l) => l.distance === 40)).toBe(true)
  })
})

// -----------------------------------------------------------------------------
// D6: Co-linear merge & guide cap per axis
// -----------------------------------------------------------------------------

describe('D6: Co-linear guide merge and per-axis cap', () => {
  it('merges co-linear edge alignments into 1 continuous guide spanning all aligned boxes', () => {
    // Three boxes aligned at x=100 (different widths so only left edge matches)
    const b1 = makeEl('rectangle', 100, 50, 80, 40) // y: 50..90
    const b2 = makeEl('rectangle', 100, 150, 110, 40) // y: 150..190
    const b3 = makeEl('rectangle', 100, 250, 140, 40) // y: 250..290
    const dragged = makeEl('rectangle', 102, 350, 95, 40) // y: 350..390, snaps x to 100

    const res = prepareAndSnap([b1, b2, b3, dragged], [dragged.id], { x: 0, y: 0 })
    expect(res.snapOffset.x).toBe(-2)

    const verticalPointLines = res.snapLines.filter(
      (l): l is PointSnapLine => l.type === 'points' && l.points.length === 2 && l.points[0][0] === l.points[1][0],
    )
    expect(verticalPointLines).toHaveLength(1)
    expect(verticalPointLines[0].points).toEqual([
      [100, 50],
      [100, 390],
    ])
  })

  it('caps vertical guides to 2 edge guides when both left and right edges match (same width)', () => {
    const ref = makeEl('rectangle', 100, 50, 120, 40) // minX=100, cx=160, maxX=220
    const dragged = makeEl('rectangle', 101, 200, 120, 40) // snaps to minX=100, cx=160, maxX=220

    const res = prepareAndSnap([ref, dragged], [dragged.id], { x: 0, y: 0 })
    const verticalPointLines = res.snapLines.filter(
      (l): l is PointSnapLine => l.type === 'points' && l.points[0][0] === l.points[1][0],
    )
    // Both left & right edges match -> 2 edge guides (left + right), center suppressed
    expect(verticalPointLines).toHaveLength(2)
    expect(verticalPointLines.every((l) => l.role === 'edge')).toBe(true)
    expect(verticalPointLines.map((l) => l.points[0][0]).sort((a, b) => a - b)).toEqual([100, 220])
  })

  it('emits 1 center guide when center matches without both edges matching', () => {
    const ref = makeEl('rectangle', 100, 50, 120, 40) // cx=160
    const dragged = makeEl('rectangle', 132, 200, 60, 40) // cx=162 -> snaps by -2 to cx=160

    const res = prepareAndSnap([ref, dragged], [dragged.id], { x: 0, y: 0 })
    expect(res.snapOffset.x).toBe(-2)
    const verticalPointLines = res.snapLines.filter(
      (l): l is PointSnapLine => l.type === 'points' && l.points[0][0] === l.points[1][0],
    )
    expect(verticalPointLines).toHaveLength(1)
    expect(verticalPointLines[0].role).toBe('center')
    expect(verticalPointLines[0].points[0][0]).toBe(160)
  })
})

// -----------------------------------------------------------------------------
// Adj #3: Enclosing frame center-line snapping
// -----------------------------------------------------------------------------

describe('Adj #3: Enclosing frame center-line snapping', () => {
  it('snaps a shape inside a frame to the frame center with role: "center"', () => {
    const frame = makeEl('frame', 0, 0, 400, 300) // cx=200, cy=150
    // Shape inside frame: width=80, height=40; x=162 => cx=202 (2px from 200), y=133 => cy=153 (3px from 150)
    const inner = makeEl('rectangle', 162, 133, 80, 40, { frameId: frame.id })

    const res = prepareAndSnap([frame, inner], [inner.id], { x: 0, y: 0 })
    expect(res.snapOffset).toEqual({ x: -2, y: -3 })

    const pointLines = res.snapLines.filter((l): l is PointSnapLine => l.type === 'points')
    expect(pointLines).toHaveLength(2)
    expect(pointLines.every((l) => l.role === 'center')).toBe(true)
  })
})

// -----------------------------------------------------------------------------
// Adj #1: getSnapLinesAtPointer filtering
// -----------------------------------------------------------------------------

describe('Adj #1: getSnapLinesAtPointer filters non-layout and nested elements', () => {
  it('ignores arrows, lines, freedraws, and nested inner elements while snapping to top-level shapes', () => {
    const arrow = makeEl('arrow', 50, 50, 100, 0)
    const freedraw = makeEl('freedraw', 50, 80, 80, 20)
    const outer = makeEl('rectangle', 200, 200, 300, 200)
    const nested = makeEl('rectangle', 240, 250, 30, 15)
    const elements = [arrow, freedraw, outer, nested]
    const appState = makeAppState()
    const elementsMap = toMap(elements)

    // Pointer near arrow/freedraw at x=51 -> should NOT snap
    const nearArrow = snap.getSnapLinesAtPointer(elements, { props: {}, state: appState }, { x: 51, y: 50 }, NO_MODIFIERS, elementsMap)
    expect(nearArrow.snapLines).toEqual([])
    expect(nearArrow.originOffset).toEqual({ x: 0, y: 0 })

    // Pointer near nested inner pill at x=241, y=251 -> should NOT snap
    const nearNested = snap.getSnapLinesAtPointer(elements, { props: {}, state: appState }, { x: 241, y: 251 }, NO_MODIFIERS, elementsMap)
    expect(nearNested.snapLines).toEqual([])

    // Pointer near top-level outer card's left edge at x=202, y=100 -> DOES snap
    const nearOuter = snap.getSnapLinesAtPointer(elements, { props: {}, state: appState }, { x: 202, y: 100 }, NO_MODIFIERS, elementsMap)
    expect(nearOuter.originOffset.x).toBe(-2)
    expect(nearOuter.snapLines).toHaveLength(1)
    expect(nearOuter.snapLines[0].direction).toBe('vertical')
  })
})

// -----------------------------------------------------------------------------
// D4 & D5: renderSnaps styling, dash/solid, no crosses, gap styles & pill threshold
// -----------------------------------------------------------------------------

describe('D4 & D5: renderSnaps styling and gap presentation', () => {
  it('uses Canva magenta (#e024a7 in light mode, #a8187d in dark mode)', () => {
    expect(snap.SNAP_COLOR_LIGHT).toBe('#e024a7')
    expect(snap.SNAP_COLOR_DARK).toBe('#a8187d')

    const line: PointSnapLine = { type: 'points', role: 'center', points: [[100, 0], [100, 200]] }

    const lightMock = makeMockCanvasContext()
    snap.renderSnaps(lightMock.ctx, makeAppState({ theme: 'light', snapLines: [line] }))
    const lightStroke = lightMock.calls.find((c) => c.method === 'stroke')
    expect(lightStroke?.strokeStyle).toBe('#e024a7')

    const darkMock = makeMockCanvasContext()
    snap.renderSnaps(darkMock.ctx, makeAppState({ theme: 'dark', snapLines: [line] }))
    const darkStroke = darkMock.calls.find((c) => c.method === 'stroke')
    expect(darkStroke?.strokeStyle).toBe('#a8187d')
  })

  it('draws dashed line for edge role, solid line for center role, and NO x crosses', () => {
    const edgeLine: PointSnapLine = {
      type: 'points',
      role: 'edge',
      points: [
        [100, 0],
        [100, 50],
        [100, 200],
      ],
    }
    const centerLine: PointSnapLine = {
      type: 'points',
      role: 'center',
      points: [
        [200, 0],
        [200, 200],
      ],
    }

    const edgeMock = makeMockCanvasContext()
    snap.renderSnaps(edgeMock.ctx, makeAppState({ snapLines: [edgeLine] }))
    const edgeStrokes = edgeMock.calls.filter((c) => c.method === 'stroke')
    // Exactly 1 line stroke (no extra x-cross strokes at points!)
    expect(edgeStrokes).toHaveLength(1)
    expect(edgeStrokes[0].lineDash).toEqual([4, 3])

    const centerMock = makeMockCanvasContext()
    snap.renderSnaps(centerMock.ctx, makeAppState({ snapLines: [centerLine] }))
    const centerStrokes = centerMock.calls.filter((c) => c.method === 'stroke')
    expect(centerStrokes).toHaveLength(1)
    expect(centerStrokes[0].lineDash).toEqual([])
  })

  it('renders pill, bracket, and band gap styles and hides pill when gap < 32 screen px', () => {
    const wideGap: GapSnapLine = {
      type: 'gap',
      direction: 'horizontal',
      points: [
        [100, 50],
        [148, 50],
      ],
      distance: 48,
      bandSpan: [20, 80],
    }
    const narrowGap: GapSnapLine = {
      type: 'gap',
      direction: 'horizontal',
      points: [
        [100, 50],
        [124, 50],
      ],
      distance: 24,
      bandSpan: [20, 80],
    }

    // 1. pill style with wide gap (48 >= 32): strokes bracket (3 lines) + fills pill + fillText('48')
    const pillWide = makeMockCanvasContext()
    snap.renderSnaps(pillWide.ctx, makeAppState({ snapGapStyle: 'pill', snapLines: [wideGap] }))
    expect(pillWide.calls.filter((c) => c.method === 'stroke')).toHaveLength(3)
    expect(pillWide.calls.filter((c) => c.method === 'fillRect')).toHaveLength(0)
    expect(pillWide.calls.find((c) => c.method === 'fillText')?.args[0]).toBe('48')

    // 2. pill style with narrow gap (24 < 32): strokes bracket, hides pill text
    const pillNarrow = makeMockCanvasContext()
    snap.renderSnaps(pillNarrow.ctx, makeAppState({ snapGapStyle: 'pill', snapLines: [narrowGap] }))
    expect(pillNarrow.calls.filter((c) => c.method === 'stroke')).toHaveLength(3)
    expect(pillNarrow.calls.filter((c) => c.method === 'fillText')).toHaveLength(0)

    // 3. zoom-aware pill threshold: 24 scene px at zoom=2 is 48 screen px (>= 32) -> pill IS shown
    const pillZoomed = makeMockCanvasContext()
    snap.renderSnaps(pillZoomed.ctx, makeAppState({ snapGapStyle: 'pill', zoom: { value: 2 }, snapLines: [narrowGap] }))
    expect(pillZoomed.calls.find((c) => c.method === 'fillText')?.args[0]).toBe('24')

    // 4. bracket style: strokes bracket only, never pill or band
    const bracketMock = makeMockCanvasContext()
    snap.renderSnaps(bracketMock.ctx, makeAppState({ snapGapStyle: 'bracket', snapLines: [wideGap] }))
    expect(bracketMock.calls.filter((c) => c.method === 'stroke')).toHaveLength(3)
    expect(bracketMock.calls.filter((c) => c.method === 'fillText')).toHaveLength(0)
    expect(bracketMock.calls.filter((c) => c.method === 'fillRect')).toHaveLength(0)

    // 5. band style: translucent fillRect + pill (when >= 32 screen px), no bracket strokes
    const bandMock = makeMockCanvasContext()
    snap.renderSnaps(bandMock.ctx, makeAppState({ snapGapStyle: 'band', snapLines: [wideGap] }))
    expect(bandMock.calls.filter((c) => c.method === 'stroke')).toHaveLength(0)
    const rectCall = bandMock.calls.find((c) => c.method === 'fillRect')
    expect(rectCall).toBeDefined()
    expect(rectCall?.globalAlpha).toBeCloseTo(0.14)
    expect(bandMock.calls.find((c) => c.method === 'fillText')?.args[0]).toBe('48')
  })
})

// -----------------------------------------------------------------------------
// Settings / Prefs: snapGapStyle validation & mapping
// -----------------------------------------------------------------------------

describe('Settings/Prefs: snapGapStyle in canvasPrefs', () => {
  const fullPrefs = (over: Partial<CanvasPrefs> = {}): CanvasPrefs => ({ ...DEFAULT_CANVAS_PREFS, ...over })

  it('sanitizeCanvasPrefs keeps valid snapGapStyle values and defaults invalid/missing ones to pill', () => {
    for (const style of SNAP_GAP_STYLES) {
      expect(sanitizeCanvasPrefs({ snapGapStyle: style }).snapGapStyle).toBe(style)
    }
    expect(sanitizeCanvasPrefs({ snapGapStyle: 'unknown' }).snapGapStyle).toBe('pill')
    expect(sanitizeCanvasPrefs({ snapGapStyle: 123 }).snapGapStyle).toBe('pill')
    expect(sanitizeCanvasPrefs({}).snapGapStyle).toBe('pill')
  })

  it('isCanvasPrefs accepts all SNAP_GAP_STYLES and rejects invalid or missing snapGapStyle', () => {
    for (const style of SNAP_GAP_STYLES) {
      expect(isCanvasPrefs(fullPrefs({ snapGapStyle: style }))).toBe(true)
    }
    expect(isCanvasPrefs({ ...fullPrefs(), snapGapStyle: 'dots' })).toBe(false)
    expect(isCanvasPrefs({ ...fullPrefs(), snapGapStyle: null })).toBe(false)
    const { snapGapStyle: _drop, ...withoutStyle } = fullPrefs()
    expect(isCanvasPrefs(withoutStyle)).toBe(false)
  })

  it('prefsToAppState and appStateToPrefs round-trip snapGapStyle and preserve fallback on missing/invalid', () => {
    expect(prefsToAppState(fullPrefs({ snapGapStyle: 'band' }), ['snapGapStyle'])).toEqual({ snapGapStyle: 'band' })
    expect(prefsToAppState(fullPrefs({ snapGapStyle: 'bracket' }), ['snapGapStyle'])).toEqual({ snapGapStyle: 'bracket' })

    const fallback = fullPrefs({ snapGapStyle: 'bracket' })
    expect(appStateToPrefs({ snapGapStyle: 'band' }, fallback).snapGapStyle).toBe('band')
    expect(appStateToPrefs({}, fallback).snapGapStyle).toBe('bracket')
    expect(appStateToPrefs({ snapGapStyle: 'invalid' }, fallback).snapGapStyle).toBe('bracket')
  })
})

// -----------------------------------------------------------------------------
// D7: Option/Alt-hover distance measurement (getAltHoverMeasureLines)
// -----------------------------------------------------------------------------

describe('D7: Option/Alt-hover distance measurement (getAltHoverMeasureLines)', () => {
  it('measures horizontal and vertical disjoint gaps between selected and hovered elements', () => {
    const selected = makeEl('rectangle', 100, 100, 80, 60) // x: 100..180, y: 100..160
    const rightNeighbor = makeEl('rectangle', 220, 110, 80, 60) // x: 220..300 (dx=40), y overlaps 110..160
    const diagNeighbor = makeEl('rectangle', 250, 210, 80, 60) // dx=70, dy=50
    const elements = [selected, rightNeighbor, diagNeighbor]
    const map = toMap(elements)

    // Same row -> 1 horizontal gap line of 40px with bandSpan [110, 160]
    const horiz = snap.getAltHoverMeasureLines([selected], rightNeighbor, elements, map)
    expect(horiz).toHaveLength(1)
    expect(horiz[0]).toMatchObject({
      type: 'gap',
      direction: 'horizontal',
      distance: 40,
      bandSpan: [110, 160],
    })

    // Diagonal -> both horizontal (70) and vertical (50) gap lines
    const diag = snap.getAltHoverMeasureLines([selected], diagNeighbor, elements, map)
    expect(diag).toHaveLength(2)
    expect(diag.find((l) => l.direction === 'horizontal')?.distance).toBe(70)
    expect(diag.find((l) => l.direction === 'vertical')?.distance).toBe(50)

    // Hovering a selected element returns []
    expect(snap.getAltHoverMeasureLines([selected], selected, elements, map)).toEqual([])
    // Empty selection returns []
    expect(snap.getAltHoverMeasureLines([], rightNeighbor, elements, map)).toEqual([])
  })

  it('measures against the hovered element maximum-group bounds', () => {
    const selected = makeEl('rectangle', 0, 100, 100, 60) // x: 0..100
    const grpA = makeEl('rectangle', 150, 100, 60, 60, { groupIds: ['g1'] }) // group x: 150..260
    const grpB = makeEl('rectangle', 200, 100, 60, 60, { groupIds: ['g1'] })
    const elements = [selected, grpA, grpB]
    const map = toMap(elements)

    // Hovering grpB (which starts at x=200) still measures against the whole group (minX=150 -> distance=50)
    const lines = snap.getAltHoverMeasureLines([selected], grpB, elements, map)
    expect(lines).toHaveLength(1)
    expect(lines[0].distance).toBe(50)
  })

  it('measures inner padding on all 4 sides when one box strictly contains the other', () => {
    const outer = makeEl('rectangle', 100, 100, 300, 200) // 100..400, 100..300
    const inner = makeEl('rectangle', 140, 130, 100, 80) // left=40, right=160, top=30, bottom=90
    const elements = [outer, inner]
    const map = toMap(elements)

    const lines = snap.getAltHoverMeasureLines([inner], outer, elements, map)
    expect(lines).toHaveLength(4)
    const hDists = lines.filter((l) => l.direction === 'horizontal').map((l) => l.distance).sort((a, b) => (a ?? 0) - (b ?? 0))
    const vDists = lines.filter((l) => l.direction === 'vertical').map((l) => l.distance).sort((a, b) => (a ?? 0) - (b ?? 0))
    expect(hDists).toEqual([40, 160])
    expect(vDists).toEqual([30, 90])
  })

  it('measures distances to enclosing frame 4 edges when hoveredElement is null', () => {
    const frame = makeEl('frame', 50, 50, 400, 300) // 50..450, 50..350
    const child = makeEl('rectangle', 100, 110, 120, 80, { frameId: frame.id }) // left=50, right=230, top=60, bottom=160
    const elements = [frame, child]
    const map = toMap(elements)

    const lines = snap.getAltHoverMeasureLines([child], null, elements, map)
    expect(lines).toHaveLength(4)
    const hDists = lines.filter((l) => l.direction === 'horizontal').map((l) => l.distance).sort((a, b) => (a ?? 0) - (b ?? 0))
    const vDists = lines.filter((l) => l.direction === 'vertical').map((l) => l.distance).sort((a, b) => (a ?? 0) - (b ?? 0))
    expect(hDists).toEqual([50, 230])
    expect(vDists).toEqual([60, 160])

    // Unframed element with hoveredElement=null returns []
    const unframed = makeEl('rectangle', 100, 110, 120, 80)
    expect(snap.getAltHoverMeasureLines([unframed], null, [unframed], toMap([unframed]))).toEqual([])
  })
})

// -----------------------------------------------------------------------------
// D8: Smart Tidy up (tidyUpElements)
// -----------------------------------------------------------------------------

describe('D8: Smart Tidy up (tidyUpElements)', () => {
  function makeMockScene(elements: TestElement[]) {
    const map = toMap(elements)
    return {
      mutateElement(el: TestElement, updates: Partial<TestElement>) {
        Object.assign(el, updates)
        return el
      },
      getNonDeletedElementsMap() {
        return map
      },
      getElementsMapIncludingDeleted() {
        return map
      },
    }
  }

  it('registers actionTidyUp with name "tidyUp"', () => {
    expect(snap.actionTidyUp.name).toBe('tidyUp')
  })

  it('returns [] for fewer than 3 groups or when a frame is selected', () => {
    const a = makeEl('rectangle', 0, 0, 80, 40)
    const b = makeEl('rectangle', 120, 0, 80, 40)
    const frame = makeEl('frame', 240, 0, 100, 100)

    const twoEls = [a, b]
    expect(snap.tidyUpElements(twoEls, toMap(twoEls), makeAppState(), makeMockScene(twoEls))).toEqual([])

    const withFrame = [a, b, frame]
    expect(snap.tidyUpElements(withFrame, toMap(withFrame), makeAppState(), makeMockScene(withFrame))).toEqual([])
  })

  it('tidies a messy 1D horizontal row: equalizes horizontal gaps and aligns vertical centers', () => {
    // Common X: 0..420 (totalW = 300 -> 3 items of width 100? Let's use 4 items of width 60: totalW=240, span 0..360 => gap=40)
    const a = makeEl('rectangle', 0, 100, 60, 40)
    const b = makeEl('rectangle', 80, 112, 60, 40)
    const c = makeEl('rectangle', 210, 96, 60, 40)
    const d = makeEl('rectangle', 300, 108, 60, 40) // maxX = 360; totalW = 240; (360-240)/3 = 40
    const elements = [a, b, c, d]

    const updated = snap.tidyUpElements(elements, toMap(elements), makeAppState(), makeMockScene(elements))
    expect(updated).toHaveLength(4)

    // X positions: 0, 100, 200, 300 (uniform 40px horizontal gap)
    expect([a.x, b.x, c.x, d.x]).toEqual([0, 100, 200, 300])
    // All vertical centers aligned to the same Y
    const midYs = [a, b, c, d].map((el) => el.y + el.height / 2)
    expect(new Set(midYs).size).toBe(1)
  })

  it('tidies a messy 1D vertical column: equalizes vertical gaps and aligns horizontal centers', () => {
    // 4 items of height 50; common Y: 0..320 => totalH=200 => (320-200)/3 = 40
    const a = makeEl('rectangle', 100, 0, 80, 50)
    const b = makeEl('rectangle', 114, 70, 80, 50)
    const c = makeEl('rectangle', 92, 180, 80, 50)
    const d = makeEl('rectangle', 108, 270, 80, 50) // maxY = 320
    const elements = [a, b, c, d]

    const updated = snap.tidyUpElements(elements, toMap(elements), makeAppState(), makeMockScene(elements))
    expect(updated).toHaveLength(4)

    // Y positions: 0, 90, 180, 270 (uniform 40px vertical gap)
    expect([a.y, b.y, c.y, d.y]).toEqual([0, 90, 180, 270])
    // All horizontal centers aligned
    const midXs = [a, b, c, d].map((el) => el.x + el.width / 2)
    expect(new Set(midXs).size).toBe(1)
  })

  it('tidies a messy 2D grid (2x3) from original top-left with uniform mean positive column/row gaps', () => {
    // Row 0: y around 50 (height 60). Gaps X: 20 and 40 -> mean X gap = 30
    const r0c0 = makeEl('rectangle', 100, 50, 100, 60) // 100..200
    const r0c1 = makeEl('rectangle', 220, 58, 100, 60) // 220..320 (gap 20)
    const r0c2 = makeEl('rectangle', 360, 52, 100, 60) // 360..460 (gap 40)
    // Row 1: y around 150 (height 60). Row 0 maxY=118, Row 1 minY=148 -> gap Y = 30. Gaps X: 20 and 40 -> mean still 30
    const r1c0 = makeEl('rectangle', 105, 148, 100, 60) // 105..205
    const r1c1 = makeEl('rectangle', 225, 155, 100, 60) // 225..325 (gap 20)
    const r1c2 = makeEl('rectangle', 365, 150, 100, 60) // 365..465 (gap 40)
    const elements = [r0c0, r0c1, r0c2, r1c0, r1c1, r1c2]

    const updated = snap.tidyUpElements(elements, toMap(elements), makeAppState(), makeMockScene(elements))
    expect(updated).toHaveLength(6)

    // Columns align to gridMinX=100 with gapX=30 -> 100, 230, 360
    expect([r0c0.x, r0c1.x, r0c2.x]).toEqual([100, 230, 360])
    expect([r1c0.x, r1c1.x, r1c2.x]).toEqual([100, 230, 360])
    // Rows align to gridMinY=50 with rowHeight=60, gapY=30 -> 50, 140
    expect([r0c0.y, r0c1.y, r0c2.y]).toEqual([50, 50, 50])
    expect([r1c0.y, r1c1.y, r1c2.y]).toEqual([140, 140, 140])
  })

  it('preserves internal relative offsets inside grouped cards when tidying up', () => {
    // 3 grouped cards in a messy 1D row (card = outer 100x60 + inner badge offset (+15, +12))
    const card1Bg = makeEl('rectangle', 0, 100, 100, 60, { groupIds: ['c1'] })
    const card1Badge = makeEl('rectangle', 15, 112, 30, 16, { groupIds: ['c1'] })
    const card2Bg = makeEl('rectangle', 120, 115, 100, 60, { groupIds: ['c2'] })
    const card2Badge = makeEl('rectangle', 135, 127, 30, 16, { groupIds: ['c2'] })
    const card3Bg = makeEl('rectangle', 300, 95, 100, 60, { groupIds: ['c3'] })
    const card3Badge = makeEl('rectangle', 315, 107, 30, 16, { groupIds: ['c3'] })
    const elements = [card1Bg, card1Badge, card2Bg, card2Badge, card3Bg, card3Badge]
    const appState = makeAppState({ selectedGroupIds: { c1: true, c2: true, c3: true } })

    const updated = snap.tidyUpElements(elements, toMap(elements), appState, makeMockScene(elements))
    expect(updated).toHaveLength(6)

    // Common X: 0..400, 3 cards of width 100 => totalW=300 => gap = (400-300)/2 = 50 -> x = 0, 150, 300
    expect([card1Bg.x, card2Bg.x, card3Bg.x]).toEqual([0, 150, 300])
    // All cards aligned in Y
    expect(card1Bg.y).toBe(card2Bg.y)
    expect(card2Bg.y).toBe(card3Bg.y)
    // Internal badge offset (+15, +12) preserved for every card
    expect([card1Badge.x - card1Bg.x, card1Badge.y - card1Bg.y]).toEqual([15, 12])
    expect([card2Badge.x - card2Bg.x, card2Badge.y - card2Bg.y]).toEqual([15, 12])
    expect([card3Badge.x - card3Bg.x, card3Badge.y - card3Bg.y]).toEqual([15, 12])
  })
})

// -----------------------------------------------------------------------------
// Round 2 Demo Polish (#1, #4, #5, #6)
// -----------------------------------------------------------------------------

describe('Round 2 #1: Always show pixel pill on Option-hover measurement', () => {
  it('marks Option-hover measure lines with alwaysShowPill: true and renders pill even on narrow gaps and in bracket style', () => {
    const selected = makeEl('rectangle', 100, 100, 80, 60) // maxX = 180
    const closeNeighbor = makeEl('rectangle', 192, 100, 80, 60) // minX = 192 (12px gap < 32 screen px)
    const elements = [selected, closeNeighbor]

    const lines = snap.getAltHoverMeasureLines([selected], closeNeighbor, elements, toMap(elements))
    expect(lines).toHaveLength(1)
    expect(lines[0].distance).toBe(12)
    expect(lines[0].alwaysShowPill).toBe(true)

    for (const style of ['pill', 'bracket', 'band'] as const) {
      const mock = makeMockCanvasContext()
      snap.renderSnaps(mock.ctx, makeAppState({ snapGapStyle: style, snapLines: lines }))
      expect(mock.calls.find((c) => c.method === 'fillText')?.args[0]).toBe('12')
    }
  })
})

describe('Round 2 #4: Calm resize snapping (snapResizingElements)', () => {
  it('snaps resized east edge to neighbor outer edges (role: "edge") and neighbor centers (role: "center") with co-linear guides', () => {
    const refTop = makeEl('rectangle', 200, 40, 100, 50) // minX=200, cx=250, maxX=300
    const refMid = makeEl('rectangle', 200, 120, 120, 50) // minX=200, cx=260, maxX=320
    const orig = makeEl('rectangle', 80, 220, 100, 50) // 80..180
    const elements = [refTop, refMid, orig]
    const appState = makeAppState({ selectedElementIds: { [orig.id]: true } })
    const map = toMap(elements)

    // Populate SnapCache reference boxes
    const refPoints = snap.getReferenceSnapPoints(elements, [orig], appState, map)
    snap.SnapCache.setReferenceSnapPoints(refPoints)

    // Drag east handle +18px -> candidate maxX = 198 (2px from ref minX=200)
    const latestSnapped = makeEl('rectangle', 80, 220, 120, 50, { id: orig.id }) // maxX=200
    const edgeRes = snap.snapResizingElements(
      [latestSnapped],
      [orig],
      { props: {}, state: appState },
      NO_MODIFIERS,
      { x: 18, y: 0 },
      'e',
    )
    expect(edgeRes.snapOffset.x).toBe(2)
    const vLines = edgeRes.snapLines.filter((l): l is PointSnapLine => l.type === 'points')
    expect(vLines).toHaveLength(1)
    expect(vLines[0].role).toBe('edge')
    // Co-linear merge spans refTop (y=40) through resized box (y=270)
    expect(vLines[0].points).toEqual([
      [200, 40],
      [200, 270],
    ])

    // Drag east handle +69px -> candidate maxX = 249 (1px from refTop cx=250) -> snaps with role: "center"
    const centerRes = snap.snapResizingElements(
      [makeEl('rectangle', 80, 220, 170, 50, { id: orig.id })],
      [orig],
      { props: {}, state: appState },
      NO_MODIFIERS,
      { x: 69, y: 0 },
      'e',
    )
    expect(centerRes.snapOffset.x).toBe(1)
    const centerLines = centerRes.snapLines.filter((l): l is PointSnapLine => l.type === 'points')
    expect(centerLines).toHaveLength(1)
    expect(centerLines[0].role).toBe('center')
    expect(centerLines[0].points).toEqual([
      [250, 40],
      [250, 270],
    ])
  })

  it('breaks resize ties in favor of the visually nearest neighbor', () => {
    const farRef = makeEl('rectangle', 200, 1200, 80, 40) // minX=200 (offset 0)
    const nearRef = makeEl('rectangle', 201, 140, 80, 40) // minX=201 (offset +1, within 1.5px tie band, much closer)
    const orig = makeEl('rectangle', 80, 220, 100, 50) // maxX=180
    const elements = [farRef, nearRef, orig]
    const appState = makeAppState({ selectedElementIds: { [orig.id]: true } })
    const map = toMap(elements)

    snap.SnapCache.setReferenceSnapPoints(snap.getReferenceSnapPoints(elements, [orig], appState, map))

    const res = snap.snapResizingElements(
      [makeEl('rectangle', 80, 220, 121, 50, { id: orig.id })],
      [orig],
      { props: {}, state: appState },
      NO_MODIFIERS,
      { x: 20, y: 0 },
      'e',
    )
    expect(res.snapOffset.x).toBe(1)
  })
})

describe('Round 2 #5: Option+T keyboard shortcut for Tidy up', () => {
  it('triggers on Alt+T without Cmd/Ctrl and rejects plain T or Cmd+Alt+T', () => {
    expect(typeof snap.actionTidyUp.keyTest).toBe('function')
    expect(snap.actionTidyUp.keyTest!({ altKey: true, ctrlKey: false, metaKey: false, code: 'KeyT' })).toBe(true)
    expect(snap.actionTidyUp.keyTest!({ altKey: false, ctrlKey: false, metaKey: false, code: 'KeyT' })).toBe(false)
    expect(snap.actionTidyUp.keyTest!({ altKey: true, ctrlKey: true, metaKey: true, code: 'KeyT' })).toBe(false)
    expect(snap.actionTidyUp.keyTest!({ altKey: true, ctrlKey: false, metaKey: false, code: 'KeyH' })).toBe(false)
  })
})

describe('Round 2 #6: Opt-in Show size while resizing setting & badge', () => {
  const fullPrefs = (over: Partial<CanvasPrefs> = {}): CanvasPrefs => ({ ...DEFAULT_CANVAS_PREFS, ...over })

  it('defaults showResizeSizeBadge to false and validates/maps cleanly in canvasPrefs', () => {
    expect(DEFAULT_CANVAS_PREFS.showResizeSizeBadge).toBe(false)
    expect(sanitizeCanvasPrefs({}).showResizeSizeBadge).toBe(false)
    expect(sanitizeCanvasPrefs({ showResizeSizeBadge: true }).showResizeSizeBadge).toBe(true)
    expect(sanitizeCanvasPrefs({ showResizeSizeBadge: 'yes' }).showResizeSizeBadge).toBe(false)

    expect(isCanvasPrefs(fullPrefs({ showResizeSizeBadge: true }))).toBe(true)
    expect(isCanvasPrefs({ ...fullPrefs(), showResizeSizeBadge: 1 })).toBe(false)

    expect(prefsToAppState(fullPrefs({ showResizeSizeBadge: true }), ['showResizeSizeBadge'])).toEqual({
      showResizeSizeBadge: true,
    })
    expect(appStateToPrefs({ showResizeSizeBadge: true }, fullPrefs({ showResizeSizeBadge: false })).showResizeSizeBadge).toBe(true)
    expect(appStateToPrefs({}, fullPrefs({ showResizeSizeBadge: true })).showResizeSizeBadge).toBe(true)
  })

  it('renders W × H magenta pill only when showResizeSizeBadge and isResizing are both true', () => {
    const box = makeEl('rectangle', 100, 100, 240, 120)

    // Off by default -> draws nothing
    const offMock = makeMockCanvasContext()
    snap.renderResizeSizeBadge(offMock.ctx, makeAppState({ showResizeSizeBadge: false, isResizing: true }), [box])
    expect(offMock.calls).toEqual([])

    // Not resizing -> draws nothing
    const idleMock = makeMockCanvasContext()
    snap.renderResizeSizeBadge(idleMock.ctx, makeAppState({ showResizeSizeBadge: true, isResizing: false }), [box])
    expect(idleMock.calls).toEqual([])

    // Enabled + resizing (light mode) -> draws "240 × 120" in light magenta
    const lightMock = makeMockCanvasContext()
    snap.renderResizeSizeBadge(lightMock.ctx, makeAppState({ showResizeSizeBadge: true, isResizing: true, theme: 'light' }), [box])
    expect(lightMock.calls.find((c) => c.method === 'fill')?.fillStyle).toBe('#e024a7')
    expect(lightMock.calls.find((c) => c.method === 'fillText')?.args[0]).toBe('240 × 120')

    // Enabled + resizing (dark mode) -> draws "240 × 120" in dark-filtered magenta
    const darkMock = makeMockCanvasContext()
    snap.renderResizeSizeBadge(darkMock.ctx, makeAppState({ showResizeSizeBadge: true, isResizing: true, theme: 'dark' }), [box])
    expect(darkMock.calls.find((c) => c.method === 'fill')?.fillStyle).toBe('#a8187d')
    expect(darkMock.calls.find((c) => c.method === 'fillText')?.args[0]).toBe('240 × 120')
  })
})

// -----------------------------------------------------------------------------
// Standalone text visual bounds (getFreeTextInteractionCoords)
// -----------------------------------------------------------------------------

describe('Standalone text visual bounds (getFreeTextInteractionCoords)', () => {
  function makeStandaloneText(x: number, y: number, width = 80, height = 50): TestElement {
    return makeEl('text', x, y, width, height, {
      containerId: null,
      autoResize: true,
      text: 'test',
      originalText: 'test',
      fontSize: 40,
      fontFamily: 2,
      lineHeight: 1.25,
      textAlign: 'left',
      verticalAlign: 'top',
    })
  }

  function mockTextMeasurementContext() {
    const mockCtx = {
      font: '',
      textAlign: 'left',
      direction: 'ltr',
      measureText: () => ({
        width: 80,
        actualBoundingBoxLeft: 0,
        actualBoundingBoxRight: 80,
        actualBoundingBoxAscent: 10,
        actualBoundingBoxDescent: 2,
      }),
    } as unknown as CanvasRenderingContext2D

    return vi
      .spyOn(HTMLCanvasElement.prototype, 'getContext')
      .mockReturnValue(mockCtx as unknown as ReturnType<HTMLCanvasElement['getContext']>)
  }

  it('centers standalone text using its tight glyph bounds rather than invisible top font headroom', () => {
    const spy = mockTextMeasurementContext()
    try {
      const textEl = makeStandaloneText(110, 100, 80, 50) // raw Y: 100..150, raw cy=125
      const [visMinX, visMinY, visMaxX, visMaxY] = snap.getSnapBounds([textEl], toMap([textEl]))
      const visCy = (visMinY + visMaxY) / 2
      const rawCy = textEl.y + textEl.height / 2

      // Confirm tight glyph metrics stripped significant top headroom and shifted visual center away from raw center
      expect(visMinY).toBeGreaterThan(textEl.y + 10)
      expect(visMaxY - visMinY).toBeLessThan(textEl.height - 20)
      expect(Math.abs(visCy - rawCy)).toBeGreaterThan(6)
      expect(visMaxX - visMinX).toBeGreaterThan(75)

      // Place outer rectangle whose vertical center is 2px below the visual center (far from raw center)
      const rectHeight = 200
      const targetCy = visCy + 2
      const rect = makeEl('rectangle', 0, targetCy - rectHeight / 2, 300, rectHeight)
      const elements = [rect, textEl]

      const res = prepareAndSnap(elements, [textEl.id], { x: 0, y: 0 })
      expect(res.snapOffset.y).toBeCloseTo(2, 4)

      const hCenterLine = res.snapLines.find(
        (l): l is PointSnapLine =>
          l.type === 'points' &&
          l.role === 'center' &&
          l.points.length === 2 &&
          Math.abs(l.points[0][1] - l.points[1][1]) < 0.01,
      )
      expect(hCenterLine).toBeDefined()
      expect(hCenterLine!.points[0][1]).toBeCloseTo(targetCy, 2)
    } finally {
      spy.mockRestore()
    }
  })

  it('measures Option-hover inner padding from standalone text tight glyph bounds', () => {
    const spy = mockTextMeasurementContext()
    try {
      const outer = makeEl('rectangle', 0, 0, 300, 200)
      const textEl = makeStandaloneText(100, 60, 80, 50) // raw top=60, raw bottom=110
      const elements = [outer, textEl]
      const map = toMap(elements)

      const [visMinX, visMinY, visMaxX, visMaxY] = snap.getSnapBounds([textEl], map)
      expect(visMinY).toBeGreaterThan(textEl.y + 10)

      const lines = snap.getAltHoverMeasureLines([textEl], outer, elements, map)
      expect(lines).toHaveLength(4)

      const vLines = lines.filter((l) => l.direction === 'vertical')
      const hLines = lines.filter((l) => l.direction === 'horizontal')
      expect(vLines).toHaveLength(2)
      expect(hLines).toHaveLength(2)

      const topLine = vLines.find((l) => l.points[0][1] === outer.y)
      const bottomLine = vLines.find((l) => l.points[1][1] === outer.y + outer.height)
      expect(topLine?.distance).toBeCloseTo(visMinY - outer.y, 4)
      expect(topLine!.distance!).toBeGreaterThan(textEl.y - outer.y + 10)
      expect(bottomLine?.distance).toBeCloseTo(outer.y + outer.height - visMaxY, 4)

      const leftLine = hLines.find((l) => l.points[0][0] === outer.x)
      const rightLine = hLines.find((l) => l.points[1][0] === outer.x + outer.width)
      expect(leftLine?.distance).toBeCloseTo(visMinX - outer.x, 4)
      expect(rightLine?.distance).toBeCloseTo(outer.x + outer.width - visMaxX, 4)
    } finally {
      spy.mockRestore()
    }
  })
})

// -----------------------------------------------------------------------------
// Custom snap guide color (presets + custom hex + dark-mode pre-compensation)
// -----------------------------------------------------------------------------

describe('Custom snap guide color (snapColor)', () => {
  const fullPrefs = (over: Partial<CanvasPrefs> = {}): CanvasPrefs => ({ ...DEFAULT_CANVAS_PREFS, ...over })

  it('validates #rrggbb hex values in canvasPrefs and falls back to default magenta on invalid input', () => {
    expect(DEFAULT_CANVAS_PREFS.snapColor).toBe('#e024a7')
    expect(SNAP_COLOR_PRESETS).toContain('#e024a7')
    expect(SNAP_COLOR_PRESETS.length).toBeGreaterThanOrEqual(6)

    for (const preset of SNAP_COLOR_PRESETS) {
      expect(sanitizeCanvasPrefs({ snapColor: preset }).snapColor).toBe(preset)
      expect(isCanvasPrefs(fullPrefs({ snapColor: preset }))).toBe(true)
    }
    expect(sanitizeCanvasPrefs({ snapColor: '#12Ab34' }).snapColor).toBe('#12Ab34')
    expect(sanitizeCanvasPrefs({ snapColor: 'magenta' }).snapColor).toBe('#e024a7')
    expect(sanitizeCanvasPrefs({ snapColor: '#fff' }).snapColor).toBe('#e024a7')
    expect(sanitizeCanvasPrefs({}).snapColor).toBe('#e024a7')

    expect(isCanvasPrefs({ ...fullPrefs(), snapColor: 'red' })).toBe(false)
    expect(isCanvasPrefs({ ...fullPrefs(), snapColor: '#12345' })).toBe(false)

    expect(prefsToAppState(fullPrefs({ snapColor: '#3b82f6' }), ['snapColor'])).toEqual({ snapColor: '#3b82f6' })
    expect(appStateToPrefs({ snapColor: '#10b981' }, fullPrefs({ snapColor: '#e024a7' })).snapColor).toBe('#10b981')
    expect(appStateToPrefs({ snapColor: 'not-a-hex' }, fullPrefs({ snapColor: '#3b82f6' })).snapColor).toBe('#3b82f6')
  })

  it('renders custom snapColor in light mode and pre-compensates custom hex in dark mode across guides, gap pills, and resize badge', () => {
    const customBlue = '#3b82f6'
    const darkBlue = snap.preCompensateDarkFilter(customBlue)
    expect(darkBlue).toMatch(/^#[0-9a-f]{6}$/)
    expect(darkBlue).not.toBe(customBlue)

    const gapLine: GapSnapLine = {
      type: 'gap',
      direction: 'horizontal',
      points: [
        [100, 50],
        [148, 50],
      ],
      distance: 48,
      bandSpan: [20, 80],
    }

    // Light mode uses exact custom hex for strokes and pill background, white pill text
    const lightMock = makeMockCanvasContext()
    snap.renderSnaps(lightMock.ctx, makeAppState({ theme: 'light', snapColor: customBlue, snapLines: [gapLine] }))
    expect(lightMock.calls.find((c) => c.method === 'stroke')?.strokeStyle).toBe(customBlue)
    expect(lightMock.calls.find((c) => c.method === 'fill')?.fillStyle).toBe(customBlue)
    expect(lightMock.calls.find((c) => c.method === 'fillText')?.fillStyle).toBe('#ffffff')

    // Dark mode uses pre-compensated hex so invert(93%) hue-rotate(180deg) displays true-to-hue blue
    const darkMock = makeMockCanvasContext()
    snap.renderSnaps(darkMock.ctx, makeAppState({ theme: 'dark', snapColor: customBlue, snapLines: [gapLine] }))
    expect(darkMock.calls.find((c) => c.method === 'stroke')?.strokeStyle).toBe(darkBlue)
    expect(darkMock.calls.find((c) => c.method === 'fill')?.fillStyle).toBe(darkBlue)
    expect(darkMock.calls.find((c) => c.method === 'fillText')?.fillStyle).toBe('#000000')

    // Bright yellow custom color flips pill text to dark in light mode (and white pre-filter in dark mode) for readability
    const yellowLight = makeMockCanvasContext()
    snap.renderSnaps(yellowLight.ctx, makeAppState({ theme: 'light', snapColor: '#facc15', snapLines: [gapLine] }))
    expect(yellowLight.calls.find((c) => c.method === 'fillText')?.fillStyle).toBe('#111111')

    const yellowDark = makeMockCanvasContext()
    snap.renderSnaps(yellowDark.ctx, makeAppState({ theme: 'dark', snapColor: '#facc15', snapLines: [gapLine] }))
    expect(yellowDark.calls.find((c) => c.method === 'fillText')?.fillStyle).toBe('#ffffff')

    // Resize size badge also respects custom snapColor in light & dark mode
    const box = makeEl('rectangle', 100, 100, 200, 100)
    const badgeLight = makeMockCanvasContext()
    snap.renderResizeSizeBadge(badgeLight.ctx, makeAppState({ theme: 'light', snapColor: customBlue, showResizeSizeBadge: true, isResizing: true }), [box])
    expect(badgeLight.calls.find((c) => c.method === 'fill')?.fillStyle).toBe(customBlue)

    const badgeDark = makeMockCanvasContext()
    snap.renderResizeSizeBadge(badgeDark.ctx, makeAppState({ theme: 'dark', snapColor: customBlue, showResizeSizeBadge: true, isResizing: true }), [box])
    expect(badgeDark.calls.find((c) => c.method === 'fill')?.fillStyle).toBe(darkBlue)
  })
})
