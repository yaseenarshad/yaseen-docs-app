import type { ReactNode } from 'react'
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
const moreOff = (prefs: SidebarTabsPrefs): boolean => prefs.hiddenButtons.includes('more')

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
  /** The shown tabs that have no room (D1): they left the row from its right end, in the row's order. The menu lists them first (D4). */
  over: SidebarTab[]
  /** The hidden tabs, in the row's order. The menu lists them after a line, each with the hint "hidden" (YAZ-3279). */
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

/** A copy of `order` with the tab at `from` moved to `to` (D5): the panel's drag. Out of range, or no move, gives a plain copy. */
export function moveTab(order: readonly SidebarTab[], from: number, to: number): SidebarTab[] {
  if (from === to || from < 0 || to < 0 || from >= order.length || to >= order.length) return [...order]
  const next = order.filter((_, i) => i !== from)
  next.splice(to, 0, order[from])
  return next
}

/** Show or hide a tab (D4, S18). Files never hides (D6, D8): `prefs` itself. A tab that shows again keeps its place in the order. */
export function toggleTab(prefs: SidebarTabsPrefs, tab: SidebarTab): SidebarTabsPrefs {
  if (tab === 'files') return prefs
  return { ...prefs, hidden: prefs.hidden.includes(tab) ? prefs.hidden.filter((t) => t !== tab) : [...prefs.hidden, tab] }
}

/** Put a button on the bar, or take it off (D9, D10, S23, S24). */
export function toggleButton(prefs: SidebarTabsPrefs, button: SidebarButton): SidebarTabsPrefs {
  return { ...prefs, hiddenButtons: prefs.hiddenButtons.includes(button) ? prefs.hiddenButtons.filter((b) => b !== button) : [...prefs.hiddenButtons, button] }
}

/** Two rows are the same: the same order, and the same tabs and buttons off the bar in any order. A change that changes nothing writes nothing. */
export function sameTabRow(a: SidebarTabsPrefs, b: SidebarTabsPrefs): boolean {
  const sameSet = <T,>(x: readonly T[], y: readonly T[]) => x.length === y.length && x.every((v) => y.includes(v))
  return a.order.length === b.order.length && a.order.every((tab, i) => tab === b.order[i]) && sameSet(a.hidden, b.hidden) && sameSet(a.hiddenButtons, b.hiddenButtons)
}

/** What the menu's rows do (D4): hide the right-clicked tab, open a tab, the hidden buttons' own actions, and the door to the Tab row panel. */
export interface TabRowHandlers {
  /** "Hide <tab>" (YAZ-3279 S9). */
  onHide: (tab: SidebarTab) => void
  onOpen: (tab: SidebarTab) => void
  /** "Sort…": the sort menu, at the ⋯ button (S15). */
  onSort: () => void
  /** "Collapse all" (or "Expand all"): what the fold button does. */
  onFold: () => void
  /** "Edit tab row…": the Tab row panel (YAZ-3279 S17). The menu always ends with it. */
  onEdit: () => void
  /** A row's glyph (YAZ-3279: a glyph on each row, so a tab is quick to find): a tab's, or a button's. */
  iconOf?: (key: SidebarTab | Exclude<SidebarButton, 'more'>) => ReactNode
}

/**
 * The menu of the row (D4, S9 to S13, S15) as `ContextMenu` sections: "Hide <tab>" when a tab was
 * right-clicked — off on Files, "Files stays" (S10) — then the tabs with no room, the hidden tabs,
 * the buttons that left the bar ("Sort…", the fold button's label), then "Edit tab row…". The ⋯
 * button and blank space open it without the Hide row (S11, S12). Empty groups do not show
 * (`ContextMenu` skips them).
 *
 * The menu has no group names (YAZ-3279): a line parts the tabs with no room from the hidden tabs,
 * a hidden tab has the hint "hidden", and the open tab has the hint "open", which wins.
 */
export function tabRowSections(layout: RowLayout, prefs: SidebarTabsPrefs, lens: SidebarTab, buttons: RowButtons, foldLabel: string, handlers: TabRowHandlers, tab: SidebarTab | null = null): MenuSection[] {
  // A tab that is hidden already (the open tab with ⋯ off, D10) has nothing to hide.
  const hide: MenuAction[] =
    tab === null || prefs.hidden.includes(tab)
      ? []
      : [{ id: 'tabrow-hide', label: `Hide ${TAB_LABEL[tab]}`, disabled: tab === 'files', hint: tab === 'files' ? 'Files stays' : undefined, onSelect: () => handlers.onHide(tab) }]
  const icon = handlers.iconOf
  const tabItem = (tab: SidebarTab, note?: string): MenuAction => ({ id: `tabrow-open-${tab}`, label: TAB_LABEL[tab], icon: icon?.(tab), hint: tab === lens ? 'open' : note, onSelect: () => handlers.onOpen(tab) })
  const over = layout.over.map((tab) => tabItem(tab))
  const hidden = layout.hidden.map((tab) => tabItem(tab, 'hidden'))
  const offBar: MenuAction[] = []
  if (buttons.sort && prefs.hiddenButtons.includes('sort')) offBar.push({ id: 'tabrow-sort', label: 'Sort…', icon: icon?.('sort'), onSelect: handlers.onSort })
  if (buttons.fold && prefs.hiddenButtons.includes('fold')) offBar.push({ id: 'tabrow-fold', label: foldLabel, icon: icon?.('fold'), onSelect: handlers.onFold })
  return [hide, over, hidden, offBar, [{ id: 'tabrow-edit', label: 'Edit tab row…', onSelect: handlers.onEdit }]]
}
