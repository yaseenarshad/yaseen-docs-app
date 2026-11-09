import { useRef, useState } from 'react'
import { PROPERTY_KINDS, type PropertyKind } from '@shared/types'
import { DESCRIPTIONS, PROPERTY_LABELS, PropertyTypeIcon } from './PropertyDefinitionEditor'

/**
 * The column editor's Type (YAZ-3746 13L): a quiet button with the type's icon, and under the row a list of every
 * type with its icon, name and one line on what it holds, the current one ticked. ↑ ↓ move, Enter picks, Esc closes
 * the list alone (the editor's own Esc, back to the columns, waits for the next press). `kind` undefined: "Auto".
 */
export function TypePicker({ kind, label, onPick }: { kind: PropertyKind | undefined; label: string; onPick: (next: PropertyKind) => void }) {
  const [open, setOpen] = useState(false)
  const trigger = useRef<HTMLButtonElement>(null)
  const list = useRef<HTMLDivElement>(null)
  const close = () => {
    setOpen(false)
    trigger.current?.focus()
  }
  const step = (by: number) => {
    const options = [...(list.current?.querySelectorAll<HTMLButtonElement>('[role="menuitemradio"]') ?? [])]
    const at = options.indexOf(document.activeElement as HTMLButtonElement)
    options[(at + by + options.length) % options.length]?.focus()
  }
  return (
    <>
      <button
        ref={trigger}
        type="button"
        className="type-picker__trigger"
        aria-label={`Edit property ${label}`}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => {
          setOpen(!open)
          if (!open) requestAnimationFrame(() => list.current?.querySelector<HTMLButtonElement>('[aria-checked="true"], [role="menuitemradio"]')?.focus())
        }}
      >
        {kind !== undefined && <PropertyTypeIcon kind={kind} />}
        <span>{kind === undefined ? 'Auto' : PROPERTY_LABELS[kind]}</span>
        <svg className="type-picker__chevron" width={10} height={10} viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth={1.4} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M3 4l2-2 2 2M3 6l2 2 2-2" />
        </svg>
      </button>
      {open && (
        <div
          ref={list}
          className="type-picker__list"
          role="menu"
          aria-label={`Type of ${label}`}
          onKeyDown={(e) => {
            if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
              e.preventDefault()
              step(e.key === 'ArrowDown' ? 1 : -1)
            } else if (e.key === 'Escape') {
              e.stopPropagation()
              close()
            }
          }}
        >
          {PROPERTY_KINDS.map((k) => (
            <button
              key={k}
              type="button"
              role="menuitemradio"
              aria-checked={k === kind}
              className="type-picker__option"
              onClick={() => {
                close()
                if (k !== kind) onPick(k)
              }}
            >
              <PropertyTypeIcon kind={k} />
              <span className="type-picker__name">{PROPERTY_LABELS[k]}</span>
              <span className="type-picker__about">{DESCRIPTIONS[k]}</span>
              {k === kind && <span className="type-picker__check" aria-hidden="true">✓</span>}
            </button>
          ))}
        </div>
      )}
    </>
  )
}
