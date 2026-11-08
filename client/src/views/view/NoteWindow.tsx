import { type KeyboardEvent as ReactKeyboardEvent, type MouseEvent as ReactMouseEvent, type ReactNode, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import type { Row } from '../engine'
import { cellNotePinnedAtStart } from '../../editor/table/cellNoteCard'
import { isNoteKey } from '../../editor/noteKeys'
import { cssZoom } from '../../lib/cssZoom'
import { storage } from '../../lib/storage'

/**
 * The table's side of the card (YAZ-4547 D16): one mutable object per folder page, so a step renders the card and
 * nothing in the table. TableView writes `rows` and `show` at each render; the card writes `current` and calls `show`.
 */
export interface NoteWindowLink {
  /** The table's visible data rows in display order (TableView's `flat`): after filters, sort and groups, collapsed groups left out. */
  rows: readonly Row[]
  /** The note the card shows: its row is marked. Null with no card. */
  current: string | null
  /** Mark the row of `current` (none when null) and scroll it into view. */
  show: () => void
}

export const noteWindowLink = (): NoteWindowLink => ({ rows: [], current: null, show: () => {} })

/** An open card: the note it shows now, and its place, size and pin, kept while the app runs (D17): in memory only. */
export interface NoteWindowMemory {
  /** The note the card shows now: its start, then each step. */
  path: string
  /** The top-left corner after a drag or a resize, in layout px of the folder page; null for the default place. */
  placed: { x: number; y: number } | null
  width: number | null
  height: number | null
  pinned: boolean
}

/** A new memory on `path`: the pin starts as Settings › "Keep cell notes open (pinned)" says (5E, no new setting). */
export const noteWindowMemory = (path: string): NoteWindowMemory => ({ path, placed: null, width: null, height: null, pinned: cellNotePinnedAtStart() })

/**
 * The open cards, by folder page and view tab (YAZ-4547 D17). A tab that sleeps unmounts its folder page; when it
 * mounts again, its card shows again on the same note, at the same place. Bounded: a card that closes drops its
 * entry, and at most `MAX_OPEN_WINDOWS` stay, the oldest open out.
 */
const openWindows = new Map<string, NoteWindowMemory>()
export const MAX_OPEN_WINDOWS = 50

export const noteWindowKey = (folderPath: string, viewName: string): string => JSON.stringify([folderPath, viewName])
export const openNoteWindow = (key: string): NoteWindowMemory | undefined => openWindows.get(key)
export function keepNoteWindow(key: string, memory: NoteWindowMemory): void {
  openWindows.delete(key)
  openWindows.set(key, memory)
  if (openWindows.size > MAX_OPEN_WINDOWS) openWindows.delete(openWindows.keys().next().value!)
}
export const dropNoteWindow = (key: string): void => void openWindows.delete(key)
/** For tests: no card open anywhere. */
export const dropAllNoteWindows = (): void => openWindows.clear()

interface NoteWindowProps {
  /** A full `Editor` on a note (App's `renderNoteEditor`): the tab itself, in the card. */
  renderEditor: (path: string) => ReactNode
  link: NoteWindowLink
  titleOf: (path: string) => string
  /** The card's note, place, size and pin: the card opens on `memory.path` and writes each step there. */
  memory: NoteWindowMemory
  onOpenInTab: (path: string) => void
  onClose: () => void
}

/** The default width, the gap to the folder page's edges, and the least size a resize leaves (the cell-note card's). */
const DEFAULT_WIDTH = 480
const GAP = 12
const MIN_WIDTH = 240
const MIN_HEIGHT = 120

/** The eight resize grips: an edge or a corner, and its sides (-1 left or top, 1 right or bottom). */
const GRIPS: ReadonlyArray<{ name: string; x: -1 | 0 | 1; y: -1 | 0 | 1; cursor: string }> = [
  { name: 'n', x: 0, y: -1, cursor: 'ns-resize' },
  { name: 's', x: 0, y: 1, cursor: 'ns-resize' },
  { name: 'e', x: 1, y: 0, cursor: 'ew-resize' },
  { name: 'w', x: -1, y: 0, cursor: 'ew-resize' },
  { name: 'nw', x: -1, y: -1, cursor: 'nwse-resize' },
  { name: 'se', x: 1, y: 1, cursor: 'nwse-resize' },
  { name: 'ne', x: 1, y: -1, cursor: 'nesw-resize' },
  { name: 'sw', x: -1, y: 1, cursor: 'nesw-resize' },
]

const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(value, max))

/**
 * Where the card goes in `order` from the note at `found` (-1: the note left the list), one step `dir`: a note that
 * left keeps its last place `last`, so › goes to the row now at that place and ‹ to the one before it.
 */
const stepIndex = (found: number, last: number, dir: -1 | 1): number => (found === -1 ? (dir === 1 ? last : last - 1) : found + dir)

/**
 * Open a row in a window (YAZ-4547, 5E D14-D17): a card over the tab's folder page with a full editor on one note,
 * and ‹ › through the table's rows. The cell-note card's look and gestures (`editor/table/cellNoteCard.ts`), in React:
 * drag the head, 8 grips, a double click on the head resets, and the pin. It is rendered by the folder page
 * (`ViewsPane`), so it belongs to that tab; its DOM goes beside the page's scroller (`section.editor`), out of the
 * views' document zoom. One editor is mounted at a time, keyed by the path: a step saves the note and mounts the next.
 * A drag or a resize writes the card's style only: nothing renders while the pointer moves.
 */
export function NoteWindow({ renderEditor, link, titleOf, memory, onOpenInTab, onClose }: NoteWindowProps) {
  const [path, setPath] = useState(memory.path)
  const [pinned, setPinned] = useState(memory.pinned)
  const [host, setHost] = useState<HTMLElement | null>(null)
  const anchorRef = useRef<HTMLSpanElement>(null)
  const cardRef = useRef<HTMLDivElement>(null)
  /** The note's last place in the order: where it stays when it shows twice, and where ‹ › go from when it leaves. */
  const at = useRef(-1)
  const closeRef = useRef(onClose)
  closeRef.current = onClose

  useLayoutEffect(() => {
    const anchor = anchorRef.current
    setHost(anchor?.closest<HTMLElement>('section.editor') ?? anchor?.parentElement ?? null)
  }, [])

  /** The note's place in `order`: its last place while the order still has it there (a note in two groups), else found again. */
  const placeIn = (order: readonly string[]): number => (order[at.current] === path ? at.current : order.indexOf(path))
  const order = link.rows.map((r) => r.record.path)
  const found = placeIn(order)
  if (found !== -1) at.current = found
  const previous = order[stepIndex(found, at.current, -1)]
  const next = order[stepIndex(found, at.current, 1)]

  /** Step through the rows; the order is read now, so a sort or a filter change while the card is open counts. */
  const step = (dir: -1 | 1): boolean => {
    const now = link.rows.map((r) => r.record.path)
    const here = placeIn(now)
    const to = stepIndex(here, here === -1 ? at.current : here, dir)
    const target = now[to]
    if (target === undefined) return false
    at.current = to
    setPath(target)
    return true
  }

  // The table marks the card's row and scrolls it into view; the mark goes with the card.
  useLayoutEffect(() => {
    memory.path = path
    link.current = path
    link.show()
  }, [memory, link, path])
  useEffect(
    () => () => {
      link.current = null
      link.show()
    },
    [link],
  )

  /** The card at its remembered place and size, inside the folder page; returns what shows. */
  const place = (): { left: number; top: number; width: number; height: number } | null => {
    const card = cardRef.current
    if (card === null || host === null) return null
    const W = host.clientWidth
    const H = host.clientHeight
    const width = clamp(memory.width ?? DEFAULT_WIDTH, Math.min(MIN_WIDTH, W), Math.max(MIN_WIDTH, W - 2 * GAP))
    const left = memory.placed === null ? Math.max(0, W - width - GAP) : clamp(memory.placed.x, 0, Math.max(0, W - width))
    const top = memory.placed === null ? GAP : clamp(memory.placed.y, 0, Math.max(0, H - MIN_HEIGHT))
    const height = clamp(memory.height ?? H - top - GAP, MIN_HEIGHT, Math.max(MIN_HEIGHT, H - top))
    card.style.left = `${left}px`
    card.style.top = `${top}px`
    card.style.width = `${width}px`
    card.style.height = `${height}px`
    return { left, top, width, height }
  }

  useLayoutEffect(() => {
    if (host === null) return
    place()
    const observer = new ResizeObserver(() => place())
    observer.observe(host)
    return () => observer.disconnect()
    // `place` reads only refs, the memory and `host`.
  }, [host])

  // Unpinned, a mousedown outside the card closes it (D17). A hidden tab's card hears none: that click is in another tab.
  useEffect(() => {
    if (pinned) return
    const onDown = (event: MouseEvent) => {
      const card = cardRef.current
      if (card === null || (event.target instanceof Node && card.contains(event.target))) return
      if (card.closest('.tabstack__layer--hidden') !== null) return
      closeRef.current()
    }
    document.addEventListener('mousedown', onDown, true)
    return () => document.removeEventListener('mousedown', onDown, true)
  }, [pinned])

  /** A pointer drag: `move` on each move, the cursor on the whole page until the drop. */
  const track = (cursor: string, start: MouseEvent | ReactMouseEvent, move: (dx: number, dy: number) => void) => {
    const zoom = host === null ? 1 : cssZoom(host)
    host?.style.setProperty('--note-window-cursor', cursor)
    host?.classList.add('note-window-tracking')
    const onMove = (event: MouseEvent) => move((event.clientX - start.clientX) / zoom, (event.clientY - start.clientY) / zoom)
    const onUp = () => {
      window.removeEventListener('mousemove', onMove, true)
      window.removeEventListener('mouseup', onUp, true)
      host?.classList.remove('note-window-tracking')
    }
    window.addEventListener('mousemove', onMove, true)
    window.addEventListener('mouseup', onUp, true)
  }

  const onHeadDown = (event: ReactMouseEvent) => {
    if (event.button !== 0 || (event.target instanceof Element && event.target.closest('button') !== null)) return
    event.preventDefault()
    const from = place()
    if (from === null) return
    track('grabbing', event, (dx, dy) => {
      memory.placed = { x: from.left + dx, y: from.top + dy }
      place()
    })
  }

  const onGripDown = (grip: (typeof GRIPS)[number]) => (event: ReactMouseEvent) => {
    if (event.button !== 0 || host === null) return
    event.preventDefault()
    event.stopPropagation()
    const from = place()
    if (from === null) return
    const W = host.clientWidth
    const H = host.clientHeight
    const right = from.left + from.width
    const bottom = from.top + from.height
    track(grip.cursor, event, (dx, dy) => {
      let { left, top, width, height } = from
      if (grip.x === 1) width = clamp(from.width + dx, MIN_WIDTH, Math.max(MIN_WIDTH, W - left))
      if (grip.x === -1) {
        width = clamp(from.width - dx, MIN_WIDTH, Math.max(MIN_WIDTH, right))
        left = right - width
      }
      if (grip.y === 1) height = clamp(from.height + dy, MIN_HEIGHT, Math.max(MIN_HEIGHT, H - top))
      if (grip.y === -1) {
        height = clamp(from.height - dy, MIN_HEIGHT, Math.max(MIN_HEIGHT, bottom))
        top = bottom - height
      }
      memory.placed = { x: left, y: top }
      memory.width = width
      memory.height = height
      place()
    })
  }

  /** The double click on the head: back to the default place and size. */
  const reset = (event: ReactMouseEvent) => {
    if (event.target instanceof Element && event.target.closest('button') !== null) return
    memory.placed = null
    memory.width = null
    memory.height = null
    place()
  }

  const onKeyDown = (event: ReactKeyboardEvent) => {
    // The note's own keys first: an open cell note in the card steps its own notes by the same keys.
    if (event.defaultPrevented && event.key !== 'Escape') return
    const overrides = storage.getSettings()?.hotkeys
    const dir = isNoteKey(event, 'note.nextCellNote', overrides) ? 1 : isNoteKey(event, 'note.previousCellNote', overrides) ? -1 : 0
    if (dir !== 0) {
      if (step(dir)) event.preventDefault()
      return
    }
    if (event.key !== 'Escape' || pinned) return
    // A pop-up of the editor (the `[[` picker, a menu) took this Esc when the caret is still in the card. The editor's
    // own Esc goes back to the sidebar (`escapeToSidebar`): the card closes then too.
    if (event.defaultPrevented && cardRef.current?.contains(document.activeElement)) return
    event.preventDefault()
    event.stopPropagation()
    onClose()
  }

  const title = titleOf(path)
  const keep = (event: ReactMouseEvent) => event.preventDefault()
  const card = (
    <div ref={cardRef} className="note-window" role="dialog" aria-label={`Window: ${title}`} onKeyDown={onKeyDown}>
      <div className="note-window__head" onMouseDown={onHeadDown} onDoubleClick={reset}>
        <span className="cell-note-card__title" title={title}>
          {title}
        </span>
        <button type="button" className="cell-note-card__pin" title={pinned ? 'Unpin window' : 'Pin window'} aria-label={pinned ? 'Unpin window' : 'Pin window'} aria-pressed={pinned} onMouseDown={keep} onClick={() => setPinned((memory.pinned = !pinned))}>
          <svg viewBox="0 0 16 16" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
            <path d="M6 2h4l-.6 4.2L12 9H4l2.6-2.8z" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round" />
            <path d="M8 9v5" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
          </svg>
        </button>
        <button type="button" className="cell-note-card__step" title="Previous row" aria-label="Previous row" disabled={previous === undefined} onMouseDown={keep} onClick={() => step(-1)}>
          ‹
        </button>
        <span className="cell-note-card__count">{found === -1 ? '' : `${found + 1} of ${order.length}`}</span>
        <button type="button" className="cell-note-card__step" title="Next row" aria-label="Next row" disabled={next === undefined} onMouseDown={keep} onClick={() => step(1)}>
          ›
        </button>
        <button
          type="button"
          className="cell-note-card__step note-window__open"
          title="Open in tab"
          aria-label="Open in tab"
          onMouseDown={keep}
          onClick={() => {
            onClose()
            onOpenInTab(path)
          }}
        >
          ↗
        </button>
        <button type="button" className="cell-note-card__close" title="Close window" aria-label="Close window" onMouseDown={keep} onClick={onClose}>
          ×
        </button>
      </div>
      <div key={path} className="note-window__body">
        {renderEditor(path)}
      </div>
      {GRIPS.map((grip) => (
        <span key={grip.name} className="note-window__grip" data-grip={grip.name} onMouseDown={onGripDown(grip)} />
      ))}
    </div>
  )
  return (
    <>
      <span ref={anchorRef} hidden />
      {host !== null && createPortal(card, host)}
    </>
  )
}
