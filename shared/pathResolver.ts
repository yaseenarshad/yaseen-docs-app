import type { IndexRecord, IndexResponse } from './types'
import { relTo } from './paths'
import { idKey, targetKey, typedFolders } from './noteResolver'
import { foldersById } from './folderRecords'
type IndexBoard = NonNullable<IndexResponse['boards']>[number]
export type ResolveLink = (target: string) => string | null

/**
 * Link target → the folder it names, as its directory path, or null: the id of the folder's
 * settings file (`folders`, YAZ-2293; none with `ids: false`, the rename engine's probe), its
 * root-relative path, its title (`folders`, YAZ-2420 🔒 D17), then its bare name — duplicates of
 * either resolve to the SHALLOWEST, equal depth to the first in order, the rule notes use
 * (`makeResolver`) — or, pathed, a path of titles as a note's is (`typedFolders`, YAZ-2478).
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
  // By the id in lowercase, as a note's is (`makeResolver`): an ID is read in any case (YAZ-2677 R1).
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
 * THE path-level resolver every wikilink surface shares (`ResolveLink`): a note first — id,
 * path, title, name, a path of titles (YAZ-2478), alias (`resolverFor`) — and a folder only when
 * none answers, so a note or alias of the same name always wins. `letters` are the vault's ID
 * letters (`IndexResponse.letters`): with them an ID that has letters of before is found too (YAZ-2677 R5).
 * A board's ID (`boards`, YAZ-3943 4C) comes before all of them, as a note's ID does: `[[YAZ-12]]` opens the board
 * after any rename. Two boards with one ID (a copy made outside the app): the first by path. An ID it held before a two-Mac
 * merge (`was`, YAZ-4071 7I) opens it too, after the notes.
 */
export function pathResolver(note: (target: string) => { record: IndexRecord } | null, root: string, dirs: readonly string[], folders: readonly IndexRecord[] = [], letters?: readonly string[], boards: readonly IndexBoard[] = []): ResolveLink {
  const folder = folderResolver(root, dirs, folders, { letters })
  if (boards.length === 0) return (target) => note(target)?.record.path ?? folder(target)
  const byId = new Map<string, string>()
  for (const { id, path } of boards) if (!byId.has(id.toLowerCase())) byId.set(id.toLowerCase(), path)
  // YAZ-4071 7I: an ID a board held before a two-Mac merge, after the notes: a note that holds it now wins.
  const byWas = new Map<string, string>()
  for (const { was, path } of boards) for (const id of was ?? []) if (!byWas.has(id.toLowerCase())) byWas.set(id.toLowerCase(), path)
  return (target) => {
    const key = idKey(targetKey(target), letters)
    return byId.get(key) ?? note(target)?.record.path ?? byWas.get(key) ?? folder(target)
  }
}
