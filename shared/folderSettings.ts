/**
 * A folder's settings (YAZ-830, YAZ-2290 D1): the parse of the key `folder_settings` of its `.folder.md`,
 * shared by the folder page (`client/src/views/folderSettings.ts`, the one door every surface reads and
 * writes through) and the CLI's folder commands (YAZ-4518), so both read and state the same block.
 *
 * TOLERANT PARSING (locked): this never throws and never blocks. Every bad shape becomes a
 * one-line `problem` plus a safe default, so a hand-edited file always renders. A file with no
 * settings key at all is the defaults, with zero problems.
 */
import { PROPERTY_KINDS, type PropertyDecl, type PropertyKind } from './types'
import { readPropertyOptions, validPropertyOptions, validPropertyOptionSort } from './propertyOptions'
import { isRecord } from './guards'
import { FOLDER_SETTINGS_KEY } from './folderSettingsLinks'
import type { ViewDef } from './folderViews'

/** A column the folder declares — this module's own vocabulary, shaped like `PropertyDecl`. */
export type ColumnDecl = PropertyDecl

export interface FolderSettings {
  columns: Record<string, ColumnDecl>
  /** View NAME a fresh open starts on (YAZ-1104) — undefined (or a stale name) means the first view. */
  defaultView?: string
  /**
   * The folder's named formulas, `ViewSet.formulas` verbatim (YAZ-745): a `formula.<name>` key is a
   * column, a sort AND a grouping level, so a folder that declares none can not group on one.
   * Undefined when absent; a non-map, or an entry that is not a string, is a problem and dropped —
   * the expression itself is never parsed here (a bad one is the engine's own reported cell error).
   */
  formulas?: Record<string, string>
  /** Column labels (YAZ-1513): `ViewSet.properties` verbatim — key → { displayName }. The KEY never changes; only what the header says. */
  properties?: Record<string, { displayName?: string }>
  /**
   * Never empty: `DEFAULT_VIEWS` when the key declares none usable — but otherwise EXACTLY what
   * the file lists, nothing added (🔒 D3, YAZ-1471). `ViewDef` verbatim.
   */
  views: ViewDef[]
  /** Human one-liners a surface can show. Never thrown, never written back. */
  problems: string[]
}

/**
 * 🔒 Q7 (YAZ-815, amended YAZ-935, YAZ-2290 D5a): the two skins a folder that lists NO usable views
 * falls back to — Table, then Board; an Outline is the "+" menu's to add. That is the whole reach
 * of the rule: a folder that lists some has exactly those.
 */
export const DEFAULT_VIEWS: readonly ViewDef[] = [
  { type: 'table', name: 'Table' },
  { type: 'board', name: 'Board' },
]

/** The column a folder has until its settings say otherwise (YAZ-1513): a Select whose options are in the order the board shows them. */
export const DEFAULT_COLUMNS: Readonly<Record<string, ColumnDecl>> = {
  status: { kind: 'select', options: ['1-Backlog', '2-Todo', '3-In-Progress', '4-Done'] },
}

const KINDS = new Set<string>(PROPERTY_KINDS)

/** A fresh copy per read: the defaults are handed out to be edited and written back. The Table alone where the vault does not use IDs (YAZ-2523 🔒 V11). */
const defaultViews = (ids: boolean): ViewDef[] => (ids ? DEFAULT_VIEWS : DEFAULT_VIEWS.filter((view) => view.type === 'table')).map((view) => ({ ...view }))

/** Keys → `{ kind, target?, required? }`. An unknown kind means the column is ABSENT (typing falls to lower rungs). */
export function readColumns(raw: unknown, problems: string[]): Record<string, ColumnDecl> {
  const columns: Record<string, ColumnDecl> = {}
  if (raw === undefined) return columns
  if (!isRecord(raw)) {
    problems.push(`${FOLDER_SETTINGS_KEY}.columns must be a map of column names — ignoring it`)
    return columns
  }
  for (const [name, value] of Object.entries(raw)) {
    if (!isRecord(value)) {
      problems.push(`${FOLDER_SETTINGS_KEY}.columns.${name} must be a map with a kind — ignoring that column`)
      continue
    }
    if (typeof value.kind !== 'string' || !KINDS.has(value.kind)) {
      problems.push(`${FOLDER_SETTINGS_KEY}.columns.${name} has an unknown kind — ignoring that column`)
      continue
    }
    const column: ColumnDecl = { kind: value.kind as PropertyKind }
    if (typeof value.target === 'string') column.target = value.target
    else if (value.target !== undefined) problems.push(`${FOLDER_SETTINGS_KEY}.columns.${name}.target must be text — ignoring it`)
    if (typeof value.required === 'boolean') column.required = value.required
    else if (value.required !== undefined)
      problems.push(`${FOLDER_SETTINGS_KEY}.columns.${name}.required must be true or false — ignoring it`)
    if (value.options !== undefined) {
      const options = readPropertyOptions(value.options)
      if (options !== undefined) column.options = options
      if (!validPropertyOptions(value.options)) problems.push(`${FOLDER_SETTINGS_KEY}.columns.${name}.options must be a list of unique non-empty labels — ignoring invalid entries`)
    }
    if (value.optionSort !== undefined) {
      if (validPropertyOptionSort(value.optionSort)) column.optionSort = value.optionSort
      else problems.push(`${FOLDER_SETTINGS_KEY}.columns.${name}.optionSort must be manual, ascending, or descending — using manual order`)
    }
    columns[name] = column
  }
  return columns
}

/**
 * parseViews's view assertion (`views/viewSchema.ts`), mirrored — but a bad entry is dropped,
 * never thrown. It only ever drops: a usable list comes back as the file wrote it, in its order,
 * with nothing spliced in.
 */
function readViews(raw: unknown, problems: string[], ids: boolean): ViewDef[] {
  if (raw === undefined) return defaultViews(ids)
  if (!Array.isArray(raw)) {
    problems.push(`${FOLDER_SETTINGS_KEY}.views must be a list of views — using the default views`)
    return defaultViews(ids)
  }
  const views: ViewDef[] = []
  raw.forEach((view: unknown, i) => {
    if (!isRecord(view) || typeof view.type !== 'string' || typeof view.name !== 'string') {
      problems.push(`${FOLDER_SETTINGS_KEY}.views[${i}] must be a map with a type and a name — skipping it`)
      return
    }
    if (view.outline !== undefined && typeof view.outline !== 'string') {
      problems.push(`${FOLDER_SETTINGS_KEY}.views[${i}].outline must be one markdown bullet list — ignoring it`)
      const { outline: _dropped, ...rest } = view
      views.push(rest as ViewDef)
      return
    }
    // Unknown view types and extra keys ride along untouched (`ViewDef`'s index signature).
    views.push(view as ViewDef)
  })
  if (views.length === 0) return defaultViews(ids)
  return views
}

/** `name → expression`, tolerant like the rest: a bad map is absent, a bad entry is dropped. */
function readFormulas(raw: unknown, problems: string[]): Record<string, string> | undefined {
  if (raw === undefined) return undefined
  if (!isRecord(raw)) {
    problems.push(`${FOLDER_SETTINGS_KEY}.formulas must be a map of named expressions — ignoring it`)
    return undefined
  }
  const formulas: Record<string, string> = {}
  for (const [name, expr] of Object.entries(raw)) {
    if (typeof expr === 'string') formulas[name] = expr
    else problems.push(`${FOLDER_SETTINGS_KEY}.formulas.${name} must be an expression — ignoring that formula`)
  }
  return formulas
}

/**
 * `key → { displayName }`, tolerant like `readFormulas`: a non-map is ignored with a problem, a
 * non-map entry or a non-string `displayName` drops just that entry. Only `displayName` is read —
 * the settings module's vocabulary for a label is exactly that one word.
 */
function readProperties(raw: unknown, problems: string[]): Record<string, { displayName?: string }> | undefined {
  if (raw === undefined) return undefined
  if (!isRecord(raw)) {
    problems.push(`${FOLDER_SETTINGS_KEY}.properties must be a map of column labels — ignoring it`)
    return undefined
  }
  const properties: Record<string, { displayName?: string }> = {}
  for (const [key, entry] of Object.entries(raw)) {
    if (!isRecord(entry)) {
      problems.push(`${FOLDER_SETTINGS_KEY}.properties.${key} must be a map with a displayName — ignoring that label`)
      continue
    }
    if (entry.displayName === undefined) {
      properties[key] = {}
      continue
    }
    if (typeof entry.displayName !== 'string') {
      problems.push(`${FOLDER_SETTINGS_KEY}.properties.${key}.displayName must be text — ignoring that label`)
      continue
    }
    // A blank label is no label (YAZ-1549): the header never goes empty, it wears the default.
    properties[key] = entry.displayName.trim() === '' ? {} : { displayName: entry.displayName }
  }
  return properties
}

/** The saved starting view's NAME. Any string reads verbatim — staleness is the pane's concern. */
function readDefaultView(raw: unknown, problems: string[]): string | undefined {
  if (raw === undefined) return undefined
  if (typeof raw === 'string') return raw
  problems.push(`${FOLDER_SETTINGS_KEY}.defaultView must be a view name — ignoring it`)
  return undefined
}

/**
 * A FOLDER's settings (YAZ-2290 D1/E2), off the properties of its `.folder.md`. Until that file saves any, the
 * folder has the defaults — the default views and the default Status column — and nothing is
 * written for them. Once saved, the file states exactly which columns the folder has.
 *
 * Where the vault does not use IDs (`ids` false, YAZ-2523 🔒 V11) the defaults are a Table and no
 * column: a column there is the notes' own property, and none is made up.
 */
export function folderSettingsOf(properties: Record<string, unknown> | undefined, ids: boolean): FolderSettings {
  const raw = properties?.[FOLDER_SETTINGS_KEY]
  // Absent, or written as a bare `folder_settings:` — nothing saved yet.
  if (raw == null) return { columns: ids ? structuredClone(DEFAULT_COLUMNS) : {}, views: defaultViews(ids), problems: [] }
  const problems: string[] = []
  if (!isRecord(raw)) {
    problems.push(`${FOLDER_SETTINGS_KEY} must be a map of settings — using the defaults`)
    return { columns: {}, views: defaultViews(ids), problems }
  }
  return {
    columns: readColumns(raw.columns, problems),
    defaultView: readDefaultView(raw.defaultView, problems),
    formulas: readFormulas(raw.formulas, problems),
    properties: readProperties(raw.properties, problems),
    views: readViews(raw.views, problems, ids),
    problems,
  }
}

/** The typed settings as the plain map YAML holds; `problems` are a read-time report and never reach disk. */
export function folderSettingsValue(settings: FolderSettings): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  if (Object.keys(settings.columns).length > 0) out.columns = settings.columns
  if (settings.defaultView !== undefined) out.defaultView = settings.defaultView
  if (settings.formulas !== undefined) out.formulas = settings.formulas
  if (settings.properties !== undefined) out.properties = settings.properties
  out.views = settings.views
  return out
}
