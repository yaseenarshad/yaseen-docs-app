/**
 * The line's style in the file (YAZ-3164, 🔒 D1 / D4 / D6 / D7; CONTRACTS rule 41). The `hr` node
 * gets four attributes — `darkness` (% of the text colour), `thickness` (px), `pattern` (`dotted`,
 * `dashed`, or `null` for solid) and `width` (% of the row) — each `null` for its default, and
 * Markdown has no syntax for any of them. The attribute is `pattern`, not `style`: `style` is the
 * DOM attribute that carries the custom properties.
 *
 * ON DISK a plain line is `***`, exactly the bytes of before (rule 6). A styled line is `***`, then
 * an HTML comment as the NEXT block: `<!-- line: darkness 80%, thickness 6px, style dashed, length
 * 40% -->`. Only the parts that are not the default are written, always in that order. A comment,
 * not `<hr …>`: an HTML block of `<hr>` ends only at a blank line, so in a tight bullet with
 * children the next `  * child` line would go INTO it; a comment ends at `-->`. Obsidian and GitHub
 * hide it and show a plain line; an app without this feature keeps it as text (S15, S16).
 *
 * LOAD: `lineStyleRemark` walks every container (the root, lists, list items, blockquotes) and
 * joins a `thematicBreak` with its NEXT sibling when that sibling is our comment — a bare `html`
 * node, or the paragraph that Milkdown's `remarkHtmlTransformer` wraps a block `html` in (it runs
 * first, as part of the preset). The style goes on `node.data.lineStyle` and the comment leaves the
 * tree. Any other comment — other words, another order, a value out of range, a block between it
 * and the line, a comment BEFORE a line, a style word other than `solid`, `dotted` or `dashed`
 * (S72) — is not ours and stays an `html` node, bytes untouched (S5–S7). A hand-written default
 * (`darkness 50%`, `style solid`) reads as the default, so the next save writes plain `***` (S4).
 * Code is never a `thematicBreak` or an `html` node, so it is never touched (S14).
 *
 * SAVE: `toMarkdown` writes the `thematicBreak`, then an `html` node with the comment when any part
 * is not the default. `toDOM` carries the values as the custom properties `--line-darkness`,
 * `--line-thickness` and `--line-width` and the attribute `data-line-pattern` (the node view of
 * `lineView.ts` writes the same names), and `parseDOM` reads them back, so a line copied inside the
 * app pastes with its style (S26, S77).
 *
 * The values and the comment's reader and writer live in `lineComment.ts`, which has no editor
 * imports, so the line-number worker can read the comment too (YAZ-3204); this file re-exports them.
 */
import { hrAttr, hrSchema } from '@milkdown/kit/preset/commonmark'
import { $remark } from '@milkdown/kit/utils'
import type { Node as ProseNode } from '@milkdown/kit/prose/model'
import type { Nodes, Parent, RootContent } from 'mdast'
import {
  LINE_PATTERNS,
  NUMBER_PARTS,
  PLAIN_LINE,
  formatLineComment,
  parseLineComment,
  stored,
  type LinePattern,
  type LineStyle,
} from './lineComment'

export * from './lineComment'

/**
 * Raw values as a style, every value checked against `NUMBER_PARTS` (an attribute set by a
 * transaction, or read from a paste): a number out of its range, or the default, is `null`, and so
 * is a pattern that is not known.
 */
const cleanStyle = (raw: Record<keyof LineStyle, unknown>): LineStyle => {
  const style: LineStyle = { ...PLAIN_LINE }
  for (const { attr, min, max, fallback } of NUMBER_PARTS) {
    const value = raw[attr]
    const n = typeof value === 'number' ? value : Number.parseInt(String(value ?? ''), 10)
    style[attr] = Number.isInteger(n) && n >= min && n <= max ? stored(n, fallback) : null
  }
  style.pattern = LINE_PATTERNS.includes(raw.pattern as LinePattern) ? (raw.pattern as LinePattern) : null
  return style
}

/** The node's attributes as a style, every value checked. */
export const lineStyleOf = (node: ProseNode): LineStyle => cleanStyle(node.attrs as Record<keyof LineStyle, unknown>)

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
        // Each number part's custom property is `--line-<attr>` (`lineStyleProperties`).
        const raw = Object.fromEntries(NUMBER_PARTS.map(({ attr, unit }) => [attr, readProperty(style, `--line-${attr}`, unit)]))
        return { ...cleanStyle({ ...raw, pattern: (dom as HTMLElement).getAttribute(PATTERN_ATTR) } as Record<keyof LineStyle, unknown>) }
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
