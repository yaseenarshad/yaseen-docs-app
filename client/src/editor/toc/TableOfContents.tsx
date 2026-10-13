/**
 * THE TABLE OF CONTENTS (YAZ-2700): a note's rows at its right edge, as the React surface of the
 * engine in `tocPlugin.ts`. The two talk through the ONE `TocChannel` the host also hands
 * `createCrepe`: this component draws the channel's snapshot (`useSyncExternalStore`) and calls
 * its two commands, `jump` and `current`. It never reads the document.
 *
 * A ROW is a `{ level, text }` and nothing more. The engine decides what the rows are — the
 * note's H1-H3, or the bullets of a note that has no headings to speak of, or what the reader
 * chose for this note in the page cog (D14) — and this component is never told which.
 *
 * TWO LOOKS, one `<nav>`:
 *  - NAMES (`data-names`): a quiet column of the rows' names beside the text. toc.css pads the
 *    scroller on the right by the column's width, so the names never cover the note.
 *  - LINES: a rail of small lines, one per row, in the page's right gutter. The mouse on the
 *    rail, a click on it, a turn of the wheel over the note, or ⌘J opens a card with the same
 *    names ON TOP of the text.
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
 * The card opens on `wheel`, NOT on `scroll`: typing at the bottom of the window and a jump both
 * scroll the note, and neither is the reader asking where they are. A wheel over the table of
 * contents moves ONE thing: a list longer than its box, which stops at its ends, or else the note
 * (`onWheelOverToc`).
 *
 * 🔒 ⌘J is a WINDOW CAPTURE listener, one per table of contents and with no coordinator between
 * them (the find bar's idiom, `FindBar.tsx`): it claims the key while focus stands inside its own
 * `section.editor`; with focus inside no `section.editor` at all, the first visible one in
 * document order claims. A hidden editor never claims, and a note that shows no table of contents
 * never does either.
 */
import { useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore, type CSSProperties, type KeyboardEvent as ReactKeyboardEvent, type MouseEvent as ReactMouseEvent, type RefObject, type WheelEvent as ReactWheelEvent } from 'react'
import { TOC_DEFAULT_W, TOC_MAX_W, TOC_MIN_W, type ContentWidth, type TableOfContents as TableOfContentsMode } from '@shared/types'
import { ENOUGH_ROWS, type TocChannel, type TocRow } from './tocChannel'
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
 * The rows a note shows: all three levels (H1-H3, or three depths of bullets) when that is
 * `MAX_ROWS` or fewer, else levels 1-2, else level 1 only (its first `MAX_ROWS`). A row remembers
 * where it stands in the full list.
 */
export const shownRows = (all: readonly TocRow[]): ShownRow[] => {
  const rows = all.map((row, index) => ({ ...row, index }))
  for (const deepest of [3, 2]) {
    const kept = rows.filter(({ level }) => level <= deepest)
    if (kept.length <= MAX_ROWS) return kept
  }
  return rows.filter(({ level }) => level === 1).slice(0, MAX_ROWS)
}

/**
 * THE PATH (YAZ-2762): for each row, the level whose line is on the way from the current row up
 * to its parents: '' for none, else '1' or '2' (`data-path`), with a 't' after it on a row the
 * path ARRIVES at: a name on the path that is one level in from that line ('1t' is a level 2
 * name below its level 1 parent).
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

/** The card stays this long after the mouse or the keyboard leaves it. */
const GRACE_MS = 200
/** The card stays this long after the last turn of the wheel. */
const WHEEL_LINGER_MS = 1500
/** A click on the rail right after the mouse opened the card does not close it again. */
const CLICK_GUARD_MS = 300
/** Room the card keeps clear above and below itself. */
const EDGE_PX = 16
/** What the rail's lines give up of the height that is left, for the rail's own padding. */
const RAIL_PADDING_PX = 16
/** A closed card stays mounted this long, so toc.css can fade it out (`data-leaving`). */
const EXIT_MS = 140
/** The wheel opens the card only after this much travel: a nudge of the trackpad is not reading down the note. */
const WHEEL_OPEN_PX = 40
/** Two wheel events further apart than this are two separate turns. */
const WHEEL_BURST_MS = 300

interface Box {
  /** Width of `section.editor`: what `namesShow` reads. */
  width: number
  /** Where the scroller starts inside the section: below the status chips, and a conflict bar when there is one. */
  top: number
  /** Height of the scroller. */
  height: number
  /** Width of the scroller's own scrollbar: 0 when the system overlays it. The table of contents stands left of it. */
  gutter: number
}

const NO_BOX: Box = { width: 0, top: 0, height: 0, gutter: 0 }

/** checkVisibility is absent under jsdom, where nothing is ever hidden — hence the ?? true. */
const shown = (el: Element | null | undefined): el is HTMLElement => el instanceof HTMLElement && (el.checkVisibility?.() ?? true)

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

  const [box, setBox] = useState(NO_BOX)
  const [current, setCurrent] = useState(0)
  // Mirror for the scroll spy, which sets state only when the index is a new one.
  const currentRef = useRef(0)
  const [open, setOpen] = useState(false)
  const columnMax = COLUMN_MAX[contentWidth]
  const names = shows && namesShow(mode, box.width, columnMax)
  // Read only while the names show: the saved width, or the room this note has when that is less.
  const room = namesRoom(mode, box.width, columnMax, box.gutter)
  const shownWidth = Math.min(width, room)
  const at = Math.min(current, rows.length - 1)

  const navRef = useRef<HTMLElement>(null)
  const hoverRef = useRef<HTMLDivElement>(null)
  const trackRef = useRef<HTMLSpanElement>(null)
  /** The row a jump landed on, held as current until the reader moves the note themselves. */
  const lock = useRef<number | null>(null)
  const graceTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const openedAt = useRef(0)
  /** ⌘J on a closed card: the names do not exist yet, so the focus lands in a layout effect on the open. */
  const pendingFocus = useRef(false)
  /** Ends the drag of the column's edge that is under way, with nothing saved. */
  const endResize = useRef<(() => void) | null>(null)

  const scrollerOf = (): HTMLElement | null => hostRef.current?.closest<HTMLElement>('.editor-host') ?? null
  const sectionOf = (): HTMLElement | null => hostRef.current?.closest<HTMLElement>('section.editor') ?? null

  /** The mouse is on the rail or the card, or the keyboard is inside them. */
  const held = (): boolean => {
    const el = hoverRef.current
    return el !== null && (el.matches(':hover') || el.contains(document.activeElement))
  }
  const cancelGrace = (): void => {
    if (graceTimer.current !== null) clearTimeout(graceTimer.current)
    graceTimer.current = null
  }
  const closeSoon = (): void => {
    cancelGrace()
    graceTimer.current = setTimeout(() => {
      graceTimer.current = null
      if (!held()) setOpen(false)
    }, GRACE_MS)
  }
  /**
   * FOLLOWING: the card opened because the reader is scrolling the NOTE, and the mouse has not
   * moved on it since. Its list then does not take the wheel (toc.css stops it scrolling by
   * itself) — the wheel goes on to the note, and the list keeps step with it. A real move of the
   * mouse on the card ends it: now the reader means the card.
   */
  const following = useRef(false)
  const follow = (on: boolean): void => {
    following.current = on
    hoverRef.current?.toggleAttribute('data-follow', on)
  }
  const openCard = (): void => {
    cancelGrace()
    follow(false)
    openedAt.current = performance.now()
    setOpen(true)
  }
  const openByWheel = (): void => {
    openCard()
    follow(true)
  }
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
  const live = useRef({ names, open, enter, leave, openByWheel })
  live.current = { names, open, enter, leave, openByWheel }

  // The measure: the section's width picks the look, the scroller's top and height place it. A
  // ResizeObserver, so it costs nothing on a scroll or a keystroke — the scroller's BOX does not
  // grow with the note. A hidden tab is not measured (its layout is skipped, YAZ-2195); the
  // observer reports it when it shows.
  useLayoutEffect(() => {
    if (!shows) return
    const scroller = scrollerOf()
    const section = scroller?.closest<HTMLElement>('.editor')
    if (!scroller || !section) return
    const measure = (): void =>
      setBox((previous) => {
        const next = { width: section.clientWidth, top: scroller.offsetTop, height: scroller.clientHeight, gutter: scroller.offsetWidth - scroller.clientWidth }
        return next.width === previous.width && next.top === previous.top && next.height === previous.height && next.gutter === previous.gutter ? previous : next
      })
    if (shown(section)) measure()
    const observer = new ResizeObserver(measure)
    observer.observe(section)
    observer.observe(scroller)
    return () => observer.disconnect()
  }, [shows, hostRef]) // eslint-disable-line react-hooks/exhaustive-deps -- `scrollerOf` reads only `hostRef`

  // The width of the names column, as the ONE variable toc.css's column, the scroller's padding
  // and the find bar's place all read. It is there only while the names show. A drag writes the
  // same variable itself (`startResize`), so after its release this finds the width already there
  // and the column does not jump. Names that go away under a drag — the editor closes, the window
  // narrows, the note zooms — end it.
  useLayoutEffect(() => {
    if (!names) return
    const section = sectionOf()
    if (section === null) return
    section.style.setProperty('--toc-width', `${shownWidth}px`)
    return () => {
      endResize.current?.()
      section.style.removeProperty('--toc-width')
    }
  }, [names, shownWidth, hostRef]) // eslint-disable-line react-hooks/exhaustive-deps -- `sectionOf` reads only `hostRef`

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
  // opens the card in lines mode. ONE linger timer serves a whole burst of wheel events: an event
  // only stamps the time, and the timer re-arms itself for what is left.
  useEffect(() => {
    if (!shows) return
    const scroller = scrollerOf()
    if (scroller === null) return
    let lastWheel = 0
    let travelled = 0
    let timer: ReturnType<typeof setTimeout> | null = null
    const linger = (): void => {
      timer = null
      const rest = WHEEL_LINGER_MS - (performance.now() - lastWheel)
      if (rest > 0) timer = setTimeout(linger, rest)
      else if (!held()) setOpen(false)
    }
    const unlock = (): void => {
      lock.current = null
    }
    // READING (YAZ-2762): while the reader turns the wheel over the note, and for the card's own
    // linger after, the path shows in the names and follows them down the list (toc.css,
    // `data-reading`). An attribute on the nav, so a turn of the wheel renders nothing.
    let lastTurn = 0
    let pathTimer: ReturnType<typeof setTimeout> | null = null
    const reading = (on: boolean): void => {
      navRef.current?.toggleAttribute('data-reading', on)
    }
    const pathLinger = (): void => {
      pathTimer = null
      const rest = WHEEL_LINGER_MS - (performance.now() - lastTurn)
      if (rest > 0) pathTimer = setTimeout(pathLinger, rest)
      else reading(false)
    }
    const onWheel = (event: WheelEvent): void => {
      unlock()
      // A sideways turn or a pinch (ctrlKey) is not reading down the note.
      if (event.deltaY === 0 || event.ctrlKey) return
      const now = performance.now()
      lastTurn = now
      if (pathTimer === null) {
        reading(true)
        pathTimer = setTimeout(pathLinger, WHEEL_LINGER_MS)
      }
      if (live.current.names) return
      if (now - lastWheel > WHEEL_BURST_MS) travelled = 0
      travelled += Math.abs(event.deltaY)
      lastWheel = now
      if (!live.current.open && travelled < WHEEL_OPEN_PX) return
      if (!live.current.open) live.current.openByWheel()
      if (timer === null) timer = setTimeout(linger, WHEEL_LINGER_MS)
    }
    scroller.addEventListener('wheel', onWheel, { passive: true })
    scroller.addEventListener('pointerdown', unlock, { passive: true })
    scroller.addEventListener('keydown', unlock)
    return () => {
      scroller.removeEventListener('wheel', onWheel)
      scroller.removeEventListener('pointerdown', unlock)
      scroller.removeEventListener('keydown', unlock)
      if (timer !== null) clearTimeout(timer)
      if (pathTimer !== null) clearTimeout(pathTimer)
      reading(false)
    }
  }, [shows, hostRef]) // eslint-disable-line react-hooks/exhaustive-deps -- the rest is read through `live` and refs

  // 🔒 ⌘J, the claim rule in the header.
  useEffect(() => {
    if (!shows) return
    const onKeyDown = (event: KeyboardEvent): void => {
      if (!event.metaKey || event.shiftKey || event.altKey || event.ctrlKey || event.key !== 'j') return
      const section = hostRef.current?.closest('section.editor')
      if (!shown(section)) return
      const active = document.activeElement
      const holder = active instanceof Element ? active.closest('section.editor') : null
      const claims = holder !== null ? holder === section : [...document.querySelectorAll('section.editor')].find(shown) === section
      if (!claims) return
      event.preventDefault()
      event.stopPropagation()
      // A second ⌘J from inside the table of contents is Esc.
      if (navRef.current !== null && navRef.current.contains(active)) live.current.leave()
      else live.current.enter()
    }
    window.addEventListener('keydown', onKeyDown, true)
    return () => window.removeEventListener('keydown', onKeyDown, true)
  }, [shows, hostRef])

  // A card that lost its reason to be open (names took over, the note zoomed, the setting went
  // off) must not come back open when the lines do.
  useEffect(() => {
    if (!shows || names) setOpen(false)
  }, [shows, names])

  useEffect(() => cancelGrace, []) // eslint-disable-line react-hooks/exhaustive-deps -- on unmount; it reads a ref

  const card = shows && !names && open
  // A closed card stays in the page for `EXIT_MS` as `data-leaving`, so it fades out instead of vanishing.
  const [lingers, setLingers] = useState(false)
  useEffect(() => {
    if (card) {
      setLingers(true)
      return
    }
    const timer = setTimeout(() => setLingers(false), EXIT_MS)
    return () => clearTimeout(timer)
  }, [card])
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
   *  - a list that fits has nothing to scroll, so the note moves — no dead strip beside the text;
   *  - a card that is FOLLOWING (above) lets the note move: it opened under the mouse because of
   *    that very scroll, and must not stop it.
   * (`section.editor` does not scroll, so nothing else answers a wheel here.)
   */
  const onWheelOverToc = (event: ReactWheelEvent<HTMLElement>): void => {
    const scroller = scrollerOf()
    if (scroller === null || event.deltaY === 0 || event.ctrlKey) return
    const list = event.target instanceof Element ? event.target.closest('.toc__names') : null
    if (!following.current && list !== null && list.scrollHeight > list.clientHeight + 1) return
    lock.current = null
    // deltaMode 1 is lines (a mouse wheel on some drivers); 16px is the browser's own line.
    scroller.scrollTop += event.deltaMode === 1 ? event.deltaY * 16 : event.deltaY
  }

  /**
   * The drag of the column's left edge, the sidebar edge's way (YAZ-2239): each move writes the
   * width straight to the section's `--toc-width` and sets NO state — the note's text flows again
   * for every move, and a render on top of that is what made such a drag stutter. The setting is
   * written once, on the release, and only when the width is a new one. Left is wider. The width
   * is whole px and stops at `TOC_MIN_W` and at the room this note has.
   */
  const startResize = (event: ReactMouseEvent<HTMLElement>): void => {
    const section = sectionOf()
    // The left button only: a right press opens the system's menu, and its release may never come.
    if (section === null || event.button !== 0) return
    // No text selection under the drag.
    event.preventDefault()
    const edge = event.currentTarget
    const start = shownWidth
    const x0 = event.clientX
    let next = start
    const move = (ev: MouseEvent): void => {
      next = Math.min(room, Math.max(TOC_MIN_W, Math.round(start + x0 - ev.clientX)))
      section.style.setProperty('--toc-width', `${next}px`)
    }
    const end = (): void => {
      window.removeEventListener('mousemove', move)
      window.removeEventListener('mouseup', up)
      document.body.style.cursor = ''
      edge.toggleAttribute('data-active', false)
      endResize.current = null
    }
    const up = (): void => {
      end()
      if (next !== start) onChangeWidth(next)
    }
    window.addEventListener('mousemove', move)
    window.addEventListener('mouseup', up)
    document.body.style.cursor = 'col-resize'
    edge.toggleAttribute('data-active', true)
    endResize.current = end
  }

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
          // A REAL move (the browser's own re-hit-test after a layout change moves nothing).
          onMouseMove={(event) => {
            if (following.current && (event.movementX !== 0 || event.movementY !== 0)) follow(false)
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

/** A pin for "Pin"; struck through for "Unpin". The find bar's stroke, so the two read as one family. */
const PinIcon = ({ off = false }: { off?: boolean }) => (
  <svg width={12} height={12} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth={1.4} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
    <path d="M6 2h4l-.5 4 2 2.5h-7l2-2.5L6 2ZM8 8.5V14" />
    {off && <path d="M3 3l10 10" />}
  </svg>
)

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
