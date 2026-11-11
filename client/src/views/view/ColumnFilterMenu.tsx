import { type ReactNode, useState } from 'react'
import type { FilterNode } from '../viewSchema'
import { type FlyoutControl, FlyoutItem, FlyoutParent } from '../../components/Flyout'
import { type OperatorId, type Rule, type PropertyType, operator } from './filterRows'
import { type DateSpan, type WeekStart, columnFilterShape, columnRules, dateSpanRules, sameRules } from './columnFilter'
import { TextField } from './TextField'

export interface ColumnFilterMenuProps {
  /** The header menu's one flyout controller (YAZ-3746 13AU): Filter › is one of its parents. */
  flyout: FlyoutControl
  /** The column, as a canonical key. */
  property: string
  /** The column's type for its operators, as the Filter panel reads it (`inferType`, a Linked mentions column its own). */
  type: PropertyType
  /** The values the checklist lists (`propertyValues`), asked only when the flyout is a checklist. */
  values: () => string[]
  /** The view's filters, the ✓s' source. */
  filters: FilterNode | undefined
  /** Settings › Folder pages › Week starts on, for "This week". */
  weekStartsOn: WeekStart
  /** Writes this column's rules (one ⌘Z); `close` ends the menu — a checklist tick keeps it open. */
  onRules: (rules: readonly Rule[], close: boolean) => void
  /** "Clear this column's filter": shown while the column has a rule. */
  onClear: () => void
  /** "Open the filter panel…", the toolbar's Filter popover. Absent → no such row. */
  onOpenPanel?: () => void
}

const NUMBER_OPS: readonly OperatorId[] = ['eq', 'ne', 'gt', 'lt']
const DATE_OPS: readonly OperatorId[] = ['dateBefore', 'dateAfter']
const SPANS: readonly (readonly [DateSpan, string])[] = [['today', 'Today'], ['week', 'This week'], ['month', 'This month']]

/**
 * The column header's "Filter ›" (YAZ-4919), right under Group ›: quick rules on this column, in the Filter panel's own
 * grammar, so the panel shows them and the toolbar's badge counts them. The flyout fits the column's type
 * (`columnFilterShape`): a Select's options as a checklist ("is any of"; a tick is one write and the menu stays open,
 * as Header row ›), Checked · Unchecked, a "Contains" box, a number box with = ≠ > <, Today · This week · This month and
 * a Before / After date box, each with Is empty. A box applies on Enter; Esc closes the flyout. The parent row wears ✓
 * while the column has a rule, and the flyout then ends with "Clear this column's filter"; the last row opens the panel.
 */
export function ColumnFilterMenu({ flyout, property, type, values, filters, weekStartsOn, onRules, onClear, onOpenPanel }: ColumnFilterMenuProps) {
  const rules = columnRules(filters, property)
  const has = rules.length > 0
  const shape = columnFilterShape(property, type)
  const rule = (op: OperatorId, value: Rule['value'] = ''): Rule => ({ property, op, value })
  const hasOp = (op: OperatorId) => rules.some((r) => r.op === op)
  /** The column's rule under one of `ops`, for a box's value and its pressed operator. */
  const under = (ops: readonly OperatorId[]) => rules.find((r) => ops.includes(r.op))
  const pickRow = (label: string, op: OperatorId) => <FlyoutItem label={label} checked={hasOp(op)} onSelect={() => onRules([rule(op)], true)} />
  const emptyRows = (notEmpty: boolean) => (
    <div className="ctx-menu__group" role="group">
      {pickRow('Is empty', 'isEmpty')}
      {notEmpty && pickRow('Is not empty', 'isNotEmpty')}
    </div>
  )
  /** A box's value: an edit applies on Enter (or blur); emptied, it takes the column's rule away. */
  const box = (op: OperatorId, kind: 'text' | 'number' | 'date', current: Rule | undefined, label: string) => (
    <TextField
      className="view-input column-filter__input"
      aria-label={label}
      type={kind}
      inputMode={kind === 'number' ? 'decimal' : undefined}
      commitOnEnter
      value={typeof current?.value === 'string' ? current.value : ''}
      onCommit={(v) => onRules(v.trim() === '' ? [] : [rule(op, v)], true)}
    />
  )
  /** = ≠ > < or Before / After: a press keeps the keyboard in the box, so the box does not apply with the old operator. */
  const opSwitch = (ops: readonly OperatorId[], pressed: OperatorId, setOp: (op: OperatorId) => void, label: string, word: (op: OperatorId) => string) => (
    <div className="fill-target fill-target--sub" role="group" aria-label={label}>
      {ops.map((op) => (
        <button key={op} type="button" className="fill-target__opt" aria-pressed={op === pressed} onMouseDown={(e) => e.preventDefault()} onClick={() => setOp(op)}>
          {word(op)}
        </button>
      ))}
    </div>
  )

  return (
    <FlyoutParent label="Filter" hint={has ? '✓' : undefined} open={flyout.open === 'filter'} onHover={() => flyout.hover('filter')} onOpen={() => flyout.openNow('filter')} onCloseFlyout={() => flyout.openNow(null)}>
      {shape.kind === 'options' ? (
        <OptionRows property={property} op={shape.op} values={values} rules={rules} onRules={onRules} />
      ) : shape.kind === 'checkbox' ? (
        <div className="ctx-menu__group" role="group">
          {pickRow('Checked', 'checked')}
          {pickRow('Unchecked', 'unchecked')}
        </div>
      ) : shape.kind === 'text' ? (
        <div className="ctx-menu__group" role="group">
          <div className="ctx-menu__heading" role="presentation">
            {shape.label}
          </div>
          {box(shape.op, 'text', under([shape.op]), shape.label)}
        </div>
      ) : shape.kind === 'number' ? (
        <NumberRows box={box} opSwitch={opSwitch} under={under} />
      ) : shape.kind === 'date' ? (
        <DateRows property={property} weekStartsOn={weekStartsOn} rules={rules} box={box} opSwitch={opSwitch} under={under} onRules={onRules} />
      ) : null}
      {/* Is empty under every shape but a checkbox; Is not empty too where the plan says: text, and an image's. */}
      {shape.kind !== 'checkbox' && emptyRows(shape.kind === 'text' || shape.kind === 'empty')}
      {has && (
        <div className="ctx-menu__group" role="group">
          <FlyoutItem label="Clear this column's filter" onSelect={onClear} />
        </div>
      )}
      {onOpenPanel && (
        <div className="ctx-menu__group" role="group">
          <FlyoutItem label="Open the filter panel…" onSelect={onOpenPanel} />
        </div>
      )}
    </FlyoutParent>
  )
}

type Box = (op: OperatorId, kind: 'text' | 'number' | 'date', current: Rule | undefined, label: string) => ReactNode
type OpSwitch = (ops: readonly OperatorId[], pressed: OperatorId, setOp: (op: OperatorId) => void, label: string, word: (op: OperatorId) => string) => ReactNode
type Under = (ops: readonly OperatorId[]) => Rule | undefined

/**
 * The checklist ("is any of" / "has any of"): the column's values, a ✓ box on each ticked one. The ticks are the
 * column's `isAnyOf` / `hasAnyOf` rule, and a single `is` / `contains` (the row menu's "Show only this value") counts
 * as one tick; a tick writes ONE rule with the ticked values, and the last untick takes it away.
 */
function OptionRows({ property, op, values, rules, onRules }: { property: string; op: 'isAnyOf' | 'hasAnyOf'; values: () => string[]; rules: readonly Rule[]; onRules: ColumnFilterMenuProps['onRules'] }) {
  const ticked = new Set<string>()
  for (const r of rules) {
    if (r.op === op && Array.isArray(r.value)) for (const v of r.value) ticked.add(v)
    else if ((r.op === 'is' || r.op === 'contains') && typeof r.value === 'string' && r.value !== '') ticked.add(r.value)
  }
  const known = values()
  // A tick the list lacks still shows (a hand-edited rule), as the panel's checklist (YAZ-1467).
  const listed = [...[...ticked].filter((v) => !known.includes(v)), ...known]
  const toggle = (value: string) => {
    const next = new Set(ticked)
    if (next.has(value)) next.delete(value)
    else next.add(value)
    onRules(next.size === 0 ? [] : [{ property, op, value: [...next] }], false)
  }
  if (listed.length === 0) return null
  return (
    <div className="ctx-menu__group" role="group">
      {listed.map((value) => {
        const on = ticked.has(value)
        return (
          <button key={value} type="button" role="menuitemcheckbox" aria-checked={on} className="ctx-menu__item" onClick={() => toggle(value)}>
            <span className="ctx-menu__label">
              <span className="column-filter__box" aria-hidden="true">
                {on ? '✓' : ''}
              </span>
              {value}
            </span>
          </button>
        )
      })}
    </div>
  )
}

/** = ≠ > < over one number box; the pressed operator starts at the column's rule. */
function NumberRows({ box, opSwitch, under }: { box: Box; opSwitch: OpSwitch; under: Under }) {
  const current = under(NUMBER_OPS)
  const [op, setOp] = useState<OperatorId>(current?.op ?? 'eq')
  return (
    <div className="ctx-menu__group" role="group">
      {opSwitch(NUMBER_OPS, op, setOp, 'Number operator', (o) => operator(o).label)}
      {box(op, 'number', current, 'Number')}
    </div>
  )
}

/** Today · This week · This month, then Before / After over one date box. */
function DateRows({ property, weekStartsOn, rules, box, opSwitch, under, onRules }: { property: string; weekStartsOn: WeekStart; rules: readonly Rule[]; box: Box; opSwitch: OpSwitch; under: Under; onRules: ColumnFilterMenuProps['onRules'] }) {
  const current = under(DATE_OPS)
  const [op, setOp] = useState<OperatorId>(current?.op ?? 'dateBefore')
  return (
    <>
      <div className="ctx-menu__group" role="group">
        {SPANS.map(([span, label]) => {
          const next = dateSpanRules(property, span, weekStartsOn)
          return <FlyoutItem key={span} label={label} checked={sameRules(rules, next)} onSelect={() => onRules(next, true)} />
        })}
      </div>
      <div className="ctx-menu__group" role="group">
        {opSwitch(DATE_OPS, op, setOp, 'Date operator', (o) => (o === 'dateBefore' ? 'Before' : 'After'))}
        {box(op, 'date', current, 'Date')}
      </div>
    </>
  )
}
