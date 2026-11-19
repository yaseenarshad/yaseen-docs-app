/**
 * Settings › Sidebar › Row spacing (YAZ-5885 D1–D3): how tall each row of the sidebar's lists is, in CSS px before the
 * sidebar zoom. Compact (22, VS Code's) · Default (25.5, the look before) · Roomy (30) · Custom, a px typed beside it,
 * kept on ⏎ or blur, clamped to 20–40 and rounded to a half px. One number holds it, `settings.sidebarRowHeight`: a
 * number that is not one of the three names shows as Custom. Custom on a named height shows the field at that height
 * and writes nothing until a new px is kept.
 */
import { useEffect, useState } from 'react'
import { SIDEBAR_ROW_HEIGHT_MAX, SIDEBAR_ROW_HEIGHT_MIN, SIDEBAR_ROW_HEIGHTS } from '@shared/types'
import { Segmented } from './controls'
import type { Option } from './options'

export type RowSpacingMode = keyof typeof SIDEBAR_ROW_HEIGHTS | 'custom'

export const ROW_SPACING_OPTIONS: readonly Option<RowSpacingMode>[] = [
  { label: 'Compact', value: 'compact' },
  { label: 'Default', value: 'default' },
  { label: 'Roomy', value: 'roomy' },
  { label: 'Custom', value: 'custom' },
]

/** The named height `px` is, else Custom. */
export function rowSpacingMode(px: number): RowSpacingMode {
  for (const mode of ['compact', 'default', 'roomy'] as const) if (SIDEBAR_ROW_HEIGHTS[mode] === px) return mode
  return 'custom'
}

/** A typed px as the setting keeps it: within 20–40, to the half px; `null` when it is no number. */
export function clampRowHeight(typed: string): number | null {
  const n = Number.parseFloat(typed)
  if (!Number.isFinite(n)) return null
  return Math.min(SIDEBAR_ROW_HEIGHT_MAX, Math.max(SIDEBAR_ROW_HEIGHT_MIN, Math.round(n * 2) / 2))
}

export function RowSpacingControl({ value, onSet }: { value: number; onSet: (next: number) => void }) {
  const named = rowSpacingMode(value)
  // Custom stays picked on a named height until another choice is clicked.
  const [custom, setCustom] = useState(named === 'custom')
  const mode: RowSpacingMode = custom ? 'custom' : named
  const [draft, setDraft] = useState(String(value))
  useEffect(() => setDraft(String(value)), [value])
  useEffect(() => {
    if (named === 'custom') setCustom(true)
  }, [named])
  const keep = () => {
    const next = clampRowHeight(draft) ?? value
    setDraft(String(next))
    if (next !== value) onSet(next)
  }
  const choose = (next: RowSpacingMode) => {
    setCustom(next === 'custom')
    if (next !== 'custom' && SIDEBAR_ROW_HEIGHTS[next] !== value) onSet(SIDEBAR_ROW_HEIGHTS[next])
  }
  return (
    <>
      <Segmented options={ROW_SPACING_OPTIONS} value={mode} onChange={choose} ariaLabel="Row spacing in the sidebar" />
      {mode === 'custom' && (
        <span className="settings__percent">
          <input className="settings__input settings__input--number" aria-label="Row spacing in px" inputMode="decimal" value={draft} spellCheck={false}
            onChange={(event) => setDraft(event.target.value.replace(/[^0-9.]/g, ''))} onBlur={keep}
            onKeyDown={(event) => {
              if (event.key === 'Enter') keep()
            }} />
          px
        </span>
      )}
    </>
  )
}
