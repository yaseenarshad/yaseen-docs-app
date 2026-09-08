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
import { FrontmatterWriteError, parseFrontmatter, setFrontmatterProperty, splitFrontmatter } from '@shared/frontmatter'
import { FOLDER_NAME, PROPERTY_KINDS, type IndexRecord, type PropertyDecl, type PropertyKind } from '@shared/types'
import { readPropertyOptions, validPropertyOptions, validPropertyOptionSort } from '@shared/propertyOptions'
import type { ResolveLink } from '../editor/wikilink/wikilinkPlugin'
import { isExactWikilink } from '../links/folderPages'
import { mapOutlineLinks, parseOutline } from './outlineDoc'
import type { ViewDef } from './viewSchema'
import { transformFile, writeProperty } from './writeProperty'

/**
 * The one reserved key this module owns; nothing else may name it — exported (⚡ YAZ-884) only so
 * the properties panel's RESERVED list can be spelled from the real constants, exactly as
 * `FOLDER_PAGE_KEY` is exported for the sidebar's toggle. Reading or writing it stays this
 * module's business.
 */
export const SETTINGS_KEY = 'folder_page_settings'

/** A column the folder page declares — this module's own vocabulary, shaped like `PropertyDecl`. */
export type ColumnDecl = PropertyDecl

export interface FolderPageSettings {
  columns: Record<string, ColumnDecl>
  /** The parking bin for new members — undefined when absent OR unusable at rest. */
  folder?: string
  /** View NAME a fresh open starts on (YAZ-1104) — undefined (or a stale name) means the first view. */
  defaultView?: string
  /**
   * The page's named formulas, `ViewSet.formulas` verbatim (YAZ-745): a `formula.<name>` key is a
   * column, a sort AND a grouping level, so a folder page that declares none can not group on one.
   * Undefined when absent; a non-map, or an entry that is not a string, is a problem and dropped —
   * the expression itself is never parsed here (a bad one is the engine's own reported cell error).
   */
  formulas?: Record<string, string>
  /** Never empty: `DEFAULT_VIEWS` when the key declares none usable. `ViewDef` verbatim. */
  views: ViewDef[]
  /** Human one-liners a surface can show. Never thrown, never written back. */
  problems: string[]
}

/** 🔒 Q7 (YAZ-815, amended YAZ-935): a folder page always has its three skins, OUTLINE FIRST. */
export const DEFAULT_VIEWS: readonly ViewDef[] = [
  { type: 'outline', name: 'Outline' },
  { type: 'table', name: 'Table' },
  { type: 'board', name: 'Board' },
]

const KINDS = new Set<string>(PROPERTY_KINDS)

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)

/** A fresh copy per read: the defaults are handed out to be edited and written back. */
const defaultViews = (): ViewDef[] => DEFAULT_VIEWS.map((view) => ({ ...view }))

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
    if (value.options !== undefined) {
      const options = readPropertyOptions(value.options)
      if (options !== undefined) column.options = options
      if (!validPropertyOptions(value.options)) problems.push(`${SETTINGS_KEY}.columns.${name}.options must be a list of unique non-empty labels — ignoring invalid entries`)
    }
    if (value.optionSort !== undefined) {
      if (validPropertyOptionSort(value.optionSort)) column.optionSort = value.optionSort
      else problems.push(`${SETTINGS_KEY}.columns.${name}.optionSort must be manual, ascending, or descending — using manual order`)
    }
    columns[name] = column
  }
  return columns
}

/** parseViews's view assertion (`views/viewSchema.ts`), mirrored — but a bad entry is dropped, never thrown. */
function readViews(raw: unknown, problems: string[]): ViewDef[] {
  if (raw === undefined) return defaultViews()
  if (!Array.isArray(raw)) {
    problems.push(`${SETTINGS_KEY}.views must be a list of views — using the default views`)
    return defaultViews()
  }
  const views: ViewDef[] = []
  raw.forEach((view: unknown, i) => {
    if (!isRecord(view) || typeof view.type !== 'string' || typeof view.name !== 'string') {
      problems.push(`${SETTINGS_KEY}.views[${i}] must be a map with a type and a name — skipping it`)
      return
    }
    if (view.outline !== undefined && typeof view.outline !== 'string') {
      problems.push(`${SETTINGS_KEY}.views[${i}].outline must be one markdown bullet list — ignoring it`)
      const { outline: _dropped, ...rest } = view
      views.push(rest as ViewDef)
      return
    }
    // Unknown view types and extra keys ride along untouched (`ViewDef`'s index signature).
    views.push(view as ViewDef)
  })
  if (views.length === 0) return defaultViews()
  // 🔒 YAZ-935: every folder page has a Board skin. Lists persisted before Board existed gain one
  // at READ time — never a file backfill; a later config write may persist it, harmlessly.
  if (!views.some((v) => v.type === 'board')) views.push({ type: 'board', name: 'Board' })
  return views
}

/** `name → expression`, tolerant like the rest: a bad map is absent, a bad entry is dropped. */
function readFormulas(raw: unknown, problems: string[]): Record<string, string> | undefined {
  if (raw === undefined) return undefined
  if (!isRecord(raw)) {
    problems.push(`${SETTINGS_KEY}.formulas must be a map of named expressions — ignoring it`)
    return undefined
  }
  const formulas: Record<string, string> = {}
  for (const [name, expr] of Object.entries(raw)) {
    if (typeof expr === 'string') formulas[name] = expr
    else problems.push(`${SETTINGS_KEY}.formulas.${name} must be an expression — ignoring that formula`)
  }
  return formulas
}

/** The shared folder grammar, and its rule: unusable at rest reads as absent. */
function readFolder(raw: unknown, problems: string[]): string | undefined {
  if (raw === undefined) return undefined
  if (typeof raw === 'string' && FOLDER_NAME.test(raw)) return raw
  problems.push(`${SETTINGS_KEY}.folder must be a root-relative folder name — ignoring it`)
  return undefined
}

/** The saved starting view's NAME. Any string reads verbatim — staleness is the pane's concern. */
function readDefaultView(raw: unknown, problems: string[]): string | undefined {
  if (raw === undefined) return undefined
  if (typeof raw === 'string') return raw
  problems.push(`${SETTINGS_KEY}.defaultView must be a view name — ignoring it`)
  return undefined
}

/** One folder page's config, as read off its frontmatter. Safe on ANY record, flagged or not. */
export function folderPageSettings(record: IndexRecord): FolderPageSettings {
  return folderPageSettingsOf(record.properties)
}

/** The same read over bare frontmatter properties — for a caller holding the FILE's own bytes
    rather than an index record (YAZ-919: the open page's seed outranks the snapshot). */
export function folderPageSettingsOf(properties: Record<string, unknown>): FolderPageSettings {
  const raw = properties[SETTINGS_KEY]
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
    defaultView: readDefaultView(raw.defaultView, problems),
    formulas: readFormulas(raw.formulas, problems),
    views: readViews(raw.views, problems),
    problems,
  }
}

/**
 * WHERE LINKS LIVE inside the one key, and the ONE place that knows it (YAZ-864). A rename has to
 * walk INTO `folder_page_settings` — the one reserved key with app-defined link semantics (🔒 Q1) —
 * and the rule that no surface re-parses that key holds for the rename engine too: it comes through
 * here, and the key STRING rides back in the result rather than being spelled anywhere else.
 *
 * The link-bearing leaves are exactly three: every view's [D5] `order` entry (🔒 Q3), every
 * outline LINE that is exactly a wikilink (🔒 D2, YAZ-900 — the line rule stays `outlineDoc`'s,
 * never re-spelled here) and every column's belongs-to `target` (🔒 Q2) — the places this module's
 * vocabulary spells a wikilink. Each string leaf is offered to `map`; `undefined` means LEAVE IT,
 * and a wikilink sitting inside an outline line's PROSE is not a leaf at all. Everything else in the
 * value — unknown view types, extra keys, `folder`, unusable shapes — rides along verbatim.
 *
 * Deliberately over the RAW value, not the tolerant read: `folderPageSettings()` normalises and
 * DROPS what it cannot use, so a rewrite built on it would quietly delete a hand-written shape,
 * and a probe built on it would disagree with the rewrite about which leaves even exist. Null when
 * no leaf changed, so a page with settings but no reference is never written at all.
 */
export function mapFolderPageSettingsLinks(
  properties: Record<string, unknown>,
  map: (link: string) => string | undefined,
): { key: string; value: unknown } | null {
  const raw = properties[SETTINGS_KEY]
  if (!isRecord(raw)) return null
  let changed = false
  const mapLink = (link: unknown): unknown => {
    const next = typeof link === 'string' ? map(link) : undefined
    if (next === undefined) return link
    changed = true
    return next
  }
  // Spread-then-reassign, so every untouched key keeps its value AND its position.
  const value: Record<string, unknown> = { ...raw }
  if (Array.isArray(raw.views)) {
    value.views = raw.views.map((view: unknown) => {
      if (!isRecord(view)) return view
      const next: Record<string, unknown> = { ...view }
      if (Array.isArray(view.order)) next.order = view.order.map(mapLink)
      if (typeof view.outline === 'string') {
        const outline = mapOutlineLinks(view.outline, map)
        if (outline !== undefined) {
          changed = true
          next.outline = outline
        }
      }
      return next
    })
  }
  if (isRecord(raw.columns)) {
    const columns: Record<string, unknown> = {}
    for (const [name, column] of Object.entries(raw.columns)) {
      columns[name] = isRecord(column) && 'target' in column ? { ...column, target: mapLink(column.target) } : column
    }
    value.columns = columns
  }
  return changed ? { key: SETTINGS_KEY, value } : null
}

/** The same leaves for a caller that only needs to LOOK — verbatim, in walk order (YAZ-864). */
export function folderPageSettingsLinks(properties: Record<string, unknown>): string[] {
  const links: string[] = []
  mapFolderPageSettingsLinks(properties, (link) => {
    links.push(link)
    return undefined
  })
  return links
}

/**
 * One folder page's declaration for a key — VIEW-SCOPED (🔒 Q8, YAZ-815): two folder pages may
 * declare the same card key with different kinds and NEITHER wins globally; the caller asks the
 * folder page whose view it is rendering, and no conflict resolver exists anywhere.
 */
export function columnKindIn(settings: FolderPageSettings, key: string): ColumnDecl | null {
  return settings.columns[key] ?? null
}

/**
 * The FIRST outline view's member sequence, as raw wikilink strings, or []. An EDITED outline
 * holds the sequence as its DOCUMENT (🔒 D2 — `order` retired with the first edit, YAZ-903), so
 * the link lines are read in document order; a never-edited page still answers from `order`.
 * One rule, both readers: the outline skin and the Topics tree cannot drift apart (YAZ-905 —
 * the seam YAZ-904 found). Non-strings are ignored — nothing here is trusted.
 */
export function outlineOrderOf(settings: FolderPageSettings): string[] {
  const view = settings.views.find((v) => v.type === 'outline')
  if (typeof view?.outline === 'string')
    return parseOutline(view.outline)
      .map((line) => line.text)
      .filter(isExactWikilink)
  return Array.isArray(view?.order) ? view.order.filter((entry: unknown): entry is string => typeof entry === 'string') : []
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
  if (settings.defaultView !== undefined) out.defaultView = settings.defaultView
  if (settings.formulas !== undefined) out.formulas = settings.formulas
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


/**
 * Edit one definition against fresh file bytes. The captured parsed declaration is the conflict
 * boundary: concurrent changes to other columns/views are retained, while a changed definition
 * asks the user to reopen its settings. transformFile repeats this check after an mtime retry.
 */
export function writeFolderColumn(path: string, key: string, next: PropertyDecl, base: PropertyDecl | undefined): Promise<{ mtime: number }> {
  const problems: string[] = []
  const replacement = readColumns({ column: next }, problems).column
  if (!replacement || problems.length) return Promise.reject(new Error(problems[0] ?? 'Invalid property definition'))
  const normalize = (decl: unknown) => decl === undefined ? undefined : readColumns({ column: decl }, []).column
  const expected = JSON.stringify(normalize(base))
  const desired = JSON.stringify(replacement)
  return transformFile(path, content => {
    const parsed = parseFrontmatter(splitFrontmatter(content).frontmatter)
    if (parsed.error) throw new FrontmatterWriteError(parsed.error)
    const settings = parsed.properties[SETTINGS_KEY]
    if (settings != null && !isRecord(settings)) throw new Error('Folder page settings must be a map before editing properties.')
    const raw = settings ?? {}
    if (raw.columns !== undefined && !isRecord(raw.columns)) throw new Error('Folder page columns must be a map before editing properties.')
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
    for (const field of ['kind', 'target', 'required', 'options', 'optionSort']) delete declaration[field]
    Object.assign(declaration, replacement)
    return setFrontmatterProperty(content, SETTINGS_KEY, { ...raw, columns: { ...columns, [key]: declaration } })
  })
}
