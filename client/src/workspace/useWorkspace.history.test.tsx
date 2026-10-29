/**
 * Per-tab back/forward history (YAZ-721, ruling D1): a side table on `TabsState`, keyed by tab id (YAZ-2940 D1),
 * renderer-only and session-only. These tests are the contract; the reducer must satisfy
 * them without changing the existing main-tab reducer expectations beyond `history: {}`.
 */
import { describe, expect, it } from 'vitest'
import { pathTabsReducer, plain, type PathTabs } from './testTabs'

// Read by path (`testTabs.ts`): with no copies, a path names one tab, and the stacks are keyed by tab id (YAZ-2940 D1).
const tabsReducer = pathTabsReducer
type TabsState = PathTabs

const A = '/v/a.md'
const B = '/v/b.md'
const C = '/v/c.md'
const D = '/v/d.md'

// Same-tab navigation is a link inside a page (`navigate`, YAZ-2648 D3): the sidebar's click goes to the preview tab.
const nav = (s: TabsState, path: string): TabsState => tabsReducer(s, { type: 'navigate', path })
const fresh = (): TabsState => nav({ tabs: [], active: null, mounted: [], history: {}, preview: null, blank: false }, A)
/** A → B → C in one tab. */
const abc = (): TabsState => nav(nav(fresh(), B), C)

describe('history recording', () => {
  it('same-tab navigation pushes and re-keys the record under the new path', () => {
    const s = abc()
    expect(s.tabs).toEqual([C])
    expect(s.history).toEqual({ [C]: { entries: [A, B, C], index: 2 } })
  })

  it('navigating after going back discards the forward stack', () => {
    const s = nav(tabsReducer(abc(), { type: 'back' }), D)
    expect(s.active).toBe(D)
    expect(s.history).toEqual({ [D]: { entries: [A, B, D], index: 2 } })
  })

  // YAZ-3609 D10 (B1) replaces YAZ-721's "records nothing": with nothing recorded, Back could not return.
  it('a link to a page another tab shows goes to that tab, and Back there returns to the page with the link', () => {
    const two = tabsReducer(abc(), { type: 'open-background', path: D })
    const s = nav(two, D)
    expect(s.active).toBe(D)
    expect(s.history).toEqual({ ...two.history, [D]: { entries: [C, D], index: 1 } })
    const back = tabsReducer(s, { type: 'back' })
    expect(back.active).toBe(C)
    expect(back.tabs).toEqual([C, D])
    expect(back.history[C]).toEqual(two.history[C]) // the first tab's own stack is untouched
  })

  // YAZ-3644: D10 for the other two places a link opens, "A new tab" and a background tab (the setting, and ⌘-click).
  it.each([
    ['a new tab', 'open-new' as const],
    ['a background tab', 'open-background' as const],
  ])('a link opened in %s has the page with the link before its own: Back goes to that tab', (_name, type) => {
    const opened = tabsReducer(abc(), { type, path: D, link: true })
    const s = type === 'open-new' ? opened : tabsReducer(opened, { type: 'activate', path: D })
    expect(s.history[D]).toEqual({ entries: [C, D], index: 1 })
    const back = tabsReducer(s, { type: 'back' })
    expect(back.active).toBe(C)
    expect(back.tabs).toEqual([C, D])
  })

  it('a new tab opened from a link to a page another tab shows goes to that tab, as a click does (D10)', () => {
    const two = tabsReducer(abc(), { type: 'open-background', path: D })
    const s = tabsReducer(two, { type: 'open-new', path: D, link: true })
    expect(s.active).toBe(D)
    expect(s.history[D]).toEqual({ entries: [C, D], index: 1 })
  })

  it('a tab opened with no link (the sidebar, ⌘T) still starts with no record', () => {
    expect(tabsReducer(abc(), { type: 'open-new', path: D }).history[D]).toBeUndefined()
    expect(tabsReducer(abc(), { type: 'open-background', path: D }).history[D]).toBeUndefined()
  })

  it('B2: with the tab of the link closed, Back opens the page with the link in this tab', () => {
    const s = tabsReducer(nav(tabsReducer(abc(), { type: 'open-background', path: D }), D), { type: 'close', path: C })
    const back = tabsReducer(s, { type: 'back' })
    expect(back.tabs).toEqual([C])
    expect(back.active).toBe(C)
  })

  it('a tab opened without navigating has no record until it navigates', () => {
    const s = tabsReducer(fresh(), { type: 'open-new', path: B })
    expect(s.history).toEqual({})
    const moved = nav(s, C)
    expect(moved.history).toEqual({ [C]: { entries: [B, C], index: 1 } })
  })
})

describe('back / forward', () => {
  it('back swaps the previous page into the same slot and keeps the forward entries', () => {
    const s = tabsReducer(abc(), { type: 'back' })
    expect(s.tabs).toEqual([B])
    expect(s.active).toBe(B)
    expect(s.mounted).toEqual([B])
    expect(s.history).toEqual({ [B]: { entries: [A, B, C], index: 1 } })
  })

  it('forward after back returns to the later page', () => {
    const s = tabsReducer(tabsReducer(abc(), { type: 'back' }), { type: 'forward' })
    expect(s.active).toBe(C)
    expect(s.history).toEqual({ [C]: { entries: [A, B, C], index: 2 } })
  })

  it('back at the start and forward at the end return the SAME state object', () => {
    const start = tabsReducer(tabsReducer(abc(), { type: 'back' }), { type: 'back' })
    expect(tabsReducer(start, { type: 'back' })).toBe(start)
    const end = abc()
    expect(tabsReducer(end, { type: 'forward' })).toBe(end)
  })

  it('with no active tab or no record, back and forward are no-ops', () => {
    const empty: TabsState = { tabs: [], active: null, mounted: [], history: {}, preview: null, blank: false }
    expect(tabsReducer(empty, { type: 'back' })).toBe(empty)
    const noRecord: TabsState = { tabs: [A], active: A, mounted: [A], history: {}, preview: null, blank: false }
    expect(tabsReducer(noRecord, { type: 'forward' })).toBe(noRecord)
  })

  it('back to a page that is open in ANOTHER tab activates that tab; both histories untouched', () => {
    const s = tabsReducer(abc(), { type: 'open-background', path: B })
    const next = tabsReducer(s, { type: 'back' })
    expect(next.tabs).toEqual([C, B])
    expect(next.active).toBe(B)
    expect(next.history).toEqual(s.history)
  })

  it('operates on the active tab only: the other tab keeps its own record', () => {
    const s = nav(tabsReducer(abc(), { type: 'open-new', path: D }), B)
    // tab 1: [A,B,C] at C · tab 2: [D,B] at B
    const back = tabsReducer(s, { type: 'back' })
    expect(back.tabs).toEqual([C, D])
    expect(back.history).toEqual({ [C]: { entries: [A, B, C], index: 2 }, [D]: { entries: [D, B], index: 0 } })
  })
})

describe('history consistency through rename, delete, close', () => {
  it('rename remaps both the key and every entry', () => {
    const s = tabsReducer(abc(), { type: 'rename', oldPath: C, newPath: D })
    expect(s.history).toEqual({ [D]: { entries: [A, B, D], index: 2 } })
    const mid = tabsReducer(abc(), { type: 'rename', oldPath: B, newPath: D })
    expect(mid.history).toEqual({ [C]: { entries: [A, D, C], index: 2 } })
  })

  it('rename-dir remaps by prefix inside entries', () => {
    const s = tabsReducer(abc(), { type: 'rename-dir', oldPath: '/v', newPath: '/w' })
    expect(s.history).toEqual({ '/w/c.md': { entries: ['/w/a.md', '/w/b.md', '/w/c.md'], index: 2 } })
  })

  it('delete prunes the path from every surviving record and clamps the index', () => {
    const two = tabsReducer(abc(), { type: 'open-background', path: D })
    const s = tabsReducer(two, { type: 'delete', path: B })
    expect(s.tabs).toEqual([C, D])
    expect(s.history).toEqual({ [C]: { entries: [A, C], index: 1 } })
    const backed = tabsReducer(tabsReducer(abc(), { type: 'back' }), { type: 'back' }) // at A, idx 0
    const pruned = tabsReducer(backed, { type: 'delete', path: C })
    expect(pruned.history).toEqual({ [A]: { entries: [A, B], index: 0 } })
  })

  it('deleting the active page drops its record; the heir keeps its own', () => {
    const two = nav(tabsReducer(abc(), { type: 'open-new', path: D }), B) // tab2 [D,B] at B
    const s = tabsReducer(two, { type: 'delete', path: B })
    expect(s.active).toBe(C)
    expect(s.history).toEqual({ [C]: { entries: [A, C], index: 1 } })
  })

  it('delete-dir prunes every path under the folder from a surviving tab that is NOT under it', () => {
    const s = nav(abc(), '/x/z.md') // [A,B,C,/x/z.md] at z
    const pruned = tabsReducer(s, { type: 'delete-dir', path: '/v' })
    expect(pruned.tabs).toEqual(['/x/z.md'])
    expect(pruned.history).toEqual({ '/x/z.md': { entries: ['/x/z.md'], index: 0 } })
  })

  it('close drops the record of the closed tab only', () => {
    const two = nav(tabsReducer(abc(), { type: 'open-new', path: D }), B)
    const s = tabsReducer(two, { type: 'close', path: B })
    expect(s.history).toEqual({ [C]: { entries: [A, B, C], index: 2 } })
  })

  it('reset empties history', () => {
    const s = tabsReducer(abc(), { type: 'reset', tabs: plain(A, B), active: A })
    expect(s.history).toEqual({})
  })
})
