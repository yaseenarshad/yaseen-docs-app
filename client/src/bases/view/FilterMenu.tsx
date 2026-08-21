import { useState } from 'react'
import type { IndexRecord } from '@shared/types'
import type { BaseDefinition, BaseView, FilterNode } from '../baseFile'
import { type EngineError, propertyLabel } from '../engine'
import {
  type Conjunction, type FilterGroup, type OperatorId, type Rule, canonicalKey, exprToRule, fromGroup, inferType, operator,
  operatorsFor, ruleToExpr, toGroup,
} from './filterRows'
import { allPropertyKeys, withKey } from './properties'
import { TextField } from './TextField'

export type Mutate = (mutate: (def: BaseDefinition) => void) => void

export interface FilterMenuProps {
  def: BaseDefinition
  view: BaseView
  viewIndex: number
  records: readonly IndexRecord[]
  errors: readonly EngineError[]
  onUpdate: Mutate
}

type Scope = 'view' | 'base'

const CONJUNCTIONS: { id: Conjunction; label: string }[] = [
  { id: 'and', label: 'All' },
  { id: 'or', label: 'Any' },
  { id: 'not', label: 'None' },
]

/** The three file-method pseudo-properties are only meaningful here, so they join the property list. */
const FILE_EXTRAS = ['file.tags', 'file.folder', 'file.links']

/** A fresh rule matches every row, so adding one never blanks the view before it is filled in. */
const NEW_RULE: Rule = { property: 'file.name', op: 'contains', value: '' }

/**
 * Filter menu (GRO-2135): conjunction (All / Any / None → and / or / not), scope (this view's
 * `filters` vs the base-level `def.filters`), builder rows, Advanced raw expressions.
 */
export function FilterMenu({ def, view, viewIndex, records, errors, onUpdate }: FilterMenuProps) {
  const [scope, setScope] = useState<Scope>('view')
  const [advanced, setAdvanced] = useState(false)
  const [pendingConj, setPendingConj] = useState<Conjunction>('and')
  const group = toGroup(scope === 'view' ? view.filters : def.filters)
  const conj = group.items.length ? group.conj : pendingConj
  const keys = [...allPropertyKeys(def, view, records), ...FILE_EXTRAS]

  const write = (next: FilterGroup) =>
    onUpdate((d) => {
      const target = scope === 'view' ? d.views[viewIndex] : d
      const node = fromGroup(next)
      if (node === undefined) delete target.filters
      else target.filters = node
    })
  const setItem = (i: number, item: FilterNode) => write({ conj, items: group.items.map((x, j) => (j === i ? item : x)) })
  const removeItem = (i: number) => write({ conj, items: group.items.filter((_, j) => j !== i) })
  const setConj = (c: Conjunction) => {
    setPendingConj(c)
    if (group.items.length) write({ conj: c, items: group.items })
  }

  /** Changes one field, re-validating the operator for the property's type and clearing a value of another kind. */
  const setRule = (i: number, rule: Rule, patch: Partial<Rule>) => {
    const next = { ...rule, ...patch }
    const ops = operatorsFor(next.property, inferType(next.property, records))
    if (patch.property !== undefined && !ops.some((o) => o.id === next.op)) next.op = ops[0]?.id ?? next.op
    if (operator(next.op).value !== operator(rule.op).value) next.value = ''
    setItem(i, ruleToExpr(next))
  }

  const ruleRow = (rule: Rule, i: number) => {
    const type = inferType(rule.property, records)
    const ops = operatorsFor(rule.property, type)
    const opList = ops.some((o) => o.id === rule.op) ? ops : [...ops, operator(rule.op)]
    const kind = operator(rule.op).value
    return (
      <>
        <select
          className="base-select"
          aria-label="Property"
          value={canonicalKey(rule.property)}
          onChange={(e) => setRule(i, rule, { property: e.target.value })}
        >
          {withKey(keys, rule.property).map((k) => (
            <option key={canonicalKey(k)} value={canonicalKey(k)}>
              {propertyLabel(def, k)}
            </option>
          ))}
        </select>
        <select
          className="base-select"
          aria-label="Operator"
          value={rule.op}
          onChange={(e) => setRule(i, rule, { op: e.target.value as OperatorId })}
        >
          {opList.map((o) => (
            <option key={o.id} value={o.id}>
              {o.label}
            </option>
          ))}
        </select>
        {kind !== 'none' && (
          <TextField
            className="base-input"
            aria-label="Value"
            type={kind === 'date' ? 'date' : 'text'}
            inputMode={kind === 'number' ? 'decimal' : undefined}
            value={rule.value}
            onCommit={(value) => setRule(i, rule, { value })}
          />
        )}
      </>
    )
  }

  const row = (item: FilterNode, i: number) => {
    const rule = typeof item === 'string' ? exprToRule(item) : null
    const raw = typeof item === 'string' ? item : JSON.stringify(item)
    return (
      <li key={i} className="base-rule">
        <div className="base-rule__main">
          {rule ? ruleRow(rule, i) : <code className="base-rule__code">{raw}</code>}
          <button type="button" className="base-rule__remove" aria-label="Remove rule" title="Remove rule" onClick={() => removeItem(i)}>
            ×
          </button>
        </div>
        {advanced && typeof item === 'string' && (
          <TextField className="base-input base-rule__expr" aria-label="Expression" value={item} onCommit={(expr) => setItem(i, expr)} />
        )}
      </li>
    )
  }

  return (
    <div className="base-menu">
      {errors.length > 0 && (
        <ul className="base-menu__errors" role="alert">
          {errors.map((e, i) => (
            <li key={i}>
              <code>{e.where}</code> {e.message}
            </li>
          ))}
        </ul>
      )}
      <div className="base-menu__head">
        <div className="base-seg" role="group" aria-label="Match">
          {CONJUNCTIONS.map((c) => (
            <button key={c.id} type="button" className="base-seg__opt" aria-pressed={conj === c.id} onClick={() => setConj(c.id)}>
              {c.label}
            </button>
          ))}
        </div>
        <div className="base-seg" role="group" aria-label="Scope">
          <button type="button" className="base-seg__opt" aria-pressed={scope === 'view'} onClick={() => setScope('view')}>
            This view
          </button>
          <button type="button" className="base-seg__opt" aria-pressed={scope === 'base'} onClick={() => setScope('base')}>
            All views
          </button>
        </div>
      </div>
      {group.items.length === 0 ? <p className="base-menu__empty">No filters</p> : <ul className="base-menu__list">{group.items.map(row)}</ul>}
      <div className="base-menu__foot">
        <button type="button" className="base-menu__action" onClick={() => write({ conj, items: [...group.items, ruleToExpr(NEW_RULE)] })}>
          Add rule
        </button>
        <label className="base-menu__toggle">
          <input type="checkbox" checked={advanced} onChange={(e) => setAdvanced(e.target.checked)} />
          Advanced
        </label>
      </div>
    </div>
  )
}
