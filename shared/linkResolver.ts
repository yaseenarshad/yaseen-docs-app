/**
 * Link target → page, THE resolution rule (GRO-2132, moved here from `client/src/views/engine.ts` for YAZ-4740): the
 * app's views, wikilink decorations and clicks resolve through it, and so does `yaseendocs mentions`, so an agent and
 * the app agree on what a link names. Generic over what a file is wrapped in: the views pass their `FileValue`s, the
 * command plain `{ record }`s. Pure; no DOM, no Node.
 */
import { splitLink, undecided } from './linkParts'
import { vaultPageId } from './pageId'
import type { IndexRecord } from './types'

/** What the resolver finds: a file, by its index record. */
export interface Resolvable {
  readonly record: IndexRecord
}

/** A whole-value `[[target|alias]]` (the views' link value): its target and alias. */
export const LINK_VALUE_RE = /^\[\[([^\]|]+)(?:\|([^\]]*))?\]\]$/

/**
 * `[[x|y]]` → `x`, the page side (`splitLink`, YAZ-4935: `[[y|WIKI-1]]` → `WIKI-1`); anything else unchanged. A link
 * whose page only the pages can pick (`undecided`: `[[Covid pages|COVID-19]]`) keeps both sides, `Covid pages|COVID-19`:
 * the resolver picks (`pickTarget`, YAZ-4954).
 */
export function stripBrackets(s: string): string {
  if (!LINK_VALUE_RE.test(s)) return s
  const inner = s.slice(2, -2)
  const parts = splitLink(inner)
  return undecided(parts) ? inner : parts.head
}

/**
 * A target that holds both sides of a link (`Covid pages|COVID-19`, as the index keeps it, or `[[…|…]]`) → its page
 * side with the pages known (YAZ-4954): the left side when `isPage` finds it, else the side the shape gives
 * (`splitLink`). A target with no `|` is itself, and `isPage` is not asked.
 */
export function pickTarget(target: string, isPage: (page: string) => boolean): string {
  if (!target.includes('|')) return target
  return splitLink(LINK_VALUE_RE.test(target) ? target.slice(2, -2) : target, isPage).page
}

const normalise = (s: string) => s.replace(/^\/+|\/+$/g, '').replace(/\.(md|markdown)$/, '').toLowerCase()

/**
 * A link target as the resolver reads it: brackets, `#heading` and the `|words` off (`splitLink`), trimmed, lowercased.
 * It knows no pages, so it splits by the shape; the resolvers first `pickTarget` with their pages (YAZ-4954).
 */
export const targetKey = (target: string) => splitLink(stripBrackets(target)).page.toLowerCase()

/**
 * A basename as `targetBasename` spells it: lowercased, with the one context-dependent lowercase
 * mapping (Greek final sigma: `ΟΔΟΣ.md` lowercases its Σ to σ, `ΟΔΟΣ` alone to ς) folded away.
 */
export const basenameKey = (basename: string): string => basename.toLowerCase().replace(/ς/g, 'σ')

/**
 * The `basenameKey` of every page `target` can resolve to without aliases: each path and name match
 * in `makeResolver` ends in that basename. A page whose basename no link spells has no references
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
   * Resolve a target that IS a page's id (default true, YAZ-2293 D5). `false` for the rename
   * engine's probe too: an id link names the page itself, not its place, so no rename rewrites it.
   */
  ids?: boolean
  /**
   * The vault's ID letters (`IndexResponse.letters`, YAZ-2677 R5): the current ones, then each it
   * had before. Given, a target with letters of before finds the page of that number: `[[OLD-12]]`
   * is `YAZ-12` (S82). Without them an id is found by the letters its record holds.
   */
  letters?: readonly string[]
  /**
   * The snapshot's folder settings records (YAZ-2478). Given, a pathed target no file path answers
   * is read as a path of TITLES: `Sub/Page` is the page titled Page in the folder `Sub` names
   * (`typedFolders`). The rename engine's probe gives them too, and rewrites such a link to the page's id.
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
  return vaultPageId(key, letters)?.toLowerCase() ?? key
}

/**
 * Link target → page: the page's own id (YAZ-2293 — first, so a page merely NAMED like an id
 * never captures it; a target that is the id of NO page falls through to the names below, so
 * `[[YAZ-7]]` still opens a page that is only named so: YAZ-2677 R6, S26), absolute path, root-relative path (with or without `.md` / leading slash),
 * TITLE (YAZ-2420 🔒 D17 — a page with no `title:` is titled by its file name), bare basename —
 * duplicates of either resolve to the SHALLOWEST folder (Obsidian's shortest-path rule,
 * GRO-2190), equal depth to the first in the given (path-sorted) order — a pathed target as a
 * path of TITLES (YAZ-2478, `ResolverOptions.folders`), and finally a
 * frontmatter ALIAS (E2, GRO-2214), by the same shallowest-then-first rule, so a real name
 * always beats an alias. Case-insensitive; `[[…]]`, `|alias` and `#heading` are stripped.
 *
 * A PAGE CARD's ID (YAZ-5030, `cardLinks.ts`) finds the page the card is on, right after the pages' own ids: a link to
 * a card is a link into its page, as `[[Page#heading]]` is. Which card it names is `makeCardResolver`'s to say. Not
 * with `ids: false` (the rename probe): an ID link names the card itself, so no rename of its page rewrites it.
 */
export function makeResolver<F extends Resolvable>(files: readonly F[], root?: string, opts: ResolverOptions = {}): (target: string) => F | null {
  const byId = new Map<string, F>()
  /** A card's ID in lowercase (YAZ-5030) → the page the card is on; the first page in the given order. */
  const byCard = new Map<string, F>()
  const byPath = new Map<string, F>()
  const byRel = new Map<string, F>()
  const byTitle = new Map<string, { file: F; depth: number }>()
  const byBase = new Map<string, { file: F; depth: number }>()
  const byAlias = new Map<string, { file: F; depth: number }>()
  /** `<folder>/<title>`, the folder as the index names it, to the first page of that title there; empty with no `folders`. */
  const byFolderTitle = new Map<string, F>()
  const typedFolder = typedFolders(opts.folders ?? [])
  const shallowest = (map: Map<string, { file: F; depth: number }>, key: string, file: F, depth: number) => {
    const prev = map.get(key)
    if (prev === undefined || depth < prev.depth) map.set(key, { file, depth })
  }
  for (const f of files) {
    const r = f.record
    // By the id in lowercase: a target is read in any case (YAZ-2677 R1, S17), and its key is lowercase.
    const id = opts.ids === false ? undefined : r.id?.toLowerCase()
    if (id !== undefined && !byId.has(id)) byId.set(id, f)
    if (opts.ids !== false && r.cards !== undefined)
      for (const card of r.cards) {
        const key = card.id?.toLowerCase()
        if (key === undefined) continue
        if (!byCard.has(key)) byCard.set(key, f)
        const current = idKey(key, opts.letters)
        if (!byCard.has(current)) byCard.set(current, f)
      }
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
  /** A path of titles: its last segment a page's title, the ones before it its folders, from the root down. */
  const titledPath = (rel: string): F | null => {
    const segments = rel.split('/')
    const title = segments.pop()
    let dir = ''
    for (const segment of segments) dir = typedFolder(dir, segment)?.toLowerCase() ?? (dir === '' ? segment : `${dir}/${segment}`)
    return byFolderTitle.get(`${dir}/${title}`) ?? null
  }
  const find = (key: string): F | null => {
    if (!key) return null
    const asId = idKey(key, opts.letters)
    let found = byId.get(asId) ?? (byCard.size === 0 ? undefined : (byCard.get(asId) ?? byCard.get(key))) ?? byPath.get(key) ?? null
    if (!found) {
      const rel = normalise(rootKey && key.startsWith(rootKey) ? key.slice(rootKey.length) : key)
      found = byRel.get(rel) ?? byTitle.get(key)?.file ?? (rel.includes('/') ? titledPath(rel) : byBase.get(rel)?.file ?? null)
    }
    // Aliases last: a page named `CAC` always wins the target `CAC` over one merely aliased so.
    return found ?? byAlias.get(key)?.file ?? null
  }
  const isPage = (page: string): boolean => find(targetKey(page)) !== null
  const cache = new Map<string, F | null>()
  return target => {
    const hit = cache.get(target)
    if (hit !== undefined) return hit
    // Both sides of a link (YAZ-4954): the left side when it is a page, else the side the shape gives.
    const found = find(targetKey(pickTarget(target, isPage)))
    cache.set(target, found)
    return found
  }
}

