import { useState } from 'react'
import type { IndexRecord, PropertiesResponse } from '@shared/types'
import type { ViewSet, ViewDef, FilterNode, Mutate } from '../viewSchema'
import { type ColumnTyping, columnTyping } from '../editorType'
import type { FolderPageMode } from '../ViewsPane'
import { type EngineError, propertyLabel } from '../engine'
import {
  type Conjunction, type FilterGroup, type OperatorId, type Rule, exprToRule, fromGroup, inferType, operator,
  operatorsFor, ruleToExpr, toGroup,
} from './filterRows'
import { canonicalKey } from './keys'
import { allPropertyKeys, withKey } from './properties'
import { TextField } from './TextField'

export interface FilterMenuProps {
  def: ViewSet
  view: ViewDef
  viewIndex: number
  records: readonly IndexRecord[]
  /** The engine's `*.filters` errors, listed at the top of the menu (YAZ-1229). */
  errors: readonly EngineError[]
  /** The vault-wide declarations, for the typing ladder behind the operator list (D4). */
  properties: PropertiesResponse | null
  /** The folder page's own declarations — that ladder's TOP rung (🔒 Q8, YAZ-895). */
  folderPage: FolderPageMode
  onUpdate: Mutate
}

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
 * Filter menu (GRO-2135), back from the YAZ-846 amputation (YAZ-1218 / YAZ-1227): conjunction
 * (All / Any / None → and / or / not), builder rows, Advanced raw expressions, and the engine's
 * own `filters` errors at the top (YAZ-1229). PER-VIEW only (D1, 🔒 Q3 amended): a folder page's
 * set IS the lookup, so `def.filters` has no editor here and the scope segment did not come back.
 */
export function FilterMenu({ def, view, viewIndex, records, errors, properties, folderPage, onUpdate }: FilterMenuProps) {
  const [advanced, setAdvanced] = useState(false)
  const [pendingConj, setPendingConj] = useState<Conjunction>('and')
  const group = toGroup(view.filters)
  const conj = group.items.length ? group.conj : pendingConj
  const keys = [...allPropertyKeys(def, view, records, folderPage.settings.columns), ...FILE_EXTRAS]
  /** The column's rung of the typing ladder (D4), the same one the table's cell editors read. */
  const typingOf = (property: string): ColumnTyping => columnTyping(property, records, properties, folderPage.settings)

  const write = (next: FilterGroup) =>
    onUpdate((d) => {
      const node = fromGroup(next)
      if (node === undefined) delete d.views[viewIndex].filters
      else d.views[viewIndex].filters = node
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
    const ops = operatorsFor(next.property, inferType(next.property, records, typingOf(next.property)))
    if (patch.property !== undefined && !ops.some((o) => o.id === next.op)) next.op = ops[0]?.id ?? next.op
    if (operator(next.op).value !== operator(rule.op).value) next.value = ''
    setItem(i, ruleToExpr(next))
  }

  const ruleRow = (rule: Rule, i: number) => {
    const type = inferType(rule.property, records, typingOf(rule.property))
    const ops = operatorsFor(rule.property, type)
    const opList = ops.some((o) => o.id === rule.op) ? ops : [...ops, operator(rule.op)]
    const kind = operator(rule.op).value
    return (
      <>
        <select
          className="view-select"
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
          className="view-select"
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
            className="view-input"
            aria-label="Value"
            type={kind === 'date' ? 'date' : kind === 'number' ? 'number' : 'text'}
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
      <li key={i} className="view-rule">
        <div className="view-rule__main">
          {rule ? ruleRow(rule, i) : <code className="view-rule__code">{raw}</code>}
          <button type="button" className="view-rule__remove" aria-label="Remove rule" title="Remove rule" onClick={() => removeItem(i)}>
            ×
          </button>
        </div>
        {advanced && typeof item === 'string' && (
          <TextField className="view-input view-rule__expr" aria-label="Expression" value={item} onCommit={(expr) => setItem(i, expr)} />
        )}
      </li>
    )
  }

  return (
    <div className="view-menu">
      {errors.length > 0 && (
        <ul className="view-menu__errors" role="alert">
          {errors.map((e, i) => (
            <li key={i}>
              <code>{e.where}</code> {e.message}
            </li>
          ))}
        </ul>
      )}
      <div className="view-menu__head">
        <div className="view-seg" role="group" aria-label="Match">
          {CONJUNCTIONS.map((c) => (
            <button key={c.id} type="button" className="view-seg__opt" aria-pressed={conj === c.id} onClick={() => setConj(c.id)}>
              {c.label}
            </button>
          ))}
        </div>
      </div>
      {group.items.length === 0 ? <p className="view-menu__empty">No filters</p> : <ul className="view-menu__list">{group.items.map(row)}</ul>}
      <div className="view-menu__foot">
        <button type="button" className="view-menu__action" onClick={() => write({ conj, items: [...group.items, ruleToExpr(NEW_RULE)] })}>
          Add rule
        </button>
        <label className="view-menu__toggle">
          <input type="checkbox" checked={advanced} onChange={(e) => setAdvanced(e.target.checked)} />
          Advanced
        </label>
      </div>
    </div>
  )
}
