/**
 * An ask in place (YAZ-5690 round 3, Yaseen: "too easy to click"; the same shape as YAZ-5697's card ⋯ row ask): a short
 * question, then Cancel (first, with the focus: a stray Enter or a second click on the same spot runs nothing) and the
 * answer, in the confirm sheet's buttons (`confirm__text`, `confirm__btn`). Esc is Cancel, and only Cancel: the key
 * stops here, so the menu around it stays open (`escape="menu"`: the menu's own Esc closes it, YAZ-5697). The focus leaving it (a click elsewhere) is Cancel too.
 *
 * ONE piece for every in-place ask: the Review cards menu's and the phone sheet's "Add today" (`AddMoreField`), and the
 * menus' row ask (YAZ-5697, `sidebar/RowAsk.tsx`, the card ⋯ menu). `buttonRole` lets a menu keep its `menuitem` roles.
 */
import { useLayoutEffect, useRef } from 'react'

export interface AskInPlaceProps {
  question: string
  /** The answer's word: "Add", "Archive". */
  yes: string
  danger?: boolean
  onYes: () => void
  onNo: () => void
  className?: string
  buttonRole?: 'menuitem'
  tour?: string
  /** Esc: Cancel here (the default), or left to the menu around it, which closes and so runs nothing (YAZ-5697's row ask). */
  escape?: 'cancel' | 'menu'
}

export function AskInPlace({ question, yes, danger = false, onYes, onNo, className, buttonRole, tour, escape = 'cancel' }: AskInPlaceProps) {
  const cancel = useRef<HTMLButtonElement>(null)
  useLayoutEffect(() => cancel.current?.focus({ preventScroll: true }), [])
  return (
    <div
      className={className === undefined ? 'ask-in-place' : `ask-in-place ${className}`}
      role="group"
      aria-label={question}
      data-tour={tour}
      onKeyDown={(e) => {
        if (e.key !== 'Escape' || escape === 'menu') return
        e.preventDefault()
        e.stopPropagation()
        onNo()
      }}
      onBlur={(e) => {
        if (!(e.relatedTarget instanceof Node && e.currentTarget.contains(e.relatedTarget))) onNo()
      }}
    >
      <p className="confirm__text">{question}</p>
      <div className="confirm__actions">
        <button ref={cancel} type="button" role={buttonRole} className="confirm__btn" onMouseDown={(e) => e.preventDefault()} onClick={onNo}>
          Cancel
        </button>
        <button type="button" role={buttonRole} className={danger ? 'confirm__btn confirm__btn--danger' : 'confirm__btn'} onMouseDown={(e) => e.preventDefault()} onClick={onYes}>
          {yes}
        </button>
      </div>
    </div>
  )
}
