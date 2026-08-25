/**
 * Folder pages (YAZ-825): who belongs to a folder page, and which folder pages a note belongs to
 * — computed CLIENT-SIDE in ONE pass over the index snapshot this window already holds, through
 * THE shared resolver (`bases/engine.ts` `resolverFor`), exactly as backlinks are. No map in the
 * main process, no new IPC, no new index field: the whole model lives in frontmatter. A note
 * names its parents in a `folder_pages` list; a folder page declares itself with
 * `folder_page: true`.
 *
 * THE CLICK RULE (locked): an entry counts only when it is a string that is EXACTLY a wikilink
 * after trim — the indexer's own frontmatter-link rule (`EXACT_WIKILINK_RE`, `vaultIndex/scan.ts`),
 * so only what the index already counted as a link can count here — AND it resolves
 * (case-insensitively, alias-aware, through the resolver handed in) — AND the page it resolves
 * to carries the flag. THE FLAG RULE (locked): `folder_page` is the boolean `true` and nothing
 * else; `"true"`, `1` and truthy objects are not it. An entry failing any leg counts as NOTHING
 * and is ignored quietly — prose, bare names, non-strings, dangling links and links to ordinary
 * pages all just leave the note unparented. Two entries resolving to one page are ONE membership.
 *
 * `uncategorized()` is every record with zero counting entries — folder pages and Home included.
 * The lookup has NO carve-outs; a surface that wants one subtracts it itself.
 */
import type { IndexRecord } from '@shared/types'
import type { ResolveLink } from '../editor/wikilink/wikilinkPlugin'

/** The note's parents, and the flag that makes a page a folder page. */
const ENTRIES_KEY = 'folder_pages'
const FLAG_KEY = 'folder_page'

/** Exactly a wikilink, nothing around it — the index's frontmatter-link rule (`scan.ts`). */
const EXACT_WIKILINK_RE = /^\[\[[^[\]]*\]\]$/

/** Strictly the boolean: `"true"`, `1` and truthy objects do NOT declare a folder page. */
export function isFolderPage(record: IndexRecord): boolean {
  return record.properties[FLAG_KEY] === true
}

export interface FolderPagesLookup {
  /** The notes belonging to this folder page, path-sorted; any other path holds nobody. */
  pagesIn(folderPagePath: string): IndexRecord[]
  /** The folder pages this note belongs to, as resolved paths, in entry order. */
  folderPagesOf(pagePath: string): string[]
  /** Every record with no counting entry — folder pages included (no carve-outs here). */
  uncategorized(): IndexRecord[]
  isFolderPage(record: IndexRecord): boolean
}

/** The folder pages one record's `folder_pages` counts for: the click rule, de-duplicated. */
function parentsOf(record: IndexRecord, flagged: ReadonlySet<string>, resolve: ResolveLink): string[] {
  const raw = record.properties[ENTRIES_KEY]
  // Scalar-or-list, the indexer's own tolerance (`extractLinks`, scan.ts): a bare
  // `folder_pages: "[[X]]"` is one entry, not nothing. Mappings still declare nothing.
  const entries = Array.isArray(raw) ? raw : [raw]
  const out: string[] = []
  for (const entry of entries) {
    if (typeof entry !== 'string') continue
    const link = entry.trim()
    if (!EXACT_WIKILINK_RE.test(link)) continue
    // The raw link goes to the resolver brackets and all — it strips them (`stripBrackets`),
    // along with any `|alias` / `#heading`, exactly as a click on that link would.
    const target = resolve(link)
    if (target === null || !flagged.has(target) || out.includes(target)) continue
    out.push(target)
  }
  return out
}

const byPath = (a: IndexRecord, b: IndexRecord): number => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0)

/**
 * ONE pass builds both directions and the uncategorized set. The flags are collected first: a
 * note may name a folder page defined anywhere in the snapshot, including after itself.
 */
function build(records: readonly IndexRecord[], resolve: ResolveLink): FolderPagesLookup {
  const flagged = new Set<string>()
  for (const record of records) if (isFolderPage(record)) flagged.add(record.path)
  const members = new Map<string, IndexRecord[]>()
  const belongsTo = new Map<string, string[]>()
  const orphans: IndexRecord[] = []
  for (const record of records) {
    const parents = parentsOf(record, flagged, resolve)
    if (parents.length === 0) {
      orphans.push(record)
      continue
    }
    belongsTo.set(record.path, parents)
    for (const parent of parents) {
      const held = members.get(parent)
      if (held === undefined) members.set(parent, [record])
      else held.push(record)
    }
  }
  for (const held of members.values()) held.sort(byPath)
  return {
    pagesIn: (folderPagePath) => members.get(folderPagePath) ?? [],
    folderPagesOf: (pagePath) => belongsTo.get(pagePath) ?? [],
    uncategorized: () => orphans,
    isFolderPage,
  }
}

/**
 * One lookup per snapshot — `backlinksFor`'s WeakMap idiom. A refetched index is a NEW array and
 * rebuilds (that IS the live update), and dropped snapshots are collectable. The resolver is
 * derived from the SAME snapshot (memoized per its identity too), so records identity is the
 * whole key.
 */
const lookupCache = new WeakMap<readonly IndexRecord[], FolderPagesLookup>()

/** The folder-page lookup over this snapshot: both directions, built once, answered from memory. */
export function folderPagesLookup(records: readonly IndexRecord[], resolve: ResolveLink): FolderPagesLookup {
  let hit = lookupCache.get(records)
  if (hit === undefined) lookupCache.set(records, (hit = build(records, resolve)))
  return hit
}
