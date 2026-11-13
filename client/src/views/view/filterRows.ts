import type { IndexRecord } from '@shared/types'
import { stripBrackets } from '@shared/linkResolver'
import type { ColumnTyping } from '../editorType'
import { DateValue, type Expr, LinkValue, type Value, compile, fromYaml, isEmpty, typeOf } from '../expr'
import { renderDate } from '../expr/dates'
import type { FilterNode } from '../viewSchema'
import { canonicalKey } from './keys'

/**
 * Filter builder rows ↔ expression strings (GRO-2135), back from the YAZ-846 amputation
 * (YAZ-1218 / YAZ-1224). Pure and DOM-free: the Filter menu edits `Rule`s, the stored view only
 * ever holds the strings `ruleToExpr` produces, and `exprToRule` recovers a row from any string
 * in the grammar below (else null → raw row).
 */

export type PropertyType = 'text' | 'number' | 'date' | 'checkbox' | 'list' | 'tags' | 'file' | 'link' | 'multi-link' | 'select' | 'multi-select' | 'image' | 'mentions'

export type OperatorId =
  | 'is' | 'isNot' | 'contains' | 'notContains' | 'startsWith' | 'endsWith' | 'isEmpty' | 'isNotEmpty'
  | 'eq' | 'ne' | 'lt' | 'gt' | 'le' | 'ge'
  | 'dateIs' | 'dateBefore' | 'dateAfter' | 'dateIsToday' | 'dateInThisWeek' | 'dateInThisMonth'
  | 'checked' | 'unchecked'
  | 'hasTag' | 'inFolder' | 'hasLink'
  | 'isAnyOf' | 'isNoneOf' | 'hasAnyOf' | 'hasNoneOf' | 'hasAllOf'

export interface Rule {
  /** Canonical key: `note.x`, `file.x` or `formula.x` (see `canonicalKey`). */
  property: string
  op: OperatorId
  /** Raw input text; '' for operators without a value; the ticked values for an `options` one. */
  value: string | string[]
}

/** What the value input holds; `none` hides it, `options` is the value checklist (YAZ-1467). */
export type ValueKind = 'text' | 'number' | 'date' | 'none' | 'options'

export interface OperatorDef {
  id: OperatorId
  label: string
  value: ValueKind
}

const OPS: Record<OperatorId, OperatorDef> = {
  is: { id: 'is', label: 'is', value: 'text' },
  isNot: { id: 'isNot', label: 'is not', value: 'text' },
  contains: { id: 'contains', label: 'contains', value: 'text' },
  notContains: { id: 'notContains', label: 'does not contain', value: 'text' },
  startsWith: { id: 'startsWith', label: 'starts with', value: 'text' },
  endsWith: { id: 'endsWith', label: 'ends with', value: 'text' },
  isEmpty: { id: 'isEmpty', label: 'is empty', value: 'none' },
  isNotEmpty: { id: 'isNotEmpty', label: 'is not empty', value: 'none' },
  eq: { id: 'eq', label: '=', value: 'number' },
  ne: { id: 'ne', label: '≠', value: 'number' },
  lt: { id: 'lt', label: '<', value: 'number' },
  gt: { id: 'gt', label: '>', value: 'number' },
  le: { id: 'le', label: '≤', value: 'number' },
  ge: { id: 'ge', label: '≥', value: 'number' },
  dateIs: { id: 'dateIs', label: 'is', value: 'date' },
  dateBefore: { id: 'dateBefore', label: 'is before', value: 'date' },
  dateAfter: { id: 'dateAfter', label: 'is after', value: 'date' },
  // Relative, LIVE (YAZ-4919): the engine reads the day at each run (`isToday()` and kin, `expr/methods.ts`).
  dateIsToday: { id: 'dateIsToday', label: 'is today', value: 'none' },
  dateInThisWeek: { id: 'dateInThisWeek', label: 'is this week', value: 'none' },
  dateInThisMonth: { id: 'dateInThisMonth', label: 'is this month', value: 'none' },
  checked: { id: 'checked', label: 'is checked', value: 'none' },
  unchecked: { id: 'unchecked', label: 'is not checked', value: 'none' },
  hasTag: { id: 'hasTag', label: 'has tag', value: 'text' },
  inFolder: { id: 'inFolder', label: 'in folder', value: 'text' },
  hasLink: { id: 'hasLink', label: 'has link', value: 'text' },
  isAnyOf: { id: 'isAnyOf', label: 'is any of', value: 'options' },
  isNoneOf: { id: 'isNoneOf', label: 'is none of', value: 'options' },
  hasAnyOf: { id: 'hasAnyOf', label: 'has any of', value: 'options' },
  hasNoneOf: { id: 'hasNoneOf', label: 'has none of', value: 'options' },
  hasAllOf: { id: 'hasAllOf', label: 'has all of', value: 'options' },
}

export const OPERATORS_BY_TYPE: Record<PropertyType, OperatorId[]> = {
  text: ['is', 'isNot', 'isAnyOf', 'isNoneOf', 'contains', 'notContains', 'startsWith', 'endsWith', 'isEmpty', 'isNotEmpty'],
  number: ['eq', 'ne', 'lt', 'gt', 'le', 'ge', 'isEmpty', 'isNotEmpty'],
  date: ['dateIs', 'dateBefore', 'dateAfter', 'dateIsToday', 'dateInThisWeek', 'dateInThisMonth', 'isEmpty', 'isNotEmpty'],
  checkbox: ['checked', 'unchecked'],
  list: ['contains', 'notContains', 'hasAnyOf', 'hasNoneOf', 'hasAllOf', 'isEmpty', 'isNotEmpty'],
  tags: ['contains', 'notContains', 'hasAnyOf', 'hasNoneOf', 'hasAllOf', 'isEmpty', 'isNotEmpty'],
  file: ['hasTag', 'inFolder', 'hasLink'],
  link: ['is', 'isNot', 'isAnyOf', 'isNoneOf', 'isEmpty', 'isNotEmpty'],
  'multi-link': ['contains', 'notContains', 'hasAnyOf', 'hasNoneOf', 'hasAllOf', 'isEmpty', 'isNotEmpty'],
  select: ['is', 'isNot', 'isAnyOf', 'isNoneOf', 'isEmpty', 'isNotEmpty'],
  'multi-select': ['contains', 'notContains', 'hasAnyOf', 'hasNoneOf', 'hasAllOf', 'isEmpty', 'isNotEmpty'],
  // A Linked mentions column (YAZ-4738 L3): "is empty" finds a page nothing links to.
  mentions: ['isEmpty', 'isNotEmpty', 'contains'],
  // An Image column (YAZ-4802): whether a row has a picture.
  image: ['isEmpty', 'isNotEmpty'],
}

/** The three file-method rules live on pseudo-properties so they fit the property · operator · value row. */
const FILE_OPS: Record<string, OperatorId[]> = {
  'file.tags': ['hasTag', 'hasAnyOf', 'hasNoneOf', 'hasAllOf'],
  'file.folder': ['inFolder', 'isAnyOf', 'isNoneOf'],
  'file.links': ['hasLink'],
}
const FILE_PROPERTY: Partial<Record<OperatorId, string>> = { hasTag: 'file.tags', inFolder: 'file.folder', hasLink: 'file.links' }

export const operator = (id: OperatorId): OperatorDef => OPS[id]

/** Operators the builder offers for one property of one type (a file pseudo-property has its own list). */
export function operatorsFor(property: string, type: PropertyType): OperatorDef[] {
  if (type === 'file') return (FILE_OPS[property] ?? []).map(id => OPS[id])
  return OPERATORS_BY_TYPE[type].map(id => OPS[id])
}

/**
 * Property type for a note key down the typing ladder (D4): the column's assigned kind, else its
 * dominant kind, else the first non-empty value across `records`, else text. `EditorKind` names are
 * the `PropertyType` names, except that a list on the `tags` property is the `tags` pseudo-type.
 * `file.*` and `formula.*` are by name and ignore typing entirely.
 */
export function inferType(property: string, records: readonly IndexRecord[], typing?: ColumnTyping): PropertyType {
  if (property in FILE_OPS) return 'file'
  if (property.startsWith('file.')) {
    const field = property.slice(5)
    return field === 'size' ? 'number' : field === 'ctime' || field === 'mtime' ? 'date' : 'text'
  }
  if (property.startsWith('formula.')) return 'text'
  const bare = property.startsWith('note.') ? property.slice(5) : property
  const kind = typing?.assigned ?? typing?.dominant ?? null
  if (kind !== null) return kind === 'list' && bare === 'tags' ? 'tags' : kind
  for (const r of records) {
    const raw = r.properties[bare]
    if (raw === null || raw === undefined || raw === '') continue
    const v = fromYaml(raw)
    const t = typeOf(v)
    if (t === 'number') return 'number'
    if (t === 'boolean') return 'checkbox'
    if (t === 'date') return 'date'
    if (t === 'list') {
      if ((v as Value[]).length === 0) continue
      return bare === 'tags' ? 'tags' : 'list'
    }
    return 'text'
  }
  return 'text'
}

/**
 * The values `records` already hold for one property, distinct and in first-seen order (YAZ-1232): a Select's declared
 * options first. The Filter panel's suggestions and the column menu's Filter › checklist (YAZ-4919) read one list.
 */
export function propertyValues(property: string, records: readonly IndexRecord[], typing: ColumnTyping, limit = Infinity): string[] {
  const out: string[] = []
  const seen = new Set<string>()
  const add = (s: string) => {
    if (s === '' || seen.has(s) || out.length >= limit) return
    seen.add(s)
    out.push(s)
  }
  if (property === 'file.tags') for (const r of records) for (const tag of r.tags) add(tag)
  else if (property === 'file.folder') for (const r of records) add(r.folder)
  else if (property === 'file.links') for (const r of records) for (const link of r.links) add(link)
  else if (property === 'file.kind') for (const kind of records.some((r) => r.kind === 'card') ? ['note', 'card', 'folder'] : ['note', 'folder']) add(kind)
  else if (!property.startsWith('file.') && !property.startsWith('formula.')) {
    for (const option of typing?.options ?? []) add(option)
    const bare = property.startsWith('note.') ? property.slice(5) : property
    for (const r of records) {
      const raw = r.properties[bare]
      if (typeof raw === 'string') add(stripBrackets(raw))
      else if (Array.isArray(raw)) for (const v of raw) if (typeof v === 'string') add(stripBrackets(v))
    }
  }
  return out
}

// ---------- rule → expression ----------

const IDENT = /^[A-Za-z_][A-Za-z0-9_]*$/

const quote = (s: string): string =>
  `"${s.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n').replace(/\t/g, '\\t')}"`

const num = (s: string): string => {
  const n = Number(s.trim())
  return s.trim() !== '' && Number.isFinite(n) ? String(n) : '0'
}

/** `note.x` for an identifier-shaped name, `note["my prop"]` otherwise. */
function accessor(property: string): string {
  const key = canonicalKey(property)
  const dot = key.indexOf('.')
  const object = key.slice(0, dot)
  const name = key.slice(dot + 1)
  return IDENT.test(name) ? `${object}.${name}` : `${object}[${quote(name)}]`
}

/** The ticked values of an `options` operator, each quoted and comma-separated (YAZ-1467). */
const list = (value: Rule['value']): string => (Array.isArray(value) ? value : []).map(quote).join(', ')

/** The four substring operators: on a text column they ignore case (YAZ-4919 round 2). */
export const SUBSTRING_OPS: ReadonlySet<OperatorId> = new Set<OperatorId>(['contains', 'notContains', 'startsWith', 'endsWith'])

/** The closing quote for each opening one `unquote` drops. */
const QUOTE_PAIRS: Record<string, string> = { '"': '"', "'": "'", '\u201c': '\u201d' }

/** Typed text with ONE pair of wrapping quotes dropped (YAZ-4919 round 2): `"start"` is `start`. Anything else stays as typed. */
export function unquote(text: string): string {
  const t = text.trim()
  const close = QUOTE_PAIRS[t.charAt(0)]
  return close !== undefined && t.length >= 2 && t.endsWith(close) ? t.slice(1, -1) : text
}

/**
 * The expression for a rule. With the property's `type`, a TEXT column's substring rules ignore case (YAZ-4919 round 2):
 * `<a>.lower().contains("<value lowercased>")`, the form Bases reads too. A list column's `contains` is "has the item",
 * a deep compare (`LIST.contains`), so it stays exact, as do Is / Is not; with no type (the row menu's "Filter by this
 * value"), every rule is exact as before.
 */
export function ruleToExpr(rule: Rule, type?: PropertyType): string {
  const { op } = rule
  /** The string half of the value; an operator's kind decides which half it fills. */
  const value = typeof rule.value === 'string' ? rule.value : ''
  if (op === 'hasTag' || op === 'inFolder' || op === 'hasLink') return `file.${op}(${quote(value)})`
  const a = accessor(rule.property)
  const folded = type === 'text' && SUBSTRING_OPS.has(op)
  /** The receiver and the value of a substring rule: lowered on a text column. */
  const s = folded ? `${a}.lower()` : a
  const v = quote(folded ? value.toLowerCase() : value)
  switch (op) {
    case 'is': return `${a} == ${quote(value)}`
    case 'isNot': return `${a} != ${quote(value)}`
    case 'contains': return `${s}.contains(${v})`
    case 'notContains': return `!${s}.contains(${v})`
    case 'startsWith': return `${s}.startsWith(${v})`
    case 'endsWith': return `${s}.endsWith(${v})`
    case 'isEmpty': return `${a}.isEmpty()`
    case 'isNotEmpty': return `!${a}.isEmpty()`
    case 'eq': return `${a} == ${num(value)}`
    case 'ne': return `${a} != ${num(value)}`
    // Ordering operators carry an emptiness guard (D5, YAZ-1218): `toNumber(null)` is 0, so a bare
    // comparison would match rows with NO value — Notion and Airtable both exclude empties here.
    case 'lt': return `!${a}.isEmpty() && ${a} < ${num(value)}`
    case 'gt': return `!${a}.isEmpty() && ${a} > ${num(value)}`
    case 'le': return `!${a}.isEmpty() && ${a} <= ${num(value)}`
    case 'ge': return `!${a}.isEmpty() && ${a} >= ${num(value)}`
    case 'dateIs': return `${a} == date(${quote(value)})`
    case 'dateBefore': return `!${a}.isEmpty() && ${a} < date(${quote(value)})`
    case 'dateAfter': return `!${a}.isEmpty() && ${a} > date(${quote(value)})`
    // A null date's method is null, so no emptiness guard: an empty cell is simply out.
    case 'dateIsToday': return `${a}.isToday()`
    case 'dateInThisWeek': return `${a}.isThisWeek()`
    case 'dateInThisMonth': return `${a}.isThisMonth()`
    case 'checked': return `${a} == true`
    case 'unchecked': return `${a} == false`
    // Deep equality, unlike the substring `containsAny` a string would take (🔒 D5, YAZ-1467).
    case 'isAnyOf': return `[${list(rule.value)}].contains(${a})`
    case 'isNoneOf': return `![${list(rule.value)}].contains(${a})`
    case 'hasAnyOf': return `${a}.containsAny(${list(rule.value)})`
    case 'hasNoneOf': return `!${a}.containsAny(${list(rule.value)})`
    case 'hasAllOf': return `${a}.containsAll(${list(rule.value)})`
  }
}

// ---------- expression → rule ----------

const NUM_OP: Partial<Record<string, OperatorId>> = { '==': 'eq', '!=': 'ne', '<': 'lt', '>': 'gt', '<=': 'le', '>=': 'ge' }
const DATE_OP: Partial<Record<string, OperatorId>> = { '==': 'dateIs', '<': 'dateBefore', '>': 'dateAfter' }
const SCOPE_IDENTS = new Set(['note', 'file', 'formula', 'this'])
/** The relative date methods (YAZ-4919) as their operators. */
const RELATIVE_DATE: Partial<Record<string, OperatorId>> = { isToday: 'dateIsToday', isThisWeek: 'dateInThisWeek', isThisMonth: 'dateInThisMonth' }

/** `note.x` / `file.x` / `formula.x` / `note["x"]` / bare `x` → canonical key; anything else null. */
function propertyOf(e: Expr): string | null {
  if (e.type === 'member' && e.object.type === 'ident' && SCOPE_IDENTS.has(e.object.name) && e.object.name !== 'this') {
    return `${e.object.name}.${e.name}`
  }
  if (e.type === 'index' && e.object.type === 'ident' && e.object.name === 'note' && e.index.type === 'str') return `note.${e.index.value}`
  if (e.type === 'ident' && !SCOPE_IDENTS.has(e.name)) return `note.${e.name}`
  return null
}

const strArg = (args: Expr[]): string | null => (args.length === 1 && args[0].type === 'str' ? args[0].value : null)

/** Every item as a string, or null the moment one is not — a hand-written `[1, "a"]` is no row. */
function strList(items: readonly Expr[]): string[] | null {
  const out: string[] = []
  for (const item of items) {
    if (item.type !== 'str') return null
    out.push(item.value)
  }
  return out
}

function methodRule(e: Expr): Rule | null {
  if (e.type !== 'method') return null
  if (e.name === 'contains' && e.object.type === 'list') {
    const value = strList(e.object.items)
    const property = e.args.length === 1 ? propertyOf(e.args[0]) : null
    return value === null || property === null ? null : { property, op: 'isAnyOf', value }
  }
  // Both forms of a substring rule read as ONE rule (YAZ-4919 round 2): the exact `p.contains("X")` and the
  // case-ignoring `p.lower().contains("x")`, each with its value as saved; `lower()` wraps nothing else.
  const lowered = e.object.type === 'method' && e.object.name === 'lower' && e.object.args.length === 0 ? e.object.object : null
  const property = propertyOf(lowered ?? e.object)
  if (property === null) return null
  const substring = e.name === 'contains' || e.name === 'startsWith' || e.name === 'endsWith'
  if (lowered !== null && !substring) return null
  if (e.name === 'isEmpty') return e.args.length === 0 ? { property, op: 'isEmpty', value: '' } : null
  const relative = RELATIVE_DATE[e.name]
  if (relative !== undefined) return e.args.length === 0 ? { property, op: relative, value: '' } : null
  if (e.name === 'containsAny' || e.name === 'containsAll') {
    const value = strList(e.args)
    return value === null ? null : { property, op: e.name === 'containsAny' ? 'hasAnyOf' : 'hasAllOf', value }
  }
  if (substring) {
    const value = strArg(e.args)
    return value === null ? null : { property, op: e.name as 'contains' | 'startsWith' | 'endsWith', value }
  }
  return null
}

function numberOf(e: Expr): number | null {
  if (e.type === 'num') return e.value
  if (e.type === 'unary' && e.op === '-' && e.operand.type === 'num') return -e.operand.value
  return null
}

const ORDERING = new Set<OperatorId>(['lt', 'gt', 'le', 'ge', 'dateBefore', 'dateAfter'])

/** A plain comparison (`p == "x"`, `p < 3`, `p > date("…")`) as a rule; null otherwise. */
function binaryRule(e: Expr): Rule | null {
  if (e.type !== 'binary') return null
  const property = propertyOf(e.left)
  if (property === null) return null
  const r = e.right
  if (r.type === 'str') return e.op === '==' ? { property, op: 'is', value: r.value } : e.op === '!=' ? { property, op: 'isNot', value: r.value } : null
  if (r.type === 'bool') return e.op === '==' ? { property, op: r.value ? 'checked' : 'unchecked', value: '' } : null
  if (r.type === 'call' && r.name === 'date') {
    const value = strArg(r.args)
    const op = DATE_OP[e.op]
    return value !== null && op !== undefined ? { property, op, value } : null
  }
  const n = numberOf(r)
  const op = NUM_OP[e.op]
  return n !== null && op !== undefined ? { property, op, value: String(n) } : null
}

/**
 * Inverse of `ruleToExpr` for every string in its grammar; null for anything the builder cannot
 * show. An UNGUARDED ordering comparison (hand-written) still reads back as its rule — the menu's
 * next write normalizes it to the guarded form.
 */
export function exprToRule(src: string): Rule | null {
  const e = compile(src).expr
  if (e === undefined) return null
  if (e.type === 'method' && e.object.type === 'ident' && e.object.name === 'file') {
    const property = FILE_PROPERTY[e.name as OperatorId]
    const value = strArg(e.args)
    return property !== undefined && value !== null ? { property, op: e.name as OperatorId, value } : null
  }
  if (e.type === 'unary' && e.op === '!') {
    const inner = methodRule(e.operand)
    if (inner?.op === 'contains') return { ...inner, op: 'notContains' }
    if (inner?.op === 'isEmpty') return { ...inner, op: 'isNotEmpty' }
    if (inner?.op === 'isAnyOf') return { ...inner, op: 'isNoneOf' }
    if (inner?.op === 'hasAnyOf') return { ...inner, op: 'hasNoneOf' }
    return null
  }
  if (e.type === 'method') return methodRule(e)
  // The D5 guard: `!p.isEmpty() && p <op> v`, the form ruleToExpr writes for ordering operators.
  if (e.type === 'binary' && e.op === '&&') {
    const g = e.left
    if (g.type !== 'unary' || g.op !== '!') return null
    const guard = methodRule(g.operand)
    const rule = binaryRule(e.right)
    return guard?.op === 'isEmpty' && rule !== null && guard.property === rule.property && ORDERING.has(rule.op) ? rule : null
  }
  return binaryRule(e)
}

// ---------- filter trees ----------

export type Conjunction = 'and' | 'or' | 'not'

/** One level of a filter tree as the menu edits it: a conjunction over child nodes. */
export interface FilterGroup {
  conj: Conjunction
  items: FilterNode[]
}

/** Absent → empty `and`; a bare string → a one-item `and`; a map with one of and/or/not → that; anything odder → one raw item. */
export function toGroup(node: FilterNode | undefined): FilterGroup {
  if (node === undefined || node === null) return { conj: 'and', items: [] }
  if (typeof node === 'string') return { conj: 'and', items: [node] }
  const keys = (['and', 'or', 'not'] as const).filter(k => Object.hasOwn(node, k))
  if (keys.length === 1) {
    const items = (node as Record<string, unknown>)[keys[0]]
    if (Array.isArray(items)) return { conj: keys[0], items: items as FilterNode[] }
  }
  return { conj: 'and', items: [node] }
}

/** Always the explicit map form (`{ and: [...] }`); undefined when there are no items so the key is deleted. */
export function fromGroup(group: FilterGroup): FilterNode | undefined {
  if (group.items.length === 0) return undefined
  return { [group.conj]: group.items } as FilterNode
}

/** Leaf expressions in a filter tree (each `and`/`or`/`not` branch counts its children). */
export function countRules(node: FilterNode | undefined): number {
  if (node === undefined || node === null) return 0
  if (typeof node === 'string') return 1
  let n = 0
  for (const k of ['and', 'or', 'not'] as const) {
    const items = (node as Record<string, unknown>)[k]
    if (Array.isArray(items)) for (const child of items as FilterNode[]) n += countRules(child)
  }
  return n
}

// ---------- a cell's value as a rule ----------

/** A list item as the string a rule holds: a text, or a link's target. Anything else: null. */
const itemText = (v: Value): string | null => (typeof v === 'string' ? v : v instanceof LinkValue ? v.target : null)

/**
 * "Filter by this value" and "Hide this value" (YAZ-4592 S25): the cell's value as one rule in the builder's
 * grammar, `is` or `is not` by the value's type. An empty cell is "is empty". A date, a checkbox and a list of
 * several items have no exact "not" operator, so their Hide is a None group over the `is` rule: `{ not: [rule] }`.
 * Null when no operator names the value (a duration, an object, a list of numbers).
 */
export function valueFilter(property: string, value: Value, hide: boolean): FilterNode | null {
  const rule = (op: OperatorId, v: Rule['value'] = ''): string => ruleToExpr({ property, op, value: v })
  const none = (expr: string): FilterNode => (hide ? { not: [expr] } : expr)
  if (isEmpty(value)) return rule(hide ? 'isNotEmpty' : 'isEmpty')
  if (typeof value === 'number') return rule(hide ? 'ne' : 'eq', String(value))
  if (typeof value === 'boolean') return none(rule(value ? 'checked' : 'unchecked'))
  if (value instanceof DateValue) return none(rule('dateIs', renderDate(value.ms, value.hasTime)))
  const text = itemText(value)
  if (text !== null) return rule(hide ? 'isNot' : 'is', text)
  if (!Array.isArray(value)) return null
  const items = value.map(itemText)
  if (items.some((item) => item === null)) return null
  if (items.length === 1) return rule(hide ? 'notContains' : 'contains', items[0]!)
  return none(rule('hasAllOf', items as string[]))
}

/** The view's filters with one more rule (YAZ-4592 S25): into an All group, or beside any other group under a new All. */
export function withFilter(node: FilterNode | undefined, item: FilterNode): FilterNode {
  const group = toGroup(node)
  return { and: group.conj === 'and' ? [...group.items, item] : [fromGroup(group)!, item] }
}
