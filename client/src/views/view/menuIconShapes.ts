/**
 * Single source of truth for customizable context-menu action icon geometry (YAZ-6567).
 * Consumed by React menus (`icons.tsx`), ProseMirror DOM menus (`linkMenu.ts`, `inlineDrawingView.ts`),
 * and `Settings › Appearance › Menus` (`MenuIconsControl.tsx`) so SVG paths are never duplicated.
 */
import type { MenuIconAction, ResolvedMenuIconPicks } from '@shared/menuIcons'

export type SvgShapeSpec = readonly [tag: 'path' | 'rect' | 'line' | 'circle', attrs: Readonly<Record<string, string>>]

export interface MenuIconChoiceMeta<V extends string = string> {
  readonly id: V
  readonly label: string
  readonly shapes: readonly SvgShapeSpec[] | null
}

export const NEW_WINDOW_SHAPES: readonly MenuIconChoiceMeta<ResolvedMenuIconPicks['newWindow']>[] = [
  {
    id: 'box-arrow',
    label: 'Box ↗',
    shapes: [
      ['path', { d: 'M10 2.5h3.5V6' }],
      ['path', { d: 'M7.5 8.5 13.5 2.5' }],
      ['path', { d: 'M12.5 9v3a1.5 1.5 0 0 1-1.5 1.5H4A1.5 1.5 0 0 1 2.5 12V5A1.5 1.5 0 0 1 4 3.5h3' }],
    ],
  },
  {
    id: 'win-arrow',
    label: 'Window ↗',
    shapes: [
      ['path', { d: 'M8.5 2.5H3a1.5 1.5 0 0 0-1.5 1.5v8A1.5 1.5 0 0 0 3 13.5h9a1.5 1.5 0 0 0 1.5-1.5V7.5' }],
      ['line', { x1: '1.5', y1: '5.5', x2: '7.5', y2: '5.5' }],
      ['path', { d: 'M10.25 2.5H14v3.75' }],
      ['path', { d: 'M8.5 8 14 2.5' }],
    ],
  },
  {
    id: 'win-plus',
    label: 'Window +',
    shapes: [
      ['rect', { x: '1.5', y: '2.5', width: '13', height: '11', rx: '1.5' }],
      ['line', { x1: '1.5', y1: '5.75', x2: '14.5', y2: '5.75' }],
      ['path', { d: 'M8 7.75v3.5M6.25 9.5h3.5' }],
    ],
  },
  { id: 'none', label: 'Off', shapes: null },
]

export const DUPLICATE_TAB_SHAPES: readonly MenuIconChoiceMeta<ResolvedMenuIconPicks['duplicateTab']>[] = [
  {
    id: 'clone-plus',
    label: 'Clone +',
    shapes: [
      ['rect', { x: '5', y: '5', width: '9', height: '8.5', rx: '1.4' }],
      ['path', { d: 'M11 5V3.8A1.3 1.3 0 0 0 9.7 2.5H3.3A1.3 1.3 0 0 0 2 3.8v6.4A1.3 1.3 0 0 0 3.3 11.5H5' }],
      ['path', { d: 'M9.5 7.5v3.5M7.75 9.25h3.5' }],
    ],
  },
  {
    id: 'twin-bar',
    label: 'Twin bar',
    shapes: [
      ['rect', { x: '1.5', y: '3', width: '13', height: '10', rx: '1.5' }],
      ['line', { x1: '1.5', y1: '6.5', x2: '14.5', y2: '6.5' }],
      ['line', { x1: '8', y1: '3', x2: '8', y2: '6.5' }],
      ['path', { d: 'M6.25 9.75h3.5M8 8v3.5' }],
    ],
  },
  {
    id: 'two-tabs',
    label: '2 Tabs',
    shapes: [
      ['rect', { x: '4.5', y: '5.25', width: '9.5', height: '8.25', rx: '1.3' }],
      ['line', { x1: '4.5', y1: '7.8', x2: '9.25', y2: '7.8' }],
      ['line', { x1: '9.25', y1: '5.25', x2: '9.25', y2: '7.8' }],
      ['path', { d: 'M11 5.25V3.8A1.3 1.3 0 0 0 9.7 2.5H3.3A1.3 1.3 0 0 0 2 3.8v5.9A1.3 1.3 0 0 0 3.3 11H4.5' }],
    ],
  },
  { id: 'none', label: 'Off', shapes: null },
]

export const OPEN_NEW_TAB_SHAPES: readonly MenuIconChoiceMeta<ResolvedMenuIconPicks['openNewTab']>[] = [
  {
    id: 'tab-bar-plus',
    label: 'Tab bar +',
    shapes: [
      ['rect', { x: '1.5', y: '2.75', width: '13', height: '10.5', rx: '1.5' }],
      ['line', { x1: '1.5', y1: '6.25', x2: '14.5', y2: '6.25' }],
      ['line', { x1: '7', y1: '2.75', x2: '7', y2: '6.25' }],
      ['path', { d: 'M8 8.1v3.3M6.35 9.75h3.3' }],
    ],
  },
  {
    id: 'tab-strip-plus',
    label: 'Tab strip +',
    shapes: [
      ['rect', { x: '1.5', y: '2.75', width: '13', height: '10.5', rx: '1.5' }],
      ['line', { x1: '1.5', y1: '6.5', x2: '14.5', y2: '6.5' }],
      ['line', { x1: '7.5', y1: '2.75', x2: '7.5', y2: '6.5' }],
      ['path', { d: 'M11 3.85v1.6M10.2 4.65h1.6' }],
    ],
  },
  {
    id: 'raised-tab',
    label: 'Raised tab',
    shapes: [
      ['path', { d: 'M1.5 11.5h13' }],
      ['path', { d: 'M2.5 11.5v-5a1.5 1.5 0 0 1 1.5-1.5h4a1.5 1.5 0 0 1 1.5 1.5v5' }],
      ['path', { d: 'M12.25 6.25v3.5M10.5 8h3.5' }],
    ],
  },
  { id: 'none', label: 'Off', shapes: null },
]

export const HIDE_OTHERS_SHAPES: readonly MenuIconChoiceMeta<ResolvedMenuIconPicks['hideOthers']>[] = [
  {
    id: 'isolate',
    label: 'Isolate',
    shapes: [
      ['path', { d: 'M2.25 5.25V3.5A1.25 1.25 0 0 1 3.5 2.25h1.75M10.75 2.25h1.75a1.25 1.25 0 0 1 1.25 1.25v1.75M13.75 10.75v1.75a1.25 1.25 0 0 1-1.25 1.25h-1.75M5.25 13.75H3.5a1.25 1.25 0 0 1-1.25-1.25v-1.75' }],
      ['rect', { x: '5.5', y: '5.5', width: '5', height: '5', rx: '1', fill: 'currentColor', stroke: 'none' }],
    ],
  },
  {
    id: 'solo-row',
    label: 'Solo row',
    shapes: [
      ['line', { x1: '3', y1: '4', x2: '10', y2: '4', opacity: '0.4' }],
      ['rect', { x: '2.5', y: '6.8', width: '11', height: '2.4', rx: '0.8', fill: 'currentColor', stroke: 'none' }],
      ['line', { x1: '3', y1: '12', x2: '10', y2: '12', opacity: '0.4' }],
    ],
  },
  {
    id: 'funnel',
    label: 'Funnel',
    shapes: [['path', { d: 'M2.5 3h11L9.2 8.2v4.4l-2.4 1.2V8.2z' }]],
  },
  { id: 'none', label: 'Off', shapes: null },
]

export const SHOW_IN_SIDEBAR_SHAPES: readonly MenuIconChoiceMeta<ResolvedMenuIconPicks['showInSidebar']>[] = [
  {
    id: 'panel-highlight',
    label: 'Panel + Highlight',
    shapes: [
      ['rect', { x: '1.5', y: '2.5', width: '13', height: '11', rx: '1.5' }],
      ['line', { x1: '6.25', y1: '2.5', x2: '6.25', y2: '13.5' }],
      ['line', { x1: '3.1', y1: '5.5', x2: '4.6', y2: '5.5' }],
      ['rect', { x: '2.9', y: '7.2', width: '2.1', height: '1.6', rx: '0.5', fill: 'currentColor', stroke: 'none' }],
      ['line', { x1: '3.1', y1: '10.5', x2: '4.6', y2: '10.5' }],
    ],
  },
  {
    id: 'panel-arrow',
    label: 'Panel + Arrow',
    shapes: [
      ['rect', { x: '1.5', y: '2.5', width: '13', height: '11', rx: '1.5' }],
      ['line', { x1: '5.75', y1: '2.5', x2: '5.75', y2: '13.5' }],
      ['path', { d: 'M12 8H7.8M9.6 6.2 7.8 8l1.8 1.8' }],
    ],
  },
  {
    id: 'crosshair',
    label: 'Crosshair',
    shapes: [
      ['circle', { cx: '8', cy: '8', r: '4.5' }],
      ['circle', { cx: '8', cy: '8', r: '1.2', fill: 'currentColor', stroke: 'none' }],
      ['path', { d: 'M8 1.5v2M8 12.5v2M1.5 8h2M12.5 8h2' }],
    ],
  },
  { id: 'none', label: 'Off', shapes: null },
]

export const MENU_ICON_CHOICES: { readonly [K in MenuIconAction]: readonly MenuIconChoiceMeta<ResolvedMenuIconPicks[K]>[] } = {
  newWindow: NEW_WINDOW_SHAPES,
  duplicateTab: DUPLICATE_TAB_SHAPES,
  openNewTab: OPEN_NEW_TAB_SHAPES,
  hideOthers: HIDE_OTHERS_SHAPES,
  showInSidebar: SHOW_IN_SIDEBAR_SHAPES,
}

export function menuIconShapesOf<K extends MenuIconAction>(action: K, variant: ResolvedMenuIconPicks[K]): readonly SvgShapeSpec[] | null {
  const list = MENU_ICON_CHOICES[action] as readonly MenuIconChoiceMeta[]
  return list.find((c) => c.id === variant)?.shapes ?? list[0]!.shapes
}

const SVG_NS = 'http://www.w3.org/2000/svg'

/** Builds a 14px stroked DOM `<svg>` for ProseMirror menus (`linkMenu.ts`, `inlineDrawingView.ts`), or null if variant is `'none'`. */
export function createMenuIconSvgElement<K extends MenuIconAction>(action: K, variant: ResolvedMenuIconPicks[K]): SVGElement | null {
  const shapes = menuIconShapesOf(action, variant)
  if (shapes === null) return null
  const svg = document.createElementNS(SVG_NS, 'svg')
  for (const [k, v] of Object.entries({
    width: '14',
    height: '14',
    viewBox: '0 0 16 16',
    fill: 'none',
    stroke: 'currentColor',
    'stroke-width': '1.2',
    'stroke-linecap': 'round',
    'stroke-linejoin': 'round',
    'aria-hidden': 'true',
  })) {
    svg.setAttribute(k, v)
  }
  for (const [tag, attrs] of shapes) {
    const node = document.createElementNS(SVG_NS, tag)
    for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, v)
    svg.appendChild(node)
  }
  return svg
}
