/**
 * "Add line above / below" beside a code block or a table (YAZ-4800 demo: "how do i add a bullet below or above?"),
 * through the real createCrepe wiring. One command (`addLineBesideCommand`) for the 6-dot menu rows and the keys:
 * - on a bullet / numbered line / checklist line whose first block is the code block or table: a new sibling item of
 *   the same list, above or below (a checklist line's new item unchecked);
 * - with no bullet: a plain empty paragraph directly above or below;
 * - the caret goes into the new line; one transaction, so one ⌘Z removes it.
 * ⌘↵ / ⌘⇧↵ in a table cell add the line below / above (`addLineKeymap`); outside a table they do not.
 */
import { afterEach, describe, expect, it } from 'vitest'
import type { Crepe } from '@milkdown/crepe'
import { editorViewCtx } from '@milkdown/kit/core'
import { undo } from '@milkdown/kit/prose/history'
import { TextSelection } from '@milkdown/kit/prose/state'
import type { EditorView } from '@milkdown/kit/prose/view'
import { createCrepe, getMarkdownForSave } from '../createCrepe'
import { addLineBeside, addLineBesideCommand, tableAtSelection } from './addLineBeside'

const mounted: Array<{ crepe: Crepe; root: HTMLElement }> = []

async function mount(markdown: string): Promise<{ crepe: Crepe; view: EditorView }> {
  const root = document.createElement('div')
  document.body.appendChild(root)
  const crepe = createCrepe({ root, defaultValue: markdown })
  await crepe.create()
  mounted.push({ crepe, root })
  const view = crepe.editor.ctx.get(editorViewCtx)
  return { crepe, view }
}

afterEach(async () => {
  for (const m of mounted.splice(0)) {
    await m.crepe.destroy()
    m.root.remove()
  }
})

/** The position of the first node named `name` (a `code_block`, a `table`). */
function blockPos(view: EditorView, name: string): number {
  let found = -1
  view.state.doc.descendants((node, pos) => {
    if (found !== -1) return false
    if (node.type.name === name) found = pos
    return true
  })
  if (found === -1) throw new Error(`no ${name}`)
  return found
}

/** The caret's block: its type, and its list item's parent list (or null). */
function caret(view: EditorView): { block: string; text: string; list: string | null; checked: unknown } {
  const { $from } = view.state.selection
  let list: string | null = null
  let checked: unknown
  for (let d = $from.depth; d > 0; d--) {
    if ($from.node(d).type.name === 'list_item') {
      checked = $from.node(d).attrs.checked
      list = $from.node(d - 1).type.name
      break
    }
  }
  return { block: $from.parent.type.name, text: $from.parent.textContent, list, checked }
}

/** ⌘↵ / ⌘⇧↵ through the editor's keymaps. */
function modEnter(view: EditorView, shift = false): void {
  const event = new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', keyCode: 13, metaKey: true, shiftKey: shift, bubbles: true, cancelable: true })
  view.someProp('handleKeyDown', (handler) => handler(view, event))
}

/** The caret into the text `text`. */
function caretIn(view: EditorView, text: string): void {
  let pos = -1
  view.state.doc.descendants((node, p) => {
    if (pos === -1 && node.isText && node.text!.includes(text)) pos = p + node.text!.indexOf(text) + 1
    return pos === -1
  })
  view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, pos)))
}

const CODE_ON_BULLET = '* a\n* ```\n  code\n  ```\n* c\n'
const TABLE = '| H1 | H2 |\n| --- | --- |\n| x | y |\n'

describe('YAZ-4800 demo: a code block or table on a list line gets a sibling line of the same kind', () => {
  it('YAZ-4800 demo: below a code block on a bullet: a new bullet after it, the caret in it', async () => {
    const { view } = await mount(CODE_ON_BULLET)
    expect(addLineBeside(view, blockPos(view, 'code_block'), 'below')).toBe(true)
    expect(caret(view)).toMatchObject({ block: 'paragraph', text: '', list: 'bullet_list' })
    const items = view.state.doc.firstChild!
    expect(items.type.name).toBe('bullet_list')
    expect(items.childCount).toBe(4)
    expect(items.child(2).textContent).toBe('')
    expect(items.child(3).textContent).toBe('c')
  })

  it('YAZ-4800 demo: above a code block on a bullet: a new bullet before it', async () => {
    const { view } = await mount(CODE_ON_BULLET)
    expect(addLineBeside(view, blockPos(view, 'code_block'), 'above')).toBe(true)
    const items = view.state.doc.firstChild!
    expect(items.childCount).toBe(4)
    expect(items.child(0).textContent).toBe('a')
    expect(items.child(1).textContent).toBe('')
    expect(items.child(2).firstChild!.type.name).toBe('code_block')
    expect(caret(view)).toMatchObject({ block: 'paragraph', text: '', list: 'bullet_list' })
  })

  it('YAZ-4800 demo: on a numbered line the new line is numbered, and the numbers follow', async () => {
    const { crepe, view } = await mount('1. one\n2. ```\n   code\n   ```\n')
    addLineBeside(view, blockPos(view, 'code_block'), 'below')
    expect(caret(view).list).toBe('ordered_list')
    view.dispatch(view.state.tr.insertText('below code'))
    expect(getMarkdownForSave(crepe)).toMatch(/3\. below code/)
  })

  it('YAZ-4800 demo: on a ticked checklist line the new line is a checklist line, unticked', async () => {
    // Markdown has no ticked line that starts with a fence: the ticked line's text is turned into a code block here.
    const { view } = await mount('* [x] a\n* b\n')
    const schema = view.state.schema
    const item = view.state.doc.firstChild!.firstChild!
    expect(item.attrs.checked).toBe(true)
    view.dispatch(view.state.tr.replaceWith(2, 2 + item.firstChild!.nodeSize, schema.nodes.code_block.create(null, schema.text('code'))))
    addLineBeside(view, blockPos(view, 'code_block'), 'below')
    expect(caret(view)).toMatchObject({ list: 'bullet_list', checked: false })
    expect(view.state.doc.firstChild!.child(0).attrs.checked).toBe(true)
  })

  it('YAZ-4800 demo: a plain bullet line stays a plain bullet (checked stays null)', async () => {
    const { view } = await mount(CODE_ON_BULLET)
    addLineBeside(view, blockPos(view, 'code_block'), 'below')
    expect(caret(view).checked).toBeNull()
  })

  it('YAZ-4800 demo: a table on a bullet: above it, a bullet', async () => {
    const { crepe, view } = await mount(`* ${TABLE.split('\n').join('\n  ')}\n`)
    const table = blockPos(view, 'table')
    expect(view.state.doc.resolve(table).parent.type.name).toBe('list_item')
    addLineBeside(view, table, 'above')
    view.dispatch(view.state.tr.insertText('above table'))
    expect(getMarkdownForSave(crepe)).toMatch(/^\* above table\n/)
  })
})

describe('YAZ-4800 demo: with no list, a plain line', () => {
  it('YAZ-4800 demo: below a plain table: an empty paragraph right after it, the caret in it', async () => {
    const { crepe, view } = await mount(`${TABLE}\nafter\n`)
    addLineBeside(view, blockPos(view, 'table'), 'below')
    expect(caret(view)).toMatchObject({ block: 'paragraph', text: '', list: null })
    view.dispatch(view.state.tr.insertText('plain below table'))
    const md = getMarkdownForSave(crepe)
    expect(md.indexOf('plain below table')).toBeGreaterThan(md.indexOf('| x'))
    expect(md.indexOf('plain below table')).toBeLessThan(md.indexOf('after'))
    expect(md).not.toMatch(/^\* plain/m)
  })

  it('YAZ-4800 demo: above a plain code block: an empty paragraph right before it', async () => {
    const { view } = await mount('```\ncode\n```\n')
    addLineBeside(view, blockPos(view, 'code_block'), 'above')
    expect(view.state.doc.child(0).type.name).toBe('paragraph')
    expect(view.state.doc.child(0).textContent).toBe('')
    expect(view.state.doc.child(1).type.name).toBe('code_block')
    expect(caret(view)).toMatchObject({ block: 'paragraph', list: null })
  })
})

describe('YAZ-4800 demo: one transaction, one undo', () => {
  it('YAZ-4800 demo: one dispatch adds the line, and one ⌘Z removes it', async () => {
    const { crepe, view } = await mount(CODE_ON_BULLET)
    const before = getMarkdownForSave(crepe)
    let dispatches = 0
    const ok = addLineBesideCommand(blockPos(view, 'code_block'), 'below')(view.state, (tr) => {
      dispatches++
      view.dispatch(tr)
    })
    expect(ok).toBe(true)
    expect(dispatches).toBe(1)
    expect(view.state.doc.firstChild!.childCount).toBe(4)
    undo(view.state, view.dispatch)
    expect(getMarkdownForSave(crepe)).toBe(before)
  })

  it('YAZ-4800 demo: a dry run (no dispatch) answers whether it can, and changes nothing', async () => {
    const { view } = await mount(CODE_ON_BULLET)
    const doc = view.state.doc
    expect(addLineBesideCommand(blockPos(view, 'code_block'), 'below')(view.state)).toBe(true)
    expect(view.state.doc).toBe(doc)
  })

  it('YAZ-4800 demo: a read-only editor adds nothing', async () => {
    const { view } = await mount(CODE_ON_BULLET)
    view.setProps({ editable: () => false })
    expect(addLineBeside(view, blockPos(view, 'code_block'), 'below')).toBe(false)
    expect(view.state.doc.firstChild!.childCount).toBe(3)
  })
})

describe('YAZ-4800 demo: ⌘↵ / ⌘⇧↵ in a table', () => {
  it('YAZ-4800 demo: tableAtSelection finds the table around a caret in a cell, and none outside', async () => {
    const { view } = await mount(`before\n\n${TABLE}`)
    caretIn(view, 'x')
    expect(tableAtSelection(view.state)).toBe(blockPos(view, 'table'))
    caretIn(view, 'before')
    expect(tableAtSelection(view.state)).toBeNull()
  })

  it('YAZ-4800 demo: ⌘↵ in a cell adds a plain line below the table, the caret in it', async () => {
    const { view } = await mount(`${TABLE}\nafter\n`)
    caretIn(view, 'x')
    modEnter(view)
    const t = view.state.doc.child(0)
    expect(t.type.name).toBe('table')
    expect(view.state.doc.child(1).type.name).toBe('paragraph')
    expect(view.state.doc.child(1).textContent).toBe('')
    expect(caret(view)).toMatchObject({ block: 'paragraph', text: '', list: null })
  })

  it('YAZ-4800 demo: ⌘⇧↵ in a cell of a table on a bullet adds a bullet above', async () => {
    const { view } = await mount(`* ${TABLE.split('\n').join('\n  ')}\n`)
    caretIn(view, 'y')
    modEnter(view, true)
    const list = view.state.doc.firstChild!
    expect(list.type.name).toBe('bullet_list')
    expect(list.childCount).toBe(2)
    expect(list.child(0).textContent).toBe('')
    expect(list.child(1).firstChild!.type.name).toBe('table')
    expect(caret(view)).toMatchObject({ block: 'paragraph', list: 'bullet_list' })
  })

  it('YAZ-4800 demo: ⌘↵ outside a table adds no line beside the table', async () => {
    const { view } = await mount(`before\n\n${TABLE}\nafter\n`)
    caretIn(view, 'before')
    const tableAt = blockPos(view, 'table')
    modEnter(view)
    // Whatever ⌘↵ does on a plain line, the table keeps no new empty line right before or after it.
    const pos = blockPos(view, 'table')
    const $t = view.state.doc.resolve(pos)
    const prev = $t.index() > 0 ? $t.parent.child($t.index() - 1) : null
    const next = $t.index() + 1 < $t.parent.childCount ? $t.parent.child($t.index() + 1) : null
    expect(prev?.textContent).toBe('before')
    expect(next?.textContent).toBe('after')
    expect(pos).toBeGreaterThanOrEqual(tableAt)
  })
})
