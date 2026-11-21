import { useEffect, useId, useState } from 'react'
import { reducedMotion } from '@client/editor/toc/tocMotion'
import './choiceRow.css'

/** One choice of a row: the value saved, the words shown. */
export interface Choice {
  value: boolean | string
  label: string
}

/** One setting shown as a choice row. */
export interface ChoiceRowSpec {
  id: string
  label: string
  value: Choice['value']
  choices: readonly Choice[]
  /** A different choice was tapped: save it. */
  onChoose: (value: Choice['value']) => void
}

/** The close's length: the CSS's `choice-row-close`. */
const CLOSE_MS = 140

/**
 * YAZ-5666 (option D): the phone Settings' rows, two taps to change a setting. Closed, each row shows its name, its value
 * and ›, one button (VoiceOver: "Folding, On, collapsed"). A tap opens its choices in place under it, a radio group with
 * ✓ on the current one; a tap on a choice saves it (a tap on the current one saves nothing) and folds the row shut with
 * the new value; a tap on the open row's name folds it without a change. One row open at a time. `disabled` (no way to
 * save): the rows show their values and do not open. Appearance stays one tap (`AppearancePart`).
 */
export function ChoiceRows({ label, rows, disabled = false }: { label: string; rows: readonly ChoiceRowSpec[]; disabled?: boolean }) {
  const [open, setOpen] = useState<string | null>(null)
  return (
    <ul className="rows sheet choice-rows" aria-label={label}>
      {rows.map((r) => (
        <ChoiceRow
          key={r.id}
          row={r}
          open={open === r.id && !disabled}
          disabled={disabled}
          onToggle={() => setOpen(open === r.id ? null : r.id)}
          onChoose={(value) => {
            setOpen(null)
            if (value !== r.value) r.onChoose(value)
          }}
        />
      ))}
    </ul>
  )
}

function ChoiceRow({ row, open, disabled, onToggle, onChoose }: { row: ChoiceRowSpec; open: boolean; disabled: boolean; onToggle: () => void; onChoose: (value: Choice['value']) => void }) {
  const id = useId()
  const { shown, leaving } = useFold(open)
  const current = row.choices.find((c) => c.value === row.value)?.label ?? ''
  return (
    <li className="choice-row">
      <button
        type="button"
        className="row row__button choice-row__button"
        aria-label={`${row.label}, ${current}`}
        aria-expanded={open}
        aria-controls={shown ? id : undefined}
        disabled={disabled}
        onClick={onToggle}
      >
        <span className="row__main">{row.label}</span>
        <span className="row__side choice-row__value">{current}</span>
        <span className="choice-row__chevron" aria-hidden="true">
          ›
        </span>
      </button>
      {shown && (
        <div id={id} className="choice-row__choices" role="radiogroup" aria-label={row.label} inert={leaving} aria-hidden={leaving || undefined}>
          {row.choices.map((c) => (
            <button key={String(c.value)} type="button" role="radio" aria-checked={c.value === row.value} className="row row__button choice-row__choice" onClick={() => onChoose(c.value)}>
              {c.label}
              {c.value === row.value && (
                <span className="choice-row__tick" aria-hidden="true">
                  ✓
                </span>
              )}
            </button>
          ))}
        </div>
      )}
    </li>
  )
}

/** Open: the choices show (and open with a short slide). Closed: they fold for `CLOSE_MS`, inert, then go; with "reduce motion" at once. */
function useFold(open: boolean): { shown: boolean; leaving: boolean } {
  const [shown, setShown] = useState(open)
  if (open && !shown) setShown(true)
  const leaving = shown && !open
  useEffect(() => {
    if (!leaving) return
    if (reducedMotion()) {
      setShown(false)
      return
    }
    const t = setTimeout(() => setShown(false), CLOSE_MS)
    return () => clearTimeout(t)
  }, [leaving])
  return { shown, leaving }
}
