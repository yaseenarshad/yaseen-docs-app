/**
 * "Open in new tab" (YAZ-3646 D8, D9): the first row of a bullet's menu, from its dot or its 6-dot handle,
 * in a group of its own. The bullet opens in a copy of this tab right after it, zoomed into it; ⇧-click on
 * the dot does the same, so the row says so. No row off a list item, or in a page with no tab (`open`).
 */
import type { EditorView } from '@milkdown/kit/prose/view'
import type { MenuRow } from '../blockHandleMenu'
import type { HandleTarget } from '../blockHandleTarget'
import { nearestListItem } from './numberChildren'
import { zoomKeyAt, zoomLabelAt, type ZoomOptions } from './zoom'

const SVG = 'http://www.w3.org/2000/svg'

/** A tab with a plus (14 px, stroked like the tab menu's glyphs): "a new tab". */
function newTabGlyph(): SVGElement {
  const svg = document.createElementNS(SVG, 'svg')
  for (const [k, v] of Object.entries({ width: '14', height: '14', viewBox: '0 0 16 16', fill: 'none', stroke: 'currentColor', 'stroke-width': '1.2', 'stroke-linecap': 'round', 'stroke-linejoin': 'round', 'aria-hidden': 'true' })) svg.setAttribute(k, v)
  const path = document.createElementNS(SVG, 'path')
  path.setAttribute('d', 'M2.5 13.5v-9h4l1-1.5h6v10.5zM8 7v4.5M5.75 9.25h4.5')
  svg.appendChild(path)
  return svg
}

export function openBulletRow(view: EditorView, target: HandleTarget, open: ZoomOptions['onOpen']): MenuRow[] {
  if (open === undefined || target.inside < 0) return []
  const item = nearestListItem(view.state.doc, target.inside)
  const key = item === null ? null : zoomKeyAt(view.state.doc, item.pos)
  if (item === null || key === null) return []
  return [{ label: 'Open in new tab', group: 'open', icon: newTabGlyph, hint: '⇧-click', run: () => open(key, false, zoomLabelAt(view.state.doc, item.pos)) }]
}
