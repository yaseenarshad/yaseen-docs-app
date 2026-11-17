import { useLayoutEffect, useRef } from 'react'
import type { MenuAction } from './menuSections'
import './rowAsk.css'

/**
 * A row's ask in place (`ask`, YAZ-5697): its question, then Cancel (first, with the focus: a stray Enter runs nothing)
 * and the answer, in the confirm sheet's buttons. The focus leaving it (a click elsewhere in the menu) is Cancel.
 */
export default function RowAsk({ ask, tour, onYes, onNo }: { ask: NonNullable<MenuAction['ask']>; tour?: string; onYes: () => void; onNo: () => void }) {
  const cancel = useRef<HTMLButtonElement>(null)
  useLayoutEffect(() => cancel.current?.focus({ preventScroll: true }), [])
  return (
    <div
      className="ctx-menu__ask"
      role="group"
      aria-label={ask.question}
      data-tour={tour}
      onBlur={(e) => {
        if (!(e.relatedTarget instanceof Node && e.currentTarget.contains(e.relatedTarget))) onNo()
      }}
    >
      <p className="confirm__text">{ask.question}</p>
      <div className="confirm__actions">
        <button ref={cancel} type="button" role="menuitem" className="confirm__btn" onClick={onNo}>
          Cancel
        </button>
        <button type="button" role="menuitem" className={ask.danger === true ? 'confirm__btn confirm__btn--danger' : 'confirm__btn'} onClick={onYes}>
          {ask.yes}
        </button>
      </div>
    </div>
  )
}
