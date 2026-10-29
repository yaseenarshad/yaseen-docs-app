/**
 * THE FRAME OF A TABLE OF CONTENTS (YAZ-2700, YAZ-2752; shared since YAZ-3486): what a note's table
 * of contents (`TableOfContents.tsx`) and a code tab's Outline (`code/outline/CodeOutline.tsx`) do
 * the same way, in one place. Each of them draws its own rows; the frame around the rows is this:
 *
 *  - THE MEASURE (`useTocBox`): the width of `section.editor` picks the look (names or lines), the
 *    scroller's top and height place it. A ResizeObserver, so it costs nothing on a scroll or a key.
 *  - THE WIDTH OF THE NAMES (`useTocWidthVar`, `beginTocResize`): the reader's own, dragged at the
 *    column's left edge and saved once on the release, as `--toc-width` on `section.editor`.
 *  - ⌘J (`useTocShortcut`): a window capture listener with the find bar's claim rule.
 *  - THE CARD of the lines look (`useTocCard`, `useTocLinger`): it opens on the mouse or ⌘J, and
 *    stays `GRACE_MS` after the mouse or the keyboard leaves it.
 *
 * The rules themselves are documented where they were born, in `TableOfContents.tsx`.
 */
import { useEffect, useLayoutEffect, useRef, useState, type MouseEvent as ReactMouseEvent, type MutableRefObject, type RefObject } from 'react'
import { TOC_MIN_W } from '@shared/types'
import { storage } from '../../lib/storage'
import { isNoteKey } from '../noteKeys'

/** The card stays this long after the mouse or the keyboard leaves it. */
export const GRACE_MS = 200
/** A click on the rail right after the mouse opened the card does not close it again. */
export const CLICK_GUARD_MS = 300
/** Room the card keeps clear above and below itself. */
export const EDGE_PX = 16
/** What the rail's lines give up of the height that is left, for the rail's own padding. */
export const RAIL_PADDING_PX = 16
/** A closed card stays mounted this long, so toc.css can fade it out (`data-leaving`). */
export const EXIT_MS = 140

export interface TocBox {
  /** Width of `section.editor`: what `namesShow` reads. */
  width: number
  /** Where the scroller starts inside the section: below the status chips, and a conflict bar when there is one. */
  top: number
  /** Height of the scroller. */
  height: number
  /** Width of the scroller's own scrollbar: 0 when the system overlays it. The table of contents stands left of it. */
  gutter: number
}

export const NO_BOX: TocBox = { width: 0, top: 0, height: 0, gutter: 0 }

/** checkVisibility is absent under jsdom, where nothing is ever hidden — hence the ?? true. */
export const shown = (el: Element | null | undefined): el is HTMLElement => el instanceof HTMLElement && (el.checkVisibility?.() ?? true)

/**
 * The measure: the section's width picks the look, the scroller's top and height place it. A
 * ResizeObserver, so it costs nothing on a scroll or a keystroke — the scroller's BOX does not
 * grow with the note. A hidden tab is not measured (its layout is skipped, YAZ-2195); the
 * observer reports it when it shows. `scrollerOf` is read once per `shows` / `anchor` change.
 */
export function useTocBox(shows: boolean, scrollerOf: () => HTMLElement | null, anchor: unknown): TocBox {
  const [box, setBox] = useState(NO_BOX)
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
  }, [shows, anchor]) // eslint-disable-line react-hooks/exhaustive-deps -- `scrollerOf` reads only what `anchor` names
  return box
}

/**
 * The width of the names column, as the ONE variable toc.css's column, the scroller's padding
 * and the find bar's place all read. It is there only while the names show. A drag writes the
 * same variable itself (`beginTocResize`), so after its release this finds the width already there
 * and the column does not jump. Names that go away under a drag — the editor closes, the window
 * narrows, the note zooms — end it.
 */
export function useTocWidthVar(names: boolean, shownWidth: number, sectionOf: () => HTMLElement | null, anchor: unknown, endResize: MutableRefObject<(() => void) | null>): void {
  useLayoutEffect(() => {
    if (!names) return
    const section = sectionOf()
    if (section === null) return
    section.style.setProperty('--toc-width', `${shownWidth}px`)
    return () => {
      endResize.current?.()
      section.style.removeProperty('--toc-width')
    }
  }, [names, shownWidth, anchor]) // eslint-disable-line react-hooks/exhaustive-deps -- `sectionOf` reads only what `anchor` names
}

/**
 * The drag of the column's left edge, the sidebar edge's way (YAZ-2239): each move writes the
 * width straight to the section's `--toc-width` and sets NO state — the text flows again for
 * every move, and a render on top of that is what made such a drag stutter. The setting is
 * written once, on the release, and only when the width is a new one. Left is wider. The width
 * is whole px and stops at `TOC_MIN_W` and at `room`.
 */
export function beginTocResize(event: ReactMouseEvent<HTMLElement>, section: HTMLElement | null, start: number, room: number, onChangeWidth: (width: number) => void, endResize: MutableRefObject<(() => void) | null>): void {
  // The left button only: a right press opens the system's menu, and its release may never come.
  if (section === null || event.button !== 0) return
  // No text selection under the drag.
  event.preventDefault()
  const edge = event.currentTarget
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

/**
 * 🔒 ⌘J is a WINDOW CAPTURE listener, one per table of contents and with no coordinator between
 * them (the find bar's idiom, `FindBar.tsx`): it claims the key while focus stands inside its own
 * `section.editor`; with focus inside no `section.editor` at all, the first visible one in
 * document order claims. A hidden editor never claims, and one that shows no table of contents
 * never does either. A second ⌘J from inside the table of contents is Esc (`leave`).
 */
export function useTocShortcut(shows: boolean, hostRef: RefObject<HTMLElement | null>, navRef: RefObject<HTMLElement | null>, live: RefObject<{ enter: () => void; leave: () => void }>): void {
  useEffect(() => {
    if (!shows) return
    const onKeyDown = (event: KeyboardEvent): void => {
      // The key as it is now (YAZ-3564 K4): the setting is read at each keydown.
      if (!isNoteKey(event, 'note.toc', storage.getSettings()?.hotkeys)) return
      const section = hostRef.current?.closest('section.editor')
      if (!shown(section)) return
      const active = document.activeElement
      const holder = active instanceof Element ? active.closest('section.editor') : null
      const claims = holder !== null ? holder === section : [...document.querySelectorAll('section.editor')].find(shown) === section
      if (!claims) return
      event.preventDefault()
      event.stopPropagation()
      if (navRef.current !== null && navRef.current.contains(active)) live.current?.leave()
      else live.current?.enter()
    }
    window.addEventListener('keydown', onKeyDown, true)
    return () => window.removeEventListener('keydown', onKeyDown, true)
  }, [shows, hostRef]) // eslint-disable-line react-hooks/exhaustive-deps -- the rest is read through refs
}

export interface TocCard {
  open: boolean
  setOpen: (open: boolean) => void
  /** The rail and the card, as ONE hover target. */
  hoverRef: RefObject<HTMLDivElement | null>
  /** When the card last opened: the rail's click guard reads it. */
  openedAt: MutableRefObject<number>
  openCard: () => void
  closeSoon: () => void
  cancelGrace: () => void
}

/**
 * The card's open state: it opens at once, and closes `GRACE_MS` after the mouse and the keyboard
 * have both left the rail and the card. `stays` keeps it open for something more (the code
 * Outline's "…" menu, which is drawn outside the card).
 */
export function useTocCard(stays?: () => boolean): TocCard {
  const [open, setOpen] = useState(false)
  const hoverRef = useRef<HTMLDivElement>(null)
  const graceTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const openedAt = useRef(0)
  const staysRef = useRef(stays)
  staysRef.current = stays
  /** The mouse is on the rail or the card, or the keyboard is inside them. */
  const held = (): boolean => {
    const el = hoverRef.current
    return (el !== null && (el.matches(':hover') || el.contains(document.activeElement))) || staysRef.current?.() === true
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
  const openCard = (): void => {
    cancelGrace()
    openedAt.current = performance.now()
    setOpen(true)
  }
  useEffect(() => cancelGrace, []) // eslint-disable-line react-hooks/exhaustive-deps -- on unmount; it reads a ref
  return { open, setOpen, hoverRef, openedAt, openCard, closeSoon, cancelGrace }
}

/** A closed card stays in the page for `EXIT_MS` as `data-leaving`, so it fades out instead of vanishing. */
export function useTocLinger(card: boolean): boolean {
  const [lingers, setLingers] = useState(false)
  useEffect(() => {
    if (card) {
      setLingers(true)
      return
    }
    const timer = setTimeout(() => setLingers(false), EXIT_MS)
    return () => clearTimeout(timer)
  }, [card])
  return lingers
}

/** A pin for "Pin"; struck through for "Unpin". The find bar's stroke, so the two read as one family. */
export const PinIcon = ({ off = false }: { off?: boolean }) => (
  <svg width={12} height={12} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth={1.4} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
    <path d="M6 2h4l-.5 4 2 2.5h-7l2-2.5L6 2ZM8 8.5V14" />
    {off && <path d="M3 3l10 10" />}
  </svg>
)
