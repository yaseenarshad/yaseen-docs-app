import { vaultNoteId } from './noteId'
import type { IndexRecord } from './types'
import { stripBrackets } from './linkText'

const normalise = (s: string) => s.replace(/^\/+|\/+$/g, '').replace(/\.(md|markdown)$/, '').toLowerCase()

/** A link target as the resolver reads it: brackets, `#heading` and `|alias` off, trimmed, lowercased. */
export const targetKey = (target: string) => stripBrackets(target).replace(/[#|].*$/, '').trim().toLowerCase()

/**
 * A basename as `targetBasename` spells it: lowercased, with the one context-dependent lowercase
 * mapping (Greek final sigma: `ΟΔΟΣ.md` lowercases its Σ to σ, `ΟΔΟΣ` alone to ς) folded away.
 */
export const basenameKey = (basename: string): string => basename.toLowerCase().replace(/ς/g, 'σ')

/**
 * The `basenameKey` of every note `target` can resolve to without aliases: each path and name match
 * in `makeResolver` ends in that basename. A note whose basename no link spells has no references
 * (YAZ-2241: the rename detector skips those without building a resolver per rename).
 */
export function targetBasename(target: string): string {
  const rel = normalise(targetKey(target))
  return basenameKey(rel.slice(rel.lastIndexOf('/') + 1))
}

/** `makeResolver` / `resolverFor` knobs; every field is optional and defaults to today's behaviour. */
export interface ResolverOptions {
  /**
   * Consult frontmatter `aliases` (default true, E2 GRO-2214). `false` builds a NAME-ONLY
   * resolver — the rename engine's referencing-set probe (`links/renameLinks.ts`), which must
   * not treat an alias-form link as a reference to rewrite: the alias lives in the moved file's
   * own frontmatter and travels with it.
   */
  aliases?: boolean
  /**
   * Resolve a target that IS a note's id (default true, YAZ-2293 D5). `false` for the rename
   * engine's probe too: an id link names the note itself, not its place, so no rename rewrites it.
   */
  ids?: boolean
  /**
   * The vault's ID letters (`IndexResponse.letters`, YAZ-2677 R5): the current ones, then each it
   * had before. Given, a target with letters of before finds the note of that number: `[[OLD-12]]`
   * is `YAZ-12` (S82). Without them an id is found by the letters its record holds.
   */
  letters?: readonly string[]
  /**
   * The snapshot's folder settings records (YAZ-2478). Given, a pathed target no file path answers
   * is read as a path of TITLES: `Sub/Page` is the note titled Page in the folder `Sub` names
   * (`typedFolders`). The rename engine's probe gives them too, and rewrites such a link to the note's id.
   */
  folders?: readonly IndexRecord[]
}

/**
 * The folder a typed segment names inside `parent` (YAZ-2478): the one there with that title, else
 * the one in that directory, else undefined. Folders are as the index names them (root-relative,
 * '' the root, which no segment names) and come off their settings records; case-insensitive.
 */
export function typedFolders(folders: readonly IndexRecord[]): (parent: string, segment: string) => string | undefined {
  const byTitle = new Map<string, string>()
  const byName = new Map<string, string>()
  for (const { folder, title } of folders) {
    if (folder === '') continue
    const typed = `${folder.slice(0, folder.lastIndexOf('/') + 1)}${title}`.toLowerCase()
    if (!byTitle.has(typed)) byTitle.set(typed, folder)
    byName.set(folder.toLowerCase(), folder)
  }
  return (parent, segment) => {
    const typed = `${parent === '' ? '' : `${parent}/`}${segment}`.toLowerCase()
    return byTitle.get(typed) ?? byName.get(typed)
  }
}

/**
 * A link target's key (`targetKey`) as the key an id is found under (YAZ-2677 R1, R5): an ID is read
 * in any case, so the key is the id in lowercase; one with letters the vault had before is the key
 * of the same number with the current letters. Any other key is itself.
 */
export function idKey(key: string, letters?: readonly string[]): string {
  if (letters === undefined || letters.length < 2) return key
  return vaultNoteId(key, letters)?.toLowerCase() ?? key
}

/**
 * Link target → note: the note's own id (YAZ-2293 — first, so a note merely NAMED like an id
 * never captures it; a target that is the id of NO note falls through to the names below, so
 * `[[YAZ-7]]` still opens a note that is only named so: YAZ-2677 R6, S26), absolute path, root-relative path (with or without `.md` / leading slash),
 * TITLE (YAZ-2420 🔒 D17 — a note with no `title:` is titled by its file name), bare basename —
 * duplicates of either resolve to the SHALLOWEST folder (Obsidian's shortest-path rule,
 * GRO-2190), equal depth to the first in the given (path-sorted) order — a pathed target as a
 * path of TITLES (YAZ-2478, `ResolverOptions.folders`), and finally a
 * frontmatter ALIAS (E2, GRO-2214), by the same shallowest-then-first rule, so a real name
 * always beats an alias. Case-insensitive; `[[…]]`, `|alias` and `#heading` are stripped.
 */
export function makeResolver<T extends { record: IndexRecord }>(files: readonly T[], root?: string, opts: ResolverOptions = {}): (target: string) => T | null {
  const byId = new Map<string, T>()
  const byPath = new Map<string, T>()
  const byRel = new Map<string, T>()
  const byTitle = new Map<string, { file: T; depth: number }>()
  const byBase = new Map<string, { file: T; depth: number }>()
  const byAlias = new Map<string, { file: T; depth: number }>()
  /** `<folder>/<title>`, the folder as the index names it, to the first note of that title there; empty with no `folders`. */
  const byFolderTitle = new Map<string, T>()
  const typedFolder = typedFolders(opts.folders ?? [])
  const shallowest = (map: Map<string, { file: T; depth: number }>, key: string, file: T, depth: number) => {
    const prev = map.get(key)
    if (prev === undefined || depth < prev.depth) map.set(key, { file, depth })
  }
  for (const f of files) {
    const r = f.record
    // By the id in lowercase: a target is read in any case (YAZ-2677 R1, S17), and its key is lowercase.
    const id = opts.ids === false ? undefined : r.id?.toLowerCase()
    if (id !== undefined && !byId.has(id)) byId.set(id, f)
    byPath.set(r.path.toLowerCase(), f)
    const rel = normalise(r.folder ? `${r.folder}/${r.basename}` : r.basename)
    if (!byRel.has(rel)) byRel.set(rel, f)
    const depth = r.folder === '' ? 0 : r.folder.split('/').length
    shallowest(byTitle, r.title.toLowerCase(), f, depth)
    shallowest(byBase, r.basename.toLowerCase(), f, depth)
    if (opts.folders !== undefined) {
      const titled = `${r.folder}/${r.title}`.toLowerCase()
      if (!byFolderTitle.has(titled)) byFolderTitle.set(titled, f)
    }
    if (opts.aliases !== false) for (const alias of r.aliases) shallowest(byAlias, alias.toLowerCase(), f, depth)
  }
  const rootKey = root ? `${root.replace(/\/+$/, '').toLowerCase()}/` : null
  /** A path of titles: its last segment a note's title, the ones before it its folders, from the root down. */
  const titledPath = (rel: string): T | null => {
    const segments = rel.split('/')
    const title = segments.pop()
    let dir = ''
    for (const segment of segments) dir = typedFolder(dir, segment)?.toLowerCase() ?? (dir === '' ? segment : `${dir}/${segment}`)
    return byFolderTitle.get(`${dir}/${title}`) ?? null
  }
  const cache = new Map<string, T | null>()
  return target => {
    const hit = cache.get(target)
    if (hit !== undefined) return hit
    const key = targetKey(target)
    let found: T | null = null
    if (key) {
      found = byId.get(idKey(key, opts.letters)) ?? byPath.get(key) ?? null
      if (!found) {
        const rel = normalise(rootKey && key.startsWith(rootKey) ? key.slice(rootKey.length) : key)
        found = byRel.get(rel) ?? byTitle.get(key)?.file ?? (rel.includes('/') ? titledPath(rel) : byBase.get(rel)?.file ?? null)
      }
      // Aliases last: a page named `CAC` always wins the target `CAC` over one merely aliased so.
      if (!found) found = byAlias.get(key)?.file ?? null
    }
    cache.set(target, found)
    return found
  }
}
