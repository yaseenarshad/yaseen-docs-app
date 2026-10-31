import { remarkCtx, schemaCtx } from '@milkdown/kit/core'
import type { Ctx } from '@milkdown/kit/ctx'
import type { Schema } from '@milkdown/kit/prose/model'
import { ParserState, type Node as MdNode } from '@milkdown/kit/transformer'

export const APP_CLIPBOARD = 'data-yaseendocs-clipboard'

type PasteNode = MdNode & { [key: string]: unknown; children?: PasteNode[]; ordered?: boolean; start?: number; checked?: boolean }

/**
 * Can this editor hold a numbered list? The folder outline's bullets-only lock (`outline/bulletsOnly.ts`) narrows
 * `list_item` to `paragraph bullet_list?` and flattens a pasted list to bullet text; there a plain run keeps its
 * labels as text, as before YAZ-3727 D6, so its numbers never vanish.
 */
export function holdsNumbers(schema: Schema): boolean {
  const { list_item: item, paragraph, ordered_list: ordered } = schema.nodes
  return item.contentMatch.matchType(paragraph)?.matchType(ordered) != null
}

/** Labels that are exactly what the app draws (YAZ-3727 D6): `n.`, `n+1.`, … Any other spelling stays literal (YAZ-1429). */
function plainRun(list: PasteNode, text: string): boolean {
  return (list.children ?? []).every((item, index) => {
    const start = item.position?.start.offset
    return start !== undefined && text.startsWith(`${(list.start ?? 1) + index}.`, start)
  })
}

/**
 * Paste-only AST conversion: source positions retain labels such as 3), 09. and repeated 1. A plain run (`1.`, `2.`, …)
 * stays a real numbered list (YAZ-3727 D6); null when every list is one, so the caller parses the text as Markdown.
 */
export function parseLiteralNumberedPaste(ctx: Ctx, text: string) {
  if (!/\d+[.)](?:\s|$)/.test(text)) return null
  const remark = ctx.get(remarkCtx)
  const tree = remark.runSync(remark.parse(text), text) as PasteNode
  const keepPlain = holdsNumbers(ctx.get(schemaCtx))
  let changed = false
  const visit = (node: PasteNode): void => {
    node.children = node.children?.flatMap(child => {
      visit(child)
      if (child.type !== 'list' || !child.ordered || (keepPlain && plainRun(child, text))) return [child]
      changed = true
      return (child.children ?? []).flatMap((item, index) => {
        const start = item.position?.start.offset
        const pattern = typeof item.checked === 'boolean' ? /^\d+[.)][ \t]+\[[ xX]\][ \t]*/ : /^\d+[.)][ \t]*/
        const marker = start === undefined ? null : pattern.exec(text.slice(start))?.[0]
        const prefix = { type: 'text', value: marker ?? `${(child.start ?? 1) + index}. ` }
        const blocks = item.children ?? []
        if (blocks[0]?.type === 'paragraph') blocks[0].children?.unshift(prefix)
        else blocks.unshift({ type: 'paragraph', children: [prefix] })
        return blocks
      })
    })
  }
  visit(tree)
  return changed ? new ParserState(ctx.get(schemaCtx)).next(tree).toDoc() : null
}

/** Prefix the first text block, not a comment, wrapper or nested list. */
function prependLabel(item: Element, label: string): void {
  const first = [...item.childNodes].find(node => node.nodeType !== 8 && !(node.nodeType === 3 && !node.textContent?.trim()))
  if (first instanceof Element && first.tagName === 'DIV') return prependLabel(first, label)
  const prefix = document.createTextNode(label)
  if (first instanceof Element && first.matches('p, h1, h2, h3, h4, h5, h6')) first.prepend(prefix)
  else if (first instanceof Element && first.matches('ol, ul, pre, blockquote, table, hr')) {
    const paragraph = document.createElement('p')
    paragraph.append(prefix)
    first.before(paragraph)
  } else item.prepend(prefix)
}

/** Native HTML marker types; custom CSS counters are not encoded by OL/LI attributes. */
function ordinalLabel(number: number, type: string): string {
  let label = ''
  if ((type === 'a' || type === 'A') && number > 0) {
    for (let value = number; value > 0; value = Math.floor((value - 1) / 26)) label = String.fromCharCode(97 + (value - 1) % 26) + label
  } else if ((type === 'i' || type === 'I') && number > 0 && number < 4000) {
    let value = number
    const numerals: Array<[number, string]> = [[1000, 'm'], [900, 'cm'], [500, 'd'], [400, 'cd'], [100, 'c'], [90, 'xc'], [50, 'l'], [40, 'xl'], [10, 'x'], [9, 'ix'], [5, 'v'], [4, 'iv'], [1, 'i']]
    for (const [amount, numeral] of numerals) {
      while (value >= amount) { label += numeral; value -= amount }
    }
  }
  return label ? type === type.toUpperCase() ? label.toUpperCase() : label : String(number)
}

/** Identify external list HTML, including list structure hidden in foreign clipboard context. */
export function externalNumberedHTML(html: string): HTMLTemplateElement | null {
  if (!/<ol\b|data-pm-slice\s*=/i.test(html)) return null
  const template = document.createElement('template')
  template.innerHTML = html
  if (template.content.querySelector(`[${APP_CLIPBOARD}]`) && template.content.querySelector('[data-pm-slice]')) return null
  return template.content.querySelector('ol, [data-pm-slice]') ? template : null
}

/** CSS `list-style-type` as an `<ol>` type: Google Docs and Word set letters and roman numerals this way, not with `type`. */
const CSS_LIST_TYPES: Record<string, string> = { 'lower-alpha': 'a', 'lower-latin': 'a', 'upper-alpha': 'A', 'upper-latin': 'A', 'lower-roman': 'i', 'upper-roman': 'I' }
/** No inline `list-style-type`, or `decimal`. */
const decimalStyle = (element: HTMLElement): boolean => /^(decimal)?$/.test(element.style.listStyleType)

/**
 * Keep inline formatting and nested blocks, replacing only external ordered-list markers. Where the editor
 * `holdsNumbers`, a plain decimal `<ol>` (no `reversed`, no item `value`, type `1` or none, no inline `list-style-type`
 * but `decimal` on it or its items) stays a list and pastes as real numbers from its `start` (YAZ-3727 D6).
 */
export function literalNumberedHTML(html: string, keepPlain: boolean): string {
  const template = externalNumberedHTML(html)
  if (!template) return html
  // Foreign context can recreate an ordered list even when its visible HTML has no OL.
  for (const node of template.content.querySelectorAll('[data-pm-slice]')) node.removeAttribute('data-pm-slice')
  // Google Docs puts a sublist beside the items, not in one: move it into the item before it, as ProseMirror would, so
  // a lettered sublist that turns into text below stays under its parent and takes no number of its own (YAZ-3911).
  for (const nested of template.content.querySelectorAll('ol > ol, ol > ul, ul > ol, ul > ul')) {
    const before = nested.previousElementSibling
    if (before?.tagName === 'LI') before.append(nested)
  }
  // Prefix parents before converting children, so empty parent labels stay separate.
  for (const list of template.content.querySelectorAll('ol')) {
    const items = [...list.children].filter((child): child is HTMLLIElement => child.tagName === 'LI')
    if (keepPlain && !list.reversed && /^1?$/.test(list.type) && decimalStyle(list) && items.every((item) => !item.hasAttribute('value') && /^1?$/.test(item.type) && decimalStyle(item))) continue
    let number = list.hasAttribute('start') ? list.start : list.reversed ? items.length : 1
    for (const item of items) {
      if (item.hasAttribute('value')) number = item.value
      const type = /^[1aAiI]$/.test(item.type) ? item.type : (CSS_LIST_TYPES[item.style.listStyleType || list.style.listStyleType] ?? list.type)
      prependLabel(item, `${ordinalLabel(number, type)}. `)
      number += list.reversed ? -1 : 1
      const block = document.createElement('div')
      block.append(...item.childNodes)
      item.replaceWith(block)
    }
    list.replaceWith(...list.childNodes)
  }
  return template.innerHTML
}
