/**
 * A folder's settings (YAZ-830, YAZ-2290 D1): the writes of the key `folder_settings`. The read half (the tolerant
 * parser, `folderSettings()`) is `folderSettingsRead.ts` (YAZ-5460: the phone reads it with no bridge), re-exported here.
 */
import { FrontmatterWriteError, parseFrontmatter, setFrontmatterProperty, splitFrontmatter } from '@shared/frontmatter'
import { findKey } from '@shared/propertyKeys'
import { isRecord } from '@shared/guards'
import { FOLDER_SETTINGS_KEY, OTHER_FILES_KEEP_PAGES_KEY, OTHER_FILES_KEY } from '@shared/folderSettingsLinks'
import type { IndexRecord } from '@shared/types'
import { transformFile, writeProperty } from './writeProperty'
import { folderSettings, readColumns, type ColumnDecl, type FolderSettings } from './folderSettingsRead'

export * from './folderSettingsRead'
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
  if (settings.otherFilesKeepPages !== undefined && settings.otherFilesKeepPages.length > 0) out[OTHER_FILES_KEEP_PAGES_KEY] = settings.otherFilesKeepPages
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

/** A list of unique plain values (the shown columns `order`): each value is its own name; else null. */
function valuesOf(list: readonly unknown[]): string[] | null {
  const names = list.map((entry) => (typeof entry === 'string' ? entry : null))
  return names.every((n): n is string => n !== null) && new Set(names).size === names.length ? names : null
}

/**
 * Two lists that both moved, merged element by element (YAZ-4637 M3): the other side's list and order, less the
 * entries this side removed, plus the entries it added — each after the nearest entry before it in this side's list
 * that is still there — and each entry on all three sides `merge`d. So an Undo of "hide A" after "hide B" shows A
 * alone, at its old place where it can, and two windows that each hid a column end with both hidden.
 */
function mergeLists(base: readonly unknown[], mine: readonly unknown[], theirs: readonly unknown[], b: string[], m: string[], t: string[], merge: (atBase: unknown, atMine: unknown, atTheirs: unknown) => unknown): unknown[] {
  const removed = (name: string) => b.includes(name) && !m.includes(name)
  const out = theirs.filter((_, i) => !removed(t[i]))
  const outNames = t.filter((name) => !removed(name))
  m.forEach((name, i) => {
    if (b.includes(name) || t.includes(name)) return
    let after = -1
    for (let j = i - 1; j >= 0 && after === -1; j--) after = outNames.indexOf(m[j])
    out.splice(after + 1, 0, mine[i])
    outNames.splice(after + 1, 0, name)
  })
  return out.map((entry, i) => {
    const name = outNames[i]
    if (!b.includes(name) || !m.includes(name) || !t.includes(name)) return entry
    return merge(base[b.indexOf(name)], mine[m.indexOf(name)], entry)
  })
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
      // Both sides changed the names (YAZ-4637 M3): element by element, each shared view merged.
      return mergeLists(base, mine, theirs, b, m, t, rebaseSettings)
    }
    // A list of plain values both sides changed (M3): the shown columns — element by element, never the whole list.
    const [vb, vm, vt] = [valuesOf(base), valuesOf(mine), valuesOf(theirs)]
    if (vb !== null && vm !== null && vt !== null) return mergeLists(base, mine, theirs, vb, vm, vt, (_, __, entry) => entry)
  }
  return mine
}


/**
 * Edit one definition against fresh file bytes. The captured parsed declaration is the conflict
 * boundary: concurrent changes to other columns/views are retained, while a changed definition
 * asks the user to reopen its settings. transformFile repeats this check after an mtime retry.
 */
export function writeFolderColumn(path: string, key: string, next: ColumnDecl, base: ColumnDecl | undefined, ids: boolean, views?: (views: unknown) => unknown): Promise<{ mtime: number }> {
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
    // Nothing saved yet (YAZ-2290 E2): a folder starts with no columns (YAZ-4713 C5).
    const raw: Record<string, unknown> = settings ?? {}
    if (raw.columns !== undefined && !isRecord(raw.columns)) throw new Error('Folder columns must be a map before editing properties.')
    const columns = raw.columns ?? {}
    const current = Object.prototype.hasOwnProperty.call(columns, key) ? columns[key] : undefined
    const currentProblems: string[] = []
    const currentDefinition = current === undefined ? undefined : readColumns({ column: current }, currentProblems).column
    if (current !== undefined && (!isRecord(current) || !currentDefinition || currentProblems.length)) throw new Error(`Property “${key}” has an invalid definition. Repair its YAML before editing it.`)
    const currentKnown = JSON.stringify(currentDefinition)
    if (currentKnown !== expected) throw new Error(`Property “${key}” changed since these settings were opened. Reopen the property and try again.`)
    // The views ride in the same write when the caller edits them too (YAZ-4637 M5: an option rename's filters); the same list means no change.
    const nextViews = views === undefined || raw.views === undefined ? raw.views : views(raw.views)
    if (currentKnown === desired && nextViews === raw.views) return content
    const declaration = { ...current }
    // Removing a known optional setting is intentional; unknown extension metadata survives.
    for (const field of ['kind', 'target', 'required', 'options', 'optionSort', 'description', 'format', 'from', 'separate', 'pair', 'parent', 'size', 'shape']) delete declaration[field]
    Object.assign(declaration, replacement)
    return setFrontmatterProperty(content, FOLDER_SETTINGS_KEY, { ...raw, columns: { ...columns, [key]: declaration }, ...(nextViews === undefined ? {} : { views: nextViews }) })
  })
}

/**
 * Take one column's declaration off a folder (YAZ-4769, Edit property's "Column on"): the pages keep their values; only
 * the folder's definition goes. `base` is the declaration the caller saw (a change since then refuses, as
 * `writeFolderColumn` does); `null` takes it off whatever it is (an Undo that runs later). No declaration: no change.
 */
export function removeFolderColumn(path: string, key: string, base: ColumnDecl | undefined | null): Promise<{ mtime: number }> {
  const normalize = (decl: unknown) => decl === undefined ? undefined : readColumns({ column: decl }, []).column
  return transformFile(path, content => {
    const parsed = parseFrontmatter(splitFrontmatter(content).frontmatter)
    if (parsed.error) throw new FrontmatterWriteError(parsed.error)
    const raw = parsed.properties[FOLDER_SETTINGS_KEY]
    if (!isRecord(raw) || !isRecord(raw.columns) || !Object.prototype.hasOwnProperty.call(raw.columns, key)) return content
    if (base !== null && JSON.stringify(normalize(raw.columns[key])) !== JSON.stringify(normalize(base))) throw new Error(`Property “${key}” changed since these settings were opened. Reopen the property and try again.`)
    const { [key]: _gone, ...columns } = raw.columns
    return setFrontmatterProperty(content, FOLDER_SETTINGS_KEY, { ...raw, columns })
  })
}

/**
 * Put one column's declaration back on a folder at its old place (YAZ-4769, a move's Undo): before `before` (the column
 * that followed it), or last when that one is gone. A folder that has the column already is left as it is.
 */
export function insertFolderColumn(path: string, key: string, decl: ColumnDecl, before: string | null): Promise<{ mtime: number }> {
  return transformFile(path, content => {
    const parsed = parseFrontmatter(splitFrontmatter(content).frontmatter)
    if (parsed.error) throw new FrontmatterWriteError(parsed.error)
    const raw = parsed.properties[FOLDER_SETTINGS_KEY]
    const settings: Record<string, unknown> = isRecord(raw) ? raw : {}
    const columns: Record<string, unknown> = isRecord(settings.columns) ? settings.columns : {}
    if (Object.prototype.hasOwnProperty.call(columns, key)) return content
    const entries = Object.entries(columns)
    const at = before === null ? -1 : entries.findIndex(([k]) => k === before)
    entries.splice(at < 0 ? entries.length : at, 0, [key, decl])
    return setFrontmatterProperty(content, FOLDER_SETTINGS_KEY, { ...settings, columns: Object.fromEntries(entries) })
  })
}

/**
 * Move one column's definition between two folders' `.folder.md`s (YAZ-4769): declare it on `to` first, then take it
 * off `from`, so no moment has it nowhere. `null` on either side: only the other write (make a column, or remove one).
 * The pages' values never change. Resolves with the Undo, which puts both files back, the column at its old place on
 * `from`. The caller checks read-only pages first.
 */
export async function moveFolderColumn({ key, decl, from, to, ids }: {
  key: string
  decl: ColumnDecl
  from: { path: string; columns: Record<string, ColumnDecl> } | null
  to: { path: string; columns: Record<string, ColumnDecl> } | null
  ids: boolean
}): Promise<() => Promise<void>> {
  // YAZ-4769 (one key, capitals ignored): a folder that declares the key in other capitals declares THIS column; the
  // move writes over that declaration under its spelling, and never puts a second spelling beside it.
  const toKey = to === null ? key : findKey(Object.keys(to.columns), key) ?? key
  const atTo = to?.columns[toKey]
  const atFrom = from?.columns[key]
  // The column after it on `from`: the Undo puts it back in its place, so a view in the folder's own order keeps it.
  const order = from === null ? [] : Object.keys(from.columns)
  const after = order[order.indexOf(key) + 1] ?? null
  if (to !== null) await writeFolderColumn(to.path, toKey, decl, atTo, ids)
  if (from !== null) await removeFolderColumn(from.path, key, atFrom)
  return async () => {
    if (from !== null && atFrom !== undefined) await insertFolderColumn(from.path, key, atFrom, after)
    if (to !== null) {
      if (atTo === undefined) await removeFolderColumn(to.path, toKey, null)
      else await writeFolderColumn(to.path, toKey, atTo, decl, ids)
    }
  }
}

/**
 * Another folder's views and labels, rewritten against fresh bytes (YAZ-4713 C6, C7): `edit` gets the stored `views`
 * and `properties` and hands back the ones to store (`undefined` removes the key). Nothing else in the file moves, and
 * the same bytes come back when `edit` changes nothing. Resolves with what the file held before, for an Undo.
 */
export async function rewriteFolderViews(path: string, edit: (views: unknown, properties: unknown) => { views: unknown; properties: unknown }): Promise<{ views: unknown; properties: unknown }> {
  let before: { views: unknown; properties: unknown } = { views: undefined, properties: undefined }
  await transformFile(path, (content) => {
    const parsed = parseFrontmatter(splitFrontmatter(content).frontmatter)
    if (parsed.error) throw new FrontmatterWriteError(parsed.error)
    const raw = parsed.properties[FOLDER_SETTINGS_KEY]
    if (!isRecord(raw)) return content
    before = { views: raw.views, properties: raw.properties }
    const next = edit(raw.views, raw.properties)
    if (sameValue(next.views, raw.views) && sameValue(next.properties, raw.properties)) return content
    const out: Record<string, unknown> = { ...raw, views: next.views, properties: next.properties }
    for (const key of ['views', 'properties']) if (out[key] === undefined) delete out[key]
    return setFrontmatterProperty(content, FOLDER_SETTINGS_KEY, out)
  }, true)
  return before
}
