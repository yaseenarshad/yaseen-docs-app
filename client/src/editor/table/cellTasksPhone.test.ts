/**
 * YAZ-5618: the phone ticks a task in a table cell (`mobile/src/page/cellTasks.ts`, `mobile/src/comments/taskWrite.ts`)
 * by ONE byte of the row. Pinned here with REAL Mac editors (`createCrepe`): the phone's file is the file the Mac writes
 * for the same tick, byte for byte; the Mac reads the phone's tick as a checked to-do and saves it with no byte changed;
 * an untick of `[X]` reads unchecked. Made-up text only.
 */
import { afterEach, describe, expect, it } from 'vitest'
import type { Node as ProseNode } from '@milkdown/kit/prose/model'
import type { EditorView } from '@milkdown/kit/prose/view'
import { applyTask, taskLines, tickOf } from '../../../../mobile/src/comments/taskWrite'
import { getMarkdownForSave } from '../createCrepe'
import { mount, unmountAll } from '../marks/markTestKit'

afterEach(unmountAll)

const CELL = '<ul><li>**==Plans==**<ul><li>[ ] 1- Look back (1hr)</li><li>[ ] 3- Reset (30min)<ul><li>[ ] Laundry</li><li>[x] Pills</li><li>[ ] Trash</li></ul></li></ul></li></ul>'
const NOTE = `# Week\n\n| Day | Plan |\n| --- | ---- |\n| Sun | ${CELL} |\n| Mon | <ul><li>[ ] Laundry</li></ul> |\n`

/** The Mac's own bytes for `markdown` (load, save). */
async function macSave(markdown: string): Promise<string> {
  const { crepe } = await mount(markdown)
  return getMarkdownForSave(crepe)
}

/** Each to-do of the doc's tables, in order: its words and `checked`. */
function todos(view: EditorView): Array<[string, boolean]> {
  const out: Array<[string, boolean]> = []
  view.state.doc.descendants((node: ProseNode) => {
    if (node.type.name === 'list_item' && node.attrs.checked !== null) out.push([node.firstChild!.textContent, node.attrs.checked as boolean])
  })
  return out
}

/** The phone's tick of the cell task with `words` (the `nth` with that core), to `checked`. */
function phoneTick(markdown: string, words: string, checked: boolean, nth = 0): string {
  const core = taskLines(markdown).find((t) => t.core.startsWith('|') && t.core.endsWith(`|[ ] ${words}`))!.core
  const out = applyTask(markdown, tickOf(markdown, core, nth, checked))
  if (out.kind !== 'ticked') throw new Error(`not ticked: ${JSON.stringify(out)}`)
  return out.content
}

describe("the phone's tick of a cell task is the Mac's, byte for byte", () => {
  it('the Mac reads every to-do the phone draws, in the same order and state', async () => {
    const file = await macSave(NOTE)
    const { view } = await mount(file)
    const phone = taskLines(file).filter((t) => t.core.startsWith('|'))
    expect(phone.map((t) => [t.core.replace(/^\|\d+\|[\d.]+\|\[ \] /, ''), t.checked])).toEqual(todos(view))
  })

  it('a tick: the phone writes the bytes the Mac writes for the same tick; the Mac loads it checked and saves it unchanged', async () => {
    const file = await macSave(NOTE)
    const phone = phoneTick(file, 'Laundry', true)
    // The Mac ticks the same to-do in its editor and saves.
    const { crepe, view } = await mount(file)
    let at = -1
    view.state.doc.descendants((node, pos) => {
      if (at < 0 && node.type.name === 'list_item' && node.firstChild?.textContent === 'Laundry') at = pos
    })
    view.dispatch(view.state.tr.setNodeMarkup(at, undefined, { ...view.state.doc.nodeAt(at)!.attrs, checked: true }))
    expect(phone).toBe(getMarkdownForSave(crepe))
    // The Mac's parser reads the phone's file: only that to-do changed, and a save keeps every byte.
    const again = await mount(phone)
    expect(todos(again.view)).toEqual(todos((await mount(file)).view).map(([w, c], i) => [w, w === 'Laundry' && i < 5 ? true : c]))
    expect(getMarkdownForSave(again.crepe)).toBe(phone)
  })

  it('an untick of `[X]` writes `[ ]` and the Mac reads it unchecked; the Laundry of the other cell is its own', async () => {
    const file = (await macSave(NOTE)).replace('[x] Pills', '[X] Pills')
    const untick = phoneTick(file, 'Pills', false)
    expect(untick).toBe(file.replace('[X] Pills', '[ ] Pills'))
    const out = applyTask(untick, tickOf(untick, '|1|0|[ ] Laundry', 0, true))
    if (out.kind !== 'ticked') throw new Error('not ticked')
    expect(out.content).toBe(untick.replace(/(\| Mon +\| <ul><li>)\[ \]/, '$1[x]'))
    const { crepe, view } = await mount(out.content)
    expect(todos(view).filter(([w]) => w === 'Laundry' || w === 'Pills')).toEqual([
      ['Laundry', false],
      ['Pills', false],
      ['Laundry', true],
    ])
    expect(getMarkdownForSave(crepe)).toBe(out.content)
  })
})
