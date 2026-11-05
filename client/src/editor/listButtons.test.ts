/**
 * The toolbar's list buttons (YAZ-3806 T3) and T (YAZ-4369, which replaces T4): one table for the rules, through a
 * REAL editor. Each row selects some lines, runs a button's command, and reads the markdown out. The scenario table is
 * on the working log (YAZ-3807, "Decision and scenario record, final"); the buttons themselves are pressed in
 * `headingToolbar.test.ts`.
 */
import { afterEach, describe, expect, it } from 'vitest'
import type { Crepe } from '@milkdown/crepe'
import { commandsCtx, editorViewCtx } from '@milkdown/kit/core'
import { turnIntoTextCommand, wrapInBulletListCommand, wrapInHeadingCommand } from '@milkdown/kit/preset/commonmark'
import { undo } from '@milkdown/kit/prose/history'
import { endOf, IS_MAC, md, mount, posOf, pressKey, runCommand, select, unmountAll } from './marks/markTestKit'
import { allLinesAre, LIST_KINDS, type ListKind, toggleListKind } from './listButtons'
import { isOutlineItemCollapsed, toggleOutlineFold } from './outline/outlineFolding'
import { getZoomedItemPos, zoomKeyAt, zoomToKey } from './outline/zoom'
import { openCellNote } from './table/cellNoteCard'
import { cellPos } from './table/tableTestKit'

afterEach(unmountAll)

type Button = ListKind | 'text'

/** Run a button's command the way its `onRun` does. T goes through its Milkdown key, as the toolbar and ⌘⌥0 call it. */
const press = (crepe: Crepe, button: Button): boolean =>
  button === 'text'
    ? crepe.editor.action((ctx) => ctx.get(commandsCtx).call(turnIntoTextCommand.key))
    : runCommand(crepe, toggleListKind(button))

/** Which buttons are lit now. */
const lit = (crepe: Crepe): Button[] => {
  const state = crepe.editor.action((ctx) => ctx.get(editorViewCtx).state)
  return (['text', ...LIST_KINDS] as const).filter((button) => allLinesAre(state, button))
}

const foldItem = (crepe: Crepe, text: string) => expect(runCommand(crepe, toggleOutlineFold(posOf(crepe, text) - 2))).toBe(true)

interface Row {
  name: string
  doc: string
  /** The first and last selected text. */
  from: string
  to?: string
  /** What is lit before the press. */
  before: Button[]
  press: Button
  out: string
  /** What is lit after the press, over the same text. */
  after: Button[]
  fold?: string
}

const ROWS: Row[] = [
  { name: 'a plain line, Bullet: a bullet, Bullet lit', doc: 'a\n', from: 'a', before: ['text'], press: 'bulletList', out: '* a\n', after: ['text', 'bulletList'] },
  { name: 'a bullet, the lit Bullet: plain text', doc: '* a\n', from: 'a', before: ['text', 'bulletList'], press: 'bulletList', out: 'a\n', after: ['text'] },
  { name: 'three plain lines, Numbered: one item per line', doc: 'a\n\nb\n\nc\n', from: 'a', to: 'c', before: ['text'], press: 'numberedList', out: '1. a\n2. b\n3. c\n', after: ['text', 'numberedList'] },
  { name: 'a bullet, Checklist: `[ ]`', doc: '* a\n', from: 'a', before: ['text', 'bulletList'], press: 'checklist', out: '* [ ] a\n', after: ['text', 'checklist'] },
  { name: 'a checklist line, the lit Checklist: plain text, not a bullet', doc: '* [x] a\n', from: 'a', before: ['text', 'checklist'], press: 'checklist', out: 'a\n', after: ['text'] },
  { name: 'a heading, Bullet: a heading inside a bullet', doc: '## h\n', from: 'h', before: [], press: 'bulletList', out: '* ## h\n', after: ['bulletList'] },
  { name: 'a heading in a bullet, the lit Bullet: the heading stays a heading', doc: '* ## h\n', from: 'h', before: ['bulletList'], press: 'bulletList', out: '## h\n', after: [] },
  // YAZ-4369: T changes only the line's text type, never the list (it replaces YAZ-3806 T4's "out of a list too").
  { name: 'a heading in a bullet, T: a plain bullet', doc: '* ## h\n', from: 'h', before: ['bulletList'], press: 'text', out: '* h\n', after: ['text', 'bulletList'] },
  { name: 'a heading outside a list, T: plain text', doc: '## h\n', from: 'h', before: [], press: 'text', out: 'h\n', after: ['text'] },
  { name: 'a plain bullet: T is lit and changes nothing', doc: '* a\n', from: 'a', before: ['text', 'bulletList'], press: 'text', out: '* a\n', after: ['text', 'bulletList'] },
  { name: 'a heading in a numbered item, T: the same number, plain', doc: '1. a\n2. ### b\n3. c\n', from: 'b', before: ['numberedList'], press: 'text', out: '1. a\n2. b\n3. c\n', after: ['text', 'numberedList'] },
  {
    name: 'the middle line of a bullet list, Numbered: the list splits',
    doc: '* a\n* b\n* c\n',
    from: 'b',
    before: ['text', 'bulletList'],
    press: 'numberedList',
    out: '* a\n\n1. b\n\n* c\n',
    after: ['text', 'numberedList'],
  },
  {
    name: 'a numbered line after a bullet list, Bullet: it joins the list above',
    doc: '* a\n\n1. b\n',
    from: 'b',
    before: ['text', 'numberedList'],
    press: 'bulletList',
    out: '* a\n* b\n',
    after: ['text', 'bulletList'],
  },
  {
    name: 'a bullet and a plain line: only T lit; Bullet makes both bullets',
    doc: '* a\n\nb\n',
    from: 'a',
    to: 'b',
    before: ['text'],
    press: 'bulletList',
    out: '* a\n* b\n',
    after: ['text', 'bulletList'],
  },
  {
    name: 'a ticked line and a bullet, Checklist: the tick stays',
    doc: '* [x] a\n* b\n',
    from: 'a',
    to: 'b',
    before: ['text'],
    press: 'checklist',
    out: '* [x] a\n* [ ] b\n',
    after: ['text', 'checklist'],
  },
  {
    name: 'a nested bullet, the lit Bullet: out of every level; its children and the siblings after it stay a list below',
    doc: '* A\n  * B\n    * C\n  * D\n',
    from: 'B',
    before: ['text', 'bulletList'],
    press: 'bulletList',
    out: '* A\n\nB\n\n* C\n* D\n',
    after: ['text'],
  },
  {
    name: 'a nested heading bullet, T: plain, at the same level; its children and siblings stay',
    doc: '* A\n  * ## B\n    * C\n  * D\n',
    from: 'B',
    before: ['bulletList'],
    press: 'text',
    out: '* A\n  * B\n    * C\n  * D\n',
    after: ['text', 'bulletList'],
  },
  {
    name: 'a selection over a folded bullet, Numbered: the hidden lines keep their kind',
    doc: '* A\n  * a1\n* B\n',
    fold: 'A',
    from: 'A',
    to: 'B',
    before: ['text', 'bulletList'],
    press: 'numberedList',
    out: '1. A\n   * a1\n2. B\n',
    after: ['text', 'numberedList'],
  },
  {
    name: 'a selection over a folded bullet, the lit Bullet: only the visible lines leave the list',
    doc: '* A\n  * a1\n* B\n',
    fold: 'A',
    from: 'A',
    to: 'B',
    before: ['text', 'bulletList'],
    press: 'bulletList',
    out: 'A\n\n* a1\n\nB\n',
    // A is no bullet now, so its fold is gone: a1 shows, and the selection holds two list kinds.
    after: ['text'],
  },
  {
    name: 'a selection over a folded heading bullet, T: only the visible lines change; the hidden heading stays',
    doc: '* ## A\n  * ## a1\n* ## B\n',
    fold: 'A',
    from: 'A',
    to: 'B',
    before: ['bulletList'],
    press: 'text',
    out: '* A\n  * ## a1\n* B\n',
    // A is still a bullet with its child, so its fold stays: a1 is still hidden.
    after: ['text', 'bulletList'],
  },
]

describe('the list buttons and T (YAZ-3806 T3, YAZ-4369)', () => {
  it.each(ROWS)('$name', async (row) => {
    const { crepe } = await mount(row.doc)
    if (row.fold !== undefined) foldItem(crepe, row.fold)
    const sel = () => select(crepe, posOf(crepe, row.from), endOf(crepe, row.to ?? row.from))
    sel()
    expect(lit(crepe)).toEqual(row.before)
    expect(press(crepe, row.press)).toBe(true)
    expect(md(crepe)).toBe(row.out)
    sel()
    expect(lit(crepe)).toEqual(row.after)
    // One press is one ⌘Z.
    crepe.editor.action((ctx) => {
      const view = ctx.get(editorViewCtx)
      undo(view.state, view.dispatch)
    })
    expect(md(crepe)).toBe(row.doc)
  })

  it('the selection stays on the same text, so the toolbar re-lights over it', async () => {
    const { crepe, view } = await mount('a\n\nb\n')
    select(crepe, posOf(crepe, 'a'), endOf(crepe, 'b'))
    press(crepe, 'bulletList')
    const { from, to } = view.state.selection
    expect(view.state.doc.textBetween(from, to, '|')).toBe('a|b')
  })

  it('⌘⌥8 runs the Bullet button: a bullet per line, and off again', async () => {
    const { crepe } = await mount('a\n\nb\n')
    const bullet = () => crepe.editor.action((ctx) => ctx.get(commandsCtx).call(wrapInBulletListCommand.key))
    select(crepe, posOf(crepe, 'a'), endOf(crepe, 'b'))
    expect(bullet()).toBe(true)
    expect(md(crepe)).toBe('* a\n* b\n')
    select(crepe, posOf(crepe, 'a'), endOf(crepe, 'b'))
    expect(bullet()).toBe(true)
    expect(md(crepe)).toBe('a\n\nb\n')
  })


  it('inside a zoom, a line leaves the lists down to the zoomed bullet only, so it stays in view', async () => {
    const { crepe, view } = await mount('* A\n  * B\n  * C\n')
    const itemPos = posOf(crepe, 'A') - 2
    expect(runCommand(crepe, zoomToKey(zoomKeyAt(view.state.doc, itemPos)))).toBe(true)
    expect(getZoomedItemPos(view.state)).toBe(itemPos)
    select(crepe, posOf(crepe, 'B'), endOf(crepe, 'B'))
    expect(press(crepe, 'bulletList')).toBe(true)
    expect(md(crepe)).toBe('* A\n\n  B\n  * C\n')
    expect(getZoomedItemPos(view.state)).toBe(itemPos)
  })

  it('inside a zoom, the zoomed bullet\'s own line keeps its list: lifting it would end the zoom', async () => {
    const { crepe, view } = await mount('* R\n  * A\n    * B\n')
    const itemPos = posOf(crepe, 'A') - 2
    expect(runCommand(crepe, zoomToKey(zoomKeyAt(view.state.doc, itemPos)))).toBe(true)
    select(crepe, posOf(crepe, 'A'), endOf(crepe, 'B'))
    expect(press(crepe, 'bulletList')).toBe(true)
    expect(md(crepe)).toBe('* R\n  * A\n\n    B\n')
    expect(getZoomedItemPos(view.state)).toBe(itemPos)
  })
})

describe('T changes only the line\'s text type, never the list (YAZ-4369)', () => {
  it('an H3 bullet with children and siblings, T: a plain line in the same item; nothing moves', async () => {
    const doc = '* Before\n* ### Production steps\n  * Candidate review\n  * Edit\n  * Layout\n* After\n'
    const { crepe } = await mount(doc)
    select(crepe, posOf(crepe, 'Production') + 1)
    expect(lit(crepe)).toEqual(['bulletList'])
    expect(press(crepe, 'text')).toBe(true)
    expect(md(crepe)).toBe('* Before\n* Production steps\n  * Candidate review\n  * Edit\n  * Layout\n* After\n')
    expect(lit(crepe)).toEqual(['text', 'bulletList'])
    crepe.editor.action((ctx) => {
      const view = ctx.get(editorViewCtx)
      undo(view.state, view.dispatch)
    })
    expect(md(crepe)).toBe(doc)
  })

  it('a heading in a checklist item, T: a plain line; the item keeps its tick', async () => {
    const { crepe, view } = await mount('* [x] a\n* [ ] b\n')
    select(crepe, posOf(crepe, 'b') + 1)
    expect(crepe.editor.action((ctx) => ctx.get(commandsCtx).call(wrapInHeadingCommand.key, 3))).toBe(true)
    expect(view.state.doc.child(0).child(1).firstChild!.type.name).toBe('heading')
    select(crepe, posOf(crepe, 'a'), endOf(crepe, 'b'))
    expect(lit(crepe)).toEqual(['checklist'])
    expect(press(crepe, 'text')).toBe(true)
    expect(md(crepe)).toBe('* [x] a\n* [ ] b\n')
    expect(lit(crepe)).toEqual(['text', 'checklist'])
  })

  it('⌘⌥0 (the real key) does the same as T: the heading bullet stays a bullet', async () => {
    const { crepe, view } = await mount('* a\n* ### b\n  * kid\n')
    select(crepe, posOf(crepe, 'b') + 1)
    const event = new KeyboardEvent('keydown', { key: '0', altKey: true, ...(IS_MAC ? { metaKey: true } : { ctrlKey: true }), bubbles: true, cancelable: true })
    expect(view.someProp('handleKeyDown', (handler) => handler(view, event))).toBe(true)
    expect(md(crepe)).toBe('* a\n* b\n  * kid\n')
  })

  it('a selection over several lines, headings in bullets and outside: each a paragraph where it is, one ⌘Z', async () => {
    const doc = '# Title\n\n* ## one\n  * kid\n* two\n\n  ### more\n\n### Three\n\n1. ### four\n'
    const { crepe, view } = await mount(doc)
    select(crepe, posOf(crepe, 'Title'), endOf(crepe, 'four'))
    expect(lit(crepe)).toEqual([])
    expect(press(crepe, 'text')).toBe(true)
    // The bullet's later heading ("more") stays its later block, as a paragraph: T makes no item of it.
    expect(md(crepe)).toBe('Title\n\n* one\n  * kid\n* two\n\n  more\n\nThree\n\n1. four\n')
    // The selection keeps the same text, so the toolbar re-lights over it.
    expect(view.state.doc.textBetween(view.state.selection.from, view.state.selection.to, '|')).toBe('Title|one|kid|two|more|Three|four')
    expect(lit(crepe)).toEqual(['text'])
    undo(view.state, view.dispatch)
    expect(md(crepe)).toBe(doc)
  })

  it('a folded heading bullet, T: its children stay folded below it', async () => {
    const { crepe, view } = await mount('* ### A\n  * a1\n  * a2\n* B\n')
    const itemPos = posOf(crepe, 'A') - 2
    foldItem(crepe, 'A')
    expect(isOutlineItemCollapsed(view.state, itemPos)).toBe(true)
    select(crepe, posOf(crepe, 'A') + 1)
    expect(press(crepe, 'text')).toBe(true)
    expect(md(crepe)).toBe('* A\n  * a1\n  * a2\n* B\n')
    expect(posOf(crepe, 'A') - 2).toBe(itemPos)
    expect(isOutlineItemCollapsed(view.state, itemPos)).toBe(true)
  })

  it('inside a zoom, T: the zoomed bullet\'s own line and its children become plain; the zoom stays; hidden lines keep their heading', async () => {
    const { crepe, view } = await mount('* ## X\n* R\n  * ## A\n    * ## B\n    * C\n* ## Y\n')
    const itemPos = posOf(crepe, 'A') - 2
    expect(runCommand(crepe, zoomToKey(zoomKeyAt(view.state.doc, itemPos)))).toBe(true)
    // Over the whole note: X and Y are outside the zoom, so hidden.
    select(crepe, posOf(crepe, 'X'), endOf(crepe, 'Y'))
    expect(press(crepe, 'text')).toBe(true)
    expect(md(crepe)).toBe('* ## X\n* R\n  * A\n    * B\n    * C\n* ## Y\n')
    expect(getZoomedItemPos(view.state)).toBe(itemPos)
  })
})

describe('a plain line of a body cell and of a cell note card (YAZ-3818 D1, 5A-14)', () => {
  it.each([
    ['bulletList', '<ul><li>a</li></ul>', '[^cell-1]: * a'],
    ['numberedList', '<ol><li>a</li></ol>', '[^cell-1]: 1. a'],
    ['checklist', '<ul><li>[ ] a</li></ul>', '[^cell-1]: * [ ] a'],
  ] as const)('%s makes the list; a header cell holds one line (D7)', async (button, cell, note) => {
    const inCell = await mount('| h |\n| - |\n| a |\n')
    select(inCell.crepe, posOf(inCell.crepe, 'a'), endOf(inCell.crepe, 'a'))
    expect(lit(inCell.crepe)).toEqual(['text'])
    expect(press(inCell.crepe, button)).toBe(true)
    expect(md(inCell.crepe)).toContain(`| ${cell} |`)
    select(inCell.crepe, posOf(inCell.crepe, 'a'), endOf(inCell.crepe, 'a'))
    // Its line is still a paragraph, so T stays lit beside the list button (YAZ-4369).
    expect(lit(inCell.crepe)).toEqual(['text', button])
    select(inCell.crepe, posOf(inCell.crepe, 'h'), endOf(inCell.crepe, 'h'))
    expect(press(inCell.crepe, button)).toBe(false)

    const onPage = await mount('| h |\n| - |\n| b[^cell-1] |\n\n[^cell-1]: a\n')
    // The card (the YAZ-3818 demo): a click on the mark's corner opens it.
    expect(onPage.crepe.editor.action((ctx) => openCellNote(ctx.get(editorViewCtx), cellPos(ctx.get(editorViewCtx), 1, 0)))).toBe(true)
    select(onPage.crepe, posOf(onPage.crepe, 'a'), endOf(onPage.crepe, 'a'))
    expect(lit(onPage.crepe)).toEqual(['text'])
    expect(press(onPage.crepe, button)).toBe(true)
    expect(md(onPage.crepe)).toContain(note)
  })
})

describe('checker round 1 (PR #220)', () => {
  it.each(['checklist', 'numberedList'] as const)('4A: inside a zoom, %s on the zoomed bullet\'s own line keeps the zoom', async (kind) => {
    const { crepe, view } = await mount('* R\n  * X\n  * A\n    * B\n  * Y\n')
    expect(runCommand(crepe, zoomToKey(zoomKeyAt(view.state.doc, posOf(crepe, 'A') - 2)))).toBe(true)
    select(crepe, posOf(crepe, 'A'), endOf(crepe, 'A'))
    expect(press(crepe, kind)).toBe(true)
    expect(getZoomedItemPos(view.state)).toBe(posOf(crepe, 'A') - 2)
  })

  it('4A: ⌘Enter (a task tick) on the zoomed bullet\'s own line keeps the zoom — the same cause, in `zoom.ts`', async () => {
    const { crepe, view } = await mount('* R\n  * A\n    * B\n')
    const itemPos = posOf(crepe, 'A') - 2
    expect(runCommand(crepe, zoomToKey(zoomKeyAt(view.state.doc, itemPos)))).toBe(true)
    select(crepe, posOf(crepe, 'A') + 1)
    expect(pressKey(crepe, 'Enter', { mod: true })).toBe(true)
    expect(md(crepe)).toBe('* R\n  * [ ] A\n    * B\n')
    expect(getZoomedItemPos(view.state)).toBe(itemPos)
  })

  it.each([
    ['1. a\n2. b\n3. c\n', 'b', '1. a\n\n* b\n\n3. c\n'],
    ['3. a\n4. b\n5. c\n', 'b', '3. a\n\n* b\n\n5. c\n'],
    ['3. a\n4. b\n', 'a', '* a\n\n4. b\n'],
  ])('4B: %j, Bullet on %s: the numbered lines after it keep their numbers', async (doc, line, out) => {
    const { crepe } = await mount(doc)
    select(crepe, posOf(crepe, line), endOf(crepe, line))
    expect(press(crepe, 'bulletList')).toBe(true)
    expect(md(crepe)).toBe(out)
  })

  it('4C, under YAZ-4369: a bullet\'s second paragraph is a paragraph, so T is lit and changes nothing', async () => {
    const { crepe } = await mount('* a\n\n  cont\n')
    select(crepe, posOf(crepe, 'cont'), endOf(crepe, 'cont'))
    expect(allLinesAre(crepe.editor.action((ctx) => ctx.get(editorViewCtx).state), 'text')).toBe(true)
    expect(press(crepe, 'text')).toBe(true)
    expect(md(crepe)).toBe('* a\n\n  cont\n')
  })
})

describe('checker round 2 (PR #220)', () => {
  it.each([
    ['1. a\n2. b\n3. c\n', 'b', 'numberedList', '1. a\n\nb\n\n3. c\n'],
    ['1. a\n2. b\n3. c\n', 'a', 'numberedList', 'a\n\n2. b\n3. c\n'],
  ] as const)('4F: %j, the lit button on %s: the numbered lines after it keep their numbers', async (doc, line, button, out) => {
    const { crepe } = await mount(doc)
    select(crepe, posOf(crepe, line), endOf(crepe, line))
    expect(press(crepe, button)).toBe(true)
    expect(md(crepe)).toBe(out)
  })

  it.each([
    ['* [x] a\n\n  cont\n', 'checklist', '* [x] a\n* [ ] cont\n'],
    ['1. a\n\n   cont\n2. b\n', 'bulletList', '1. a\n\n* cont\n\n2. b\n'],
  ] as const)('4G: %j, %s on a bullet\'s second paragraph: a new line, and the numbers below stay', async (doc, button, out) => {
    const { crepe } = await mount(doc)
    select(crepe, posOf(crepe, 'cont'), endOf(crepe, 'cont'))
    expect(press(crepe, button)).toBe(true)
    expect(md(crepe)).toBe(out)
  })
})
