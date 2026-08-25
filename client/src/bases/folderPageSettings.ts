/**
 * Folder page settings (YAZ-830): THE one door to the reserved frontmatter key
 * `folder_page_settings`. Every surface reads a folder page's config through
 * `folderPageSettings()` and every edit goes back through `writeFolderPageSettings()` — no
 * surface re-parses that key itself (locked). The flag that MAKES a page a folder page is not
 * here: that is `folder_page`, read through `links/folderPages.ts` `isFolderPage`.
 *
 * TOLERANT PARSING (locked): this never throws and never blocks. Every bad shape becomes a
 * one-line `problem` plus a safe default, so a hand-edited page always renders — the same
 * report-don't-block rule the deleted type system followed for its own stored folder. A
 * flagged page with no settings key at all is exactly that, with zero problems.
 */
import { FOLDER_NAME, PROPERTY_KINDS, type IndexRecord, type PropertyKind } from '@shared/types'
import type { ResolveLink } from '../editor/wikilink/wikilinkPlugin'
import type { BaseView } from './baseFile'
import { writeProperty } from './writeProperty'

/** The one reserved key this module owns; nothing else may name it. */
const SETTINGS_KEY = 'folder_page_settings'

/** A column the folder page declares — this module's own vocabulary, shaped like `PropertyDecl`. */
export interface ColumnDecl {
  kind: PropertyKind
  /** link/multi-link constraint. An opaque string HERE; its `[[X]]` belongs-to meaning is 2B's. */
  target?: string
  /** Report-only metadata, kept as-is when boolean — it gates nothing, like a vault-wide declaration's. */
  required?: boolean
}

export interface FolderPageSettings {
  columns: Record<string, ColumnDecl>
  /** The parking bin for new members — undefined when absent OR unusable at rest. */
  folder?: string
  /** Never empty: `DEFAULT_VIEWS` when the key declares none usable. `BaseView` verbatim. */
  views: BaseView[]
  /** Human one-liners a surface can show. Never thrown, never written back. */
  problems: string[]
}

/** 🔒 Q7 (YAZ-815): a folder page always has its two skins, OUTLINE FIRST. */
export const DEFAULT_VIEWS: readonly BaseView[] = [
  { type: 'outline', name: 'Outline' },
  { type: 'table', name: 'Table' },
]

const KINDS = new Set<string>(PROPERTY_KINDS)

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)

/** A fresh copy per read: the defaults are handed out to be edited and written back. */
const defaultViews = (): BaseView[] => DEFAULT_VIEWS.map((view) => ({ ...view }))

/** Keys → `{ kind, target?, required? }`. An unknown kind means the column is ABSENT (typing falls to lower rungs). */
function readColumns(raw: unknown, problems: string[]): Record<string, ColumnDecl> {
  const columns: Record<string, ColumnDecl> = {}
  if (raw === undefined) return columns
  if (!isRecord(raw)) {
    problems.push(`${SETTINGS_KEY}.columns must be a map of column names — ignoring it`)
    return columns
  }
  for (const [name, value] of Object.entries(raw)) {
    if (!isRecord(value)) {
      problems.push(`${SETTINGS_KEY}.columns.${name} must be a map with a kind — ignoring that column`)
      continue
    }
    if (typeof value.kind !== 'string' || !KINDS.has(value.kind)) {
      problems.push(`${SETTINGS_KEY}.columns.${name} has an unknown kind — ignoring that column`)
      continue
    }
    const column: ColumnDecl = { kind: value.kind as PropertyKind }
    if (typeof value.target === 'string') column.target = value.target
    else if (value.target !== undefined) problems.push(`${SETTINGS_KEY}.columns.${name}.target must be text — ignoring it`)
    if (typeof value.required === 'boolean') column.required = value.required
    else if (value.required !== undefined)
      problems.push(`${SETTINGS_KEY}.columns.${name}.required must be true or false — ignoring it`)
    columns[name] = column
  }
  return columns
}

/** parseBase's view assertion (`bases/baseFile.ts`), mirrored — but a bad entry is dropped, never thrown. */
function readViews(raw: unknown, problems: string[]): BaseView[] {
  if (raw === undefined) return defaultViews()
  if (!Array.isArray(raw)) {
    problems.push(`${SETTINGS_KEY}.views must be a list of views — using the default views`)
    return defaultViews()
  }
  const views: BaseView[] = []
  raw.forEach((view: unknown, i) => {
    if (!isRecord(view) || typeof view.type !== 'string' || typeof view.name !== 'string') {
      problems.push(`${SETTINGS_KEY}.views[${i}] must be a map with a type and a name — skipping it`)
      return
    }
    // Unknown view types and extra keys ride along untouched (`BaseView`'s index signature).
    views.push(view as BaseView)
  })
  return views.length > 0 ? views : defaultViews()
}

/** The shared folder grammar, and its rule: unusable at rest reads as absent. */
function readFolder(raw: unknown, problems: string[]): string | undefined {
  if (raw === undefined) return undefined
  if (typeof raw === 'string' && FOLDER_NAME.test(raw)) return raw
  problems.push(`${SETTINGS_KEY}.folder must be a root-relative folder name — ignoring it`)
  return undefined
}

/** One folder page's config, as read off its frontmatter. Safe on ANY record, flagged or not. */
export function folderPageSettings(record: IndexRecord): FolderPageSettings {
  const raw = record.properties[SETTINGS_KEY]
  const problems: string[] = []
  // Absent, or written as a bare `folder_page_settings:` — the page simply has no settings yet.
  if (raw === undefined || raw === null) return { columns: {}, views: defaultViews(), problems }
  if (!isRecord(raw)) {
    problems.push(`${SETTINGS_KEY} must be a map of settings — using the defaults`)
    return { columns: {}, views: defaultViews(), problems }
  }
  return {
    columns: readColumns(raw.columns, problems),
    folder: readFolder(raw.folder, problems),
    views: readViews(raw.views, problems),
    problems,
  }
}

/**
 * One folder page's declaration for a key — VIEW-SCOPED (🔒 Q8, YAZ-815): two folder pages may
 * declare the same card key with different kinds and NEITHER wins globally; the caller asks the
 * folder page whose view it is rendering, and no conflict resolver exists anywhere.
 */
export function columnKindIn(settings: FolderPageSettings, key: string): ColumnDecl | null {
  return settings.columns[key] ?? null
}

/** The FIRST outline view's raw wikilink list, or []. Non-strings are ignored — nothing here is trusted. */
export function outlineOrderOf(settings: FolderPageSettings): string[] {
  const order = settings.views.find((view) => view.type === 'outline')?.order
  return Array.isArray(order) ? order.filter((entry: unknown): entry is string => typeof entry === 'string') : []
}

/** Names sort the way the base engine sorts them: case- and accent-insensitive, numeric-aware. */
const collator = new Intl.Collator(undefined, { sensitivity: 'base', numeric: true })

/**
 * THE [D5] ORDERING RULE, in ONE place (🔒 Q3): the outline view's `order` places members first,
 * in order-entry sequence; every unlisted member follows, alphabetical by basename (so no order
 * at all is all-alphabetical). Each entry is resolved exactly as a click would resolve it —
 * case-insensitively, alias-aware, through the resolver handed in, like `folderPages.ts`.
 *
 * A STALE entry is ignored harmlessly: unresolved, resolving to a non-member, or naming a member
 * already placed. An order list therefore never needs cleaning up after a rename or a delete, and
 * every member appears exactly once whatever the list says.
 */
export function orderedMembers(
  members: readonly IndexRecord[],
  settings: FolderPageSettings,
  resolve: ResolveLink,
): IndexRecord[] {
  const byPath = new Map(members.map((member) => [member.path, member]))
  const placed: IndexRecord[] = []
  const taken = new Set<string>()
  for (const entry of outlineOrderOf(settings)) {
    const target = resolve(entry)
    if (target === null || taken.has(target)) continue
    const member = byPath.get(target)
    if (member === undefined) continue
    taken.add(target)
    placed.push(member)
  }
  const rest = members.filter((member) => !taken.has(member.path))
  rest.sort((a, b) => collator.compare(a.basename, b.basename))
  return [...placed, ...rest]
}

/** The typed settings as the plain map YAML holds; `problems` are a read-time report and never reach disk. */
function plain(settings: FolderPageSettings): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  if (Object.keys(settings.columns).length > 0) out.columns = settings.columns
  if (settings.folder !== undefined) out.folder = settings.folder
  out.views = settings.views
  return out
}

/**
 * Write the whole block back as the ONE key, through the shared one-key card writer
 * (`writeProperty` — its read → rewrite → `expectedMtime` → retry-once dance is reused, never
 * duplicated). EXACTLY what the caller passes is written: `undefined` deletes the key and an
 * all-default value is still a value, because a delete is the caller's explicit choice and never
 * this module's inference.
 */
export function writeFolderPageSettings(
  path: string,
  next: FolderPageSettings | undefined,
): Promise<{ mtime: number }> {
  return writeProperty(path, SETTINGS_KEY, next === undefined ? undefined : plain(next))
}
