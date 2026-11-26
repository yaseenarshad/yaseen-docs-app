/**
 * Shared link-styling UI primitives reused by `LinkPillsControl` and `WebLinksControl` (YAZ-6584):
 * one single source of truth for palette + custom colour swatches, B/I/U & named-colour toggles,
 * labelled toolbar rows, strength/hover options, and mark icon names.
 */
import { useEffect, useRef, useState, type ReactNode } from 'react'
import {
  LINK_PALETTE_COLORS,
  isLinkHex,
  type LinkHex,
  type LinkHoverStyle,
  type LinkPaletteColor,
  type LinkStrength,
  type SharedLinkMark,
} from '@shared/linkStyle'
import { capital } from '../editor/table/colours'
import { ColourBox } from '../editor/highlightColourBox'
import type { Option } from './options'

export const LINK_STRENGTH_OPTIONS: readonly Option<LinkStrength>[] = [
  { label: 'Light', value: 'light' },
  { label: 'Medium', value: 'medium' },
  { label: 'Strong', value: 'strong' },
]

export const LINK_HOVER_STYLE_OPTIONS: readonly Option<LinkHoverStyle>[] = [
  { label: 'Wash', value: 'wash' },
  { label: 'Underline', value: 'underline' },
  { label: 'Text colour', value: 'text' },
  { label: 'Off', value: 'off' },
]

export const LINK_HOVER_STRENGTH_OPTIONS: readonly Option<LinkStrength>[] = [
  { label: 'Subtle', value: 'light' },
  { label: 'Medium', value: 'medium' },
  { label: 'Strong', value: 'strong' },
]

/** Human-readable labels for all shared SVG mark icons (9 marks including Globe). */
export const LINK_MARK_NAMES: Readonly<Record<SharedLinkMark, string>> = {
  'arrow-up-right': 'Arrow up-right',
  link: 'Link',
  globe: 'Globe',
  'arrow-right': 'Arrow right',
  return: 'Return arrow',
  dot: 'Dot',
  diamond: 'Diamond',
  star: 'Star',
  bookmark: 'Bookmark',
}

/** Where the colour box opens when the row holds no custom colour, as the table's "Custom colour…" does. */
const CUSTOM_START: LinkHex = '#000000'

/**
 * The ten palette swatches as a radio row, then **Custom colour…** (YAZ-5972): a radio of its own,
 * checked while the value is a `#rrggbb`, showing that colour (else the words). Clicking opens the
 * app's colour box (`ColourBox`) on its own line under the swatches.
 */
export function LinkColorSwatches({
  label,
  value,
  swatch,
  onPick,
}: {
  label: string
  value: string | undefined
  swatch: (c: LinkPaletteColor) => string
  onPick: (c: LinkPaletteColor | LinkHex) => void
}) {
  const custom = isLinkHex(value) ? value : undefined
  const [open, setOpen] = useState(false)
  const holder = useRef<HTMLSpanElement>(null)
  const box = useRef<ColourBox | null>(null)
  const pick = useRef(onPick)
  pick.current = onPick
  const startAt = useRef(custom)
  startAt.current = custom
  useEffect(() => {
    if (!open) return
    if (box.current === null) {
      box.current = new ColourBox(document, {
        preview: () => {},
        pick: (hex) => pick.current(hex.toLowerCase() as LinkHex),
        close: () => setOpen(false),
      })
      holder.current?.append(box.current.el)
    }
    box.current.show(startAt.current ?? CUSTOM_START)
    return () => box.current?.hide()
  }, [open])
  return (
    <span className="settings__band-colours" role="radiogroup" aria-label={label}>
      {LINK_PALETTE_COLORS.map((c) => (
        <button
          key={c}
          type="button"
          role="radio"
          aria-checked={value === c}
          title={capital(c)}
          className="settings__band-colour"
          onClick={() => onPick(c)}
        >
          <span className="settings__band-swatch" style={{ background: swatch(c) }} aria-hidden />
        </button>
      ))}
      <button
        type="button"
        role="radio"
        aria-checked={custom !== undefined}
        aria-expanded={open}
        aria-label={custom === undefined ? 'Custom colour…' : `Custom colour… (${custom})`}
        title={custom === undefined ? 'Custom colour…' : `Custom colour… ${custom}`}
        className="settings__band-colour pill-toolbar__custom"
        onClick={() => setOpen(!open)}
      >
        {custom === undefined ? 'Custom…' : <span className="settings__band-swatch" style={{ background: custom }} aria-hidden />}
      </button>
      <span ref={holder} className="pill-toolbar__custom-box" hidden={!open} />
    </span>
  )
}

/** A small toggle or pick button of the link style toolbar (B/I/U, Accent/Text/Muted/Auto, etc.). */
export function LinkStyleToggle({
  label,
  on,
  mark,
  onClick,
  className = '',
}: {
  label: string
  on: boolean
  mark: string
  onClick: () => void
  className?: string
}) {
  return (
    <button
      type="button"
      className={`settings__option pill-toolbar__item${on ? ' settings__option--active' : ''}${className}`}
      aria-pressed={on}
      aria-label={label}
      title={label}
      onClick={onClick}
    >
      {mark}
    </button>
  )
}

/** One labelled row of a link style panel: short label on the left, controls beside it. */
export function LinkStyleRow({ label, children, wide = false }: { label: string; children: ReactNode; wide?: boolean }) {
  return (
    <div className="pill-toolbar__row">
      <span className={`pill-toolbar__label${wide ? ' pill-toolbar__label--wide' : ''}`}>{label}</span>
      {children}
    </div>
  )
}
