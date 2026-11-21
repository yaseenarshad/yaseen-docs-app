import { useEffect, useId, useState } from 'react'
import type { CardTitleShow } from '@shared/cardTitleAt'
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
 * Archive card and a Title in review choice are two taps too (YAZ-5966: the Mac's card menu is click-twice there, no
 * longer an ask in place); the choice already ✓ does nothing.
 * Title in review › (YAZ-5696, YAZ-5697 round 2): a tap opens its choices under it, touch-sized, the one now with ✓.
 */
export default function CardActionRows({ marks, upNext, fix = true, onAction, disabled = false, rowClassName = 'card-actions__row', ms, titleGlobal }: CardActionRowsProps) {
  const group = useId()
  const { armed, tap, cancel } = useTwoTap({ ms })
  const [titleOpen, setTitleOpen] = useState(false)
  const rows = cardActions(marks ?? { off: false, next: false, fix: false, notitle: false }, { upNext, fix, titleGlobal })
  // The rows that show: Title in review's choices under it while it is open.
  const shown = rows.flatMap((r) => (r.children !== undefined && titleOpen ? [r, ...r.children] : [r]))
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
    if (tap(row.key)) onAction(row)
  }
  return (
    <>
      <span className="sr-only" aria-live="assertive">
        {armedRow?.confirm ?? ''}
      </span>
      {shown.map((row) => {
        const on = armed === row.key
        return (
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
      })}
    </>
  )
}
