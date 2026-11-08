/**
 * A folder's settings (YAZ-830, YAZ-2290 D1): THE one door to the key `folder_settings` of
 * its `.folder.md`. Every surface reads a folder's config through `folderSettings()` and every
 * edit goes back through `writeFolderSettings()` — no surface re-parses that key itself (locked).
 * The tolerant parse itself is `@shared/folderSettings`, which the CLI's folder commands share (YAZ-4518).
 */
import type { IndexRecord, PropertyDecl } from '@shared/types'
// The one reserved key this module owns, and where links live inside it (YAZ-864): both are in
// `@shared/folderSettingsLinks`, so the main process's ID rewrite walks the same leaves (YAZ-2677).
import { FOLDER_SETTINGS_KEY } from '@shared/folderSettingsLinks'
import { columnChange, folderSettingsOf, folderSettingsValue, type FolderSettings } from '@shared/folderSettings'
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
 * Edit one definition against fresh file bytes (`columnChange`, shared with the CLI, YAZ-4518). The captured
 * parsed declaration is the conflict boundary; transformFile repeats the check after an mtime retry.
 */
export function writeFolderColumn(path: string, key: string, next: PropertyDecl, base: PropertyDecl | undefined, ids: boolean): Promise<{ mtime: number }> {
  let change: (content: string) => string
  try { change = columnChange(key, next, base, ids) } catch (err) { return Promise.reject(err) }
  return transformFile(path, change)
}
