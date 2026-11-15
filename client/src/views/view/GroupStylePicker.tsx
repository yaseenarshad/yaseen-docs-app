import { useEffect, useRef, useState, type CSSProperties, type KeyboardEvent } from 'react'
import { HIGHLIGHT_HEX } from '../../editor/marks/highlightColours'
import type { GroupBySpec } from '../viewSchema'
import { groupValueLook } from './GroupHeader'

type Colour = keyof typeof HIGHLIGHT_HEX
/** None, then the 8 highlight colours in the note toolbar's order (yellow first). */
const COLOURS = Object.keys(HIGHLIGHT_HEX) as Colour[]

/** `spec` with a new header style. None and Large off delete their keys, so the YAML lines go (YAZ-3742). */
function withStyle(spec: GroupBySpec, patch: { highlight?: string | null; large?: boolean }): GroupBySpec {
  const { highlight, large, ...rest } = spec
  const nextHighlight = patch.highlight === undefined ? highlight : patch.highlight ?? undefined
  const nextLarge = patch.large === undefined ? large : patch.large
  return { ...rest, ...(nextHighlight === undefined ? {} : { highlight: nextHighlight }), ...(nextLarge === true ? { large: true } : {}) }
}

export interface GroupStylePickerProps {
  /** The chip's accessible name: "Style of group level 1", … */
  label: string
  spec: GroupBySpec
  onChange: (spec: GroupBySpec) => void
}

/**
 * The "Aa" chip of one group row (YAZ-3742 D5): None plus the 8 highlight colours, and Large. The
 * chip wears the level's header look. The panel stays open across choices; Escape or a click
 * away closes it.
 */
export function GroupStylePicker({ label, spec, onChange }: GroupStylePickerProps) {
  const [open, setOpen] = useState(false)
  const wrapper = useRef<HTMLDivElement>(null)
  const trigger = useRef<HTMLButtonElement>(null)
  const look = groupValueLook(spec, 'group-style__sample')
  const current = look.style === undefined ? '' : spec.highlight

  useEffect(() => {
    if (!open) return
    const away = (event: MouseEvent) => {
      if (!wrapper.current?.contains(event.target as Node)) setOpen(false)
    }
    window.addEventListener('mousedown', away)
    return () => window.removeEventListener('mousedown', away)
  }, [open])

  const onKey = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== 'Escape') return
    event.preventDefault()
    event.stopPropagation()
    setOpen(false)
    trigger.current?.focus()
  }

  return (
    <div ref={wrapper} className="group-style" onBlur={(event) => {
      if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setOpen(false)
    }}>
      <button ref={trigger} type="button" className="view-chip group-style__trigger" aria-label={label} title="Header style"
        aria-haspopup="dialog" aria-expanded={open} onClick={() => setOpen(!open)}>
        <span className={look.className} style={look.style}>Aa</span>
      </button>
      {open && (
        <div className="column-picker__panel group-style__panel" role="dialog" aria-label={label} onKeyDown={onKey}>
          {['', ...COLOURS].map((name) => (
            <button key={name} type="button" data-highlight={name} aria-pressed={current === name}
              className={`group-style__swatch${name === '' ? ' group-style__swatch--none' : ''}`}
              aria-label={name === '' ? 'No highlight' : `Highlight ${name}`} title={name === '' ? 'None' : name}
              style={name === '' ? undefined : ({ '--swatch': HIGHLIGHT_HEX[name as Colour] } as CSSProperties)}
              onClick={() => { if (current !== name) onChange(withStyle(spec, { highlight: name || null })) }} />
          ))}
          <button type="button" className="group-style__large" aria-label="Large" aria-pressed={spec.large === true}
            onClick={() => onChange(withStyle(spec, { large: spec.large !== true }))}>
            Large
          </button>
        </div>
      )}
    </div>
  )
}
