/**
 * THE "READ ONLY" CHIP and its "Allow edits?" box (YAZ-3076 D4, D4a option 1). It shows only while
 * the file is read only, in the status row of a note (cog, zoom, chip, sync, save) and of a board
 * (cog, chip, sync, save) — read only is never silent (S49). A stray key or click never unlocks
 * the file: a click on the chip opens a small box under it, and only "Allow edits" turns the
 * switch off. Turning read only ON never asks; that is the cog's row.
 *
 * The HOST keeps `asking`, so there is one box in one place: the cog's "Read only" row, while on,
 * opens this same box (S47), and each tab has its own (D4). The box takes the focus on "Allow
 * edits", so Enter allows (S46); Esc cancels and hands the focus back to the chip; a press outside
 * the chip and its box cancels, and so does the window losing focus. Outside is a `pointerdown` in
 * the capture phase (YAZ-3116 A1): never a `click`, because the click that opened the box — on the
 * chip, or on the cog's row that closes its menu — must not also close it, and never a `mousedown`,
 * because a read-only drawing's canvas (the engine's view mode) cancels its `pointerdown` to pan, and
 * a cancelled `pointerdown` sends no `mousedown`. A press inside the draw.io frame reaches no event
 * here at all; it moves the focus into the frame, which blurs this window.
 *
 * THE MESSAGE OF AN EDIT ATTEMPT (YAZ-4446, D33 of YAZ-4278). The page's Read only guard tells the pane
 * (`tellReadOnlyEdit`), and the chip shows a small card under itself: a red arrow points up at the chip, and the chip
 * pulses red once. One card for each burst: each attempt starts its time again, and it goes `READ_ONLY_MESSAGE_MS`
 * after the last one. It shows again no sooner than `READ_ONLY_MESSAGE_GAP_MS` after it last showed. The "Allow
 * edits?" box closes it. It is in the chip's own box, absolute, so nothing in the page moves. Its live region
 * (`role="status"`) is always there, so a screen reader reads the card when it comes.
 */
import { useEffect, useRef, useState, type CSSProperties, type RefObject } from 'react'
import { LockIcon } from '../views/view/icons'
import { READ_ONLY_EDIT, READ_ONLY_MESSAGE_GAP_MS, READ_ONLY_MESSAGE_MS, READ_ONLY_PAGE, READ_ONLY_PANE, type ReadOnlyWhat } from './readOnlyEdit'

export interface ReadOnlyChipProps {
  /** The "Allow edits?" box is open. */
  asking: boolean
  /** The chip's click while the box is closed. */
  onAsk: () => void
  /** "Allow edits": the host turns read only off, in the file. */
  onAllow: () => void
  /** Cancel, Esc, a press outside, or the chip's click while the box is open. */
  onCancel: () => void
}

export function ReadOnlyChip({ asking, onAsk, onAllow, onCancel }: ReadOnlyChipProps) {
  const rootRef = useRef<HTMLDivElement>(null)
  const chipRef = useRef<HTMLButtonElement>(null)
  const cancelRef = useRef(onCancel)
  cancelRef.current = onCancel
  const message = useReadOnlyMessage(rootRef, chipRef, asking)

  useEffect(() => {
    if (!asking) return
    const onOutside = (event: Event) => {
      if (!rootRef.current?.contains(event.target as Node)) cancelRef.current()
    }
    const onBlur = () => cancelRef.current()
    document.addEventListener('pointerdown', onOutside, true)
    window.addEventListener('blur', onBlur)
    return () => {
      document.removeEventListener('pointerdown', onOutside, true)
      window.removeEventListener('blur', onBlur)
    }
  }, [asking])

  return (
    <div ref={rootRef} className="read-only-chip"
      onKeyDown={(event) => {
        if (!asking || event.key !== 'Escape') return
        event.preventDefault()
        event.stopPropagation()
        onCancel()
        chipRef.current?.focus()
      }}>
      <button ref={chipRef} type="button" className={`read-only-chip__button${message === null ? '' : ' read-only-chip__button--pulse'}`} title="Click to allow edits" aria-haspopup="dialog" aria-expanded={asking} onClick={asking ? onCancel : onAsk}>
        <LockIcon size={12} />
        <span>Read only</span>
      </button>
      <div className="read-only-message" role="status">
        {message !== null && (
          <div className="read-only-message__card" style={{ '--read-only-message-arrow': `${message.arrow}px` } as CSSProperties}>
            <span className="read-only-message__arrow" aria-hidden="true">
              <svg width="12" height="14" viewBox="0 0 12 14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M6 13V2M1.5 6.5 6 2l4.5 4.5" />
              </svg>
            </span>
            <span className="read-only-message__icon" aria-hidden="true">
              <LockIcon size={13} />
            </span>
            <span className="read-only-message__text">
              <strong>{message.what === 'drawing' ? 'This drawing is Read only.' : 'This note is Read only.'}</strong>
              <span>Click Read only to allow edits.</span>
            </span>
          </div>
        )}
      </div>
      {asking && (
        <div className="read-only-chip__ask" role="dialog" aria-label="Allow edits">
          <p>Allow edits?</p>
          <div className="read-only-chip__actions">
            <button type="button" className="read-only-chip__allow" autoFocus onClick={onAllow}>Allow edits</button>
            <button type="button" onClick={onCancel}>Cancel</button>
          </div>
        </div>
      )}
    </div>
  )
}

/** What the card says, and where its arrow points: the chip's middle, from the card's right edge. */
interface ReadOnlyMessage {
  what: ReadOnlyWhat
  arrow: number
}

/** The arrow's place when the chip has no width yet (a chip of 12 px text is about 80 px wide). */
const ARROW_FALLBACK = 40

/**
 * The card of an edit attempt (see the module doc): an attempt from this chip's own page shows it, more attempts keep it
 * up, and it goes after the last one. The "Allow edits?" box closes it.
 */
function useReadOnlyMessage(rootRef: RefObject<HTMLDivElement | null>, chipRef: RefObject<HTMLButtonElement | null>, asking: boolean): ReadOnlyMessage | null {
  const [message, setMessage] = useState<ReadOnlyMessage | null>(null)
  const clock = useRef<{ timer: ReturnType<typeof setTimeout> | undefined; shownAt: number; showing: boolean }>({ timer: undefined, shownAt: -Infinity, showing: false })
  const askingRef = useRef(asking)
  askingRef.current = asking

  useEffect(() => {
    const own = rootRef.current
    const pane = own?.closest(READ_ONLY_PANE)
    if (own == null || pane == null) return
    const page = own.closest(READ_ONLY_PAGE)
    const state = clock.current
    const hide = () => {
      state.showing = false
      setMessage(null)
    }
    const onEdit = (event: Event) => {
      if (askingRef.current || !(event.target instanceof Element) || event.target.closest(READ_ONLY_PAGE) !== page) return
      if (!state.showing) {
        const now = Date.now()
        if (now - state.shownAt < READ_ONLY_MESSAGE_GAP_MS) return
        state.showing = true
        state.shownAt = now
        const width = chipRef.current?.offsetWidth ?? 0
        setMessage({ what: (event as CustomEvent<ReadOnlyWhat>).detail, arrow: width > 0 ? width / 2 : ARROW_FALLBACK })
      }
      clearTimeout(state.timer)
      state.timer = setTimeout(hide, READ_ONLY_MESSAGE_MS)
    }
    pane.addEventListener(READ_ONLY_EDIT, onEdit)
    return () => {
      pane.removeEventListener(READ_ONLY_EDIT, onEdit)
      clearTimeout(state.timer)
    }
  }, [rootRef, chipRef])

  // The "Allow edits?" box answers the chip now.
  useEffect(() => {
    if (!asking) return
    const state = clock.current
    clearTimeout(state.timer)
    state.showing = false
    setMessage(null)
  }, [asking])

  return message
}
