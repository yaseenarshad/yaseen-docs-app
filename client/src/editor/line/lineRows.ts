/**
 * The line's two pickers in the block handle menu (YAZ-3164, 🔒 D3 / D4 / D6; CONTRACTS rule 41):
 * "Line darkness" (%) and "Line thickness" (px), each a number field in the zoom menu's shape.
 *
 * They show only when the handle points at a line (S40, S42): the target is an `hr`, or it sits in
 * a bullet whose FIRST block is an `hr` (Crepe's handle stands for the bullet when its first block
 * is hovered). A bullet whose line is a later block gets the menu of today: that line has a handle
 * of its own. A read-only editor shows no pickers (S51). Each pick is ONE `setNodeMarkup` (one ⌘Z,
 * S50); the default is stored as `null`, so it leaves the comment (S49); the current value never
 * runs (the menu's rule, S47).
 */
import { closeHistory } from '@milkdown/kit/prose/history'
import type { Node as ProseNode } from '@milkdown/kit/prose/model'
import type { EditorView } from '@milkdown/kit/prose/view'
import type { MenuNumberField, RowProvider } from '../blockHandleMenu'
import {
  DARKNESS_DEFAULT,
  DARKNESS_MAX,
  DARKNESS_MIN,
  DARKNESS_PRESETS,
  THICKNESS_DEFAULT,
  THICKNESS_MAX,
  THICKNESS_MIN,
  THICKNESS_PRESETS,
  lineStyleOf,
  type LineStyle,
} from './lineStyle'

/** The line the handle points at, and where it starts; null when it points at anything else. */
export function targetLine(doc: ProseNode, inside: number): { node: ProseNode; pos: number } | null {
  if (inside < 0 || inside >= doc.content.size) return null
  const node = doc.nodeAt(inside)
  if (node?.type.name === 'hr') return { node, pos: inside }
  if (node?.type.name === 'list_item') return node.firstChild?.type.name === 'hr' ? { node: node.firstChild, pos: inside + 1 } : null
  const $pos = doc.resolve(inside)
  for (let depth = $pos.depth; depth > 0; depth--) {
    const item = $pos.node(depth)
    if (item.type.name !== 'list_item') continue
    const first = item.firstChild
    return first?.type.name === 'hr' ? { node: first, pos: $pos.before(depth) + 1 } : null
  }
  return null
}

/**
 * One attribute of the line at `pos`, in one transaction; the default is stored as null. The
 * history is closed first, so a pick is always its own undo step, even right after another change.
 */
const setPart = (view: EditorView, pos: number, attr: keyof LineStyle, value: number, fallback: number) => {
  const node = view.state.doc.nodeAt(pos)
  if (node?.type.name !== 'hr') return
  view.dispatch(closeHistory(view.state.tr).setNodeMarkup(pos, undefined, { ...node.attrs, [attr]: value === fallback ? null : value }))
  view.focus()
}

export const lineRows: RowProvider = (view, target) => {
  if (!view.editable) return []
  const line = targetLine(view.state.doc, target.inside)
  if (line === null) return []
  const style = lineStyleOf(line.node)
  const darkness: MenuNumberField = {
    kind: 'number',
    label: 'Line darkness',
    unit: '%',
    value: style.darkness ?? DARKNESS_DEFAULT,
    presets: DARKNESS_PRESETS,
    fallback: DARKNESS_DEFAULT,
    min: DARKNESS_MIN,
    max: DARKNESS_MAX,
    error: `Use a whole number from ${DARKNESS_MIN}–${DARKNESS_MAX}%.`,
    run: (value) => setPart(view, line.pos, 'darkness', value, DARKNESS_DEFAULT),
  }
  const thickness: MenuNumberField = {
    kind: 'number',
    label: 'Line thickness',
    unit: 'px',
    value: style.thickness ?? THICKNESS_DEFAULT,
    presets: THICKNESS_PRESETS,
    fallback: THICKNESS_DEFAULT,
    min: THICKNESS_MIN,
    max: THICKNESS_MAX,
    error: `Use a whole number from ${THICKNESS_MIN}–${THICKNESS_MAX}px.`,
    run: (value) => setPart(view, line.pos, 'thickness', value, THICKNESS_DEFAULT),
  }
  return [darkness, thickness]
}
