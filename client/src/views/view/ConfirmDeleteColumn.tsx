import { useEffect, useRef } from 'react'

/** The sheet's copy (YAZ-1513) — pure and separately tested, like `deleteConfirmMessage` next door. */
export function deleteColumnMessage(label: string, key: string, count: number): string {
  return `Delete "${label}"? This removes the column from this page and the "${key}" value from ${count} ${count === 1 ? 'note' : 'notes'}.`
}

interface ConfirmDeleteColumnProps {
  /** What the header says. */
  label: string
  /** The bare frontmatter key the members lose. */
  propKey: string
  /** Direct members currently carrying the key. */
  count: number
  onConfirm: () => void
  onCancel: () => void
}

/**
 * Confirm-first for "Delete column…" (YAZ-1513): the sidebar's delete sheet, mirrored — our own
 * sheet and never a native dialog, initial focus on CANCEL, Esc cancels, Enter confirms,
 * click-away cancels, the confirm button `--danger` because notes ARE rewritten. Keys are handled
 * on the dialog itself (it holds focus) rather than on `window`, so a Popover hosting this sheet
 * does not see the same Escape and close underneath it.
 */
export function ConfirmDeleteColumn({ label, propKey, count, onConfirm, onCancel }: ConfirmDeleteColumnProps) {
  const cancelRef = useRef<HTMLButtonElement>(null)
  useEffect(() => cancelRef.current?.focus(), [])

  return (
    <div
      className="confirm-overlay"
      onMouseDown={(e) => {
        e.stopPropagation()
        onCancel()
      }}
      onKeyDown={(e) => {
        if (e.key === 'Escape') {
          e.preventDefault()
          e.stopPropagation()
          onCancel()
        } else if (e.key === 'Enter') {
          e.preventDefault()
          e.stopPropagation()
          onConfirm()
        }
      }}
    >
      <div className="confirm" role="dialog" aria-modal="true" aria-labelledby="confirm-delete-column-text" onMouseDown={(e) => e.stopPropagation()}>
        <p className="confirm__text" id="confirm-delete-column-text">
          {deleteColumnMessage(label, propKey, count)}
        </p>
        <div className="confirm__actions">
          <button ref={cancelRef} type="button" className="confirm__btn" onClick={onCancel}>
            Cancel
          </button>
          <button type="button" className="confirm__btn confirm__btn--danger" onClick={onConfirm}>
            Delete
          </button>
        </div>
      </div>
    </div>
  )
}
