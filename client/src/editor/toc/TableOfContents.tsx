/**
 * THE TABLE OF CONTENTS (YAZ-2700): a note's rows at its right edge, as the React surface of the
 * engine in `tocPlugin.ts`. The two talk through the ONE `TocChannel` the host also hands
 * `createCrepe`: this component draws the channel's snapshot (`useSyncExternalStore`) and calls
 * its two commands, `jump` and `current`. It never reads the document.
 *
 * A ROW is a `{ level, text }` and nothing more. The engine decides what the rows are — the
 * note's H1-H5, or the bullets of a note that has no headings to speak of, or what the reader
 * chose for this note in the page cog (D14) — and this component is never told which.
 *
 * TWO LOOKS, one `<nav>`:
 *  - NAMES (`data-names`): a quiet column of the rows' names beside the text. toc.css pads the
 *    scroller on the right by the column's width, so the names never cover the note.
 *  - LINES: a rail of small lines, one per row, in the page's right gutter. The mouse on the
 *    rail, a click on it, or ⌘J opens a card with the same names ON TOP of the text. A scroll
 *    of the note never opens it (YAZ-2886): only the rail's lines change.
 * `namesShow` picks between them from the setting and the width of this editor's `section.editor`
 * — measured by a ResizeObserver, so it runs on a resize and never on a scroll or a keystroke.
 *
 * THE WIDTH OF THE NAMES (YAZ-2752) is the reader's: a drag of the column's left edge
 * (`.toc__resize`) sets it, from `TOC_MIN_W` to `TOC_MAX_W`, and its release saves it as ONE
 * app-wide setting. The column shows that width, or the room it has here when that is less
 * (`namesRoom`); the saved width never decides WHETHER the names show. The width reaches toc.css
 * as `--toc-width` on `section.editor`, which the column, the scroller's padding and the find bar
 * all read — and a drag writes that variable for each move of the mouse, with no render at all.
 *
 * THE HIERARCHY OF THE NAMES (YAZ-2762) is toc.css's work: a tone for each level, and thin level
 * lines as backgrounds of each name. This component gives it two attributes. `data-path` on a name
 * (`pathLines`) says which level line is on the way from the current row up to its parents. And
 * `data-reading` on the `<nav>` says the reader is moving the note with the wheel: with the setting
 * "Level lines" on "On hover", the path then shows without the mouse on the list.
 *
 * It renders nothing when the setting is off, when the note has fewer than two rows to show,
 * and while a bullet zoom is active (the channel's `hidden`). Then it also holds no listener.
 *
 * WHERE THE READER IS: on the scroller's `scroll` (passive, one read per animation frame) the
 * channel answers which shown row is current. Lines above it are read, the line itself is the
 * accent. State is set only when that index changes, so a scroll inside one section renders nothing.
 * A JUMP names its own row current and holds it until the reader's next wheel, press or key in
 * the note: the last rows of a note can never reach the top of the scroller, and without the
 * hold a click on one of them would light the row below it.
 *
 * A wheel over the table of contents moves ONE thing: a list longer than its box, which stops at
 * its ends, or else the note (`onWheelOverToc`).
 *
 * 🔒 ⌘J is a WINDOW CAPTURE listener, one per table of contents and with no coordinator between
 * them (the find bar's idiom, `FindBar.tsx`): it claims the key while focus stands inside its own
 * `section.editor`; with focus inside no `section.editor` at all, the first visible one in
 * document order claims. A hidden editor never claims, and a note that shows no table of contents
 * never does either.
 *
 * THE FRAME — the measure, the width and its drag, ⌘J, the card's open and close — is
 * `tocFrame.tsx` since YAZ-3486: the code tab's Outline uses the same one.
 */
import { useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore, type CSSProperties, type KeyboardEvent as ReactKeyboardEvent, type MouseEvent as ReactMouseEvent, type RefObject, type WheelEvent as ReactWheelEvent } from 'react'
import { TOC_DEFAULT_W, TOC_MAX_W, type ContentWidth, type TableOfContents as TableOfContentsMode } from '@shared/types'
import { ENOUGH_ROWS, type TocChannel, type TocRow } from './tocChannel'
import { beginTocResize, CLICK_GUARD_MS, EDGE_PX, PinIcon, RAIL_PADDING_PX, shown, useTocBox, useTocCard, useTocLinger, useTocShortcut, useTocWidthVar } from './tocFrame'
import './toc.css'

/**
 * The room `auto` needs beside the text before it shows the names, px: the width of the names
 * column until the reader drags its edge. toc.css's `--toc-width` on `:root` is the same number.
 */
export const TOC_WIDTH = TOC_DEFAULT_W
/** A note narrower than this shows lines even when the names are pinned. */
export const NAMES_FLOOR = 700
/** The least pinned names leave the text, px: what it has at `NAMES_FLOOR` beside names of `TOC_WIDTH`. */
export const TEXT_FLOOR = NAMES_FLOOR - TOC_WIDTH
/** The widest the text column gets per content width: app.css's `--content-max-width` rules on `.app`. */
export const COLUMN_MAX: Record<ContentWidth, number> = { narrow: 1040, medium: 1440, full: Infinity }

/**
 * Names, or lines? `auto` shows the names only when the text column keeps its full width beside
 * them — so never at content width `full`, where the text takes all the room there is. `pinned`
 * shows them down to `NAMES_FLOOR`, at the cost of a narrower column.
 */
export const namesShow = (mode: TableOfContentsMode, noteWidth: number, columnMax: number): boolean =>
  mode === 'pinned' ? noteWidth >= NAMES_FLOOR : mode === 'auto' && noteWidth - TOC_WIDTH >= columnMax

/**
 * The widest the names column gets in a note that shows it (YAZ-2752): never past `TOC_MAX_W`.
 * `pinned` leaves the text `TEXT_FLOOR`. `auto` takes the empty margin beside the text column and
 * no more, so a wider column never narrows the text: the margin is what the note has left of its
 * own scrollbar (`gutter`) and its text column — and never less than the `TOC_WIDTH` that
 * `namesShow` gave the names. So where `namesShow` says names, this is `TOC_WIDTH` or more, and
 * `TOC_MIN_W` always fits.
 */
export const namesRoom = (mode: TableOfContentsMode, noteWidth: number, columnMax: number, gutter = 0): number =>
  Math.min(TOC_MAX_W, mode === 'pinned' ? noteWidth - TEXT_FLOOR : Math.max(TOC_WIDTH, noteWidth - gutter - columnMax))

/** The most rows a table of contents draws, and the most the scroll spy reads per frame. */
export const MAX_ROWS = 200

export interface ShownRow extends TocRow {
  /** Index in the channel's full list: what `jump` takes. */
  index: number
}

/**
 * The rows a note shows: every level (H1-H5, or three depths of bullets) when that is `MAX_ROWS`
 * or fewer, else it drops the deepest level and tries again — levels 1-4, then 1-3, then 1-2
 * (YAZ-3051) — else level 1 only (its first `MAX_ROWS`). A row remembers where it stands in the
 * full list.
 */
export const shownRows = (all: readonly TocRow[]): ShownRow[] => {
  const rows = all.map((row, index) => ({ ...row, index }))
  for (const deepest of [5, 4, 3, 2]) {
    const kept = rows.filter(({ level }) => level <= deepest)
    if (kept.length <= MAX_ROWS) return kept
  }
  return rows.filter(({ level }) => level === 1).slice(0, MAX_ROWS)
}

/**
 * THE PATH (YAZ-2762): for each row, the level whose line is on the way from the current row up
 * to its parents: '' for none, else '1' to '4' (`data-path`), with a 't' after it on a row the
 * path ARRIVES at: a name on the path that is one level in from that line ('1t' is a level 2
 * name below its level 1 parent). A row more than one level in from its parent (an H4 right
 * under an H2) is passed by the parent's line and gets no 't'.
 * A parent's line passes each row below the parent, down to its child on the path. Bullet
 * threading's rule: the path stops at the current row.
 */
export const pathLines = (rows: readonly TocRow[], at: number): string[] => {
  const path = rows.map(() => '')
  let child = at
  for (let i = at - 1; i >= 0 && rows[child].level > 1; i--) {
    if (rows[i].level >= rows[child].level) continue
    for (let row = i + 1; row <= child; row++) path[row] = String(rows[i].level)
    if (rows[child].level === rows[i].level + 1) path[child] += 't'
    child = i
  }
  return path
}

const MAX_PITCH = 10
const MIN_PITCH = 4

/** The rail's row height for `count` lines in `height` px, and whether the rail fits at it. */
export const railPitch = (height: number, count: number): { pitch: number; fits: boolean } => {
  const pitch = Math.min(MAX_PITCH, Math.max(MIN_PITCH, Math.floor(height / Math.max(count, 1))))
  return { pitch, fits: pitch * count <= height }
}

/** The path in the names stays this long after the last turn of the wheel (`data-reading`). */
const WHEEL_LINGER_MS = 1500

export interface TableOfContentsProps {
  /** The host's one channel per editor mount — the very instance `createCrepe` was given. */
  channel: TocChannel
  /** The setting (Settings › Editor › Table of contents). */
  mode: TableOfContentsMode
  /** The content width setting: how wide the text column wants to be, which decides `auto`. */
  contentWidth: ContentWidth
  /** "Pin" and "Unpin" write the SETTING through this. */
  onChangeMode: (mode: TableOfContentsMode) => void
  /** The saved width of the names column, px (the setting). The column shows it, or the room it has when that is less. */
  width: number
  /** A drag of the column's edge writes the SETTING through this, once, on its release. */
  onChangeWidth: (width: number) => void
  /** An element inside this editor's scroller: its `.editor-host` and `section.editor` are found from it. */
  hostRef: RefObject<HTMLElement | null>
  /** Esc and a second ⌘J hand the caret back to the note. */
  onReturnFocus: () => void
}

export function TableOfContents({ channel, mode, contentWidth, onChangeMode, width, onChangeWidth, hostRef, onReturnFocus }: TableOfContentsProps) {
  const { rows: all, hidden } = useSyncExternalStore(channel.subscribe, channel.getState)
  const rows = useMemo(() => shownRows(all), [all])
  const shows = mode !== 'off' && !hidden && rows.length >= ENOUGH_ROWS

  const scrollerOf = (): HTMLElement | null => hostRef.current?.closest<HTMLElement>('.editor-host') ?? null
  const sectionOf = (): HTMLElement | null => hostRef.current?.closest<HTMLElement>('section.editor') ?? null

  // The measure (`tocFrame.tsx`): the section's width picks the look, the scroller's top and height place it.
  const box = useTocBox(shows, scrollerOf, hostRef)
  const [current, setCurrent] = useState(0)
  // Mirror for the scroll spy, which sets state only when the index is a new one.
  const currentRef = useRef(0)
  const { open, setOpen, hoverRef, openedAt, openCard, closeSoon, cancelGrace } = useTocCard()
  const columnMax = COLUMN_MAX[contentWidth]
  const names = shows && namesShow(mode, box.width, columnMax)
  // Read only while the names show: the saved width, or the room this note has when that is less.
  const room = namesRoom(mode, box.width, columnMax, box.gutter)
  const shownWidth = Math.min(width, room)
  const at = Math.min(current, rows.length - 1)

  const navRef = useRef<HTMLElement>(null)
  const trackRef = useRef<HTMLSpanElement>(null)
  /** The row a jump landed on, held as current until the reader moves the note themselves. */
  const lock = useRef<number | null>(null)
  /** ⌘J on a closed card: the names do not exist yet, so the focus lands in a layout effect on the open. */
  const pendingFocus = useRef(false)
  /** Ends the drag of the column's edge that is under way, with nothing saved. */
  const endResize = useRef<(() => void) | null>(null)
  /** The wheel effect's `turn`, for a wheel over the table of contents that moves the note (`onWheelOverToc`). */
  const wheelTurn = useRef<(() => void) | null>(null)

  const focusCurrent = (): void => {
    const nav = navRef.current
    ;(nav?.querySelector<HTMLElement>('.toc__name[aria-current="true"]') ?? nav?.querySelector<HTMLElement>('.toc__name'))?.focus()
  }
  const enter = (): void => {
    if (names || open) {
      focusCurrent()
      return
    }
    pendingFocus.current = true
    openCard()
  }
  const leave = (): void => {
    cancelGrace()
    setOpen(false)
    onReturnFocus()
  }
  const jump = (row: number): void => {
    lock.current = row
    currentRef.current = row
    setCurrent(row)
    // The card has done its work; the names column stays.
    cancelGrace()
    setOpen(false)
    channel.jump(rows[row].index)
  }

  // Mirror for the listeners below, which are registered once per shown table of contents.
  const live = useRef({ enter, leave })
  live.current = { enter, leave }

  // The width of the names column, `--toc-width` on the section (`tocFrame.tsx`).
  useTocWidthVar(names, shownWidth, sectionOf, hostRef, endResize)

  // The scroll spy. At most `MAX_ROWS` rows are read per frame and nothing is written. A new
  // list of rows, a new measure (a resize moves every row), a change of look (the names column
  // narrows the text) and a new width of that column (the text flows again) are each read once
  // without a scroll.
  useEffect(() => {
    if (!shows) return
    const scroller = scrollerOf()
    if (scroller === null) return
    const indices = rows.map(({ index }) => index)
    let frame = 0
    const read = (): void => {
      frame = 0
      if (lock.current !== null) return
      const next = channel.current(indices, scroller)
      // −1: none of the rows is on screen at all. The last answer stands.
      if (next < 0 || next === currentRef.current) return
      currentRef.current = next
      setCurrent(next)
    }
    const onScroll = (): void => {
      if (frame === 0) frame = requestAnimationFrame(read)
    }
    // The list or the layout is a new one: the row a jump held may stand somewhere else now.
    lock.current = null
    if (shown(scroller)) read()
    scroller.addEventListener('scroll', onScroll, { passive: true })
    return () => {
      scroller.removeEventListener('scroll', onScroll)
      if (frame !== 0) cancelAnimationFrame(frame)
    }
  }, [shows, rows, box, names, shownWidth, channel, hostRef]) // eslint-disable-line react-hooks/exhaustive-deps -- `scrollerOf` reads only `hostRef`

  // The reader's own moves in the note: each lets go of a jump's hold, and a turn of the wheel
  // shows the path in the names. It never opens the card (YAZ-2886): a reader who scrolls is
  // reading, and the card would cover the text. ONE linger timer serves a whole burst of wheel
  // events: an event only stamps the time, and the timer re-arms itself for what is left.
  useEffect(() => {
    if (!shows) return
    const scroller = scrollerOf()
    if (scroller === null) return
    // Kept for the cleanup: React has cleared `navRef` by then when the nav goes away.
    const nav = navRef.current
    let lastTurn = 0
    let timer: ReturnType<typeof setTimeout> | null = null
    const unlock = (): void => {
      lock.current = null
    }
    // READING (YAZ-2762): from the first turn of a burst to the end of the linger, the path shows
    // in the names and follows the reader down the list (toc.css, `data-reading`). An attribute
    // on the nav, so a turn of the wheel renders nothing.
    const reading = (on: boolean): void => {
      nav?.toggleAttribute('data-reading', on)
    }
    const linger = (): void => {
      timer = null
      const rest = WHEEL_LINGER_MS - (performance.now() - lastTurn)
      if (rest > 0) {
        timer = setTimeout(linger, rest)
        return
      }
      reading(false)
    }
    /** The reader moved the note with the wheel. */
    const turn = (): void => {
      lastTurn = performance.now()
      if (timer === null) {
        reading(true)
        timer = setTimeout(linger, WHEEL_LINGER_MS)
      }
    }
    const onWheel = (event: WheelEvent): void => {
      unlock()
      // A sideways turn or a pinch (ctrlKey) is not reading down the note.
      if (event.deltaY === 0 || event.ctrlKey) return
      turn()
    }
    wheelTurn.current = turn
    scroller.addEventListener('wheel', onWheel, { passive: true })
    scroller.addEventListener('pointerdown', unlock, { passive: true })
    scroller.addEventListener('keydown', unlock)
    return () => {
      wheelTurn.current = null
      scroller.removeEventListener('wheel', onWheel)
      scroller.removeEventListener('pointerdown', unlock)
      scroller.removeEventListener('keydown', unlock)
      if (timer !== null) clearTimeout(timer)
      reading(false)
    }
  }, [shows, hostRef]) // eslint-disable-line react-hooks/exhaustive-deps -- the rest is read through `live` and refs

  // 🔒 ⌘J, the claim rule in the header (`tocFrame.tsx`). A second ⌘J from inside the table of contents is Esc.
  useTocShortcut(shows, hostRef, navRef, live)

  // A card that lost its reason to be open (names took over, the note zoomed, the setting went
  // off) must not come back open when the lines do.
  useEffect(() => {
    if (!shows || names) setOpen(false)
  }, [shows, names])

  const card = shows && !names && open
  // A closed card stays in the page for `EXIT_MS` as `data-leaving`, so it fades out instead of vanishing.
  const lingers = useTocLinger(card)
  useLayoutEffect(() => {
    if (!card || !pendingFocus.current) return
    pendingFocus.current = false
    focusCurrent()
  }, [card]) // eslint-disable-line react-hooks/exhaustive-deps -- `focusCurrent` reads a ref

  /** The height the rail's lines may take. */
  const railRoom = box.height - 2 * EDGE_PX - RAIL_PADDING_PX
  const { pitch, fits } = railPitch(railRoom, rows.length)
  // A rail too long for the window is clipped, and follows the current line.
  useLayoutEffect(() => {
    const track = trackRef.current
    if (track === null || fits) return
    // In step with the note, as the names are: the current line is as far down the rail as it is down the list.
    track.scrollTop = rows.length > 1 ? (at / (rows.length - 1)) * (track.scrollHeight - track.clientHeight) : 0
  }, [at, rows.length, pitch, fits, shows, names])

  if (!shows) return null

  const onKeyDown = (event: ReactKeyboardEvent<HTMLElement>): void => {
    if (event.key === 'Escape') {
      event.preventDefault()
      event.stopPropagation()
      leave()
      return
    }
    const step = event.key === 'ArrowDown' ? 1 : event.key === 'ArrowUp' ? -1 : 0
    if (step === 0 && event.key !== 'Home' && event.key !== 'End') return
    const items = [...event.currentTarget.querySelectorAll<HTMLElement>('.toc__name')]
    if (items.length === 0) return
    event.preventDefault()
    const from = items.indexOf(document.activeElement as HTMLElement)
    // From a button that is not a name (the rail, "Pin"), an arrow starts at the current one.
    const to = event.key === 'Home' ? 0 : event.key === 'End' ? items.length - 1 : from === -1 ? at : Math.min(items.length - 1, Math.max(0, from + step))
    items[to]?.focus()
  }

  /**
   * The wheel over the table of contents moves ONE thing, never one and then the other:
   *  - a list that is longer than its box scrolls itself, and STOPS at its ends (toc.css:
   *    `overscroll-behavior`): the note must not move under a reader who is only looking
   *    through the names;
   *  - a list that fits has nothing to scroll, so the note moves — no dead strip beside the text.
   * (`section.editor` does not scroll, so nothing else answers a wheel here.)
   * Where the NOTE moves, the reader is reading down it as with a wheel over the note itself — an
   * event the scroller's own listener never gets — so the path shows by the same rule (`wheelTurn`).
   */
  const onWheelOverToc = (event: ReactWheelEvent<HTMLElement>): void => {
    const scroller = scrollerOf()
    if (scroller === null || event.deltaY === 0 || event.ctrlKey) return
    const list = event.target instanceof Element ? event.target.closest('.toc__names') : null
    if (list !== null && list.scrollHeight > list.clientHeight + 1) return
    lock.current = null
    wheelTurn.current?.()
    // deltaMode 1 is lines (a mouse wheel on some drivers); 16px is the browser's own line.
    scroller.scrollTop += event.deltaMode === 1 ? event.deltaY * 16 : event.deltaY
  }

  /**
   * The drag of the column's left edge (`tocFrame.tsx`): each move writes `--toc-width` with no
   * render, and the release writes the setting once. It stops at `TOC_MIN_W` and at the room this note has.
   */
  const startResize = (event: ReactMouseEvent<HTMLElement>): void => beginTocResize(event, sectionOf(), shownWidth, room, onChangeWidth, endResize)

  const nameList = <Names rows={rows} at={at} onPick={jump} />

  return (
    <nav
      ref={navRef}
      className="toc"
      data-names={names ? '' : undefined}
      aria-label="Table of contents"
      style={{ top: box.top, '--toc-height': `${box.height}px`, '--toc-gutter': `${box.gutter}px` } as CSSProperties}
      onKeyDown={onKeyDown}
      // The names column lies over the scroller's own padding: a wheel there still moves the note.
      onWheel={names ? onWheelOverToc : undefined}
      onBlur={(event) => {
        if (!names && !event.currentTarget.contains(event.relatedTarget)) closeSoon()
      }}
    >
      {names ? (
        <>
          {/* Mouse only: the arrow keys walk the names, so the edge never takes the focus. */}
          <div className="toc__resize" aria-hidden onMouseDown={startResize} />
          {/* Offered only where it does something: where there is room for the names anyway, an unpin would change nothing the reader can see. */}
          {mode === 'pinned' && !namesShow('auto', box.width, columnMax) && (
            <button type="button" className="toc__pin toc__pin--off" title="Unpin: go back to the small lines" onClick={() => onChangeMode('auto')}>
              <PinIcon off />
              <span>Unpin</span>
            </button>
          )}
          {nameList}
        </>
      ) : (
        <div
          ref={hoverRef}
          className="toc__hover"
          onMouseEnter={() => {
            cancelGrace()
            if (!open) openCard()
          }}
          onMouseLeave={closeSoon}
          onWheel={onWheelOverToc}
        >
          {(open || lingers) && (
            <div className="toc__card" data-leaving={open ? undefined : ''}>
              <div className="toc__header">
                <span className="toc__title">Table of contents</span>
                {/* Offered only where it does something: names need `NAMES_FLOOR` of width even when pinned. */}
                {mode === 'auto' && box.width >= NAMES_FLOOR && (
                  <button type="button" className="toc__pin" title="Pin: keep the table of contents open beside the note" onClick={() => onChangeMode('pinned')}>
                    <PinIcon />
                    <span>Pin</span>
                  </button>
                )}
              </div>
              {nameList}
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
            <span
              ref={trackRef}
              className="toc__track"
              style={{ '--toc-pitch': `${pitch}px`, '--toc-line': `${pitch < 7 ? 2 : 3}px`, maxHeight: fits ? undefined : Math.max(pitch, railRoom) } as CSSProperties}
            >
              {rows.map((row, i) => (
                <span key={row.index} className="toc__line" data-level={row.level} data-read={i < at ? '' : undefined} data-current={i === at ? '' : undefined} />
              ))}
            </span>
          </button>
        </div>
      )}
    </nav>
  )
}

/**
 * The names themselves: the column's list and the card's. A thin accent MARKER slides to the
 * current name (one `offsetTop` read when the index changes, never per scroll event), and the
 * list fades at an edge that has more behind it — its own scrollbar is hidden, so the fade is
 * what says "there is more".
 */
function Names({ rows, at, onPick }: { rows: readonly ShownRow[]; at: number; onPick: (row: number) => void }) {
  const listRef = useRef<HTMLDivElement>(null)
  const markerRef = useRef<HTMLSpanElement>(null)
  const placed = useRef(false)
  // Computed when the current row changes, never on a scroll inside one section.
  const path = useMemo(() => pathLines(rows, at), [rows, at])

  const edges = (): void => {
    const list = listRef.current
    if (list === null) return
    list.toggleAttribute('data-above', list.scrollTop > 1)
    list.toggleAttribute('data-below', list.scrollTop + list.clientHeight < list.scrollHeight - 1)
  }

  useLayoutEffect(() => {
    const list = listRef.current
    const marker = markerRef.current
    const name = list?.querySelector<HTMLElement>('.toc__name[aria-current="true"]')
    if (!list || !marker || !name) return
    marker.style.transform = `translateY(${name.offsetTop}px)`
    marker.style.height = `${name.offsetHeight}px`
    // A list longer than its box moves WITH the note, like a scrollbar's thumb: the current name
    // stands as far down the box as it is down the list — at the top on the first row, at the
    // bottom on the last, and in step in between. So the marker only ever travels one way while the
    // reader does, and the eye can find it without reading. The first placement does not glide,
    // and under "Reduce Motion" none does: toc.css stops the marker's slide the same way.
    const range = list.scrollHeight - list.clientHeight
    const span = list.scrollHeight - name.offsetHeight
    if (range > 0 && span > 0) {
      const top = (name.offsetTop / span) * range
      const glides = placed.current && typeof list.scrollTo === 'function' && !(window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false)
      if (glides) list.scrollTo({ top, behavior: 'smooth' })
      else list.scrollTop = top
    }
    if (!placed.current) {
      // The first placement is not a move: the marker starts where it belongs, then it may slide.
      void marker.offsetHeight
      marker.toggleAttribute('data-placed', true)
      placed.current = true
    }
    edges()
  }, [at, rows])

  return (
    <div ref={listRef} className="toc__names" onScroll={edges}>
      <span ref={markerRef} className="toc__marker" aria-hidden="true" />
      {rows.map((row, i) => (
        // One tab stop for the list, on the current name; the arrows walk the rest.
        <button
          key={row.index}
          type="button"
          className="toc__name"
          data-level={row.level}
          data-path={path[i] || undefined}
          aria-current={i === at ? 'true' : undefined}
          tabIndex={i === at ? 0 : -1}
          // The full name as a tooltip only where the column cut it.
          onMouseEnter={(event) => {
            const el = event.currentTarget
            el.title = el.scrollWidth > el.clientWidth ? row.text : ''
          }}
          onClick={() => onPick(i)}
        >
          {row.text}
        </button>
      ))}
    </div>
  )
}
