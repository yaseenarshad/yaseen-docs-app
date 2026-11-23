// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { applyTask, taskLines, tickOf, type TaskTick } from '../comments/taskWrite'
import { notSentWords } from '../status/NotSent'
import { cellRanges } from './cellTasks'
import { renderPiece, type PageLook } from './pageRender'
import { attachFolds } from './folds'

/**
 * YAZ-5618: a task in a table cell (the Mac's HTML list, `client/src/editor/table/cellLists.ts`) is a task on the
 * phone: its box drawn in the cell, a tap ticks it, and the tick writes ONE byte of the row, as the Mac writes it.
 * Made-up pages only.
 */

/** A planning table like Yaseen's, made up: a highlighted bold head, numbered jobs, a nested list of tasks. */
const ROW =
  '|          | <ul><li>**==Plans==**<ul><li>[ ] 1- Look back (1hr)</li><li>[ ] 2- Plan ahead (1hr)</li><li>[ ] 3- Reset (30min)<ul><li>[ ] Laundry</li><li>[x] Pills</li><li>[X] Trash</li></ul></li></ul></li></ul> |'
const PAGE = ['---', 'title: Week plan', '---', '# Week plan', '', '| Day      | Plan |', '| -------- | ---- |', ROW, '| Mon      | <ul><li>[ ] Laundry</li></ul> |', '', '- [ ] Laundry', ''].join('\n')

const look: PageLook = {
  link: (inner) => ({ label: inner, open: { kind: 'page', path: `${inner}.md` } }),
  embed: (inner) => ({ kind: 'text', text: `![[${inner}]]` }),
  asset: () => null,
  card: () => document.createElement('div'),
}
const body = (page: string) => page.slice(page.indexOf('---\n', 4) + 4)
const tickBox = (page: string, core: string, checked: boolean, nth = 0): TaskTick => tickOf(page, core, nth, checked)
const ticked = (page: string, t: TaskTick): string => {
  const out = applyTask(page, t)
  if (out.kind !== 'ticked') throw new Error(`not ticked: ${JSON.stringify(out)}`)
  return out.content
}
const diff = (a: string, b: string) => [...a].flatMap((c, i) => (c === b[i] ? [] : [[i, c, b[i]]]))

describe('a cell task, as the Mac reads it', () => {
  it('reads [ ], [x] and [X] in nested cell lists, with each item path; a bold highlighted head is no task', () => {
    const cells = taskLines(PAGE).filter((t) => t.core.startsWith('|'))
    expect(cells.map((t) => [t.core, t.checked, t.line])).toEqual([
      ['|1|0.0|[ ] 1- Look back (1hr)', false, 4],
      ['|1|0.1|[ ] 2- Plan ahead (1hr)', false, 4],
      ['|1|0.2|[ ] 3- Reset (30min)', false, 4],
      ['|1|0.2.0|[ ] Laundry', false, 4],
      ['|1|0.2.1|[ ] Pills', true, 4],
      ['|1|0.2.2|[ ] Trash', true, 4],
      ['|1|0|[ ] Laundry', false, 5],
    ])
    // Each box's mark is the byte between its brackets.
    for (const t of cells) expect(PAGE.slice(t.at - 1, t.at + 2)).toMatch(/^\[[ xX]\]$/)
    // The page's own task is still there, after the table.
    expect(taskLines(PAGE).at(-1)!.core).toBe('- [ ] Laundry')
  })

  it('only the exact form: a header cell, an escaped box, unbalanced tags, other HTML, text between tags, a code span', () => {
    const no = [
      '| <ul><li>[ ] head</li></ul> |\n| - |\n| x |',
      '| h |\n| - |\n| <ul><li>\\[ ] escaped</li></ul> |',
      '| h |\n| - |\n| <ul><li>[ ] open</li> |',
      '| h |\n| - |\n| <ul><li>[ ] a</li></ol> |',
      '| h |\n| - |\n| <ul><li>[ ] <u>under</u></li></ul> |',
      '| h |\n| - |\n| <ul> <li>[ ] space</li></ul> |',
      '| h |\n| - |\n| <ul class="x"><li>[ ] class</li></ul> |',
      '| h |\n| - |\n| `<ul><li>[ ] code</li></ul>` |',
      '| h |\n| - |\n| <ul><li>[ ]no space</li></ul> |',
      '| h |\n| - |\n| <ul><li>text [ ] later</li></ul> |',
    ]
    for (const page of no) expect(taskLines(page), page).toEqual([])
    const yes = ['| h |\n| - |\n| before<br><ol start="3"><li>[ ] three</li><li>[x] four<br>more</li></ol>after |', '| h | i |\n| - | - |\n| a \\| b | <ul><li>[ ] after an escaped pipe</li></ul> |']
    expect(taskLines(yes[0]!).map((t) => [t.core, t.checked])).toEqual([
      ['|0|0|[ ] three', false],
      ['|0|1|[ ] four<br>more', true],
    ])
    const [pipe] = taskLines(yes[1]!)
    expect(pipe!.core).toBe('|1|0|[ ] after an escaped pipe')
    expect(yes[1]!.slice(pipe!.at - 1, pipe!.at + 2)).toBe('[ ]')
  })

  it('splits a row as GFM does (escaped pipes stay in their cell)', () => {
    const row = '| a \\| b | c |'
    expect(cellRanges(row).map(({ from, to }) => row.slice(from, to))).toEqual(['a \\| b', 'c'])
    expect(cellRanges('a | b').map(({ from, to }) => 'a | b'.slice(from, to))).toEqual(['a', 'b'])
  })
})

describe('a tick from a cell writes one byte, as the Mac writes it', () => {
  it('ticks [ ] to [x] and unticks [x] and [X] to [ ]: only that byte of the row changes', () => {
    const laundry = tickBox(PAGE, '|1|0.2.0|[ ] Laundry', true)
    const out = ticked(PAGE, laundry)
    expect(diff(PAGE, out)).toHaveLength(1)
    expect(out).toContain('<li>[x] Laundry</li><li>[x] Pills</li>')
    const trash = ticked(PAGE, tickBox(PAGE, '|1|0.2.2|[ ] Trash', false))
    expect(diff(PAGE, trash)).toHaveLength(1)
    expect(trash).toContain('<li>[ ] Trash</li>')
    // Ticked again: already so, nothing written.
    expect(applyTask(out, laundry)).toEqual({ kind: 'already' })
  })

  it('the bold highlighted head and the parent task tick on their own; the children stay as they are', () => {
    const reset = ticked(PAGE, tickBox(PAGE, '|1|0.2|[ ] 3- Reset (30min)', true))
    expect(reset).toContain('<li>[x] 3- Reset (30min)<ul><li>[ ] Laundry</li>')
    expect(reset).toContain('<li>**==Plans==**<ul>')
    expect(diff(PAGE, reset)).toHaveLength(1)
  })

  it('the same words in two cells: each tap ticks its own cell only', () => {
    const first = ticked(PAGE, tickBox(PAGE, '|1|0.2.0|[ ] Laundry', true))
    const second = ticked(PAGE, tickBox(PAGE, '|1|0|[ ] Laundry', true))
    expect(first).toContain('| Mon      | <ul><li>[ ] Laundry</li></ul> |')
    expect(second).toContain('| Mon      | <ul><li>[x] Laundry</li></ul> |')
    expect(second).toContain('<li>[ ] Laundry</li><li>[x] Pills</li>')
    expect(second).toContain('\n- [ ] Laundry\n')
  })

  it('twin rows (the same cell words in two rows): the tapped row by its place, also after the Mac adds a row above', () => {
    const twin = '| Tue      | <ul><li>[ ] Gym</li></ul> |'
    const page = ['| Day      | Plan |', '| -------- | ---- |', '| Mon      | x |', twin, '| Wed      | y |', twin, '| Thu      | z |', ''].join('\n')
    const t = tickBox(page, '|1|0|[ ] Gym', true, 1)
    const out = ticked(page, t)
    expect(out.split('\n')[5]).toBe(twin.replace('[ ]', '[x]'))
    expect(out.split('\n')[3]).toBe(twin)
    // The Mac added a row with the same words at the top: the tapped one is still found by the rows around it.
    const lines = page.split('\n')
    const moved = [...lines.slice(0, 2), '| New      | <ul><li>[ ] Gym</li></ul> |', ...lines.slice(2)].join('\n')
    expect(ticked(moved, t).split('\n')[6]).toBe(twin.replace('[ ]', '[x]'))
    // The Mac wrote the twins' rows the same and took away what told them apart: unclear, refused.
    const same = ['| Day      | Plan |', '| -------- | ---- |', twin, twin, twin, ''].join('\n')
    expect(applyTask(same, t)).toEqual({ kind: 'refused', why: 'changed' })
  })

  it('a tick while the Mac edited another cell of the same row, or ticked another task in it: merged, one byte', () => {
    const t = tickBox(PAGE, '|1|0.2.0|[ ] Laundry', true)
    const mac = PAGE.replace('|          | <ul>', '| Sun      | <ul>').replace('[x] Pills', '[ ] Pills').replace('[ ] 1- Look back', '[x] 1- Look back')
    const out = ticked(mac, t)
    expect(diff(mac, out)).toHaveLength(1)
    expect(out).toContain('| Sun      | <ul><li>**==Plans==**<ul><li>[x] 1- Look back (1hr)')
    expect(out).toContain('<li>[x] Laundry</li><li>[ ] Pills</li>')
  })

  it('refused when the item changed or moved in its cell on the Mac: nothing written', () => {
    const t = tickBox(PAGE, '|1|0.2.0|[ ] Laundry', true)
    expect(applyTask(PAGE.replace('[ ] Laundry</li><li>[x] Pills', '[ ] Washing</li><li>[x] Pills'), t)).toEqual({ kind: 'refused', why: 'changed' })
    expect(applyTask(PAGE.replace('<ul><li>[ ] Laundry</li><li>[x] Pills', '<ul><li>[ ] Iron</li><li>[ ] Laundry</li><li>[x] Pills'), t)).toEqual({ kind: 'refused', why: 'changed' })
  })

  it('a tick not sent names its task by its words', () => {
    const t = tickBox(PAGE, '|1|0.2.0|[ ] Laundry', true)
    expect(notSentWords({ id: 'a', path: 'p.md', body: '', at: '', madeAt: 0, notBefore: 0, task: t })).toBe('Tick: Laundry')
  })
})

describe('the reader draws a cell task as a task of the page', () => {
  it('a box with its line and core in place of the brackets, done ones checked; the head and plain bullets keep no box', () => {
    const root = renderPiece(body(PAGE), look)
    const cell = root.querySelectorAll<HTMLTableRowElement>('tbody tr')[0]!.cells[1]!
    const boxes = [...cell.querySelectorAll<HTMLElement>('.page-task')]
    expect(boxes.map((b) => [b.dataset.task, b.dataset.taskLine, b.dataset.checked])).toEqual([
      ['|1|0.0|[ ] 1- Look back (1hr)', '4', 'false'],
      ['|1|0.1|[ ] 2- Plan ahead (1hr)', '4', 'false'],
      ['|1|0.2|[ ] 3- Reset (30min)', '4', 'false'],
      ['|1|0.2.0|[ ] Laundry', '4', 'false'],
      ['|1|0.2.1|[ ] Pills', '4', 'true'],
      ['|1|0.2.2|[ ] Trash', '4', 'true'],
    ])
    expect(cell.textContent).not.toContain('[')
    // Each box is its item's first child, so the reader's task look (no dot, struck through when done) is the page's.
    for (const b of boxes) expect(b.parentElement!.firstChild).toBe(b)
    expect(cell.querySelector('mark')?.closest('strong')?.textContent).toBe('Plans')
    expect(cell.querySelector('li')!.querySelector(':scope > .page-task')).toBeNull()
  })

  it('a cell task with children folds; the fold leaves its box and its line', () => {
    const host = document.createElement('div')
    host.append(renderPiece(body(PAGE), look))
    document.body.append(host)
    const folds = attachFolds(host)
    folds.scan()
    folds.apply()
    const reset = [...host.querySelectorAll<HTMLElement>('.fold-btn')].find((b) => b.dataset.foldLabel === '3- Reset (30min)')
    expect(reset).toBeDefined()
    const li = reset!.closest('li')!
    expect(li.firstElementChild!.classList.contains('page-task')).toBe(true)
    reset!.click()
    expect(li.querySelector(':scope > ul')!.hasAttribute('data-fold-hidden')).toBe(true)
    expect(li.querySelector(':scope > .page-task')!.hasAttribute('data-fold-hidden')).toBe(false)
    folds.destroy()
    host.remove()
  })
})
