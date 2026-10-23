/**
 * The line's style in the file (YAZ-3164, 🔒 D1 / D4 / D6 / D7; CONTRACTS rule 41). The `hr` node
 * gets four attributes — `darkness` (% of the text colour), `thickness` (px), `pattern` (`dotted`,
 * `dashed`, or `null` for solid) and `width` (% of the row) — each `null` for its default, and
 * Markdown has no syntax for any of them. The attribute is `pattern`, not `style`: `style` is the
 * DOM attribute that carries the custom properties.
 *
 * ON DISK a plain line is `***`, exactly the bytes of before (rule 6). A styled line is `***`, then
 * an HTML comment as the NEXT block: `<!-- line: darkness 80%, thickness 6px, style dashed, length
 * 40% -->`. Only the parts that are not the default are written, always in that order. A comment, not `<hr …>`:
 * an HTML block of `<hr>` ends only at a blank line, so in a tight bullet with children the next
 * `  * child` line would go INTO it; a comment ends at `-->`. Obsidian and GitHub hide it and show a
 * plain line; an app without this feature keeps it as text (S15, S16).
 *
 * LOAD: `lineStyleRemark` walks every container (the root, lists, list items, blockquotes) and joins
 * a `thematicBreak` with its NEXT sibling when that sibling is our comment — a bare `html` node, or
 * the paragraph that Milkdown's `remarkHtmlTransformer` wraps a block `html` in (it runs first, as
 * part of the preset). The style goes on `node.data.lineStyle` and the comment leaves the tree. Any
 * other comment — other words, another order, a value out of range, a block between it and the
 * line, a comment BEFORE a line, a style word other than `solid`, `dotted` or `dashed` (S72) — is not ours and stays an `html` node, bytes untouched (S5–S7). A
 * hand-written default (`darkness 50%`, `style solid`) reads as the default, so the next save writes plain `***`
 * (S4). Code is never a `thematicBreak` or an `html` node, so it is never touched (S14).
 *
 * SAVE: `toMarkdown` writes the `thematicBreak`, then an `html` node with the comment when any part
 * is not the default. `toDOM` carries the values as the custom properties `--line-darkness`,
 * `--line-thickness` and `--line-width` and the attribute `data-line-pattern` (the node view of
 * `lineView.ts` writes the same names), and `parseDOM` reads them back, so a line copied inside the
 * app pastes with its style (S26, S77).
 */
import { hrAttr, hrSchema } from '@milkdown/kit/preset/commonmark'
import { $remark } from '@milkdown/kit/utils'
import type { Node as ProseNode } from '@milkdown/kit/prose/model'
import type { Nodes, Parent, RootContent } from 'mdast'

export const DARKNESS_DEFAULT = 50
export const DARKNESS_PRESETS = [10, 50, 100]
export const DARKNESS_MIN = 5
export const DARKNESS_MAX = 100
export const THICKNESS_DEFAULT = 3
export const THICKNESS_PRESETS = [1, 3, 6]
export const THICKNESS_MIN = 1
export const THICKNESS_MAX = 24
/** The handle's floor (S33). The length's default is 100, never written. */
export const MIN_LINE_WIDTH = 10
export const LINE_WIDTH_DEFAULT = 100
/** The highest length the comment may hold: 100 is the default, so it is never written (🔒 D5). */
const LINE_WIDTH_MAX = 99

/** The patterns that are written (🔒 D7); solid is the default, `null`, and never written (S70). */
export const LINE_PATTERNS = ['dotted', 'dashed'] as const
export type LinePattern = (typeof LINE_PATTERNS)[number]

/** The `hr` attributes. `null` is the default; a stored value is never the default. */
export interface LineStyle {
  darkness: number | null
  thickness: number | null
  pattern: LinePattern | null
  width: number | null
}

export const PLAIN_LINE: LineStyle = { darkness: null, thickness: null, pattern: null, width: null }

/** The number parts: the word in the comment, its unit, the attribute and its range. */
const NUMBER_PARTS = [
  { word: 'darkness', unit: '%', attr: 'darkness', min: DARKNESS_MIN, max: DARKNESS_MAX, fallback: DARKNESS_DEFAULT },
  { word: 'thickness', unit: 'px', attr: 'thickness', min: THICKNESS_MIN, max: THICKNESS_MAX, fallback: THICKNESS_DEFAULT },
  { word: 'length', unit: '%', attr: 'width', min: MIN_LINE_WIDTH, max: LINE_WIDTH_MAX, fallback: LINE_WIDTH_DEFAULT },
] as const

/** Every word in its fixed order (S3, S71). */
const ORDER = ['darkness', 'thickness', 'style', 'length'] as const

/** `<!-- line: … -->`, any spaces inside the delimiters; the parts are read one by one. */
const COMMENT = /^<!--\s*line:\s*([^]*?)\s*-->$/
/** A number part: a word, a space, a whole number with no leading zero, its unit. */
const PART = /^(\w+)\s+([1-9]\d{0,2})(%|px)$/
/** The style part: `solid` is ours too, and reads as the default (S4). */
const STYLE_PART = /^style\s+(solid|dotted|dashed)$/

/** A value in its range, as stored: the default becomes `null`. */
const stored = (value: number, fallback: number): number | null => (value === fallback ? null : value)

/**
 * The style a comment holds, or `null` when it is not the line comment (S5, S6, S72): one to four
 * parts joined by commas, in the fixed order and each at most once — a number part with its own
 * unit and a whole number in its range, or `style` with `solid`, `dotted` or `dashed`. A comment
 * that holds only defaults is still ours: it reads as the plain line (S4).
 */
export function parseLineComment(value: string): LineStyle | null {
  const body = COMMENT.exec(value.trim())?.[1]
  if (body === undefined || body === '') return null
  const style: LineStyle = { ...PLAIN_LINE }
  let next = 0
  for (const text of body.split(/\s*,\s*/)) {
    const word = /^\w+/.exec(text)?.[0] ?? ''
    const index = ORDER.indexOf(word as (typeof ORDER)[number])
    if (index < next) return null
    next = index + 1
    if (word === 'style') {
      const pattern = STYLE_PART.exec(text)?.[1]
      if (pattern === undefined) return null
      style.pattern = pattern === 'solid' ? null : (pattern as LinePattern)
      continue
    }
    const match = PART.exec(text)
    const part = NUMBER_PARTS.find((p) => p.word === word)
    if (match === null || part === undefined) return null
    const n = Number(match[2])
    if (match[3] !== part.unit || n < part.min || n > part.max) return null
    style[part.attr] = stored(n, part.fallback)
  }
  return style
}

/** The comment for a style, or `null` for the plain line: only the parts that are not the default, in order (S2, S3, S71). */
export function formatLineComment(style: LineStyle): string | null {
  const parts = ORDER.flatMap((word) => {
    if (word === 'style') return style.pattern === null ? [] : [`style ${style.pattern}`]
    const part = NUMBER_PARTS.find((p) => p.word === word)!
    const n = style[part.attr]
    return n === null || n === part.fallback ? [] : [`${part.word} ${n}${part.unit}`]
  })
  return parts.length === 0 ? null : `<!-- line: ${parts.join(', ')} -->`
}

/** A pattern for the attribute, or `null` (solid, and anything that is not a known pattern). */
const cleanPattern = (value: unknown): LinePattern | null =>
  LINE_PATTERNS.includes(value as LinePattern) ? (value as LinePattern) : null

/** A number for an attribute, or `null` (the default, and anything not a whole number in range). */
const clean = (value: unknown, min: number, max: number, fallback: number): number | null => {
  const n = typeof value === 'number' ? value : Number.parseInt(String(value ?? ''), 10)
  return Number.isInteger(n) && n >= min && n <= max ? stored(n, fallback) : null
}

/** The node's attributes as a style, every value checked (an attribute set by a transaction or a paste). */
export const lineStyleOf = (node: ProseNode): LineStyle => ({
  darkness: clean(node.attrs.darkness, DARKNESS_MIN, DARKNESS_MAX, DARKNESS_DEFAULT),
  thickness: clean(node.attrs.thickness, THICKNESS_MIN, THICKNESS_MAX, THICKNESS_DEFAULT),
  pattern: cleanPattern(node.attrs.pattern),
  width: clean(node.attrs.width, MIN_LINE_WIDTH, LINE_WIDTH_MAX, LINE_WIDTH_DEFAULT),
})

/** The attribute that carries the pattern on the DOM, in a copy and on the node view's wrapper. */
export const PATTERN_ATTR = 'data-line-pattern'

/** The custom properties for a style: only the parts that are set. `lineView.ts` writes the same. */
export function lineStyleProperties(style: LineStyle): Array<[string, string]> {
  const out: Array<[string, string]> = []
  if (style.darkness !== null) out.push(['--line-darkness', `${style.darkness}%`])
  if (style.thickness !== null) out.push(['--line-thickness', `${style.thickness}px`])
  if (style.width !== null) out.push(['--line-width', `${style.width}%`])
  return out
}

/** One custom property out of a `style` attribute's text, as a whole number with its unit. */
const readProperty = (style: string, name: string, unit: string): number | null => {
  const match = new RegExp(`(?:^|;)\\s*${name}\\s*:\\s*(\\d+)${unit}\\s*(?:;|$)`).exec(style)
  return match === null ? null : Number(match[1])
}

/** The comment a block holds, when the block is nothing but our comment: a bare `html`, or a paragraph wrapping only one. */
const commentStyle = (node: RootContent | undefined): LineStyle | null => {
  if (node === undefined) return null
  if (node.type === 'html') return parseLineComment(node.value)
  if (node.type !== 'paragraph' || node.children.length !== 1) return null
  const only = node.children[0]
  return only.type === 'html' ? parseLineComment(only.value) : null
}

interface LineData {
  lineStyle?: LineStyle
}

/** Every container, depth first: join each `thematicBreak` with the comment right after it. */
const joinComments = (node: Nodes): void => {
  if (!('children' in node)) return
  const parent = node as Parent
  for (let i = 0; i < parent.children.length; i++) {
    const child = parent.children[i]
    if (child.type === 'thematicBreak') {
      const style = commentStyle(parent.children[i + 1])
      if (style !== null) {
        child.data = { ...child.data, lineStyle: style } as typeof child.data
        parent.children.splice(i + 1, 1)
      }
    } else joinComments(child)
  }
}

export const lineStyleRemark = $remark('mdapp-line-style', () => () => (tree) => {
  joinComments(tree as Nodes)
})

export const lineSchema = hrSchema.extendSchema((prev) => (ctx) => ({
  ...prev(ctx),
  attrs: {
    darkness: { default: null },
    thickness: { default: null },
    pattern: { default: null },
    width: { default: null },
  },
  parseDOM: [
    {
      tag: 'hr',
      getAttrs: (dom) => {
        const style = (dom as HTMLElement).getAttribute('style') ?? ''
        return {
          darkness: clean(readProperty(style, '--line-darkness', '%'), DARKNESS_MIN, DARKNESS_MAX, DARKNESS_DEFAULT),
          thickness: clean(readProperty(style, '--line-thickness', 'px'), THICKNESS_MIN, THICKNESS_MAX, THICKNESS_DEFAULT),
          pattern: cleanPattern((dom as HTMLElement).getAttribute(PATTERN_ATTR)),
          width: clean(readProperty(style, '--line-width', '%'), MIN_LINE_WIDTH, LINE_WIDTH_MAX, LINE_WIDTH_DEFAULT),
        }
      },
    },
  ],
  toDOM: (node) => {
    const style = lineStyleOf(node)
    const properties = lineStyleProperties(style)
    const attrs: Record<string, string> = { ...ctx.get(hrAttr.key)(node) }
    if (properties.length > 0) attrs.style = properties.map(([name, value]) => `${name}: ${value}`).join('; ')
    if (style.pattern !== null) attrs[PATTERN_ATTR] = style.pattern
    return ['hr', attrs]
  },
  parseMarkdown: {
    match: ({ type }) => type === 'thematicBreak',
    runner: (state, node, type) => {
      state.addNode(type, { ...((node.data as LineData | undefined)?.lineStyle ?? PLAIN_LINE) })
    },
  },
  toMarkdown: {
    match: (node) => node.type.name === 'hr',
    runner: (state, node) => {
      state.addNode('thematicBreak')
      const comment = formatLineComment(lineStyleOf(node))
      if (comment !== null) state.addNode('html', undefined, comment)
    },
  },
}))

/** Register with `editor.use(lineStyle)`, right after `highlight` in createCrepe. */
export const lineStyle = [lineStyleRemark, lineSchema].flat()
