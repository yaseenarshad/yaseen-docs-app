import { useEffect, useRef, useState, type CSSProperties, type DragEvent } from 'react'
import { titleWithKey, type HotkeyOverrides } from '@shared/hotkeyBindings'
import { rootOfPath, type DiagramDarkColors, type TabRef } from '@shared/types'
import { ContextMenuSurface } from '../components/ContextMenuSurface'
import { dropIndex, insertionSlot } from '../lib/dragSlot'
import { pageLabel, useFolderPaths, type PathTitles } from '../lib/pageLabel'
import { FileIcon, NameEnding } from '../sidebar/FileIcon'
import { GridIcon, PlusIcon, SidebarPanelIcon } from '../views/view/icons'
import { foreignDrag, readPageDrag, writePageDrag, type PageDrag } from '../workspace/pageDrag'
import type { Tab } from '../workspace/useWorkspace'
import type { ListState } from '../lists/useVaultListsHere'
import { TabMenu, type MoveTarget, type TabMenuAt } from './TabMenu'
import { TabNameField } from './TabNameField'
import { useBoardHighlight } from './boardHighlight'
import { CardPreviewHost, useCardPreview, type PreviewScope } from './cardPreview'
import './tabs.css'

export interface TabBarProps {
  /** The vaults of the window (YAZ-2602): the Files tree of the vault that holds a tab says whether it is a folder (YAZ-2290). */
  roots: readonly string[]
  /** This window's id (YAZ-3637 D1): a drag names the window it left, so another window's strip knows it is not its own. */
  windowId: string
  /** Open tabs, left→right. Two tabs may show one path (YAZ-2940 D1): keys and lookups use the id, labels and file calls the path. */
  tabs: readonly Tab[]
  /** The active tab's id (its path is the window's `file`); null with no tabs open. */
  active: string | null
  /** The preview tab's id (YAZ-2648 D1), or null: its label is italic until the tab is kept. */
  preview?: string | null
  /**
   * The blank tab shows (YAZ-2655 D10): "New tab", after the last tab, and the active one — no tab
   * of `tabs` is, whatever `active` says. It is no file: it does not drag and has no menu.
   */
  blank?: boolean
  /** ⌘T's button, the "+" after the tabs: App shows the blank tab and puts the caret in the search bar. Absent on a mount with no blank tab. */
  onNewTab?: () => void
  /** The blank tab's ✕ and a middle click on it: it closes alone. */
  onCloseBlank?: () => void
  /** The right panel is closed, and its "Show right panel" button floats over the row's end: the row keeps that room free (YAZ-2656 S93). */
  reserveEnd?: boolean
  /** A tab, by id. */
  onActivate: (id: string) => void
  /** A double click on a tab (YAZ-2648 D2), by id: the preview tab becomes a kept tab; any other tab is one already. The same double click opens the name's field (YAZ-3059). */
  onKeep?: (id: string) => void
  /** A tab's ✕ or middle click, by id: that tab alone, a copy too. */
  onClose: (id: string) => void
  /** Drag-to-reorder (I3, GRO-2235): the tab at `from` lands at final index `to`. */
  onMove: (from: number, to: number) => void
  /** A validated page dropped from the right panel at a tab insertion slot. */
  onDropPage?: (page: PageDrag, at: number) => void
  /**
   * Whether this window takes a tab of ANOTHER window's drag (YAZ-3637 D6): the window it comes from and the index of
   * the page's vault there — all a drag shows while it passes over. False: no gap, the drop is not taken.
   */
  canTake?: (from: string, root: number) => boolean
  /** Another window's tab dropped here (YAZ-3637 D4): the window `from`, its tab by ref, and the slot it lands in. */
  onDropFromWindow?: (from: string, ref: TabRef, at: number) => void
  /** A tab let go where no surface took it (YAZ-3637 D1, D3): off every window, or on one that refused it; `point` is on the screen. */
  onTearOff?: (path: string, id: string, point: { x: number; y: number }) => void
  /** Context-menu equivalent of dragging this tab into the right panel. */
  onMoveToRight?: (path: string) => void
  /** The menu's "Move to new window" (YAZ-2933): this tab, alone in a window of its own — its page, and its id to close it here. */
  onMoveToNewWindow?: (path: string, id: string) => void
  /** The other windows that can take a tab of `path` (YAZ-3091 D2): asked only while a tab menu is open, for its "Move to ▸". */
  onMoveTargets?: (path: string) => readonly MoveTarget[]
  /** "Move to ▸ <window>" (YAZ-3091 D1): the page by path to the open window `to`; only this tab (by id) closes here. */
  onMoveToWindow?: (to: string, path: string, id: string) => void
  /** "Move to ▸": the window a row points at glows (YAZ-3091 D8). */
  onHighlightWindow?: (to: string | null) => void
  /** "Duplicate tab" (YAZ-2940 D5): a copy of the tab, by id. */
  onDuplicate?: (id: string) => void
  /** "Set display name" / "Reset to page name" (YAZ-2949): a name for the tab, by id, or null for its page name. */
  onSetName?: (id: string, name: string | null) => void
  /** History (YAZ-721): the active tab's own back/forward stack has somewhere to go. */
  canBack: boolean
  canForward: boolean
  onBack: () => void
  onForward: () => void
  /**
   * Collapsed sidebar (YAZ-1759): the reopen control sits HERE, left of ◀, instead of floating
   * over it. Absent while the sidebar is open.
   */
  onShowSidebar?: () => void
  /** Reveal this exact tab in the sidebar without activating it. */
  onShowInSidebar?: (path: string) => void
  /**
   * The tab overview's button (YAZ-2648 D8), right of ▶: it opens the overview, and closes it again.
   * Absent on a mount with no overview.
   */
  onToggleOverview?: () => void
  /** Whether the overview shows: the button's one state. */
  overviewOpen?: boolean
  /** The grid button's right-click menu (YAZ-2739): "Kill all tabs". App asks first. Absent, the button has no menu. */
  onKillAll?: () => void
  /** The same menu's two saves (YAZ-3147 D5): "Save tabs as session" (`false`) and "Save and close all tabs" (`true`). App saves, then closes all tabs for `true`. */
  onSaveSession?: (closeAll: boolean) => void
  /**
   * Where a failed OS action says so (YAZ-963) — App's passive notice. Optional: a mount with
   * nowhere to show one loses the message, never the gesture.
   */
  onNotice?: (message: string) => void
  /** The window's titles (YAZ-2420 🔒 D14): a tab is labelled with its page's title. */
  titles: PathTitles
  /**
   * The review toggle (YAZ-2322), the sidebar row's item on a tab: whether a path is in review —
   * null for anything that is not a note in the index — and the write. App's, like the row's.
   */
  reviewState?: (path: string) => boolean | null
  onSetReview?: (path: string, on: boolean) => void
  /**
   * Focus and Favorites on a tab (YAZ-3264 D2), the sidebar row's items: where a path stands in the
   * two lists — null hides both items — and the two toggles. App's lists (D1), so they work with the
   * sidebar hidden; a toggle only toasts (D3).
   */
  listState?: (path: string) => ListState | null
  onToggleFocus?: (paths: string[], isOn: boolean) => void
  onToggleFavorite?: (paths: string[], isOn: boolean) => void
  /** Settings › Preview on hover › Tabs (YAZ-3403): resting on a tab that is not on show opens the sidebar's panel below it. */
  hoverPreview?: boolean
  /** What the hover panel needs of a tab's vault: App's `boardPreviewScope`. No scope, no hover panel. */
  previewScope?: (path: string) => PreviewScope
  diagramDarkColors?: DiagramDarkColors
  /** `settings.hotkeys` (YAZ-3397 D2): the "+" and the grid button name their keys as they are now (YAZ-3410). Absent = the defaults. */
  hotkeys?: HotkeyOverrides
}

/** How long a tab slides open or shut, in ms (YAZ-2656 D12). The row hands it to the stylesheet as `--tab-slide-ms`, so the slide and the ghost's timer take the same time. */
const SLIDE_MS = 150
const SLIDE = { '--tab-slide-ms': `${SLIDE_MS}ms` } as CSSProperties

/** A tab that closed, for as long as it slides shut: its label, and the id of the tab it stood before (null: the end). */
interface Ghost {
  key: number
  label: string
  before: string | null
}

/** In-flight drag state: the grabbed tab's index + the hovered insertion slot (0…tabs.length). */
interface DragState {
  from: number
  over: number | null
}

const Chevron = ({ d }: { d: string }) => (
  <svg width={14} height={14} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth={1.2} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
    <path d={d} />
  </svg>
)

/**
 * The window tab strip (Tabs I2/I3, GRO-2234/2235): each tab keyed by its own id, since two tabs
 * may show one file (YAZ-2940 D1) — ViewTabs' tablist
 * semantics (role=tab, aria-selected). The tabs are pills (YAZ-2656 R40, R41): each has a fill of
 * its own, the active one the brightest, and none joins the page. Labels hide the extension of a note,
 * a drawing and a diagram (YAZ-3536 D1); other files keep theirs, a folder's is its whole name (YAZ-2290) and
 * every full path lives in the title tooltip. Tabs reorder by HTML5 drag (the
 * groupDrag idiom: `dataTransfer` guarded — jsdom's synthetic drags have none), the other tabs
 * moving apart at the drop slot; the strip scrolls when full and keeps the ACTIVE tab in view. A
 * tab that joins or leaves the strip slides open or shut. Left of
 * the strip sit the ◀ ▶ history buttons (YAZ-721), disabled when the active tab's stack has
 * nowhere to go — buttons only, per LOCKED ruling D2: no shortcut, no menu item. Right of them
 * the grid button shows every open tab at once (YAZ-2648 D8), and its right-click menu has one
 * item, "Kill all tabs" (YAZ-2739), which App answers with a sheet. The ONE preview tab (YAZ-2648 D1)
 * wears an italic label; a double click on it keeps it. A double click on any tab also turns its
 * name into the "Set display name" field (YAZ-3059). After the tabs a "+" shows the blank tab
 * (YAZ-2655): it stands outside the scroller, so it is on show however far the strip scrolled.
 * Presentational only — all durable state changes go through workspace callbacks.
 */
export function TabBar({ roots, windowId, tabs, active, preview = null, blank = false, onNewTab, onCloseBlank, reserveEnd = false, onActivate, onKeep, onClose, onMove, onDropPage, canTake, onDropFromWindow, onTearOff, onMoveToRight, onMoveToNewWindow, onMoveTargets, onMoveToWindow, onHighlightWindow, onDuplicate, onSetName, canBack, canForward, onBack, onForward, onShowSidebar, onShowInSidebar, onToggleOverview, overviewOpen = false, onKillAll, onSaveSession, onNotice, titles, reviewState, onSetReview, listState, onToggleFocus, onToggleFavorite, hotkeys = {}, hoverPreview = false, previewScope, diagramDarkColors = 'adapt' }: TabBarProps) {
  const [drag, setDrag] = useState<DragState | null>(null)
  const [externalOver, setExternalOver] = useState<number | null>(null)
  // Right-click menu (YAZ-922): the tab IS the file, so it offers the sidebar row's Copy path —
  // and since YAZ-963 that row's OS actions too (Reveal in Finder, Open in VS Code). The items are
  // `TabMenu`'s, which the board's pages open too (YAZ-2648). The note's review state (YAZ-2322)
  // is read when the menu opens, so the review item is about the tab that was right-clicked; a
  // null state hides it. Focus and Favorites (YAZ-3264 D2) are read the same way.
  const [menu, setMenu] = useState<TabMenuAt | null>(null)
  /** The tab whose name is a field (YAZ-2949 D4), by id, or null. */
  const [renaming, setRenaming] = useState<string | null>(null)
  /** The grid button's own menu (YAZ-2739), and where it stands. */
  const [gridMenu, setGridMenu] = useState<{ x: number; y: number } | null>(null)
  const activeRef = useRef<HTMLDivElement | null>(null)
  // The page the tab board highlights (YAZ-2648): its tab is lit, and brought into view like the active one.
  const lit = useBoardHighlight()
  const litRef = useRef<HTMLDivElement | null>(null)
  useEffect(() => {
    if (lit !== null) litRef.current?.scrollIntoView?.({ block: 'nearest', inline: 'nearest' })
  }, [lit])
  const isFolder = useFolderPaths(roots)
  const labelOf = (path: string): string => pageLabel(path, isFolder(path), titles)
  // The hover panel (YAZ-3403): the sidebar's own panel below a tab that is not on show, after the sidebar's dwell. Its
  // dwell lives in a tiny store, so a pointer crossing tabs draws no strip. A click, a right-click, a drag, a key, the
  // wheel and a scroll close it in the hook (each drag and menu starts with a press). Here: a new tab on show, a rename
  // (one that a command starts has no press), and the hovered tab gone (another window closed it: no `mouseleave`).
  const stripRef = useRef<HTMLDivElement | null>(null)
  const tabPreview = useCardPreview(hoverPreview, (id) => stripRef.current?.querySelector<HTMLElement>(`[data-tab="${CSS.escape(id)}"]`) ?? null)
  const closeTabPreview = tabPreview.close
  useEffect(() => closeTabPreview(), [active, blank, renaming, closeTabPreview])
  const tabStore = tabPreview.store
  useEffect(() => {
    const { id } = tabStore.getState()
    if (id !== null && !tabs.some((t) => t.id === id)) closeTabPreview()
  }, [tabs, tabStore, closeTabPreview])
  const previewTab = (id: string): { root: string | null; name: string } | null => {
    const tab = tabs.find((t) => t.id === id)
    return tab === undefined ? null : { root: rootOfPath(roots, tab.path), name: tab.name ?? labelOf(tab.path) }
  }

  // Overflow polish (I3): tabs shrink to a floor and the strip scrolls, so scroll the active
  // tab fully into view on every activation. jsdom has no scrollIntoView — hence the `?.()`.
  useEffect(() => {
    activeRef.current?.scrollIntoView?.({ block: 'nearest', inline: 'nearest' })
  }, [active, blank])

  // THE SLIDE (YAZ-2656 D12, S88). A tab that JOINS the strip slides open: the count grew, and the
  // tab is not the page that filled the blank tab, which stood there already. A page that takes a
  // tab's place — the preview tab's next page, a rename — keeps that tab's id and its room, and
  // does not slide. The class stays on the tab for as long as it stands, so no render in the
  // middle of the slide cuts it; CSS runs it once. A tab that LEAVES is gone from `tabs` at once,
  // so a ghost of it — a label, nothing to act on — slides shut where it stood and is dropped
  // after. All of it is this component's own: no editor renders for a slide.
  const last = useRef({ tabs, blank })
  const slidIn = useRef(new Set<string>())
  const [ghosts, setGhosts] = useState<Ghost[]>([])
  const ghostKey = useRef(0)
  const timers = useRef(new Set<ReturnType<typeof setTimeout>>())
  if (tabs.length > last.current.tabs.length && !(last.current.blank && !blank)) {
    for (const tab of tabs) if (!last.current.tabs.some((t) => t.id === tab.id)) slidIn.current.add(tab.id)
  }
  useEffect(() => {
    const was = last.current
    last.current = { tabs, blank }
    const open = new Set(tabs.map((t) => t.id))
    for (const id of slidIn.current) if (!open.has(id)) slidIn.current.delete(id)
    // With no motion asked for — and where there is no `matchMedia` to ask — nothing slides shut.
    if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches !== false) return
    const gone: Ghost[] = []
    if (tabs.length < was.tabs.length) {
      was.tabs.forEach((tab, i) => {
        if (!open.has(tab.id)) gone.push({ key: ++ghostKey.current, label: labelOf(tab.path), before: was.tabs.slice(i + 1).find((next) => open.has(next.id))?.id ?? null })
      })
    }
    // The blank tab that went unused; one that a page filled is that page's tab now.
    if (was.blank && !blank && tabs.length === was.tabs.length) gone.push({ key: ++ghostKey.current, label: 'New tab', before: null })
    if (gone.length === 0) return
    setGhosts((now) => [...now, ...gone])
    const timer = setTimeout(() => {
      timers.current.delete(timer)
      setGhosts((now) => now.filter((ghost) => !gone.includes(ghost)))
    }, SLIDE_MS)
    timers.current.add(timer)
    // `labelOf` reads the newest titles; the tabs and the blank tab are what a slide follows.
  }, [tabs, blank])
  useEffect(() => {
    const pending = timers.current
    return () => pending.forEach(clearTimeout)
  }, [])
  const ghostsBefore = (id: string | null) =>
    ghosts
      .filter((ghost) => ghost.before === id)
      .map((ghost) => (
        <div key={`ghost:${ghost.key}`} className="tabbar__tab tabbar__tab--out" aria-hidden>
          <span className="tabbar__btn">
            <span className="tabbar__label">{ghost.label}</span>
          </span>
        </div>
      ))
  useEffect(() => {
    if (externalOver === null) return
    const clear = () => setExternalOver(null)
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') clear()
    }
    window.addEventListener('dragend', clear)
    window.addEventListener('drop', clear)
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('dragend', clear)
      window.removeEventListener('drop', clear)
      window.removeEventListener('keydown', onKey)
    }
  }, [externalOver])

  const drop = (insertion: number): void => {
    if (drag === null) return
    setDrag(null)
    const to = dropIndex(drag.from, insertion)
    if (to !== drag.from) onMove(drag.from, to)
  }

  const externalPage = (event: DragEvent): PageDrag | null => {
    if (drag !== null || onDropPage === undefined || event.dataTransfer === null) return null
    // Another window's drag (YAZ-3637 D1) is `foreignTab`'s, never a right-panel page of this one.
    if (foreignDrag(event.dataTransfer, windowId) !== null) return null
    const page = readPageDrag(event.dataTransfer)
    return page?.owner === 'right' && !tabs.some((t) => t.path === page.path) ? page : null
  }

  // A tab of ANOTHER window passing over (YAZ-3637 D1, D6): known by its type names alone — Chromium hides the data until
  // the drop — and taken only when this window shows the page's vault (`canTake`). No door, no take.
  const foreignTab = (event: DragEvent): boolean => {
    if (drag !== null || onDropFromWindow === undefined || event.dataTransfer === null) return false
    const foreign = foreignDrag(event.dataTransfer, windowId)
    return foreign !== null && canTake?.(foreign.from, foreign.root) === true
  }

  const dropExternal = (event: DragEvent, insertion: number): void => {
    setExternalOver(null)
    if (foreignTab(event)) {
      // On the drop the data is readable (YAZ-3637 D4): the page, and which copy of it the other window's strip holds.
      const page = event.dataTransfer === null ? null : readPageDrag(event.dataTransfer)
      if (page === null || page.owner !== 'main') return
      event.preventDefault()
      onDropFromWindow?.(page.from, { path: page.path, copy: page.copy }, insertion)
      return
    }
    const page = externalPage(event)
    if (page === null) return
    event.preventDefault()
    onDropPage?.(page, insertion)
  }

  // The end slot, twice: the tablist's own padding, and the row's tail after the "+" — the room a
  // drag reaches when it goes past the last tab. Direct hits only: a tab marks its own hover.
  const endSlot = {
    onDragOver: (e: DragEvent<HTMLElement>) => {
      if (e.target !== e.currentTarget) return
      if (drag !== null) {
        e.preventDefault()
        if (drag.over !== tabs.length) setDrag({ ...drag, over: tabs.length })
        return
      }
      if (externalPage(e) === null && !foreignTab(e)) return
      e.preventDefault()
      if (e.dataTransfer) e.dataTransfer.dropEffect = 'move'
      if (externalOver !== tabs.length) setExternalOver(tabs.length)
    },
    onDrop: (e: DragEvent<HTMLElement>) => {
      if (e.target !== e.currentTarget) return
      if (drag !== null) {
        e.preventDefault()
        drop(tabs.length)
      } else dropExternal(e, tabs.length)
    },
    onDragLeave: (e: DragEvent<HTMLElement>) => {
      if (e.target === e.currentTarget && !e.currentTarget.contains(e.relatedTarget as Node | null)) setExternalOver(null)
    },
  }
  // Where the tabs part (YAZ-2656 S89): the slot a drop would land in — and none where a drop
  // would leave the grabbed tab in its place, on either side of it.
  const over = drag?.over ?? externalOver
  const gap = over === null || (drag !== null && (over === drag.from || over === drag.from + 1)) ? null : over

  return (
    <div className={`tabbar-row${reserveEnd ? ' tabbar-row--end' : ''}`} style={SLIDE}>
      <div className="tabbar-nav">
        {onShowSidebar && (
          <button type="button" className="tabbar-nav__btn" aria-label="Show sidebar" title="Show sidebar" onClick={onShowSidebar}>
            <SidebarPanelIcon />
          </button>
        )}
        <button type="button" className="tabbar-nav__btn" aria-label="Back" title="Back" disabled={!canBack} onClick={onBack}>
          <Chevron d="m10 4-4 4 4 4" />
        </button>
        <button type="button" className="tabbar-nav__btn" aria-label="Forward" title="Forward" disabled={!canForward} onClick={onForward}>
          <Chevron d="m6 4 4 4-4 4" />
        </button>
        {onToggleOverview && (
          <button
            type="button"
            className="tabbar-nav__btn"
            aria-label="Show all open tabs"
            title={titleWithKey('Show all open tabs', 'tabOverview', hotkeys)}
            aria-pressed={overviewOpen}
            onClick={onToggleOverview}
            // The right press that opens the menu leaves the keyboard focus where it is — under the board, in its filter box.
            onMouseDown={(e) => {
              if (e.button === 2 && onKillAll !== undefined) e.preventDefault()
            }}
            onContextMenu={(e) => {
              if (onKillAll === undefined) return
              e.preventDefault()
              setGridMenu({ x: e.clientX, y: e.clientY })
            }}
          >
            <GridIcon />
          </button>
        )}
      </div>
      <div
        ref={stripRef}
        className={`tabbar scroll-strip${externalOver === 0 && tabs.length === 0 ? ' tabbar--drop-empty' : ''}`}
        role="tablist"
        aria-label="Open files"
        {...endSlot}
      >
        {/* ONE keyed list, ghosts and tabs: a tab that closes or moves builds no other tab again. */}
        {tabs.flatMap(({ id, path, name }, i) => {
          // Under the blank tab no tab of the strip is the active one (YAZ-2655).
          const isActive = !blank && id === active
          // A display name stands in for the page name (YAZ-2949 D5); every file call still takes the path.
          const label = name ?? labelOf(path)
          const cls = ['tabbar__tab']
          if (isActive) cls.push('tabbar__tab--active')
          if (id === preview) cls.push('tabbar__tab--preview')
          if (id === renaming) cls.push('tabbar__tab--renaming')
          if (id === lit) cls.push('tabbar__tab--lit')
          if (slidIn.current.has(id)) cls.push('tabbar__tab--in')
          if (drag !== null && drag.from === i) cls.push('tabbar__tab--dragging')
          // The drop slot: the tab the drop would land before gives way — or the LAST tab, for the end slot.
          if (gap === i) cls.push('tabbar__tab--gap-before')
          if (gap === tabs.length && i === tabs.length - 1) cls.push('tabbar__tab--gap-after')
          return [
            ...ghostsBefore(id),
            <div
              key={id}
              data-tab={id}
              ref={(node) => {
                if (isActive) activeRef.current = node
                if (id === lit) litRef.current = node
              }}
              className={cls.join(' ')}
              // A tab whose name is a field does not drag (YAZ-2949 S9): a press in the field places the caret.
              draggable={id !== renaming}
              onMouseEnter={isActive || id === renaming ? undefined : () => tabPreview.hoverCard(id, path)}
              onMouseLeave={() => tabPreview.leaveCard(id)}
              onDragStart={(e) => {
                if (e.dataTransfer) {
                  // Which copy of the page this tab is (YAZ-3637 D1): the ref another window sends back for it, and the
                  // index of its vault here, for `canTake` there. A page in no vault (-1) no other window takes.
                  const root = rootOfPath(roots, path)
                  writePageDrag(e.dataTransfer, { path, owner: 'main', from: windowId, copy: tabs.slice(0, i).filter((t) => t.path === path).length }, root === null ? -1 : roots.indexOf(root))
                }
                setExternalOver(null)
                setDrag({ from: i, over: null })
              }}
              onDragEnd={(e) => {
                // No surface took the drop (YAZ-3637 D1, D3): the tab was let go off every window, or on one that refused
                // it. Main tells the two apart by the point; the Mac drew the tab's picture (D7).
                if (e.dataTransfer?.dropEffect === 'none') onTearOff?.(path, id, { x: e.screenX, y: e.screenY })
                setDrag(null)
                setExternalOver(null)
              }}
              onDragOver={(e) => {
                const over = insertionSlot(e, i)
                if (drag !== null) {
                  e.preventDefault()
                  if (e.dataTransfer) e.dataTransfer.dropEffect = 'move'
                  if (drag.over !== over) setDrag({ ...drag, over })
                  return
                }
                if (externalPage(e) === null && !foreignTab(e)) return
                e.preventDefault()
                if (e.dataTransfer) e.dataTransfer.dropEffect = 'move'
                if (externalOver !== over) setExternalOver(over)
              }}
              onDrop={(e) => {
                const at = insertionSlot(e, i)
                if (drag !== null) {
                  e.preventDefault()
                  drop(at)
                } else dropExternal(e, at)
              }}
              onContextMenu={(e) => {
                // A right-click in the name's field is the field's own (YAZ-2949): no tab menu over it.
                if (id === renaming) return
                e.preventDefault()
                setMenu({ x: e.clientX, y: e.clientY, id, path, review: reviewState?.(path) ?? null, named: name !== undefined, lists: listState?.(path) ?? null })
              }}
            >
              {id === renaming ? (
                <TabNameField className="tabbar__rename" label={label} pageName={labelOf(path)} onCommit={(next) => onSetName?.(id, next)} onDone={() => setRenaming(null)} />
              ) : (
              <button
                type="button"
                role="tab"
                className="tabbar__btn"
                aria-selected={isActive}
                // A display name hides the page's own name, so the tooltip gives it back (YAZ-2949 D5, S11).
                title={name === undefined ? path : `${labelOf(path)}\n${path}`}
                onClick={() => onActivate(id)}
                // A double click keeps the preview tab (YAZ-2648 S20) and opens the name's field, as "Set display name" does (YAZ-3059 D1).
                onDoubleClick={() => {
                  onKeep?.(id)
                  if (onSetName !== undefined) setRenaming(id)
                }}
                onAuxClick={(e) => {
                  // Middle-click closes — the browser-tab convention.
                  if (e.button === 1) onClose(id)
                }}
              >
                {/* The file's icon, as its tree row has it (YAZ-3440 D11): a folder page's is the folder's, and a display name keeps the file's. */}
                <span className="tabbar__label">
                  <FileIcon path={path} folder={isFolder(path)} />
                  {label}
                  {/* A display name is the user's own words, and a folder page is named whole (YAZ-3536 D4). */}
                  {name === undefined && !isFolder(path) && <NameEnding path={path} />}
                </span>
              </button>
              )}
              <button type="button" className="tabbar__close" aria-label={`Close ${label}`} title={`Close ${label}`} onClick={() => onClose(id)}>
                ✕
              </button>
            </div>,
          ]
        })}
        {ghostsBefore(null)}
        {/* The blank tab (YAZ-2655 D10): no file, so no drag, no menu and no tooltip. Its ✕ and a middle click close it alone. */}
        {blank && (
          <div ref={activeRef} className="tabbar__tab tabbar__tab--active tabbar__tab--in">
            <button
              type="button"
              role="tab"
              className="tabbar__btn"
              aria-selected
              onAuxClick={(e) => {
                if (e.button === 1) onCloseBlank?.()
              }}
            >
              <span className="tabbar__label">New tab</span>
            </button>
            <button type="button" className="tabbar__close" aria-label="Close New tab" title="Close New tab" onClick={onCloseBlank}>
              ✕
            </button>
          </div>
        )}
      </div>
      {onNewTab && (
        <button type="button" className="tabbar__new" aria-label="New tab" title={titleWithKey('New tab', 'newTab', hotkeys)} onClick={onNewTab}>
          <PlusIcon />
        </button>
      )}
      <div className="tabbar-tail" {...endSlot} />
      <CardPreviewHost store={tabPreview.store} cardOf={previewTab} scopeOf={previewScope} diagramDarkColors={diagramDarkColors} side="below" />
      {menu !== null && <TabMenu menu={menu} label={labelOf(menu.path)} onClose={() => setMenu(null)} onMoveToRight={onMoveToRight} onMoveToNewWindow={onMoveToNewWindow} moveTargets={onMoveTargets?.(menu.path)} onMoveToWindow={onMoveToWindow} onHighlightWindow={onHighlightWindow} onDuplicate={onDuplicate} onRename={onSetName === undefined ? undefined : setRenaming} onResetName={(id) => onSetName?.(id, null)} onShowInSidebar={onShowInSidebar} onSetReview={onSetReview} onToggleFocus={onToggleFocus} onToggleFavorite={onToggleFavorite} onNotice={onNotice} />}
      {/* The grid button's menu: the two saves of a session (YAZ-3147 D5), a line, then "Kill all tabs". With no tab
          there is nothing to save or close, and each item is grey like any item that cannot be used (S4). */}
      {gridMenu !== null && (
        <ContextMenuSurface x={gridMenu.x} y={gridMenu.y} onClose={() => setGridMenu(null)}>
          {onSaveSession !== undefined && (
            <div className="ctx-menu__group" role="group">
              {([['Save tabs as session', false], ['Save and close all tabs', true]] as const).map(([label, closeAll]) => (
                <button
                  key={label}
                  type="button"
                  className="ctx-menu__item"
                  role="menuitem"
                  disabled={tabs.length === 0}
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => {
                    setGridMenu(null)
                    onSaveSession(closeAll)
                  }}
                >
                  {label}
                </button>
              ))}
            </div>
          )}
          <div className="ctx-menu__group" role="group">
            <button
              type="button"
              className={tabs.length === 0 ? 'ctx-menu__item' : 'ctx-menu__item ctx-menu__item--danger'}
              role="menuitem"
              disabled={tabs.length === 0}
              // So does the press on the item: a sheet that is cancelled then gives the keys back to the board, or to the note.
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => {
                setGridMenu(null)
                onKillAll?.()
              }}
            >
              Kill all tabs
            </button>
          </div>
        </ContextMenuSurface>
      )}
    </div>
  )
}
