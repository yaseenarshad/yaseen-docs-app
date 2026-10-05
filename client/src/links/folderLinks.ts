/**
 * Links to FOLDERS (YAZ-2290 D10, 🔒): a folder is a page, so it keeps what a page had. `[[Projects]]`
 * reaches the folder named Projects — but only once NO note, path or alias holds that name
 * (`linkResolver`), so no link that resolved before means anything new. A folder is no note
 * record: what its link resolves to is the DIRECTORY path, a folder tab's identity (D3), so a click,
 * a ⌘-click and the backlinks pass open and compare it like any resolved path, without knowing it
 * is a folder.
 *
 * Which folders exist is the Files tree's to say (`vaultDirs`): it knows the empty ones, and the
 * vault root is not among them — so the root is not linkable.
 */
import type { IndexRecord, TreeResponse } from '@shared/types'
import type { ResolveLink } from '../editor/wikilink/wikilinkPlugin'
import { basename, dirname, relTo } from '../lib/paths'
import { latestTree } from '../lib/treeFeed'
import { allDirs } from '../lib/treeState'
import { resolverFor, targetKey } from '../views/engine'
import { FileValue, type Resolver } from '../views/expr'
import { basenameCandidates, nameCandidate, type LinkCandidate } from './completion'
import { folderLabel, folderRows, foldersById } from './shortcuts'

const dirsOf = new WeakMap<TreeResponse, readonly string[]>()

/** Every folder under `root`, by the window's newest Files tree — walked once per tree; none until the first tree answers. */
export function vaultDirs(root: string): readonly string[] {
  const tree = latestTree(root)
  if (tree === null) return []
  let dirs = dirsOf.get(tree)
  if (dirs === undefined) dirsOf.set(tree, (dirs = allDirs(tree.tree)))
  return dirs
}

/**
 * Link target → the folder it names, as its directory path, or null: the id of the folder's
 * settings file (`folders`, YAZ-2293), its root-relative path, then its bare name — duplicates
 * resolve to the SHALLOWEST, equal depth to the first in `dirs` order, the rule notes use
 * (`makeResolver`). Case-insensitive; `[[…]]`, `|alias` and `#heading` are stripped.
 */
export function folderResolver(root: string, dirs: readonly string[], folders: readonly IndexRecord[] = []): ResolveLink {
  const byRel = new Map<string, string>()
  const byName = new Map<string, { dir: string; depth: number }>()
  for (const dir of dirs) {
    const rel = relTo(root, dir).toLowerCase()
    if (!byRel.has(rel)) byRel.set(rel, dir)
    const name = rel.slice(rel.lastIndexOf('/') + 1)
    const depth = rel.split('/').length
    const prev = byName.get(name)
    if (prev === undefined || depth < prev.depth) byName.set(name, { dir, depth })
  }
  const byId = foldersById(folders)
  return (target) => {
    const key = targetKey(target).replace(/^\/+|\/+$/g, '')
    return byRel.get(byId.get(key)?.folder.toLowerCase() ?? key) ?? (key.includes('/') ? null : byName.get(key)?.dir ?? null)
  }
}

/**
 * THE path-level resolver every wikilink surface shares (`ResolveLink`): a note first — id,
 * path, name, alias (`resolverFor`) — and a folder only when none answers, so a note or alias
 * of the same name always wins.
 */
export function linkResolver(records: readonly IndexRecord[], root: string, dirs: readonly string[], folders: readonly IndexRecord[] = []): ResolveLink {
  const note = resolverFor(records, root)
  const folder = folderResolver(root, dirs, folders)
  return (target) => note(target)?.record.path ?? folder(target)
}

/**
 * The `[[` picker's folder rows (`folderLabel`). A folder with an id (`folders`) is inserted by
 * it, under the shortest name that tells it from the other folders. One with no id is inserted by
 * name — by its root-relative path when `resolve` gives the name to something else — and has no
 * row when neither reaches it.
 */
export function folderLinkCandidates(root: string, dirs: readonly string[], resolve: ResolveLink, folders: readonly IndexRecord[]): LinkCandidate[] {
  const ids = new Map(folders.map((settings) => [dirname(settings.path), settings.id]))
  const folder = folderResolver(root, dirs)
  return dirs.flatMap((dir) => {
    const held = ids.get(dir)
    // Of two folders still sharing an id, only the one it names is linked by it.
    const id = held !== undefined && resolve(held) === dir ? held : undefined
    const name = [basename(dir), relTo(root, dir)].find((spelling) => (id === undefined ? resolve : folder)(spelling) === dir)
    return name === undefined ? [] : [{ ...nameCandidate(name), insert: id ?? name, label: folderLabel(name) }]
  })
}

/**
 * The resolver a view reads its links through (`Resolver`), folders included (D10): the note,
 * else the folder the window's link resolver (`link`) gives the target, standing in as a file named
 * like the folder. So `[[<folder id>]]` reads as the folder's name wherever an id link reads as its
 * note's title (YAZ-2293 D8), and sorts and groups under that name.
 */
export function pageResolver(records: readonly IndexRecord[], root: string | undefined, link: ResolveLink | null): Resolver {
  const note = resolverFor(records, root)
  if (link === null) return note
  return (target) => {
    const hit = note(target)
    const dir = hit === null ? link(target) : null
    if (dir === null) return hit
    const name = basename(dir)
    return new FileValue({ path: dir, name, basename: name, folder: dirname(relTo(root ?? '', dir)), ext: '', size: 0, ctime: 0, mtime: 0, properties: {}, aliases: [], tags: [], links: [], embeds: [] })
  }
}

/**
 * Picker candidates for a belongs-to column (🔒 Q2, YAZ-815): the notes in the FOLDER `target`
 * names (YAZ-2290 D10) — by the window's link resolver (`resolve`), so a note of that name wins
 * and narrows nothing, and the folder is found by its id, path or name — falling back to ALL
 * basenames when the target is no folder or the folder holds none. Report-don't-block: the picker
 * narrows when it can and never goes empty. What a folder holds is what its page shows
 * (`folderRows`): the notes under it, and its shortcuts. Candidates rather than bare
 * strings since YAZ-2293: a page is offered by basename, written by id.
 */
export function belongsToBasenames(records: readonly IndexRecord[], folders: readonly IndexRecord[], resolve: ResolveLink, root: string, target: string): LinkCandidate[] {
  const hit = resolve(target)
  const matches = hit === null ? [] : folderRows(records, folders, relTo(root, hit))
  return basenameCandidates(matches.length > 0 ? matches : records)
}
