/**
 * The eager half of the "folder of <vault>" box (YAZ-4922 D3, D4; `FolderHomeSheet.tsx`, a lazy chunk): App asks it at
 * each picked folder, before the box loads. Its own module, so the box stays a lazy chunk (YAZ-4955).
 */
import { stripSlash, type FolderState, type VaultEntry } from '@shared/types'

/**
 * The vault the app knows that holds `path`, the deepest one (`listVaults`' rows); undefined where none does, or
 * where `path` is a folder of a vault already — it opens as it is. A folder that was opened as its own vault before
 * is asked again: it sits inside another vault. A folder of a vault is no vault: nothing is inside it.
 */
export function folderHome(path: string, known: readonly Pick<VaultEntry, 'path'>[], folders: Readonly<Record<string, Pick<FolderState, 'in'> | undefined>>): string | undefined {
  const folder = stripSlash(path)
  if (folders[folder]?.in != null) return undefined
  let home: string | undefined
  for (const { path: row } of known) {
    const vault = stripSlash(row)
    if (folders[row]?.in != null || !folder.startsWith(`${vault}/`)) continue
    if (home === undefined || vault.length > home.length) home = vault
  }
  return home
}
