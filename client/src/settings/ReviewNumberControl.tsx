/**
 * One number of the vault's review settings (YAZ-2322) — the dialog's only number field, on the
 * folder input's draft + commit pattern (NewNoteLocationControl): Enter or blur saves a valid
 * draft; one the rules refuse is marked while it stands and gives way to the stored value on
 * commit. The rules are `sanitizeReviewSettings`' alone — a draft is valid when the sanitiser
 * keeps it — so "whole days", "growth from 1" and "the longest wait is never under the first" are
 * said in one place. A change from elsewhere (another window, a sync) resets the draft.
 */
import { useEffect, useState } from 'react'
import { sanitizeReviewSettings } from '@shared/reviews'
import type { ReviewSettingsState } from '../review/useReviewSettings'

export type ReviewNumberField = 'baseDays' | 'growth' | 'maxDays'

interface ReviewNumberControlProps {
  field: ReviewNumberField
  label: string
  unit: string
  review: ReviewSettingsState
}

export function ReviewNumberControl({ field, label, unit, review }: ReviewNumberControlProps) {
  const stored = review.settings[field]
  const [draft, setDraft] = useState(String(stored))
  useEffect(() => setDraft(String(stored)), [stored])

  const value = Number(draft)
  const next = { ...review.settings, [field]: value }
  const invalid = sanitizeReviewSettings(next)[field] !== value

  const commit = (): void => {
    if (invalid) setDraft(String(stored))
    else if (value !== stored) review.save(next)
  }

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
