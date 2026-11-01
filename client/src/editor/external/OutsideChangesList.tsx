/**
 * The numbered list of outside changes (YAZ-3998): a column in the empty room LEFT of the note (the table of
 * contents has the right), one row for each change, numbered in the order the changes happened, each with the change
 * word by word as the mouse-over box says it. A click on a row goes to that change as Next change does (`channel.go`).
 *
 * The React surface of `outsideChanges.ts`, through the ONE channel the bar also reads: it reads the rows again only
 * when the channel's version moves (the list, a change's text or the ring changed), never on a keystroke. It renders
 * nothing with no change, in whole-note mode (no rows), and when the room left of the text is less than
 * `LIST_MIN_ROOM`: the bar's Next change still goes through them. Memory only, as the list is.
 */
import { useLayoutEffect, useMemo, useState, useSyncExternalStore, type MouseEvent, type RefObject } from 'react'
import type { OutsideChangesChannel } from './outsideChangesChannel'
import './outsideChanges.css'

/** Below this much room left of the text (px), the list hides. */
export const LIST_MIN_ROOM = 140
const LIST_MAX_WIDTH = 280
/** Kept free between the list and the text. */
const LIST_GAP = 16

/** A row acts on the list; the caret stays where the reader left it, in the note. */
const hold = (event: MouseEvent): void => event.preventDefault()

interface ListBox {
  top: number
  width: number
}

/**
 * Where the list goes: from the scroller's top, as wide as the room left of the text, or null with too little room.
 * Measured by a ResizeObserver, as the table of contents measures its box: on a resize, never on a scroll or a keystroke.
 */
function useListBox(shows: boolean, hostRef: RefObject<HTMLElement | null>): ListBox | null {
  const [box, setBox] = useState<ListBox | null>(null)
  useLayoutEffect(() => {
    const host = hostRef.current
    const scroller = host?.closest<HTMLElement>('.editor-host')
    const section = scroller?.closest<HTMLElement>('.editor')
    if (!shows || !host || !scroller || !section) return
    const measure = (): void => {
      const text = host.querySelector('.ProseMirror') ?? host
      const room = text.getBoundingClientRect().left - section.getBoundingClientRect().left - LIST_GAP
      const next = room < LIST_MIN_ROOM ? null : { top: scroller.offsetTop, width: Math.min(LIST_MAX_WIDTH, room) }
      setBox((previous) => (previous?.top === next?.top && previous?.width === next?.width ? previous : next))
    }
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(section)
    observer.observe(scroller)
    return () => observer.disconnect()
  }, [shows, hostRef])
  return box
}

export function OutsideChangesList({ channel, hostRef }: { channel: OutsideChangesChannel; hostRef: RefObject<HTMLElement | null> }) {
  const version = useSyncExternalStore(channel.subscribeRows, channel.getVersion)
  // eslint-disable-next-line react-hooks/exhaustive-deps -- `version` says when `rows()` answers something new
  const rows = useMemo(() => channel.rows(), [channel, version])
  const box = useListBox(rows.length > 0, hostRef)
  if (rows.length === 0 || box === null) return null
  return (
    <nav className="outside-list" aria-label="Outside changes" style={{ top: box.top, width: box.width }}>
      <div className="outside-list__title">Outside changes</div>
      <ol>
        {rows.map((row) => (
          <li key={row.id}>
            <button type="button" className="outside-list__row" aria-current={row.active ? 'true' : undefined} onMouseDown={hold} onClick={() => channel.go(row.id)}>
              <span className="outside-list__number">{row.number}</span>
              <span className="outside-list__text">
                {row.parts.map((part, index) =>
                  part.kind === 'del' ? <del key={index}>{part.text}</del> : part.kind === 'ins' ? <ins key={index}>{part.text}</ins> : <span key={index}>{part.text}</span>,
                )}
              </span>
            </button>
          </li>
        ))}
      </ol>
    </nav>
  )
}
