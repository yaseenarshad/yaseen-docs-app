import type { IndexRecord, SettingsState } from '@shared/types'
import { absFrom } from '../lib/paths'

/**
 * Settings › Folder pages › "Show folder page files" (YAZ-4587, D37): off by default. Read through this one function so
 * the key has one reader here; `settings.folderPages` is the Settings › Folder pages group (10A).
 */
export function showFolderPageFiles(settings: SettingsState): boolean {
  return settings.folderPages.showFolderPageFiles
}

/**
 * The folders whose page file the sidebar lists as a row (YAZ-4587, D37), by absolute path: each folder with a
 * `.folder.md` record, where the nearest `show_page_file: true | false` at or above it says so — that folder's own,
 * else its parent's, up to the vault root's — and where none does, the global switch. Another value is no rule.
 * The vault root's own page file (YAZ-4921) is in the set by the same rule, as the root's bare path: the Files tree
 * draws it first at its top level. One pass over the records, per index snapshot.
 */
export function folderPageRows(root: string, folders: readonly IndexRecord[], globalOn: boolean): Set<string> {
  const rules = new Map<string, boolean>()
  for (const record of folders) {
    const rule = record.properties.show_page_file
    if (typeof rule === 'boolean') rules.set(record.folder, rule)
  }
  const rows = new Set<string>()
  for (const { folder } of folders) {
    let at = folder
    let shown = globalOn
    for (;;) {
      const rule = rules.get(at)
      if (rule !== undefined) {
        shown = rule
        break
      }
      if (at === '') break
      const cut = at.lastIndexOf('/')
      at = cut === -1 ? '' : at.slice(0, cut)
    }
    if (shown) rows.add(absFrom(root, folder))
  }
  return rows
}
