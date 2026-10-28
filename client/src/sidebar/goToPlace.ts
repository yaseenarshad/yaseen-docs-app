/**
 * Where ⌘N's box makes an item and where ⌘D goes (YAZ-3556 D3, D9), read against the tree of one vault. Pure: App
 * hands in the vault and its tree (the sidebar's feed, `latestTree`), and does what the answer says.
 *
 * Both settings hold a path inside the vault ('' = the vault root), as `newNoteFolder` does, so one value works in
 * every vault. A path the vault does not have is said, never guessed: the box goes to the root and says so (D3), ⌘D
 * shows a notice (D9).
 */
import type { GoToPlace, SettingsState, SidebarLens, TreeNode } from '@shared/types'
import { newNoteBase } from '../editor/wikilink/createFromLink'
import { findDirNode, findNode } from '../lib/treeState'

/** The absolute path of `rel` in `vault`: the root for ''. */
export const placePath = (vault: string, rel: string): string => (rel === '' ? vault : `${vault}/${rel}`)

/** `path` inside `vault`, as the settings store it: '' for the root. */
export const placeRel = (vault: string, path: string): string => (path === vault ? '' : path.startsWith(`${vault}/`) ? path.slice(vault.length + 1) : path)

/** What ⌘D does now: show a tab, show a folder or a file, or say that the path is not in the vault. */
export type GoToTarget = { kind: 'tab'; tab: SidebarLens } | { kind: 'folder' | 'file'; path: string } | { kind: 'missing'; rel: string; folder: boolean }

export function resolveGoTo(goTo: GoToPlace, vault: string, tree: readonly TreeNode[]): GoToTarget {
  if (goTo.kind === 'tab') return goTo
  const path = placePath(vault, goTo.path)
  if (goTo.kind === 'folder') return path === vault || findDirNode(tree, path) !== null ? { kind: 'folder', path } : { kind: 'missing', rel: goTo.path, folder: true }
  return findNode(tree, path)?.type === 'file' ? { kind: 'file', path } : { kind: 'missing', rel: goTo.path, folder: false }
}

/**
 * The folder the New… box opens on (D3): "Default location for new notes", read against the file on show as a new
 * [[link]] reads it. `missing` names a set folder the vault does not have: the box then goes to the root and says so.
 */
export function newItemFolder(settings: Pick<SettingsState, 'newNoteLocation' | 'newNoteFolder'>, vault: string, pageOnShow: string | null, tree: readonly TreeNode[]): { dir: string; missing: string | null } {
  const rel = newNoteBase(settings, vault, pageOnShow ?? '')
  const dir = placePath(vault, rel)
  return dir === vault || findDirNode(tree, dir) !== null ? { dir, missing: null } : { dir: vault, missing: rel }
}
