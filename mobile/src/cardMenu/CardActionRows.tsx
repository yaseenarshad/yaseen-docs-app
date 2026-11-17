import { Fragment, useEffect, useId, useState } from 'react'
import { CARD_TITLE_HELP, type CardTitleShow } from '@shared/cardTitleAt'
import { Confirm } from '../screens/Confirm'
import { cardActions, type CardAction, type CardActionMarks } from './cardActions'
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
  /** The vault's Show card titles: Title in review's Default says it, "Default (Always)" (YAZ-5696 round 2). */
  titleGlobal?: CardTitleShow
}

/**
 * THE CARD ACTIONS: ONE shared, lazy block of rows, put in a host's own menu (Review's ⋯, the card view's
 * ⋯, a page card's ⋯). Every row needs two taps (`twoTap.ts`): the first turns the row into "Tap again to …" in place,
 * the second, within about 3 s, does it. A tap anywhere but this row, Escape, or the menu closing cancels.
 * No wrapper: the rows are the host menu's own `menuitem`s; the live line (VoiceOver) goes first, so a host's
 * `:last-child` rule still finds its last row.
 *
 * A row with an `ask` (YAZ-5697: Archive card, a Title in review choice) asks in place instead, as the Mac's card menu
 * does: the first tap turns the row into the app's ask (`Confirm`: the question, Cancel first with the focus, then the
 * answer, touch-sized). It waits with no time limit; Cancel, a tap outside it, Escape or the menu closing run nothing.
 * Title in review › (YAZ-5696, YAZ-5697 round 2): a tap opens its choices under it, touch-sized, the one now with ✓.
 */
export default function CardActionRows({ marks, upNext, fix = true, onAction, disabled = false, rowClassName = 'card-actions__row', ms, titleGlobal }: CardActionRowsProps) {
  const group = useId()
  const { armed, tap, cancel } = useTwoTap({ ms })
  const [asking, setAsking] = useState<string | null>(null)
  const [titleOpen, setTitleOpen] = useState(false)
  const [helpOpen, setHelpOpen] = useState(false)
  const rows = cardActions(marks ?? { off: false, next: false, fix: false, notitle: false }, { upNext, fix, titleGlobal })
  // The rows that show: Title in review's choices under it while it is open.
  const shown = rows.flatMap((r) => (r.children !== undefined && titleOpen ? [r, ...r.children] : [r]))
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
  const askRow = shown.find((r) => r.key === asking && r.ask !== undefined) ?? null
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
  const armedRow = shown.find((r) => r.key === armed) ?? null
  useEffect(() => {
    if (armed !== null && (armedRow === null || wait)) cancel()
  }, [armed, armedRow, wait, cancel])
  const press = (row: CardAction): void => {
    if (row.children !== undefined) {
      cancel()
      return setTitleOpen((open) => !open)
    }
    if (row.checked === true) return
    if (row.ask === undefined) {
      if (tap(row.key)) onAction(row)
      return
    }
    cancel()
    setAsking(row.key)
  }
  return (
    <>
      <span className="sr-only" aria-live="assertive">
        {armedRow?.confirm ?? ''}
      </span>
      {shown.map((row) => {
        const on = armed === row.key
        if (row === askRow && row.ask !== undefined)
          return (
            <div key={row.key} className="card-actions__ask" data-two-tap={group} data-action={row.key}>
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
        const button = (
          <button
            key={row.key}
            type="button"
            role={row.key.startsWith('title-') ? 'menuitemradio' : 'menuitem'}
            className={row.key.startsWith('title-') ? `${rowClassName} card-actions__choice` : rowClassName}
            data-two-tap={group}
            data-action={row.key}
            data-armed={on ? '' : undefined}
            aria-expanded={row.children !== undefined ? titleOpen : undefined}
            aria-checked={row.key.startsWith('title-') ? row.checked === true : undefined}
            disabled={wait}
            onClick={() => press(row)}
          >
            {on ? (
              <span className="card-actions__confirm">{row.confirm}</span>
            ) : (
              <>
                <span>{row.label}</span>
                {(row.hint !== undefined || row.checked === true) && <span className="card-actions__hint">{row.checked === true ? '✓' : `${row.hint} ›`}</span>}
              </>
            )}
          </button>
        )
        if (row.help !== true) return button
        // YAZ-5696 round 2 (Yaseen: "a tooltip with a small eye"): the eye by Title in review; a tap shows each choice
        // in one line under it, a tap again hides it. Its own button beside the row: a tap on it never opens the choices.
        return (
          <Fragment key={row.key}>
            <span className="card-actions__titled">
              {button}
              <button type="button" className="card-actions__help" aria-label="What the choices mean" aria-expanded={helpOpen} data-two-tap={group} disabled={wait} onClick={() => setHelpOpen((open) => !open)}>
                <svg width="18" height="18" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.3" aria-hidden="true">
                  <path d="M1.5 8s2.4-4 6.5-4 6.5 4 6.5 4-2.4 4-6.5 4-6.5-4-6.5-4z" />
                  <circle cx="8" cy="8" r="1.8" />
                </svg>
              </button>
            </span>
            {helpOpen && (
              <span className="card-title-help__box card-actions__helpbox" role="note">
                {CARD_TITLE_HELP.map((h) => (
                  <span key={h.label} className="card-title-help__line">
                    <strong>{h.label}:</strong> {h.text}
                  </span>
                ))}
              </span>
            )}
          </Fragment>
        )
      })}
    </>
  )
}
