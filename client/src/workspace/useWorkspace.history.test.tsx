/**
 * The window's ONE Back list (YAZ-3647 D1, replaces YAZ-721 D1): every page, tab and zoom level that came
 * to the front, in order, renderer- and session-only. The steps come from `workspaceReducer` (`withStep`,
 * D4), so these tests run the real one, with tab ids. U1–U9 are the main issue's checks.
 */
import { defaultRightPanelIdentity } from '@shared/types'
import { describe, expect, it } from 'vitest'
import { MAX_NEAR_STEPS, MAX_STEPS, nearSteps, NO_STEPS, stepIdOf, tabById, workspaceReducer, type WorkspaceAction, type WorkspaceState } from './useWorkspace'

const A = '/v/a.md'
const B = '/v/b.md'
const C = '/v/c.md'
const D = '/v/d.md'

const EMPTY: WorkspaceState = { tabs: [], active: null, mounted: [], history: NO_STEPS, preview: null, blank: false, rightPanel: defaultRightPanelIdentity(), rightMounted: [], rightHistory: {} }

const run = (s: WorkspaceState, ...actions: WorkspaceAction[]): WorkspaceState => actions.reduce(workspaceReducer, s)
const name = (path: string): string => path.slice(path.lastIndexOf('/') + 1, -3)
/** Where you are: the page in front, and its level after `@`. */
const where = (s: WorkspaceState): string => {
  const tab = tabById(s, s.active)
  return tab === null ? '-' : `${name(tab.path)}${tab.zoom === undefined ? '' : `@${tab.zoom}`}`
}
/** The list as text, `[ ]` around the step you are on. */
const trail = (s: WorkspaceState): string =>
  s.history.steps.map((step, i) => (i === s.history.index ? `[${name(step.path)}${step.zoom === null ? '' : `@${step.zoom}`}]` : `${name(step.path)}${step.zoom === null ? '' : `@${step.zoom}`}`)).join(' ')
/** The id of the tab that shows `path`. */
const idOf = (s: WorkspaceState, path: string): string => s.tabs.find((t) => t.path === path)!.id

/** A window that opened A from the start: one tab, one step (`reset`, as at boot). */
const onA = (): WorkspaceState => run(EMPTY, { type: 'reset', tabs: [{ path: A }], active: A })

describe('one Back list for the window (YAZ-3647 D1, D4)', () => {
  it('U4, U8: links in one tab are steps; Back and Forward walk them; a new step after Back clears Forward', () => {
    const s = run(onA(), { type: 'navigate', path: B }, { type: 'navigate', path: C })
    expect(trail(s)).toBe('a b [c]')
    const back = run(s, { type: 'back' }, { type: 'back' })
    expect([where(back), trail(back), back.tabs.length]).toEqual(['a', '[a] b c', 1])
    expect(where(run(back, { type: 'forward' }))).toBe('b')
    const branched = run(back, { type: 'forward' }, { type: 'navigate', path: D })
    expect(trail(branched)).toBe('a b [d]')
    // At either end the arrows change nothing: the SAME state object, so nothing is written.
    const start = run(s, { type: 'back' }, { type: 'back' })
    expect(run(start, { type: 'back' })).toBe(start)
    expect(run(s, { type: 'forward' })).toBe(s)
  })

  it('U1: every page that comes to the front is a step: a new tab, a tab click, ⌃Tab, the sidebar — Back goes to its tab, never into this one', () => {
    let s = run(onA(), { type: 'open-new', path: B })
    s = run(s, { type: 'activate', id: idOf(s, A) }, { type: 'cycle', dir: 1 }, { type: 'open-current', path: C })
    expect(trail(s)).toBe('a b a b [c]')
    const back = run(s, { type: 'back' })
    expect([where(back), back.tabs.map((t) => name(t.path))]).toEqual(['b', ['a', 'b', 'c']])
    expect(where(run(back, { type: 'back' }))).toBe('a')
    // A link to a page that another tab shows goes to that tab (YAZ-3609 D10), and Back returns to the page with the link.
    const jumped = run(onA(), { type: 'open-background', path: B }, { type: 'navigate', path: B })
    expect([where(jumped), where(run(jumped, { type: 'back' }))]).toEqual(['b', 'a'])
  })

  it('U6: a background tab adds its step when it shows, and Back then returns to the page you came from', () => {
    const s = run(onA(), { type: 'open-background', path: B })
    expect(trail(s)).toBe('[a]')
    const shown = run(s, { type: 'navigate', path: C }, { type: 'activate', id: idOf(s, B) })
    expect(trail(shown)).toBe('a c [b]')
    expect(where(run(shown, { type: 'back' }))).toBe('c')
  })

  it('U2, U3: a zoom is a step; Back to a page you left brings it back at the level you left', () => {
    const tab = (s: WorkspaceState) => s.active!
    let s = onA()
    s = run(s, { type: 'zoom', id: tab(s), zoom: 'k1:0' }, { type: 'zoom', id: tab(s), zoom: 'k2:0' }, { type: 'navigate', path: B })
    expect(trail(s)).toBe('a a@k1:0 a@k2:0 [b]')
    const back = run(s, { type: 'back' })
    // The page comes back in its own tab's slot, at k2: its editor starts there (`Tab.zoom` → `startKey`).
    expect([where(back), back.active]).toEqual(['a@k2:0', s.active])
    expect(where(run(back, { type: 'back' }))).toBe('a@k1:0')
    expect(where(run(back, { type: 'back' }, { type: 'back' }))).toBe('a')
    expect(where(run(back, { type: 'back' }, { type: 'back' }, { type: 'forward' }))).toBe('a@k1:0')
    // A QUIET level (the page started there, or the bullet's text changed) fills the step it is on: no new step.
    const quiet = run(onA(), { type: 'zoom', id: onA().active!, zoom: 'k1:0', quiet: true })
    expect(trail(quiet)).toBe('[a]')
  })

  it('U2: the same level again is no step, and a tab switch remembers the level the tab is at', () => {
    let s = onA()
    const a = s.active!
    s = run(s, { type: 'zoom', id: a, zoom: 'k1:0' }, { type: 'zoom', id: a, zoom: 'k1:0' }, { type: 'open-new', path: B }, { type: 'activate', id: a })
    expect(trail(s)).toBe('a a@k1:0 b [a@k1:0]')
  })

  it('U7 (D5): a closed tab\'s steps leave the list, and two steps that meet become one', () => {
    let s = run(onA(), { type: 'open-new', path: B }, { type: 'navigate', path: C })
    s = run(s, { type: 'activate', id: idOf(s, A) })
    expect(trail(s)).toBe('a b c [a]')
    const closed = run(s, { type: 'close', id: idOf(s, C) })
    expect(trail(closed)).toBe('[a]')
    // ⌘W on the tab in front: its heir is the next step, and Back skips the closed one.
    const w = run(onA(), { type: 'open-new', path: B }, { type: 'navigate', path: C })
    const after = run(w, { type: 'close', id: w.active! })
    expect([where(after), trail(after)]).toEqual(['a', '[a]'])
  })

  it('U9: a renamed page keeps its steps under the new name; a deleted page leaves the list', () => {
    const s = run(onA(), { type: 'navigate', path: B }, { type: 'navigate', path: C })
    const renamed = run(s, { type: 'rename', oldPath: A, newPath: D })
    expect(trail(renamed)).toBe('d b [c]')
    expect(where(run(renamed, { type: 'back' }, { type: 'back' }))).toBe('d')
    const deleted = run(s, { type: 'delete', path: B })
    expect(trail(deleted)).toBe('a [c]')
    expect(where(run(deleted, { type: 'back' }))).toBe('a')
  })

  it('D3: at most MAX_STEPS steps; the oldest go first', () => {
    let s = onA()
    for (let i = 0; i < MAX_STEPS + 20; i++) s = run(s, { type: 'navigate', path: i % 2 === 0 ? B : C })
    expect([s.history.steps.length, s.history.index]).toEqual([MAX_STEPS, MAX_STEPS - 1])
  })

  it('the blank tab shows no page: no step while it shows, and the arrows do nothing under it', () => {
    const s = run(onA(), { type: 'new-tab' })
    expect(trail(s)).toBe('[a]')
    const withB = run(onA(), { type: 'navigate', path: B }, { type: 'new-tab' })
    expect(run(withB, { type: 'back' })).toBe(withB)
    // A page opened from the blank tab fills it: a step.
    expect(trail(run(s, { type: 'open-current', path: C }))).toBe('a [c]')
  })

  it('a code tab keeps its place under its own latest step (YAZ-3458): `stepIdOf`', () => {
    const s = run(onA(), { type: 'navigate', path: B })
    const a = s.active!
    expect(stepIdOf(s.history, a)).toBe(s.history.steps[1].id)
    expect(stepIdOf(run(s, { type: 'back' }).history, a)).toBe(s.history.steps[0].id)
    expect(stepIdOf(s.history, 'no-such-tab')).toBe(0)
  })
})

describe('a bullet in a new tab (YAZ-3646 D11, D13)', () => {
  it('a copy right after its tab, at the bullet; in front it is a step, and Back returns to the tab it came from, at its level', () => {
    let s = run(onA(), { type: 'open-new', path: B })
    const a = idOf(s, A)
    s = run(s, { type: 'activate', id: a }, { type: 'zoom', id: a, zoom: 'k1:0' }, { type: 'open-zoom', id: a, zoom: 'k2:0' })
    expect(s.tabs.map((t) => `${name(t.path)}${t.zoom === undefined ? '' : `@${t.zoom}`}`)).toEqual(['a@k1:0', 'a@k2:0', 'b'])
    expect([where(s), s.mounted.includes(s.active!)]).toEqual(['a@k2:0', true])
    const back = run(s, { type: 'back' })
    expect([back.active, where(back)]).toEqual([a, 'a@k1:0'])
  })

  it('behind (⌘-click): no step and not mounted until it shows; then Back returns to the page you came from', () => {
    const s = onA()
    const a = s.active!
    const behind = run(s, { type: 'open-zoom', id: a, zoom: 'k2:0', background: true })
    const copy = behind.tabs[1]
    expect([trail(behind), behind.active, behind.mounted.includes(copy.id), copy.zoom]).toEqual(['[a]', a, false, 'k2:0'])
    const shown = run(behind, { type: 'activate', id: copy.id })
    expect(trail(shown)).toBe('a [a@k2:0]')
    expect(where(run(shown, { type: 'back' }))).toBe('a')
  })

  it('an unknown tab opens nothing', () => {
    const s = onA()
    expect(run(s, { type: 'open-zoom', id: 'nope', zoom: 'k1:0' })).toBe(s)
  })

  it('the title crumb (YAZ-3647 E2): a copy right after its tab on the whole page, while the source stays at its bullet', () => {
    let s = onA()
    const a = s.active!
    s = run(s, { type: 'zoom', id: a, zoom: 'k1:0' }, { type: 'open-zoom', id: a, zoom: null })
    expect([s.tabs.map((t) => t.zoom ?? '-'), where(s), trail(s)]).toEqual([['k1:0', '-'], 'a', 'a a@k1:0 [a]'])
  })
})

describe('the menus of ‹ and › (YAZ-3647 E3)', () => {
  it('`nearSteps`: the steps behind or ahead, the nearest first; at most MAX_NEAR_STEPS', () => {
    let s = run(onA(), { type: 'navigate', path: B }, { type: 'navigate', path: C }, { type: 'navigate', path: D })
    s = run(s, { type: 'back' })
    const rows = (dir: -1 | 1) => nearSteps(s.history, dir).map((step) => `${s.history.steps.indexOf(step)}:${name(step.path)}`)
    expect([rows(-1), rows(1)]).toEqual([['1:b', '0:a'], ['3:d']])
    let long = onA()
    for (let i = 0; i < MAX_NEAR_STEPS + 5; i++) long = run(long, { type: 'navigate', path: i % 2 === 0 ? B : A })
    const behind = nearSteps(long.history, -1)
    expect([behind.length, behind[0]]).toEqual([MAX_NEAR_STEPS, long.history.steps[long.history.index - 1]])
    expect(nearSteps(long.history, 1)).toEqual([])
  })

  it('`go` jumps straight to a step, as that many Backs or Forwards would: it adds none, and keeps the steps ahead', () => {
    let s = onA()
    const a = s.active!
    s = run(s, { type: 'zoom', id: a, zoom: 'k1:0' }, { type: 'navigate', path: B }, { type: 'open-new', path: C })
    expect(trail(s)).toBe('a a@k1:0 b [c]')
    const id = (i: number): number => s.history.steps[i].id
    const back = run(s, { type: 'go', id: id(1) })
    expect([where(back), trail(back)]).toEqual(['a@k1:0', 'a [a@k1:0] b c'])
    expect(back).toEqual(run(s, { type: 'back' }, { type: 'back' }))
    const ahead = run(back, { type: 'go', id: id(3) })
    expect([where(ahead), trail(ahead)]).toEqual(['c', 'a a@k1:0 b [c]'])
    // Where you are already, or a step that is not there: no change.
    expect(run(s, { type: 'go', id: id(3) })).toBe(s)
    expect(run(s, { type: 'go', id: -1 })).toBe(s)
  })
})

describe('a step on the preview tab (YAZ-3647 E7)', () => {
  it('a sidebar click moves the preview tab to another page; Back brings the first page back in that same tab, still the preview', () => {
    let s = run(EMPTY, { type: 'open-current', path: A })
    const preview = s.preview!
    s = run(s, { type: 'open-current', path: B })
    expect([s.tabs.length, s.active, s.preview, trail(s)]).toEqual([1, preview, preview, 'a [b]'])
    const back = run(s, { type: 'back' })
    expect([back.tabs.length, back.active, back.preview, where(back), trail(back)]).toEqual([1, preview, preview, 'a', '[a] b'])
    expect(where(run(back, { type: 'forward' }))).toBe('b')
  })
})

describe('checker findings: YAZ-3675 F1 F2, YAZ-3678 F4, YAZ-3662 F6 F6b', () => {
  it('YAZ-3675 F1: Back goes to the step\'s own tab, not to a bullet copy of the page; the copy keeps its zoom, and a drag keeps Forward', () => {
    let s = onA()
    const a = s.active!
    s = run(s, { type: 'open-zoom', id: a, zoom: 'day1:0', background: true }, { type: 'navigate', path: B })
    const copy = s.tabs.find((t) => t.id !== a)!.id
    const back = run(s, { type: 'back' })
    expect([back.active, where(back), tabById(back, copy)!.zoom, trail(back)]).toEqual([a, 'a', 'day1:0', '[a] b'])
    // The current step names the tab in front: an unrelated change adds no step and keeps Forward.
    const moved = run(back, { type: 'move', from: 0, to: 1 })
    expect([trail(moved), moved.history]).toEqual(['[a] b', back.history])
    expect(where(run(moved, { type: 'forward' }))).toBe('b')
  })

  it('YAZ-3675 F1: a step whose tab is gone shows in a tab of its page at that tab\'s own level, and the step then names that tab', () => {
    let w = onA()
    const a = w.active!
    w = run(w, { type: 'open-zoom', id: a, zoom: 'day1:0', background: true }, { type: 'navigate', path: B })
    const copy = w.tabs.find((t) => t.id !== a)!.id
    // A list with a step of a tab that is no more (no reducer path leaves one; the walk must still be safe).
    const odd: WorkspaceState = { ...w, history: { steps: [{ ...w.history.steps[0], tab: 'gone' }, w.history.steps[1]], index: 1 } }
    const back = run(odd, { type: 'back' })
    expect([back.active, where(back), back.history.steps[0].tab, back.history.steps[0].zoom]).toEqual([copy, 'a@day1:0', copy, 'day1:0'])
    expect(run(back, { type: 'move', from: 0, to: 1 }).history).toEqual(back.history)
  })

  it('YAZ-3675 F2: two steps that meet after a close keep the NEWER id, under which a code tab kept its place', () => {
    let s = onA()
    const a = s.active!
    s = run(s, { type: 'open-new', path: B })
    const b = s.active!
    s = run(s, { type: 'activate', id: a })
    const keptUnder = stepIdOf(s.history, a)
    s = run(s, { type: 'navigate', path: C }, { type: 'close', id: b }, { type: 'back' })
    expect([trail(s), stepIdOf(s.history, a)]).toEqual(['[a] c', keptUnder])
  })

  it('YAZ-3662 F6: a quiet new key for a bullet (its text changed) rewrites the old key in every step of that tab on that page', () => {
    let s = onA()
    const src = s.active!
    s = run(s, { type: 'zoom', id: src, zoom: 'lunch:1' }, { type: 'open-zoom', id: src, zoom: 'child:0' })
    // The 1 s report of the source page comes after the copy is in front.
    s = run(s, { type: 'zoom', id: src, zoom: 'dinner:0', quiet: true })
    expect(trail(s)).toBe('a a@dinner:0 [a@child:0]')
    const back = run(s, { type: 'back' })
    expect([back.active, tabById(back, src)!.zoom]).toEqual([src, 'dinner:0'])
    // Two steps of one tab at the same bullet: both take the new key. A step of another tab at that key keeps it.
    let t = onA()
    const id = t.active!
    t = run(t, { type: 'zoom', id, zoom: 'k:0' }, { type: 'open-new', path: B }, { type: 'activate', id }, { type: 'zoom', id, zoom: 'k2:0', quiet: true })
    expect(trail(t)).toBe('a a@k2:0 b [a@k2:0]')
  })

  it('YAZ-3662 F6b: a quiet report names the key it replaces (`from`): that key changes in the tab\'s steps of that page, and the tab follows only when it is still at that key', () => {
    let s = onA()
    const id = s.active!
    s = run(s, { type: 'zoom', id, zoom: 'l1:0' }, { type: 'zoom', id, zoom: 'l2:0' }, { type: 'back' })
    expect([where(s), trail(s)]).toEqual(['a@l1:0', 'a [a@l1:0] a@l2:0'])
    // The bullet of l2:0 was renamed just before Back: its report comes now, with the key it replaces.
    const late = run(s, { type: 'zoom', id, zoom: 'l2x:0', quiet: true, from: { path: A, key: 'l2:0' } })
    expect([where(late), trail(late)]).toEqual(['a@l1:0', 'a [a@l1:0] a@l2x:0'])
    expect(where(run(late, { type: 'forward' }))).toBe('a@l2x:0')
    // The tab still at that key takes the new key too.
    const at = run(s, { type: 'forward' }, { type: 'zoom', id, zoom: 'l2x:0', quiet: true, from: { path: A, key: 'l2:0' } })
    expect([where(at), trail(at)]).toEqual(['a@l2x:0', 'a a@l1:0 [a@l2x:0]'])
    // The tab shows another page now (the report came as A's page went): A's steps change, and the tab keeps its page.
    const away = run(at, { type: 'navigate', path: B }, { type: 'zoom', id, zoom: 'l1x:0', quiet: true, from: { path: A, key: 'l1:0' } })
    expect([where(away), trail(away)]).toEqual(['b', 'a a@l1x:0 a@l2x:0 [b]'])
  })

  it('YAZ-3678 F4: `go` takes a step id; a row whose step a close removed goes nowhere, and the others still find their step', () => {
    let s = run(onA(), { type: 'navigate', path: B }, { type: 'open-new', path: C }, { type: 'open-new', path: D })
    const [, toB, toC] = s.history.steps
    const closed = run(s, { type: 'close', id: idOf(s, C) })
    expect(run(closed, { type: 'go', id: toC.id })).toBe(closed)
    const there = run(closed, { type: 'go', id: toB.id })
    expect([where(there), trail(there)]).toEqual(['b', 'a [b] d'])
    s = run(s, { type: 'go', id: s.history.steps[s.history.index].id })
    expect(trail(s)).toBe('a b c [d]')
  })
})
