/**
 * Settings › Editor › Selection toolbar › Quick highlight colours (YAZ-6729).
 *
 * Lets the user customize the 3 quick highlight buttons shown in the floating selection toolbar
 * (default: Yellow, Green, Blue). Clicking any slot opens the shared Google Docs 10×8 `ColourGrid`
 * with a Soft washes row on top, so each slot can be either a theme-adaptive wash or any solid/opacity hex.
 */
import { useEffect, useRef, useState } from 'react'
import {
  DEFAULT_QUICK_HIGHLIGHT_COLORS,
  QUICK_HIGHLIGHT_NAMES,
  type QuickHighlightColors,
  type QuickHighlightSlot,
} from '@shared/types'
import { ColourGrid } from '../editor/colourGrid'
import { quickSlotInk, quickSlotSwatch } from '../editor/highlightQuick'
import type { Hex } from '../lib/colour'

const SOFT_WASH_ITEMS = QUICK_HIGHLIGHT_NAMES.map((name) => ({
  key: name,
  label: `${name[0]!.toUpperCase() + name.slice(1)} (soft wash)`,
  value: name,
  swatch: name === 'yellow' ? 'var(--mark-bg)' : `var(--mark-bg-${name})`,
  isLight: true,
}))

const slotTitle = (slot: QuickHighlightSlot): string =>
  slot.startsWith('#') ? slot : `${slot[0]!.toUpperCase() + slot.slice(1)} (soft wash)`

export function QuickHighlightControl({
  value,
  onChange,
}: {
  value: QuickHighlightColors
  onChange: (next: QuickHighlightColors) => void
}) {
  const [openSlot, setOpenSlot] = useState<0 | 1 | 2 | null>(null)
  const hostRef = useRef<HTMLDivElement>(null)
  const popRef = useRef<HTMLDivElement>(null)
  const gridRef = useRef<ColourGrid | null>(null)
  const valueRef = useRef(value)
  valueRef.current = value
  const onChangeRef = useRef(onChange)
  onChangeRef.current = onChange
  const openSlotRef = useRef(openSlot)
  openSlotRef.current = openSlot

  useEffect(() => {
    if (openSlot === null || popRef.current === null) return
    const grid = new ColourGrid(document, {
      noneLabel: null,
      allowAlpha: true,
      defaultBoxHex: () => '#ffff00',
      extraRow: { heading: 'Soft washes', items: SOFT_WASH_ITEMS },
      onPick: (picked, isCustom) => {
        const slot = openSlotRef.current
        if (slot === null) return
        const next: QuickHighlightColors = [...valueRef.current]
        next[slot] = picked as QuickHighlightSlot
        onChangeRef.current(next)
        if (!isCustom) setOpenSlot(null)
        else grid.render([picked], picked.startsWith('#') ? (picked as Hex) : '#ffff00')
      },
    })
    gridRef.current = grid
    const current = valueRef.current[openSlot]
    grid.render([current], current.startsWith('#') ? (current as Hex) : '#ffff00')
    popRef.current.replaceChildren(grid.el)

    const onDown = (e: MouseEvent) => {
      const target = e.target
      if (!(target instanceof Node)) return
      if (hostRef.current?.contains(target)) return
      setOpenSlot(null)
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      if (grid.boxOpen) {
        e.preventDefault()
        e.stopPropagation()
        grid.closeCustom()
      } else {
        e.preventDefault()
        e.stopPropagation()
        setOpenSlot(null)
      }
    }
    document.addEventListener('mousedown', onDown, true)
    document.addEventListener('keydown', onKey, true)
    return () => {
      document.removeEventListener('mousedown', onDown, true)
      document.removeEventListener('keydown', onKey, true)
      gridRef.current = null
    }
  }, [openSlot])

  const isDefault =
    value[0] === DEFAULT_QUICK_HIGHLIGHT_COLORS[0] &&
    value[1] === DEFAULT_QUICK_HIGHLIGHT_COLORS[1] &&
    value[2] === DEFAULT_QUICK_HIGHLIGHT_COLORS[2]

  return (
    <div ref={hostRef} style={{ position: 'relative', display: 'flex', flexDirection: 'column', gap: 8 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        {([0, 1, 2] as const).map((idx) => {
          const slot = value[idx]
          const active = openSlot === idx
          return (
            <button
              key={idx}
              type="button"
              aria-label={`Quick highlight ${idx + 1}: ${slotTitle(slot)}`}
              aria-expanded={active}
              title={`Slot ${idx + 1}: ${slotTitle(slot)}`}
              onClick={() => setOpenSlot(active ? null : idx)}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 6,
                padding: '4px 8px',
                borderRadius: 6,
                border: active ? '1.5px solid var(--accent)' : '1px solid var(--border)',
                background: 'var(--bg)',
                color: 'var(--fg)',
                fontSize: 12,
                cursor: 'pointer',
              }}
            >
              <span
                className="swatch-tile swatch-tile--on-color"
                style={{ ['--swatch-color' as string]: quickSlotSwatch(slot), ['--swatch-ink' as string]: quickSlotInk(slot) }}
              >
                <span className="swatch-tile__letter">A</span>
              </span>
              <span>{idx + 1}</span>
            </button>
          )
        })}
        {!isDefault && (
          <button
            type="button"
            className="settings__reset-btn"
            onClick={() => {
              setOpenSlot(null)
              onChange([...DEFAULT_QUICK_HIGHLIGHT_COLORS])
            }}
            style={{
              padding: '4px 8px',
              borderRadius: 6,
              border: '1px solid var(--border)',
              background: 'transparent',
              color: 'var(--fg-muted)',
              fontSize: 12,
              cursor: 'pointer',
            }}
          >
            Reset
          </button>
        )}
      </div>
      {openSlot !== null && (
        <div
          ref={popRef}
          role="dialog"
          aria-label={`Choose quick highlight ${openSlot + 1}`}
          style={{
            padding: 12,
            borderRadius: 8,
            border: '1px solid var(--border)',
            background: 'var(--bg)',
            boxShadow: '0 8px 24px rgba(0,0,0,0.14)',
            width: 'fit-content',
          }}
        />
      )}
    </div>
  )
}
