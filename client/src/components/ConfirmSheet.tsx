import { useEffect, useRef, type KeyboardEvent as ReactKeyboardEvent, type ReactNode } from 'react'

/**
 * THE CONFIRM SHEET (YAZ-2201): the app's own sheet, never a native dialog — the confirm
 * dialogs each carried a copy of this shell. Initial focus on CANCEL — on the confirm button for a
 * sheet that destroys nothing (`focusConfirm`, YAZ-2690); Esc cancels, Enter confirms, click-away cancels;
 * `role="dialog"` + `aria-modal` labelled by its own text. The confirm button is `--danger` only
 * when something is destroyed. When the sheet goes, focus goes back to where it was.
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
  /** While true, the confirm button and Enter do nothing (YAZ-2677 🔒 D2): the sheet waits for input in `children`. */
  confirmDisabled?: boolean
  /** Extra controls between the text and the buttons (the "Don't ask me again" of the delete sheet and of the rename sheet). */
  children?: ReactNode
  /**
   * The keyboard focus is on the CONFIRM button when the sheet shows (YAZ-2690 D1), for a sheet
   * that destroys nothing: the rename sheet. Enter confirms on each button of a sheet, so the
   * focus then says what Enter does. Not given, the focus is on Cancel.
   */
  focusConfirm?: boolean
}

export function ConfirmSheet({ labelId, text, confirmLabel, danger = false, keys = 'window', onConfirm, onCancel, confirmDisabled = false, children, focusConfirm = false }: ConfirmSheetProps) {
  const cancelRef = useRef<HTMLButtonElement>(null)
  const confirmRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    const before = document.activeElement
    ;(focusConfirm ? confirmRef : cancelRef).current?.focus()
    return () => {
      if (before instanceof HTMLElement && before.isConnected) before.focus()
    }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps -- once, as the sheet opens

  // preventDefault matters on both keys: Enter would otherwise ALSO activate the focused Cancel.
  const onKey = (e: KeyboardEvent | ReactKeyboardEvent): void => {
    if (e.key !== 'Escape' && e.key !== 'Enter') return
    e.preventDefault()
    if (keys === 'contained') e.stopPropagation()
    // A held Enter is no answer (YAZ-2690 S3; the rule of YAZ-2669): the repeats of the press that
    // opened a sheet arrive inside it, and would confirm it before a word of it is read.
    if (e.key === 'Enter' && e.repeat) return
    if (e.key === 'Escape') onCancel()
    else if (!confirmDisabled) onConfirm()
  }

  useEffect(() => {
    if (keys !== 'window') return
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [keys, onConfirm, onCancel, confirmDisabled]) // eslint-disable-line react-hooks/exhaustive-deps -- `onKey` reads exactly these

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
          <button ref={confirmRef} type="button" className={danger ? 'confirm__btn confirm__btn--danger' : 'confirm__btn'} disabled={confirmDisabled} onClick={onConfirm}>
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  )
}
