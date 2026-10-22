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
 * the chip and its box cancels. Outside is a `mousedown`, never a `click`: the click that opened the
 * box — on the chip, or on the cog's row that closes its menu — must not also close it.
 */
import { useEffect, useRef } from 'react'
import { LockIcon } from '../views/view/icons'

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

  useEffect(() => {
    if (!asking) return
    const onOutside = (event: MouseEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) cancelRef.current()
    }
    document.addEventListener('mousedown', onOutside, true)
    return () => document.removeEventListener('mousedown', onOutside, true)
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
      <button ref={chipRef} type="button" className="read-only-chip__button" title="Click to allow edits" aria-haspopup="dialog" aria-expanded={asking} onClick={asking ? onCancel : onAsk}>
        <LockIcon size={12} />
        <span>Read only</span>
      </button>
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
