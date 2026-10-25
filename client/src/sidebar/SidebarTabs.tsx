import { memo, useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { SidebarTab, SidebarTabsPrefs } from '@shared/types'
import { ChevronsIcon, FolderIcon, MoreIcon, SortIcon } from '../views/view/icons'
import { ContextMenu } from './ContextMenu'
import { TabFace, TabRowPanel } from './TabRowPanel'
import { fitTabs, onBar, rowLayout, TAB_LABEL, tabRowSections, toggleTab, type RowButtons } from './tabRow'

/**
 * The button that stands for the tab that shows: its tab, or the lit ⋯ button when the tab is inside
 * it (YAZ-3273 D3). ↑ from the first row and from the search bar go here (YAZ-2663 D12).
 */
export const ACTIVE_TAB_SELECTOR = '.sidebar__lens--active, .sidebar__more--lit'

interface SidebarTabsProps {
  /** The tab that shows (🔒 D4, YAZ-847): App's. */
  lens: SidebarTab
  onLensChange: (lens: SidebarTab) => void
  /** The reader's row (YAZ-3273 D8). Sidebar keeps its identity while its value stays, so this memo draws nothing again on a broadcast. */
  prefs: SidebarTabsPrefs
  /** A new row, from "Hide <tab>" or the Tab row panel (YAZ-3279): one settings write per change. */
  onChangePrefs: (next: SidebarTabsPrefs) => void
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

/** A glyph for a row of the menu: a tab's (Files' folder, since its tab is a word), Sort's or the fold button's. */
const menuIcon = (key: SidebarTab | 'sort' | 'fold') => (key === 'sort' ? <SortIcon /> : key === 'fold' ? <ChevronsIcon /> : key === 'files' ? <FolderIcon /> : <TabFace tab={key} />)

/** Where the focus goes back to when the menu or the panel closes: the ⋯ button, a tab, or (null) the tab that shows. */
type FocusBack = 'more' | SidebarTab | null

/** The row's menu (D4): where it opens, the tab right-clicked (null: the ⋯ button or blank space), and whether a key opened it. */
interface RowMenu {
  x: number
  y: number
  tab: SidebarTab | null
  fromMore: boolean
  keyboard: boolean
  /** The button that opened it. */
  back: FocusBack
}

/** The context-menu key, or Shift+F10: the keyboard's right-click. */
const isMenuKey = (e: { key: string; shiftKey: boolean; metaKey: boolean; ctrlKey: boolean; altKey: boolean }) => e.key === 'ContextMenu' || (e.key === 'F10' && e.shiftKey && !e.metaKey && !e.ctrlKey && !e.altKey)

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
export const SidebarTabs = memo(function SidebarTabs({ lens, onLensChange, prefs, onChangePrefs, sortShows, sortOpen, onSort, foldShows, foldLabel, onFold }: SidebarTabsProps) {
  const buttons: RowButtons = { sort: sortShows, fold: foldShows }
  const [fit, setFit] = useState(Number.POSITIVE_INFINITY)
  const layout = rowLayout(prefs, lens, fit, buttons)
  const [menu, setMenu] = useState<RowMenu | null>(null)
  /** The Tab row panel (YAZ-3279 D4, S17): where the menu was, the tab right-clicked, and whether a key opened the menu. */
  const [panel, setPanel] = useState<{ x: number; y: number; focus: SidebarTab | null; keyboard: boolean; back: FocusBack } | null>(null)
  // "Edit tab row…" hands the focus to the panel, not back to ⋯.
  const toPanel = useRef(false)
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

  // The focus back on the row once the menu or the panel is gone (the Decision and the Nit on YAZ-3278, YAZ-3279):
  // after the render, so a tab that "Hide" took off the bar, or a ⋯ that the panel took away, falls back to the tab that shows.
  const refocus = useRef<FocusBack | undefined>(undefined)
  useLayoutEffect(() => {
    const back = refocus.current
    if (back === undefined || menu !== null || panel !== null) return
    refocus.current = undefined
    const row = rowRef.current
    const button = back === 'more' ? moreRef.current : back === null ? null : row?.querySelector<HTMLElement>(`[data-tab="${back}"]`)
    ;(button ?? row?.querySelector<HTMLElement>(ACTIVE_TAB_SELECTOR))?.focus()
  }, [menu, panel])

  const openMenu = useRef(menu)
  openMenu.current = menu
  const closeMenu = useCallback(() => {
    // A key opened it: the focus goes back to the button that opened it ("Edit tab row…" hands it to the panel).
    const m = openMenu.current
    if (!toPanel.current && m?.keyboard === true) refocus.current = m.back
    toPanel.current = false
    setMenu(null)
  }, [])

  const openPanel = useRef(panel)
  openPanel.current = panel
  const closePanel = useCallback(() => {
    // The panel took the focus, or nothing holds it: it goes back to ⋯ or the right-clicked tab, else the tab that shows.
    // A press outside on something that takes the focus still moves it there, after this.
    const active = document.activeElement
    if (active === null || active === document.body || active.closest('.tab-row-panel') !== null) refocus.current = openPanel.current?.back ?? null
    setPanel(null)
  }, [])

  const anchor = (): { x: number; y: number } | null => {
    const r = moreRef.current?.getBoundingClientRect()
    return r === undefined ? null : { x: r.left, y: r.bottom + 4 }
  }
  // The menu's rows, live while it stands: a resize or a tab switch redraws them.
  const sectionsAt = ({ tab, keyboard, back, ...at }: RowMenu) =>
    tabRowSections(
      layout,
      prefs,
      lens,
      buttons,
      foldLabel,
      {
        // "Hide <tab>" (S9, S14): the tab goes into ⋯; the open one stays open, and ⋯ lights.
        onHide: (hidden) => onChangePrefs(toggleTab(prefs, hidden)),
        onOpen: onLensChange,
        // "Sort…" opens the sort menu at the ⋯ button (S15); with ⋯ off, where the menu was.
        onSort: () => onSort(anchor() ?? at),
        onFold,
        iconOf: menuIcon,
        // "Edit tab row…" opens the panel where the menu was, the right-clicked tab lit (S17).
        onEdit: () => {
          toPanel.current = true
          setPanel({ x: at.x, y: at.y, focus: tab, keyboard, back })
        },
      },
      tab,
    )

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
        // to no page from here. The ⋯ button is the walk's end past the last tab (YAZ-3300): ↑ from the
        // search bar lands on it when it is lit, so ← goes to the last tab, → stays, ↑ has nowhere to go,
        // and ↓ is the window's, as on the tab that shows.
        onKeyDown={(e) => {
          const on = e.target instanceof HTMLElement ? e.target : null
          const tab = on?.matches('.sidebar__lens') === true ? on : null
          const onMore = on !== null && on === moreRef.current
          if (tab === null && !onMore) return
          // The context-menu key or Shift+F10 on a tab or on ⋯: the row's menu, as a right-click, with the focus on its first item.
          if (isMenuKey(e)) {
            e.preventDefault()
            const r = on!.getBoundingClientRect()
            const at = (tab?.dataset.tab as SidebarTab | undefined) ?? null
            setMenu({ x: r.left, y: r.bottom + 4, tab: at, fromMore: false, keyboard: true, back: onMore ? 'more' : at })
            return
          }
          if (e.metaKey || e.ctrlKey || e.altKey || e.shiftKey) return
          if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
            const tabs = [...e.currentTarget.querySelectorAll<HTMLElement>('.sidebar__lens')]
            if (tab !== null) tabs[tabs.indexOf(tab) + (e.key === 'ArrowRight' ? 1 : -1)]?.focus()
            else if (e.key === 'ArrowLeft') tabs.at(-1)?.focus()
          } else if (e.key === 'ArrowDown' && tab !== null && tab.getAttribute('aria-selected') !== 'true') tab.click()
          else if (e.key !== 'ArrowUp') return
          e.preventDefault()
        }}
        // Right-click on a tab (S9) or on blank space in the row (S11): the row's menu. It always has "Edit tab row…".
        onContextMenu={(e) => {
          e.preventDefault()
          const button = e.target instanceof Element ? e.target.closest<HTMLElement>('[data-tab], .sidebar__more') : null
          const tab = (button?.dataset.tab as SidebarTab | undefined) ?? null
          // A `contextmenu` from the keyboard has no pointer type (Chromium): the menu then opens below the button, from a key.
          const keyboard = (e.nativeEvent as Partial<PointerEvent>).pointerType === ''
          const r = keyboard ? button?.getBoundingClientRect() : undefined
          setMenu({ x: r?.left ?? e.clientX, y: r === undefined ? e.clientY : r.bottom + 4, tab, fromMore: false, keyboard, back: button === null ? null : button === moreRef.current ? 'more' : tab })
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
              setMenu({ x: r.left, y: r.bottom + 4, tab: null, fromMore: true, keyboard: e.detail === 0, back: 'more' })
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
      {panel !== null && <TabRowPanel x={panel.x} y={panel.y} prefs={prefs} focus={panel.focus} autoFocus={panel.keyboard} onChange={onChangePrefs} onClose={closePanel} />}
    </>
  )
})
