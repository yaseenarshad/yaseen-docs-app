/**
 * A folder's settings (YAZ-830, YAZ-2290 D1): THE one door to the key `folder_settings` of
 * its `.folder.md`. Every surface reads a folder's config through `folderSettings()` and every
 * edit goes back through `writeFolderSettings()` — no surface re-parses that key itself (locked).
 *
 * TOLERANT PARSING (locked): this never throws and never blocks. Every bad shape becomes a
 * one-line `problem` plus a safe default, so a hand-edited file always renders. A file with no
 * settings key at all is the defaults, with zero problems.
 */
import { FrontmatterWriteError, parseFrontmatter, setFrontmatterProperty, splitFrontmatter } from '@shared/frontmatter'
import { PROPERTY_KINDS, type IndexRecord, type PropertyDecl, type PropertyKind } from '@shared/types'
import { readPropertyOptions, validPropertyOptions, validPropertyOptionSort } from '@shared/propertyOptions'
import { isRecord } from '@shared/guards'
// The one reserved key this module owns, and where links live inside it (YAZ-864): both are in
// `@shared/folderSettingsLinks`, so the main process's ID rewrite walks the same leaves (YAZ-2677).
import { FOLDER_SETTINGS_KEY, OTHER_FILES_KEY } from '@shared/folderSettingsLinks'
import type { ViewDef } from './viewSchema'
import { PAGE_VIEW_TYPE } from './pageView'
import { transformFile, writeProperty } from './writeProperty'
import { readFormat } from './columnFormat'

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
  /**
   * The notes moved to the page's Other files tray (YAZ-4597 D44), as links: `other_files` in the file. They leave
   * every view of the folder. Undefined when absent; an entry that is not text is a problem and dropped.
   */
  otherFiles?: string[]
  /** Human one-liners a surface can show. Never thrown, never written back. */
  problems: string[]
}

/**
 * 🔒 Q7 (YAZ-815, amended YAZ-935, YAZ-2290 D5a): the two skins a folder that lists NO usable views
 * falls back to — Table, then Board; a Page tab is the "+" menu's to add. That is the whole reach
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

/** Keys → `{ kind, target?, required?, options?, optionSort?, format? }`. An unknown kind means the column is ABSENT (typing falls to lower rungs). */
function readColumns(raw: unknown, problems: string[]): Record<string, ColumnDecl> {
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
    // The column's description (YAZ-4590 S23): blank text is no description.
    if (typeof value.description === 'string') {
      if (value.description.trim()) column.description = value.description
    } else if (value.description !== undefined) problems.push(`${FOLDER_SETTINGS_KEY}.columns.${name}.description must be text — ignoring it`)
    if (value.options !== undefined) {
      const options = readPropertyOptions(value.options)
      if (options !== undefined) column.options = options
      if (!validPropertyOptions(value.options)) problems.push(`${FOLDER_SETTINGS_KEY}.columns.${name}.options must be a list of unique non-empty labels — ignoring invalid entries`)
    }
    if (value.optionSort !== undefined) {
      if (validPropertyOptionSort(value.optionSort)) column.optionSort = value.optionSort
      else problems.push(`${FOLDER_SETTINGS_KEY}.columns.${name}.optionSort must be manual, ascending, or descending — using manual order`)
    }
    // A Number or Date column's display format (YAZ-4591 S21/S22); a bad one costs only the format.
    if (value.format !== undefined) {
      const format = readFormat(column.kind, value.format, problems, `${FOLDER_SETTINGS_KEY}.columns.${name}.format`)
      if (format !== undefined) column.format = format
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
    let read: Record<string, unknown> = view
    if (view.outline !== undefined && typeof view.outline !== 'string') {
      problems.push(`${FOLDER_SETTINGS_KEY}.views[${i}].outline must be one markdown bullet list — ignoring it`)
      const { outline: _dropped, ...rest } = view
      read = rest
    }
    // A stored Outline is the Page tab (YAZ-4584 D38); its old `outline` string rides along until it is moved by hand (D39).
    // Unknown view types and extra keys ride along untouched (`ViewDef`'s index signature).
    views.push((view.type === 'outline' ? { ...read, type: PAGE_VIEW_TYPE } : read) as ViewDef)
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

/** `other_files`: a list of note links. Only text survives; what a link names is the page's to resolve. */
function readOtherFiles(raw: unknown, problems: string[]): string[] | undefined {
  if (raw === undefined) return undefined
  if (!Array.isArray(raw)) {
    problems.push(`${FOLDER_SETTINGS_KEY}.${OTHER_FILES_KEY} must be a list of note links — ignoring it`)
    return undefined
  }
  const links = raw.filter((link): link is string => typeof link === 'string')
  if (links.length < raw.length) problems.push(`${FOLDER_SETTINGS_KEY}.${OTHER_FILES_KEY} must hold only note links — ignoring the rest`)
  return links
}

/** The saved starting view's NAME. Any string reads verbatim — staleness is the pane's concern. */
function readDefaultView(raw: unknown, problems: string[]): string | undefined {
  if (raw === undefined) return undefined
  if (typeof raw === 'string') return raw
  problems.push(`${FOLDER_SETTINGS_KEY}.defaultView must be a view name — ignoring it`)
  return undefined
}

/** Whether the folder SAVED settings: its `.folder.md` holds the key with a value. */
export const hasFolderSettings = (record: IndexRecord | undefined): boolean => record?.properties[FOLDER_SETTINGS_KEY] != null

/**
 * A FOLDER's settings (YAZ-2290 D1/E2), off its `.folder.md` record. Until that file saves any, the
 * folder has the defaults — the default views and the default Status column — and nothing is
 * written for them. Once saved, the file states exactly which columns the folder has.
 *
 * Where the vault does not use IDs (`ids` false, YAZ-2523 🔒 V11) the defaults are a Table and no
 * column: a column there is the notes' own property, and none is made up.
 */
export function folderSettings(record: IndexRecord | undefined, ids: boolean): FolderSettings {
  const raw = record?.properties[FOLDER_SETTINGS_KEY]
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
    otherFiles: readOtherFiles(raw[OTHER_FILES_KEY], problems),
    problems,
  }
}

/** The typed settings as the plain map YAML holds; `problems` are a read-time report and never reach disk. */
function plain(settings: FolderSettings): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  if (Object.keys(settings.columns).length > 0) out.columns = settings.columns
  if (settings.defaultView !== undefined) out.defaultView = settings.defaultView
  if (settings.formulas !== undefined) out.formulas = settings.formulas
  if (settings.properties !== undefined) out.properties = settings.properties
  out.views = settings.views
  // An empty tray writes no key (YAZ-4597).
  if (settings.otherFiles !== undefined && settings.otherFiles.length > 0) out[OTHER_FILES_KEY] = settings.otherFiles
  return out
}

/**
 * Write the whole block back as the ONE key, through the shared one-key card writer
 * (`writeProperty` — its read → rewrite → `expectedMtime` → retry-once dance is reused, never
 * duplicated). EXACTLY what the caller passes is written: `undefined` deletes the key and an
 * all-default value is still a value, because a delete is the caller's explicit choice and never
 * this module's inference.
 *
 * With `base`, the block as the caller last read it from disk (a folder page: the index's), the write is a REBASE
 * (YAZ-4596 S38): at each read, the first and the retry after a CONFLICT, the change from `base` to `next` is laid
 * onto the block on disk (`rebaseSettings`). The caller's own writes still in flight are in `next`, so they ride
 * again; another tab's or window's write that the caller has not heard of yet stays.
 */
export function writeFolderSettings(
  path: string,
  next: FolderSettings | undefined,
  base?: FolderSettings,
  ids = true,
): Promise<{ mtime: number }> {
  if (next === undefined || base === undefined) return writeProperty(path, FOLDER_SETTINGS_KEY, next === undefined ? undefined : plain(next))
  const mine = plain(next)
  const from = plain(base)
  // The block on disk, read as this module reads it (a stored `outline` is a Page, as in `base`), then the change.
  // `ids` is the vault's own kind, the one `base` was read with (YAZ-4637 M2): a block with no views is one Table
  // without ids, and reading it as two would write a Board the folder never had.
  return writeProperty(path, FOLDER_SETTINGS_KEY, mine, (onDisk) =>
    isRecord(onDisk) ? rebaseSettings(from, mine, plain(folderSettings({ properties: { [FOLDER_SETTINGS_KEY]: onDisk } } as unknown as IndexRecord, ids))) : mine,
  )
}

/** The same YAML value, whatever the order of a map's keys; an absent key and an `undefined` one are the same. */
function sameValue(a: unknown, b: unknown): boolean {
  if (Object.is(a, b)) return true
  if (Array.isArray(a)) return Array.isArray(b) && a.length === b.length && a.every((x, i) => sameValue(x, b[i]))
  if (!isRecord(a) || !isRecord(b)) return false
  const keys = (r: Record<string, unknown>) => Object.keys(r).filter((k) => r[k] !== undefined)
  return keys(a).length === keys(b).length && keys(a).every((k) => sameValue(a[k], b[k]))
}

/** A list's names when each entry is a map with its own unique `name` (the views), else null. */
function namesOf(list: readonly unknown[]): string[] | null {
  const names = list.map((entry) => (isRecord(entry) && typeof entry.name === 'string' ? entry.name : null))
  return names.every((n): n is string => n !== null) && new Set(names).size === names.length ? names : null
}

/**
 * THE REBASE of a settings write (YAZ-4596 S38): this page's change, from `base` (the block as it last heard it from
 * disk) to `mine` (the block it means), laid onto `theirs` (the block on disk now — another tab or window may have written it since).
 * Each part this page did not change is disk's; each part it changed is its own. Maps merge key by key; the views
 * merge view by view (by name) while one side kept the list's names and order. A part that both sides changed is
 * this write's: it is the later one.
 */
export function rebaseSettings(base: unknown, mine: unknown, theirs: unknown): unknown {
  if (sameValue(mine, base)) return theirs
  if (sameValue(theirs, base)) return mine
  if (isRecord(base) && isRecord(mine) && isRecord(theirs)) {
    const out: Record<string, unknown> = {}
    for (const key of new Set([...Object.keys(theirs), ...Object.keys(mine)])) {
      const value = rebaseSettings(base[key], mine[key], theirs[key])
      if (value !== undefined) out[key] = value
    }
    return out
  }
  if (Array.isArray(base) && Array.isArray(mine) && Array.isArray(theirs)) {
    const [b, m, t] = [namesOf(base), namesOf(mine), namesOf(theirs)]
    if (b !== null && m !== null && t !== null) {
      // The side that kept the names gives way: the other side's list, each entry the three entries of its name merged.
      const kept = sameValue(m, b)
      if (kept || sameValue(t, b)) {
        const [list, names, other, otherNames] = kept ? [theirs, t, mine, m] : [mine, m, theirs, t]
        return list.map((entry, i) => {
          const name = names[i]
          if (!b.includes(name) || !otherNames.includes(name)) return entry
          const at = base[b.indexOf(name)]
          const others = other[otherNames.indexOf(name)]
          return kept ? rebaseSettings(at, others, entry) : rebaseSettings(at, entry, others)
        })
      }
      // Both sides changed the names (YAZ-4637 M3): disk's list and order, less the views this side removed, plus the
      // views it added — each after the view before it in this side's list — and each shared view merged.
      const out: unknown[] = theirs.filter((_, i) => !(b.includes(t[i]) && !m.includes(t[i])))
      const outNames = t.filter((name) => !(b.includes(name) && !m.includes(name)))
      m.forEach((name, i) => {
        if (b.includes(name) || t.includes(name)) return
        const after = i === 0 ? -1 : outNames.indexOf(m[i - 1])
        out.splice(after + 1, 0, mine[i])
        outNames.splice(after + 1, 0, name)
      })
      return out.map((entry, i) => {
        const name = outNames[i]
        if (!b.includes(name) || !m.includes(name) || !t.includes(name)) return entry
        return rebaseSettings(base[b.indexOf(name)], mine[m.indexOf(name)], entry)
      })
    }
  }
  return mine
}


/**
 * Edit one definition against fresh file bytes. The captured parsed declaration is the conflict
 * boundary: concurrent changes to other columns/views are retained, while a changed definition
 * asks the user to reopen its settings. transformFile repeats this check after an mtime retry.
 */
export function writeFolderColumn(path: string, key: string, next: PropertyDecl, base: PropertyDecl | undefined, ids: boolean): Promise<{ mtime: number }> {
  const problems: string[] = []
  const replacement = readColumns({ column: next }, problems).column
  if (!replacement || problems.length) return Promise.reject(new Error(problems[0] ?? 'Invalid property definition'))
  const normalize = (decl: unknown) => decl === undefined ? undefined : readColumns({ column: decl }, []).column
  const expected = JSON.stringify(normalize(base))
  const desired = JSON.stringify(replacement)
  return transformFile(path, content => {
    const parsed = parseFrontmatter(splitFrontmatter(content).frontmatter)
    if (parsed.error) throw new FrontmatterWriteError(parsed.error)
    const settings = parsed.properties[FOLDER_SETTINGS_KEY]
    if (settings != null && !isRecord(settings)) throw new Error('Folder settings must be a map before editing properties.')
    // Nothing saved yet (YAZ-2290 E2): the default columns are what the caller saw, so this first write states them.
    const raw = settings ?? { columns: folderSettings(undefined, ids).columns }
    if (raw.columns !== undefined && !isRecord(raw.columns)) throw new Error('Folder columns must be a map before editing properties.')
    const columns = raw.columns ?? {}
    const current = Object.prototype.hasOwnProperty.call(columns, key) ? columns[key] : undefined
    const currentProblems: string[] = []
    const currentDefinition = current === undefined ? undefined : readColumns({ column: current }, currentProblems).column
    if (current !== undefined && (!isRecord(current) || !currentDefinition || currentProblems.length)) throw new Error(`Property “${key}” has an invalid definition. Repair its YAML before editing it.`)
    const currentKnown = JSON.stringify(currentDefinition)
    if (currentKnown !== expected) throw new Error(`Property “${key}” changed since these settings were opened. Reopen the property and try again.`)
    if (currentKnown === desired) return content
    const declaration = { ...current }
    // Removing a known optional setting is intentional; unknown extension metadata survives.
    for (const field of ['kind', 'target', 'required', 'options', 'optionSort', 'description', 'format']) delete declaration[field]
    Object.assign(declaration, replacement)
    return setFrontmatterProperty(content, FOLDER_SETTINGS_KEY, { ...raw, columns: { ...columns, [key]: declaration } })
  })
}
