import { memo, useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { SidebarTab, SidebarTabsPrefs } from '@shared/types'
import { ChevronsIcon, ClockIcon, EyeIcon, HeartIcon, MoreIcon, SearchIcon, SortIcon, StackIcon } from '../views/view/icons'
import { ContextMenu } from './ContextMenu'
import { fitTabs, onBar, rowLayout, TAB_LABEL, tabRowSections, type RowButtons } from './tabRow'

/**
 * The button that stands for the tab that shows: its tab, or the lit ⋯ button when the tab is inside
 * it (YAZ-3273 D3). ↑ from the first row and from the search bar go here (YAZ-2663 D12).
 */
export const ACTIVE_TAB_SELECTOR = '.sidebar__lens--active, .sidebar__more--lit'

/** A tab's face: Files is a word (D6); the others are glyphs (YAZ-2638 D2, YAZ-2619 D4, YAZ-1766 D1, YAZ-3147 D4, YAZ-3235 D4). */
function TabFace({ tab }: { tab: SidebarTab }) {
  return tab === 'favorites' ? <HeartIcon /> : tab === 'focus' ? <EyeIcon /> : tab === 'search' ? <SearchIcon /> : tab === 'sessions' ? <StackIcon /> : tab === 'recents' ? <ClockIcon /> : <>{TAB_LABEL[tab]}</>
}

interface SidebarTabsProps {
  /** The tab that shows (🔒 D4, YAZ-847): App's. */
  lens: SidebarTab
  onLensChange: (lens: SidebarTab) => void
  /** The reader's row (YAZ-3273 D8). Sidebar keeps its identity while its value stays, so this memo draws nothing again on a broadcast. */
  prefs: SidebarTabsPrefs
  /** The sort button shows on this tab (YAZ-3227 D5: Files, Focus and Favorites), and whether its menu is open. */
  sortShows: boolean
  sortOpen: boolean
  /** The sort menu at a point — from the Sort button, or from "Sort…" in the ⋯ menu (S15) — or `null` to close it. */
  onSort: (at: { x: number; y: number } | null) => void
  /** The fold button shows (YAZ-862: not on Search, and only with something to fold), its label, and its action. */
  foldShows: boolean
  foldLabel: string
  onFold: () => void
}

/** The row's menu (D4): where it opens, the tab right-clicked (null: the ⋯ button or blank space), and whether a key opened it. */
interface RowMenu {
  x: number
  y: number
  tab: SidebarTab | null
  fromMore: boolean
  keyboard: boolean
}

/**
 * The tab row (🔒 D4, YAZ-847; YAZ-2638 D2; YAZ-3273), chrome v2 ROW 1: the tabs in the reader's
 * order, the ⋯ button, then Sort and fold pinned at the right end (D7). The tabs that do not fit
 * leave the row from its right end into ⋯ (D1), so the row never spills over the editor, never
 * wraps and never scrolls. `role="tab"` + `aria-selected` only — no `aria-controls`/`tabpanel`:
 * the one body below is every tab's.
 *
 * The fit is measured (S8): a `ResizeObserver` on the row and on its buttons, each tab's width kept
 * from the last time it was on the bar. The state is the COUNT that fits, so a sidebar drag draws
 * the row again only when a tab comes or goes (S30). With no observer, or no layout (jsdom), nothing
 * is measured and every tab fits.
 */
export const SidebarTabs = memo(function SidebarTabs({ lens, onLensChange, prefs, sortShows, sortOpen, onSort, foldShows, foldLabel, onFold }: SidebarTabsProps) {
  const buttons: RowButtons = { sort: sortShows, fold: foldShows }
  const [fit, setFit] = useState(Number.POSITIVE_INFINITY)
  const layout = rowLayout(prefs, lens, fit, buttons)
  const [menu, setMenu] = useState<RowMenu | null>(null)
  const rowRef = useRef<HTMLDivElement>(null)
  const moreRef = useRef<HTMLButtonElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)
  // Each tab's width (and the ⋯ button's, as 'more'), from the last time it was on the bar.
  const widths = useRef(new Map<string, number>())
  const latest = useRef({ prefs, lens, buttons })
  latest.current = { prefs, lens, buttons }

  const measure = useCallback(() => {
    const row = rowRef.current
    // A row with no width has no layout (jsdom, or not on screen): nothing to measure, and every tab fits.
    if (row === null || row.clientWidth === 0) return
    const css = getComputedStyle(row)
    const gap = parseFloat(css.columnGap) || 0
    // The row's last item has no gap after it: one more gap of room squares the sum.
    const avail = row.clientWidth - (parseFloat(css.paddingLeft) || 0) - (parseFloat(css.paddingRight) || 0) + gap
    for (const el of row.querySelectorAll<HTMLElement>('[data-tab]')) widths.current.set(el.dataset.tab!, el.getBoundingClientRect().width)
    if (moreRef.current !== null) widths.current.set('more', moreRef.current.getBoundingClientRect().width)
    const tools = [...row.querySelectorAll<HTMLElement>('.sidebar__sort, .sidebar__expand-all')].reduce((sum, el) => sum + el.getBoundingClientRect().width + gap, 0)
    const glyph = Math.max(0, ...[...widths.current].filter(([key]) => key !== 'files' && key !== 'more').map(([, w]) => w))
    // A tab never on the bar yet: a glyph is as wide as the glyphs seen, Files as a short word.
    const widthOf = (tab: SidebarTab) => (widths.current.get(tab) ?? (tab === 'files' ? 48 : glyph || 32)) + gap
    const more = (widths.current.get('more') ?? (glyph || 32)) + gap
    const { prefs: p, lens: l, buttons: b } = latest.current
    setFit(fitTabs(p, l, widthOf, avail, tools, more, b))
  }, [])

  // Measure again whenever what the row holds changes; before paint, so a tab never flashes past the edge.
  useLayoutEffect(() => {
    if (typeof ResizeObserver !== 'undefined') measure()
  }, [measure, prefs, lens, sortShows, foldShows, fit])

  // The width of the sidebar (App's drag writes it between renders, YAZ-2239), and of each button.
  useEffect(() => {
    const row = rowRef.current
    if (row === null || typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(() => measure())
    observer.observe(row)
    for (const el of row.children) observer.observe(el)
    return () => observer.disconnect()
  }, [measure, layout.row.join(), layout.moreShows, sortShows, foldShows])

  // The menu from the keyboard (the Finding on YAZ-3278): `ContextMenu` has no ↑ ↓ walk, so the row adds
  // one while its menu is open — ahead of every other key listener, so the window's arrows-from-nowhere
  // (YAZ-2663 D10) and the tabs' own walk do not also act. A key open puts the focus on the first item.
  const keyboardOpen = menu?.keyboard === true
  useEffect(() => {
    if (menu === null) return
    const items = () => [...(menuRef.current?.querySelectorAll<HTMLButtonElement>('.ctx-menu__item:not(:disabled)') ?? [])]
    if (keyboardOpen) items()[0]?.focus()
    const onKey = (e: KeyboardEvent): void => {
      if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp' && e.key !== 'Home' && e.key !== 'End' && e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return
      const all = items()
      // ← and → have nothing to do in a menu with no flyout: taken, so they do not move the focus to the page or to a tab.
      if (all.length === 0 || e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
        e.preventDefault()
        e.stopPropagation()
        return
      }
      const at = all.indexOf(document.activeElement as HTMLButtonElement)
      const next = e.key === 'Home' ? 0 : e.key === 'End' ? all.length - 1 : at === -1 ? (e.key === 'ArrowDown' ? 0 : all.length - 1) : Math.min(all.length - 1, Math.max(0, at + (e.key === 'ArrowDown' ? 1 : -1)))
      all[next].focus()
      e.preventDefault()
      e.stopPropagation()
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [menu, keyboardOpen])

  const openMenu = useRef(menu)
  openMenu.current = menu
  const closeMenu = useCallback(() => {
    // A key opened it from ⋯: the focus goes back to that button.
    if (openMenu.current?.keyboard === true && openMenu.current.fromMore) moreRef.current?.focus()
    setMenu(null)
  }, [])

  const anchor = (): { x: number; y: number } | null => {
    const r = moreRef.current?.getBoundingClientRect()
    return r === undefined ? null : { x: r.left, y: r.bottom + 4 }
  }
  // The menu's rows, live while it stands: a resize or a tab switch redraws them.
  const sectionsAt = (at: { x: number; y: number }) =>
    tabRowSections(layout, prefs, lens, buttons, foldLabel, {
      onOpen: onLensChange,
      // "Sort…" opens the sort menu at the ⋯ button (S15); with ⋯ off, where the menu was.
      onSort: () => onSort(anchor() ?? at),
      onFold,
    })

  return (
    <>
      <div
        ref={rowRef}
        className="sidebar__lenses"
        role="tablist"
        aria-label="Sidebar lens"
        // The tabs from the keyboard (YAZ-2663 D12): ← and → move between the tab buttons ON THE BAR
        // and stop at both ends; Enter shows the tab (the button's own click), and ↓ on a tab that does
        // not show asks for it too. ↓ on the tab that shows goes into its rows, or into the search bar:
        // that is the window's listener in Sidebar. ↑ has nowhere to go. The keys are taken, so → goes
        // to no page from here.
        onKeyDown={(e) => {
          const tab = e.target instanceof HTMLElement && e.target.matches('.sidebar__lens') ? e.target : null
          if (tab === null || e.metaKey || e.ctrlKey || e.altKey || e.shiftKey) return
          if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
            const tabs = [...e.currentTarget.querySelectorAll<HTMLElement>('.sidebar__lens')]
            tabs[tabs.indexOf(tab) + (e.key === 'ArrowRight' ? 1 : -1)]?.focus()
          } else if (e.key === 'ArrowDown' && tab.getAttribute('aria-selected') !== 'true') tab.click()
          else if (e.key !== 'ArrowUp') return
          e.preventDefault()
        }}
        // Right-click on a tab or on blank space in the row (D4, S11): the row's menu. Nothing in it, no menu.
        onContextMenu={(e) => {
          e.preventDefault()
          const tab = e.target instanceof Element ? (e.target.closest<HTMLElement>('[data-tab]')?.dataset.tab as SidebarTab | undefined) : undefined
          const at = { x: e.clientX, y: e.clientY }
          if (sectionsAt(at).some((group) => group.length > 0)) setMenu({ ...at, tab: tab ?? null, fromMore: false, keyboard: false })
        }}
      >
        {layout.row.map((id) => (
          <button
            key={id}
            type="button"
            role="tab"
            data-tab={id}
            aria-selected={lens === id}
            className={`sidebar__lens${id !== 'files' ? ' sidebar__lens--glyph' : ''}${lens === id ? ' sidebar__lens--active' : ''}`}
            onClick={() => onLensChange(id)}
            // The glyphs' label lives in `title` + `aria-label`; Files keeps its word (D6).
            title={id !== 'files' ? TAB_LABEL[id] : undefined}
            aria-label={id !== 'files' ? TAB_LABEL[id] : undefined}
          >
            <TabFace tab={id} />
          </button>
        ))}
        {/* "More tabs" (D2): right of the last tab, left of Sort, only when something is not on the bar.
            Lit like an active tab when the tab that shows is inside it (D3). A second click closes its
            menu: the menu's overlay takes that press. */}
        {layout.moreShows && (
          <button
            ref={moreRef}
            type="button"
            className={`sidebar__more${layout.moreLit ? ' sidebar__more--lit' : ''}`}
            aria-label="More tabs"
            title="More tabs"
            aria-haspopup="menu"
            aria-expanded={menu?.fromMore === true}
            onMouseDown={(e) => e.stopPropagation()}
            onClick={(e) => {
              if (menu?.fromMore === true) return closeMenu()
              const r = e.currentTarget.getBoundingClientRect()
              // `detail` is 0 for Enter or Space: a key opened it (S16).
              setMenu({ x: r.left, y: r.bottom + 4, tab: null, fromMore: true, keyboard: e.detail === 0 })
            }}
          >
            <MoreIcon />
          </button>
        )}
        {/* The sort button (YAZ-3227 D5): left of expand-all, on Files, Focus and Favorites. A second click closes its menu. */}
        {onBar(prefs, buttons, 'sort') && (
          <button
            type="button"
            className="sidebar__sort"
            aria-label="Sort"
            title="Sort"
            aria-haspopup="menu"
            aria-expanded={sortOpen}
            // The menu closes on any window mousedown; without this a second click would close and reopen it (the vault header's rule).
            onMouseDown={(e) => e.stopPropagation()}
            onClick={(e) => {
              const r = e.currentTarget.getBoundingClientRect()
              onSort(sortOpen ? null : { x: r.left, y: r.bottom + 4 })
            }}
          >
            <SortIcon />
          </button>
        )}
        {/* One button for both directions AND every lens (⚡ YAZ-862, ⚡ YAZ-873): anything open
            collapses everything, and only a fully closed tree expands it. It acts on whichever lens is
            ACTIVE. Gone — not disabled — on the Search tab (YAZ-2638 D2: its folds are the search's
            own) and whenever the active reading has nothing to unfold. Sidebar decides; this draws. */}
        {onBar(prefs, buttons, 'fold') && (
          <button type="button" className="sidebar__expand-all" aria-label={foldLabel} title={foldLabel} onClick={onFold}>
            <ChevronsIcon />
          </button>
        )}
      </div>
      {menu !== null && (
        <div ref={menuRef} className="sidebar__tabs-menu">
          <ContextMenu x={menu.x} y={menu.y} sections={sectionsAt(menu)} onClose={closeMenu} />
        </div>
      )}
    </>
  )
})
