/**
 * THE READ HALF of a folder's settings (YAZ-5460): pure, with no bridge, so the phone's folder page reads a
 * `.folder.md` with the Mac's own parser. `folderSettings.ts` re-exports all of it beside the writes.
 *
 * A folder's settings (YAZ-830, YAZ-2290 D1): THE one door to the key `folder_settings` of
 * its `.folder.md`. Every surface reads a folder's config through `folderSettings()` and every
 * edit goes back through `writeFolderSettings()` — no surface re-parses that key itself (locked).
 *
 * TOLERANT PARSING (locked): this never throws and never blocks. Every bad shape becomes a
 * one-line `problem` plus a safe default, so a hand-edited file always renders. A file with no
 * settings key at all is the defaults, with zero problems.
 */
import { IMAGE_SHAPES, IMAGE_SIZE_DEFAULT, IMAGE_SIZE_MAX, IMAGE_SIZE_MIN, PROPERTY_KINDS, type ImageShape, type IndexRecord, type MentionsFrom, type PropertyDecl, type PropertyKind } from '@shared/types'
import { readPropertyOptions, validPropertyOptions, validPropertyOptionSort } from '@shared/propertyOptions'
import { isRecord } from '@shared/guards'
// The one reserved key this module owns, and where links live inside it (YAZ-864): both are in
// `@shared/folderSettingsLinks`, so the main process's ID rewrite walks the same leaves (YAZ-2677).
import { FOLDER_SETTINGS_KEY, OTHER_FILES_KEEP_PAGES_KEY, OTHER_FILES_KEY } from '@shared/folderSettingsLinks'
import { OTHER_FILES_KEEP_KEY_MOVE, movedFormulas, movedView } from '@shared/legacyNames'
import type { ViewDef } from './viewSchema'
import { PAGE_VIEW_TYPE } from './pageView'
import { readFormat } from './columnFormat'

/** A column the folder declares — this module's own vocabulary, shaped like `PropertyDecl`. */
export type ColumnDecl = PropertyDecl & {
  /**
   * "Separate value for <folder>" (YAZ-4713 C3): this folder's page keeps its own value for each page, in the page's
   * `in: {<page id>}` block, apart from the page's one value. Off by default; read only where the vault uses IDs.
   */
  separate?: true
}

export interface FolderSettings {
  columns: Record<string, ColumnDecl>
  /**
   * A folder PAGE's keys in `columns` that only type a field (YAZ-4713 C11): a subfolder below defines them, so a view
   * that shows one through "Other properties" types it by that definition, but none is one of this page's columns
   * (`pageColumnKeys`). Never read from or written to a file.
   */
  fromBelow?: readonly string[]
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
   * The pages moved to the page's Other files tray (YAZ-4597 D44), as links: `other_files` in the file. They leave
   * every view of the folder. Undefined when absent; an entry that is not text is a problem and dropped.
   */
  otherFiles?: string[]
  /** The folders of `otherFiles` whose pages stay in the views (YAZ-4747 OF2): `other_files_keep_pages`. */
  otherFilesKeepPages?: string[]
  /** Human one-liners a surface can show. Never thrown, never written back. */
  problems: string[]
}

/** The page's columns (YAZ-4713 C2, C4): the keys a view shows before it orders its own — never a key that only types a subfolder's field (`fromBelow`). */
export function pageColumnKeys(settings: Pick<FolderSettings, 'columns' | 'fromBelow'>): string[] {
  const keys = Object.keys(settings.columns)
  return settings.fromBelow === undefined || settings.fromBelow.length === 0 ? keys : keys.filter((key) => !settings.fromBelow!.includes(key))
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

const KINDS = new Set<string>(PROPERTY_KINDS)

/** A fresh copy per read: the defaults are handed out to be edited and written back. The Table alone where the vault does not use IDs (YAZ-2523 🔒 V11). */
const defaultViews = (ids: boolean): ViewDef[] => (ids ? DEFAULT_VIEWS : DEFAULT_VIEWS.filter((view) => view.type === 'table')).map((view) => ({ ...view }))

/** Keys → `{ kind, target?, required?, options?, optionSort?, format?, from?, separate?, pair?, size?, shape? }`. An unknown kind means the column is ABSENT (typing falls to lower rungs). */
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
    // A Linked mentions column's narrowing (YAZ-4739 L2): `from: { column?, folder? }`, each text; a bad part costs only that part.
    if (value.from !== undefined) {
      const from = isRecord(value.from) ? value.from : {}
      if (!isRecord(value.from)) problems.push(`${FOLDER_SETTINGS_KEY}.columns.${name}.from must be a map — ignoring it`)
      const narrowed: MentionsFrom = {}
      for (const part of ['column', 'folder'] as const) {
        if (typeof from[part] === 'string' && from[part].trim() !== '') narrowed[part] = from[part]
        else if (from[part] !== undefined) problems.push(`${FOLDER_SETTINGS_KEY}.columns.${name}.from.${part} must be text — ignoring it`)
      }
      if (Object.keys(narrowed).length > 0) column.from = narrowed
    }
    // The other side of a link column (YAZ-4781 R1): only `true` on a Linked mentions column that names its column.
    if (value.pair === true && column.kind === 'mentions' && column.from?.column !== undefined) column.pair = true
    else if (value.pair !== undefined && value.pair !== false) problems.push(`${FOLDER_SETTINGS_KEY}.columns.${name}.pair must be true on a Linked mentions column with from.column — ignoring it`)
    // Option parents (YAZ-4799): on a Select or Multi-select column, `parent: { column, of: { option: parent option } }`.
    if (value.parent !== undefined) {
      const raw = isRecord(value.parent) ? value.parent : null
      const of = raw !== null && isRecord(raw.of) ? Object.fromEntries(Object.entries(raw.of).filter((e): e is [string, string] => typeof e[1] === 'string' && e[1] !== '')) : {}
      if ((column.kind === 'select' || column.kind === 'multi-select') && raw !== null && typeof raw.column === 'string' && raw.column.trim() !== '' && raw.column !== name) {
        // "Any <column>" options (YAZ-4799 demo): a list of option names; one that also has a parent keeps the parent.
        const any = Array.isArray(raw.any) ? [...new Set(raw.any.filter((o): o is string => typeof o === 'string' && o !== '' && of[o] === undefined))] : []
        column.parent = any.length > 0 ? { column: raw.column, of, any } : { column: raw.column, of }
      }
      else problems.push(`${FOLDER_SETTINGS_KEY}.columns.${name}.parent must name another column, on a Select or Multi-select column — ignoring it`)
    }
    // An Image column's look (YAZ-4802): `size` (px) and `shape`, each only on that kind; a bad one costs only itself.
    if (value.size !== undefined) {
      if (column.kind === 'image' && typeof value.size === 'number' && Number.isInteger(value.size) && value.size >= IMAGE_SIZE_MIN && value.size <= IMAGE_SIZE_MAX) {
        if (value.size !== IMAGE_SIZE_DEFAULT) column.size = value.size
      } else problems.push(`${FOLDER_SETTINGS_KEY}.columns.${name}.size must be a whole number from ${IMAGE_SIZE_MIN} to ${IMAGE_SIZE_MAX}, on an Image column — using ${IMAGE_SIZE_DEFAULT}`)
    }
    if (value.shape !== undefined) {
      if (column.kind === 'image' && (IMAGE_SHAPES as readonly unknown[]).includes(value.shape)) column.shape = value.shape as ImageShape
      else problems.push(`${FOLDER_SETTINGS_KEY}.columns.${name}.shape must be rounded or circle, on an Image column — showing the picture as is`)
    }
    // "Separate value for <folder>" (YAZ-4713 C3): only `true` is the switch; `false` is the default, written by hand.
    if (value.separate === true) column.separate = true
    else if (value.separate !== undefined && value.separate !== false) problems.push(`${FOLDER_SETTINGS_KEY}.columns.${name}.separate must be true or false — ignoring it`)
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
    let read: Record<string, unknown> = movedView(view)
    if (view.outline !== undefined && typeof view.outline !== 'string') {
      problems.push(`${FOLDER_SETTINGS_KEY}.views[${i}].outline must be one markdown bullet list — ignoring it`)
      const { outline: _dropped, ...rest } = read
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

/** `other_files` (and `other_files_keep_pages`): a list of links. Only text survives; what a link names is the page's to resolve. */
function readOtherFiles(raw: unknown, problems: string[], key = OTHER_FILES_KEY): string[] | undefined {
  if (raw === undefined) return undefined
  if (!Array.isArray(raw)) {
    problems.push(`${FOLDER_SETTINGS_KEY}.${key} must be a list of page links — ignoring it`)
    return undefined
  }
  const links = raw.filter((link): link is string => typeof link === 'string')
  if (links.length < raw.length) problems.push(`${FOLDER_SETTINGS_KEY}.${key} must hold only page links — ignoring the rest`)
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
 * folder has the defaults — the default views and NO column (YAZ-4713 C5: a folder starts blank and shows what its
 * parent folders declare, C2) — and nothing is written for them. Once saved, the file states exactly which columns
 * the folder has.
 *
 * Where the vault does not use IDs (`ids` false, YAZ-2523 🔒 V11) the default views are a Table alone.
 */
export function folderSettings(record: IndexRecord | undefined, ids: boolean): FolderSettings {
  const raw = record?.properties[FOLDER_SETTINGS_KEY]
  // Absent, or written as a bare `folder_settings:` — nothing saved yet.
  if (raw == null) return { columns: {}, views: defaultViews(ids), problems: [] }
  const problems: string[] = []
  if (!isRecord(raw)) {
    problems.push(`${FOLDER_SETTINGS_KEY} must be a map of settings — using the defaults`)
    return { columns: {}, views: defaultViews(ids), problems }
  }
  return {
    columns: readColumns(raw.columns, problems),
    defaultView: readDefaultView(raw.defaultView, problems),
    // YAZ-5036: a Type test on `note` in a formula tests `page`, as the views' filters do (`movedView`).
    formulas: readFormulas(movedFormulas(raw.formulas), problems),
    properties: readProperties(raw.properties, problems),
    views: readViews(raw.views, problems, ids),
    otherFiles: readOtherFiles(raw[OTHER_FILES_KEY], problems),
    // YAZ-5036: a file from before the rename says `other_files_keep_notes`; the new key wins when both are there.
    otherFilesKeepPages: readOtherFiles(raw[OTHER_FILES_KEEP_PAGES_KEY] ?? raw[OTHER_FILES_KEEP_KEY_MOVE.from], problems, OTHER_FILES_KEEP_PAGES_KEY),
    problems,
  }
}

/** The link and multi-link column keys the vault's `.folder.md`s define, sorted, once each: what Linked mentions' "Only from the column" offers (YAZ-4739 L2). */
export function linkColumnKeys(folders: readonly IndexRecord[]): string[] {
  const keys = new Set<string>()
  for (const record of folders) {
    const raw = record.properties[FOLDER_SETTINGS_KEY]
    if (!isRecord(raw)) continue
    for (const [key, decl] of Object.entries(readColumns(raw.columns, []))) if (decl.kind === 'link' || decl.kind === 'multi-link') keys.add(key)
  }
  return [...keys].sort()
}

