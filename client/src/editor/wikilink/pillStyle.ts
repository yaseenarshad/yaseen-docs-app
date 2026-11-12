/**
 * Right-click a pill › "Pill style ›" (YAZ-4924 round 5): ONE link's own style, over the vault's look (Settings › Link
 * pills is the default of every link; this is the link). It is written into the note as the marks the page toolbar
 * writes, around the WHOLE link — `strong` (`**`), `emphasis` (`*`), `underline` (`<u>`), `highlight` (`==`, or
 * `<mark class="highlight-<name>">`) — so the note stays the Markdown it was, and other apps keep the style. No new
 * syntax: the marks are the schema's own, set with `addMark` / `removeMark` over the link's range. A note has no text
 * colour mark (`text_color` is a drawing text box's), so there is no Colour row (the blocker on YAZ-4924).
 *
 * The flyout is built as "Header row style ›" is (`tableRows.ts`): small grey headings, a ✓ at what the link has, and a
 * pick keeps it open (`stay`: `openMenuAt`'s `rebuild` draws the menu again from the note). Each pick is one
 * transaction, one undo. "↺ Back to the vault's look" takes those marks off this link only. A read-only note shows the
 * row disabled with the read-only reason: styling is a change to the note.
 */
import type { Mark, MarkType, Node as ProseNode } from '@milkdown/kit/prose/model'
import type { Transaction } from '@milkdown/kit/prose/state'
import type { EditorView } from '@milkdown/kit/prose/view'
import type { MenuRow } from '../blockHandleMenu'
import { HIGHLIGHT_COLORS, type HighlightColor } from '../marks/highlightColours'
import { capital } from '../table/colours'
import { swatchIcon } from '../table/tableRows'
import { readOnlyTip } from '../../views/readOnlyRows'

/** The letter styles of the Text group, by mark name, as the toolbar names them. */
const TEXT_MARKS = [
  ['strong', 'Bold'],
  ['emphasis', 'Italic'],
  ['underline', 'Underline'],
] as const
/** The marks "Back to the vault's look" takes off. */
const STYLE_MARKS = ['strong', 'emphasis', 'underline', 'highlight'] as const

/** The mark of `type` that EVERY letter of `from`..`to` has, the same on all, or null (none, or not on all). */
function markOver(doc: ProseNode, from: number, to: number, type: MarkType): Mark | null {
  let found: Mark | null | undefined
  doc.nodesBetween(from, to, (node) => {
    if (!node.isText || found === null) return found !== null
    const mark = type.isInSet(node.marks) ?? null
    found = found === undefined ? mark : mark !== null && found.eq(mark) ? found : null
    return false
  })
  return found ?? null
}

/** Whether any letter of `from`..`to` has a mark of one of the style marks: "Back" has something to take off. */
const styled = (doc: ProseNode, from: number, to: number, types: MarkType[]) => types.some((type) => doc.rangeHasMark(from, to, type))

/**
 * The "Pill style" row of the link at `from`..`to`. `keep` wraps each pick (the menu's plugin holds its doc-change close
 * while the pick runs, so the menu stays open). Absent marks in the schema (a stripped-down editor) leave their rows out.
 */
export function pillStyleRow(view: EditorView, from: number, to: number, keep: (run: () => void) => () => void = (run) => run): MenuRow {
  if (!view.editable) return { label: 'Pill style', disabled: true, hint: readOnlyTip(), run: () => {} }
  const { doc, schema } = view.state
  const apply = (change: (tr: Transaction) => void) =>
    keep(() => {
      const tr = view.state.tr
      change(tr)
      if (tr.docChanged) view.dispatch(tr)
    })
  const text: MenuRow[] = TEXT_MARKS.flatMap(([name, label]) => {
    const type = schema.marks[name]
    if (type === undefined) return []
    const on = markOver(doc, from, to, type) !== null
    return [{ label, hint: on ? '✓' : undefined, run: apply((tr) => (on ? tr.removeMark(from, to, type) : tr.addMark(from, to, type.create()))) }]
  })
  const highlight = schema.marks.highlight
  const current = highlight === undefined ? null : markOver(doc, from, to, highlight)
  const colour = (color: HighlightColor): MenuRow => ({
    label: color === null ? 'Yellow' : capital(color),
    icon: swatchIcon(color === null ? 'var(--mark-bg)' : `var(--mark-bg-${color})`),
    hint: current !== null && (current.attrs.color ?? null) === color ? '✓' : undefined,
    run: apply((tr) => tr.removeMark(from, to, highlight).addMark(from, to, highlight!.create({ color }))),
  })
  const highlights: MenuRow[] =
    highlight === undefined
      ? []
      : [{ label: 'None', hint: highlight !== undefined && !doc.rangeHasMark(from, to, highlight) ? '✓' : undefined, run: apply((tr) => tr.removeMark(from, to, highlight)) }, colour(null), ...HIGHLIGHT_COLORS.map(colour)]
  const types = STYLE_MARKS.flatMap((name) => schema.marks[name] ?? [])
  const back: MenuRow = {
    label: "↺ Back to the vault's look",
    disabled: !styled(doc, from, to, types),
    run: apply((tr) => types.forEach((type) => tr.removeMark(from, to, type))),
  }
  return { label: 'Pill style', run: () => {}, stay: true, headings: ['Text', 'Highlight'], children: [text, highlights, [back]] }
}
