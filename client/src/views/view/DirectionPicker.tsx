import { useEffect, useRef, useState, type KeyboardEvent } from 'react'

/** What one order choice writes on a sort or group level (YAZ-3940). No `by` = option order on a Select column. */
export interface OrderPatch {
  direction: 'ASC' | 'DESC'
  by?: 'value'
}

/** `spec` with the chosen order. A spec back on option order loses its `by` key, so the YAML line goes. */
export function withOrder<T extends { direction?: 'ASC' | 'DESC'; by?: 'value' }>(spec: T, patch: OrderPatch): T {
  const { by: _by, ...rest } = spec
  return (patch.by ? { ...rest, direction: patch.direction, by: patch.by } : { ...rest, direction: patch.direction }) as T
}

interface Order extends OrderPatch {
  label: string
}

const OPTION_ORDERS: readonly Order[] = [
  { label: 'Option order', direction: 'ASC' },
  { label: 'Reversed option order', direction: 'DESC' },
  { label: 'A → Z', direction: 'ASC', by: 'value' },
  { label: 'Z → A', direction: 'DESC', by: 'value' },
]
const VALUE_ORDERS: readonly Order[] = [
  { label: 'A → Z', direction: 'ASC' },
  { label: 'Z → A', direction: 'DESC' },
]

/** The order a spec is in, with its label: this picker's choice, and the header's sort arrow (YAZ-4590 S19). */
export function orderOf(spec: { direction?: 'ASC' | 'DESC'; by?: 'value' }, hasOptions: boolean): Order {
  const orders = hasOptions ? OPTION_ORDERS : VALUE_ORDERS
  const direction = spec.direction === 'DESC' ? 'DESC' : 'ASC'
  const by = hasOptions ? spec.by : undefined
  return orders.find(o => o.direction === direction && o.by === by) ?? orders[0]
}

export interface DirectionPickerProps {
  /** The button's accessible name: "Direction", "Group direction", … */
  label: string
  spec: { direction?: 'ASC' | 'DESC'; by?: 'value' }
  /** The column is a Select or Multi-select, so it has an option order. */
  hasOptions: boolean
  onChange: (patch: OrderPatch) => void
  /** Opens the column editor on this column. Absent: no "Edit option order…" item. */
  onEditOptions?: () => void
}

/**
 * The order menu of one sort row or group row (YAZ-3940 D1b). It replaces the ASC/DESC chip.
 * A Select column offers its option order, the reverse, A → Z and Z → A; any other column A → Z and Z → A.
 */
export function DirectionPicker({ label, spec, hasOptions, onChange, onEditOptions }: DirectionPickerProps) {
  const [open, setOpen] = useState(false)
  const wrapper = useRef<HTMLDivElement>(null)
  const trigger = useRef<HTMLButtonElement>(null)
  const menu = useRef<HTMLDivElement>(null)
  const orders = hasOptions ? OPTION_ORDERS : VALUE_ORDERS
  const current = orderOf(spec, hasOptions)
  const close = () => { setOpen(false); trigger.current?.focus() }

  useEffect(() => {
    if (!open) return
    menu.current?.querySelector<HTMLElement>('[aria-checked="true"]')?.focus()
    const away = (event: MouseEvent) => {
      if (!wrapper.current?.contains(event.target as Node)) setOpen(false)
    }
    window.addEventListener('mousedown', away)
    return () => window.removeEventListener('mousedown', away)
  }, [open])

  const onKey = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); close(); return }
    if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return
    event.preventDefault()
    const items = [...(menu.current?.querySelectorAll<HTMLElement>('button') ?? [])]
    const at = items.indexOf(document.activeElement as HTMLElement)
    items[(at + (event.key === 'ArrowDown' ? 1 : items.length - 1)) % items.length]?.focus()
  }

  return (
    <div ref={wrapper} className="direction-picker" onBlur={(event) => {
      if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setOpen(false)
    }}>
      <button ref={trigger} type="button" className="view-chip direction-picker__trigger" aria-label={label} title={current.label}
        aria-haspopup="menu" aria-expanded={open} onClick={() => (open ? close() : setOpen(true))}>
        <span>{current.label}</span><span aria-hidden="true">⌄</span>
      </button>
      {open && (
        <div ref={menu} className="column-picker__panel direction-picker__menu" role="menu" aria-label={label} onKeyDown={onKey}>
          {orders.map(order => (
            <button key={order.label} type="button" role="menuitemradio" aria-checked={order === current} className="column-picker__option"
              onClick={() => { close(); if (order !== current) onChange(order.by ? { direction: order.direction, by: order.by } : { direction: order.direction }) }}>
              <span>{order.label}</span><span className="column-picker__check" aria-hidden="true">{order === current ? '✓' : ''}</span>
            </button>
          ))}
          {hasOptions && onEditOptions && (
            <button type="button" role="menuitem" className="column-picker__option direction-picker__edit" onClick={() => { setOpen(false); onEditOptions() }}>
              <span>Edit option order…</span>
            </button>
          )}
        </div>
      )}
    </div>
  )
}
