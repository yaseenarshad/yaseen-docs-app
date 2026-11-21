/**
 * Links to FOLDERS (YAZ-2290 D10, 🔒): a folder is a page, so it keeps what a page had. `[[Projects]]`
 * reaches the folder named Projects — but only once NO page, path or alias holds that name
 * (`linkResolver`), so no link that resolved before means anything new. A folder is no page
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
import type { IndexBoard } from '../views/useIndex'
import { allDirs } from '../lib/treeState'
import { idKey, pickTarget, targetKey, typedFolders } from '@shared/linkResolver'
import { resolverFor } from '../views/engine'
import { FileValue, type Resolver } from '../views/expr'
import { linkCandidates, nameCandidate, titleCandidates, type LinkCandidate } from './completion'
import { folderLabel, folderRows, folderTitle, foldersByDir, foldersById } from './shortcuts'

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
 * settings file (`folders`, YAZ-2293; none with `ids: false`, the rename engine's probe), its
 * root-relative path, its title (`folders`, YAZ-2420 🔒 D17), then its bare name — duplicates of
 * either resolve to the SHALLOWEST, equal depth to the first in order, the rule pages use
 * (`makeResolver`) — or, pathed, a path of titles as a page's is (`typedFolders`, YAZ-2478).
 * Case-insensitive; `[[…]]`, `|alias` and `#heading` are stripped.
 */
export function folderResolver(root: string, dirs: readonly string[], folders: readonly IndexRecord[] = [], opts: { ids?: boolean; letters?: readonly string[] } = {}): ResolveLink {
  const byRel = new Map<string, string>()
  const byTitle = new Map<string, { dir: string; depth: number }>()
  const byName = new Map<string, { dir: string; depth: number }>()
  const shallowest = (map: Map<string, { dir: string; depth: number }>, key: string, dir: string, depth: number) => {
    const prev = map.get(key)
    if (prev === undefined || depth < prev.depth) map.set(key, { dir, depth })
  }
  for (const dir of dirs) {
    const rel = relTo(root, dir).toLowerCase()
    if (!byRel.has(rel)) byRel.set(rel, dir)
    shallowest(byName, rel.slice(rel.lastIndexOf('/') + 1), dir, rel.split('/').length)
  }
  for (const settings of folders) {
    const dir = byRel.get(settings.folder.toLowerCase())
    if (dir !== undefined) shallowest(byTitle, settings.title.toLowerCase(), dir, settings.folder.split('/').length)
  }
  // By the id in lowercase, as a page's is (`makeResolver`): an ID is read in any case (YAZ-2677 R1).
  const byId = new Map(opts.ids === false ? [] : [...foldersById(folders)].map(([id, settings]) => [id.toLowerCase(), settings]))
  const typed = typedFolders(folders)
  const titledPath = (key: string): string | null => {
    let dir = ''
    for (const segment of key.split('/')) dir = typed(dir, segment)?.toLowerCase() ?? (dir === '' ? segment : `${dir}/${segment}`)
    return byRel.get(dir) ?? null
  }
  return (target) => {
    const key = targetKey(target).replace(/^\/+|\/+$/g, '')
    return byRel.get(byId.get(idKey(key, opts.letters))?.folder.toLowerCase() ?? key) ?? byTitle.get(key)?.dir ?? (key.includes('/') ? titledPath(key) : byName.get(key)?.dir ?? null)
  }
}

/**
 * THE path-level resolver every wikilink surface shares (`ResolveLink`): a page first — id,
 * path, title, name, a path of titles (YAZ-2478), alias (`resolverFor`) — and a folder only when
 * none answers, so a page or alias of the same name always wins. `letters` are the vault's ID
 * letters (`IndexResponse.letters`): with them an ID that has letters of before is found too (YAZ-2677 R5).
 * A board's ID (`boards`, YAZ-3943 4C) comes before all of them, as a page's ID does: `[[YAZ-12]]` opens the board
 * after any rename. Two boards with one ID (a copy made outside the app): the first by path. An ID it held before a two-Mac
 * merge (`was`, YAZ-4071 7I) opens it too, after the pages.
 */
export function linkResolver(records: readonly IndexRecord[], root: string, dirs: readonly string[], folders: readonly IndexRecord[] = [], letters?: readonly string[], boards: readonly IndexBoard[] = []): ResolveLink {
  const resolve = pagesResolver(records, root, dirs, folders, letters, boards)
  // Both sides of a link (`Covid pages|COVID-19`, YAZ-4954): the left side when ANY page answers it (a folder or a
  // board too), as the editor's pill picks (`linkSplit`), so Linked mentions and the pill agree.
  const isPage = (page: string): boolean => resolve(page) !== null
  return (target) => resolve(pickTarget(target, isPage))
}

function pagesResolver(records: readonly IndexRecord[], root: string, dirs: readonly string[], folders: readonly IndexRecord[], letters: readonly string[] | undefined, boards: readonly IndexBoard[]): ResolveLink {
  const page = resolverFor(records, root, { folders, letters })
  const folder = folderResolver(root, dirs, folders, { letters })
  if (boards.length === 0) return (target) => page(target)?.record.path ?? folder(target)
  const byId = new Map<string, string>()
  for (const { id, path } of boards) if (!byId.has(id.toLowerCase())) byId.set(id.toLowerCase(), path)
  // YAZ-4071 7I: an ID a board held before a two-Mac merge, after the pages: a page that holds it now wins.
  const byWas = new Map<string, string>()
  for (const { was, path } of boards) for (const id of was ?? []) if (!byWas.has(id.toLowerCase())) byWas.set(id.toLowerCase(), path)
  return (target) => {
    const key = idKey(targetKey(target), letters)
    return byId.get(key) ?? page(target)?.record.path ?? byWas.get(key) ?? folder(target)
  }
}

/**
 * The `[[` picker's folder rows (`folderLabel`). A folder with an id (`folders`) is inserted by
 * it, under its title (YAZ-2420 🔒 D17) — its root-relative path when another folder takes the
 * title. One with no id is inserted by that title or path, whichever `resolve` gives to it, and
 * has no row when neither reaches it.
 */
export function folderLinkCandidates(root: string, dirs: readonly string[], resolve: ResolveLink, folders: readonly IndexRecord[]): LinkCandidate[] {
  const settings = foldersByDir(folders)
  const folder = folderResolver(root, dirs, folders)
  return dirs.flatMap((dir) => {
    const held = settings.get(dir)
    // Of two folders still sharing an id, only the one it names is linked by it.
    const id = held?.id !== undefined && resolve(held.id) === dir ? held.id : undefined
    const name = [folderTitle(folders, dir), relTo(root, dir)].find((spelling) => (id === undefined ? resolve : folder)(spelling) === dir)
    return name === undefined ? [] : [{ ...nameCandidate(name), insert: id ?? name, label: folderLabel(name), path: dir, ...(id === undefined ? {} : { id }) }]
  })
}

/**
 * The `[[` picker of a folder page's cells (YAZ-4601 D49): the page editor's rows (`WikilinkIndexBridge`) — the pages,
 * then the folders, after them so a page wins an equal match — in place of the bare titles. One list per index snapshot.
 */
export function cellLinkCandidates(records: readonly IndexRecord[], folders: readonly IndexRecord[], resolve: ResolveLink, root: string): LinkCandidate[] {
  return [...linkCandidates(records), ...folderLinkCandidates(root, vaultDirs(root), resolve, folders)]
}

/**
 * The resolver a view reads its links through (`Resolver`), folders included (D10): the page,
 * else the folder the window's link resolver (`link`) gives the target, standing in as a file named
 * like the folder and titled as the folder is (`folders`, YAZ-2420 🔒 D14). So `[[<folder id>]]`
 * reads as the folder's title wherever an id link reads as its page's title (YAZ-2293 D8), and
 * sorts and groups under its name.
 */
export function pageResolver(records: readonly IndexRecord[], folders: readonly IndexRecord[], root: string | undefined, link: ResolveLink | null): Resolver {
  const page = resolverFor(records, root, { folders })
  if (link === null) return page
  return (target) => {
    const hit = page(target)
    const dir = hit === null ? link(target) : null
    if (dir === null) return hit
    // The window's resolver knows the vault's letters of before (YAZ-2677 R5): what it found by them is a page, by its path.
    const found = page(dir)
    if (found !== null) return found
    const name = basename(dir)
    return new FileValue({ path: dir, name, basename: name, title: folderTitle(folders, dir), folder: dirname(relTo(root ?? '', dir)), ext: '', size: 0, ctime: 0, mtime: 0, properties: {}, aliases: [], tags: [], links: [], embeds: [] })
  }
}

/**
 * Picker candidates for a belongs-to column (🔒 Q2, YAZ-815): the pages in the FOLDER `target`
 * names (YAZ-2290 D10) — by the window's link resolver (`resolve`), so a page of that name wins
 * and narrows nothing, and the folder is found by its id, path or name — falling back to ALL
 * pages when the target is no folder or the folder holds none. Report-don't-block: the picker
 * narrows when it can and never goes empty. What a folder holds is what its page shows
 * (`folderRows`): the pages under it, and its shortcuts. Candidates rather than bare
 * strings since YAZ-2293: a page is offered by title, written by id.
 */
export function belongsToTitles(records: readonly IndexRecord[], folders: readonly IndexRecord[], resolve: ResolveLink, root: string, target: string): LinkCandidate[] {
  const hit = resolve(target)
  const matches = hit === null ? [] : folderRows(records, folders, relTo(root, hit))
  return titleCandidates(matches.length > 0 ? matches : records)
}
