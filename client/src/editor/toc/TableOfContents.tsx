/**
 * THE TABLE OF CONTENTS (YAZ-2700): a note's rows at its right edge, as the React surface of the
 * engine in `tocPlugin.ts`. The two talk through the ONE `TocChannel` the host also hands
 * `createCrepe`: this component draws the channel's snapshot (`useSyncExternalStore`) and calls
 * its two commands, `jump` and `current`. It never reads the document.
 *
 * A ROW is a `{ level, text }` and nothing more. The engine decides what the rows are — the
 * note's H1-H3, or the bullets of a note that has no headings to speak of, or what the reader
 * chose for this note in the page cog (D14) — and this component is never told which: "heading"
 * below is the name of a row, whatever it stands for in the note.
 *
 * TWO LOOKS, one `<nav>`:
 *  - NAMES (`data-names`): a quiet column of heading names beside the text. toc.css gives the
 *    scroller a right margin of the column's width, so the names never cover the note.
 *  - LINES: a rail of small lines, one per heading, in the page's right gutter. The mouse on the
 *    rail, a click on it, a turn of the wheel over the note, or ⌘J opens a card with the same
 *    names ON TOP of the text.
 * `namesShow` picks between them from the setting and the width of this editor's `section.editor`
 * — measured by a ResizeObserver, so it runs on a resize and never on a scroll or a keystroke.
 *
 * It renders nothing when the setting is off, when the note has fewer than two rows to show,
 * and while a bullet zoom is active (the channel's `hidden`). Then it also holds no listener.
 *
 * WHERE THE READER IS: on the scroller's `scroll` (passive, one read per animation frame) the
 * channel answers which shown heading is current. Lines above it are read, the line itself is the
 * accent. State is set only when that index changes, so a scroll inside one section renders nothing.
 * A JUMP names its own heading current and holds it until the reader's next wheel, press or key in
 * the note: the last headings of a note can never reach the top of the scroller, and without the
 * hold a click on one of them would light the heading below it.
 *
 * The card opens on `wheel`, NOT on `scroll`: typing at the bottom of the window and a jump both
 * scroll the note, and neither is the reader asking where they are. A wheel over the card itself
 * goes on to the note once the card's own list has nowhere left to go.
 *
 * 🔒 ⌘J is a WINDOW CAPTURE listener, one per table of contents and with no coordinator between
 * them (the find bar's idiom, `FindBar.tsx`): it claims the key while focus stands inside its own
 * `section.editor`; with focus inside no `section.editor` at all, the first visible one in
 * document order claims. A hidden editor never claims, and a note that shows no table of contents
 * never does either.
 */
import { useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore, type CSSProperties, type KeyboardEvent as ReactKeyboardEvent, type RefObject, type WheelEvent as ReactWheelEvent } from 'react'
import type { ContentWidth, TableOfContents as TableOfContentsMode } from '@shared/types'
import type { TocChannel, TocHeading } from './tocChannel'
import './toc.css'

/** Width of the names column, px. toc.css's `--toc-width` is the same number. */
export const TOC_WIDTH = 200
/** A note narrower than this shows lines even when the names are kept open. */
export const NAMES_FLOOR = 700
/** The widest the text column gets per content width: app.css's `--content-max-width` rules on `.app`. */
export const COLUMN_MAX: Record<ContentWidth, number> = { narrow: 1040, medium: 1440, full: Infinity }

/**
 * Names, or lines? `auto` shows the names only when the text column keeps its full width beside
 * them — so never at content width `full`, where the text takes all the room there is. `pinned`
 * shows them down to `NAMES_FLOOR`, at the cost of a narrower column.
 */
export const namesShow = (mode: TableOfContentsMode, noteWidth: number, columnMax: number): boolean =>
  mode === 'pinned' ? noteWidth >= NAMES_FLOOR : mode === 'auto' && noteWidth - TOC_WIDTH >= columnMax

/** The most rows a table of contents draws, and the most the scroll spy reads per frame. */
export const MAX_ROWS = 200

export interface TocRow extends TocHeading {
  /** Index in the channel's full list: what `jump` takes. */
  index: number
}

/**
 * The headings a note shows: all of H1-H3 when that is `MAX_ROWS` or fewer, else H1-H2, else H1
 * only (its first `MAX_ROWS`). A row remembers where it stands in the full list.
 */
export const shownHeadings = (all: readonly TocHeading[]): TocRow[] => {
  const rows = all.map((heading, index) => ({ ...heading, index }))
  for (const deepest of [3, 2]) {
    const kept = rows.filter(({ level }) => level <= deepest)
    if (kept.length <= MAX_ROWS) return kept
  }
  return rows.filter(({ level }) => level === 1).slice(0, MAX_ROWS)
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
/** Room the card keeps clear above and below itself; the rail has its own 8px padding on top of it. */
const EDGE_PX = 16
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
  /** An element inside this editor's scroller: its `.editor-host` and `section.editor` are found from it. */
  hostRef: RefObject<HTMLElement | null>
  /** Esc and a second ⌘J hand the caret back to the note. */
  onReturnFocus: () => void
}

export function TableOfContents({ channel, mode, contentWidth, onChangeMode, hostRef, onReturnFocus }: TableOfContentsProps) {
  const { headings, hidden } = useSyncExternalStore(channel.subscribe, channel.getState)
  const rows = useMemo(() => shownHeadings(headings), [headings])
  const shows = mode !== 'off' && !hidden && rows.length >= 2

  const [box, setBox] = useState(NO_BOX)
  const [current, setCurrent] = useState(0)
  // Mirror for the scroll reader, which sets state only when the index is a new one.
  const currentRef = useRef(0)
  const [open, setOpen] = useState(false)
  const names = shows && namesShow(mode, box.width, COLUMN_MAX[contentWidth])
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

  const scrollerOf = (): HTMLElement | null => hostRef.current?.closest<HTMLElement>('.editor-host') ?? null

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

  // The scroll spy. At most `MAX_ROWS` headings are read per frame and nothing is written. A new
  // list of rows, a new measure (a resize moves every heading) and a change of look (the names
  // column narrows the text) are each read once without a scroll.
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
      // −1: none of the headings is on screen at all. The last answer stands.
      if (next < 0 || next === currentRef.current) return
      currentRef.current = next
      setCurrent(next)
    }
    const onScroll = (): void => {
      if (frame === 0) frame = requestAnimationFrame(read)
    }
    // The held row may be another heading, or somewhere else, now.
    lock.current = null
    if (shown(scroller)) read()
    scroller.addEventListener('scroll', onScroll, { passive: true })
    return () => {
      scroller.removeEventListener('scroll', onScroll)
      if (frame !== 0) cancelAnimationFrame(frame)
    }
  }, [shows, rows, box, names, channel, hostRef]) // eslint-disable-line react-hooks/exhaustive-deps -- `scrollerOf` reads only `hostRef`

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
    const onWheel = (event: WheelEvent): void => {
      unlock()
      // A sideways turn or a pinch (ctrlKey) is not reading down the note.
      if (live.current.names || event.deltaY === 0 || event.ctrlKey) return
      const now = performance.now()
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
  // A closed card stays for `EXIT_MS` as `data-leaving`, so it fades out instead of vanishing.
  const [leaving, setLeaving] = useState(false)
  useEffect(() => {
    if (card) {
      setLeaving(true)
      return
    }
    const timer = setTimeout(() => setLeaving(false), EXIT_MS)
    return () => clearTimeout(timer)
  }, [card])
  useLayoutEffect(() => {
    if (!card || !pendingFocus.current) return
    pendingFocus.current = false
    focusCurrent()
  }, [card]) // eslint-disable-line react-hooks/exhaustive-deps -- `focusCurrent` reads a ref

  const { pitch, fits } = railPitch(box.height - 2 * EDGE_PX - 16, rows.length)
  // A rail too long for the window is clipped, and follows the current line.
  useLayoutEffect(() => {
    const track = trackRef.current
    if (track === null || fits) return
    // In step with the note, as the names are: the current line is as far down the rail as it is down the list.
    track.scrollTop = rows.length > 1 ? (at / (rows.length - 1)) * (track.scrollHeight - track.clientHeight) : 0
  }, [at, pitch, fits, shows, names])

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
   *    `overscroll-behavior`). It used to hand the wheel on to the note there, and the note
   *    jumped under a reader who was only looking through the names;
   *  - a list that fits has nothing to scroll, so the note moves — no dead strip beside the text;
   *  - a card that is FOLLOWING (above) lets the note move: it opened under the mouse because of
   *    that very scroll, and must not stop it.
   * (`section.editor` does not scroll, so nothing else answers a wheel here.)
   */
  const onWheelOverCard = (event: ReactWheelEvent<HTMLElement>): void => {
    const scroller = scrollerOf()
    if (scroller === null || event.deltaY === 0 || event.ctrlKey) return
    const list = event.target instanceof Element ? event.target.closest('.toc__names') : null
    if (!following.current && list !== null && list.scrollHeight > list.clientHeight + 1) return
    lock.current = null
    // deltaMode 1 is lines (a mouse wheel on some drivers); 16px is the browser's own line.
    scroller.scrollTop += event.deltaMode === 1 ? event.deltaY * 16 : event.deltaY
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
      onWheel={names ? onWheelOverCard : undefined}
      onBlur={(event) => {
        if (!names && !event.currentTarget.contains(event.relatedTarget)) closeSoon()
      }}
    >
      {names ? (
        <>
          {/* Offered only where it does something: where there is room for the names anyway, an unpin would change nothing the reader can see. */}
          {mode === 'pinned' && !namesShow('auto', box.width, COLUMN_MAX[contentWidth]) && (
            <button type="button" className="toc__keep toc__keep--stop" title="Unpin: go back to the small lines" onClick={() => onChangeMode('auto')}>
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
          onWheel={onWheelOverCard}
        >
          {(open || leaving) && (
            <div className="toc__card" data-leaving={open ? undefined : ''}>
              <div className="toc__header">
                <span className="toc__title">Table of contents</span>
                {/* Offered only where it does something: names need `NAMES_FLOOR` of width even when kept open. */}
                {mode === 'auto' && box.width >= NAMES_FLOOR && (
                  <button type="button" className="toc__keep" title="Pin: keep the table of contents open beside the note" onClick={() => onChangeMode('pinned')}>
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
              style={{ '--toc-pitch': `${pitch}px`, '--toc-line': `${pitch < 7 ? 2 : 3}px`, maxHeight: fits ? undefined : Math.max(pitch, box.height - 2 * EDGE_PX - 16) } as CSSProperties}
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
function Names({ rows, at, onPick }: { rows: readonly TocRow[]; at: number; onPick: (row: number) => void }) {
  const listRef = useRef<HTMLDivElement>(null)
  const markerRef = useRef<HTMLSpanElement>(null)
  const placed = useRef(false)

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
    // stands as far down the box as it is down the list — at the top on the first heading, at the
    // bottom on the last, and in step in between. So the marker only ever travels one way while the
    // reader does, and the eye can find it without reading. (The first placement does not glide.)
    const range = list.scrollHeight - list.clientHeight
    const span = list.scrollHeight - name.offsetHeight
    if (range > 0 && span > 0) {
      const top = (name.offsetTop / span) * range
      if (placed.current && typeof list.scrollTo === 'function') list.scrollTo({ top, behavior: 'smooth' })
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
