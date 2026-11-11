import { type CSSProperties, type DragEvent as ReactDragEvent, Fragment, type KeyboardEvent as ReactKeyboardEvent, type MouseEvent as ReactMouseEvent, type ReactNode, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'
import { ViewFind } from './viewFind'
import type { IndexRecord } from '@shared/types'
import { type Modifiers, openByGesture, openByKey, openTarget } from '../../lib/openGesture'
import { newWindowClick } from '../../lib/newWindowClick'
import { rowPage } from '../../links/shortcuts'
import { pageColumnKeys, type FolderSettings } from '../folderSettings'
import { type ViewSet, type ViewDef, type Mutate, shownGroupLevels } from '../viewSchema'
import { type Group, type Row, propertyKeys } from '../engine'
import type { Resolver } from '../expr'
import { cardWidth } from './cardWidth'
import { canonicalKey } from './keys'
import { GroupHeader, rowTitle } from './GroupHeader'
import { CardLine, CardProp, cardLines, cardColorAttrs } from './cardLines'
import { useFlip } from './flip'
import { type GroupDrop, type GroupSpot, type GroupSwap, TOP_SPOT, childSpot, groupByKey, groupTakesNew, spotKey, useGroupDrag } from './groupDrag'
import { allPropertyKeys } from './properties'
import { PageContextMenu } from './PageContextMenu'
import { type CardNoteDoors, cardMenuItems } from './rowMenuItems'
import { type NoteWindowLink, currentItemClass, shownRows, useNoteWindowItems } from './NoteWindow'
import { NO_READ_ONLY } from '../readOnlyRows'
import { ReadOnlyName } from './ReadOnlyMark'
import type { ViewHover } from './viewHover'

/** Board windowing (YAZ-3746 13AX): the cards a list draws first, the cards each step adds, and how far ahead (px) of the screen a list's end starts the next step. */
const FIRST_CARDS = 40
const STEP_CARDS = 60
const REVEAL_MARGIN = 800

export interface BoardViewProps {
  /** The folder's hover panel (YAZ-3403, `viewHover.ts`): `ViewsPane` always passes it; Settings › Preview on hover › Folder views starts or stops the dwell (YAZ-3743). */
  hover: ViewHover
  def: ViewSet
  view: ViewDef
  viewIndex: number
  records: readonly IndexRecord[]
  /** The folder's settings — its declared columns show by default (YAZ-1549). */
  settings: FolderSettings
  /** Post-search groups from ViewsPane (empty groups dropped); null when the view has no `groupBy`. */
  groups: readonly Group[] | null
  /** Collapsed group keys (`groupKeyOf`) for this page + view; owned by ViewsPane, persisted via storage. */
  collapsed: readonly string[]
  onToggleGroup: (key: string) => void
  onUpdate: Mutate
  /** Open a card page in the current tab — the title click or Enter, the table's name-link rule (YAZ-1557). */
  onOpenFile?: (path: string) => void
  /** Open a card page in the window's right panel. */
  onOpenFileRight?: (path: string) => void
  /** Open a card's page without replacing the current tab. */
  onOpenFileBackground?: (path: string) => void
  /** "Open in mini window ⇧↩" (D57) and ⇧Enter (YAZ-4605 D56) in the card's right-click menu (YAZ-4547 D24): ViewsPane's card; absent = no item. */
  onOpenWindow?: (path: string) => void
  /** The card's link: the board writes its order (column by column, top to bottom) and marks the card's note (D24). */
  windowLink?: NoteWindowLink
  /** Passive notice surface for page actions that fail because a card moved or disappeared. */
  onNotice?: (message: string) => void
  /** A drop on another section, including nested level metadata, via ViewsPane's existing optimistic write path. */
  onMoveToGroup: (path: string, value: unknown, swap?: GroupSwap, drop?: GroupDrop) => void
  /** The read-only notes (YAZ-3076 D6): their cells open no editor and their cards do not move. Absent = none. */
  readOnly?: ReadonlySet<string>
  /** The last failed move, flagged inline on its card. */
  moveError: { path: string; message: string } | null
  /** Create a note seeded at one group level; nested spots let ViewsPane seed the outer too. A `name` is the inline add's typed one. */
  onNewInGroup?: (group: Group, name?: string, at?: GroupSpot) => void
  /** "Show New buttons" (YAZ-3746 13BL): false drops each column's "+ New card" and its header's "+"; the header menu's New note in this group stays. */
  newCards?: boolean
  /** The card menu's note items (YAZ-3746 13BO): Open, the new note beside a card, Duplicate, Delete. Absent: none. */
  noteDoors?: CardNoteDoors
  /** ViewsPane's whole-vault resolver: a column header and a card value read an id link as its note's title (YAZ-2293 D8). */
  resolve?: Resolver
}

/**
 * Board view (4D, GRO-2138): `type: board` — OUR schema extension — renders the engine's groups
 * as kanban columns on one horizontally scrolling row. With two group levels, each outer remains
 * one column: merge-rule `direct` cards come first, then compact inner sections stack vertically.
 * Every level uses the shared `GroupHeader` (chevron, typed value, count, per-section summaries)
 * over its cards: `file.name`, when present in `order`, as the title button → `onOpenFile`, then
 * the view's other `order` properties as small label/value rows typed like table cells. A card is
 * a focusable cell (YAZ-1557 D2): a plain click selects it, arrows walk the cards, and the title,
 * Enter, or a modifier opens through `lib/openGesture.ts` — the table's exact rule. Column
 * width follows `cardSize` (shared `cardWidth`: a number = px, legacy small/medium/large values
 * remain readable as 220/280/340, and absent or invalid values default to 280). Collapsing a
 * column hides its cards and
 * keeps the header — same persisted state as the table's groups, never the page's card. Without
 * `groupBy` a centered hint's "Group by…" button writes the first non-file property through the
 * file (opening the Sort popover remotely would mean lifting Toolbar's menu state; one write is
 * simpler and the Sort menu can change it after). Dragging a card to another column (5C,
 * GRO-2143) writes the group property through `onMoveToGroup` — the hovered column shows a
 * dashed placeholder, the own column is never a target, Esc cancels — and a failed move's
 * card carries an inline error chip. Nested targets are siblings of the outer target rather than
 * descendants, so one bubbled drop cannot dispatch at both levels. Images are 4E. A single-level
 * column — or each writable inner section in a nested Board — ends in the Notion inline add
 * (YAZ-943): Enter births the named page into that exact section without opening it. Per-property
 * `cardStyle` (YAZ-1206) bolds/underlines a value and hides its label; its `join` flag is the whole
 * LAYOUT (YAZ-1217, left/right is gone): a card is `.view-board__line` rows following `order`, each
 * key starting one unless `join` continues the line being built — so position IS ordering and the
 * title is un-pinned: `file.name` sits at its order position, can be joined onto and can itself join.
 */
export function BoardView({
  def,
  view,
  settings,
  viewIndex,
  records,
  groups,
  collapsed,
  onToggleGroup,
  onUpdate,
  onOpenFile,
  onOpenFileRight,
  onOpenFileBackground,
  onOpenWindow,
  windowLink,
  onNotice,
  onMoveToGroup,
  moveError,
  onNewInGroup,
  newCards = true,
  noteDoors,
  resolve,
  readOnly = NO_READ_ONLY,
  hover,
}: BoardViewProps) {
  const levels = shownGroupLevels(view)
  const levelKeys = levels.map((_, level) => groupByKey(view, level, settings.columns))
  const dnd = useGroupDrag(levelKeys, onMoveToGroup)
  const adds = levels.map((_, level) => groupTakesNew(view, level, settings.columns))
  /** One FLIP instance for the whole board (YAZ-944), so a card crossing columns MOVES; a fold never plays (13A). */
  const flipRoot = useFlip(collapsed.join('\u001e'))
  // The note window (YAZ-4547 D24): column by column, top to bottom, collapsed sections left out; the board's root
  // is the FLIP root too, so one stable ref callback sets both.
  const windowOrder = useMemo(() => shownRows(groups, [], collapsed), [groups, collapsed])
  const boardRef = useRef<HTMLDivElement | null>(null)
  const setBoardRoot = useCallback(
    (el: HTMLDivElement | null) => {
      boardRef.current = el
      flipRoot(el)
    },
    [flipRoot],
  )
  /**
   * WINDOWING (YAZ-3746 13AX, S17): each card list draws its first `FIRST_CARDS` cards, then `STEP_CARDS` more each time
   * its end comes within `REVEAL_MARGIN` of the screen — so a board of thousands opens as fast as a small one, and the
   * cards drawn are the ones near the screen. `reach` is each list's drawn count, by its group's key; a card asked for
   * (⌘F, the mini window's step) draws its list down to it first (`revealCard`).
   */
  const [reach, setReach] = useState<Readonly<Record<string, number>>>({})
  const drawn = (list: string, total: number) => Math.min(total, Math.max(FIRST_CARDS, reach[list] ?? 0))
  const grow = useCallback((list: string, to: number) => setReach((r) => ((r[list] ?? FIRST_CARDS) >= to ? r : { ...r, [list]: to })), [])
  const ends = useRef<IntersectionObserver | null>(null)
  /** The one observer of the lists' ends, made at the first end's mount: a ref attaches before any effect runs. */
  const endsObserver = (): IntersectionObserver | null => {
    if (ends.current === null && typeof IntersectionObserver !== 'undefined')
      ends.current = new IntersectionObserver(
        (entries) => {
          for (const entry of entries) {
            const el = entry.target as HTMLElement
            if (entry.isIntersecting) grow(el.dataset.list!, Number(el.dataset.next))
          }
        },
        { rootMargin: `${REVEAL_MARGIN}px 0px` },
      )
    return ends.current
  }
  useEffect(
    () => () => {
      ends.current?.disconnect()
      ends.current = null
    },
    [],
  )
  /** Where each card sits: its list and its place in it, for `revealCard`; rebuilt by each render's lists. */
  const places = useRef(new Map<string, { list: string; index: number }>())
  places.current = new Map()
  const revealCard = useCallback(
    (path: string): boolean => {
      const at = places.current.get(path)
      if (at === undefined || at.index < Math.max(FIRST_CARDS, reach[at.list] ?? 0)) return false
      grow(at.list, at.index + STEP_CARDS)
      return true
    },
    [grow, reach],
  )
  // ⌘F's jump to a card not drawn yet draws its list down to it; the find bar scrolls to it once it mounts.
  const find = useContext(ViewFind)
  useEffect(() => {
    if (find === null) return
    find.scrollTo = (path) => void revealCard(path)
    return () => {
      if (find.scrollTo !== null) find.scrollTo = null
    }
  }, [find, revealCard])
  // The mini window's step onto a card not drawn yet: draw it, then show it (two frames: the commit, then its layout).
  useNoteWindowItems(windowLink, windowOrder, boardRef, (current) => {
    if (current !== null && revealCard(current)) requestAnimationFrame(() => requestAnimationFrame(() => windowLink?.show?.()))
  })
  /** The one open add row (YAZ-943) and what has been typed into it; null = every column shows its button. */
  const [adding, setAdding] = useState<{ key: string; name: string } | null>(null)
  /** The exact rendered record targeted by the latest whole-card secondary click. */
  const [menu, setMenu] = useState<{ x: number; y: number; path: string; title: string } | null>(null)
  /** Browser click tails after secondary-click and drag gestures must not become page opens. */
  const suppressClick = useRef(false)
  const suppressOnce = () => {
    suppressClick.current = true
    queueMicrotask(() => {
      suppressClick.current = false
    })
  }
  /** The one open rule (YAZ-1557), shared with the table: ⌘ → background tab, ⌥ → right panel, plain → current tab, ⇧ → nothing. */
  const openHandlers = { onOpenFile, onOpenFileRight, onOpenFileBackground }
  const openCard = (row: Row, e: Modifiers): void => {
    if (suppressClick.current) return
    openByGesture(e, row.record.path, openHandlers)
  }
  /**
   * Arrow keys walk cards like table cells (YAZ-1557 D2): ↑↓ through the column's cards in DOM
   * order — nested sections included, so a two-level column reads top to bottom — and ←→ to the
   * same row of the neighbour column, clamped at every edge. An empty or collapsed neighbour has
   * no card at any row, so focus simply stays.
   */
  const onCardKeyDown = (e: ReactKeyboardEvent<HTMLDivElement>): void => {
    const card = e.target as HTMLElement
    if (!card.classList.contains('view-board__card')) return
    const move = { ArrowUp: [-1, 0], ArrowDown: [1, 0], ArrowLeft: [0, -1], ArrowRight: [0, 1] }[e.key]
    if (move === undefined) return
    e.preventDefault()
    const columns = [...e.currentTarget.querySelectorAll<HTMLElement>(':scope > .view-board__col')]
    const cardsOf = (column: HTMLElement) => [...column.querySelectorAll<HTMLElement>('.view-board__card')]
    const c = columns.findIndex((column) => column.contains(card))
    const r = cardsOf(columns[c]).indexOf(card)
    const next = cardsOf(columns[Math.max(0, Math.min(columns.length - 1, c + move[1]))])
    next[Math.max(0, Math.min(next.length - 1, r + move[0]))]?.focus()
  }
  /** ViewsPane reuses this component between Board tabs; no action may retain the previous Board's record. */
  useEffect(() => setMenu(null), [viewIndex])
  if (groups === null) {
    const fallback = allPropertyKeys(def, view, records).find((k) => !canonicalKey(k).startsWith('file.')) ?? 'file.folder'
    return (
      <div className="view-board__hint">
        <p>Board views group notes into columns. Pick a property to group by.</p>
        <button
          type="button"
          className="view-menu__action"
          onClick={() =>
            onUpdate((d) => {
              d.views[viewIndex].groupBy = { property: canonicalKey(fallback), direction: 'ASC' }
            })
          }
        >
          Group by…
        </button>
      </div>
    )
  }

  const keys = propertyKeys(def, view, records, pageColumnKeys(settings))
  const nameKey = keys.find((k) => canonicalKey(k) === 'file.name')
  const lines = cardLines(keys, view)
  const width = cardWidth(view.cardSize)
  /** One item on a line (`cardLines.tsx`): the title button, or a label/value row. */
  const cardItem = (key: string, row: Row) => {
    if (key === nameKey)
      return (
        <button
          key={key}
          type="button"
          className="view-board__title"
          onClick={(event) => {
            event.stopPropagation()
            if (!newWindowClick(event, rowPage(row.record.path))) openCard(row, event)
          }}
        >
          {readOnly.has(row.record.path) ? <ReadOnlyName>{rowTitle(row)}</ReadOnlyName> : rowTitle(row)}
        </button>
      )
    return <CardProp def={def} view={view} row={row} field={key} resolve={resolve} />
  }
  /** A failed move's inline chip (5C, GRO-2143), under the card's first line. */
  const moveChip = (row: Row) =>
    moveError?.path === row.record.path ? (
      <span className="view-table__chip view-table__chip--error view-drag__error" role="alert" title={moveError.message}>
        Move failed
      </span>
    ) : null
  const openCardMenu = (event: ReactMouseEvent, row: Row): void => {
    event.preventDefault()
    suppressOnce()
    setMenu({ x: event.clientX, y: event.clientY, path: row.record.path, title: row.record.title })
  }
  const dragSource = (row: Row, group: Group, at: GroupSpot): Record<string, unknown> => {
    const source = dnd.source(row.record.path, group, at, readOnly.has(row.record.path))
    const onDragEnd = source.onDragEnd as ((event: ReactDragEvent) => void) | undefined
    if (onDragEnd === undefined) return source
    return {
      ...source,
      onDragEnd: (event: ReactDragEvent) => {
        onDragEnd(event)
        suppressOnce()
      },
    }
  }
  const cardList = (rows: readonly Row[], group: Group, at: GroupSpot, isOver = false) => {
    const list = spotKey(group, at)
    const count = drawn(list, rows.length)
    rows.forEach((row, index) => places.current.set(row.record.path, { list, index }))
    return (
    <ul className="view-board__cards">
      {rows.slice(0, count).map((row) => (
        <li
          key={row.record.path}
          data-flip-key={row.record.path}
          className={`view-board__card${dnd.drag?.path === row.record.path ? ' view-board__card--drag' : ''}${currentItemClass(windowLink, row.record.path)}`}
          // The note's `color` property tints the card here too (YAZ-4906, views.css), the calendar card's attributes.
          {...cardColorAttrs(row.record.properties.color)}
          {...dragSource(row, group, at)}
          {...hover.itemProps(row.record.path)}
          // Every card is a focusable "cell" (YAZ-1557 D2): a plain click SELECTS it, and only the
          // title, Enter, or a modifier opens — so a card without a title still has a name to read.
          tabIndex={0}
          aria-label={nameKey === undefined ? row.record.title : undefined}
          // ⇧⌘-click opens the note in a new window (YAZ-4444 D32), asked before ⇧ vetoes the open.
          onClick={(event) => {
            if (newWindowClick(event, rowPage(row.record.path))) return
            if (openTarget(event) === 'current') event.currentTarget.focus()
            else openCard(row, event)
          }}
          onKeyDown={(event) => {
            if (event.target !== event.currentTarget || event.key !== 'Enter') return
            event.preventDefault()
            // ⇧Enter opens the card in the mini window (YAZ-4605 D56); the other Enters as a click.
            if (!suppressClick.current) openByKey(event, row.record.path, { ...openHandlers, onOpenWindow })
          }}
          onContextMenu={(event) => openCardMenu(event, row)}
        >
          {lines.map((line, i) => (
            <Fragment key={line[0]}>
              <CardLine line={line} item={(key) => cardItem(key, row)} />
              {i === 0 && moveChip(row)}
            </Fragment>
          ))}
          {/* An empty `order` leaves a blank card shell with no line to hang the chip under — it still drags, so it still reports. */}
          {lines.length === 0 && moveChip(row)}
        </li>
      ))}
      {count < rows.length && (
        // The list's end (13AX): near the screen, the next cards draw. A new key per step, so a still-visible end is seen again.
        <li
          key={`more-${count}`}
          className="view-board__more"
          aria-hidden
          data-list={list}
          data-next={count + STEP_CARDS}
          ref={(el) => {
            if (el === null) return
            const observer = endsObserver()
            observer?.observe(el)
            return () => observer?.unobserve(el)
          }}
        />
      )}
      {isOver && <li className="view-board__placeholder" aria-hidden />}
    </ul>
    )
  }
  const inlineAdd = (group: Group, key: string, at?: GroupSpot) => {
    if (onNewInGroup === undefined || !newCards) return null
    return adding?.key === key ? (
      <input
        className="view-board__add-input"
        aria-label="New card name"
        placeholder="New card"
        autoFocus
        value={adding.name}
        onChange={(e) => setAdding({ key, name: e.target.value })}
        onBlur={() => setAdding(null)}
        onKeyDown={(e) => {
          if (e.key === 'Escape') setAdding(null)
          if (e.key !== 'Enter') return
          // An empty Enter makes `Untitled`, the same as every other "+" (YAZ-4541 S5): an empty name
          // lets the host pick it (`Untitled 2`… on a clash), and the add still stays on the board.
          onNewInGroup(group, adding.name.trim(), at)
          setAdding({ key, name: '' })
        }}
      />
    ) : (
      <button type="button" className="view-board__add" aria-label="New card" onClick={() => setAdding({ key, name: '' })}>
        + New card
      </button>
    )
  }

  /**
   * The nested sections under `parent` (YAZ-745): level 2 and each deeper level inside the one above (up to `MAX_GROUP_LEVELS`, YAZ-4531, YAZ-3746 13AF).
   * Each section shows the merge rule's direct cards, then its own subgroups.
   */
  const subgroups = (parent: Group, parentAt: GroupSpot): ReactNode => {
    if (parent.children === undefined || parent.children.length === 0) return null
    const at = childSpot(parent, parentAt)
    return (
      <div className="view-board__subgroups">
        {parent.children.map((child) => {
          const ck = spotKey(child, at)
          const childCollapsed = collapsed.includes(ck)
          const childOver = dnd.over === ck
          // A section with sections inside takes drops on its header only, as a column does: a drop
          // bubbles, and the outer section would move the card a second time.
          const nested = child.children !== undefined
          const header = (
            <GroupHeader
              def={def}
              view={view}
              columns={keys}
              groupKey={child.key}
              label={child.label}
              rows={child.rows}
              collapsed={childCollapsed}
              onToggle={() => onToggleGroup(ck)}
              onNew={onNewInGroup === undefined || !adds[at.level] ? undefined : () => onNewInGroup(child, undefined, at)}
              newButton={newCards}
              resolve={resolve}
              level={at.level}
            />
          )
          return (
            <section key={ck} className={`view-board__subgroup${childOver ? ' view-board__subgroup--drop' : ''}`} {...(nested ? {} : dnd.target(child, at))}>
              {nested ? (
                <div className="view-board__subgroup-header" {...dnd.target(child, at)}>
                  {header}
                </div>
              ) : (
                header
              )}
              {!childCollapsed && (child.children === undefined ? cardList(child.rows, child, at, childOver) : (child.direct?.length ?? 0) > 0 && cardList(child.direct ?? [], child, at, childOver))}
              {!childCollapsed && subgroups(child, at)}
              {!childCollapsed && child.children === undefined && adds[at.level] && inlineAdd(child, ck, at)}
            </section>
          )
        })}
      </div>
    )
  }

  return (
    <>
      <div className="view-board" ref={setBoardRoot} onKeyDown={onCardKeyDown} style={{ '--view-board-col-w': `${width}px` } as CSSProperties}>
        {groups.map((g) => {
          const outerAt = TOP_SPOT
          const gk = spotKey(g, outerAt)
          const isCollapsed = collapsed.includes(gk)
          const isOver = dnd.over === gk
          const header = (
            <GroupHeader
              def={def}
              view={view}
              columns={keys}
              groupKey={g.key}
              label={g.label}
              rows={g.rows}
              collapsed={isCollapsed}
              onToggle={() => onToggleGroup(gk)}
              onNew={onNewInGroup === undefined || !adds[0] ? undefined : () => onNewInGroup(g)}
              newButton={newCards}
              resolve={resolve}
              level={0}
            />
          )
          return (
            <section
              key={gk}
              className={`view-board__col${g.children === undefined ? '' : ' view-board__col--nested'}${isOver ? ' view-board__col--drop' : ''}`}
              {...(g.children === undefined ? dnd.target(g, outerAt) : {})}
            >
              {g.children === undefined ? (
                header
              ) : (
                <div className="view-board__col-header" {...dnd.target(g, outerAt)}>
                  {header}
                </div>
              )}
              {!isCollapsed && (
                <>
                  {g.children === undefined ? (
                    cardList(g.rows, g, outerAt, isOver)
                  ) : (
                    <>
                      {(g.direct?.length ?? 0) > 0 && cardList(g.direct ?? [], g, outerAt, isOver)}
                      {subgroups(g, outerAt)}
                    </>
                  )}
                </>
              )}
              {!isCollapsed && g.children === undefined && adds[0] && inlineAdd(g, gk)}
            </section>
          )
        })}
      </div>
      {menu !== null && (
        <PageContextMenu
          x={menu.x}
          y={menu.y}
          path={menu.path}
          title={menu.title}
          onOpenRight={onOpenFileRight}
          onOpenBackground={onOpenFileBackground}
          onOpenWindow={onOpenWindow}
          onNotice={onNotice}
          onClose={() => setMenu(null)}
          {...cardMenuItems(noteDoors, menu.path, () => setMenu(null), noteDoors?.newBelow === undefined ? undefined : { label: 'New card below', run: () => noteDoors.newBelow!(menu.path) })}
        />
      )}
    </>
  )
}
