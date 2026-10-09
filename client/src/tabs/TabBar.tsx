import { useEffect, useRef, useState, type CSSProperties, type DragEvent } from 'react'
import { dropIndex, insertionSlot } from '../lib/dragSlot'
import { pageLabel, useFolderPaths, type PathTitles } from '../lib/pageLabel'
import { GridIcon, PlusIcon, SidebarPanelIcon } from '../views/view/icons'
import { readPageDrag, writePageDrag, type PageDrag } from '../workspace/pageDrag'
import { TabMenu, type TabMenuAt } from './TabMenu'
import { useBoardHighlight } from './boardHighlight'
import './tabs.css'

export interface TabBarProps {
  /** The vaults of the window (YAZ-2602): the Files tree of the vault that holds a tab says whether it is a folder (YAZ-2290). */
  roots: readonly string[]
  /** Open tabs, absolute paths, left→right. */
  tabs: readonly string[]
  /** The active tab (the window's `file`); null with no tabs open. */
  active: string | null
  /** The preview tab (YAZ-2648 D1), or null: its label is italic until the tab is kept. */
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
  onActivate: (path: string) => void
  /** A double click on a tab (YAZ-2648 D2): the preview tab becomes a kept tab; any other tab is one already. */
  onKeep?: (path: string) => void
  onClose: (path: string) => void
  /** Drag-to-reorder (I3, GRO-2235): the tab at `from` lands at final index `to`. */
  onMove: (from: number, to: number) => void
  /** A validated page dropped from the right panel at a tab insertion slot. */
  onDropPage?: (page: PageDrag, at: number) => void
  /** Context-menu equivalent of dragging this tab into the right panel. */
  onMoveToRight?: (path: string) => void
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
}

/** How long a tab slides open or shut, in ms (YAZ-2656 D12). The row hands it to the stylesheet as `--tab-slide-ms`, so the slide and the ghost's timer take the same time. */
const SLIDE_MS = 150
const SLIDE = { '--tab-slide-ms': `${SLIDE_MS}ms` } as CSSProperties

/** A tab that closed, for as long as it slides shut: its label, and the tab it stood before (null: the end). */
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
 * The window tab strip (Tabs I2/I3, GRO-2234/2235): one tab per open file, ViewTabs' tablist
 * semantics (role=tab, aria-selected). The tabs are pills (YAZ-2656 R40, R41): each has a fill of
 * its own, the active one the brightest, and none joins the page. Labels hide only Markdown's vault
 * extension; view-only labels keep their extension, a folder's is its whole name (YAZ-2290) and
 * every full path lives in the title tooltip. Tabs reorder by HTML5 drag (the
 * groupDrag idiom: `dataTransfer` guarded — jsdom's synthetic drags have none), the other tabs
 * moving apart at the drop slot; the strip scrolls when full and keeps the ACTIVE tab in view. A
 * tab that joins or leaves the strip slides open or shut. Left of
 * the strip sit the ◀ ▶ history buttons (YAZ-721), disabled when the active tab's stack has
 * nowhere to go — buttons only, per LOCKED ruling D2: no shortcut, no menu item. Right of them
 * the grid button shows every open tab at once (YAZ-2648 D8). The ONE preview tab (YAZ-2648 D1)
 * wears an italic label; a double click on it keeps it. After the tabs a "+" shows the blank tab
 * (YAZ-2655): it stands outside the scroller, so it is on show however far the strip scrolled.
 * Presentational only — all durable state changes go through workspace callbacks.
 */
export function TabBar({ roots, tabs, active, preview = null, blank = false, onNewTab, onCloseBlank, reserveEnd = false, onActivate, onKeep, onClose, onMove, onDropPage, onMoveToRight, canBack, canForward, onBack, onForward, onShowSidebar, onShowInSidebar, onToggleOverview, overviewOpen = false, onNotice, titles, reviewState, onSetReview }: TabBarProps) {
  const [drag, setDrag] = useState<DragState | null>(null)
  const [externalOver, setExternalOver] = useState<number | null>(null)
  // Right-click menu (YAZ-922): the tab IS the file, so it offers the sidebar row's Copy path —
  // and since YAZ-963 that row's OS actions too (Reveal in Finder, Open in VS Code). The items are
  // `TabMenu`'s, which the board's pages open too (YAZ-2648). The note's review state (YAZ-2322)
  // is read when the menu opens, so the review item is about the tab that was right-clicked; a
  // null state hides it.
  const [menu, setMenu] = useState<TabMenuAt | null>(null)
  const activeRef = useRef<HTMLDivElement | null>(null)
  // The page the tab board highlights (YAZ-2648): its tab is lit, and brought into view like the active one.
  const lit = useBoardHighlight()
  const litRef = useRef<HTMLDivElement | null>(null)
  useEffect(() => {
    if (lit !== null) litRef.current?.scrollIntoView?.({ block: 'nearest', inline: 'nearest' })
  }, [lit])
  const isFolder = useFolderPaths(roots)
  const labelOf = (path: string): string => pageLabel(path, isFolder(path), titles)

  // Overflow polish (I3): tabs shrink to a floor and the strip scrolls, so scroll the active
  // tab fully into view on every activation. jsdom has no scrollIntoView — hence the `?.()`.
  useEffect(() => {
    activeRef.current?.scrollIntoView?.({ block: 'nearest', inline: 'nearest' })
  }, [active, blank])

  // THE SLIDE (YAZ-2656 D12, S88). A tab that JOINS the strip slides open: the count grew, and the
  // tab is not the page that filled the blank tab, which stood there already. A page that takes a
  // tab's place — the preview tab's next page, a rename — is a new element in the same room, and
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
    for (const path of tabs) if (!last.current.tabs.includes(path)) slidIn.current.add(path)
  }
  useEffect(() => {
    const was = last.current
    last.current = { tabs, blank }
    for (const path of slidIn.current) if (!tabs.includes(path)) slidIn.current.delete(path)
    // With no motion asked for — and where there is no `matchMedia` to ask — nothing slides shut.
    if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches !== false) return
    const gone: Ghost[] = []
    if (tabs.length < was.tabs.length) {
      was.tabs.forEach((path, i) => {
        if (!tabs.includes(path)) gone.push({ key: ++ghostKey.current, label: labelOf(path), before: was.tabs.slice(i + 1).find((next) => tabs.includes(next)) ?? null })
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
  const ghostsBefore = (path: string | null) =>
    ghosts
      .filter((ghost) => ghost.before === path)
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
    const page = readPageDrag(event.dataTransfer)
    return page?.owner === 'right' && !tabs.includes(page.path) ? page : null
  }

  const dropExternal = (event: DragEvent, insertion: number): void => {
    const page = externalPage(event)
    setExternalOver(null)
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
      if (externalPage(e) === null) return
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
          <button type="button" className="tabbar-nav__btn" aria-label="Show all open tabs" title="Show all open tabs (⌘⇧M)" aria-pressed={overviewOpen} onClick={onToggleOverview}>
            <GridIcon />
          </button>
        )}
      </div>
      <div
        className={`tabbar scroll-strip${externalOver === 0 && tabs.length === 0 ? ' tabbar--drop-empty' : ''}`}
        role="tablist"
        aria-label="Open files"
        {...endSlot}
      >
        {/* ONE keyed list, ghosts and tabs: a tab that closes or moves builds no other tab again. */}
        {tabs.flatMap((path, i) => {
          // Under the blank tab no tab of the strip is the active one (YAZ-2655).
          const isActive = !blank && path === active
          const label = labelOf(path)
          const cls = ['tabbar__tab']
          if (isActive) cls.push('tabbar__tab--active')
          if (path === preview) cls.push('tabbar__tab--preview')
          if (path === lit) cls.push('tabbar__tab--lit')
          if (slidIn.current.has(path)) cls.push('tabbar__tab--in')
          if (drag !== null && drag.from === i) cls.push('tabbar__tab--dragging')
          // The drop slot: the tab the drop would land before gives way — or the LAST tab, for the end slot.
          if (gap === i) cls.push('tabbar__tab--gap-before')
          if (gap === tabs.length && i === tabs.length - 1) cls.push('tabbar__tab--gap-after')
          return [
            ...ghostsBefore(path),
            <div
              key={path}
              ref={(node) => {
                if (isActive) activeRef.current = node
                if (path === lit) litRef.current = node
              }}
              className={cls.join(' ')}
              draggable
              onDragStart={(e) => {
                if (e.dataTransfer) writePageDrag(e.dataTransfer, { path, owner: 'main' })
                setExternalOver(null)
                setDrag({ from: i, over: null })
              }}
              onDragEnd={() => {
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
                if (externalPage(e) === null) return
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
                e.preventDefault()
                setMenu({ x: e.clientX, y: e.clientY, path, review: reviewState?.(path) ?? null })
              }}
            >
              <button
                type="button"
                role="tab"
                className="tabbar__btn"
                aria-selected={isActive}
                title={path}
                onClick={() => onActivate(path)}
                onDoubleClick={() => onKeep?.(path)}
                onAuxClick={(e) => {
                  // Middle-click closes — the browser-tab convention.
                  if (e.button === 1) onClose(path)
                }}
              >
                <span className="tabbar__label">{label}</span>
              </button>
              <button type="button" className="tabbar__close" aria-label={`Close ${label}`} title={`Close ${label}`} onClick={() => onClose(path)}>
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
        <button type="button" className="tabbar__new" aria-label="New tab" title="New tab (⌘T)" onClick={onNewTab}>
          <PlusIcon />
        </button>
      )}
      <div className="tabbar-tail" {...endSlot} />
      {menu !== null && <TabMenu menu={menu} label={labelOf(menu.path)} onClose={() => setMenu(null)} onMoveToRight={onMoveToRight} onShowInSidebar={onShowInSidebar} onSetReview={onSetReview} onNotice={onNotice} />}
    </div>
  )
}
