/**
 * Unified text colour mark (`text_color`, YAZ-6694 D2): one ProseMirror mark shared by pages, table cells, and
 * drawing text boxes.
 *
 *  - Named colours (`red`, `orange`, `yellow`, `green`, `teal`, `blue`, `purple`, `pink`, `grey`, `brown`) save as
 *    `<span class="text-color-<name>">` and paint via `var(--table-text-<name>)`, adapting automatically between
 *    light and dark themes.
 *  - Custom colours save as `<span style="color: #rrggbb">` (exact lowercase 6-digit hex) and paint with inline
 *    `style="color: #rrggbb"` plus `data-text-color` so drawing text boxes and clipboard round-trips read the exact value.
 *  - Uses `htmlPairs.ts` with `nest` for any `<span …>` so nested `<span>` marks (e.g. `text_color` + `font_size`)
 *    match the right `</span>` on round-trip.
 */
import type { Mark, MarkType } from '@milkdown/kit/prose/model'
import type { Command, EditorState } from '@milkdown/kit/prose/state'
import { $markSchema, $remark } from '@milkdown/kit/utils'
import type { Parent, PhrasingContent } from 'mdast'
import type { Handle, Options as ToMarkdownOptions } from 'mdast-util-to-markdown'
import { toHex, type Hex } from '../../lib/colour'
import { visibleRangeHasMark, visibleRanges } from '../lineSelection'
import { wrapHtmlPairs, type HtmlPairSpec } from './htmlPairs'

/** The 10 named text colours, matching the table palette (`--table-text-*`). */
export const TEXT_COLORS = ['red', 'orange', 'yellow', 'green', 'teal', 'blue', 'purple', 'pink', 'grey', 'brown'] as const
export type TextColorName = (typeof TEXT_COLORS)[number]
export type CustomTextColor = `#${string}`
export type TextColor = TextColorName | CustomTextColor | null

/** Light-mode hex for each named text colour (matches `cardTable.css` `:root` `--table-text-*`). */
export const TEXT_COLOR_HEX: Record<TextColorName, Hex> = {
  red: '#c0392b',
  orange: '#b45309',
  yellow: '#a16207',
  green: '#2e7d32',
  teal: '#0f766e',
  blue: '#1d5fbf',
  purple: '#7b3fbf',
  pink: '#c2185b',
  grey: '#6b6b6b',
  brown: '#8b5a2b',
}

export const isTextColorName = (v: unknown): v is TextColorName =>
  typeof v === 'string' && (TEXT_COLORS as readonly string[]).includes(v)

export const isCustomTextColor = (v: unknown): v is CustomTextColor =>
  typeof v === 'string' && /^#[0-9a-f]{6}$/.test(v)

/** CSS value used to paint `color` in the editor UI: theme token for named, raw hex for custom. */
export const textColorCss = (color: Exclude<TextColor, null>): string =>
  isTextColorName(color) ? `var(--table-text-${color})` : color

/** Solid `#rrggbb` for the Hex code field and Shades row. */
export const textColorHex = (color: Exclude<TextColor, null>): Hex =>
  isTextColorName(color) ? TEXT_COLOR_HEX[color] : (color as Hex)

/** mdast node for `<span class="text-color-...">` or `<span style="color: #rrggbb">`. */
export interface TextColorNode extends Parent {
  type: 'textColor'
  color: Exclude<TextColor, null>
  children: PhrasingContent[]
}

declare module 'mdast' {
  interface PhrasingContentMap {
    textColor: TextColorNode
  }
  interface RootContentMap {
    textColor: TextColorNode
  }
}

/** Any non-self-closing `<span>` opening tag: increments depth in `htmlPairs` so nested spans pair cleanly. */
export const isSpanOpen = (html: string): boolean => /^<span[\s>]/.test(html) && !/\/>$/.test(html)

const TEXT_COLOR_CLASS_OPEN = new RegExp(`^<span class="text-color-(${TEXT_COLORS.join('|')})">$`)
const TEXT_COLOR_HEX_OPEN = /^<span style="color: (#[0-9a-f]{6})">$/

const TEXT_COLOR_PAIRS: HtmlPairSpec<{ color: Exclude<TextColor, null> }> = {
  open: (value) => {
    const match = TEXT_COLOR_CLASS_OPEN.exec(value) ?? TEXT_COLOR_HEX_OPEN.exec(value)
    return match === null ? null : { color: match[1] as Exclude<TextColor, null> }
  },
  nest: isSpanOpen,
  close: '</span>',
  make: ({ color }, children) => ({ type: 'textColor', color, children }),
}

const openTag = (color: Exclude<TextColor, null>): string =>
  isTextColorName(color) ? `<span class="text-color-${color}">` : `<span style="color: ${color}">`

const textColorHandle: Handle & { peek?: Handle } = (node: TextColorNode, _parent, state, info) =>
  `${openTag(node.color)}${state.containerPhrasing(node, { ...info, before: '>', after: '<' })}</span>`
textColorHandle.peek = () => '<'

const toMarkdownExtension: ToMarkdownOptions = { handlers: { textColor: textColorHandle } }

export const textColorRemark = $remark('mdapp-text-color', () => function textColor() {
  const data = this.data()
  data.toMarkdownExtensions = [...(data.toMarkdownExtensions ?? []), toMarkdownExtension]
  return (tree) => wrapHtmlPairs(tree, TEXT_COLOR_PAIRS)
})

function domAttrs(color: string | null): Record<string, string> {
  if (!color) return {}
  if (isTextColorName(color)) return { class: `text-color-${color}`, 'data-text-color': color }
  return { 'data-text-color': color, style: `color: ${color}` }
}

/** Parse an inline CSS `color` property into lowercase `#rrggbb`, ignoring transparent and non-hex values. */
function cssColorHex(value: string): Hex | null {
  const hex = toHex(value)
  if (hex === undefined) return null
  if (hex.length === 9 && hex.endsWith('00')) return null
  return hex.slice(0, 7) as Hex
}

export const textColorSchema = $markSchema('text_color', () => ({
  attrs: { color: { default: null } },
  parseDOM: [
    {
      tag: 'span[data-text-color]',
      getAttrs: (dom) => {
        const color = (dom as HTMLElement).getAttribute('data-text-color')
        return color ? { color } : false
      },
    },
    {
      tag: 'span',
      getAttrs: (dom) => {
        const el = dom as HTMLElement
        const named = TEXT_COLORS.find((c) => el.classList.contains(`text-color-${c}`))
        return named !== undefined ? { color: named } : false
      },
    },
    {
      style: 'color',
      getAttrs: (value) => {
        const hex = cssColorHex(value as string)
        return hex !== null ? { color: hex } : false
      },
    },
  ],
  toDOM: (mark) => ['span', domAttrs((mark.attrs.color as string | null) ?? null), 0],
  parseMarkdown: {
    match: (node) => node.type === 'textColor',
    runner: (state, node, markType) => {
      state.openMark(markType, { color: node.color as Exclude<TextColor, null> })
      state.next(node.children)
      state.closeMark(markType)
    },
  },
  toMarkdown: {
    match: (mark) => mark.type.name === 'text_color',
    runner: (state, mark) => {
      const color = mark.attrs.color as string | null
      if (isTextColorName(color) || isCustomTextColor(color)) {
        state.withMark(mark, 'textColor', undefined, { color })
      }
    },
  },
}))

const markApplies = (state: EditorState, type: MarkType): boolean => {
  const { $from, from, to, empty } = state.selection
  if (empty) return $from.parent.type.allowsMarkType(type)
  let can = false
  state.doc.nodesBetween(from, to, (node) => {
    if (!can) can = node.inlineContent && node.type.allowsMarkType(type)
    return !can
  })
  return can
}

/** Apply `color` to the visible selection (or stored marks at a caret). Never toggles off. */
export const applyTextColor = (type: MarkType, color: Exclude<TextColor, null>): Command => (state, dispatch) => {
  const ranges = visibleRanges(state)
  if (!markApplies(state, type) || (!state.selection.empty && ranges.length === 0)) return false
  const mark = type.create({ color })
  const tr = state.tr
  if (state.selection.empty) tr.addStoredMark(mark)
  else for (const { from, to } of ranges) tr.addMark(from, to, mark)
  dispatch?.(tr.scrollIntoView())
  return true
}

/** Remove `text_color` from the visible selection (or stored marks at a caret). Declines when none is present. */
export const removeTextColor = (type: MarkType): Command => (state, dispatch) => {
  if (state.selection.empty) {
    if (type.isInSet(state.storedMarks ?? state.selection.$from.marks()) === undefined) return false
    dispatch?.(state.tr.removeStoredMark(type))
    return true
  }
  if (!visibleRangeHasMark(state, type)) return false
  const tr = state.tr
  for (const { from, to } of visibleRanges(state)) tr.removeMark(from, to, type)
  dispatch?.(tr.scrollIntoView())
  return true
}

/** Every distinct non-null text colour on the visible selection (at a caret: stored/active marks). */
export function textColorsIn(state: EditorState, type: MarkType): Exclude<TextColor, null>[] {
  const found = new Set<Exclude<TextColor, null>>()
  const add = (marks: readonly Mark[]) => {
    for (const mark of marks) {
      if (mark.type === type && typeof mark.attrs.color === 'string' && mark.attrs.color !== '') {
        found.add(mark.attrs.color as Exclude<TextColor, null>)
      }
    }
  }
  if (state.selection.empty) add(state.storedMarks ?? state.selection.$from.marks())
  else
    for (const { from, to } of visibleRanges(state))
      state.doc.nodesBetween(from, to, (node) => {
        if (node.isText) add(node.marks)
      })
  return [...found]
}

/**
 * The selection's single text colour: `color` when all selected text shares one colour, `null` when none has a
 * text colour, or `undefined` when mixed.
 */
export function selectionTextColor(state: EditorState, type: MarkType): Exclude<TextColor, null> | null | undefined {
  const colorOf = (marks: readonly Mark[]) => {
    const c = type.isInSet(marks)?.attrs.color
    return typeof c === 'string' && c !== '' ? (c as Exclude<TextColor, null>) : null
  }
  if (state.selection.empty) return colorOf(state.storedMarks ?? state.selection.$from.marks())
  let found: Exclude<TextColor, null> | null | undefined
  let mixed = false
  for (const { from, to } of visibleRanges(state)) {
    state.doc.nodesBetween(from, to, (node) => {
      if (mixed || !node.isText) return !mixed
      const color = colorOf(node.marks)
      if (found === undefined) found = color
      else if (found !== color) mixed = true
      return !mixed
    })
    if (mixed) return undefined
  }
  return found ?? null
}

/**
 * First text colour on the visible selection as its CSS value (for the toolbar `A̲▾` bar), or null when none.
 * Stops on the first coloured text node so large selections stay O(1) in the common case.
 */
export function toolbarTextColor(state: EditorState, type: MarkType): string | null {
  const pick = (marks: readonly Mark[]): string | null => {
    const c = type.isInSet(marks)?.attrs.color
    return typeof c === 'string' && c !== '' ? textColorCss(c as Exclude<TextColor, null>) : null
  }
  if (state.selection.empty) return pick(state.storedMarks ?? state.selection.$from.marks())
  let found: string | null = null
  for (const { from, to } of visibleRanges(state)) {
    state.doc.nodesBetween(from, to, (node) => {
      if (found === null && node.isText) found = pick(node.marks)
      return found === null
    })
    if (found !== null) return found
  }
  return null
}

/** Register with `editor.use(textColor)`. */
export const textColor = [textColorRemark, textColorSchema].flat()
