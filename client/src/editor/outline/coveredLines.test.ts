/**
 * YAZ-3003: Tab / Shift-Tab / Mod-Enter after a KEYBOARD line selection (⇧↑ / ⇧↓, YAZ-1734).
 * That selection touches the parent or the next sibling at zero width; that line must not move.
 * The real editor (`createCrepe`), keys through `handleKeyDown`, the saved markdown asserted.
 * S-numbers are the scenario matrix on the YAZ-3003 working log (YAZ-3004).
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Crepe } from '@milkdown/crepe'
import { endOf, md, mount, posOf, pressKey, runCommand, select, unmountAll } from '../marks/markTestKit'
import { toggleOutlineFold } from './outlineFolding'

afterEach(async () => {
  vi.useRealTimers()
  await unmountAll()
})

const DOC = '* DAY\n  * MORNING\n    * 5am\n    * 6am\n    * Gym\n  * AFTERNOON\n    * 1pm\n'
const KIDS_OUT = '* DAY\n  * MORNING\n  * 5am\n  * 6am\n  * Gym\n  * AFTERNOON\n    * 1pm\n'
const UNDER_5AM = '* DAY\n  * MORNING\n    * 5am\n      * 6am\n      * Gym\n  * AFTERNOON\n    * 1pm\n'
const shiftArrow = (crepe: Crepe, key: 'ArrowUp' | 'ArrowDown', times: number) => {
  for (let i = 0; i < times; i++) pressKey(crepe, key, { shift: true })
}
const tab = (crepe: Crepe, shift = false) => pressKey(crepe, 'Tab', { shift })
/** Past ProseMirror history's 500 ms grouping, so each press is its own undo step as for a person. */
const pause = () => vi.setSystemTime(Date.now() + 1000)

describe('Tab / Shift-Tab act on the lines the selection covers', () => {
  it('the user flow (S1–S4): ⌘→ Gym, ⇧↑×3, Shift-Tab, Tab, ⌘Z ⌘Z — only the kids move, the selection stays', async () => {
    const { crepe } = await mount(DOC)
    vi.useFakeTimers({ toFake: ['Date'] })
    select(crepe, endOf(crepe, 'Gym'))
    shiftArrow(crepe, 'ArrowUp', 3)
    expect(tab(crepe, true)).toBe(true)
    expect(md(crepe)).toBe(KIDS_OUT)
    pause()
    tab(crepe)
    expect(md(crepe)).toBe(DOC)
    expect(tab(crepe)).toBe(true) // 5am is a first child: consumed, nothing moves
    expect(md(crepe)).toBe(DOC)
    pressKey(crepe, 'z', { mod: true })
    expect(md(crepe)).toBe(KIDS_OUT)
    pressKey(crepe, 'z', { mod: true })
    expect(md(crepe)).toBe(DOC)
  })

  it('selecting down (S5, S6) and a partial ⇧↑ (S7)', async () => {
    let { crepe } = await mount(DOC)
    select(crepe, posOf(crepe, '5am'))
    shiftArrow(crepe, 'ArrowDown', 3)
    tab(crepe, true)
    expect(md(crepe)).toBe(KIDS_OUT)
    ;({ crepe } = await mount(DOC))
    select(crepe, posOf(crepe, '6am'))
    shiftArrow(crepe, 'ArrowDown', 2)
    tab(crepe)
    expect(md(crepe)).toBe(UNDER_5AM)
    ;({ crepe } = await mount(DOC))
    select(crepe, endOf(crepe, 'Gym'))
    shiftArrow(crepe, 'ArrowUp', 2)
    tab(crepe)
    expect(md(crepe)).toBe(UNDER_5AM)
  })

  it('a selection that is only the line break (S17): end of 6am → start of Gym acts on 6am alone', async () => {
    const { crepe } = await mount(DOC)
    select(crepe, endOf(crepe, '6am'), posOf(crepe, 'Gym'))
    tab(crepe)
    expect(md(crepe)).toBe('* DAY\n  * MORNING\n    * 5am\n      * 6am\n    * Gym\n  * AFTERNOON\n    * 1pm\n')
  })

  it('top level (S8): Shift-Tab over all of MORNING\'s kids leaves MORNING and AFTERNOON bullets', async () => {
    const { crepe } = await mount('* MORNING\n  * 5am\n  * Gym\n* AFTERNOON\n  * 1pm\n')
    select(crepe, posOf(crepe, '5am'))
    shiftArrow(crepe, 'ArrowDown', 2)
    tab(crepe, true)
    expect(md(crepe)).toBe('* MORNING\n* 5am\n* Gym\n* AFTERNOON\n  * 1pm\n')
  })

  it('a folded Gym (S9): ⇧↓ skips its hidden kids, Tab moves Gym with them', async () => {
    const { crepe } = await mount('* MORNING\n  * 5am\n  * 6am\n  * Gym\n    * bench\n* AFTERNOON\n')
    expect(runCommand(crepe, toggleOutlineFold(posOf(crepe, 'Gym') - 2))).toBe(true)
    select(crepe, posOf(crepe, '6am'))
    shiftArrow(crepe, 'ArrowDown', 2)
    tab(crepe)
    expect(md(crepe)).toBe('* MORNING\n  * 5am\n    * 6am\n    * Gym\n      * bench\n* AFTERNOON\n')
  })

  it('zoomed into MORNING (S10, S11): Tab sinks inside the zoom; Shift-Tab of its direct kids stays blocked', async () => {
    const { crepe } = await mount(DOC)
    select(crepe, posOf(crepe, 'MORNING') + 1)
    pressKey(crepe, '.', { mod: true })
    select(crepe, endOf(crepe, 'Gym'))
    shiftArrow(crepe, 'ArrowUp', 3)
    expect(tab(crepe, true)).toBe(true)
    expect(md(crepe)).toBe(DOC)
    select(crepe, endOf(crepe, 'Gym'))
    shiftArrow(crepe, 'ArrowUp', 2)
    tab(crepe)
    expect(md(crepe)).toBe(UNDER_5AM)
  })

  it('Mod-Enter (S12, D3): only the covered kids turn into tasks, MORNING stays a bullet', async () => {
    const { crepe } = await mount(DOC)
    select(crepe, endOf(crepe, 'Gym'))
    shiftArrow(crepe, 'ArrowUp', 3)
    pressKey(crepe, 'Enter', { mod: true })
    expect(md(crepe)).toBe('* DAY\n  * MORNING\n    * [ ] 5am\n    * [ ] 6am\n    * [ ] Gym\n  * AFTERNOON\n    * 1pm\n')
  })
})

describe('a list followed by a heading (D4)', () => {
  const MIXED = '* A\n* B\n* C\n\n## Next\n'

  it('S13: a ⇧↓ range that only touches the heading indents the list items, the heading keeps its text', async () => {
    const { crepe } = await mount(MIXED)
    select(crepe, posOf(crepe, 'B'))
    shiftArrow(crepe, 'ArrowDown', 2)
    tab(crepe)
    expect(md(crepe)).toBe('* A\n  * B\n  * C\n\n## Next\n')
  })

  it('S14: a selection over list text AND heading text — Tab and Shift-Tab change nothing and are consumed', async () => {
    const { crepe } = await mount(MIXED)
    const before = md(crepe)
    select(crepe, posOf(crepe, 'B'), endOf(crepe, 'Next'))
    expect(tab(crepe)).toBe(true)
    expect(tab(crepe, true)).toBe(true)
    expect(md(crepe)).toBe(before)
  })
})
