/**
 * Pure logic behind the sidebar's "New note" / "New base" / "New folder" flow (GRO-2022, GRO-2126):
 * name validation, target-directory resolution, and final path building.
 * The UI (context menu + inline input) lives in Sidebar/Tree; the server
 * enforces the same rules again (absolute path, vault extension, no overwrite).
 */
import type { TreeNode } from '@shared/types'

/** What the inline input creates: a markdown note, a folder, or an Obsidian `.base` file (GRO-2126). */
export type EntryKind = 'file' | 'dir' | 'base'

/** Human-readable reason the name is unusable, or null when fine. Callers trim first via entryPath. */
export function validateEntryName(name: string): string | null {
  const trimmed = name.trim()
  if (trimmed.includes('/')) return 'Name cannot contain "/"'
  if (trimmed.includes('\0')) return 'Name contains an invalid character'
  if (trimmed.startsWith('.')) return 'Names starting with "." are hidden'
  return null
}

/** Absolute path for the new entry; notes get `.md` unless already markdown, bases `.base` unless already present. */
export function entryPath(parentDir: string, name: string, kind: EntryKind): string {
  let final = name.trim()
  if (kind === 'file' && !/\.(md|markdown)$/i.test(final)) final += '.md'
  else if (kind === 'base' && !/\.base$/i.test(final)) final += '.base'
  return `${parentDir}/${final}`
}

/** Where a right-click creates: a dir row → itself, a file row → its parent, blank space → the root. */
export function targetDirFor(node: TreeNode | null, root: string): string {
  if (node === null) return root
  if (node.type === 'dir') return node.path
  return node.path.slice(0, node.path.lastIndexOf('/'))
}
