/**
 * The line's three pickers in the block handle menu (YAZ-3164, 🔒 D3 / D4 / D6 / D7; CONTRACTS rule
 * 41): "Line darkness" (%) and "Line thickness" (px), number fields in the zoom menu's shape, and
 * "Line style" (YAZ-3198), a choice of Solid, Dotted and Dashed, each with a small sample (S78).
 *
 * They show only when the handle points at a line (S40, S42): the probe's node is an `hr`, or a
 * bullet whose FIRST block is an `hr` (Crepe's handle stands for the bullet when its first block is
 * hovered). A line that is a LATER block of a bullet gets the pickers from its OWN 6-dot handle
 * (Crepe gives that block one); the bullet's own handle shows none, and neither does any other
 * block of that bullet (S41, S42). A read-only editor shows no pickers (S51). Each pick is ONE
 * `setNodeMarkup` (one ⌘Z, S50), written as picked, also when it equals the default (YAZ-3208 D9,
 * S93). Each list starts with "Default (<the vault's current default>)", read from the line's
 * computed `--line-default-*`; only it stores `null`, which leaves the comment (D11, S94). The
 * current value never runs (the menu's rule, S47). The menu's close puts the focus back.
 */
import { closeHistory } from '@milkdown/kit/prose/history'
import type { Node as ProseNode } from '@milkdown/kit/prose/model'
import type { EditorView } from '@milkdown/kit/prose/view'
import type { MenuChoiceField, MenuNumberField, RowProvider } from '../blockHandleMenu'
import {
  DARKNESS_DEFAULT,
  DARKNESS_MAX,
  DARKNESS_MIN,
  DARKNESS_PRESETS,
  THICKNESS_DEFAULT,
  THICKNESS_MAX,
  THICKNESS_MIN,
  THICKNESS_PRESETS,
  PATTERN_DEFAULT,
  type LinePattern,
  lineStyleOf,
  type LineStyle,
} from './lineStyle'

/** The line the handle points at, and where it starts; null when it points at anything else. */
export function targetLine(doc: ProseNode, inside: number): { node: ProseNode; pos: number } | null {
  if (inside < 0 || inside >= doc.content.size) return null
  const node = doc.nodeAt(inside)
  if (node?.type.name === 'hr') return { node, pos: inside }
  if (node?.type.name !== 'list_item' || node.firstChild?.type.name !== 'hr') return null
  return { node: node.firstChild, pos: inside + 1 }
}

/**
 * One attribute of the line at `pos`, in one transaction: the value as picked, also when it equals
 * the default, and `null` only from the "Default" item (YAZ-3208 D9). The history is closed first,
 * so a pick is always its own undo step, even right after another change.
 */
const setPart = (view: EditorView, pos: number, attr: keyof LineStyle, value: number | string | null) => {
  const node = view.state.doc.nodeAt(pos)
  if (node?.type.name !== 'hr') return
  view.dispatch(closeHistory(view.state.tr).setNodeMarkup(pos, undefined, { ...node.attrs, [attr]: value }))
}

/**
 * The vault's current default line, as the line's own wrapper computes it (D11): the
 * `--line-default-*` properties that `textVars` puts on the page layer, else the app's defaults.
 */
function currentDefaults(view: EditorView, pos: number): { darkness: number; thickness: number; pattern: LinePattern } {
  const dom = view.nodeDOM(pos)
  const style = dom instanceof Element ? getComputedStyle(dom) : null
  const read = (name: string, min: number, max: number, fallback: number): number => {
    const n = Number.parseInt(style?.getPropertyValue(name).trim() ?? '', 10)
    return Number.isInteger(n) && n >= min && n <= max ? n : fallback
  }
  const pattern = style?.getPropertyValue('--line-default-pattern').trim() ?? ''
  return {
    darkness: read('--line-default-darkness', DARKNESS_MIN, DARKNESS_MAX, DARKNESS_DEFAULT),
    thickness: read('--line-default-thickness', THICKNESS_MIN, THICKNESS_MAX, THICKNESS_DEFAULT),
    pattern: pattern === 'dotted' || pattern === 'dashed' ? pattern : PATTERN_DEFAULT,
  }
}

export const lineRows: RowProvider = (view, target) => {
  if (!view.editable) return []
  const line = targetLine(view.state.doc, target.inside)
  if (line === null) return []
  const style = lineStyleOf(line.node)
  const defaults = currentDefaults(view, line.pos)
  const darkness: MenuNumberField = {
    kind: 'number',
    label: 'Line darkness',
    unit: '%',
    value: style.darkness,
    presets: DARKNESS_PRESETS,
    fallback: defaults.darkness,
    min: DARKNESS_MIN,
    max: DARKNESS_MAX,
    error: `Use a whole number from ${DARKNESS_MIN}–${DARKNESS_MAX}%.`,
    run: (value) => setPart(view, line.pos, 'darkness', value),
  }
  const thickness: MenuNumberField = {
    kind: 'number',
    label: 'Line thickness',
    unit: 'px',
    value: style.thickness,
    presets: THICKNESS_PRESETS,
    fallback: defaults.thickness,
    min: THICKNESS_MIN,
    max: THICKNESS_MAX,
    error: `Use a whole number from ${THICKNESS_MIN}–${THICKNESS_MAX}px.`,
    run: (value) => setPart(view, line.pos, 'thickness', value),
  }
  const pattern: MenuChoiceField = {
    kind: 'choice',
    label: 'Line style',
    value: style.pattern,
    choices: [
      { value: 'solid', label: 'Solid', sample: 'line-sample' },
      { value: 'dotted', label: 'Dotted', sample: 'line-sample line-sample--dotted' },
      { value: 'dashed', label: 'Dashed', sample: 'line-sample line-sample--dashed' },
    ],
    fallback: defaults.pattern,
    run: (value) => setPart(view, line.pos, 'pattern', value),
  }
  return [darkness, thickness, pattern]
}
