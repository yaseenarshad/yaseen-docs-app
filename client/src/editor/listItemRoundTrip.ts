/**
 * Empty list items round-trip (GRO-2012). Milkdown serialises an empty paragraph as the html
 * node `<br />`, so an empty bullet (Enter at the end of an item, outdented empty item, …)
 * was written as `* <br />`. That is not harmless: on the next load CommonMark reads `<br />`
 * as the start of an HTML block that runs to the next blank line, so the item's nested
 * children became literal text. Obsidian writes an empty bullet as a bare marker.
 *
 * Four pieces, all schema/remark/text-level (no Milkdown fork):
 *  1. serialise: an empty paragraph that STARTS a list item is emitted as an empty mdast
 *     paragraph → bare marker (`*`, `1.`); other empty paragraphs keep `<br />`. Inside Milkdown
 *     an empty TASK item stays `* [ ] <br />` (remark drops the checkbox from `* [ ]`, and `[ ]`
 *     already stops the HTML-block reading) — see 4 for what reaches the disk.
 *  2. parse: a listItem whose nested list starts on a later line (`* ` + children — what
 *     Obsidian writes for an empty parent) gets an empty leading paragraph, instead of
 *     becoming a list_item that starts with a bullet_list and serialising as `* * child`.
 *     `* 1) text` on ONE line (a real vault idiom) is left as the list-first item it was.
 *  3. load: `normalizeEmptyItems()` rewrites `* <br />` lines (written by earlier builds) to
 *     bare markers so their children are not swallowed, and Obsidian's empty task `* [ ] ` /
 *     `* [ ]` (text `[ ]` for remark, round-tripped as `* \[ ]`) to `* [ ] <br />` so it stays a
 *     checkbox.
 *  4. save: `stripEmptyTaskBreaks()` turns `* [ ] <br />` back into `* [ ]` — `<br />` never
 *     reaches the disk, and 3 restores the checkbox on the next load.
 */
import { paragraphSchema } from '@milkdown/kit/preset/commonmark'
import type { Node as MdNode } from '@milkdown/kit/transformer'
import { $remark } from '@milkdown/kit/utils'

type MdParent = MdNode & { children?: MdParent[]; position?: { start: { line: number } } }

const emptyParagraphFirstInListItem = paragraphSchema.extendSchema((prev) => (ctx) => {
  const base = prev(ctx)
  return {
    ...base,
    toMarkdown: {
      match: base.toMarkdown.match,
      runner: (state, node) => {
        const parent = state.top()
        if (node.content.size === 0 && parent?.type === 'listItem' && !parent.children?.length && typeof parent.props.checked !== 'boolean') {
          state.openNode('paragraph')
          state.closeNode()
          return
        }
        base.toMarkdown.runner(state, node)
      },
    },
  }
})

/** An item whose nested list starts on a LATER line (`* ` + children); `* 1) x` on one line is left as is. */
const isEmptyParent = (item: MdParent): boolean => {
  const first = item.children?.[0]
  if (first?.type !== 'list') return false
  const itemLine = item.position?.start.line
  const listLine = first.position?.start.line
  return itemLine === undefined || listLine === undefined || listLine > itemLine
}

const addLeadingParagraph = (node: MdParent): void => {
  if (!node.children) return
  if (node.type === 'listItem' && isEmptyParent(node)) node.children.unshift({ type: 'paragraph', children: [] })
  node.children.forEach(addLeadingParagraph)
}

const listItemLeadingParagraph = $remark('mdapp-list-item-leading-paragraph', () => () => (tree: MdParent) => {
  addLeadingParagraph(tree)
})

/** Register with `editor.use(...)`. */
export const listItemRoundTrip = [emptyParagraphFirstInListItem, listItemLeadingParagraph].flat()

const MARKER = String.raw`[ \t]*(?:[-*+]|\d+[.)])`
const LEGACY_EMPTY_ITEM = new RegExp(String.raw`^(${MARKER}) <br />[ \t]*$`, 'gm')
const EMPTY_TASK_ITEM = new RegExp(String.raw`^(${MARKER} \[[ xX]\])[ \t]*$`, 'gm')
const EMPTY_TASK_ITEM_BREAK = new RegExp(String.raw`^(${MARKER} \[[ xX]\]) <br />$`, 'gm')

/** Before parsing: `* <br />` → bare marker; empty task `* [ ]` → `* [ ] <br />` (keeps the checkbox). */
export const normalizeEmptyItems = (markdown: string): string =>
  markdown.replace(LEGACY_EMPTY_ITEM, '$1').replace(EMPTY_TASK_ITEM, '$1 <br />')

/** Before writing: `* [ ] <br />` (Milkdown's empty task) → `* [ ]`. */
export const stripEmptyTaskBreaks = (markdown: string): string => markdown.replace(EMPTY_TASK_ITEM_BREAK, '$1')
