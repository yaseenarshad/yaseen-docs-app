/**
 * Pure logic behind the sidebar's "New note" / "New base" / "New folder" flow (GRO-2022, GRO-2126):
 * name validation, target-directory resolution, and final path building.
 * The UI (context menu + inline input) lives in Sidebar/Tree; the main process
 * enforces the same rules again (absolute path, vault extension, no overwrite).
 */
import type { TreeNode } from '@shared/types'

/**
 * What the inline input creates: a markdown note, a folder, an Obsidian `.base` file (GRO-2126),
 * or a FOLDER PAGE (🔒 D4, YAZ-841) — a note like any other, born carrying `folder_page: true`
 * and nothing else (🔒 D1). It is a fourth KIND rather than a flag beside `file` so the one
 * difference — the seed — stays at the end of the flow while every shared rule above it
 * (validation, target dir, the `.md` extension) is literally the same code.
 */
export type EntryKind = 'file' | 'dir' | 'base' | 'folderPage'

/** Human-readable reason the name is unusable, or null when fine. Callers trim first via entryPath. */
export function validateEntryName(name: string): string | null {
  const trimmed = name.trim()
  if (trimmed.includes('/')) return 'Name cannot contain "/"'
  if (trimmed.includes('\0')) return 'Name contains an invalid character'
  if (trimmed.startsWith('.')) return 'Names starting with "." are hidden'
  return null
}

/** Absolute path for the new entry; notes (folder pages included) get `.md` unless already markdown, bases `.base` unless already present. */
export function entryPath(parentDir: string, name: string, kind: EntryKind): string {
  let final = name.trim()
  if ((kind === 'file' || kind === 'folderPage') && !/\.(md|markdown)$/i.test(final)) final += '.md'
  else if (kind === 'base' && !/\.base$/i.test(final)) final += '.base'
  return `${parentDir}/${final}`
}

/** Where a right-click creates: a dir row → itself, a file row → its parent, blank space → the root. */
export function targetDirFor(node: TreeNode | null, root: string): string {
  if (node === null) return root
  if (node.type === 'dir') return node.path
  return node.path.slice(0, node.path.lastIndexOf('/'))
}

/**
 * Absolute path for the sidebar's inline rename (Links E1, GRO-2194; folders E1b, GRO-2241):
 * same parent directory. For a FILE, `entryPath`'s extension re-append idiom against the OLD
 * file's kind — a typed extension of the same kind is kept, anything else gets the old
 * file's own extension appended. For a DIRECTORY there is no extension logic at all.
 */
export function renamedPath(oldPath: string, newName: string, kind: 'file' | 'dir' = 'file'): string {
  const dir = oldPath.slice(0, oldPath.lastIndexOf('/'))
  let final = newName.trim()
  if (kind === 'dir') return `${dir}/${final}`
  if (/\.base$/i.test(oldPath)) {
    if (!/\.base$/i.test(final)) final += '.base'
  } else if (!/\.(md|markdown)$/i.test(final)) {
    final += oldPath.slice(oldPath.lastIndexOf('.'))
  }
  return `${dir}/${final}`
}
