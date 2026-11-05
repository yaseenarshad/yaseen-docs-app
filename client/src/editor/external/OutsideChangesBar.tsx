/**
 * The one-line note (YAZ-3704 D6): how many outside changes the open note has, with **Next change** and
 * **Mark all checked**; after a rewrite or above the limit, "Whole note changed outside the app" with
 * **Dismiss**. The React surface of `outsideChanges.ts`, through the ONE channel the host also hands
 * `createCrepe`: it keeps no state of its own and renders the channel's snapshot. No count, no note.
 * `Editor.tsx` puts it where the conflict bar is and hides it while that bar shows. The words are neutral
 * ("outside"): the app cannot tell an AI's save from a sync pull or another app.
 *
 * Unless the numbered list (YAZ-3998) is pinned left of the note, the count is a button that opens the same rows as a
 * dropdown under the bar; a row's click, Escape or a click elsewhere closes it. Its Pin pins the list, as the table of
 * contents' Pin does.
 */
import { useEffect, useRef, useState, useSyncExternalStore, type MouseEvent, type RefObject } from 'react'
import type { OutsideChangesChannel } from './outsideChangesChannel'
import { OutsideChangeRows, useOutsideRows } from './OutsideChangesList'
import { PinIcon } from '../toc/tocFrame'
import './outsideChanges.css'

/** The buttons act on the list; the caret stays where the reader left it, in the note. */
const hold = (event: MouseEvent): void => event.preventDefault()

/** The dropdown: the numbered rows under the bar, closed by a row's click, Escape or a press outside it. */
function RowsDropdown({ channel, onClose, opener, onPin }: { channel: OutsideChangesChannel; onClose: () => void; opener: RefObject<HTMLElement | null>; onPin?: () => void }) {
  const rows = useOutsideRows(channel)
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const onDown = (event: globalThis.MouseEvent): void => {
      const target = event.target as Node
      if (!ref.current?.contains(target) && !opener.current?.contains(target)) onClose()
    }
    // The dropdown's own Escape (4J2): it closes, and nothing else hears it (the note's Escape would go to the sidebar).
    const onKey = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape') return
      event.preventDefault()
      event.stopPropagation()
      onClose()
    }
    document.addEventListener('mousedown', onDown, true)
    document.addEventListener('keydown', onKey, true)
    return () => {
      document.removeEventListener('mousedown', onDown, true)
      document.removeEventListener('keydown', onKey, true)
    }
  }, [onClose, opener])
  if (rows.length === 0) return null
  return (
    <div ref={ref} className="outside-list outside-list--dropdown" role="dialog" aria-label="Outside changes">
      {onPin && (
        <div className="outside-list__header">
          <span className="outside-list__title">Outside changes</span>
          <button type="button" className="toc__pin" title="Pin: keep the list open left of the note" onMouseDown={hold} onClick={onPin}>
            <PinIcon />
            <span>Pin</span>
          </button>
        </div>
      )}
      <OutsideChangeRows rows={rows} channel={channel} onGo={onClose} />
    </div>
  )
}

/** The time left until a timed glow goes, as "42s" or "1:05". */
const left = (ms: number): string => {
  const seconds = Math.max(0, Math.ceil(ms / 1000))
  return seconds < 60 ? `${seconds}s` : `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`
}

/**
 * The countdown of a timed Glow (the YAZ-4272 demo): "fades in 42s", ticking once a second until the last glow goes. Only
 * while a timed glow shows: an untimed one (until checked) has no countdown, and nothing ticks.
 */
function FadeCountdown({ at, onKeep }: { at: number; onKeep?: () => void }) {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    setNow(Date.now())
    const timer = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(timer)
  }, [at])
  return (
    <>
      <span className="outside-changes-bar__fade">fades in {left(at - now)}</span>
      {/* Catch it before it goes: this page's glow becomes "Until I check it", saved in the note as the cog saves it. */}
      {onKeep !== undefined && (
        <button type="button" className="outside-changes-bar__keep" title="Keep the changes lit until you check them: this page's glow becomes Until I check it" onMouseDown={hold} onClick={onKeep}>
          Keep
        </button>
      )}
    </>
  )
}

export function OutsideChangesBar({ channel, pinned = false, onPin, onKeep }: { channel: OutsideChangesChannel; pinned?: boolean; onPin?: (pinned: boolean) => void; onKeep?: () => void }) {
  const { count, wholeNote, fadesAt } = useSyncExternalStore(channel.subscribe, channel.getState)
  const [open, setOpen] = useState(false)
  const opener = useRef<HTMLButtonElement>(null)
  const close = useRef(() => setOpen(false)).current
  // No count to open (the list emptied, or the whole note changed): the dropdown closes, so the next change finds it closed (4J1).
  if (open && (wholeNote || count === 0)) setOpen(false)
  if (!wholeNote && count === 0) return null
  const words = count === 1 ? '1 outside change in this note' : `${count} outside changes in this note`
  return (
    <div className="outside-changes-bar" role="status">
      {wholeNote ? (
        <>
          <span>Whole note changed outside the app</span>
          {fadesAt !== null && <FadeCountdown at={fadesAt} onKeep={onKeep} />}
          <button type="button" onMouseDown={hold} onClick={() => channel.clear()}>
            Dismiss
          </button>
        </>
      ) : (
        <>
          {pinned ? (
            <span>{words}</span>
          ) : (
            <button ref={opener} type="button" className="outside-changes-bar__count" aria-expanded={open} onMouseDown={hold} onClick={() => setOpen((was) => !was)}>
              {words} ▾
            </button>
          )}
          {fadesAt !== null && <FadeCountdown at={fadesAt} onKeep={onKeep} />}
          <button type="button" onMouseDown={hold} onClick={() => channel.next()}>
            Next change
          </button>
          <button type="button" onMouseDown={hold} onClick={() => channel.clear()}>
            Mark all checked
          </button>
          {!pinned && open && (
            <RowsDropdown
              channel={channel}
              onClose={close}
              opener={opener}
              onPin={
                onPin
                  ? () => {
                      close()
                      onPin(true)
                    }
                  : undefined
              }
            />
          )}
        </>
      )}
    </div>
  )
}
