import { type ReactNode, useRef, useState } from 'react'
import { type ColorStrengthValue, MAX_CAL_LINE } from '@shared/types'
import { calLineCss } from '../calendar'
import { ColourPanel } from './ColourPanel'
import { Popover } from './Popover'
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
      <Dropdown label={`${label} thickness`} className="cal-line__thickness" trigger={`${width} px`} onOpen={() => setCustom(false)}>
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
      <Dropdown label={`${label} colour`} className="cal-line__colour" trigger={<span className="table-menu-swatch cal-line__dot" style={{ background: calLineCss(color, 2) }} />}>
        {() => <ColourPanel label={label} value={color} onPick={onColor} />}
      </Dropdown>
    </span>
  )
}

/** A quiet select-looking button with a popover under it: on the body, fixed under the trigger (`portal`), so the View tab's own popover never places or cuts it. */
function Dropdown({ label, className, trigger, onOpen, children }: { label: string; className: string; trigger: ReactNode; onOpen?: () => void; children: (close: () => void) => ReactNode }) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLButtonElement>(null)
  return (
    <span className="cal-line__drop">
      <button
        ref={ref}
        type="button"
        className={`view-select cal-line__trigger ${className}`}
        aria-label={label}
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => {
          if (!open) onOpen?.()
          setOpen(!open)
        }}
      >
        {trigger}
      </button>
      {open && (
        <Popover label={label} anchor={ref.current} portal onClose={() => setOpen(false)} className="cal-line__panel">
          {children(() => setOpen(false))}
        </Popover>
      )}
    </span>
  )
}
