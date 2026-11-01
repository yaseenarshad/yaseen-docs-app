/**
 * The numbered list of outside changes (YAZ-3998): a column LEFT of the note (the table of
 * contents has the right), one row for each change, numbered in the order the changes happened, each with the change
 * word by word as the mouse-over box says it. A click on a row goes to that change as Next change does (`channel.go`).
 *
 * The React surface of `outsideChanges.ts`, through the ONE channel the bar also reads: it reads the rows again only
 * when the channel's version moves (the list, a change's text or the ring changed), never on a keystroke. It renders
 * nothing with no change and in whole-note mode (no rows). It shows only while pinned (Settings › Pin default, which
 * its Unpin writes, as the table of contents' does), and the note's text then makes room for it (outsideChanges.css,
 * `--outside-list-width`, as the table of contents' column does on the right); unpinned, the bar's count opens the same
 * rows as a dropdown (`OutsideChangesBar.tsx`). Memory only, as the list is.
 */
import { useLayoutEffect, useMemo, useState, useSyncExternalStore, type MouseEvent, type RefObject } from 'react'
import type { OutsideChangeRow, OutsideChangesChannel } from './outsideChangesChannel'
import { PinIcon } from '../toc/tocFrame'
import './outsideChanges.css'

/** A row acts on the list; the caret stays where the reader left it, in the note. */
const hold = (event: MouseEvent): void => event.preventDefault()

/**
 * Where the list starts: the scroller's top (the bars above it come and go), or null before it is measured.
 * Measured by a ResizeObserver, as the table of contents measures its box: on a resize, never on a scroll or a keystroke.
 */
function useListTop(shows: boolean, hostRef: RefObject<HTMLElement | null>): number | null {
  const [top, setTop] = useState<number | null>(null)
  useLayoutEffect(() => {
    const scroller = hostRef.current?.closest<HTMLElement>('.editor-host')
    const section = scroller?.closest<HTMLElement>('.editor')
    if (!shows || !scroller || !section) return
    const measure = (): void => setTop(scroller.offsetTop)
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(section)
    observer.observe(scroller)
    return () => observer.disconnect()
  }, [shows, hostRef])
  return top
}

/** The rows, read again only when the channel's version moves. */
export function useOutsideRows(channel: OutsideChangesChannel): OutsideChangeRow[] {
  const version = useSyncExternalStore(channel.subscribeRows, channel.getVersion)
  // eslint-disable-next-line react-hooks/exhaustive-deps -- `version` says when `rows()` answers something new
  return useMemo(() => channel.rows(), [channel, version])
}

/** The numbered rows, in the column and in the bar's dropdown alike; a click goes to that change, then `onGo`. */
export function OutsideChangeRows({ rows, channel, onGo }: { rows: readonly OutsideChangeRow[]; channel: OutsideChangesChannel; onGo?: () => void }) {
  return (
    <ol>
      {rows.map((row) => (
        <li key={row.id}>
          <button
            type="button"
            className="outside-list__row"
            aria-current={row.active ? 'true' : undefined}
            onMouseDown={hold}
            onClick={() => {
              channel.go(row.id)
              onGo?.()
            }}
          >
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
  )
}

export function OutsideChangesList({ channel, hostRef, onPin }: { channel: OutsideChangesChannel; hostRef: RefObject<HTMLElement | null>; onPin?: (pinned: boolean) => void }) {
  const rows = useOutsideRows(channel)
  const top = useListTop(rows.length > 0, hostRef)
  if (rows.length === 0 || top === null) return null
  return (
    <nav className="outside-list" aria-label="Outside changes" style={{ top }}>
      <div className="outside-list__header">
        <span className="outside-list__title">Outside changes</span>
        {onPin && (
          <button type="button" className="toc__pin" title="Unpin: open the list from the count instead" onMouseDown={hold} onClick={() => onPin(false)}>
            <PinIcon off />
            <span>Unpin</span>
          </button>
        )}
      </div>
      <OutsideChangeRows rows={rows} channel={channel} />
    </nav>
  )
}
