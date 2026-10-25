import { describe, expect, it, vi } from 'vitest'
import { DEFAULT_SIDEBAR_TABS, type SidebarTab, type SidebarTabsPrefs } from '@shared/types'
import type { MenuAction, MenuSection } from './menuSections'
import { fitCount, fitTabs, moveTab, rowLayout, sameTabRow, shownTabs, tabRowSections, toggleButton, toggleTab, type RowButtons } from './tabRow'

// Widths as the app draws them, each with the row's 2 px gap: Files a word, the five glyphs alike, Sort and fold 30 px.
const W: Record<SidebarTab, number> = { files: 49, search: 33, focus: 33, favorites: 33, sessions: 33, recents: 33 }
const widthOf = (tab: SidebarTab) => W[tab]
const TOOLS = 64
const MORE = 33
const BOTH: RowButtons = { sort: true, fold: true }
const NONE: RowButtons = { sort: false, fold: false }
const prefs = (over: Partial<SidebarTabsPrefs> = {}): SidebarTabsPrefs => ({ ...DEFAULT_SIDEBAR_TABS, ...over })
/** The row at a sidebar width: its content box (8 px padding each side) plus one gap. */
const at = (width: number, p = prefs(), lens: SidebarTab = 'files', buttons = BOTH) => {
  const fit = fitTabs(p, lens, widthOf, width - 16 + 2, buttons.sort || buttons.fold ? (buttons.sort && buttons.fold ? TOOLS : TOOLS / 2) : 0, MORE, buttons)
  return rowLayout(p, lens, fit, buttons)
}
const labels = (sections: MenuSection[]) => sections.filter((group) => group.length > 0).map((group) => group.map((item) => item.label))

describe('fitCount (YAZ-3273 D1)', () => {
  it('is the longest run from the left that fits beside the reserve; half a pixel of slack', () => {
    expect(fitCount([10, 10, 10], 30, 0)).toBe(3)
    expect(fitCount([10, 10, 10], 29, 0)).toBe(2)
    expect(fitCount([10, 10, 10], 29.5, 0)).toBe(3)
    expect(fitCount([10, 10, 10], 30, 15)).toBe(1)
    expect(fitCount([10, 50, 10], 40, 0)).toBe(1) // never skips a wide tab to fit a narrow one after it: the row's order holds
    expect(fitCount([10], 5, 10)).toBe(0)
    expect(fitCount([], 0, 0)).toBe(0)
  })
})

describe('fitTabs + rowLayout (YAZ-3273 D1 to D3, D7, D10)', () => {
  it('S1: a wide sidebar shows all six tabs and no ⋯', () => {
    expect(at(320)).toEqual({ row: ['files', 'search', 'focus', 'favorites', 'sessions', 'recents'], over: [], hidden: [], moreShows: false, moreLit: false })
  })

  it('S2, S4: narrow, the tabs leave from the right end in the row\'s order and ⋯ shows; wider, they come back in order', () => {
    expect(at(260)).toMatchObject({ row: ['files', 'search', 'focus', 'favorites'], over: ['sessions', 'recents'], moreShows: true })
    expect(at(230)).toMatchObject({ row: ['files', 'search', 'focus'], over: ['favorites', 'sessions', 'recents'] })
    expect(at(291)).toMatchObject({ row: ['files', 'search', 'focus', 'favorites'], over: ['sessions', 'recents'] }) // five tabs and ⋯ need as much room as six tabs
    expect(at(292).over).toEqual([])
  })

  it('S3: at 180 px Files, ⋯, Sort and fold fit, and the row\'s sum stays inside the sidebar', () => {
    const layout = at(180)
    expect(layout.row[0]).toBe('files')
    expect(layout.moreShows).toBe(true)
    const sum = layout.row.reduce((s, tab) => s + W[tab], 0) + MORE + TOOLS
    expect(sum).toBeLessThanOrEqual(180 - 16 + 2)
  })

  it('S5: the fit counts only the buttons that show — on Sessions, with no Sort and no fold, more tabs fit', () => {
    expect(at(260, prefs(), 'sessions', NONE).row).toHaveLength(6)
    expect(at(260, prefs(), 'files', BOTH).row).toHaveLength(4)
  })

  it('the ⋯ button takes room only when it shows: all six that fit without it keep the row whole', () => {
    // 49 + 5 × 33 + 64 = 278 px of content, one gap fewer than the items: a 292 px sidebar (the scoping's "about 290 px").
    expect(at(292)).toMatchObject({ over: [], moreShows: false })
    expect(at(291).over.length).toBeGreaterThan(0)
  })

  it('S6, S14: the open tab inside ⋯ (no room, or hidden) lights it, and the row does not move', () => {
    expect(at(260, prefs(), 'recents')).toMatchObject({ row: ['files', 'search', 'focus', 'favorites'], moreShows: true, moreLit: true })
    expect(at(320, prefs({ hidden: ['focus'] }), 'focus')).toMatchObject({ row: ['files', 'search', 'favorites', 'sessions', 'recents'], hidden: ['focus'], moreShows: true, moreLit: true })
    expect(at(260, prefs(), 'files').moreLit).toBe(false)
  })

  it('D2: a hidden tab, or a hidden Sort or fold that this tab would show, brings ⋯ when all tabs fit; a hidden Sort on a tab with no sort does not', () => {
    expect(at(400, prefs({ hidden: ['recents'] }))).toMatchObject({ row: ['files', 'search', 'focus', 'favorites', 'sessions'], hidden: ['recents'], over: [], moreShows: true })
    expect(at(400, prefs({ hiddenButtons: ['sort'] })).moreShows).toBe(true)
    expect(at(400, prefs({ hiddenButtons: ['fold'] }), 'search', { sort: false, fold: false }).moreShows).toBe(false)
    expect(at(400, prefs({ hiddenButtons: ['sort'] }), 'sessions', { sort: false, fold: true }).moreShows).toBe(false)
  })

  it('the reader\'s order is the row\'s order, and the tabs that leave are the last ones of it', () => {
    const order: SidebarTab[] = ['recents', 'files', 'favorites', 'search', 'focus', 'sessions']
    expect(at(230, prefs({ order }))).toMatchObject({ row: ['recents', 'files', 'favorites'], over: ['search', 'focus', 'sessions'] })
    expect(shownTabs(prefs({ order, hidden: ['favorites'] }))).toEqual(['recents', 'files', 'search', 'focus', 'sessions'])
  })

  it('D10, S24: with ⋯ off it never shows and keeps no room; a squeezed or hidden open tab takes the last place', () => {
    const off = prefs({ hiddenButtons: ['more'] })
    expect(at(260, off)).toMatchObject({ row: ['files', 'search', 'focus', 'favorites', 'sessions'], over: ['recents'], moreShows: false, moreLit: false }) // one more tab than with ⋯ on (S24)
    expect(at(260, off, 'recents')).toMatchObject({ row: ['files', 'search', 'focus', 'favorites', 'recents'], over: ['sessions'], moreShows: false })
    expect(at(400, prefs({ hiddenButtons: ['more'], hidden: ['focus'] }), 'focus')).toMatchObject({ row: ['files', 'search', 'favorites', 'sessions', 'recents', 'focus'], hidden: ['focus'], moreShows: false })
    // The open tab that is wider than the one it replaces still fits: the others make room for it.
    const filesLast = prefs({ hiddenButtons: ['more'], order: ['search', 'focus', 'favorites', 'sessions', 'recents', 'files'] })
    const layout = at(230, filesLast, 'files')
    expect(layout.row.at(-1)).toBe('files')
    expect(layout.row.reduce((s, tab) => s + W[tab], 0) + TOOLS).toBeLessThanOrEqual(230 - 16 + 2)
  })

  it('with no measure (Infinity, jsdom) every tab fits', () => {
    expect(rowLayout(prefs(), 'files', Number.POSITIVE_INFINITY, BOTH)).toMatchObject({ row: ['files', 'search', 'focus', 'favorites', 'sessions', 'recents'], moreShows: false })
    expect(rowLayout(prefs({ hiddenButtons: ['more'], hidden: ['search'] }), 'search', Number.POSITIVE_INFINITY, BOTH).row).toEqual(['files', 'focus', 'favorites', 'sessions', 'recents', 'search'])
  })
})

describe('tabRowSections (YAZ-3273 D4)', () => {
  const handlers = () => ({ onOpen: vi.fn(), onSort: vi.fn(), onFold: vi.fn() })

  it('S9, S11: the tabs with no room, then the hidden tabs, in the row\'s order, with no group names (the demo); a hidden tab says "hidden", the open tab "open"; empty groups do not show', () => {
    const p = prefs({ hidden: ['focus'] })
    const sections = tabRowSections(at(230, p, 'recents'), p, 'recents', BOTH, 'Collapse all', handlers())
    expect(labels(sections)).toEqual([['Sessions', 'Recents'], ['Focus']])
    const items = sections.flat() as MenuAction[]
    expect(items.find((item) => item.label === 'Focus')?.hint).toBe('hidden')
    expect(items.find((item) => item.label === 'Sessions')?.hint).toBeUndefined()
    expect(items.find((item) => item.label === 'Recents')?.hint).toBe('open')
    expect(labels(tabRowSections(at(400), prefs(), 'files', BOTH, 'Collapse all', handlers()))).toEqual([]) // nothing to list: no menu
  })

  it('S13: a click on a tab opens it', () => {
    const h = handlers()
    const p = prefs({ hidden: ['recents'] })
    const item = tabRowSections(at(400, p), p, 'files', BOTH, 'Collapse all', h).flat().find((i) => i.label === 'Recents') as MenuAction
    item.onSelect()
    expect(h.onOpen).toHaveBeenCalledExactlyOnceWith('recents')
  })

  it('S15, D9: a hidden Sort or fold that this tab shows is in the menu with its own action, the fold under its current label; "Edit tab row…" only with a handler', () => {
    const h = handlers()
    const p = prefs({ hiddenButtons: ['sort', 'fold'] })
    const sections = tabRowSections(at(400, p), p, 'files', BOTH, 'Expand all', h)
    expect(labels(sections)).toEqual([['Sort…', 'Expand all']])
    for (const item of sections.flat() as MenuAction[]) item.onSelect()
    expect([h.onSort.mock.calls.length, h.onFold.mock.calls.length]).toEqual([1, 1])
    expect(labels(tabRowSections(at(400, p, 'sessions', NONE), p, 'sessions', NONE, 'Collapse all', h))).toEqual([]) // Sessions shows neither (S5)
    expect(labels(tabRowSections(at(400, p), p, 'files', BOTH, 'Collapse all', { ...h, onEdit: () => {} })).at(-1)).toEqual(['Edit tab row…'])
  })
})

describe('the Hide row (YAZ-3279 D4, S9, S10)', () => {
  const handlers = () => ({ onHide: vi.fn(), onOpen: vi.fn(), onSort: vi.fn(), onFold: vi.fn(), onEdit: vi.fn() })

  it('a right-clicked tab puts "Hide <tab>" first; blank space and ⋯ (no tab) have none', () => {
    const h = handlers()
    const p = prefs({ hidden: ['recents'] })
    expect(labels(tabRowSections(at(400, p), p, 'files', BOTH, 'Collapse all', h, 'focus'))).toEqual([['Hide Focus'], ['Recents'], ['Edit tab row…']])
    expect(labels(tabRowSections(at(400, p), p, 'files', BOTH, 'Collapse all', h, null))).toEqual([['Recents'], ['Edit tab row…']])
    const hide = tabRowSections(at(400, p), p, 'files', BOTH, 'Collapse all', h, 'focus')[0][0] as MenuAction
    hide.onSelect()
    expect(h.onHide).toHaveBeenCalledExactlyOnceWith('focus')
  })

  it('S10: on Files it is off, with the hint "Files stays"', () => {
    const files = tabRowSections(at(400), prefs(), 'files', BOTH, 'Collapse all', handlers(), 'files')[0][0] as MenuAction
    expect([files.label, files.disabled, files.hint]).toEqual(['Hide Files', true, 'Files stays'])
  })

  it('a tab that is hidden already (the open tab with ⋯ off) has no Hide row', () => {
    const p = prefs({ hidden: ['focus'], hiddenButtons: ['more'] })
    expect(labels(tabRowSections(at(400, p, 'focus'), p, 'focus', BOTH, 'Collapse all', handlers(), 'focus'))[0]).toEqual(['Focus'])
  })
})

describe('moveTab, toggleTab, toggleButton (YAZ-3279 D5, D8, D9, D10)', () => {
  const ORDER: SidebarTab[] = ['files', 'search', 'focus', 'favorites', 'sessions', 'recents']

  it('moveTab moves one tab down or up and keeps every tab once; out of range or no move keeps the order', () => {
    expect(moveTab(ORDER, 1, 3)).toEqual(['files', 'focus', 'favorites', 'search', 'sessions', 'recents'])
    expect(moveTab(ORDER, 5, 0)).toEqual(['recents', 'files', 'search', 'focus', 'favorites', 'sessions'])
    expect(moveTab(ORDER, 0, 5)).toEqual(['search', 'focus', 'favorites', 'sessions', 'recents', 'files'])
    for (const [from, to] of [[2, 2], [-1, 2], [2, 6]]) expect(moveTab(ORDER, from, to)).toEqual(ORDER)
  })

  it('toggleTab hides and shows a tab, and never hides Files (D6, D8)', () => {
    expect(toggleTab(prefs(), 'focus').hidden).toEqual(['focus'])
    expect(toggleTab(prefs({ hidden: ['focus', 'recents'] }), 'focus').hidden).toEqual(['recents'])
    const p = prefs()
    expect(toggleTab(p, 'files')).toBe(p)
    expect(toggleTab(p, 'search').order).toBe(p.order) // the order is untouched
  })

  it('toggleButton takes Sort, fold or ⋯ off the bar and puts it back', () => {
    expect(toggleButton(prefs(), 'sort').hiddenButtons).toEqual(['sort'])
    expect(toggleButton(prefs({ hiddenButtons: ['sort', 'more'] }), 'more').hiddenButtons).toEqual(['sort'])
  })

  it('sameTabRow: the same order, and the same tabs and buttons off the bar in any order', () => {
    expect(sameTabRow(prefs({ hidden: ['focus', 'search'] }), prefs({ hidden: ['search', 'focus'] }))).toBe(true)
    expect(sameTabRow(prefs(), prefs({ order: moveTab(ORDER, 0, 1) }))).toBe(false)
    expect(sameTabRow(prefs(), prefs({ hiddenButtons: ['fold'] }))).toBe(false)
  })
})
