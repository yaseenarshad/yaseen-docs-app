/**
 * A folder page's view list (YAZ-1471) and the rules of its gestures, shared so the view tabs and the CLI
 * (YAZ-4518) make the same change: `ViewsPane` calls these inside its one `update`, main inside its one
 * `.folder.md` write. Types are the Obsidian Bases view schema the folder's `views` block round-trips.
 */
import { isRecord } from './guards'

export type FilterNode = string | { and: FilterNode[] } | { or: FilterNode[] } | { not: FilterNode[] }

export interface SortSpec {
  property: string
  direction: 'ASC' | 'DESC'
}

export interface GroupBySpec {
  property: string
  direction?: 'ASC' | 'DESC'
}

export interface ViewDef {
  /** 'table' | 'cards' | 'list' | 'map' | 'board' (ours) | anything else (unknown, preserved) */
  type: string
  name: string
  filters?: FilterNode
  order?: string[]
  /** 🔒 D2 (YAZ-867): an outline view's whole document — ONE markdown bullet list (`views/outlineDoc.ts`). */
  outline?: string
  sort?: SortSpec[]
  /** Ordered levels, outer first; only the first two are honoured in v1 (YAZ-745). The single-object form stays valid. */
  groupBy?: GroupBySpec | GroupBySpec[]
  showEmptyColumns?: boolean
  limit?: number
  summaries?: Record<string, string>
  columnSize?: Record<string, number>
  frozenColumns?: number
  /** The `#` gutter (YAZ-1513). Absent = shown. */
  rowNumbers?: boolean
  rowHeight?: string
  image?: string
  cardSize?: string | number
  imageFit?: string
  imageAspectRatio?: string | number
  indentProperties?: boolean
  markerStyle?: string
  propertySeparator?: string
  /** Board card styling (YAZ-1206, reshaped by YAZ-1217): per canonical property key — bold/underline the value's row, hide its label, or `join` it onto the row being built instead of starting a new one. */
  cardStyle?: Record<string, { bold?: boolean; underline?: boolean; hideLabel?: boolean; join?: boolean }>
  [extra: string]: unknown
}

export interface ViewSet {
  filters?: FilterNode
  formulas?: Record<string, string>
  properties?: Record<string, { displayName?: string; [extra: string]: unknown }>
  summaries?: Record<string, string>
  views: ViewDef[]
  /** The saved START (YAZ-1104), a view NAME — in the def since YAZ-1471 so rename/delete keep it honest in the same write. */
  defaultView?: string
  [extra: string]: unknown
}

/** A view's grouping levels, outer first, whichever form `groupBy` is written in. */
export const groupByLevels = (view: ViewDef): GroupBySpec[] =>
  Array.isArray(view.groupBy) ? view.groupBy : view.groupBy ? [view.groupBy] : []

/** The kinds "+" offers, in menu order; a kind's label is its type, capitalised. */
export const VIEW_TYPES = ['table', 'board', 'cards', 'list', 'outline'] as const
export const viewTypeLabel = (type: string): string => type.charAt(0).toUpperCase() + type.slice(1)

/** The summary kinds every column offers; a view-set's own `summaries` add named formulas beside them. */
export const BUILTIN_SUMMARIES = [
  'Count', 'Empty', 'Filled', 'Unique', 'Average', 'Max', 'Median', 'Min', 'Range', 'Stddev', 'Sum', 'Earliest', 'Latest', 'Checked', 'Unchecked',
] as const

/** The first free name for a new view: `base`, `base 2`, `base 3`… (`taken` = the views' names). */
export function freeName(base: string, taken: ReadonlySet<string>): string {
  if (!taken.has(base)) return base
  for (let n = 2; ; n++) if (!taken.has(`${base} ${n}`)) return `${base} ${n}`
}

const names = (d: ViewSet): Set<string> => new Set(d.views.map((v) => v.name))

/** "+" (YAZ-1471): append a view of `type` under its first free label. ONE outline per page: ViewsPane edits the first one's document. */
export function addView(d: ViewSet, type: string, name = freeName(viewTypeLabel(type), names(d))): void {
  d.views.push({ type, name })
}

/** Rename; the saved START follows (D4). Names key `defaultView` and the collapse store, so a caller passes a unique non-empty name. */
export function renameView(d: ViewSet, i: number, name: string): void {
  if (d.defaultView === d.views[i].name) d.defaultView = name
  d.views[i].name = name
}

/** Duplicate beside the original, under `<name> copy`, then `<name> copy 2`… An outline has no duplicate. */
export function duplicateView(d: ViewSet, i: number): void {
  d.views.splice(i + 1, 0, { ...structuredClone(d.views[i]), name: freeName(`${d.views[i].name} copy`, names(d)) })
}

/** Delete; a deleted START clears itself (D4). Never offered for the last view. */
export function deleteView(d: ViewSet, i: number): void {
  const [gone] = d.views.splice(i, 1)
  if (d.defaultView === gone.name) delete d.defaultView
}

/** Drag-to-reorder: the view at `from` lands at final index `to`. */
export function moveView(d: ViewSet, from: number, to: number): void {
  d.views.splice(to, 0, ...d.views.splice(from, 1))
}

/** A rename commits only a non-empty name no OTHER view has (the view tabs' rule); null otherwise. */
export const uniqueViewName = (views: readonly ViewDef[], i: number, draft: string): string | null => {
  const name = draft.trim()
  return name !== '' && !views.some((v, j) => j !== i && v.name === name) ? name : null
}

// ---------- view options (YAZ-4518) ----------

type Check = (value: unknown, def: ViewSet) => boolean
type Is = (value: unknown) => boolean
const text: Is = (v) => typeof v === 'string'
const flag: Is = (v) => typeof v === 'boolean'
const oneOf = (...values: unknown[]): Is => (v) => values.includes(v)
const only = (v: Record<string, unknown>, keys: readonly string[]): boolean => Object.keys(v).every((k) => keys.includes(k))
const direction = oneOf('ASC', 'DESC')
const positive = (v: unknown): boolean => typeof v === 'number' && Number.isFinite(v) && v > 0
const map = (check: Is): Is => (v) => isRecord(v) && Object.values(v).every(check)
const filter = (v: unknown, depth = 0): boolean =>
  typeof v === 'string' ||
  (depth < 32 && isRecord(v) && Object.keys(v).length === 1 && ['and', 'or', 'not'].includes(Object.keys(v)[0]) && Array.isArray(Object.values(v)[0]) && (Object.values(v)[0] as unknown[]).every((f) => filter(f, depth + 1)))
const group = (v: unknown): boolean => isRecord(v) && only(v, ['property', 'direction']) && typeof v.property === 'string' && (v.direction === undefined || direction(v.direction))
const COMMON: Record<string, Check> = {
  filters: (v) => filter(v),
  order: (v) => Array.isArray(v) && v.every((k) => typeof k === 'string'),
  sort: (v) => Array.isArray(v) && v.every((s) => isRecord(s) && only(s, ['property', 'direction']) && typeof s.property === 'string' && direction(s.direction)),
  // Only the first two levels are honoured (YAZ-745): a third would be stored and never shown.
  groupBy: (v) => group(v) || (Array.isArray(v) && v.length >= 1 && v.length <= 2 && v.every(group)),
  limit: (v) => Number.isInteger(v) && (v as number) > 0,
  summaries: (v, def) => map((kind) => typeof kind === 'string' && ((BUILTIN_SUMMARIES as readonly string[]).includes(kind) || Object.hasOwn(def.summaries ?? {}, kind)))(v),
}
const cardSize: Is = (v) => positive(v) || oneOf('small', 'medium', 'large')(v)
/** The options each skin reads, beside the common ones. A view type the app does not know takes none. */
const BY_TYPE: Record<string, Record<string, Check>> = {
  table: { columnSize: map(positive), frozenColumns: (v) => Number.isInteger(v) && (v as number) >= 0, rowNumbers: flag, rowHeight: oneOf('short', 'medium', 'tall') },
  board: { showEmptyColumns: flag, cardSize, cardStyle: map((s) => isRecord(s) && only(s, ['bold', 'underline', 'hideLabel', 'join']) && Object.values(s).every((f) => typeof f === 'boolean')) },
  cards: { image: text, cardSize, imageFit: oneOf('cover', 'contain'), imageAspectRatio: (v) => positive(v) || (typeof v === 'string' && positive(Number(v))) },
  list: { indentProperties: flag, markerStyle: oneOf('bullet', 'number', 'none'), propertySeparator: text },
  outline: { outline: text },
}
/** The values a menu deletes instead of writing (the YAML default-deletes rule): the same value from the CLI is the same absence. */
const DEFAULTS: Record<string, unknown> = { rowNumbers: true, frozenColumns: 0, showEmptyColumns: false, cardSize: 280, indentProperties: false, markerStyle: 'bullet', propertySeparator: ', ' }

/** Every option name some view type takes: the CLI's input schema lists exactly these. */
export const VIEW_OPTIONS: readonly string[] = [...new Set([...Object.keys(COMMON), ...Object.values(BY_TYPE).flatMap(Object.keys)])]

export class ViewOptionError extends Error {
  constructor(readonly code: 'UNSUPPORTED_OPTION' | 'INVALID_OPTION', message: string) {
    super(message)
  }
}

/** Set (or, with null, remove) options of `d.views[i]`. Every change is checked first, so a refused patch changes nothing. */
export function setViewOptions(d: ViewSet, i: number, changes: Record<string, unknown>): void {
  const view = d.views[i]
  const checks = { ...COMMON, ...BY_TYPE[view.type] }
  for (const [key, value] of Object.entries(changes)) {
    const check = Object.hasOwn(checks, key) ? checks[key] : undefined
    if (check === undefined) throw new ViewOptionError('UNSUPPORTED_OPTION', `A ${view.type} view has no ${key} option.`)
    if (value !== null && !check(value, d)) throw new ViewOptionError('INVALID_OPTION', `${key} has an invalid value for a ${view.type} view.`)
  }
  for (const [key, value] of Object.entries(changes)) {
    if (value === null || value === DEFAULTS[key] || (key === 'propertySeparator' && value === '')) delete view[key]
    else view[key] = structuredClone(value)
  }
}
