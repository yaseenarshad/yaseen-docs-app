import type { IndexRecord } from '@shared/types'

/** A folder's name as the Mac's tree and its folder page say it (YAZ-5460): its `.folder.md`'s title, else its last part. */
export function folderTitleOf(folders: readonly IndexRecord[], dir: string): string {
  const own = folders.find((f) => f.folder === dir)?.title.trim()
  return own !== undefined && own !== '' ? own : dir === '' ? 'Vault' : dir.slice(dir.lastIndexOf('/') + 1)
}
