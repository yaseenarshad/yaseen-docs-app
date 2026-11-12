import { Fragment, type ReactNode, useEffect, useRef, useState } from 'react'
import type { IndexRecord } from '@shared/types'
import type { FilterNode } from '../viewSchema'
import { type FlyoutControl, FlyoutItem, FlyoutParent } from '../../components/Flyout'
import { type OperatorId, type Rule, type PropertyType, operator, unquote } from './filterRows'
import { type ValueCount, columnFilterShape, columnRules, valueCounts } from './columnFilter'
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
  /**
   * The rows that pass the view's filters with this column's rules replaced by `rules` (YAZ-4919 round 2): the live
   * count and the value list under the Contains box. Absent → neither.
   */
  matches?: (rules: readonly Rule[]) => readonly IndexRecord[]
  /** Writes this column's rules (one ⌘Z); `close` ends the menu — a checklist tick keeps it open. */
  onRules: (rules: readonly Rule[], close: boolean) => void
  /** "Clear this column's filter": shown while the column has a rule. */
  onClear: () => void
  /** "Open the filter panel…", the toolbar's Filter popover. Absent → no such row. */
  onOpenPanel?: () => void
}

const NUMBER_OPS: readonly OperatorId[] = ['eq', 'ne', 'gt', 'lt']
/** The typing pause before the Contains box counts and lists (YAZ-4919 round 2): never per keystroke. */
const PROBE_MS = 150
/** How many of the column's values the Contains box lists. */
const VALUE_LIMIT = 8
const DATE_OPS: readonly OperatorId[] = ['dateBefore', 'dateAfter']
/** Today · This week · This month: the LIVE operators (the engine reads the day at each run, YAZ-4919). */
const SPANS: readonly (readonly [OperatorId, string])[] = [['dateIsToday', 'Today'], ['dateInThisWeek', 'This week'], ['dateInThisMonth', 'This month']]

/**
 * The column header's "Filter ›" (YAZ-4919), right under Group ›: quick rules on this column, in the Filter panel's own
 * grammar, so the panel shows them and the toolbar's badge counts them. The flyout fits the column's type
 * (`columnFilterShape`): a Select's options as a checklist ("is any of"; a tick is one write and the menu stays open,
 * as Header row ›), Checked · Unchecked, a "Contains" box, a number box with = ≠ > <, Today · This week · This month and
 * a Before / After date box, each with Is empty. A box applies on Enter; Esc closes the flyout. The parent row wears ✓
 * while the column has a rule, and the flyout then ends with "Clear this column's filter"; the last row opens the panel.
 * The checklist and the Contains box have a switch to their opposite (YAZ-4929): "Is none of" / "Has none of" over the
 * checklist and "Does not contain" over the box, the panel's own rules (`columnFilterShape`). A text column's box ignores
 * case and drops one pair of quotes, and under it a live count and the column's own values (`TextRows`, YAZ-4919 round 2).
 */
export function ColumnFilterMenu({ flyout, property, type, values, filters, matches, onRules, onClear, onOpenPanel }: ColumnFilterMenuProps) {
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
  /**
   * A box's value: an edit applies on Enter (or blur); emptied, it takes the column's rule away. A text box drops one
   * pair of wrapping quotes (YAZ-4919 round 2): `"start"` is `start`.
   */
  const box = (op: OperatorId, kind: 'text' | 'number' | 'date', current: Rule | undefined, label: string, onDraft?: (draft: string) => void) => (
    <TextField
      className="view-input column-filter__input"
      aria-label={label}
      type={kind}
      inputMode={kind === 'number' ? 'decimal' : undefined}
      commitOnEnter
      value={typeof current?.value === 'string' ? current.value : ''}
      onDraft={onDraft}
      onCommit={(raw) => {
        const v = kind === 'text' ? unquote(raw) : raw
        onRules(v.trim() === '' ? [] : [rule(op, v)], true)
      }}
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
        <OptionRows property={property} op={shape.op} not={shape.not} values={values} rules={rules} onRules={onRules} opSwitch={opSwitch} />
      ) : shape.kind === 'checkbox' ? (
        <div className="ctx-menu__group" role="group">
          {pickRow('Checked', 'checked')}
          {pickRow('Unchecked', 'unchecked')}
        </div>
      ) : shape.kind === 'text' ? (
        shape.not === undefined ? (
          <div className="ctx-menu__group" role="group">
            <div className="ctx-menu__heading" role="presentation">
              {shape.label}
            </div>
            {box(shape.op, 'text', under([shape.op]), shape.label)}
          </div>
        ) : (
          <TextRows property={property} shape={shape} not={shape.not} rules={rules} matches={matches} onRules={onRules} box={box} opSwitch={opSwitch} under={under} />
        )
      ) : shape.kind === 'number' ? (
        <NumberRows box={box} opSwitch={opSwitch} under={under} />
      ) : shape.kind === 'date' ? (
        <DateRows pickRow={pickRow} box={box} opSwitch={opSwitch} under={under} />
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

type Box = (op: OperatorId, kind: 'text' | 'number' | 'date', current: Rule | undefined, label: string, onDraft?: (draft: string) => void) => ReactNode
type OpSwitch = (ops: readonly OperatorId[], pressed: OperatorId, setOp: (op: OperatorId) => void, label: string, word: (op: OperatorId) => string) => ReactNode
type Under = (ops: readonly OperatorId[]) => Rule | undefined

/** The panel's operator label as a switch word: "Is any of", "Has none of". */
const word = (op: OperatorId): string => {
  const label = operator(op).label
  return label.charAt(0).toUpperCase() + label.slice(1)
}

/**
 * The checklist ("is any of" / "has any of"): the column's values, a ✓ box on each ticked one. The ticks are the
 * column's `isAnyOf` / `hasAnyOf` rule, and a single `is` / `contains` (the row menu's "Show only this value") counts
 * as one tick; a tick writes ONE rule with the ticked values, and the last untick takes it away. The switch above it
 * (YAZ-4929) turns the ticks into the opposite rule ("is none of" / "has none of"; a single `is not` / `does not
 * contain` is one tick under it): a press with ticks rewrites them under the other operator, one write, menu open.
 */
function OptionRows({ property, op, not, values, rules, onRules, opSwitch }: { property: string; op: 'isAnyOf' | 'hasAnyOf'; not: 'isNoneOf' | 'hasNoneOf'; values: () => string[]; rules: readonly Rule[]; onRules: ColumnFilterMenuProps['onRules']; opSwitch: OpSwitch }) {
  const ticked = new Set<string>()
  let held: OperatorId | null = null
  for (const r of rules) {
    if ((r.op === op || r.op === not) && Array.isArray(r.value)) {
      held = r.op
      for (const v of r.value) ticked.add(v)
    } else if ((r.op === 'is' || r.op === 'contains' || r.op === 'isNot' || r.op === 'notContains') && typeof r.value === 'string' && r.value !== '') {
      held = r.op === 'is' || r.op === 'contains' ? op : not
      ticked.add(r.value)
    }
  }
  const [chosen, setChosen] = useState<OperatorId>(held ?? op)
  const pressed = held ?? chosen
  const known = values()
  // A tick the list lacks still shows (a hand-edited rule), as the panel's checklist (YAZ-1467).
  const listed = [...[...ticked].filter((v) => !known.includes(v)), ...known]
  const toggle = (value: string) => {
    const next = new Set(ticked)
    if (next.has(value)) next.delete(value)
    else next.add(value)
    onRules(next.size === 0 ? [] : [{ property, op: pressed, value: [...next] }], false)
  }
  const switchTo = (to: OperatorId) => {
    setChosen(to)
    if (to !== pressed && ticked.size > 0) onRules([{ property, op: to, value: [...ticked] }], false)
  }
  if (listed.length === 0) return null
  return (
    <div className="ctx-menu__group" role="group">
      {opSwitch([op, not], pressed, switchTo, 'Checklist operator', word)}
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

/** What the Contains box shows under itself: the rows its rule would keep (null while the box is empty), and the values. */
interface Probe {
  count: number | null
  values: ValueCount[]
}

const countWords = (n: number): string => (n === 0 ? 'No rows match' : n === 1 ? '1 row matches' : `${n} rows match`)

/**
 * Contains / Does not contain over one text box (YAZ-4929); the pressed operator starts at the column's rule. Under the
 * box (YAZ-4919 round 2): a live count, "2 rows match" / "No rows match", of the rows the typed rule would keep with the
 * other columns' rules applied (`matches`, the engine's own run), then up to eight of the column's own values that
 * contain the text, case ignored, each with its row count, most rows first; empty text lists the most common. A click on
 * a value writes ONE exact "is" rule, and that value wears the ✓ while the column holds it. The rows the OTHER rules keep
 * are read once per open; the count and the list follow the typing after a pause (`PROBE_MS`), never per keystroke.
 */
function TextRows({ property, shape, not, rules, matches, onRules, box, opSwitch, under }: { property: string; shape: { op: OperatorId; label: string }; not: { op: OperatorId; label: string }; rules: readonly Rule[]; matches: ColumnFilterMenuProps['matches']; onRules: ColumnFilterMenuProps['onRules']; box: Box; opSwitch: OpSwitch; under: Under }) {
  const current = under([shape.op, not.op])
  const [op, setOp] = useState<OperatorId>(current?.op ?? shape.op)
  const label = op === not.op ? not.label : shape.label
  const [draft, setDraft] = useState(typeof current?.value === 'string' ? current.value : '')
  const [base] = useState<readonly IndexRecord[]>(() => matches?.([]) ?? [])
  const probeOf = (text: string, under: OperatorId): Probe => {
    const t = unquote(text)
    return {
      count: t.trim() === '' || matches === undefined ? null : matches([{ property, op: under, value: t }]).length,
      values: valueCounts(property, base, t, VALUE_LIMIT),
    }
  }
  // The first paint carries its probe; each edit's waits out the pause, and a newer edit cancels an older wait.
  const [probe, setProbe] = useState<Probe>(() => probeOf(draft, op))
  const mounted = useRef(false)
  useEffect(() => {
    if (!mounted.current) {
      mounted.current = true
      return
    }
    const timer = window.setTimeout(() => setProbe(probeOf(draft, op)), PROBE_MS)
    return () => window.clearTimeout(timer)
  }, [draft, op])
  const held = (value: string) => rules.some((r) => r.op === 'is' && r.value === value)
  return (
    <div className="ctx-menu__group" role="group">
      {opSwitch([shape.op, not.op], op, setOp, 'Text operator', (o) => (o === not.op ? not.label : shape.label))}
      {box(op, 'text', current, label, setDraft)}
      {probe.count !== null && (
        <div className="ctx-menu__heading column-filter__count" role="status">
          {countWords(probe.count)}
        </div>
      )}
      {probe.values.map(({ value, count }) => (
        <button key={value} type="button" role="menuitem" className="ctx-menu__item column-filter__value" data-hint={held(value) ? '✓' : undefined} data-count={count} onClick={() => onRules([{ property, op: 'is', value }], true)}>
          {value}
        </button>
      ))}
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

/** Today · This week · This month (live, ✓ while the column holds that rule), then Before / After over one date box. */
function DateRows({ pickRow, box, opSwitch, under }: { pickRow: (label: string, op: OperatorId) => ReactNode; box: Box; opSwitch: OpSwitch; under: Under }) {
  const current = under(DATE_OPS)
  const [op, setOp] = useState<OperatorId>(current?.op ?? 'dateBefore')
  return (
    <>
      <div className="ctx-menu__group" role="group">{SPANS.map(([span, label]) => <Fragment key={span}>{pickRow(label, span)}</Fragment>)}</div>
      <div className="ctx-menu__group" role="group">
        {opSwitch(DATE_OPS, op, setOp, 'Date operator', (o) => (o === 'dateBefore' ? 'Before' : 'After'))}
        {box(op, 'date', current, 'Date')}
      </div>
    </>
  )
}
