import { type ReactNode, useRef, useState } from 'react'
import { PROPERTY_KINDS, type PropertyKind } from '@shared/types'
import { DESCRIPTIONS, PROPERTY_LABELS, PropertyTypeIcon } from './PropertyDefinitionEditor'

/** One choice of a `MenuPicker`: its icon, its name and one line on what it does. */
export interface PickerOption<T extends string> {
  value: T
  icon: ReactNode
  label: string
  about: string
}

/**
 * The column editor's Type picker (YAZ-3746 13L), for any short list of choices (C8A: the note's "Column"): a quiet button
 * with the choice's icon, and under the row a list of every choice with its icon, name and one line on what it does, the
 * current one ticked. ↑ ↓ move, Enter picks, Esc closes the list alone (the editor's own Esc waits for the next press).
 * `value` undefined: `empty` ("Auto").
 */
export function MenuPicker<T extends string>({ value, options, menuLabel, triggerLabel, empty = 'Auto', lead, stacked = false, search = false, onPick }: {
  value: T | undefined
  options: readonly PickerOption<T>[]
  menuLabel: string
  triggerLabel: string
  empty?: string
  /** A quiet word before the choice on the button ("Column on", YAZ-4769): what the choice is, in a row with no labels. */
  lead?: string
  /** Each choice's line UNDER its name (YAZ-4769): a long name ("YAZ-4713 Columns flow down") never cuts its line. */
  stacked?: boolean
  /** A search box on top of the list (YAZ-4795 demo: "Notes from" lists every folder): typing keeps the choices whose name or line has it. */
  search?: boolean
  onPick: (next: T) => void
}) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const needle = query.trim().toLowerCase()
  const shown = needle === '' ? options : options.filter((o) => o.label.toLowerCase().includes(needle) || o.about.toLowerCase().includes(needle))
  const trigger = useRef<HTMLButtonElement>(null)
  const list = useRef<HTMLDivElement>(null)
  const close = () => {
    setOpen(false)
    trigger.current?.focus()
  }
  const step = (by: number) => {
    const items = [...(list.current?.querySelectorAll<HTMLButtonElement>('[role="menuitemradio"]') ?? [])]
    const at = items.indexOf(document.activeElement as HTMLButtonElement)
    items[(at + by + items.length) % items.length]?.focus()
  }
  const current = options.find((o) => o.value === value)
  return (
    <>
      <button
        ref={trigger}
        type="button"
        className="type-picker__trigger"
        aria-label={triggerLabel}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => {
          setOpen(!open)
          setQuery('')
          if (!open) requestAnimationFrame(() => (search ? list.current?.querySelector<HTMLInputElement>('input') : list.current?.querySelector<HTMLButtonElement>('[aria-checked="true"], [role="menuitemradio"]'))?.focus())
        }}
      >
        {lead !== undefined && <span className="type-picker__lead">{lead}</span>}
        {current?.icon}
        <span>{current?.label ?? empty}</span>
        <svg className="type-picker__chevron" width={10} height={10} viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth={1.4} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M3 4l2-2 2 2M3 6l2 2 2-2" />
        </svg>
      </button>
      {open && (
        <div
          ref={list}
          className="type-picker__list"
          role="menu"
          aria-label={menuLabel}
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
          {search && (
            <input
              className="view-input type-picker__search"
              type="search"
              placeholder="Search"
              aria-label={`Search ${menuLabel}`}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => {
                // Enter picks the first match; ↓ goes into the list.
                if (e.key === 'Enter' && shown[0] !== undefined) {
                  e.preventDefault()
                  close()
                  if (shown[0].value !== value) onPick(shown[0].value)
                }
              }}
            />
          )}
          {shown.map((o) => (
            <button
              key={o.value}
              type="button"
              role="menuitemradio"
              aria-checked={o.value === value}
              className={stacked ? 'type-picker__option type-picker__option--stacked' : 'type-picker__option'}
              onClick={() => {
                close()
                if (o.value !== value) onPick(o.value)
              }}
            >
              {o.icon}
              {stacked ? (
                <span className="type-picker__text">
                  <span className="type-picker__name">{o.label}</span>
                  <span className="type-picker__about">{o.about}</span>
                </span>
              ) : (
                <>
                  <span className="type-picker__name">{o.label}</span>
                  <span className="type-picker__about">{o.about}</span>
                </>
              )}
              {o.value === value && <span className="type-picker__check" aria-hidden="true">✓</span>}
            </button>
          ))}
        </div>
      )}
    </>
  )
}

/** The column editor's Type (YAZ-3746 13L) on `MenuPicker`. `kinds`: the types offered (a note's panel has no Linked mentions, C8A). */
export function TypePicker({ kind, label, kinds = PROPERTY_KINDS, onPick }: { kind: PropertyKind | undefined; label: string; kinds?: readonly PropertyKind[]; onPick: (next: PropertyKind) => void }) {
  return (
    <MenuPicker
      value={kind}
      options={kinds.map((k) => ({ value: k, icon: <PropertyTypeIcon kind={k} />, label: PROPERTY_LABELS[k], about: DESCRIPTIONS[k] }))}
      menuLabel={`Type of ${label}`}
      triggerLabel={`Edit property ${label}`}
      onPick={onPick}
    />
  )
}
