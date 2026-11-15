import { useEffect, useId } from 'react'
import { cardActions, type CardAction, type CardActionMarks } from './cardActions'
import { useTwoTap } from './twoTap'
import './cardMenu.css'

export interface CardActionRowsProps {
  /** The card's marks now; null while they are read (the rows show, and wait). */
  marks: CardActionMarks | null
  /** The Up next row (the vault reviews). */
  upNext: boolean
  /** The second tap, in time: the host writes it (and closes its menu, says what was done). */
  onAction: (action: CardAction) => void
  /** Every row waits (no card line to change). */
  disabled?: boolean
  /** The host menu's row class (Review's `review__menu-row`); the reader's by default. */
  rowClassName?: string
  /** Tests: the time of the rule. */
  ms?: number
}

/**
 * THE CARD ACTIONS: ONE shared, lazy block of rows, put in a host's own menu (Review's ⋯, the card view's
 * ⋯, a page card's ⋯). Every row needs two taps (`twoTap.ts`): the first turns the row into "Tap again to …" in place,
 * the second, within about 3 s, does it. A tap anywhere but this row, Escape, or the menu closing cancels.
 * No wrapper: the rows are the host menu's own `menuitem`s; the live line (VoiceOver) goes first, so a host's
 * `:last-child` rule still finds its last row.
 */
export default function CardActionRows({ marks, upNext, onAction, disabled = false, rowClassName = 'card-actions__row', ms }: CardActionRowsProps) {
  const group = useId()
  const { armed, tap, cancel } = useTwoTap({ ms })
  const rows = marks === null ? cardActions({ off: false, next: false, fix: false, notitle: false }, { upNext }) : cardActions(marks, { upNext })
  const wait = disabled || marks === null
  // Anything else cancels: a tap outside these rows, or Escape.
  useEffect(() => {
    if (armed === null) return
    const down = (e: Event) => {
      const row = e.target instanceof Element ? e.target.closest('[data-two-tap]') : null
      if (row === null || row.getAttribute('data-two-tap') !== group) cancel()
    }
    const key = (e: KeyboardEvent) => void (e.key === 'Escape' && cancel())
    document.addEventListener('pointerdown', down, true)
    document.addEventListener('keydown', key)
    return () => {
      document.removeEventListener('pointerdown', down, true)
      document.removeEventListener('keydown', key)
    }
  }, [armed, group, cancel])
  // A row the marks no longer offer (the card changed under the menu) cannot stay armed.
  const armedRow = rows.find((r) => r.kind === armed) ?? null
  useEffect(() => {
    if (armed !== null && (armedRow === null || wait)) cancel()
  }, [armed, armedRow, wait, cancel])
  return (
    <>
      <span className="sr-only" aria-live="assertive">
        {armedRow?.confirm ?? ''}
      </span>
      {rows.map((row) => {
        const on = armed === row.kind
        return (
          <button
            key={row.kind}
            type="button"
            role="menuitem"
            className={rowClassName}
            data-two-tap={group}
            data-action={row.kind}
            data-armed={on ? '' : undefined}
            disabled={wait}
            onClick={() => {
              if (tap(row.kind)) onAction(row)
            }}
          >
            {on ? (
              <span className="card-actions__confirm">{row.confirm}</span>
            ) : (
              <>
                <span>{row.label}</span>
                {row.hint !== undefined && <span className="card-actions__hint">{row.hint}</span>}
              </>
            )}
          </button>
        )
      })}
    </>
  )
}
