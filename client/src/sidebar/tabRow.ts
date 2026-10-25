import type { SidebarButton, SidebarTab, SidebarTabsPrefs } from '@shared/types'
import type { MenuAction, MenuSection } from './menuSections'

/**
 * The tab row's rules (YAZ-3273), PURE — no DOM: which tabs fit (D1), where the ⋯ button stands and
 * when it lights (D2, D3, D10), and the rows of its menu (D4). `SidebarTabs` measures and draws;
 * every rule it follows is here, so the rules test without a layout (jsdom has none).
 */

/** The tabs' copy; the default order is `SIDEBAR_TABS`' (YAZ-847, YAZ-2638 D2), and the reader's is `SidebarTabsPrefs.order` (YAZ-3273 D8). */
export const TAB_LABEL: Record<SidebarTab, string> = { files: 'Files', search: 'Search', focus: 'Focus', favorites: 'Favorites', sessions: 'Sessions', recents: 'Recents' }

/** Which of Sort and fold this tab shows today (YAZ-3227 D5, YAZ-862; S5): the fit counts only these, and the menu offers only these. */
export interface RowButtons {
  sort: boolean
  fold: boolean
}

/** The tabs of the row's order that are not hidden: the tabs the row tries to fit (D1). */
export const shownTabs = (prefs: SidebarTabsPrefs): SidebarTab[] => prefs.order.filter((tab) => !prefs.hidden.includes(tab))

/** The button is on the bar: it shows on this tab (S5), and the reader did not take it off (D9). */
export const onBar = (prefs: SidebarTabsPrefs, buttons: RowButtons, button: Exclude<SidebarButton, 'more'>): boolean => buttons[button] && !prefs.hiddenButtons.includes(button)

/** The ⋯ button is off (D10): it never shows, and the row keeps no room for it. */
export const moreOff = (prefs: SidebarTabsPrefs): boolean => prefs.hiddenButtons.includes('more')

/** Something lives in the ⋯ menu whatever the width (D2): a hidden tab, or a hidden button this tab would show. */
const moreAnyway = (prefs: SidebarTabsPrefs, buttons: RowButtons): boolean =>
  prefs.hidden.length > 0 || (buttons.sort && prefs.hiddenButtons.includes('sort')) || (buttons.fold && prefs.hiddenButtons.includes('fold'))

/**
 * How many tabs fit (D1): the longest run from the left whose widths, beside `reserve` px of
 * buttons, stay inside `avail` px. Each width carries the row's gap, and so does `reserve`; half a
 * pixel of slack keeps a rounding error from pushing out a tab that fits.
 */
export function fitCount(widths: readonly number[], avail: number, reserve: number): number {
  let used = reserve
  for (let n = 0; n < widths.length; n++) {
    used += widths[n]
    if (used > avail + 0.5) return n
  }
  return widths.length
}

/**
 * The fit of the row (D1, D2, D10, S2 to S5) from the measured widths: `widthOf` a tab's, `tools`
 * the buttons on the bar (Sort, fold) and `more` the ⋯ button's. The ⋯ button takes room only when
 * it shows: when something is hidden, or when a tab does not fit without it. With ⋯ off, the open
 * tab always joins the row, at its last place (D3's exception): then the answer counts the OTHER
 * tabs that fit beside it — `rowLayout` reads it the same way.
 */
export function fitTabs(prefs: SidebarTabsPrefs, lens: SidebarTab, widthOf: (tab: SidebarTab) => number, avail: number, tools: number, more: number, buttons: RowButtons): number {
  const shown = shownTabs(prefs)
  const widths = shown.map(widthOf)
  if (moreOff(prefs)) {
    const n = fitCount(widths, avail, tools)
    if (shown.slice(0, n).includes(lens)) return n
    return fitCount(shown.filter((tab) => tab !== lens).map(widthOf), avail, tools + widthOf(lens))
  }
  const anyway = moreAnyway(prefs, buttons)
  const n = fitCount(widths, avail, tools + (anyway ? more : 0))
  return n < shown.length && !anyway ? fitCount(widths, avail, tools + more) : n
}

/** What the row draws (D1 to D3, D10): its tabs, the tabs that have no room, and the ⋯ button's two states. */
export interface RowLayout {
  /** The tabs on the bar, left to right. */
  row: SidebarTab[]
  /** "Not enough room" (D4): the shown tabs that left the row from its right end, in the row's order. */
  over: SidebarTab[]
  /** "Hidden" (D4): the hidden tabs, in the row's order. */
  hidden: SidebarTab[]
  /** The ⋯ button shows (D2): something is not on the bar, and the reader did not turn it off (D10). */
  moreShows: boolean
  /** The open tab is inside ⋯ (D3): the button wears the accent underline. */
  moreLit: boolean
}

/**
 * The row for `fit` tabs (`fitTabs`; `Infinity` with no measure — jsdom — where everything fits).
 * The tabs in the row never move for the open tab (D3), except with ⋯ off: then the open tab takes
 * the last place when it is hidden or has no room (D10, S24).
 */
export function rowLayout(prefs: SidebarTabsPrefs, lens: SidebarTab, fit: number, buttons: RowButtons): RowLayout {
  const shown = shownTabs(prefs)
  let row = shown.slice(0, fit)
  if (moreOff(prefs) && !row.includes(lens)) row = [...shown.filter((tab) => tab !== lens).slice(0, fit), lens]
  const over = shown.filter((tab) => !row.includes(tab))
  const hidden = prefs.order.filter((tab) => prefs.hidden.includes(tab))
  const moreShows = !moreOff(prefs) && (over.length > 0 || moreAnyway(prefs, buttons))
  return { row, over, hidden, moreShows, moreLit: moreShows && !row.includes(lens) }
}

/** What the menu's rows do (D4): open a tab, the hidden buttons' own actions, and the door to the Tab row panel. */
export interface TabRowHandlers {
  onOpen: (tab: SidebarTab) => void
  /** "Sort…": the sort menu, at the ⋯ button (S15). */
  onSort: () => void
  /** "Collapse all" (or "Expand all"): what the fold button does. */
  onFold: () => void
  /** "Edit tab row…": the Tab row panel (YAZ-3279). Absent, the menu has no such row. */
  onEdit?: () => void
}

/** A group's name (D4): an item that is off, so `ContextMenu` draws it muted and a click does nothing (the Decision on YAZ-3278). */
const heading = (id: string, label: string): MenuAction => ({ id, label, disabled: true, onSelect: () => {} })

/**
 * The menu of the row (D4, S9 to S13, S15) as `ContextMenu` sections: "Not enough room", "Hidden",
 * the buttons that left the bar ("Sort…", the fold button's label), then "Edit tab row…". The ⋯
 * button and blank space open the same one. Empty groups do not show (`ContextMenu` skips them).
 * The open tab says so in its hint, as in the lab.
 */
export function tabRowSections(layout: RowLayout, prefs: SidebarTabsPrefs, lens: SidebarTab, buttons: RowButtons, foldLabel: string, handlers: TabRowHandlers): MenuSection[] {
  const tabItem = (tab: SidebarTab): MenuAction => ({ id: `tabrow-open-${tab}`, label: TAB_LABEL[tab], hint: tab === lens ? 'open' : undefined, onSelect: () => handlers.onOpen(tab) })
  const over = layout.over.length > 0 ? [heading('tabrow-over', 'Not enough room'), ...layout.over.map(tabItem)] : []
  const hidden = layout.hidden.length > 0 ? [heading('tabrow-hidden', 'Hidden'), ...layout.hidden.map(tabItem)] : []
  const offBar: MenuAction[] = []
  if (buttons.sort && prefs.hiddenButtons.includes('sort')) offBar.push({ id: 'tabrow-sort', label: 'Sort…', onSelect: handlers.onSort })
  if (buttons.fold && prefs.hiddenButtons.includes('fold')) offBar.push({ id: 'tabrow-fold', label: foldLabel, onSelect: handlers.onFold })
  const edit = handlers.onEdit === undefined ? [] : [{ id: 'tabrow-edit', label: 'Edit tab row…', onSelect: handlers.onEdit }]
  return [over, hidden, offBar, edit]
}
