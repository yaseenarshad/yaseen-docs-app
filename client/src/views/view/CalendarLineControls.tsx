import { useState } from 'react'
import { type ColorStrengthValue, MAX_CAL_LINE } from '@shared/types'
import { calLineCss } from '../calendar'
import { ColourPanel } from './ColourPanel'
import { Dropdown } from './Dropdown'
import { TextField } from './TextField'

const LINE_PRESETS = [1, 2, 3, 4] as const

/**
 * One calendar line's two controls (YAZ-4878): "Thickness ▾" (1–4 px, or Custom with a number box inside the dropdown,
 * so the row never widens) and a colour dot ▾ that opens the colour panel. The View tab's "Between weeks" and "Between
 * days" rows and Settings › Folder pages' defaults are the same two controls.
 */
export function CalLineControls({ label, width, color, onWidth, onColor }: { label: string; width: number; color: ColorStrengthValue; onWidth: (px: number) => void; onColor: (next: ColorStrengthValue) => void }) {
  // "Custom" shows its box while it is chosen, or while the width is none of the presets.
  const [custom, setCustom] = useState(false)
  const preset = (LINE_PRESETS as readonly number[]).includes(width)
  return (
    <span className="cal-line">
      <Dropdown label={`${label} thickness`} className="cal-line__thickness" panelClassName="cal-line__panel" trigger={`${width} px`} onOpen={() => setCustom(false)}>
        {(close) => (
          <>
            {LINE_PRESETS.map((n) => (
              <button
                key={n}
                type="button"
                className="view-popover__item"
                aria-pressed={!custom && width === n}
                onClick={() => {
                  if (width !== n) onWidth(n)
                  close()
                }}
              >
                {n} px
              </button>
            ))}
            <button
              type="button"
              className="view-popover__item"
              aria-pressed={custom || !preset}
              onClick={() => {
                setCustom(true)
                // Custom starts at 5 px, the first width the presets do not have.
                if (preset) onWidth(5)
              }}
            >
              Custom…
            </button>
            {(custom || !preset) && (
              <span className="view-width-setting cal-line__custom">
                <TextField
                  className="view-input"
                  aria-label={`${label} in pixels`}
                  type="number"
                  inputMode="decimal"
                  min={1}
                  step={1}
                  value={String(width)}
                  normalize={(draft) => {
                    const n = Math.round(Number(draft))
                    return Number.isFinite(n) && n >= 1 && n <= MAX_CAL_LINE ? String(n) : null
                  }}
                  onCommit={(next) => onWidth(Number(next))}
                />
                <span>px</span>
              </span>
            )}
          </>
        )}
      </Dropdown>
      <Dropdown label={`${label} colour`} className="cal-line__colour" panelClassName="cal-line__panel" trigger={<span className="table-menu-swatch cal-line__dot" style={{ background: calLineCss(color, 2) }} />}>
        {() => <ColourPanel label={label} value={color} onPick={onColor} />}
      </Dropdown>
    </span>
  )
}
