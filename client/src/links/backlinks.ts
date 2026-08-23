/**
 * Backlinks — "Linked mentions" (Links D, GRO-2193; decision D of GRO-2096, LOCKED): the notes
 * that link to the open one, computed CLIENT-SIDE in ONE pass over the index snapshot this
 * window already holds, through THE shared resolver (`bases/engine.ts` `resolverFor`, the one
 * behind base views, wikilink decorations and clicks). No reverse map in the main process, no
 * new IPC, no new index field — and alias-awareness comes free: a note linking `[[CAC]]` IS a
 * linked mention of the page whose frontmatter aliases it (E2, GRO-2214).
 *
 * A mention is a `links` OR an `embeds` entry that resolves to the open path — an `![[embed]]`
 * mentions its target exactly like a `[[link]]` does (locked). The open note never lists itself.
 * One entry per referencing NOTE (however many mentions it holds), path-sorted, so the section
 * renders the same order for the same snapshot.
 *
 * Context snippets are read ON DEMAND (`fs:read` per shown entry, `mentionSnippets` below) —
 * the index stores no positions, and nothing is read until the section is expanded.
 */
import type { IndexRecord } from '@shared/types'
import { WIKILINK_RE, linkPageName, type ResolveLink } from '../editor/wikilink/wikilinkPlugin'
import { maskCode } from './renameLinks'

/** Records whose links/embeds resolve to `path`, path-sorted; `path` itself never counts. */
function referencing(path: string, records: readonly IndexRecord[], resolve: ResolveLink): IndexRecord[] {
  return records
    .filter((r) => r.path !== path && [...r.links, ...r.embeds].some((target) => resolve(target) === path))
    .sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0))
}

/**
 * Referencing sets per records array identity, then per path — `resolverFor`'s WeakMap idiom.
 * Every mounted tab's section recomputes on each ready snapshot, so one snapshot must cost one
 * pass per open path; a refetched index is a NEW array and recomputes (that IS the live update),
 * and dropped snapshots are collectable. The resolver is derived from the SAME snapshot
 * (memoized per its identity too), so records identity is the whole key.
 */
const backlinkCache = new WeakMap<readonly IndexRecord[], Map<string, IndexRecord[]>>()

/** The notes mentioning `path` in this snapshot: path-sorted, self excluded, embeds included. */
export function backlinksFor(path: string, records: readonly IndexRecord[], resolve: ResolveLink): IndexRecord[] {
  let byPath = backlinkCache.get(records)
  if (byPath === undefined) backlinkCache.set(records, (byPath = new Map()))
  let hit = byPath.get(path)
  if (hit === undefined) byPath.set(path, (hit = referencing(path, records, resolve)))
  return hit
}

// ---------- context snippets ----------

/** Longest snippet text before windowing; the ellipses ride on top. */
export const SNIPPET_MAX_CHARS = 120

/** Snippets shown per referencing note — a link-heavy note stays one quiet block. */
export const MAX_SNIPPETS = 5

const ELLIPSIS = '…'

export interface MentionSnippet {
  /** The mention's line, whitespace-trimmed and windowed to ~`SNIPPET_MAX_CHARS` around it. */
  text: string
  /** Offsets INSIDE `text` of the mention — the highlighted run is exactly the raw `[[…]]` match. */
  from: number
  to: number
}

/** One snippet for the match at [from, to) of `content`: its line, trimmed and windowed. */
function snippetAt(content: string, from: number, to: number): MentionSnippet {
  const lineStart = content.lastIndexOf('\n', from - 1) + 1
  const nl = content.indexOf('\n', to)
  const line = content.slice(lineStart, nl === -1 ? content.length : nl)
  const matchFrom = from - lineStart
  const matchTo = to - lineStart
  // Trim surrounding whitespace, never into the match itself (a match is never trimmed away).
  let start = 0
  let end = line.length
  while (start < matchFrom && /\s/.test(line[start])) start++
  while (end > matchTo && /\s/.test(line[end - 1])) end--
  // Long line: a window centred on the match, always containing it whole.
  const slack = Math.max(0, SNIPPET_MAX_CHARS - (matchTo - matchFrom))
  const windowStart = end - start > SNIPPET_MAX_CHARS ? Math.max(start, matchFrom - Math.floor(slack / 2)) : start
  const windowEnd = Math.min(end, Math.max(matchTo, windowStart + SNIPPET_MAX_CHARS))
  const head = windowStart > start ? ELLIPSIS : ''
  return {
    // A target may span a line break (`[^[\]]+` allows one); newlines read as spaces, offsets intact.
    text: head + line.slice(windowStart, windowEnd).replace(/[\r\n]/g, ' ') + (windowEnd < end ? ELLIPSIS : ''),
    from: head.length + (matchFrom - windowStart),
    to: head.length + (matchTo - windowStart),
  }
}

/**
 * The mention lines of one referencing note's raw file content: every `[[link]]` / `![[embed]]`
 * whose page name resolves to `target`, in document order, at most `limit`. Code is skipped
 * through the rename engine's length-preserving `maskCode` — the same fence/inline-span
 * discipline the index's link extraction uses, so a snippet can only highlight a link the index
 * actually counted. Frontmatter is scanned like any other line (the index reads links there too).
 */
export function mentionSnippets(content: string, target: string, resolve: ResolveLink, limit = MAX_SNIPPETS): MentionSnippet[] {
  const masked = maskCode(content)
  const out: MentionSnippet[] = []
  for (const m of masked.matchAll(WIKILINK_RE)) {
    const page = linkPageName(m[2])
    if (page === '' || resolve(page) !== target) continue // '' = the same-file `[[#heading]]` form
    out.push(snippetAt(content, m.index, m.index + m[0].length))
    if (out.length === limit) break
  }
  return out
}
