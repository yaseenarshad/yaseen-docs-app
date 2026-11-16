import type { ReactNode } from 'react'
import './segmented.css'

/** One choice of a segmented row: the value saved, the word shown, its icon (drawn above the word). */
export interface Segment<T extends string> {
  value: T
  label: string
  icon: ReactNode
}

/**
 * YAZ-5667: a phone segmented row, the Mac's `Segmented` (Settings' Off/On, Narrow/Medium/Full) in one row of equal
 * parts: every choice visible, one tap; an icon over each word, the chosen one filled with the accent (its words in
 * `--on-accent`). A radio group of real radios (VoiceOver: "Dark, radio button, selected"; arrows move the
 * pick), each covering its whole part so the tap lands on it; at least 44 px tall. The YAZ-5666 choice rows' neighbour
 * (`ChoiceRow`): the same panel, border and radius.
 */
export function Segmented<T extends string>({ label, name, options, value, onChoose }: { label: string; name: string; options: readonly Segment<T>[]; value: T; onChoose: (value: T) => void }) {
  return (
    <div className="segmented" role="radiogroup" aria-label={label}>
      {options.map((o) => (
        <label key={o.value} className="segmented__option">
          <input type="radio" name={name} checked={value === o.value} onChange={() => onChoose(o.value)} />
          <svg viewBox="0 0 20 20" width="20" height="20" aria-hidden="true" focusable="false">
            {o.icon}
          </svg>
          <span>{o.label}</span>
        </label>
      ))}
    </div>
  )
}
