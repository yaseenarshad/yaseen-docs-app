/**
 * ⌘A on a bullet (YAZ-4348 demo round 2, `bulletSelectAll.ts`), through a REAL Crepe: the first ⌘A selects the
 * bullet's own line, the second the whole note; off a bullet, ⌘A is the whole note at once.
 */
import { afterEach, describe, expect, it } from 'vitest'
import type { Crepe } from '@milkdown/crepe'
import { editorViewCtx } from '@milkdown/kit/core'
import { TextSelection } from '@milkdown/kit/prose/state'
import type { EditorView } from '@milkdown/kit/prose/view'
import { createCrepe, type CreateCrepeOptions } from './createCrepe'
import { openCellNote } from './table/cellNoteCard'
import { cellPos } from './table/tableTestKit'

const mounted: Array<{ crepe: Crepe; root: HTMLElement }> = []

async function mount(markdown: string, options: Omit<CreateCrepeOptions, 'root' | 'defaultValue'> = {}) {
  const root = document.createElement('div')
  document.body.appendChild(root)
  const crepe = createCrepe({ root, defaultValue: markdown, ...options })
  await crepe.create()
  mounted.push({ crepe, root })
  const view = crepe.editor.action((ctx) => ctx.get(editorViewCtx))
  view.focus()
  return view
}

/** ⌘A as ProseMirror's keymap reads it here ("Mod" is ⌘ on a Mac, Ctrl elsewhere). */
function selectAll(view: EditorView): void {
  const mac = /Mac|iP(hone|[oa]d)/.test(navigator.platform)
  const event = new KeyboardEvent('keydown', { key: 'a', code: 'KeyA', keyCode: 65, metaKey: mac, ctrlKey: !mac, bubbles: true, cancelable: true })
  const handled = view.someProp('handleKeyDown', (handler) => handler(view, event)) ?? false
  // The page's own select all, as the browser's ⌘A does when no keymap takes it.
  if (!handled) view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, 0, view.state.doc.content.size)).scrollIntoView())
}

/** The caret inside the first match of `text`. */
function caretIn(view: EditorView, text: string): void {
  let at = -1
  view.state.doc.descendants((node, pos) => {
    if (at === -1 && node.isText && node.text!.includes(text)) at = pos + node.text!.indexOf(text) + 1
  })
  view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, at)))
}

const selected = (view: EditorView): string => view.state.doc.textBetween(view.state.selection.from, view.state.selection.to, '\n')
const wholeNote = (view: EditorView): boolean => view.state.selection.from <= 1 && view.state.selection.to === view.state.doc.content.size

afterEach(async () => {
  for (const m of mounted.splice(0)) {
    await m.crepe.destroy()
    m.root.remove()
  }
})

describe('⌘A on a bullet (YAZ-4348 demo round 2)', () => {
  it('selects the bullet’s own line first, then the whole note', async () => {
    const view = await mount('Intro line\n\n- First bullet\n  - Nested one\n- Second bullet\n')
    caretIn(view, 'First')
    selectAll(view)
    expect(selected(view)).toBe('First bullet')
    selectAll(view)
    expect(view.state.selection.from).toBeLessThanOrEqual(1)
    expect(view.state.selection.to).toBe(view.state.doc.content.size)
  })

  it('works on a numbered item and a task too', async () => {
    const view = await mount('1. Numbered item\n\n- [ ] A task item\n')
    caretIn(view, 'Numbered')
    selectAll(view)
    expect(selected(view)).toBe('Numbered item')
    caretIn(view, 'task')
    selectAll(view)
    expect(selected(view)).toBe('A task item')
  })

  it('off a bullet, ⌘A is the whole note at once', async () => {
    const view = await mount('A plain paragraph\n\n- A bullet\n')
    caretIn(view, 'plain')
    selectAll(view)
    expect(view.state.selection.to).toBe(view.state.doc.content.size)
  })

  it('an empty bullet has nothing to select: ⌘A is the whole note at once', async () => {
    const view = await mount('Intro line\n\n- First bullet\n-\n- Third bullet\n')
    let empty = -1
    view.state.doc.descendants((node, pos) => {
      if (empty === -1 && node.type.name === 'list_item' && node.textContent === '') empty = pos + 2
    })
    view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, empty)))
    expect(view.state.selection.$from.parent.content.size).toBe(0)
    selectAll(view)
    expect(wholeNote(view)).toBe(true)
  })

  it('a selection across two bullets is not one line: ⌘A is the whole note at once', async () => {
    const view = await mount('Intro line\n\n- First bullet\n- Second bullet\n')
    let first = -1
    let second = -1
    view.state.doc.descendants((node, pos) => {
      if (node.isText && node.text === 'First bullet') first = pos + 2
      if (node.isText && node.text === 'Second bullet') second = pos + 3
    })
    view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, first, second)))
    selectAll(view)
    expect(wholeNote(view)).toBe(true)
  })

  it('a bullet in a table cell keeps the cell’s ⌘A (priority 90 over 80): the cell first, then the note', async () => {
    const view = await mount('| Day | Plan |\n| --- | --- |\n| Tuesday | <ul><li>Museum</li><li>Park</li></ul> |\n')
    caretIn(view, 'Park')
    expect(view.state.selection.$from.node(-1).type.name).toBe('list_item')
    selectAll(view)
    expect(view.state.doc.textBetween(view.state.selection.from, view.state.selection.to, '|')).toBe('Museum|Park')
    selectAll(view)
    expect(wholeNote(view)).toBe(true)
  })

  it('a bullet in an open cell note keeps the card’s ⌘A: the whole cell note, not the bullet', async () => {
    const note = ['| Day | Plan |', '| --- | --- |', '| Monday | Flights[^cell-1] |', '', '[^cell-1]: Book the window seat.', '', '    * bullet a', '    * bullet b', ''].join('\n')
    const view = await mount(note, { zoom: { title: () => 'Notes', onZoom: () => {} } })
    openCellNote(view, cellPos(view, 1, 1))
    caretIn(view, 'bullet a')
    expect(view.state.selection.$from.node(-1).type.name).toBe('list_item')
    selectAll(view)
    expect(view.state.doc.textBetween(view.state.selection.from, view.state.selection.to, '|')).toBe('Book the window seat.|bullet a|bullet b')
  })
})
