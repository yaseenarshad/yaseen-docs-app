import { useEffect, useRef, type KeyboardEvent as ReactKeyboardEvent, type ReactNode } from 'react'

/**
 * THE CONFIRM SHEET (YAZ-2201): the app's own sheet, never a native dialog — the eight confirm
 * dialogs each carried a copy of this shell. Initial focus on CANCEL, so a stray Enter arriving
 * from the tree or an input confirms nothing; Esc cancels, Enter confirms, click-away cancels;
 * `role="dialog"` + `aria-modal` labelled by its own text. The confirm button is `--danger` only
 * when something is destroyed.
 *
 * WHERE THE KEYS ARE HEARD (`keys`):
 *  - `window` (most sheets): anywhere in the window while the sheet is up.
 *  - `sheet`: only inside the sheet, which holds focus. For a sheet a KEYSTROKE opens (Enter in
 *    the title input or the inline rename): React flushes its effects inside that keydown's
 *    dispatch, so a window listener would hear the Enter that opened it and confirm unread.
 *  - `contained`: inside the sheet, and neither its keys nor its click-away escape it — a Popover
 *    hosting it must not see the same Escape and close underneath.
 */
export interface ConfirmSheetProps {
  /** The text's id, which labels the dialog. */
  labelId: string
  text: ReactNode
  confirmLabel: string
  danger?: boolean
  keys?: 'window' | 'sheet' | 'contained'
  onConfirm: () => void
  onCancel: () => void
  /** Extra controls between the text and the buttons (the delete sheet's "Don't ask me again"). */
  children?: ReactNode
}

export function ConfirmSheet({ labelId, text, confirmLabel, danger = false, keys = 'window', onConfirm, onCancel, children }: ConfirmSheetProps) {
  const cancelRef = useRef<HTMLButtonElement>(null)

  useEffect(() => cancelRef.current?.focus(), [])

  // preventDefault matters on both keys: Enter would otherwise ALSO activate the focused Cancel.
  const onKey = (e: KeyboardEvent | ReactKeyboardEvent): void => {
    if (e.key !== 'Escape' && e.key !== 'Enter') return
    e.preventDefault()
    if (keys === 'contained') e.stopPropagation()
    if (e.key === 'Escape') onCancel()
    else onConfirm()
  }

  useEffect(() => {
    if (keys !== 'window') return
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [keys, onConfirm, onCancel]) // eslint-disable-line react-hooks/exhaustive-deps -- `onKey` reads exactly these

  return (
    <div
      className="confirm-overlay"
      onMouseDown={(e) => {
        if (keys === 'contained') e.stopPropagation()
        onCancel()
      }}
      onKeyDown={keys === 'window' ? undefined : onKey}
    >
      <div className="confirm" role="dialog" aria-modal="true" aria-labelledby={labelId} onMouseDown={(e) => e.stopPropagation()}>
        <p className="confirm__text" id={labelId}>
          {text}
        </p>
        {children}
        <div className="confirm__actions">
          <button ref={cancelRef} type="button" className="confirm__btn" onClick={onCancel}>
            Cancel
          </button>
          <button type="button" className={danger ? 'confirm__btn confirm__btn--danger' : 'confirm__btn'} onClick={onConfirm}>
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  )
}
