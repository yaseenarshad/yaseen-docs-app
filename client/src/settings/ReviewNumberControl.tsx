/**
 * One typed field of the vault's note card review settings (YAZ-4967, D14) — on the folder input's draft + commit
 * pattern (NewNoteLocationControl): Enter or blur saves a valid draft; one the rules refuse is marked while it stands
 * and gives way to the stored value on commit. The rules are `sanitizeReviewSettings`' alone — a draft is valid when
 * the sanitiser keeps it as it is — so "70 to 99 %", "whole days" and "21 weights" are said in one place. A change
 * from elsewhere (another window, a sync) resets the draft.
 */
import { useEffect, useState } from 'react'
import { sanitizeReviewSettings, type ReviewSettings } from '@shared/reviews'
import type { ReviewSettingsState } from '../review/useReviewSettings'

/** How a field reads as text, and the settings a draft makes (null: no such value). */
export interface ReviewField {
  show: (s: ReviewSettings) => string
  parse: (text: string, s: ReviewSettings) => ReviewSettings | null
}

const numberOf = (text: string): number | null => (text.trim() === '' ? null : Number(text))

/** A whole number field, as the file holds it: Longest wait. */
export const wholeField = (field: 'maxDays'): ReviewField => ({
  show: (s) => String(s[field]),
  parse: (text, s) => {
    const n = numberOf(text)
    return n === null ? null : { ...s, [field]: n }
  },
})

/** New cards a day (YAZ-4999 D1): a whole number, or an empty box for no limit (`null` in the file). */
export const NEW_PER_DAY_FIELD: ReviewField = {
  show: (s) => (s.newPerDay === null ? '' : String(s.newPerDay)),
  parse: (text, s) => ({ ...s, newPerDay: numberOf(text) }),
}

/** Up next a day (YAZ-5028): the same box, `upNextPerDay`. */
export const UP_NEXT_PER_DAY_FIELD: ReviewField = {
  show: (s) => (s.upNextPerDay === null ? '' : String(s.upNextPerDay)),
  parse: (text, s) => ({ ...s, upNextPerDay: numberOf(text) }),
}

/** Remember rate: a percent on screen, a fraction in the file (90 ↔ 0.9). */
export const RETENTION_FIELD: ReviewField = {
  show: (s) => String(Math.round(s.retention * 1000) / 10),
  parse: (text, s) => {
    const n = numberOf(text)
    return n === null ? null : { ...s, retention: Math.round(n * 10) / 1000 }
  },
}

/** Weights: the numbers, comma-separated. */
export const WEIGHTS_FIELD: ReviewField = {
  show: (s) => s.weights.join(', '),
  parse: (text, s) => ({ ...s, weights: text.split(',').map((part) => numberOf(part) ?? Number.NaN) }),
}

const kept = (next: ReviewSettings): boolean => JSON.stringify(sanitizeReviewSettings(next)) === JSON.stringify(next)

interface ReviewNumberControlProps {
  field: ReviewField
  label: string
  unit?: string
  review: ReviewSettingsState
  /** A list (the weights): a wrapping box under the text, in place of a short number field. */
  wide?: boolean
}

export function ReviewNumberControl({ field, label, unit, review, wide = false }: ReviewNumberControlProps) {
  const stored = field.show(review.settings)
  const [draft, setDraft] = useState(stored)
  useEffect(() => setDraft(stored), [stored])

  const next = field.parse(draft, review.settings)
  const invalid = next === null || !kept(next)

  const commit = (): void => {
    if (invalid) setDraft(stored)
    else if (draft !== stored) review.save(next)
  }

  // The weights: a box that wraps, so all 21 numbers show (a one-line field cut them at the edge); Enter saves, as in a field.
  // It grows to its text (`field-sizing: content` in settings.css, YAZ-4964); `rows` is the floor, 3 lines at 960 px.
  if (wide)
    return (
      <textarea
        className={`settings__input settings__input--list${invalid ? ' settings__input--error' : ''}`}
        rows={3}
        spellCheck={false}
        aria-label={label}
        aria-invalid={invalid}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          if (e.key !== 'Enter') return
          e.preventDefault()
          commit()
        }}
        onBlur={commit}
      />
    )
  return (
    <>
      <input
        type="text"
        inputMode="decimal"
        className={`settings__input settings__input--number${invalid ? ' settings__input--error' : ''}`}
        aria-label={label}
        aria-invalid={invalid}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') commit()
        }}
        onBlur={commit}
      />
      {unit}
    </>
  )
}
