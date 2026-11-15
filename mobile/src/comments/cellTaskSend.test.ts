import { describe, expect, it } from 'vitest'
import { TICK_HOLD_MS } from '../page/taskTicks'
import { tickOf } from './taskWrite'
import { commentsSetup, isPatch } from './testing'

/**
 * YAZ-5618: a tick of a task in a table cell takes the page ticks' safe path (YAZ-5494, YAZ-5522 N11), on the fake GitHub
 * with a made-up vault: the ticks of one hold in ONE commit (compare-and-swap), one byte each; the Mac's edit of another
 * cell of the same row just before the ref move is kept, and the tick lands on the fresh row.
 */
const PAGE = 'plans/Week plan.md'
const ROW = '| Sun      | <ul><li>**==Plans==**<ul><li>[ ] 1- Look back (1hr)</li><li>[ ] 3- Reset (30min)<ul><li>[ ] Laundry</li><li>[x] Pills</li></ul></li></ul></li></ul> | <ul><li>[ ] Laundry</li></ul> |'
const TEXT = ['---', 'title: Week plan', '---', '# Week plan', '', '| Day      | Plan | Also |', '| -------- | ---- | ---- |', ROW, '', '- [ ] Laundry', ''].join('\n')
const diff = (a: string, b: string) => [...a].flatMap((c, i) => (c === b[i] ? [] : [[i, c, b[i]]]))
const tick = (core: string, checked = true) => ({ path: PAGE, body: '', task: tickOf(TEXT, core, 0, checked), holdMs: TICK_HOLD_MS })

describe('a tick from a cell reaches the page', () => {
  it('three ticks in one hold (two cells of one row and a page task): one commit, three bytes', async () => {
    const t = await commentsSetup({ [PAGE]: TEXT })
    await t.port.add(tick('|1|0.1.0|[ ] Laundry'))
    await t.port.add(tick('|1|0.1.1|[ ] Pills', false))
    await t.port.add(tick('|2|0|[ ] Laundry'))
    await t.tick(TICK_HOLD_MS - 100)
    expect(t.patches()).toBe(0)
    await t.tick(200)
    expect(t.patches()).toBe(1)
    const page = (await t.remote(PAGE))!
    expect(diff(TEXT, page)).toHaveLength(3)
    expect(page).toContain('<li>[x] Laundry</li><li>[ ] Pills</li>')
    expect(page).toContain('| <ul><li>[x] Laundry</li></ul> |')
    expect(page).toContain('\n- [ ] Laundry\n')
    expect(t.port.waiting()).toEqual([])
  })

  it('the race: the Mac edits another cell of the same row just before the ref move; the phone ticks the fresh row', async () => {
    const t = await commentsSetup({ [PAGE]: TEXT })
    const mac = TEXT.replace('| Sun      |', '| Sunday   |').replace('[ ] 1- Look back', '[x] 1- Look back')
    let raced = false
    t.setHook(async (_url, init, forward) => {
      if (isPatch(init) && !raced) {
        raced = true
        await t.macPush({ [PAGE]: mac })
      }
      return forward()
    })
    await t.port.add({ path: PAGE, body: '', task: tickOf(TEXT, '|1|0.1.0|[ ] Laundry', 0, true) })
    await t.settle()
    const page = (await t.remote(PAGE))!
    expect(diff(mac, page)).toHaveLength(1)
    expect(page).toContain('| Sunday   | <ul><li>**==Plans==**<ul><li>[x] 1- Look back (1hr)</li><li>[ ] 3- Reset (30min)<ul><li>[x] Laundry</li>')
    expect(t.patches()).toBe(2)
  })

  it('the race where the Mac changed that item: refused, nothing written, the tick kept for the page to say so', async () => {
    const t = await commentsSetup({ [PAGE]: TEXT })
    const mac = TEXT.replace('<li>[ ] Laundry</li><li>[x] Pills', '<li>[ ] Laundry and towels</li><li>[x] Pills')
    let raced = false
    t.setHook(async (_url, init, forward) => {
      if (isPatch(init) && !raced) {
        raced = true
        await t.macPush({ [PAGE]: mac })
      }
      return forward()
    })
    await t.port.add({ path: PAGE, body: '', task: tickOf(TEXT, '|1|0.1.0|[ ] Laundry', 0, true) })
    await t.settle()
    expect(await t.remote(PAGE)).toBe(mac)
    expect(t.port.waiting(PAGE)).toMatchObject([{ refused: 'changed' }])
  })
})
