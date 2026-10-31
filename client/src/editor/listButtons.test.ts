/**
 * The toolbar's list buttons and T (YAZ-3806 T3, T4): one table for the rule, through a REAL editor. Each row
 * selects some lines, runs a button's command, and reads the markdown out. The scenario table is on the working log
 * (YAZ-3807, "Decision and scenario record, final"); the buttons themselves are pressed in `headingToolbar.test.ts`.
 */
import { afterEach, describe, expect, it } from 'vitest'
import type { Crepe } from '@milkdown/crepe'
import { commandsCtx, editorViewCtx } from '@milkdown/kit/core'
import { turnIntoTextCommand, wrapInBulletListCommand } from '@milkdown/kit/preset/commonmark'
import { undo } from '@milkdown/kit/prose/history'
import { endOf, md, mount, posOf, pressKey, runCommand, select, unmountAll } from './marks/markTestKit'
import { allLinesAre, LIST_KINDS, type ListKind, toggleListKind } from './listButtons'
import { toggleOutlineFold } from './outline/outlineFolding'
import { getZoomedItemPos, zoomKeyAt, zoomToKey } from './outline/zoom'

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
  { name: 'a plain line, Bullet: a bullet, Bullet lit', doc: 'a\n', from: 'a', before: ['text'], press: 'bulletList', out: '* a\n', after: ['bulletList'] },
  { name: 'a bullet, the lit Bullet: plain text', doc: '* a\n', from: 'a', before: ['bulletList'], press: 'bulletList', out: 'a\n', after: ['text'] },
  { name: 'three plain lines, Numbered: one item per line', doc: 'a\n\nb\n\nc\n', from: 'a', to: 'c', before: ['text'], press: 'numberedList', out: '1. a\n2. b\n3. c\n', after: ['numberedList'] },
  { name: 'a bullet, Checklist: `[ ]`', doc: '* a\n', from: 'a', before: ['bulletList'], press: 'checklist', out: '* [ ] a\n', after: ['checklist'] },
  { name: 'a checklist line, the lit Checklist: plain text, not a bullet', doc: '* [x] a\n', from: 'a', before: ['checklist'], press: 'checklist', out: 'a\n', after: ['text'] },
  { name: 'a heading, Bullet: a heading inside a bullet', doc: '## h\n', from: 'h', before: [], press: 'bulletList', out: '* ## h\n', after: ['bulletList'] },
  { name: 'a heading in a bullet, the lit Bullet: the heading stays a heading', doc: '* ## h\n', from: 'h', before: ['bulletList'], press: 'bulletList', out: '## h\n', after: [] },
  { name: 'a heading in a bullet, T: plain text', doc: '* ## h\n', from: 'h', before: ['bulletList'], press: 'text', out: 'h\n', after: ['text'] },
  {
    name: 'the middle line of a bullet list, Numbered: the list splits',
    doc: '* a\n* b\n* c\n',
    from: 'b',
    before: ['bulletList'],
    press: 'numberedList',
    out: '* a\n\n1. b\n\n* c\n',
    after: ['numberedList'],
  },
  {
    name: 'a numbered line after a bullet list, Bullet: it joins the list above',
    doc: '* a\n\n1. b\n',
    from: 'b',
    before: ['numberedList'],
    press: 'bulletList',
    out: '* a\n* b\n',
    after: ['bulletList'],
  },
  {
    name: 'a bullet and a plain line: nothing lit; Bullet makes both bullets',
    doc: '* a\n\nb\n',
    from: 'a',
    to: 'b',
    before: [],
    press: 'bulletList',
    out: '* a\n* b\n',
    after: ['bulletList'],
  },
  {
    name: 'a ticked line and a bullet, Checklist: the tick stays',
    doc: '* [x] a\n* b\n',
    from: 'a',
    to: 'b',
    before: [],
    press: 'checklist',
    out: '* [x] a\n* [ ] b\n',
    after: ['checklist'],
  },
  {
    name: 'a nested bullet, T: out of every level; its children and the siblings after it stay a list below',
    doc: '* A\n  * B\n    * C\n  * D\n',
    from: 'B',
    before: ['bulletList'],
    press: 'text',
    out: '* A\n\nB\n\n* C\n* D\n',
    after: ['text'],
  },
  {
    name: 'a nested bullet, the lit Bullet: the same as T',
    doc: '* A\n  * B\n    * C\n  * D\n',
    from: 'B',
    before: ['bulletList'],
    press: 'bulletList',
    out: '* A\n\nB\n\n* C\n* D\n',
    after: ['text'],
  },
  {
    name: 'a selection over a folded bullet, Numbered: the hidden lines keep their kind',
    doc: '* A\n  * a1\n* B\n',
    fold: 'A',
    from: 'A',
    to: 'B',
    before: ['bulletList'],
    press: 'numberedList',
    out: '1. A\n   * a1\n2. B\n',
    after: ['numberedList'],
  },
  {
    name: 'a selection over a folded bullet, the lit Bullet: only the visible lines leave the list',
    doc: '* A\n  * a1\n* B\n',
    fold: 'A',
    from: 'A',
    to: 'B',
    before: ['bulletList'],
    press: 'bulletList',
    out: 'A\n\n* a1\n\nB\n',
    // A is no bullet now, so its fold is gone: a1 shows, and the selection holds two kinds.
    after: [],
  },
]

describe('the list buttons and T (YAZ-3806 T3, T4)', () => {
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

  it('⌘⌥0 on a bullet: plain text', async () => {
    const { crepe } = await mount('* a\n')
    select(crepe, posOf(crepe, 'a') + 1)
    expect(press(crepe, 'text')).toBe(true)
    expect(md(crepe)).toBe('a\n')
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

  it('4C: a bullet\'s second paragraph: T does not light, or T makes it a plain line outside the list', async () => {
    const { crepe } = await mount('* a\n\n  cont\n')
    select(crepe, posOf(crepe, 'cont'), endOf(crepe, 'cont'))
    const lit = allLinesAre(crepe.editor.action((ctx) => ctx.get(editorViewCtx).state), 'text')
    press(crepe, 'text')
    expect(lit === false || md(crepe) !== '* a\n\n  cont\n').toBe(true)
  })
})
