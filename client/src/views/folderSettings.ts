/**
 * A folder's settings (YAZ-830, YAZ-2290 D1): THE one door to the key `folder_settings` of
 * its `.folder.md`. Every surface reads a folder's config through `folderSettings()` and every
 * edit goes back through `writeFolderSettings()` — no surface re-parses that key itself (locked).
 * The tolerant parse itself is `@shared/folderSettings`, which the CLI's folder commands share (YAZ-4518).
 */
import { FrontmatterWriteError, parseFrontmatter, setFrontmatterProperty, splitFrontmatter } from '@shared/frontmatter'
import type { IndexRecord, PropertyDecl } from '@shared/types'
import { isRecord } from '@shared/guards'
// The one reserved key this module owns, and where links live inside it (YAZ-864): both are in
// `@shared/folderSettingsLinks`, so the main process's ID rewrite walks the same leaves (YAZ-2677).
import { FOLDER_SETTINGS_KEY } from '@shared/folderSettingsLinks'
import { folderSettingsOf, folderSettingsValue, readColumns, type FolderSettings } from '@shared/folderSettings'
import { transformFile, writeProperty } from './writeProperty'

export { DEFAULT_COLUMNS, DEFAULT_VIEWS, type ColumnDecl, type FolderSettings } from '@shared/folderSettings'

/** Whether the folder SAVED settings: its `.folder.md` holds the key with a value. */
export const hasFolderSettings = (record: IndexRecord | undefined): boolean => record?.properties[FOLDER_SETTINGS_KEY] != null

/** A FOLDER's settings (YAZ-2290 D1/E2), off its `.folder.md` record: the shared parse (`folderSettingsOf`). */
export const folderSettings = (record: IndexRecord | undefined, ids: boolean): FolderSettings => folderSettingsOf(record?.properties, ids)

/**
 * Write the whole block back as the ONE key, through the shared one-key card writer
 * (`writeProperty` — its read → rewrite → `expectedMtime` → retry-once dance is reused, never
 * duplicated). EXACTLY what the caller passes is written: `undefined` deletes the key and an
 * all-default value is still a value, because a delete is the caller's explicit choice and never
 * this module's inference.
 */
export function writeFolderSettings(
  path: string,
  next: FolderSettings | undefined,
): Promise<{ mtime: number }> {
  return writeProperty(path, FOLDER_SETTINGS_KEY, next === undefined ? undefined : folderSettingsValue(next))
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
    const raw = settings ?? { columns: folderSettingsOf(undefined, ids).columns }
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
    for (const field of ['kind', 'target', 'required', 'options', 'optionSort']) delete declaration[field]
    Object.assign(declaration, replacement)
    return setFrontmatterProperty(content, FOLDER_SETTINGS_KEY, { ...raw, columns: { ...columns, [key]: declaration } })
  })
}
