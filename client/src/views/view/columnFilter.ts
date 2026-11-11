import type { FilterNode } from '../viewSchema'
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
