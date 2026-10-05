/**
 * Pure logic behind the sidebar's "New note" / "New folder" flow (GRO-2022):
 * name validation, target-directory resolution, and final path building.
 * The UI (context menu + inline input) lives in Sidebar/Tree; the main process
 * enforces the same rules again (absolute path, vault extension, no overwrite).
 */
import { fileKind } from '@shared/fileKind'
import { basename, dirname } from '../lib/paths'

/** What the inline input creates: a markdown note or a folder. */
export type EntryKind = 'file' | 'dir'

/** Human-readable reason the name is unusable, or null when fine. */
export function validateEntryName(name: string): string | null {
  const trimmed = name.trim()
  if (trimmed.includes('/')) return 'Name cannot contain "/"'
  if (trimmed.includes('\0')) return 'Name contains an invalid character'
  if (trimmed.startsWith('.')) return 'Names starting with "." are hidden'
  return null
}

/** Seed for "New dated folder" (YAZ-1604) and "New dated note" (YAZ-2242): `09_14- ` — today's MM_DD, then `- ` so the title lands one space after the dash. */
export function datedSeed(now: Date = new Date()): string {
  const p = (n: number) => String(n).padStart(2, '0')
  return `${p(now.getMonth() + 1)}_${p(now.getDate())}- `
}

/**
 * The least a right-clicked row has to say for the menu to target it: its KIND and its path.
 * A `TreeNode` satisfies it structurally, and so does a search row (YAZ-2050), which is
 * why the rule below asks for this and not for a whole tree node it would never read.
 */
export interface MenuRow {
  type: 'file' | 'dir'
  path: string
  /** A SHORTCUT row only (YAZ-2290 D2): the folder the row stands in — `path` is the note where it lives. */
  shortcutIn?: string
}

/** Where a right-click creates: a dir row → itself, a file row → its parent (a shortcut row → the folder it stands in), blank space → the root. */
export function targetDirFor(node: MenuRow | null, root: string): string {
  if (node === null) return root
  if (node.type === 'dir') return node.path
  if (node.shortcutIn !== undefined) return node.shortcutIn
  return dirname(node.path)
}

/**
 * Absolute path for the sidebar's inline rename of a view-only FILE (Links E1, GRO-2194): same
 * parent directory. An explicit supported suffix is kept as typed; the old exact suffix is
 * appended only when none is recognized. A note or a folder is retitled instead (YAZ-2420 🔒 D16),
 * except in a vault that does not use IDs (YAZ-2523 🔒 V3): there its name is what was typed too,
 * a note by the same rule and a folder with no suffix added.
 */
export function renamedPath(oldPath: string, newName: string, kind: 'file' | 'dir' = 'file'): string {
  let final = newName.trim()
  if (final === basename(oldPath)) return oldPath
  if (kind === 'file' && fileKind(final) === null) final += oldPath.slice(oldPath.lastIndexOf('.'))
  return `${dirname(oldPath)}/${final}`
}
