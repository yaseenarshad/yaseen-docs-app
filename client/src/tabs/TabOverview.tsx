import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type KeyboardEvent, type MouseEvent } from 'react'
import { ContextMenuSurface } from '../components/ContextMenuSurface'
import { pageLabel, useFolderPaths, type PathTitles } from '../lib/pageLabel'
import { dirname } from '../lib/paths'
import { readPageDrag, writePageDrag } from '../workspace/pageDrag'
import { BOARD, buildBoard, islandCols, nearest, stackedIslands, withoutTitle, type Island, type Way } from './board'
import { TabMenu, type TabMenuAt } from './TabMenu'
import { useTabHeads } from './useTabHeads'
import './tabs.css'

/** How long the board's zoom takes, in ms: the stylesheet's `--tab-zoom-ms` is this number. */
export const ZOOM_MS = 250

export interface TabOverviewProps {
  /** The vaults of the window, and the name the app gives each: pages stand on islands by vault, then by folder (D7). */
  roots: readonly string[]
  vaultNames: readonly string[]
  /** Open tabs, absolute paths, left→right: one page each. */
  tabs: readonly string[]
  /** The active tab: its page is marked, the highlight starts on it, and the zoom goes out of it and into it. */
  active: string | null
  /** The preview tab (D1): its page's title is italic, as its tab's label is. */
  preview: string | null
  /** The window's titles (YAZ-2420 🔒 D14): a page is named as its tab is. */
  titles: PathTitles
  /** App is on its way to the active tab's page: the board zooms into that page, and says so `ZOOM_MS` later. */
  leaving?: boolean
  onLeft?: () => void
  /** A click on a page, Enter on the highlighted one: App goes to that tab. */
  onOpen: (path: string) => void
  /** A page's ✕, an island's ✕: the tabs close and the board stays. */
  onCloseTabs: (paths: string[]) => void
  /** Esc: back to the page. */
  onDismiss: () => void
  /** A page's menu is a tab's menu (`TabMenu`): these are the strip's own doors. A page dropped on the board's right edge takes the first. */
  onMoveToRight?: (path: string) => void
  onShowInSidebar?: (path: string) => void
  onNotice?: (message: string) => void
  reviewState?: (path: string) => boolean | null
  onSetReview?: (path: string, on: boolean) => void
}

/** The sizes of `board.ts`, handed to the stylesheet: the stack rule and the layout read the same numbers. */
const SIZES = {
  '--tab-page-w': `${BOARD.pageW}px`,
  '--tab-page-h': `${BOARD.pageH}px`,
  '--tab-page-gap': `${BOARD.pageGap}px`,
  '--tab-island-pad': `${BOARD.islandPad}px`,
  '--tab-label-h': `${BOARD.labelH}px`,
  '--tab-island-gap': `${BOARD.islandGap}px`,
  '--tab-vault-h': `${BOARD.vaultH}px`,
  '--tab-fan-x': `${BOARD.fanX}px`,
  '--tab-fan-y': `${BOARD.fanY}px`,
  '--tab-pad': `${BOARD.padTop}px ${BOARD.padX}px ${BOARD.padBottom}px`,
  '--tab-zoom-ms': `${ZOOM_MS}ms`,
} as CSSProperties

const ZOOM_VARS = ['--tab-zoom-scale', '--tab-zoom-x', '--tab-zoom-y', '--tab-layer-x', '--tab-layer-y']
const NO_STACKS: ReadonlySet<string> = new Set()
const WAYS: Record<string, Way> = { ArrowLeft: 'left', ArrowRight: 'right', ArrowUp: 'up', ArrowDown: 'down' }
const tabCount = (n: number): string => (n === 1 ? '1 tab' : `${n} tabs`)

/** An element's centre inside `root`, by layout alone: a transform on the way — the zoom's — does not move it. */
function centreIn(el: HTMLElement, root: HTMLElement, scrolled: number): { x: number; y: number } {
  let x = el.offsetWidth / 2
  let y = el.offsetHeight / 2 - scrolled
  for (let node: HTMLElement | null = el; node !== null && node !== root; node = node.offsetParent as HTMLElement | null) {
    x += node.offsetLeft
    y += node.offsetTop
  }
  return { x, y }
}

/** What a page shows: its title, and under it the first lines of a note. */
function PageFace({ label, lines }: { label: string; lines: string }) {
  return (
    <>
      <span className="taboverview__title">{label}</span>
      {lines !== '' && <span className="taboverview__lines">{lines}</span>}
    </>
  )
}

/**
 * The tab board (YAZ-2648 D5): every open tab of the window as a small page, in the editor's
 * place while it shows — App hides the tab stack under it and unmounts nothing, so each page is as
 * it was when the board closes. A page shows its title and, for a note, its first lines (D6,
 * `useTabHeads`). Pages stand on ISLANDS, one per folder that directly holds them, and with two or
 * more vaults the islands under their vault (D7): read off the paths, nothing stored. The islands
 * wrap both ways. When the board would not fit its area the biggest islands show as fanned
 * STACKS (`stackedIslands`, in `board.ts`, where the rule is); a click spreads one for as long as
 * the board is open, and text in the filter spreads them all.
 *
 * The board zooms out of the page it opened from and into the page that is chosen: App's
 * transform on that page's layer and the board's own. That is two CSS animations and no render.
 *
 * The keyboard stays in the filter box: typing narrows the pages by title and path, the arrows
 * move the highlight to the nearest page that way, Enter opens it, Esc goes back to the page. The
 * mouse moves the same highlight. The filter and the highlight are this component's own state, so
 * a keystroke renders the board and nothing else of the window.
 *
 * Three more gestures, none of which leaves the board. SPACE, held, shows the highlighted page
 * big (a peek). A page DRAGS: onto the strip the board shows along its right edge, or onto the
 * right panel itself, and it opens beside the page. SHIFT-click PICKS pages — shift is the
 * selection gesture everywhere in the app — and a small bar closes the picked ones, or the others.
 */
export function TabOverview({ roots, vaultNames, tabs, active, preview, titles, leaving = false, onLeft, onOpen, onCloseTabs, onDismiss, onMoveToRight, onShowInSidebar, onNotice, reviewState, onSetReview }: TabOverviewProps) {
  const [query, setQuery] = useState('')
  const [cursor, setCursor] = useState<string | null>(active)
  /** The islands the user spread by hand: they stay spread until the board closes. */
  const [spread, setSpread] = useState<ReadonlySet<string>>(NO_STACKS)
  /** The room the islands have: the scroller's own box, less its padding. Null until it is measured. */
  const [area, setArea] = useState<{ w: number; h: number } | null>(null)
  const [pageMenu, setPageMenu] = useState<TabMenuAt | null>(null)
  const [islandMenu, setIslandMenu] = useState<{ x: number; y: number; dir: string } | null>(null)
  /** The menu of the picked pages, opened on one of them. */
  const [pickMenu, setPickMenu] = useState<{ x: number; y: number } | null>(null)
  /** The pages picked with shift-click. The board's own, for as long as it is open. */
  const [picked, setPicked] = useState<ReadonlySet<string>>(NO_STACKS)
  /** Space is down on a highlighted page. */
  const [peeking, setPeeking] = useState(false)
  /** The page a drag carries, and whether it is over the board's drop strip. */
  const [dragging, setDragging] = useState<string | null>(null)
  const [dropOver, setDropOver] = useState(false)
  /** The filter box was the last thing used: Space then types a space (see `onKeyDown`). */
  const typed = useRef(false)
  /** A page took a mousedown, and with it the focus the filter box must get back. */
  const refocus = useRef(false)
  const lastPeek = useRef<string | null>(null)
  const rootRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const bodyRef = useRef<HTMLDivElement>(null)
  const isFolder = useFolderPaths(roots)
  const linesOf = useTabHeads(tabs)
  const labelOf = (path: string): string => pageLabel(path, isFolder(path), titles)

  // Built on every render, on purpose: at most a tab strip of pages, arithmetic only, and the labels
  // then follow the titles and the trees with nothing to keep in step. No element is measured here.
  const terms = query.toLowerCase().split(/\s+/).filter((term) => term !== '')
  const board = buildBoard(tabs, roots, vaultNames, labelOf, terms)
  const many = roots.length > 1
  const islands = new Map<string, Island>(board.flatMap((vault) => vault.islands.map((island) => [island.dir, island])))
  const activeDir = active === null ? null : dirname(active)
  // Text in the filter spreads every island: a match must be on show.
  const stacked =
    terms.length > 0
      ? NO_STACKS
      : stackedIslands(
          board.map((vault) => ({ named: many && vault.at < roots.length, islands: vault.islands.map((island) => ({ dir: island.dir, count: island.pages.length })) })),
          area,
          spread,
          activeDir,
        )
  const stackedKey = [...stacked].join('\n')

  /** The pages of the board, in reading order: a page inside a stack too. */
  const shown = board.flatMap((vault) => vault.islands.flatMap((island) => island.pages.map((page) => page.path)))
  // The highlight is a path. When its page goes — closed, or filtered out — the page that took its place has it.
  const at = cursor === null ? -1 : shown.indexOf(cursor)
  const lastAt = useRef(0)
  if (at !== -1) lastAt.current = at
  const current = at !== -1 ? cursor : (shown[Math.min(lastAt.current, shown.length - 1)] ?? null)

  /** What the arrows walk: the pages on show and the stacks, as elements in reading order. */
  const stops = (): HTMLElement[] => Array.from(bodyRef.current?.querySelectorAll<HTMLElement>('[data-path], [data-stack]') ?? [])
  /** The stop that shows `path`: its page, or the stack its island is. */
  const stopOf = (els: readonly HTMLElement[], path: string): number => els.findIndex((el) => el.dataset.path === path || el.dataset.stack === dirname(path))
  const spreadIsland = (dir: string): void => setSpread((now) => (now.has(dir) ? now : new Set([...now, dir])))
  // A picked page that was closed, from here or from anywhere, leaves the pick.
  const pick = tabs.filter((path) => picked.has(path))
  const togglePick = (path: string): void => setPicked((now) => new Set(now.has(path) ? [...now].filter((one) => one !== path) : [...now, path]))
  const closePick = (others: boolean): void => {
    onCloseTabs(others ? tabs.filter((path) => !picked.has(path)) : pick)
    setPicked(NO_STACKS)
  }
  const anyMenu = pageMenu !== null || islandMenu !== null || pickMenu !== null
  // What the peek shows: the highlighted page while Space is down, and the same page while it shrinks away.
  if (peeking && current !== null) lastPeek.current = current
  const peekPath = lastPeek.current !== null && tabs.includes(lastPeek.current) ? lastPeek.current : null

  // The board's area, read when the board mounts and when its box changes — never on a keystroke
  // or a hover. The box is the scroller's, which the window sizes and the pages do not, so what
  // the stack rule decides cannot change what it is asked.
  useLayoutEffect(() => {
    const body = bodyRef.current
    if (body === null) return
    const read = (): void => {
      const w = body.clientWidth - 2 * BOARD.padX
      const h = body.clientHeight - BOARD.padTop - BOARD.padBottom
      setArea((now) => (now !== null && now.w === w && now.h === h ? now : { w, h }))
    }
    read()
    const observer = new ResizeObserver(read)
    observer.observe(body)
    return () => observer.disconnect()
  }, [])

  // THE ZOOM. Opening, App shrinks the active tab's layer onto that tab's page of the board while
  // the board settles in around the page; leaving, both run back, onto the chosen page. Here the
  // page is found and three things go to the tab stack as custom properties, for the layer and
  // the board: the page's centre (the board turns about it, so the page holds still), how much
  // smaller than the layer the page is, and the point the layer shrinks about — the centre of
  // the similarity that lays the layer's box on the page, so the layer ends exactly on it.
  // `data-zoom` starts the board's animation. All of it is read by layout offsets, which a
  // running transform does not skew. With no page to aim at (no tab, no layout) the stylesheet's
  // own middle stands.
  useLayoutEffect(() => {
    const root = rootRef.current
    const stack = root?.parentElement ?? null
    if (root === null || stack === null) return
    const w = root.offsetWidth
    const h = root.offsetHeight
    const els = stops()
    const target = active === null ? undefined : els[stopOf(els, active)]
    if (w > BOARD.pageW && target !== undefined) {
      const scale = w / BOARD.pageW
      const page = centreIn(target, root, bodyRef.current?.scrollTop ?? 0)
      stack.style.setProperty('--tab-zoom-scale', String(scale))
      stack.style.setProperty('--tab-zoom-x', `${page.x}px`)
      stack.style.setProperty('--tab-zoom-y', `${page.y}px`)
      stack.style.setProperty('--tab-layer-x', `${(scale * page.x - w / 2) / (scale - 1)}px`)
      stack.style.setProperty('--tab-layer-y', `${(scale * page.y - h / 2) / (scale - 1)}px`)
    } else for (const name of ZOOM_VARS) stack.style.removeProperty(name)
    root.dataset.zoom = leaving ? 'out' : 'in'
  }, [leaving, active, area, stackedKey])
  useEffect(() => {
    const stack = rootRef.current?.parentElement
    return () => {
      for (const name of ZOOM_VARS) stack?.style.removeProperty(name)
    }
  }, [])
  // The way out takes as long as the animation: a timer, so it ends where no animation runs too.
  const left = useRef(onLeft)
  left.current = onLeft
  useEffect(() => {
    if (!leaving) return
    const timer = setTimeout(() => left.current?.(), ZOOM_MS)
    return () => clearTimeout(timer)
  }, [leaving])

  useEffect(() => inputRef.current?.focus(), [])
  // A tab closed from the strip takes the focus with it, and so does a menu that closes: the keys stay with the board.
  useEffect(() => {
    if (!anyMenu && document.activeElement === document.body) inputRef.current?.focus()
  }, [tabs, anyMenu])
  // Space let go ends the peek, wherever the focus is by then; so does the window losing it.
  useEffect(() => {
    if (!peeking) return
    const end = (e: Event): void => {
      if (e.type === 'blur' || (e as globalThis.KeyboardEvent).key === ' ') setPeeking(false)
    }
    window.addEventListener('keyup', end)
    window.addEventListener('blur', end)
    return () => {
      window.removeEventListener('keyup', end)
      window.removeEventListener('blur', end)
    }
  }, [peeking])
  // A drag ends wherever it is dropped: a page that left the board for the right panel fires no dragend here.
  useEffect(() => {
    if (dragging === null) return
    const end = (): void => {
      setDragging(null)
      setDropOver(false)
    }
    if (!tabs.includes(dragging)) return end()
    window.addEventListener('dragend', end)
    window.addEventListener('drop', end)
    return () => {
      window.removeEventListener('dragend', end)
      window.removeEventListener('drop', end)
    }
  }, [dragging, tabs])
  // jsdom has no scrollIntoView — hence the `?.()`, as in the strip.
  useEffect(() => {
    if (current === null) return
    const els = stops()
    els[stopOf(els, current)]?.scrollIntoView?.({ block: 'nearest' })
  }, [current])

  const changeQuery = (next: string): void => {
    typed.current = true
    setQuery(next)
    // New text starts on its first match; no text, on the page that is open.
    lastAt.current = 0
    setCursor(next.trim() === '' ? active : null)
  }

  const onKeyDown = (e: KeyboardEvent): void => {
    // A menu that is open has the keys: its Esc closes it, not the board.
    if (anyMenu) return
    if (e.key === 'Escape') {
      e.preventDefault()
      // The first Esc drops the pick; the board goes on the next.
      if (pick.length > 0) setPicked(NO_STACKS)
      else onDismiss()
      return
    }
    // SPACE PEEKS at the highlighted page — except while a query is being typed, where it is a
    // space. "Being typed" is: the box holds text, and the last thing done was typing in it. A
    // move of the highlight, by an arrow or by the pointer going onto another page, hands Space
    // back to the peek; the next character typed takes it again. An empty box never needs a space.
    if (e.key === ' ' && !(e.target instanceof HTMLButtonElement) && current !== null && (query === '' || !typed.current)) {
      e.preventDefault()
      if (!peeking) setPeeking(true)
      return
    }
    // Enter on a ✕ is that button's own.
    if (e.key === 'Enter' && !(e.target instanceof HTMLButtonElement)) {
      e.preventDefault()
      if (current !== null) onOpen(current)
      return
    }
    const way = WAYS[e.key]
    if (current === null || way === undefined) return
    // The arrows are the pages': the caret in the filter box does not move.
    e.preventDefault()
    const els = stops()
    const from = stopOf(els, current)
    if (from === -1) return
    const boxes = els.map((el) => el.getBoundingClientRect())
    // With no layout (jsdom) there is no geometry, and the stops are one line.
    const to = els[boxes[from].width === 0 ? from + (way === 'left' || way === 'up' ? -1 : 1) : nearest(boxes, from, way)]
    if (to === undefined) return
    typed.current = false
    // The highlight never rests inside a pile: walking onto a stack spreads it.
    const dir = to.dataset.stack
    if (dir !== undefined) spreadIsland(dir)
    setCursor(dir !== undefined ? (islands.get(dir)?.pages[0].path ?? current) : (to.dataset.path ?? current))
  }

  const menuOn = (e: MouseEvent, open: () => void): void => {
    e.preventDefault()
    e.stopPropagation()
    setPageMenu(null)
    setIslandMenu(null)
    setPickMenu(null)
    open()
  }
  const menuIsland = islandMenu === null ? undefined : islands.get(islandMenu.dir)
  /** The row of the sidebar that stands for an island: its folder, or — with two or more vaults — its vault's row. A page in no vault has none. */
  const sidebarRowOf = (island: Island): string | null => {
    const vault = board.find((one) => one.islands.includes(island))
    if (vault === undefined || vault.at >= roots.length) return null
    return island.top ? (many ? roots[vault.at] : null) : island.dir
  }

  return (
    // A click anywhere but the filter box leaves the focus in it, so the keys keep working. A page
    // must take its mousedown — that is how its drag starts — and the box gets the focus back.
    <div
      ref={rootRef}
      className="taboverview"
      style={SIZES}
      onKeyDown={onKeyDown}
      onMouseDown={(e) => {
        if (e.target === inputRef.current) return
        if (e.target instanceof Element && e.target.closest('[draggable="true"]') !== null) refocus.current = true
        else e.preventDefault()
      }}
    >
      <input
        ref={inputRef}
        className="taboverview__filter"
        type="text"
        value={query}
        placeholder="Filter open tabs"
        aria-label="Filter open tabs"
        spellCheck={false}
        onChange={(e) => changeQuery(e.target.value)}
        onBlur={() => {
          if (!refocus.current) return
          refocus.current = false
          // Only while nothing else took it: a click that opened the page gave the focus to that page.
          requestAnimationFrame(() => {
            if (document.activeElement === document.body) inputRef.current?.focus()
          })
        }}
      />
      <div className="taboverview__body" ref={bodyRef} role="listbox" aria-label="Open tabs">
        {shown.length === 0 && <p className="taboverview__msg">{tabs.length === 0 ? 'No open tabs.' : 'No open tab matches.'}</p>}
        {board.map((vault) => (
          <div key={vault.at} className="taboverview__vault">
            {/* The vault is named only where the window has two or more (D7). */}
            {many && vault.at < roots.length && <div className="taboverview__vault-name">{vault.name}</div>}
            <div className="taboverview__islands">
              {vault.islands.map((island) => {
                const count = island.pages.length
                const isStack = stacked.has(island.dir)
                const cut = island.label.lastIndexOf(' / ')
                // A pile shows the page the user came from when it holds it, else its first.
                const top = island.pages.find((page) => page.path === active) ?? island.pages[0]
                return (
                  <div key={island.dir} className="taboverview__island" role="group" aria-label={island.label} data-island={island.dir}>
                    <div
                      className="taboverview__island-head"
                      onContextMenu={(e) => menuOn(e, () => setIslandMenu({ x: e.clientX, y: e.clientY, dir: island.dir }))}
                    >
                      {/* The folder's own name is the last to give way: a long path loses its start first. */}
                      <span className="taboverview__island-label" title={island.dir}>
                        {cut !== -1 && <span className="taboverview__island-path">{island.label.slice(0, cut + 3)}</span>}
                        <span className="taboverview__island-leaf">{island.label.slice(cut === -1 ? 0 : cut + 3)}</span>
                      </span>
                      <span className="taboverview__island-count">{count}</span>
                      <button type="button" className="taboverview__island-close" aria-label={`Close ${tabCount(count)}: ${island.label}`} title={`Close ${tabCount(count)}`} onClick={() => onCloseTabs(island.pages.map((page) => page.path))}>
                        ✕
                      </button>
                    </div>
                    {isStack ? (
                      <button type="button" className="taboverview__stack" data-stack={island.dir} aria-label={`Spread ${island.label}: ${tabCount(count)}`} title={`Show the ${tabCount(count)}`} onClick={() => spreadIsland(island.dir)}>
                        {count > 2 && <span className="taboverview__sheet taboverview__sheet--far" />}
                        <span className="taboverview__sheet" />
                        <span className={`taboverview__page${top.path === active ? ' taboverview__page--active' : ''}${top.path === preview ? ' taboverview__page--preview' : ''}${current !== null && dirname(current) === island.dir ? ' taboverview__page--current' : ''}`}>
                          <PageFace label={top.label} lines={withoutTitle(linesOf(top.path), top.label)} />
                        </span>
                      </button>
                    ) : (
                      <div className="taboverview__pages" style={{ gridTemplateColumns: `repeat(${islandCols(count, area?.w ?? Infinity)}, var(--tab-page-w))` }}>
                        {island.pages.map(({ path, label }) => {
                          const cls = ['taboverview__page']
                          if (path === active) cls.push('taboverview__page--active')
                          if (path === preview) cls.push('taboverview__page--preview')
                          if (path === current) cls.push('taboverview__page--current')
                          if (picked.has(path)) cls.push('taboverview__page--picked')
                          if (path === dragging) cls.push('taboverview__page--dragging')
                          return (
                            <div
                              key={path}
                              className={cls.join(' ')}
                              role="option"
                              aria-selected={path === current}
                              aria-current={path === active ? 'page' : undefined}
                              data-path={path}
                              title={path}
                              data-picked={picked.has(path) || undefined}
                              // Shift is the selection gesture and nothing else, as on a sidebar row: it picks, and never opens.
                              onClick={(e) => (e.shiftKey ? togglePick(path) : onOpen(path))}
                              // On one of two or more picked pages the menu is the pick's; on any other page, the tab's.
                              onContextMenu={(e) => menuOn(e, () => (picked.has(path) && pick.length > 1 ? setPickMenu({ x: e.clientX, y: e.clientY }) : setPageMenu({ x: e.clientX, y: e.clientY, path, review: reviewState?.(path) ?? null })))}
                              // A move of the pointer, never a page that scrolled under it.
                              onMouseMove={() => {
                                if (path === current) return
                                typed.current = false
                                setCursor(path)
                              }}
                              // The strip's own payload (`pageDrag`), so the right panel takes a page as it takes a tab.
                              draggable
                              onDragStart={(e) => {
                                if (e.dataTransfer) writePageDrag(e.dataTransfer, { path, owner: 'main' })
                                setDragging(path)
                              }}
                            >
                              <PageFace label={label} lines={withoutTitle(linesOf(path), label)} />
                              <button
                                type="button"
                                className="taboverview__close"
                                aria-label={`Close ${label}`}
                                title={`Close ${label}`}
                                onClick={(e) => {
                                  e.stopPropagation()
                                  onCloseTabs([path])
                                }}
                              >
                                ✕
                              </button>
                            </div>
                          )
                        })}
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          </div>
        ))}
      </div>
      {/* While a page is dragged, the board's right edge takes it: the tab opens in the right panel, at the end. Always in the DOM, so a drag that starts changes a class and inserts nothing. */}
      <div
        className={`taboverview__drop${dragging !== null && onMoveToRight !== undefined ? ' taboverview__drop--on' : ''}${dropOver ? ' taboverview__drop--over' : ''}`}
        aria-hidden={dragging === null}
        onDragOver={(e) => {
          if (dragging === null) return
          e.preventDefault()
          if (e.dataTransfer) e.dataTransfer.dropEffect = 'move'
          if (!dropOver) setDropOver(true)
        }}
        onDragLeave={() => setDropOver(false)}
        onDrop={(e) => {
          if (dragging === null) return
          e.preventDefault()
          // The drag's own payload says which page; a drag with none (jsdom) is the one that started here.
          const page = e.dataTransfer ? readPageDrag(e.dataTransfer) : null
          const path = page?.owner === 'main' ? page.path : dragging
          setDragging(null)
          setDropOver(false)
          onMoveToRight?.(path)
        }}
      >
        Drop here to open it beside your page
      </div>
      {/* The peek: the highlighted page at a size to read, while Space is held. It is not a page of the board: nothing in it is clicked. */}
      <div className={`taboverview__peek${peeking && current !== null ? ' taboverview__peek--on' : ''}${peekPath !== null && peekPath === preview ? ' taboverview__page--preview' : ''}`} aria-hidden={!peeking}>
        {peekPath !== null && <PageFace label={labelOf(peekPath)} lines={withoutTitle(linesOf(peekPath), labelOf(peekPath))} />}
      </div>
      {/* The pick's bar: only while pages are picked. Both closes drop the pick and leave the board open. */}
      {pick.length > 0 && (
        <div className="taboverview__pick" role="toolbar" aria-label="Picked tabs">
          <span className="taboverview__pick-count">{pick.length} picked</span>
          <button type="button" onClick={() => closePick(false)}>
            Close them
          </button>
          <button type="button" onClick={() => closePick(true)}>
            Close the others
          </button>
          <button type="button" onClick={() => setPicked(NO_STACKS)}>
            Clear
          </button>
        </div>
      )}
      {/* The menu of two or more picked pages leads with what they have in common, as the sidebar's does, and has nothing else. */}
      {pickMenu !== null && (
        <ContextMenuSurface x={pickMenu.x} y={pickMenu.y} onClose={() => setPickMenu(null)}>
          <button
            type="button"
            className="ctx-menu__item"
            role="menuitem"
            onClick={() => {
              closePick(false)
              setPickMenu(null)
            }}
          >
            Close {tabCount(pick.length)}
          </button>
          <button
            type="button"
            className="ctx-menu__item"
            role="menuitem"
            onClick={() => {
              closePick(true)
              setPickMenu(null)
            }}
          >
            Close the others
          </button>
        </ContextMenuSurface>
      )}
      {/* A page is an open tab, so its menu is the tab's (`TabMenu`). */}
      {pageMenu !== null && <TabMenu menu={pageMenu} label={labelOf(pageMenu.path)} onClose={() => setPageMenu(null)} onMoveToRight={onMoveToRight} onShowInSidebar={onShowInSidebar} onSetReview={onSetReview} onNotice={onNotice} />}
      {/* An island is a folder: its row in the sidebar, its path, and its tabs as one. */}
      {islandMenu !== null && menuIsland !== undefined && (
        <ContextMenuSurface x={islandMenu.x} y={islandMenu.y} onClose={() => setIslandMenu(null)}>
          {onShowInSidebar !== undefined && sidebarRowOf(menuIsland) !== null && (
            <button
              type="button"
              className="ctx-menu__item"
              role="menuitem"
              onClick={() => {
                onShowInSidebar(sidebarRowOf(menuIsland) ?? menuIsland.dir)
                setIslandMenu(null)
              }}
            >
              Show in sidebar
            </button>
          )}
          <button
            type="button"
            className="ctx-menu__item"
            role="menuitem"
            onClick={() => {
              void navigator.clipboard.writeText(menuIsland.dir)
              setIslandMenu(null)
            }}
          >
            Copy path
          </button>
          <button
            type="button"
            className="ctx-menu__item"
            role="menuitem"
            onClick={() => {
              onCloseTabs(menuIsland.pages.map((page) => page.path))
              setIslandMenu(null)
            }}
          >
            Close {tabCount(menuIsland.pages.length)}
          </button>
        </ContextMenuSurface>
      )}
    </div>
  )
}
