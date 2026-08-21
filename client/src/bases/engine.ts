import type { IndexRecord } from '@shared/types'
import type { BaseDefinition, BaseView, FilterNode } from './baseFile'
import {
  DateValue, DurationValue, ErrorValue, type Expr, FileValue, LinkValue, type Resolver, type Scope, type Value,
  compile, equals, evaluate, fromYaml, isTruthy, render, stripBrackets,
} from './expr'
import { summarize } from './summaries'

/**
 * Query engine for one Bases view (GRO-2133): filters → values → sort → limit → group → summaries
 * (GRO-2134), all over `IndexRecord`s, pure and DOM-free. Never throws: expression problems land
 * in cells as ErrorValues and compile errors in `errors`.
 */

export interface Row {
  record: IndexRecord
  file: FileValue
  /** Keyed by the property key as written in the view (`file.name`, `status`, `note.status`, `formula.x`). */
  values: Record<string, Value>
}

export interface Group {
  /** null for the trailing "No value" group. */
  key: Value | null
  label: string
  rows: Row[]
  summaries: Record<string, Value>
}

export interface EngineError {
  /** `filters`, `views[0].filters[1]`, `formula.ppu`, … */
  where: string
  message: string
}

export interface ViewResult {
  rows: Row[]
  /** null when the view has no `groupBy`. */
  groups: Group[] | null
  summaries: Record<string, Value>
  errors: EngineError[]
  /** Rows passing the filters, before `limit`. */
  total: number
}

export interface RunOptions {
  /** Absolute path of the note embedding the base; `this` in expressions. */
  thisFile?: string | null
  /** Vault root; lets link targets written as `<root>/…` resolve. */
  root?: string
}

/** Value of one property key for one row's scope. */
type Getter = (scope: Scope) => Value

/** A row plus the scope it evaluates in and the lazily computed values outside `view.order`. */
interface Entry {
  row: Row
  scope: Scope
  cache: Map<string, Value>
}

const NO_VALUE = 'No value'

// ---------- link resolution (GRO-2132) ----------

const normalise = (s: string) => s.replace(/^\/+|\/+$/g, '').replace(/\.(md|markdown)$/, '').toLowerCase()

/**
 * Link target → note: absolute path, root-relative path (with or without `.md` / leading slash),
 * else bare basename (first match in the given order — pass path-sorted files for Obsidian's
 * shortest-path rule). Case-insensitive; `[[…]]`, `|alias` and `#heading` are stripped.
 */
export function makeResolver(files: readonly FileValue[], root?: string): Resolver {
  const byPath = new Map<string, FileValue>()
  const byRel = new Map<string, FileValue>()
  const byBase = new Map<string, FileValue>()
  for (const f of files) {
    const r = f.record
    byPath.set(r.path.toLowerCase(), f)
    const rel = normalise(r.folder ? `${r.folder}/${r.basename}` : r.basename)
    if (!byRel.has(rel)) byRel.set(rel, f)
    const base = r.basename.toLowerCase()
    if (!byBase.has(base)) byBase.set(base, f)
  }
  const rootKey = root ? `${root.replace(/\/+$/, '').toLowerCase()}/` : null
  const cache = new Map<string, FileValue | null>()
  return target => {
    const hit = cache.get(target)
    if (hit !== undefined) return hit
    const key = stripBrackets(target).replace(/[#|].*$/, '').trim().toLowerCase()
    let found: FileValue | null = null
    if (key) {
      found = byPath.get(key) ?? null
      if (!found) {
        const rel = normalise(rootKey && key.startsWith(rootKey) ? key.slice(rootKey.length) : key)
        found = byRel.get(rel) ?? (rel.includes('/') ? null : byBase.get(rel) ?? null)
      }
    }
    cache.set(target, found)
    return found
  }
}

// ---------- filters ----------

type Predicate = (scope: Scope) => boolean

/**
 * Compiles a filter tree once. Any compile error or malformed node is reported at its path
 * (`<where>[i]` per child) and makes the whole filter reject every row.
 */
function compileFilter(node: FilterNode | undefined, where: string, errors: EngineError[]): Predicate | null {
  if (node === undefined || node === null) return null
  let broken = false
  const fail = (at: string, message: string): Predicate => {
    broken = true
    errors.push({ where: at, message })
    return () => false
  }
  const build = (n: FilterNode, at: string): Predicate => {
    if (typeof n === 'string') {
      const compiled = compile(n)
      if (compiled.error) return fail(at, compiled.error.message)
      const expr = compiled.expr
      return scope => isTruthy(evaluate(expr, scope))
    }
    if (!n || typeof n !== 'object') return fail(at, 'filter must be a string or an and/or/not map')
    const parts: Predicate[] = []
    for (const op of ['and', 'or', 'not'] as const) {
      if (!Object.hasOwn(n, op)) continue
      const children = (n as Record<string, unknown>)[op]
      if (!Array.isArray(children)) return fail(at, `${op} must be a list`)
      const preds = (children as FilterNode[]).map((c, i) => build(c, `${at}[${i}]`))
      if (op === 'and') parts.push(scope => preds.every(p => p(scope)))
      else if (op === 'or') parts.push(scope => preds.some(p => p(scope)))
      else parts.push(scope => !preds.some(p => p(scope)))
    }
    if (!parts.length) return fail(at, 'filter must be a string or an and/or/not map')
    return parts.length === 1 ? parts[0] : scope => parts.every(p => p(scope))
  }
  const pred = build(node, where)
  return broken ? () => false : pred
}

// ---------- property values ----------

const member = (object: string, name: string): Expr => ({ type: 'member', object: { type: 'ident', name: object, pos: 0 }, name, pos: 0 })

/**
 * `file.x` → file field, `formula.x` → formula (a compile error is reported once at `formula.x`
 * and the cell is an ErrorValue; an unknown formula is the evaluator's ErrorValue, no report),
 * anything else → note property (`note.` optional) through `fromYaml`.
 */
function makeGetter(key: string, def: BaseDefinition, errors: EngineError[]): Getter {
  if (key.startsWith('file.')) {
    const expr = member('file', key.slice(5))
    return scope => evaluate(expr, scope)
  }
  if (key.startsWith('formula.')) {
    const name = key.slice(8)
    const src = def.formulas?.[name]
    if (src !== undefined) {
      const compiled = compile(src)
      if (compiled.error && !errors.some(e => e.where === key)) errors.push({ where: key, message: compiled.error.message })
    }
    const expr = member('formula', name)
    return scope => evaluate(expr, scope)
  }
  const name = key.startsWith('note.') ? key.slice(5) : key
  return scope => fromYaml(Object.hasOwn(scope.note, name) ? scope.note[name] : undefined)
}

// ---------- ordering ----------

const collator = new Intl.Collator(undefined, { sensitivity: 'base', numeric: true })

const isMissing = (v: Value | undefined): boolean => v === undefined || v === null || v instanceof ErrorValue

/** Lists sort by their first element; an empty list counts as missing. */
const sortKey = (v: Value | undefined): Value | undefined => (Array.isArray(v) ? (v.length ? sortKey(v[0]) : null) : v)

const rank = (v: Value): number => {
  if (typeof v === 'number') return 0
  if (v instanceof DateValue) return 1
  if (v instanceof DurationValue) return 2
  if (typeof v === 'string') return 3
  if (typeof v === 'boolean') return 4
  if (v instanceof LinkValue) return 5
  if (v instanceof FileValue) return 6
  return 7
}

/**
 * Type-aware comparison: numbers numeric, dates/durations by ms, strings natural and
 * case-insensitive, booleans false < true, links by target, files by basename; mixed types by
 * rank. Missing (null / undefined / error) always sorts last whatever the direction.
 */
function compareValues(a: Value | undefined, b: Value | undefined, direction: 'ASC' | 'DESC' = 'ASC'): number {
  const x = sortKey(a)
  const y = sortKey(b)
  const mx = isMissing(x)
  const my = isMissing(y)
  if (mx || my) return mx && my ? 0 : mx ? 1 : -1
  const sign = direction === 'DESC' ? -1 : 1
  const rx = rank(x as Value)
  const ry = rank(y as Value)
  if (rx !== ry) return sign * (rx - ry)
  let c = 0
  if (typeof x === 'number') c = x - (y as number)
  else if (x instanceof DateValue || x instanceof DurationValue) c = x.ms - (y as DateValue | DurationValue).ms
  else if (typeof x === 'string') c = collator.compare(x, y as string)
  else if (typeof x === 'boolean') c = Number(x) - Number(y)
  else if (x instanceof LinkValue) c = collator.compare(x.target, (y as LinkValue).target)
  else if (x instanceof FileValue) c = collator.compare(x.record.basename, (y as FileValue).record.basename)
  return sign * c
}

const byPath = (a: Entry, b: Entry): number => (a.row.record.path < b.row.record.path ? -1 : a.row.record.path > b.row.record.path ? 1 : 0)

// ---------- grouping ----------

const isNoValue = (v: Value): boolean => v === null || v === '' || v instanceof ErrorValue || (Array.isArray(v) && v.length === 0)

// ---------- public API ----------

/** `view.order` if set, else `file.name` plus every note property key seen, sorted, as `note.<key>`. */
export function propertyKeys(_def: BaseDefinition, view: BaseView, records: readonly IndexRecord[]): string[] {
  if (view.order) return [...view.order]
  const keys = new Set<string>()
  for (const r of records) for (const k of Object.keys(r.properties)) keys.add(`note.${k}`)
  return ['file.name', ...[...keys].sort()]
}

/** `def.properties[key].displayName` (looked up as written, bare and `note.`-prefixed), else the key without `note.`. */
export function propertyLabel(def: BaseDefinition, key: string): string {
  const bare = key.startsWith('note.') ? key.slice(5) : key
  const props = def.properties
  return props?.[key]?.displayName ?? props?.[bare]?.displayName ?? props?.[`note.${bare}`]?.displayName ?? bare
}

export function runView(def: BaseDefinition, view: BaseView, records: readonly IndexRecord[], opts: RunOptions = {}): ViewResult {
  const errors: EngineError[] = []
  const viewIndex = def.views.indexOf(view)
  const viewWhere = viewIndex >= 0 ? `views[${viewIndex}]` : 'view'
  const files = records.map(r => new FileValue(r))
  const resolve = makeResolver(files, opts.root)
  const thisFile = opts.thisFile ? files.find(f => f.record.path === opts.thisFile) ?? null : null
  const formulas = def.formulas ?? {}
  const baseFilter = compileFilter(def.filters, 'filters', errors)
  const viewFilter = compileFilter(view.filters, `${viewWhere}.filters`, errors)

  const getters = new Map<string, Getter>()
  const getter = (key: string): Getter => {
    let g = getters.get(key)
    if (!g) getters.set(key, (g = makeGetter(key, def, errors)))
    return g
  }
  const valueOf = (entry: Entry, key: string): Value => {
    if (Object.hasOwn(entry.row.values, key)) return entry.row.values[key]
    let v = entry.cache.get(key)
    if (v === undefined) entry.cache.set(key, (v = getter(key)(entry.scope)))
    return v
  }

  // filters
  const entries: Entry[] = []
  for (let i = 0; i < records.length; i++) {
    const scope: Scope = { note: records[i].properties, file: files[i], formulas, this: thisFile, resolve }
    if (baseFilter && !baseFilter(scope)) continue
    if (viewFilter && !viewFilter(scope)) continue
    entries.push({ row: { record: records[i], file: files[i], values: {} }, scope, cache: new Map() })
  }

  // values
  const keys = propertyKeys(def, view, records)
  const columnGetters = keys.map(k => [k, getter(k)] as const)
  for (const entry of entries) for (const [k, g] of columnGetters) entry.row.values[k] = g(entry.scope)

  // sort (stable: path breaks ties)
  const sort = (view.sort ?? []).filter(s => s && typeof s.property === 'string')
  if (sort.length) {
    const sortValues = new Map<Entry, Value[]>(entries.map(e => [e, sort.map(s => valueOf(e, s.property))]))
    entries.sort((a, b) => {
      const va = sortValues.get(a)!
      const vb = sortValues.get(b)!
      for (let i = 0; i < sort.length; i++) {
        const c = compareValues(va[i], vb[i], sort[i].direction === 'DESC' ? 'DESC' : 'ASC')
        if (c) return c
      }
      return byPath(a, b)
    })
  }

  // limit
  const total = entries.length
  const limit = typeof view.limit === 'number' && view.limit > 0 ? Math.floor(view.limit) : null
  const kept = limit === null ? entries : entries.slice(0, limit)

  // group
  const summaryOf = (list: Entry[]): Record<string, Value> => {
    const out: Record<string, Value> = {}
    for (const [prop, kind] of Object.entries(view.summaries ?? {})) {
      if (typeof kind !== 'string') continue
      out[prop] = summarize(kind, list.map(e => valueOf(e, prop)), def.summaries)
    }
    return out
  }
  let groups: Group[] | null = null
  if (view.groupBy && typeof view.groupBy.property === 'string') {
    const { property, direction } = view.groupBy
    const valued: { key: Value; entries: Entry[] }[] = []
    const noValue: Entry[] = []
    for (const entry of kept) {
      const key = valueOf(entry, property)
      if (isNoValue(key)) {
        noValue.push(entry)
        continue
      }
      const g = valued.find(x => equals(x.key, key))
      if (g) g.entries.push(entry)
      else valued.push({ key, entries: [entry] })
    }
    valued.sort((a, b) => compareValues(a.key, b.key, direction === 'DESC' ? 'DESC' : 'ASC'))
    groups = valued.map(g => ({ key: g.key, label: render(g.key), rows: g.entries.map(e => e.row), summaries: summaryOf(g.entries) }))
    if (noValue.length) groups.push({ key: null, label: NO_VALUE, rows: noValue.map(e => e.row), summaries: summaryOf(noValue) })
  }

  return { rows: kept.map(e => e.row), groups, summaries: summaryOf(kept), errors, total }
}
