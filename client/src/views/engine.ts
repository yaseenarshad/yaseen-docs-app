import { vaultNoteId } from '@shared/noteId'
import { READ_ONLY_KEY } from '@shared/readOnly'
import { FOLDER_SETTINGS_FILE, type IndexRecord, inFolder } from '@shared/types'
import { type ViewSet, type ViewDef, type FilterNode, type GroupBySpec, type SortSpec, shownGroupLevels } from './viewSchema'
import {
  DateValue, DurationValue, ErrorValue, type Expr, FileValue, LinkValue, type Resolver, type Scope, type Value,
  compile, equals, evaluate, fromYaml, isTruthy, linkText, render, stripBrackets,
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
  /** A declared Select option supplies the destination even when this group has no rows. */
  optionValue?: string
  /** null for the trailing "No value" group. */
  key: Value | null
  label: string
  /** EVERY row under the group — with nested levels that is `direct` plus every child's rows. */
  rows: Row[]
  summaries: Record<string, Value>
  /**
   * True when the grouping property held a LIST somewhere and rows were fanned out per element
   * (YAZ-671 D1) — so one row can appear in several groups, and the group counts can sum above
   * `total` (D2, deliberate). Consumers that write back through group identity read this.
   */
  fannedOut: boolean
  /**
   * The inner groups (YAZ-745, up to `MAX_GROUP_LEVELS` levels: three since YAZ-4531, five since YAZ-3746 13AF): present — possibly empty — on
   * every group above the view's last level, absent on the last level (so a single level has none).
   */
  children?: Group[]
  /** The rows the merge rule keeps directly under this group; same presence rule as `children`. */
  direct?: Row[]
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
  /** The subfolder rows among `total` (YAZ-4595 S36): the toolbar's "N folders". */
  folders: number
}

export interface RunOptions {
  /** The folder's declared column names — shown by default before any note carries them (YAZ-1549). */
  declared?: readonly string[]
  /** Vault root; lets link targets written as `<root>/…` resolve. */
  root?: string
  /**
   * The resolver every link in this run resolves through (🔒 D2, YAZ-819). A folder's views pass
   * only the folder's rows as `records` and inject the WHOLE-vault resolver here, so a link cell
   * pointing outside them still resolves. Absent: one built from `records`.
   */
  resolve?: Resolver
  /**
   * The folder whose page this is (as the index names it), the vault's folder records and the vault's
   * name (YAZ-2541): given, a Folder level groups by the folders below the page, each headed by its title.
   */
  page?: { folder: string; folders: readonly IndexRecord[]; vault: string }
  /**
   * The options of a Select or Multi-select column, in the column editor's order (YAZ-3940); else
   * undefined. Given, sorts and groups on that column follow it unless the spec says `by: value`.
   */
  optionOrder?: (property: string) => readonly string[] | undefined
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

/** A link target as the resolver reads it: brackets, `#heading` and `|alias` off, trimmed, lowercased. */
export const targetKey = (target: string) => stripBrackets(target).replace(/[#|].*$/, '').trim().toLowerCase()

/**
 * A basename as `targetBasename` spells it: lowercased, with the one context-dependent lowercase
 * mapping (Greek final sigma: `ΟΔΟΣ.md` lowercases its Σ to σ, `ΟΔΟΣ` alone to ς) folded away.
 */
export const basenameKey = (basename: string): string => basename.toLowerCase().replace(/ς/g, 'σ')

/**
 * The `basenameKey` of every note `target` can resolve to without aliases: each path and name match
 * in `makeResolver` ends in that basename. A note whose basename no link spells has no references
 * (YAZ-2241: the rename detector skips those without building a resolver per rename).
 */
export function targetBasename(target: string): string {
  const rel = normalise(targetKey(target))
  return basenameKey(rel.slice(rel.lastIndexOf('/') + 1))
}

/** `makeResolver` / `resolverFor` knobs; every field is optional and defaults to today's behaviour. */
export interface ResolverOptions {
  /**
   * Consult frontmatter `aliases` (default true, E2 GRO-2214). `false` builds a NAME-ONLY
   * resolver — the rename engine's referencing-set probe (`links/renameLinks.ts`), which must
   * not treat an alias-form link as a reference to rewrite: the alias lives in the moved file's
   * own frontmatter and travels with it.
   */
  aliases?: boolean
  /**
   * Resolve a target that IS a note's id (default true, YAZ-2293 D5). `false` for the rename
   * engine's probe too: an id link names the note itself, not its place, so no rename rewrites it.
   */
  ids?: boolean
  /**
   * The vault's ID letters (`IndexResponse.letters`, YAZ-2677 R5): the current ones, then each it
   * had before. Given, a target with letters of before finds the note of that number: `[[OLD-12]]`
   * is `YAZ-12` (S82). Without them an id is found by the letters its record holds.
   */
  letters?: readonly string[]
  /**
   * The snapshot's folder settings records (YAZ-2478). Given, a pathed target no file path answers
   * is read as a path of TITLES: `Sub/Page` is the note titled Page in the folder `Sub` names
   * (`typedFolders`). The rename engine's probe gives them too, and rewrites such a link to the note's id.
   */
  folders?: readonly IndexRecord[]
}

/**
 * The folder a typed segment names inside `parent` (YAZ-2478): the one there with that title, else
 * the one in that directory, else undefined. Folders are as the index names them (root-relative,
 * '' the root, which no segment names) and come off their settings records; case-insensitive.
 */
export function typedFolders(folders: readonly IndexRecord[]): (parent: string, segment: string) => string | undefined {
  const byTitle = new Map<string, string>()
  const byName = new Map<string, string>()
  for (const { folder, title } of folders) {
    if (folder === '') continue
    const typed = `${folder.slice(0, folder.lastIndexOf('/') + 1)}${title}`.toLowerCase()
    if (!byTitle.has(typed)) byTitle.set(typed, folder)
    byName.set(folder.toLowerCase(), folder)
  }
  return (parent, segment) => {
    const typed = `${parent === '' ? '' : `${parent}/`}${segment}`.toLowerCase()
    return byTitle.get(typed) ?? byName.get(typed)
  }
}

/**
 * A link target's key (`targetKey`) as the key an id is found under (YAZ-2677 R1, R5): an ID is read
 * in any case, so the key is the id in lowercase; one with letters the vault had before is the key
 * of the same number with the current letters. Any other key is itself.
 */
export function idKey(key: string, letters?: readonly string[]): string {
  if (letters === undefined || letters.length < 2) return key
  return vaultNoteId(key, letters)?.toLowerCase() ?? key
}

/**
 * Link target → note: the note's own id (YAZ-2293 — first, so a note merely NAMED like an id
 * never captures it; a target that is the id of NO note falls through to the names below, so
 * `[[YAZ-7]]` still opens a note that is only named so: YAZ-2677 R6, S26), absolute path, root-relative path (with or without `.md` / leading slash),
 * TITLE (YAZ-2420 🔒 D17 — a note with no `title:` is titled by its file name), bare basename —
 * duplicates of either resolve to the SHALLOWEST folder (Obsidian's shortest-path rule,
 * GRO-2190), equal depth to the first in the given (path-sorted) order — a pathed target as a
 * path of TITLES (YAZ-2478, `ResolverOptions.folders`), and finally a
 * frontmatter ALIAS (E2, GRO-2214), by the same shallowest-then-first rule, so a real name
 * always beats an alias. Case-insensitive; `[[…]]`, `|alias` and `#heading` are stripped.
 */
export function makeResolver(files: readonly FileValue[], root?: string, opts: ResolverOptions = {}): Resolver {
  const byId = new Map<string, FileValue>()
  const byPath = new Map<string, FileValue>()
  const byRel = new Map<string, FileValue>()
  const byTitle = new Map<string, { file: FileValue; depth: number }>()
  const byBase = new Map<string, { file: FileValue; depth: number }>()
  const byAlias = new Map<string, { file: FileValue; depth: number }>()
  /** `<folder>/<title>`, the folder as the index names it, to the first note of that title there; empty with no `folders`. */
  const byFolderTitle = new Map<string, FileValue>()
  const typedFolder = typedFolders(opts.folders ?? [])
  const shallowest = (map: Map<string, { file: FileValue; depth: number }>, key: string, file: FileValue, depth: number) => {
    const prev = map.get(key)
    if (prev === undefined || depth < prev.depth) map.set(key, { file, depth })
  }
  for (const f of files) {
    const r = f.record
    // By the id in lowercase: a target is read in any case (YAZ-2677 R1, S17), and its key is lowercase.
    const id = opts.ids === false ? undefined : r.id?.toLowerCase()
    if (id !== undefined && !byId.has(id)) byId.set(id, f)
    byPath.set(r.path.toLowerCase(), f)
    const rel = normalise(r.folder ? `${r.folder}/${r.basename}` : r.basename)
    if (!byRel.has(rel)) byRel.set(rel, f)
    const depth = r.folder === '' ? 0 : r.folder.split('/').length
    shallowest(byTitle, r.title.toLowerCase(), f, depth)
    shallowest(byBase, r.basename.toLowerCase(), f, depth)
    if (opts.folders !== undefined) {
      const titled = `${r.folder}/${r.title}`.toLowerCase()
      if (!byFolderTitle.has(titled)) byFolderTitle.set(titled, f)
    }
    if (opts.aliases !== false) for (const alias of r.aliases) shallowest(byAlias, alias.toLowerCase(), f, depth)
  }
  const rootKey = root ? `${root.replace(/\/+$/, '').toLowerCase()}/` : null
  /** A path of titles: its last segment a note's title, the ones before it its folders, from the root down. */
  const titledPath = (rel: string): FileValue | null => {
    const segments = rel.split('/')
    const title = segments.pop()
    let dir = ''
    for (const segment of segments) dir = typedFolder(dir, segment)?.toLowerCase() ?? (dir === '' ? segment : `${dir}/${segment}`)
    return byFolderTitle.get(`${dir}/${title}`) ?? null
  }
  const cache = new Map<string, FileValue | null>()
  return target => {
    const hit = cache.get(target)
    if (hit !== undefined) return hit
    const key = targetKey(target)
    let found: FileValue | null = null
    if (key) {
      found = byId.get(idKey(key, opts.letters)) ?? byPath.get(key) ?? null
      if (!found) {
        const rel = normalise(rootKey && key.startsWith(rootKey) ? key.slice(rootKey.length) : key)
        found = byRel.get(rel) ?? byTitle.get(key)?.file ?? (rel.includes('/') ? titledPath(rel) : byBase.get(rel)?.file ?? null)
      }
      // Aliases last: a page named `CAC` always wins the target `CAC` over one merely aliased so.
      if (!found) found = byAlias.get(key)?.file ?? null
    }
    cache.set(target, found)
    return found
  }
}

/** FileValue wrappers per records array identity — `runView` and `resolverFor` share the instances. */
const filesCache = new WeakMap<readonly IndexRecord[], FileValue[]>()

function fileValuesFor(records: readonly IndexRecord[]): FileValue[] {
  let files = filesCache.get(records)
  if (files === undefined) filesCache.set(records, (files = records.map(r => new FileValue(r))))
  return files
}

const NO_FOLDERS: readonly IndexRecord[] = []

const resolverCache = new WeakMap<readonly IndexRecord[], WeakMap<readonly IndexRecord[], Map<string, Resolver>>>()

/**
 * Memoized `makeResolver` per records array identity (and per `folders`, root, alias mode): `runView`
 * and the editor's wikilink decorations (GRO-2190) both resolve on every run/render, so one
 * index snapshot must not rebuild the lookup maps each time. A refetched index is a NEW array
 * and gets a fresh resolver; the WeakMap lets dropped snapshots be collected. The per-instance
 * target cache inside `makeResolver` is unchanged.
 */
export function resolverFor(records: readonly IndexRecord[], root?: string, opts: ResolverOptions = {}): Resolver {
  const folders = opts.folders ?? NO_FOLDERS
  let byFolders = resolverCache.get(records)
  if (byFolders === undefined) resolverCache.set(records, (byFolders = new WeakMap()))
  let byRoot = byFolders.get(folders)
  if (byRoot === undefined) byFolders.set(folders, (byRoot = new Map()))
  const key = `${opts.aliases === false ? 'names:' : ''}${opts.ids === false ? 'noids:' : ''}${(opts.letters ?? []).join(',')}:${root ?? ''}`
  let resolver = byRoot.get(key)
  if (resolver === undefined) byRoot.set(key, (resolver = makeResolver(fileValuesFor(records), root, opts)))
  return resolver
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
function makeGetter(key: string, def: ViewSet, errors: EngineError[]): Getter {
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
 * case-insensitive, booleans false < true, links by what they read as (`linkText` — through
 * `resolve`, an id link by its note's title, YAZ-2293 D8), files by title; mixed types by
 * rank. Missing (null / undefined / error) always sorts last whatever the direction.
 */
export function compareValues(a: Value | undefined, b: Value | undefined, direction: 'ASC' | 'DESC' = 'ASC', resolve?: Resolver): number {
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
  else if (x instanceof LinkValue) c = collator.compare(linkText(x, resolve), linkText(y as LinkValue, resolve))
  else if (x instanceof FileValue) c = collator.compare(x.record.title, (y as FileValue).record.title)
  return sign * c
}

type Compare = (a: Value | undefined, b: Value | undefined) => number

/**
 * The order of one sort or group level (YAZ-3940). A column with options ranks its values by them:
 * ASC is option order, DESC reverses it. A value that is not an option comes after the options,
 * A to Z, and a missing value is last. `by: value`, or no options, is `compareValues`.
 */
function compareBy(spec: SortSpec | GroupBySpec, resolve: Resolver, optionOrder: RunOptions['optionOrder']): Compare {
  const direction = spec.direction === 'DESC' ? 'DESC' : 'ASC'
  const options = spec.by === 'value' ? undefined : optionOrder?.(spec.property)
  if (!options?.length) return (a, b) => compareValues(a, b, direction, resolve)
  const index = new Map(options.map((option, i) => [option, i]))
  const sign = direction === 'DESC' ? -1 : 1
  return (a, b) => {
    const x = sortKey(a)
    const y = sortKey(b)
    const ix = typeof x === 'string' ? index.get(x) : undefined
    const iy = typeof y === 'string' ? index.get(y) : undefined
    if (ix !== undefined && iy !== undefined) return sign * (ix - iy)
    if (ix !== undefined || iy !== undefined) return ix !== undefined ? -1 : 1
    return compareValues(x, y, 'ASC', resolve)
  }
}

/** A subfolder's row (YAZ-4579 D31): its record is the folder's `.folder.md` (`links/shortcuts.ts` `isFolderRow`). */
const isFolderEntry = (e: Entry): boolean => e.row.record.name === FOLDER_SETTINGS_FILE

const byPath = (a: Entry, b: Entry): number => (a.row.record.path < b.row.record.path ? -1 : a.row.record.path > b.row.record.path ? 1 : 0)

// ---------- grouping ----------

const isNoValue = (v: Value): boolean => v === null || v === '' || v instanceof ErrorValue || (Array.isArray(v) && v.length === 0)

/** The folder `depth` steps below `page` on the way to `folder` (YAZ-2541); `folder` itself when it is nearer than that, or not under the page (a shortcut's home). */
export function folderAt(folder: string, page: string, depth: number): string {
  if (!inFolder(folder, page)) return folder
  const steps = (page === '' ? 0 : page.split('/').length) + depth
  return folder.split('/').slice(0, steps).join('/')
}

// ---------- public API ----------

/**
 * `view.order` if set, else `file.name` plus every note property key seen OR declared, sorted, as
 * `note.<key>`. `declared` is the folder's own column names (YAZ-1549): a declared column is
 * a column before any note carries it, so a new folder shows its `status` at once. Every key
 * the rows hold is one: a folder's values where the vault uses IDs, and where it does not the
 * notes' own properties — `id`, `title` and `also_in` like the rest (YAZ-2523 🔒 V12).
 * Except the read-only switch (`readonly`, a reserved key the index keeps so the views can lock a
 * note's cells, YAZ-3122): one locked note must not put a "Readonly" row on every card (YAZ-3130
 * nit). It shows only where a view orders it or the folder declares it; the menus still offer it.
 * (`comments` and `reviews` never reach here: the index drops them.)
 */
export function propertyKeys(_def: ViewSet, view: ViewDef, records: readonly IndexRecord[], declared: readonly string[] = []): string[] {
  if (view.order) return [...view.order]
  const keys = new Set<string>(declared.map((k) => `note.${k}`))
  for (const r of records) for (const k of Object.keys(r.properties)) if (k !== READ_ONLY_KEY) keys.add(`note.${k}`)
  return ['file.name', ...[...keys].sort()]
}

/**
 * The label a key wears with no `displayName` (YAZ-1513): the `file.*` fields have their own
 * table (`file.mtime` → "Modified"); every other key is its last dotted segment in sentence case,
 * underscores read as spaces — `note.kpi_category` → "Kpi category", `formula.score` → "Score".
 * The KEY is never touched.
 */
export function defaultLabel(key: string): string {
  const file = FILE_FIELD_LABELS[key]
  if (file !== undefined) return file
  const last = key.slice(key.lastIndexOf('.') + 1).replaceAll('_', ' ')
  return last.charAt(0).toUpperCase() + last.slice(1)
}

/** The `file.*` fields' labels (YAZ-1549) — the ones sentence case would get wrong or leave terse. */
const FILE_FIELD_LABELS: Readonly<Record<string, string>> = {
  'file.name': 'Name',
  'file.basename': 'File name',
  'file.path': 'Path',
  'file.folder': 'Folder',
  'file.kind': 'Kind',
  'file.ext': 'Extension',
  'file.size': 'Size',
  'file.ctime': 'Created',
  'file.mtime': 'Modified',
  'file.tags': 'Tags',
  'file.links': 'Links',
  'file.embeds': 'Embeds',
}

/** `def.properties[key].displayName` (looked up as written, bare and `note.`-prefixed), else `defaultLabel(key)`. */
export function propertyLabel(def: ViewSet, key: string): string {
  const bare = key.startsWith('note.') ? key.slice(5) : key
  const props = def.properties
  return props?.[key]?.displayName ?? props?.[bare]?.displayName ?? props?.[`note.${bare}`]?.displayName ?? defaultLabel(key)
}

export function runView(def: ViewSet, view: ViewDef, records: readonly IndexRecord[], opts: RunOptions = {}): ViewResult {
  const errors: EngineError[] = []
  // By name too (YAZ-4585): ViewsPane hands the view with Settings filled in, a copy of the one in `def`.
  const viewIndex = def.views.findIndex((v) => v === view || v.name === view.name)
  const viewWhere = viewIndex >= 0 ? `views[${viewIndex}]` : 'view'
  const files = fileValuesFor(records)
  const resolve = opts.resolve ?? resolverFor(records, opts.root)
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
    // `this` is null: the views are a FOLDER's, and a folder is no record (YAZ-2290).
    const scope: Scope = { note: records[i].properties, file: files[i], formulas, this: null, resolve }
    if (baseFilter && !baseFilter(scope)) continue
    if (viewFilter && !viewFilter(scope)) continue
    entries.push({ row: { record: records[i], file: files[i], values: {} }, scope, cache: new Map() })
  }

  // values
  const keys = propertyKeys(def, view, records, opts.declared)
  const columnGetters = keys.map(k => [k, getter(k)] as const)
  for (const entry of entries) for (const [k, g] of columnGetters) entry.row.values[k] = g(entry.scope)

  // One comparator per sort or group level, built once: an inner level buckets once per outer (YAZ-3940).
  const compares = new Map<SortSpec | GroupBySpec, Compare>()
  const compareOf = (spec: SortSpec | GroupBySpec): Compare => {
    let c = compares.get(spec)
    if (!c) compares.set(spec, (c = compareBy(spec, resolve, opts.optionOrder)))
    return c
  }

  // sort (stable: path breaks ties)
  const sort = (view.sort ?? []).filter(s => s && typeof s.property === 'string')
  if (sort.length) {
    const sortValues = new Map<Entry, Value[]>(entries.map(e => [e, sort.map(s => valueOf(e, s.property))]))
    const sortCompares = sort.map(compareOf)
    entries.sort((a, b) => {
      const va = sortValues.get(a)!
      const vb = sortValues.get(b)!
      for (let i = 0; i < sort.length; i++) {
        const c = sortCompares[i](va[i], vb[i])
        if (c) return c
      }
      return byPath(a, b)
    })
  }

  // Folders first (YAZ-4579 D33): the subfolder rows before the notes, each part in the view's order. A
  // stable split, and only where a folder row is: a page without one costs one pass of name checks.
  if (view.foldersFirst !== false && entries.some(isFolderEntry)) {
    const folders = entries.filter(isFolderEntry)
    const notes = entries.filter(e => !isFolderEntry(e))
    entries.splice(0, entries.length, ...folders, ...notes)
  }

  // limit
  const total = entries.length
  let folders = 0
  for (const e of entries) if (isFolderEntry(e)) folders++
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
  /**
   * One level over `list`: its distinct keys in the level's direction, then the value-less entries.
   * `depth` > 0 is a Folder level under a page (YAZ-2541): the key is the folder that many steps below it.
   */
  const bucket = (list: Entry[], spec: GroupBySpec, depth: number) => {
    const { property } = spec
    const page = depth > 0 ? opts.page!.folder : null
    const valued: { key: Value; entries: Entry[] }[] = []
    const noValue: Entry[] = []
    let fannedOut = false
    for (const entry of list) {
      const own = valueOf(entry, property)
      const key = page !== null && typeof own === 'string' ? folderAt(own, page, depth) : own
      // On a Folder level the vault root ('', a shortcut's home) is a folder, not a missing value.
      if (isNoValue(key) && !(page !== null && key === '')) {
        noValue.push(entry)
        continue
      }
      // Scalar grouping is the common case and keeps the original single-lookup path — wrapping
      // every value in a throwaway array here cost 4-6x on the 1000-record budget under load.
      if (!Array.isArray(key)) {
        const g = valued.find(x => equals(x.key, key))
        if (g) g.entries.push(entry)
        else valued.push({ key, entries: [entry] })
        continue
      }
      // A LIST fans out: the entry joins one group per DISTINCT non-empty element (D1), so a note
      // in two funnels shows under both instead of forming a combination group. Empty elements are
      // dropped, and a list left with none falls to "No value" exactly as `[]` already does.
      fannedOut = true
      let joined = 0
      for (let i = 0; i < key.length; i++) {
        const k = key[i]
        if (isNoValue(k)) continue
        let seen = false
        for (let j = 0; j < i; j++) if (equals(key[j], k)) { seen = true; break }
        if (seen) continue
        joined++
        const g = valued.find(x => equals(x.key, k))
        if (g) g.entries.push(entry)
        else valued.push({ key: k, entries: [entry] })
      }
      if (joined === 0) noValue.push(entry)
    }
    // The homes of shortcuts come after the page's own folders, whichever the direction.
    const outside = (key: Value): number => Number(page !== null && typeof key === 'string' && !inFolder(key, page))
    const compare = compareOf(spec)
    valued.sort((a, b) => outside(a.key) - outside(b.key) || compare(a.key, b.key))
    return { valued, noValue, fannedOut }
  }
  let titles: Map<string, string> | undefined
  /** A Folder group (YAZ-2541) is headed as the sidebar names its folder: by title, a folder with no settings file by its directory, the root by the vault's name. */
  const labelOf = (key: Value, depth: number): string => {
    if (depth === 0 || typeof key !== 'string') return render(key, resolve)
    titles ??= new Map([...opts.page!.folders.map(f => [f.folder, f.title] as const), ['', opts.page!.vault]])
    return titles.get(key) ?? key.slice(key.lastIndexOf('/') + 1)
  }
  const groupOf = (key: Value | null, entries: Entry[], depth: number): Group =>
    ({ key, label: key === null ? NO_VALUE : labelOf(key, depth), rows: entries.map(e => e.row), summaries: summaryOf(entries), fannedOut: false })

  let groups: Group[] | null = null
  // Levels past the third are ignored (YAZ-4531); a level without a property name is not one.
  const levels = shownGroupLevels(view)
  // How far below the page each Folder level groups (YAZ-2541): the first one step, a second two, a third three; 0 = not a Folder level.
  const byFolder = (l: GroupBySpec): boolean => opts.page !== undefined && l.property === 'file.folder'
  const depths = levels.map((l, i) => (byFolder(l) ? levels.slice(0, i + 1).filter(byFolder).length : 0))
  // Fan-out is a flag per LEVEL, not per branch (YAZ-745): one list anywhere in a level marks every group of it.
  const fanned = levels.map(() => false)
  const built: Group[][] = levels.map(() => [])
  /**
   * The groups of level `at` over `list`, under a parent keyed `parent` (`undefined` at the top).
   * MERGE RULE (YAZ-745, per parent since YAZ-4531): a key equal to the parent's is no group — its
   * entries sit DIRECTLY under the parent, as do the value-less entries of a "No value" parent, which
   * therefore never carries a "No value" child. Folder then Folder (YAZ-2541) rides on it: a
   * subfolder's own notes resolve to the subfolder at every deeper level, so they sit directly under it.
   * Direct entries are not split further.
   */
  const split = (list: Entry[], at: number, parent?: Value | null): { children: Group[]; direct: Entry[] } => {
    const level = bucket(list, levels[at], depths[at])
    if (level.fannedOut) fanned[at] = true
    const merges = (key: Value): boolean => parent !== undefined && parent !== null && equals(key, parent)
    const children = level.valued.filter(x => !merges(x.key)).map(x => toGroup(x.key, x.entries, at))
    if (parent !== null && level.noValue.length) children.push(toGroup(null, level.noValue, at))
    const direct = parent === null ? level.noValue : level.valued.filter(x => merges(x.key)).flatMap(x => x.entries)
    return { children, direct }
  }
  /** One group of level `at`; above the last level it carries `children` and `direct`, possibly empty. */
  const toGroup = (key: Value | null, list: Entry[], at: number): Group => {
    const group = groupOf(key, list, depths[at])
    built[at].push(group)
    if (at + 1 < levels.length) {
      const inner = split(list, at + 1, key)
      group.children = inner.children
      group.direct = inner.direct.map(e => e.row)
    }
    return group
  }
  if (levels.length) {
    groups = split(kept, 0).children
    for (let i = 0; i < levels.length; i++) if (fanned[i]) for (const g of built[i]) g.fannedOut = true
  }

  return { rows: kept.map(e => e.row), groups, summaries: summaryOf(kept), errors, total, folders }
}
