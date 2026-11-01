/**
 * THE CODE OUTLINE (YAZ-3486): every feature of VS Code's Outline, in the app's look, in the place of
 * a note's table of contents. YAZ-3439 "A code Outline with every VS Code Outline feature, in the
 * app's look".
 *
 * THE FRAME IS THE NOTE'S (`TableOfContents.tsx`, `tocFrame.tsx`): the same `nav.toc` at the tab's
 * right edge, the same two looks — the names column when there is room (`namesShow`), else the rail
 * of small lines and its card —, the same settings (Settings › Table of contents: "Table of contents
 * default" and "Pin default", YAZ-3558), the same width and drag edge, the same ⌘J. `auto` means room for
 * `CODE_COLUMN` px of code beside the names: about 100 characters at the default text size.
 *
 * THE ROWS ARE VS CODE'S: a tree of every symbol (no depth cap, no row cap), a type icon on each, a ⌄
 * on each row with children, "Collapse all", a filter box that keeps the matches and their parents,
 * and a "…" menu: Sort by Position / Name / Type, Show or hide each kind, Expand all, Collapse all.
 * Show also has "Variables inside functions" (off: a name declared inside a function is not a row;
 * YAZ-3507), offered when the file has such names. Sort, the hidden kinds and that row are app settings
 * (`codeOutlineSort`, `codeOutlineHidden`, `codeOutlineLocals`); what is collapsed and the filter belong
 * to this tab.
 *
 * FOLLOW THE CURSOR (S7): the current row is the symbol that holds the cursor; while the code
 * scrolls with the cursor off screen, the symbol at the top of the view. The list keeps it in view.
 * A jump names its own row current until the reader's next wheel, press or key in the code, as in a note.
 *
 * ERROR MARKS (S6): Monaco's errors and warnings, as a red or yellow dot on the row of the symbol
 * that holds each one; a collapsed row shows the worst of what it hides.
 *
 * BIG FILES (S12): the list draws only the rows on screen (`ROW_H` each), and the rail at most the
 * lines it has room for, around the current one. The symbols are read 300 ms after the last edit
 * (`outlineFeed.ts`); a keystroke costs the Outline nothing.
 *
 * ⌘J opens it with the focus in the filter box: typing filters, ↑ / ↓ pick, ⏎ goes, Esc clears the
 * filter and returns to the code. ← / → collapse and open the picked row while the box is empty.
 */
import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore, type CSSProperties, type KeyboardEvent as ReactKeyboardEvent, type ReactNode, type RefObject } from 'react'
import { createPortal } from 'react-dom'
import { CODE_SYMBOL_KINDS, type CodeOutlineSort, type CodeSymbolKind, type TableOfContents as TableOfContentsMode } from '@shared/types'
import { NAMES_FLOOR, namesRoom, namesShow, railPitch } from '../../editor/toc/TableOfContents'
import { beginTocResize, CLICK_GUARD_MS, EDGE_PX, PinIcon, RAIL_PADDING_PX, useTocBox, useTocCard, useTocLinger, useTocShortcut, useTocWidthVar } from '../../editor/toc/tocFrame'
import { ContextMenu } from '../../sidebar/ContextMenu'
import { CollapseAllIcon, ExpandAllIcon } from '../../views/view/icons'
import type { MenuAction } from '../../sidebar/menuSections'
import { jumpTo, type JumpEditorLike } from './codeJump'
import { kindId, kindLabel, kindName, OutlineIcon } from './OutlineIcon'
import type { OutlineFeed } from './outlineFeed'
import { allKeys, displayOrder, foldableKeys, kindsIn, markSymbols, Mark, pathDepth, rowMark, symbolAt, visibleRows, KIND_COUNT, type OutlineRows, type OutlineTree } from './outlineModel'
import '../../editor/toc/toc.css'
import './outline.css'

/** The code that "Pin default" Off (`auto`) keeps beside the names, px: about 100 characters at 13 px. */
export const CODE_COLUMN = 800
/** One row of the list, px: `outline.css`'s `--outline-row-h`. */
export const ROW_H = 24
/** Rows drawn above and below the ones on screen, so a fast wheel never shows a blank. */
const OVERSCAN = 12
/** The rail's thinnest pitch (`railPitch`): a rail never draws more lines than its height holds at it. */
const RAIL_MIN_PITCH = 4

/** What the Outline needs of the editor: the jump's, and the cursor and the view to follow. */
export interface OutlineEditorLike extends JumpEditorLike {
  getPosition(): { lineNumber: number; column: number } | null
  getVisibleRanges(): readonly { startLineNumber: number; endLineNumber: number }[]
  getModel(): { getLineFirstNonWhitespaceColumn?(lineNumber: number): number } | null
  onDidChangeCursorPosition(listener: () => void): { dispose(): void }
  onDidScrollChange(listener: (event: { scrollTopChanged: boolean }) => void): { dispose(): void }
  onDidLayoutChange(listener: () => void): { dispose(): void }
  getLayoutInfo(): { height: number; verticalScrollbarWidth?: number; minimap?: { minimapWidth?: number } }
}

export interface CodeOutlineProps {
  feed: OutlineFeed
  editor: OutlineEditorLike
  /** Monaco's line height now, px: a jump lands below the sticky lines. */
  lineHeight: () => number
  /** Settings › "Pin default": Off (`auto`) / On (`pinned`); `off` while this file shows no table of contents. */
  mode: TableOfContentsMode
  onChangeMode: (mode: TableOfContentsMode) => void
  /** The names column's width, the note's setting (YAZ-2752). */
  width: number
  onChangeWidth: (width: number) => void
  sort: CodeOutlineSort
  hidden: readonly CodeSymbolKind[]
  /** "…" › Show › "Variables inside functions" (YAZ-3507): false leaves them out, where the tree is built. */
  locals?: boolean
  onChangeView: (patch: { codeOutlineSort?: CodeOutlineSort; codeOutlineHidden?: CodeSymbolKind[]; codeOutlineLocals?: boolean }) => void
  /** Monaco's mount: the scroller the frame measures. */
  hostRef: RefObject<HTMLElement | null>
  /** Esc and a second ⌘J hand the cursor back to the code. */
  onReturnFocus: () => void
}

export function CodeOutline({ feed, editor, lineHeight, mode, onChangeMode, width, onChangeWidth, sort, hidden, locals = false, onChangeView, hostRef, onReturnFocus }: CodeOutlineProps) {
  const { tree, markers } = useSyncExternalStore(feed.subscribe, feed.getState)
  // Code tabs stay mounted in hidden layers: each tab's rows get their own ids, so the filter box never points into another tab.
  const rowsId = useId()
  const shows = mode !== 'off' && tree !== null
  // Off reads nothing (`outlineFeed.ts`): no symbols are read for an Outline nobody sees.
  useEffect(() => feed.setActive(mode !== 'off'), [feed, mode])
  // The names inside functions are left out where the tree is built: a change reads again (YAZ-3507).
  useEffect(() => feed.setLocals(locals), [feed, locals])

  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(() => new Set())
  const [filter, setFilter] = useState('')
  /** The row ↑ / ↓ picked from the filter box; null = the current row. */
  const [pick, setPick] = useState<number | null>(null)
  /**
   * Where the Outline follows: the cursor, or the top of the view (S7). The place itself is a ref; the state is only
   * the deepest symbol that holds it, for the tree it was read against. So a key typed inside one symbol (the column
   * moves) sets no state and re-renders nothing; a move into another symbol does (YAZ-3486 checker nit).
   */
  const placeRef = useRef<{ line: number; column: number } | null>(null)
  const treeRef = useRef(tree)
  treeRef.current = tree
  const [placeNode, setPlaceNode] = useState<{ tree: OutlineTree | null; node: number }>({ tree: null, node: -1 })
  /** The node a jump landed on, current until the reader moves the code themselves. */
  const [locked, setLocked] = useState<number | null>(null)
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null)
  const menuOpen = useRef(false)
  menuOpen.current = menu !== null
  const [right, setRight] = useState(20)

  const hiddenKinds = useMemo(() => {
    const out = new Array<boolean>(KIND_COUNT).fill(false)
    for (const id of hidden) {
      const k = (CODE_SYMBOL_KINDS as readonly string[]).indexOf(id)
      if (k !== -1) out[k] = true
    }
    return out
  }, [hidden])
  const order = useMemo(() => (tree === null ? null : displayOrder(tree, sort)), [tree, sort])
  const rows = useMemo(() => (tree === null || order === null ? null : visibleRows(tree, order, { collapsed, hidden: hiddenKinds, filter })), [tree, order, collapsed, hiddenKinds, filter])
  // One toggle, as every fold-all button (YAZ-3938 D6): while a row that can collapse is open, it collapses all; once all are collapsed, it expands all.
  // Only the rows with a chevron count: a hidden kind takes it away (YAZ-4010). Memoised: a cursor move draws the
  // outline again, and a big file has tens of thousands of keys (S12).
  const foldable = useMemo(() => (tree === null ? null : foldableKeys(tree, hiddenKinds)), [tree, hiddenKinds])
  const anyOpen = useMemo(() => {
    if (foldable !== null) for (const key of foldable) if (!collapsed.has(key)) return true
    return false
  }, [foldable, collapsed])
  const nothingToFold = foldable?.size === 0
  const marks = useMemo(() => (tree === null ? null : markSymbols(tree, markers)), [tree, markers])
  const at = useMemo(() => {
    if (tree === null || rows === null) return -1
    if (locked !== null && locked < tree.size) {
      for (let i = locked; i !== -1; i = tree.parent[i]) if (rows.rowOf[i] !== -1) return rows.rowOf[i]
    }
    // A new tree since the place was read: the same place, looked up in it (a binary search per level).
    const place = placeRef.current
    const node = placeNode.tree === tree ? placeNode.node : place === null ? -1 : symbolAt(tree, place.line, place.column)
    // The deepest symbol at the place, or its nearest drawn parent (`currentRow`'s rule).
    for (let i = node; i !== -1; i = tree.parent[i]) if (rows.rowOf[i] !== -1) return rows.rowOf[i]
    return -1
  }, [tree, rows, placeNode, locked])

  const scrollerOf = (): HTMLElement | null => hostRef.current
  const sectionOf = (): HTMLElement | null => hostRef.current?.closest<HTMLElement>('section.editor') ?? null
  const box = useTocBox(shows, scrollerOf, hostRef)
  const card = useTocCard(() => menuOpen.current)
  const { open, setOpen, hoverRef, openedAt, openCard, closeSoon, cancelGrace } = card
  const names = shows && namesShow(mode, box.width, CODE_COLUMN)
  const room = namesRoom(mode, box.width, CODE_COLUMN, box.gutter)
  const shownWidth = Math.min(width, room)
  const endResize = useRef<(() => void) | null>(null)
  useTocWidthVar(names, shownWidth, sectionOf, hostRef, endResize)

  const navRef = useRef<HTMLElement>(null)
  const filterRef = useRef<HTMLInputElement>(null)
  const pendingFocus = useRef(false)

  // FOLLOW THE CURSOR (S7). A cursor move names the cursor; a scroll names the cursor while it is on
  // screen, else the top of the view. One read per animation frame; state only when the symbol at the place changes.
  useEffect(() => {
    if (!shows) return
    let frame = 0
    const setIfNew = (line: number, column: number): void => {
      placeRef.current = { line, column }
      const now = treeRef.current
      const node = now === null ? -1 : symbolAt(now, line, column)
      setPlaceNode((was) => (was.tree === now && was.node === node ? was : { tree: now, node }))
    }
    const fromCursor = (): void => {
      const cursor = editor.getPosition()
      if (cursor !== null) setIfNew(cursor.lineNumber, cursor.column)
    }
    const fromView = (): void => {
      frame = 0
      const ranges = editor.getVisibleRanges()
      if (ranges.length === 0) return
      const top = ranges[0].startLineNumber
      const bottom = ranges[ranges.length - 1].endLineNumber
      const cursor = editor.getPosition()
      if (cursor !== null && cursor.lineNumber >= top && cursor.lineNumber <= bottom) return setIfNew(cursor.lineNumber, cursor.column)
      setIfNew(top, editor.getModel()?.getLineFirstNonWhitespaceColumn?.(top) || 1)
    }
    fromCursor()
    const cursorMoves = editor.onDidChangeCursorPosition(fromCursor)
    const scrolls = editor.onDidScrollChange((event) => {
      if (event.scrollTopChanged && frame === 0) frame = requestAnimationFrame(fromView)
    })
    return () => {
      cursorMoves.dispose()
      scrolls.dispose()
      if (frame !== 0) cancelAnimationFrame(frame)
    }
  }, [shows, editor])

  // A jump's hold ends with the reader's own wheel, press or key in the code.
  useEffect(() => {
    if (locked === null) return
    const dom = editor.getDomNode()
    if (dom === null) return
    const unlock = (): void => setLocked(null)
    dom.addEventListener('wheel', unlock, { passive: true })
    dom.addEventListener('pointerdown', unlock, { passive: true })
    dom.addEventListener('keydown', unlock)
    return () => {
      dom.removeEventListener('wheel', unlock)
      dom.removeEventListener('pointerdown', unlock)
      dom.removeEventListener('keydown', unlock)
    }
  }, [locked, editor])

  // The rail stands left of Monaco's own scrollbar and minimap: measured on each layout, never per scroll.
  useEffect(() => {
    if (!shows) return
    const measure = (): void => {
      const info = editor.getLayoutInfo()
      setRight((info.verticalScrollbarWidth ?? 14) + (info.minimap?.minimapWidth ?? 0) + 6)
    }
    measure()
    const layouts = editor.onDidLayoutChange(measure)
    return () => layouts.dispose()
  }, [shows, editor])

  // A new filter picks its first match, as VS Code's filter does; an empty one picks nothing.
  useEffect(() => {
    if (filter.trim() === '' || rows === null || rows.matched === null) return setPick(null)
    const first = rows.rows.findIndex((node) => rows.matched![node] === 1)
    setPick(first === -1 ? null : first)
  }, [filter]) // eslint-disable-line react-hooks/exhaustive-deps -- a new filter only, not each new read of the symbols

  const focusFilter = (): void => filterRef.current?.focus()
  const enter = (): void => {
    if (names || open) return focusFilter()
    pendingFocus.current = true
    openCard()
  }
  const leave = (): void => {
    cancelGrace()
    setOpen(false)
    setFilter('')
    setPick(null)
    onReturnFocus()
  }
  const live = useRef({ enter, leave })
  live.current = { enter, leave }
  useTocShortcut(shows, hostRef, navRef, live)

  const jump = (row: number): void => {
    if (tree === null || rows === null || row < 0 || row >= rows.rows.length) return
    const node = rows.rows[row]
    setLocked(node)
    setPick(null)
    cancelGrace()
    setOpen(false)
    void jumpTo(editor, { line: tree.nameLine[node], column: tree.nameColumn[node], depth: tree.depth[node] }, lineHeight())
  }

  const toggle = (node: number, open?: boolean): void => {
    if (tree === null || tree.key[node] === '') return
    const key = tree.key[node]
    setCollapsed((was) => {
      const isOpen = !was.has(key)
      if (open !== undefined && open === isOpen) return was
      const next = new Set(was)
      if (isOpen) next.add(key)
      else next.delete(key)
      return next
    })
  }
  const collapseAll = (): void => {
    if (tree !== null) setCollapsed(allKeys(tree))
  }
  const expandAll = (): void => setCollapsed(new Set())

  // A card that lost its reason to be open (names took over, the setting went off) must not come back open.
  useEffect(() => {
    if (!shows || names) setOpen(false)
  }, [shows, names]) // eslint-disable-line react-hooks/exhaustive-deps -- `setOpen` is stable
  const cardShown = shows && !names && open
  const lingers = useTocLinger(cardShown)
  useLayoutEffect(() => {
    if (!cardShown || !pendingFocus.current) return
    pendingFocus.current = false
    focusFilter()
  }, [cardShown])

  if (!shows || tree === null || rows === null || marks === null) return null

  const active = pick ?? (at >= 0 ? at : null)
  const foldLabel = nothingToFold ? 'Nothing to fold' : anyOpen ? 'Collapse all' : 'Expand all'
  const onFilterKey = (event: ReactKeyboardEvent<HTMLInputElement>): void => {
    const count = rows.rows.length
    if (event.key === 'Escape') {
      event.preventDefault()
      event.stopPropagation()
      leave()
      return
    }
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault()
      if (count === 0) return
      const from = active ?? -1
      setPick(Math.min(count - 1, Math.max(0, from + (event.key === 'ArrowDown' ? 1 : -1))))
      return
    }
    if (event.key === 'Enter') {
      event.preventDefault()
      if (count > 0) jump(active ?? 0)
      return
    }
    if ((event.key === 'ArrowLeft' || event.key === 'ArrowRight') && filter === '' && active !== null) {
      event.preventDefault()
      const node = rows.rows[active]
      if (event.key === 'ArrowRight') toggle(node, true)
      else if (rows.liveKids[node] > 0 && !collapsed.has(tree.key[node])) toggle(node, false)
      else if (tree.parent[node] !== -1 && rows.rowOf[tree.parent[node]] !== -1) setPick(rows.rowOf[tree.parent[node]])
    }
  }
  // While it is open, typing goes to the filter box: a letter on a button of the Outline moves the focus there first.
  const onNavKey = (event: ReactKeyboardEvent<HTMLElement>): void => {
    if (event.target === filterRef.current || event.key.length !== 1 || event.metaKey || event.ctrlKey || event.altKey) return
    focusFilter()
  }

  const openMenu = (button: HTMLElement): void => {
    const r = button.getBoundingClientRect()
    setMenu({ x: r.left, y: r.bottom + 4 })
  }
  const closeMenu = (): void => {
    setMenu(null)
    if (!names) closeSoon()
  }

  const toolbar = (
    <div className="outline__bar">
      <input
        ref={filterRef}
        className="outline__filter"
        type="text"
        placeholder="Filter"
        aria-label="Filter the table of contents"
        role="combobox"
        aria-expanded
        aria-controls={rowsId}
        aria-activedescendant={active === null ? undefined : `${rowsId}-${active}`}
        spellCheck={false}
        value={filter}
        onChange={(event) => setFilter(event.currentTarget.value)}
        onKeyDown={onFilterKey}
      />
      <button type="button" className="outline__tool" title={foldLabel} aria-label={foldLabel} disabled={nothingToFold} onClick={anyOpen ? collapseAll : expandAll}>
        {anyOpen || nothingToFold ? <CollapseAllIcon /> : <ExpandAllIcon />}
      </button>
      <button type="button" className="outline__tool" title="More actions" aria-label="More actions" aria-haspopup="menu" aria-expanded={menu !== null} onClick={(event) => openMenu(event.currentTarget)}>
        <MoreIcon />
      </button>
    </div>
  )
  const list = <OutlineList id={rowsId} tree={tree} rows={rows} marks={marks} at={at} pick={pick} collapsed={collapsed} filter={filter} onToggle={(node) => toggle(node)} onPick={jump} />

  /** The height the rail's lines may take. */
  const railRoom = box.height - 2 * EDGE_PX - RAIL_PADDING_PX
  const most = Math.max(1, Math.floor(railRoom / RAIL_MIN_PITCH))
  const railFrom = rows.rows.length <= most ? 0 : Math.max(0, Math.min(rows.rows.length - most, (at < 0 ? 0 : at) - (most >> 1)))
  const railCount = Math.min(rows.rows.length, most)
  const { pitch } = railPitch(railRoom, railCount)

  const sortRow = (value: CodeOutlineSort, label: string): MenuAction => ({ id: `sort-${value}`, label, icon: <CheckIcon on={sort === value} />, onSelect: () => onChangeView({ codeOutlineSort: value }) })
  const kindRow = (kind: number): MenuAction => {
    const id = kindId(kind)
    const off = hidden.includes(id)
    return { id: `show-${id}`, label: kindLabel(kind), icon: <CheckIcon on={!off} />, onSelect: () => onChangeView({ codeOutlineHidden: off ? hidden.filter((h) => h !== id) : [...hidden, id] }) }
  }
  const localsRow: MenuAction = { id: 'show-locals', label: 'Variables inside functions', icon: <CheckIcon on={locals} />, onSelect: () => onChangeView({ codeOutlineLocals: !locals }) }

  return (
    <nav
      ref={navRef}
      className="toc outline"
      data-names={names ? '' : undefined}
      aria-label="Table of contents"
      style={{ top: box.top, '--toc-height': `${box.height}px`, '--toc-gutter': `${box.gutter}px`, '--outline-right': `${right}px` } as CSSProperties}
      onKeyDown={onNavKey}
      onBlur={(event) => {
        if (!names && !menuOpen.current && !event.currentTarget.contains(event.relatedTarget)) closeSoon()
      }}
    >
      {names ? (
        <>
          <div className="toc__resize" aria-hidden onMouseDown={(event) => beginTocResize(event, sectionOf(), shownWidth, room, onChangeWidth, endResize)} />
          {mode === 'pinned' && !namesShow('auto', box.width, CODE_COLUMN) && (
            <button type="button" className="toc__pin toc__pin--off" title="Unpin: go back to the small lines" onClick={() => onChangeMode('auto')}>
              <PinIcon off />
              <span>Unpin</span>
            </button>
          )}
          {toolbar}
          {list}
        </>
      ) : (
        <div
          ref={hoverRef}
          className="toc__hover"
          onMouseEnter={() => {
            cancelGrace()
            if (!open) openCard()
          }}
          onMouseLeave={() => {
            if (!menuOpen.current) closeSoon()
          }}
        >
          {(open || lingers) && (
            <div className="toc__card" data-leaving={open ? undefined : ''}>
              <div className="toc__header">
                <span className="toc__title">Table of contents</span>
                {mode === 'auto' && box.width >= NAMES_FLOOR && (
                  <button type="button" className="toc__pin" title="Pin: keep the table of contents open beside the code" onClick={() => onChangeMode('pinned')}>
                    <PinIcon />
                    <span>Pin</span>
                  </button>
                )}
              </div>
              {toolbar}
              {list}
            </div>
          )}
          <button
            type="button"
            className="toc__rail"
            aria-label="Table of contents"
            aria-expanded={open}
            onClick={() => {
              if (!open) openCard()
              else if (performance.now() - openedAt.current > CLICK_GUARD_MS) setOpen(false)
            }}
          >
            <span className="toc__track" style={{ '--toc-pitch': `${pitch}px`, '--toc-line': `${pitch < 7 ? 2 : 3}px` } as CSSProperties}>
              {Array.from({ length: railCount }, (_, k) => {
                const r = railFrom + k
                const depth = tree.depth[rows.rows[r]]
                return <span key={r} className="toc__line" data-level={Math.min(depth + 1, 3)} data-read={r < at ? '' : undefined} data-current={r === at ? '' : undefined} />
              })}
            </span>
          </button>
        </div>
      )}
      {menu !== null &&
        createPortal(
          <ContextMenu
            x={menu.x}
            y={menu.y}
            sections={[
              [
                { id: 'sort', label: 'Sort by', children: [[sortRow('position', 'Position'), sortRow('name', 'Name'), sortRow('type', 'Type')]] },
                { id: 'show', label: 'Show', children: locals || tree.localsLeftOut > 0 ? [kindsIn(tree).map(kindRow), [localsRow]] : [kindsIn(tree).map(kindRow)] },
              ],
              [
                { id: 'expand-all', label: 'Expand all', onSelect: expandAll },
                { id: 'collapse-all', label: 'Collapse all', onSelect: collapseAll },
              ],
            ]}
            onClose={closeMenu}
          />,
          document.body,
        )}
    </nav>
  )
}

interface OutlineListProps {
  /** The list's element id; row `r` is `<id>-<r>`. */
  id: string
  tree: OutlineTree
  rows: OutlineRows
  marks: ReturnType<typeof markSymbols>
  at: number
  pick: number | null
  collapsed: ReadonlySet<string>
  filter: string
  onToggle: (node: number) => void
  onPick: (row: number) => void
}

/**
 * The rows: a scroll box with one runner `ROW_H` × rows tall, and only the rows on screen in it (and
 * `OVERSCAN` more each way). The accent marker rides the hairline to the current row, as in a note.
 * The current row, and the picked one, stay in view: the list scrolls when they leave it.
 */
function OutlineList({ id, tree, rows, marks, at, pick, collapsed, filter, onToggle, onPick }: OutlineListProps) {
  const listRef = useRef<HTMLDivElement>(null)
  const markerRef = useRef<HTMLSpanElement>(null)
  const [view, setView] = useState({ top: 0, height: 480 })
  const placed = useRef(false)
  const count = rows.rows.length

  const edges = (): void => {
    const list = listRef.current
    if (list === null) return
    list.toggleAttribute('data-above', list.scrollTop > 1)
    list.toggleAttribute('data-below', list.scrollTop + list.clientHeight < list.scrollHeight - 1)
  }
  const read = (): void => {
    const list = listRef.current
    if (list === null) return
    const next = { top: list.scrollTop, height: list.clientHeight || 480 }
    setView((was) => (was.top === next.top && was.height === next.height ? was : next))
    edges()
  }
  useLayoutEffect(() => {
    const list = listRef.current
    if (list === null) return
    read()
    const observer = new ResizeObserver(read)
    observer.observe(list)
    return () => observer.disconnect()
  }, []) // eslint-disable-line react-hooks/exhaustive-deps -- `read` reads refs only

  // Keep the row in view: the picked one while ↑ / ↓ walk, else the current one. Centred when it left the box.
  const shownRow = pick ?? at
  useLayoutEffect(() => {
    const list = listRef.current
    if (list === null || shownRow < 0) return
    const top = shownRow * ROW_H
    const height = list.clientHeight
    if (height > 0 && (top < list.scrollTop || top + ROW_H > list.scrollTop + height)) {
      const want = Math.max(0, top - height / 2 + ROW_H / 2)
      list.scrollTop = want
      // The box may not have scrolled yet (or at all, under jsdom): draw the rows of where it is going.
      setView({ top: list.scrollTop || want, height })
      edges()
      return
    }
    edges()
  }, [shownRow, rows]) // eslint-disable-line react-hooks/exhaustive-deps -- `read` and `edges` read refs only

  // The marker's first placement is not a move: it starts where it belongs, then it slides.
  useLayoutEffect(() => {
    const marker = markerRef.current
    if (marker === null || placed.current || at < 0) return
    void marker.offsetHeight
    marker.toggleAttribute('data-placed', true)
    placed.current = true
  }, [at])

  const first = Math.max(0, Math.floor(view.top / ROW_H) - OVERSCAN)
  const last = Math.min(count, Math.ceil((view.top + view.height) / ROW_H) + OVERSCAN)
  const needle = filter.trim().toLowerCase()
  const drawn: ReactNode[] = []
  for (let r = first; r < last; r++) {
    const node = rows.rows[r]
    const kids = rows.liveKids[node] > 0
    const closed = kids && needle === '' && collapsed.has(tree.key[node])
    const mark = rowMark(tree, rows, marks, node, kids && !closed)
    drawn.push(
      <div
        key={node}
        id={`${id}-${r}`}
        role="treeitem"
        className="outline__row"
        data-depth={Math.min(tree.depth[node], 2)}
        data-picked={pick === r ? '' : undefined}
        aria-level={tree.depth[node] + 1}
        aria-expanded={kids ? !closed : undefined}
        aria-current={r === at ? 'true' : undefined}
        aria-selected={pick === r}
        style={{ top: r * ROW_H, '--depth': tree.depth[node], '--path': pathDepth(tree, rows, at, r) } as CSSProperties}
        title={`${kindName(tree.kind[node])} ${tree.name[node]}${mark === Mark.Error ? ' — has an error' : mark === Mark.Warning ? ' — has a warning' : ''}`}
        onMouseDown={(event) => event.preventDefault()}
        onClick={() => onPick(r)}
      >
        <span
          className="outline__twisty"
          data-leaf={kids ? undefined : ''}
          data-collapsed={closed ? '' : undefined}
          onClick={(event) => {
            if (!kids) return
            event.stopPropagation()
            onToggle(node)
          }}
        >
          {kids && <ChevronIcon />}
        </span>
        <OutlineIcon kind={tree.kind[node]} />
        <span className="outline__name">{highlight(tree.name[node], needle)}</span>
        {mark !== Mark.None && <span className="outline__mark" data-mark={mark === Mark.Error ? 'error' : 'warning'} />}
      </div>,
    )
  }

  return (
    <div ref={listRef} id={id} className="toc__names outline__list" role="tree" aria-label="Symbols" onScroll={read}>
      <div className="outline__runner" style={{ height: count * ROW_H }}>
        {at >= 0 && <span ref={markerRef} className="toc__marker" aria-hidden="true" style={{ transform: `translateY(${at * ROW_H}px)`, height: ROW_H }} />}
        {drawn}
      </div>
    </div>
  )
}

/** The name, with the part the filter matched in bold. */
function highlight(name: string, needle: string): ReactNode {
  if (needle === '') return name
  const at = name.toLowerCase().indexOf(needle)
  if (at === -1) return name
  return (
    <>
      {name.slice(0, at)}
      <span className="outline__hit">{name.slice(at, at + needle.length)}</span>
      {name.slice(at + needle.length)}
    </>
  )
}

const stroke = { fill: 'none', stroke: 'currentColor', strokeWidth: 1.4, strokeLinecap: 'round', strokeLinejoin: 'round' } as const

const ChevronIcon = () => (
  <svg width={10} height={10} viewBox="0 0 16 16" {...stroke} aria-hidden>
    <path d="M4 6l4 4 4-4" />
  </svg>
)

const MoreIcon = () => (
  <svg width={14} height={14} viewBox="0 0 16 16" fill="currentColor" aria-hidden>
    <circle cx={3.5} cy={8} r={1.2} />
    <circle cx={8} cy={8} r={1.2} />
    <circle cx={12.5} cy={8} r={1.2} />
  </svg>
)

/** A check for the chosen sort and each kind shown; an empty slot of the same size for the others, so the labels line up. */
const CheckIcon = ({ on }: { on: boolean }) => (
  <svg width={14} height={14} viewBox="0 0 16 16" {...stroke} aria-hidden>
    {on && <path d="M3.5 8.5l3 3 6-7" />}
  </svg>
)
