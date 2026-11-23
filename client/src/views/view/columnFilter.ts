import type { IndexRecord } from '@shared/types'
import { stripBrackets } from '@shared/linkResolver'
import type { FilterNode } from '../viewSchema'
import { type OperatorId, type PropertyType, type Rule, exprToRule, fromGroup, ruleToExpr, toGroup } from './filterRows'
import { canonicalKey } from './keys'

/**
 * The column header's Filter › (YAZ-4919): quick rules on ONE column, in the Filter panel's own grammar (`filterRows.ts`),
 * so the panel shows and edits them. Pure and DOM-free. A column's rules are the view's TOP-LEVEL rules on it (a rule
 * inside a nested group is the panel's); a pick replaces them, and Clear removes them.
 */

/**
 * What the flyout offers for a column's type: a checklist of its values, Checked · Unchecked, a text box, a number box,
 * dates, or only Is empty. A checklist and the Contains box carry their opposite (YAZ-4929): the panel's "is none of",
 * "has none of" and "does not contain", where the panel has them (`OPERATORS_BY_TYPE`).
 */
export type ColumnFilterShape =
  | { kind: 'options'; op: 'isAnyOf' | 'hasAnyOf'; not: 'isNoneOf' | 'hasNoneOf' }
  | { kind: 'checkbox' }
  | { kind: 'text'; op: OperatorId; label: string; not?: { op: OperatorId; label: string } }
  | { kind: 'number' }
  | { kind: 'date' }
  | { kind: 'empty' }

/** The shape for a column's type (the panel's `inferType`), each with the operators the engine has. */
export function columnFilterShape(property: string, type: PropertyType): ColumnFilterShape {
  switch (type) {
    case 'select':
    case 'link':
      return { kind: 'options', op: 'isAnyOf', not: 'isNoneOf' }
    case 'multi-select':
    case 'list':
    case 'tags':
    case 'multi-link':
      return { kind: 'options', op: 'hasAnyOf', not: 'hasNoneOf' }
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
      if (property === 'file.tags') return { kind: 'options', op: 'hasAnyOf', not: 'hasNoneOf' }
      if (property === 'file.folder') return { kind: 'options', op: 'isAnyOf', not: 'isNoneOf' }
      return { kind: 'text', op: 'hasLink', label: 'Links to' }
    case 'mentions':
      // The panel has no "does not contain" on a Linked mentions column (YAZ-4738 L3).
      return { kind: 'text', op: 'contains', label: 'Contains' }
    default:
      return { kind: 'text', op: 'contains', label: 'Contains', not: { op: 'notContains', label: 'Does not contain' } }
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
 * the row menu's `withFilter`. With the column's `type`, a text column's Contains ignores case (`ruleToExpr`, YAZ-4919 round 2).
 */
export function withColumnRules(node: FilterNode | undefined, property: string, rules: readonly Rule[], type?: PropertyType): FilterNode | undefined {
  const c = canonicalKey(property)
  const group = toGroup(node)
  const rest = group.items.filter((item) => !onColumn(item, c))
  const exprs = rules.map((rule) => ruleToExpr(rule, type))
  if (exprs.length === 0) return fromGroup({ conj: group.conj, items: rest })
  if (group.conj === 'and') return { and: [...rest, ...exprs] }
  const base = fromGroup({ conj: group.conj, items: rest })
  return { and: base === undefined ? exprs : [base, ...exprs] }
}

/** One of the column's values and how many of the rows hold it. */
export interface ValueCount {
  value: string
  count: number
}

/**
 * The column's own values among `rows` that contain `text` (case ignored), each with its row count, most rows first
 * (ties in the rows' order), `limit` at most: the value list under the Contains box (YAZ-4919 round 2). Read as the
 * checklist's values (`propertyValues`): a list cell counts each item, a link is its target. A page column only: a file
 * field or a formula lists none.
 */
export function valueCounts(property: string, rows: readonly IndexRecord[], text: string, limit = 8): ValueCount[] {
  const c = canonicalKey(property)
  if (!c.startsWith('note.')) return []
  const bare = c.slice(5)
  const want = text.toLowerCase()
  const counts = new Map<string, number>()
  const add = (s: string) => {
    if (s !== '' && s.toLowerCase().includes(want)) counts.set(s, (counts.get(s) ?? 0) + 1)
  }
  for (const r of rows) {
    const raw = r.properties[bare]
    if (typeof raw === 'string') add(stripBrackets(raw))
    else if (Array.isArray(raw)) for (const v of raw) if (typeof v === 'string') add(stripBrackets(v))
  }
  return [...counts]
    .map(([value, count]) => ({ value, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, limit)
}
