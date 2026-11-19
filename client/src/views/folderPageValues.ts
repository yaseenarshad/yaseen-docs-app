/**
 * A FOLDER PAGE'S ROWS AS ITS VIEWS READ THEM, pure (YAZ-5460): the Mac's `FolderView` and the phone's folder page both
 * build them here, so the phone shows each value as the Mac does. No bridge, no React.
 */
import { isCardMark } from '@shared/cardFileFormat'
import { folderValues } from '@shared/folderValues'
import { heldKey, keyFold, respell } from '@shared/propertyKeys'
import { READ_ONLY_KEY } from '@shared/readOnly'
import { inFolder, type IndexRecord } from '@shared/types'
import { folderName, type FolderMap } from './columnInheritance'
import type { RunOptions } from './engine'
import { folderSettings, type ColumnDecl } from './folderSettingsRead'

/** A row's values with each tied column's links on it (YAZ-4781 R2); the same object when the page has none. */
export function withTied(properties: Record<string, unknown>, row: IndexRecord, tied: RunOptions['mentions']): Record<string, unknown> {
  if (tied === undefined) return properties
  const out = { ...properties }
  for (const key of tied.keys) out[key] = tied.of(row, key)
  return out
}

/**
 * A row's values as the views read them (YAZ-4713 C1/C3): its file's own fields less the keys no column may have
 * (`columnReservedKeys`: the app's, and a subfolder row's settings block, D31) and a card file's `kind: card` mark (YAZ-5850) — but the read-only switch, which a view
 * may still show (YAZ-3130) — and each separate column's value from this page's block. The same object when nothing changes.
 *
 * YAZ-4769 (one key, capitals ignored): each field whose key is a page column's in other capitals reads under the
 * column's spelling (`spell`, `respell`): a page's `dessert column` is the `Dessert Column` cell, so every view, filter,
 * sort, group, board and calendar reads it with no fold of its own. A page holding two spellings shows the column's;
 * the other stays in the file, and is no second column. The app's keys are never moved. A separate value is found in
 * the page's block in any capitals too.
 */
export function rowValues(properties: Record<string, unknown>, reserved: ReadonlySet<string>, pageId: string | undefined, separate: ReadonlySet<string>, spell: ReadonlyMap<string, string>): Record<string, unknown> {
  const keys = Object.keys(properties)
  // YAZ-5850 root cause: a card file's `kind: card` mark is the app's, but it was no reserved key, so the Pages table showed
  // it as a raw "Kind" column. Solution: drop exactly the mark, as the properties panel hides it (`isCardMark`). The Type
  // column (`file.kind`) shows card files; any other `kind` value is the user's and stays.
  const drop = (key: string): boolean => (reserved.has(key) && key !== READ_ONLY_KEY) || isCardMark(key, properties[key])
  const kept = keys.some(drop) ? Object.fromEntries(keys.filter((key) => !drop(key)).map((key) => [key, properties[key]])) : properties
  const own = respell(kept, spell, reserved)
  if (separate.size === 0) return own
  const block = folderValues(properties, pageId)
  const out = { ...own }
  for (const key of separate) {
    const held = heldKey(block, key)
    if (held !== undefined) out[key] = block[held]
    else delete out[key]
  }
  return out
}

/** Order-insensitive identity for one declaration; a field that is undefined is one that is absent (YAZ-4637 M1), as on disk. */
export const declStamp = (decl: ColumnDecl): string =>
  JSON.stringify(
    Object.entries(decl)
      .filter(([, value]) => value !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : 1)),
  )

/**
 * The keys the subfolders below `folder` define (C11, locked 2026-11-08): the names of the subfolders that define each,
 * and its definition when they all agree.
 */
export function definedBelowOf(folders: readonly IndexRecord[], folderMap: FolderMap, folder: string, ids: boolean, vaultName: string): Record<string, { names: string[]; decl?: ColumnDecl }> {
  const out: Record<string, { names: string[]; decl?: ColumnDecl }> = {}
  const stamps = new Map<string, Set<string>>()
  /** YAZ-4769: one key in any capitals, spelled as the first subfolder (in path order) spells it. */
  const spelled = new Map<string, string>()
  for (const record of [...folders].sort((a, b) => (a.folder < b.folder ? -1 : 1))) {
    if (record.folder === folder || !inFolder(record.folder, folder)) continue
    const name = folderName(folderMap, record.folder, vaultName)
    for (const [declared, { separate: _own, ...decl }] of Object.entries(folderSettings(record, ids).columns)) {
      const fold = keyFold(declared)
      const key = spelled.get(fold) ?? declared
      spelled.set(fold, key)
      const entry = (out[key] ??= { names: [], decl })
      if (!entry.names.includes(name)) entry.names.push(name)
      stamps.set(key, (stamps.get(key) ?? new Set()).add(declStamp(decl)))
    }
  }
  for (const [key, seen] of stamps) if (seen.size > 1) delete out[key].decl
  return out
}
