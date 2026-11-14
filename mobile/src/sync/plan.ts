import { isMarkdown, isSkipped } from '@shared/fileKind'
import { FOLDER_SETTINGS_FILE, VAULT_CONFIG_DIR } from '@shared/types'

/**
 * What the sync pass downloads, and what it compares (October 2E; decision 6).
 *
 * - Eager: downloaded on the first sync and kept current. A card file (YAZ-5037) is a `.md` file, so it is eager with
 *   the pages; the phone needs no other rule.
 * - Pictures and sounds ahead of time (`MEDIA_AHEAD_DAYS`) are 3D's (`mobile/src/media`): they download AFTER the pass,
 *   in the background, so the first download and each refresh are never slower for them.
 * - Anything else is fetched the first time a page or a card shows it, then kept (`MediaAhead.show`).
 */
/** Downloaded on first sync and kept current. */
export const isEager = (path: string): boolean => isMarkdown(path) || path.split('/').includes(VAULT_CONFIG_DIR) || path.endsWith(FOLDER_SETTINGS_FILE)
/** Also downloaded ahead: the pictures and sounds of cards due within this many days. */
export const MEDIA_AHEAD_DAYS = 7
/** Anything else is fetched the first time a page or a card shows it, then kept. */

/**
 * Does the phone's index hold a record for `path`? The Mac's rule (`walk` in `desktop/src/main/vaultIndex/scan.ts`):
 * Markdown files, skipping each dot-entry and `node_modules` on the way, except a folder's own `.folder.md`.
 */
export function isIndexed(path: string): boolean {
  if (!isMarkdown(path)) return false
  const parts = path.split('/')
  const name = parts.pop()!
  return parts.every((part) => !isSkipped(part)) && (!isSkipped(name) || name === FOLDER_SETTINGS_FILE)
}

export interface Rename {
  from: string
  to: string
}

/** The compare of two file lists. All lists are in path order. */
export interface TreeDiff {
  added: string[]
  /** Same path, another SHA. */
  changed: string[]
  removed: string[]
  /** A removed path and an added path with the same SHA (row R6). Not also in `added` or `removed`. */
  renamed: Rename[]
}

/**
 * Compares the stored map (path → blob SHA at the last synced commit; null before the first sync) with the new tree.
 * This replaces GitHub's compare call, which stops at 300 files (row R8). A force push needs no special case (R11).
 */
export function diffTrees(before: Readonly<Record<string, string>> | null, after: ReadonlyMap<string, string>): TreeDiff {
  const old = before ?? {}
  const added: string[] = []
  const changed: string[] = []
  for (const [path, sha] of after) {
    const was = Object.prototype.hasOwnProperty.call(old, path) ? old[path] : undefined
    if (was === undefined) added.push(path)
    else if (was !== sha) changed.push(path)
  }
  const removed = Object.keys(old).filter((path) => !after.has(path))
  // Pair each removed path with an added path of the same SHA, one to one, in path order.
  const addedBySha = new Map<string, string[]>()
  for (const path of added.sort()) {
    const sha = after.get(path)!
    addedBySha.set(sha, [...(addedBySha.get(sha) ?? []), path])
  }
  const renamed: Rename[] = []
  const stillRemoved: string[] = []
  for (const path of removed.sort()) {
    const to = addedBySha.get(old[path])?.shift()
    if (to === undefined) stillRemoved.push(path)
    else renamed.push({ from: path, to })
  }
  const renamedTo = new Set(renamed.map((r) => r.to))
  return { added: added.filter((p) => !renamedTo.has(p)), changed: changed.sort(), removed: stillRemoved, renamed }
}
