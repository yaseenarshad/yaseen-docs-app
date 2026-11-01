/**
 * "Open in new tab" (YAZ-3646 D8, D9): the first row of a bullet's menu, from its dot or its 6-dot handle,
 * in a group of its own. The bullet opens in a copy of this tab right after it, zoomed into it; ⇧-click on
 * the dot does the same. No row off a list item, or in a page with no tab (`open`). No glyph (YAZ-3727 D19): it
 * was the menu's only one, and it pushed every other row right to line up after it. No "⇧-click" hint (D20): it
 * made the menu wider than its strip, and the text's menu shows the row too, where ⇧-click only extends the selection.
 */
import type { EditorView } from '@milkdown/kit/prose/view'
import type { MenuRow } from '../blockHandleMenu'
import type { HandleTarget } from '../blockHandleTarget'
import { nearestListItem } from './numberChildren'
import { zoomKeyAt, zoomLabelAt, type ZoomOptions } from './zoom'

export function openBulletRow(view: EditorView, target: HandleTarget, open: ZoomOptions['onOpen']): MenuRow[] {
  if (open === undefined || target.inside < 0) return []
  const item = nearestListItem(view.state.doc, target.inside)
  const key = item === null ? null : zoomKeyAt(view.state.doc, item.pos)
  if (item === null || key === null) return []
  return [{ label: 'Open in new tab', group: 'open', run: () => open(key, false, zoomLabelAt(view.state, item.pos)) }]
}
