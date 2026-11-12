import { useState } from 'react'
import { COLOR_STRENGTHS, type ColorName, type ColorStrength, type ColorStrengthValue, MAX_CAL_LINE } from '@shared/types'
import { calLineCss } from '../calendar'
import { Dropdown } from './Dropdown'
import { FillPicker } from './StylePanel'
import { TextField } from './TextField'

const LINE_PRESETS = [1, 2, 3, 4] as const

/**
 * One calendar line's two controls (YAZ-4878): "Thickness ▾" (1–4 px, or Custom with a number box inside the dropdown,
 * so the row never widens; the rows are the context menu's, a ✓ at the width) and a colour dot ▾ that opens the style
 * panel's Fill tab (`FillPicker`, YAZ-4834 P9) with Light · Medium · Strong. The View tab's "Between weeks" and "Between
 * days" rows and Settings › Folder pages' defaults are the same two controls.
 */
export function CalLineControls({ label, width, color, onWidth, onColor }: { label: string; width: number; color: ColorStrengthValue; onWidth: (px: number) => void; onColor: (next: ColorStrengthValue) => void }) {
  // "Custom" shows its box while it is chosen, or while the width is none of the presets.
  const [custom, setCustom] = useState(false)
  const preset = (LINE_PRESETS as readonly number[]).includes(width)
  return (
    <span className="cal-line">
      <Dropdown label={`${label} thickness`} className="cal-line__thickness" panelClassName="cal-line__panel ctx-menu--glyphs" trigger={`${width} px`} onOpen={() => setCustom(false)}>
        {(close) => (
          <>
            {LINE_PRESETS.map((n) => (
              <button
                key={n}
                type="button"
                role="menuitem"
                className="ctx-menu__item"
                data-hint={!custom && width === n ? '✓' : undefined}
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
              role="menuitem"
              className="ctx-menu__item"
              data-hint={custom || !preset ? '✓' : undefined}
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
      <Dropdown label={`${label} colour`} className="cal-line__colour" panelClassName="cal-line__panel view-style__panel ctx-menu--glyphs" trigger={<span className="table-menu-swatch cal-line__dot" style={{ background: calLineCss(color, 2) }} />}>
        {() => <FillPicker label={label} strengths={COLOR_STRENGTHS} strength={color.strength} color={color.color} onStrength={(strength) => onColor({ color: color.color, strength: strength as ColorStrength })} onColor={(next) => onColor({ color: next as ColorName, strength: color.strength })} />}
      </Dropdown>
    </span>
  )
}
