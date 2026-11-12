/**
 * "A FOLDER OF <VAULT>" OR ITS OWN VAULT (YAZ-4922 🔒 D3, D4). A folder picked with Open folder… (⌘O's panel, the File
 * menu, Welcome) that sits inside a vault the app knows asks ONE box first: open it as a folder of that vault — the
 * first answer, with the focus — as its own vault, or not at all. A folder of a vault keeps the vault's IDs, links,
 * sync and `.yaseendocs`; its own vault would give the notes IDs of its own, the trouble of gaps 1 to 3.
 */
import { stripSlash, type FolderState, type VaultEntry } from '@shared/types'
import { ConfirmSheet } from '../components/ConfirmSheet'

/** What the box answers: a folder of the vault, its own vault, or null for Cancel. */
export type FolderHomeAnswer = 'folder' | 'vault' | null

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

export function FolderHomeSheet({ folder, vault, onAnswer }: { folder: string; vault: string; onAnswer: (answer: FolderHomeAnswer) => void }) {
  return (
    <ConfirmSheet
      labelId="confirm-folder-home-text"
      text={`This folder is inside ${vault}. Open it as a folder of ${vault}?`}
      confirmLabel={`Open as a folder of ${vault}`}
      focusConfirm
      onConfirm={() => onAnswer('folder')}
      onCancel={() => onAnswer(null)}
      other={
        <button type="button" className="confirm__btn confirm__btn--other" onClick={() => onAnswer('vault')} title={`${folder} gets its own IDs, links and settings.`}>
          Open as its own vault
        </button>
      }
    />
  )
}

export default FolderHomeSheet
