import type { FilterNode } from '../viewSchema'
import { formatDate, startOfDay } from '../expr/dates'
import { type OperatorId, type PropertyType, type Rule, exprToRule, fromGroup, ruleToExpr, toGroup } from './filterRows'
import { canonicalKey } from './keys'

/**
 * The column header's Filter › (YAZ-4919): quick rules on ONE column, in the Filter panel's own grammar (`filterRows.ts`),
 * so the panel shows and edits them. Pure and DOM-free. A column's rules are the view's TOP-LEVEL rules on it (a rule
 * inside a nested group is the panel's); a pick replaces them, and Clear removes them.
 */

/** What the flyout offers for a column's type: a checklist of its values, Checked · Unchecked, a text box, a number box, dates, or only Is empty. */
export type ColumnFilterShape =
  | { kind: 'options'; op: 'isAnyOf' | 'hasAnyOf' }
  | { kind: 'checkbox' }
  | { kind: 'text'; op: OperatorId; label: string }
  | { kind: 'number' }
  | { kind: 'date' }
  | { kind: 'empty' }

/** The shape for a column's type (the panel's `inferType`), each with the operators the engine has. */
export function columnFilterShape(property: string, type: PropertyType): ColumnFilterShape {
  switch (type) {
    case 'select':
    case 'link':
      return { kind: 'options', op: 'isAnyOf' }
    case 'multi-select':
    case 'list':
    case 'tags':
    case 'multi-link':
      return { kind: 'options', op: 'hasAnyOf' }
    case 'checkbox':
      return { kind: 'checkbox' }
    case 'number':
      return { kind: 'number' }
    case 'date':
      return { kind: 'date' }
    case 'image':
      return { kind: 'empty' }
    case 'file':
      // The three file pseudo-properties (`FILE_OPS`): tags and folders as a checklist, links as a box.
      if (property === 'file.tags') return { kind: 'options', op: 'hasAnyOf' }
      if (property === 'file.folder') return { kind: 'options', op: 'isAnyOf' }
      return { kind: 'text', op: 'hasLink', label: 'Links to' }
    default:
      return { kind: 'text', op: 'contains', label: 'Contains' }
  }
}

/** Does the rule stand on this column? Only a rule the panel can show (`exprToRule`); a raw expression is nobody's. */
const onColumn = (item: FilterNode, c: string): boolean => {
  if (typeof item !== 'string') return false
  const rule = exprToRule(item)
  return rule !== null && canonicalKey(rule.property) === c
}

/** This column's rules among the view's top-level items, in their stored order. */
export function columnRules(node: FilterNode | undefined, property: string): Rule[] {
  const c = canonicalKey(property)
  const out: Rule[] = []
  for (const item of toGroup(node).items) if (onColumn(item, c)) out.push(exprToRule(item as string)!)
  return out
}

/**
 * The view's filters with this column's top-level rules replaced by `rules` (none: removed; the last rule takes the key
 * with it, as `fromGroup`). Into an All group as they stand; any other group goes under a new All beside the rules, as
 * the row menu's `withFilter`.
 */
export function withColumnRules(node: FilterNode | undefined, property: string, rules: readonly Rule[]): FilterNode | undefined {
  const c = canonicalKey(property)
  const group = toGroup(node)
  const rest = group.items.filter((item) => !onColumn(item, c))
  const exprs = rules.map(ruleToExpr)
  if (exprs.length === 0) return fromGroup({ conj: group.conj, items: rest })
  if (group.conj === 'and') return { and: [...rest, ...exprs] }
  const base = fromGroup({ conj: group.conj, items: rest })
  return { and: base === undefined ? exprs : [base, ...exprs] }
}

export type DateSpan = 'today' | 'week' | 'month'
export type WeekStart = 'sunday' | 'monday'

/**
 * Today · This week · This month as rules the engine has: Today is `dateIs` on the day; a week and a month are `dateAfter`
 * the day before and `dateBefore` the day after, both strict, so a day-only value on each end is in. The days are
 * fixed at the pick (the grammar has no `today()`): the panel shows the dates, and tomorrow they stand as picked.
 */
export function dateSpanRules(property: string, span: DateSpan, weekStartsOn: WeekStart, now = Date.now()): Rule[] {
  const t = new Date(startOfDay(now))
  const y = t.getFullYear()
  const m = t.getMonth()
  const day = (d: number, month = m): string => formatDate(new Date(y, month, d).getTime(), 'YYYY-MM-DD')
  const after = (value: string): Rule => ({ property, op: 'dateAfter', value })
  const before = (value: string): Rule => ({ property, op: 'dateBefore', value })
  if (span === 'today') return [{ property, op: 'dateIs', value: day(t.getDate()) }]
  if (span === 'week') {
    const start = t.getDate() - ((t.getDay() - (weekStartsOn === 'monday' ? 1 : 0) + 7) % 7)
    return [after(day(start - 1)), before(day(start + 7))]
  }
  return [after(day(0)), before(day(1, m + 1))]
}

/** The same rules, in any order (the ✓ on Today · This week · This month). */
export const sameRules = (a: readonly Rule[], b: readonly Rule[]): boolean => {
  if (a.length !== b.length) return false
  const bs = b.map(ruleToExpr).sort()
  return a.map(ruleToExpr).sort().every((e, i) => e === bs[i])
}
