/**
 * Right-click a pill › "Pill style ›" (YAZ-4924 round 5; upgraded to tabbed 10×8 Google Docs `ColourGrid` in YAZ-6735):
 * ONE link's own style, written into the page as the marks the page toolbar writes around the WHOLE link —
 * `strong`, `emphasis`, `underline`, `strike_through`, `text_color`, `highlight` — so the page stays clean Markdown.
 *
 * Compact tabbed flyout (`Text | Text colour | Highlight`), keeping the parent link menu slim and staying open on pick
 * so several styles apply in one visit. "↺ Back to the vault's look" clears all link marks.
 */
import type { Mark, MarkType, Node as ProseNode } from '@milkdown/kit/prose/model'
import type { Transaction } from '@milkdown/kit/prose/state'
import type { EditorView } from '@milkdown/kit/prose/view'
import { QUICK_HIGHLIGHT_NAMES } from '@shared/types'
import type { Hex } from '../../lib/colour'
import type { MenuRow } from '../blockHandleMenu'
import { ColourGrid } from '../colourGrid'
import type { HighlightColor } from '../marks/highlightColours'
import { textColorHex, type TextColor } from '../marks/textColor'

/** The letter styles of the Text tab, by mark name, as the toolbar names them. */
const TEXT_MARKS = [
  ['strong', 'Bold'],
  ['emphasis', 'Italic'],
  ['underline', 'Underline'],
  ['strike_through', 'Strikethrough'],
] as const

/** The marks "Back to the vault's look" takes off. */
const STYLE_MARKS = ['strong', 'emphasis', 'underline', 'strike_through', 'font_size', 'text_color', 'highlight'] as const

const SOFT_WASH_ITEMS = QUICK_HIGHLIGHT_NAMES.map((name) => ({
  key: name,
  label: `${name[0]!.toUpperCase() + name.slice(1)} (soft wash)`,
  value: name,
  swatch: name === 'yellow' ? 'var(--mark-bg)' : `var(--mark-bg-${name})`,
  isLight: true,
}))

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
 * while the pick runs, so the menu stays open). Absent marks in the schema leave their tabs out.
 */
export function pillStyleRow(view: EditorView, from: number, to: number, keep: (run: () => void) => () => void = (run) => run, allowHighlight = true): MenuRow {
  if (!view.editable) return { label: 'Pill style', disabled: true, hint: 'Read only', run: () => {} }
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

  const types = (allowHighlight ? STYLE_MARKS : STYLE_MARKS.filter((name) => name !== 'highlight')).flatMap((name) => schema.marks[name] ?? [])
  const back: MenuRow = {
    label: "↺ Back to the vault's look",
    disabled: !styled(doc, from, to, types),
    run: apply((tr) => types.forEach((type) => tr.removeMark(from, to, type))),
  }

  const tabs: NonNullable<MenuRow['tabs']> = [
    { label: 'Text', children: [text, [back]] },
  ]

  const textColor = schema.marks.text_color
  if (textColor !== undefined) {
    const activeValues = (): string[] => {
      const m = markOver(view.state.doc, from, to, textColor)
      if (m === null) return []
      const c = m.attrs.color as Exclude<TextColor, null>
      return [c.startsWith('#') ? c : textColorHex(c)]
    }
    tabs.push({
      label: 'Text colour',
      children: [],
      render: (host, _close, refresh) => {
        const grid = new ColourGrid(host.ownerDocument, {
          noneLabel: 'Default',
          allowAlpha: false,
          defaultBoxHex: () => '#000000',
          onPick: (value, isCustom) => {
            const run = apply((tr) => tr.removeMark(from, to, textColor).addMark(from, to, textColor.create({ color: value })))
            if (!isCustom && refresh !== undefined) refresh(run)
            else {
              run()
              grid.render(activeValues(), value.startsWith('#') ? (value as Hex) : '#000000')
            }
          },
          onClear: () => {
            const run = apply((tr) => tr.removeMark(from, to, textColor))
            if (refresh !== undefined) refresh(run)
            else {
              run()
              grid.render([], '#000000')
            }
          },
        })
        const vals = activeValues()
        grid.render(vals, (vals[0] as Hex | undefined) ?? '#000000')
        host.append(grid.el)
      },
    })
  }

  const highlight = allowHighlight ? schema.marks.highlight : undefined
  if (highlight !== undefined) {
    const activeValues = (): string[] => {
      const m = markOver(view.state.doc, from, to, highlight)
      if (m === null) return []
      const c = (m.attrs.color ?? null) as HighlightColor
      return [c === null ? 'yellow' : c]
    }
    tabs.push({
      label: 'Highlight',
      children: [],
      render: (host, _close, refresh) => {
        const grid = new ColourGrid(host.ownerDocument, {
          noneLabel: 'No highlight',
          allowAlpha: true,
          defaultBoxHex: () => '#ffff00',
          extraRow: { heading: 'Soft washes', items: SOFT_WASH_ITEMS },
          onPick: (value, isCustom) => {
            const color: HighlightColor = value === 'yellow' ? null : (value as Exclude<HighlightColor, null>)
            const run = apply((tr) => tr.removeMark(from, to, highlight).addMark(from, to, highlight.create({ color })))
            if (!isCustom && refresh !== undefined) refresh(run)
            else {
              run()
              grid.render(activeValues(), value.startsWith('#') ? (value as Hex) : '#ffff00')
            }
          },
          onClear: () => {
            const run = apply((tr) => tr.removeMark(from, to, highlight))
            if (refresh !== undefined) refresh(run)
            else {
              run()
              grid.render([], '#ffff00')
            }
          },
        })
        const vals = activeValues()
        grid.render(vals, vals[0]?.startsWith('#') ? (vals[0] as Hex) : '#ffff00')
        host.append(grid.el)
      },
    })
  }

  return {
    label: 'Pill style',
    run: () => {},
    stay: true,
    tabs,
  }
}
