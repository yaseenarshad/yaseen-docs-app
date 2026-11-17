import { useEffect, useId, useState } from 'react'
import { Confirm } from '../screens/Confirm'
import { cardActions, type CardAction, type CardActionKind, type CardActionMarks } from './cardActions'
import { useTwoTap } from './twoTap'
import './cardMenu.css'

export interface CardActionRowsProps {
  /** The card's marks now; null while they are read (the rows show, and wait). */
  marks: CardActionMarks | null
  /** The Up next row (the vault reviews). */
  upNext: boolean
  /** The Fix later row (default true); Review's ⋯ has none, as the Mac's Inbox (YAZ-5625). */
  fix?: boolean
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
 *
 * A row with an `ask` (YAZ-5697: Archive card, Title on the front) asks in place instead, as the Mac's card menu does:
 * the first tap turns the row into the app's ask (`Confirm`: the question, Cancel first with the focus, then the answer,
 * touch-sized). It waits with no time limit; Cancel, a tap outside it, Escape or the menu closing run nothing.
 */
export default function CardActionRows({ marks, upNext, fix = true, onAction, disabled = false, rowClassName = 'card-actions__row', ms }: CardActionRowsProps) {
  const group = useId()
  const { armed, tap, cancel } = useTwoTap({ ms })
  const [asking, setAsking] = useState<CardActionKind | null>(null)
  const rows = cardActions(marks ?? { off: false, next: false, fix: false, notitle: false }, { upNext, fix })
  const wait = disabled || marks === null
  // An ask in place: a tap outside it cancels (Escape is the ask's own Cancel).
  useEffect(() => {
    if (asking === null) return
    const down = (e: Event) => {
      const at = e.target instanceof Element ? e.target.closest('[data-two-tap]') : null
      if (at === null || at.getAttribute('data-two-tap') !== group || at.getAttribute('data-action') !== asking) setAsking(null)
    }
    document.addEventListener('pointerdown', down, true)
    return () => document.removeEventListener('pointerdown', down, true)
  }, [asking, group])
  const askRow = rows.find((r) => r.kind === asking && r.ask !== undefined) ?? null
  useEffect(() => {
    if (asking !== null && (askRow === null || wait)) setAsking(null)
  }, [asking, askRow, wait])
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
        if (row === askRow && row.ask !== undefined)
          return (
            <div key={row.kind} className="card-actions__ask" data-two-tap={group} data-action={row.kind}>
              <Confirm
                question={row.ask.question}
                yes={row.ask.yes}
                danger={row.ask.danger === true}
                onNo={() => setAsking(null)}
                onYes={() => {
                  setAsking(null)
                  onAction(row)
                }}
              />
            </div>
          )
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
              if (row.ask === undefined) {
                if (tap(row.kind)) onAction(row)
                return
              }
              cancel()
              setAsking(row.kind)
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
