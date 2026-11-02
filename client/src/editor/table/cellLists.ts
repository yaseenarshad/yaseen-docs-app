/**
 * Lists in a table cell (YAZ-3818 D2). A table row is one line of the file, so a body cell's list
 * is HTML: `<ul>` / `<ol>` / `<ol start="N">`, `<li>…</li>`, a to-do as `[ ] ` / `[x] ` at the
 * start of the item. An item's words stay Markdown (`<li>**F** [a](b)</li>`). GitHub shows this
 * form as real bullets, numbers and checkboxes.
 *
 * Only this exact form reads back as a list: tags that do not balance, other spellings
 * (`<UL>`, `<ul class="x">`), text between the tags, and any other HTML inside the list keep the
 * cell as typed. A header cell is never read as a list (D7).
 */
import type { Node as PMNode } from '@milkdown/kit/prose/model'
import type { SerializerState } from '@milkdown/kit/transformer'
import { $remark } from '@milkdown/kit/utils'
import type { List, ListItem, Paragraph, PhrasingContent, RootContent, Table } from 'mdast'
import { visit } from 'unist-util-visit'

/** A bullet or numbered list node. */
export const isCellList = (node: PMNode): boolean => node.type.name === 'bullet_list' || node.type.name === 'ordered_list'

/**
 * The blocks of a cell, or of an item in a cell's list, as one line: a list as HTML, a line as its
 * inline content. Two lines side by side join with a break (`<br>` in a cell); a list needs none.
 */
export function writeCellBlocks(state: SerializerState, parent: PMNode): void {
  parent.forEach((block, _, i) => {
    if (isCellList(block)) return writeCellList(state, block)
    if (i > 0 && !isCellList(parent.child(i - 1))) state.addNode('break')
    state.next(block.content)
  })
}

/** A list in a cell as raw `html` nodes around each item's Markdown words (D2). */
export function writeCellList(state: SerializerState, list: PMNode): void {
  const html = (value: string) => state.addNode('html', undefined, value)
  const ordered = list.type.name === 'ordered_list'
  const order = list.attrs.order as number
  html(ordered ? (order === 1 ? '<ol>' : `<ol start="${order}">`) : '<ul>')
  list.forEach((item) => {
    html('<li>')
    const checked = item.attrs.checked as boolean | null
    // Raw, so the text writer does not escape the `[`.
    if (checked !== null) html(checked ? '[x] ' : '[ ] ')
    writeCellBlocks(state, item)
    html('</li>')
  })
  html(ordered ? '</ol>' : '</ul>')
}

const OPEN_LIST = /^<(ul|ol)(?: start="(\d+)")?>$/
const TASK = /^\[( |x|X)\] /

/** The item's first line: made empty when the item starts with a list; a `[ ] ` / `[x] ` there sets `checked` (`[X] ` too, written back `[x] `). */
function closeItem(item: ListItem): void {
  if (item.children[0]?.type !== 'paragraph') item.children.unshift({ type: 'paragraph', children: [] })
  const line = item.children[0] as Paragraph
  const first = line.children[0]
  const task = first?.type === 'text' ? TASK.exec(first.value) : null
  if (first?.type !== 'text' || task === null) return
  item.checked = task[1] !== ' '
  // A new text node: the cell keeps its own children when a later tag does not balance.
  const rest = first.value.slice(task[0].length)
  if (rest === '') line.children.shift()
  else line.children[0] = { ...first, value: rest }
}

/** A cell's children with its HTML lists made mdast lists; `null` when they are not the exact form. */
function readCellLists(children: PhrasingContent[]): RootContent[] | null {
  const out: RootContent[] = []
  const stack: Array<List | ListItem> = []
  for (const node of children) {
    const top = stack.at(-1)
    const tag = node.type === 'html' ? node.value : null
    const open = tag === null ? null : OPEN_LIST.exec(tag)
    if (open !== null) {
      if (top?.type === 'list') return null
      const ordered = open[1] === 'ol'
      const list: List = { type: 'list', ordered, start: ordered ? Number(open[2] ?? 1) : null, spread: false, children: [] }
      ;(top === undefined ? out : top.children).push(list)
      stack.push(list)
    } else if (tag === '<li>') {
      if (top?.type !== 'list') return null
      const item: ListItem = { type: 'listItem', spread: false, checked: null, children: [] }
      // Milkdown's runner reads an ordered item's number from `label`; Milkdown's own step that sets it has already run.
      if (top.ordered) Object.assign(item, { label: (top.start ?? 1) + top.children.length })
      top.children.push(item)
      stack.push(item)
    } else if (tag === '</li>') {
      if (top?.type !== 'listItem') return null
      closeItem(top)
      stack.pop()
    } else if (tag === '</ul>' || tag === '</ol>') {
      if (top?.type !== 'list' || top.ordered !== (tag === '</ol>') || top.children.length === 0) return null
      stack.pop()
    } else if (top === undefined) {
      out.push(node)
    } else {
      if (top.type === 'list' || tag !== null) return null
      const last = top.children.at(-1)
      if (last?.type === 'paragraph') last.children.push(node)
      else top.children.push({ type: 'paragraph', children: [node] })
    }
  }
  return stack.length === 0 ? out : null
}

const hasListTag = (node: PhrasingContent): boolean => node.type === 'html' && OPEN_LIST.test(node.value)

/**
 * After `inlineBreaksRemark` (a `<br>` is a `break` by then): each BODY cell's HTML list becomes an
 * mdast `list`, which `withCellStyle`'s runner passes to Milkdown's list runners.
 */
export const cellListsRemark = $remark('mdapp-cell-lists', () => () => (tree) => {
  visit(tree, 'table', (table: Table) => {
    for (const row of table.children.slice(1)) {
      for (const cell of row.children) {
        if (!cell.children.some(hasListTag)) continue
        const children = readCellLists(cell.children)
        if (children !== null) cell.children = children as PhrasingContent[]
      }
    }
  })
})
