/**
 * A Super table view's Sort, Group and Filter panels (YAZ-4869 S3 / S4: YAZ-4874, YAZ-4875). The folder pages' menu is
 * built for notes as rows (`views/view/SortMenu.tsx`: Folder, file fields, option order), so these are small panels
 * with the same look (`views.css`: `view-menu`, `view-rule`) and the same pickers (`ColumnPicker`, `DirectionPicker`,
 * `GroupStylePicker`). Each change is one write of the view (`onChange`): one undo step. They change the view only,
 * never the rows.
 */
import { useState, type ReactNode } from 'react'
import type { IndexRecord } from '@shared/types'
import { ColumnPicker } from '../../../views/view/ColumnPicker'
import { DirectionPicker } from '../../../views/view/DirectionPicker'
import { GroupStylePicker } from '../../../views/view/GroupStylePicker'
import { inferType, operatorsFor } from '../../../views/view/filterRows'
import { MAX_LEVELS, VIEW_OPS, type TableViewDef, type ViewFilter, type ViewGroup, type ViewOp, type ViewSort } from './viewGrammar'

interface PanelProps {
  def: TableViewDef
  keys: readonly string[]
  onChange: (next: TableViewDef) => void
}

/** `def` with one list set; an empty list is no key, so the comment loses the clause. */
function withList<K extends 'sort' | 'group' | 'filter'>(def: TableViewDef, key: K, list: NonNullable<TableViewDef[K]>): TableViewDef {
  const next = { ...def }
  if (list.length === 0) delete next[key]
  else next[key] = list
  return next
}

const swap = <T,>(list: readonly T[], i: number): T[] => {
  const next = [...list]
  ;[next[i - 1], next[i]] = [next[i]!, next[i - 1]!]
  return next
}

/** One rule row: ↑ (before the row above), the body, ×. */
function Rule({ index, label, onUp, onRemove, children }: { index: number; label: string; onUp: () => void; onRemove: () => void; children: ReactNode }) {
  return (
    <li className="view-rule">
      <div className="view-rule__main">
        <button type="button" className="view-rule__nav" aria-label={`Move ${label} up`} title="Move up" disabled={index === 0} onClick={onUp}>
          ↑
        </button>
        {children}
        <button type="button" className="view-rule__remove" aria-label={`Remove ${label}`} title="Remove" onClick={onRemove}>
          ×
        </button>
      </div>
    </li>
  )
}

const columnOptions = (keys: readonly string[]) => keys.map((k) => ({ value: k, label: k }))

/** S4 item 11: the sort levels, first wins. */
export function SortPanel({ def, keys, onChange }: PanelProps) {
  const sort = def.sort ?? []
  const write = (next: ViewSort[]) => onChange(withList(def, 'sort', next))
  const set = (i: number, patch: ViewSort) => write(sort.map((s, j) => (j === i ? patch : s)))
  return (
    <div className="view-menu super-menu super-menu--rules super-menu--sort" role="dialog" aria-label="Sort">
      <p className="view-menu__label">Sort</p>
      {sort.length === 0 && <p className="view-menu__empty">The rows are in table order.</p>}
      <ul className="view-menu__list">
        {sort.map((s, i) => (
          <Rule key={i} index={i} label={`sort ${i + 1}`} onUp={() => write(swap(sort, i))} onRemove={() => write(sort.filter((_, j) => j !== i))}>
            <ColumnPicker label={`Sort ${i + 1} column`} value={s.column} options={columnOptions(keys)} onChange={(column) => set(i, { ...s, column })} />
            <DirectionPicker label={`Sort ${i + 1} direction`} spec={{ direction: s.desc === true ? 'DESC' : 'ASC' }} hasOptions={false} onChange={(p) => set(i, p.direction === 'DESC' ? { column: s.column, desc: true } : { column: s.column })} />
          </Rule>
        ))}
      </ul>
      <div className="view-menu__foot">
        <button type="button" className="view-menu__action" disabled={keys.length === 0} onClick={() => write([...sort, { column: keys.find((k) => !sort.some((s) => s.column === k)) ?? keys[0]! }])}>
          Add sort
        </button>
      </div>
    </div>
  )
}

const ORDERS = [
  { value: '', label: 'First appearance' },
  { value: 'asc', label: 'A → Z' },
  { value: 'desc', label: 'Z → A' },
]

/** S3 items 7, 10: up to five levels, each with its order and its header look; and the group lines. */
export function GroupPanel({ def, keys, onChange }: PanelProps) {
  const levels = def.group ?? []
  const write = (next: ViewGroup[]) => onChange(withList(def, 'group', next))
  const set = (i: number, patch: ViewGroup) => write(levels.map((g, j) => (j === i ? patch : g)))
  const free = keys.filter((k) => !levels.some((g) => g.column === k))
  const lines = def.lines ?? 'hover'
  return (
    <div className="view-menu super-menu super-menu--rules super-menu--group" role="dialog" aria-label="Group">
      <p className="view-menu__label">Group</p>
      {levels.length === 0 && <p className="view-menu__empty">No groups.</p>}
      <ul className="view-menu__list">
        {levels.map((g, i) => (
          <Rule key={i} index={i} label={`group level ${i + 1}`} onUp={() => write(swap(levels, i))} onRemove={() => write(levels.filter((_, j) => j !== i))}>
            <ColumnPicker label={`Group level ${i + 1} column`} value={g.column} options={columnOptions([g.column, ...free])} onChange={(column) => set(i, { ...g, column })} />
            <ColumnPicker
              label={`Group level ${i + 1} order`}
              value={g.order ?? ''}
              options={ORDERS}
              noun="orders"
              onChange={(order) => {
                const { order: _old, ...rest } = g
                set(i, order === '' ? rest : { ...rest, order: order as 'asc' | 'desc' })
              }}
            />
            <GroupStylePicker
              label={`Style of group level ${i + 1}`}
              spec={{ property: g.column, ...(g.highlight !== undefined && { highlight: g.highlight }), ...(g.large === true && { large: true }) }}
              onChange={(spec) => {
                const { highlight: _h, large: _l, ...rest } = g
                set(i, { ...rest, ...(spec.highlight !== undefined && { highlight: spec.highlight }), ...(spec.large === true && { large: true as const }) })
              }}
            />
          </Rule>
        ))}
      </ul>
      {levels.length < MAX_LEVELS && free.length > 0 && (
        <div className="view-menu__foot">
          <button type="button" className="view-menu__action" onClick={() => write([...levels, { column: free[0]! }])}>
            Add group level
          </button>
        </div>
      )}
      {levels.length > 0 && (
        <>
          <p className="view-menu__label">Group lines</p>
          <div className="super-menu__segments" role="group" aria-label="Group lines">
            {(['hover', 'always', 'off'] as const).map((value) => (
              <button
                key={value}
                type="button"
                className="view-chip"
                aria-pressed={lines === value}
                onClick={() => {
                  const { lines: _old, ...rest } = def
                  onChange(value === 'hover' ? rest : { ...rest, lines: value })
                }}
              >
                {value === 'hover' ? 'On hover' : value === 'always' ? 'Always' : 'Off'}
              </button>
            ))}
            <button
              type="button"
              className="view-chip"
              aria-pressed={def.thread === true}
              title="The lines lead to the row under the pointer"
              onClick={() => {
                const { thread: _old, ...rest } = def
                onChange(def.thread === true ? rest : { ...rest, thread: true })
              }}
            >
              Thread
            </button>
          </div>
        </>
      )}
    </div>
  )
}

/** A filter's typed value, written on Enter or when the box loses the focus: no write per key. */
function ValueBox({ value, label, onCommit }: { value: string; label: string; onCommit: (value: string) => void }) {
  const [text, setText] = useState(value)
  const commit = () => {
    if (text !== value) onCommit(text)
  }
  return (
    <input
      className="view-select super-menu__value"
      aria-label={label}
      value={text}
      onChange={(e) => setText(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === 'Enter') commit()
        if (e.key === 'Escape') setText(value)
      }}
    />
  )
}

/** S4 item 12: every filter must match. The operators follow the column's typed cells (item 14). */
export function FilterPanel({ def, keys, onChange, records }: PanelProps & { records: readonly IndexRecord[] }) {
  const filters = def.filter ?? []
  const write = (next: ViewFilter[]) => onChange(withList(def, 'filter', next))
  const set = (i: number, patch: ViewFilter) => write(filters.map((f, j) => (j === i ? patch : f)))
  const opsOf = (column: string) => operatorsFor(`note.${column}`, inferType(`note.${column}`, records)).filter((op) => Object.hasOwn(VIEW_OPS, op.id))
  const withOp = (column: string, op: ViewOp, value?: string): ViewFilter => (VIEW_OPS[op] ? { column, op, value: value ?? '' } : { column, op })
  return (
    <div className="view-menu super-menu super-menu--rules super-menu--filter" role="dialog" aria-label="Filter">
      <p className="view-menu__label">Filter</p>
      {filters.length === 0 && <p className="view-menu__empty">Every row shows.</p>}
      <ul className="view-menu__list">
        {filters.map((f, i) => {
          const ops = opsOf(f.column)
          return (
            <Rule key={i} index={i} label={`filter ${i + 1}`} onUp={() => write(swap(filters, i))} onRemove={() => write(filters.filter((_, j) => j !== i))}>
              <ColumnPicker
                label={`Filter ${i + 1} column`}
                value={f.column}
                options={columnOptions(keys)}
                onChange={(column) => {
                  const first = opsOf(column)[0]?.id as ViewOp | undefined
                  set(i, withOp(column, opsOf(column).some((op) => op.id === f.op) ? f.op : (first ?? 'is'), f.value))
                }}
              />
              <ColumnPicker label={`Filter ${i + 1} operator`} value={f.op} options={ops.map((op) => ({ value: op.id, label: op.label }))} noun="operators" onChange={(op) => set(i, withOp(f.column, op as ViewOp, f.value))} />
              {VIEW_OPS[f.op] && <ValueBox key={`${i}:${f.value}`} label={`Filter ${i + 1} value`} value={f.value ?? ''} onCommit={(value) => set(i, { ...f, value })} />}
            </Rule>
          )
        })}
      </ul>
      <div className="view-menu__foot">
        <button
          type="button"
          className="view-menu__action"
          disabled={keys.length === 0}
          onClick={() => {
            const column = keys[0]!
            write([...filters, withOp(column, (opsOf(column)[0]?.id as ViewOp | undefined) ?? 'is')])
          }}
        >
          Add filter
        </button>
      </div>
    </div>
  )
}
