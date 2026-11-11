/**
 * The explore stack's search (YAZ-2571): the sidebar search's own rows and ranking (`searchRows`: ids first, then
 * exact → prefix → substring → word → joined, over titles, aliases, file names and folder names), then two more:
 *
 * 1. TEXT rows (`textCandidates`): one row per tag and per frontmatter string value of a note, built once per index
 *    snapshot as the alias rows are. The matched tag or value is the row's `snippet`. The index holds no body text
 *    (the decision on YAZ-2571), so a body search is not here.
 * 2. A TYPO pass (`fuzzyRows`): rows the exact pass missed whose name holds the typed text within one edit (two
 *    from 9 letters): "conjeture" finds "conjecture". It runs only from `FUZZY_MIN` letters, and only when the exact
 *    pass found fewer than `FUZZY_WHEN` rows, so a query with plain matches costs the one scan it always cost.
 *
 * Every pass is one scan of the rows in memory: no read, no second index, no work off the index (the guard in
 * `exploreRows.test.ts` counts it on a 5,000-note index).
 */
import type { IndexRecord } from '@shared/types'
import { readNeedle } from '../links/completion'
import { SEARCH_CAP, searchRows, type SearchCandidate } from '../search/searchCandidates'

/** Frontmatter keys that are no text of the note: the app's own, and the ones other rows already match. */
const NOT_TEXT = new Set(['id', 'title', 'aliases', 'alias', 'tags', 'tag', 'readonly', 'created', 'updated', 'date'])
/** The longest value that is a snippet: a longer one is a document, not a line. */
const MAX_SNIPPET = 80

/** One row per tag (`#tag`) and per frontmatter string value (`key: value`) of each note, labelled by the note's title. */
export function textCandidates(records: readonly IndexRecord[]): SearchCandidate[] {
  const rows: SearchCandidate[] = []
  for (const r of records) {
    const row = (name: string, snippet: string) => rows.push({ kind: 'file', name, lower: name.toLowerCase(), label: r.title, path: r.path, folder: r.folder, snippet })
    for (const tag of r.tags) row(tag, `#${tag}`)
    for (const [key, value] of Object.entries(r.properties)) {
      if (NOT_TEXT.has(key.toLowerCase()) || typeof value !== 'string') continue
      const text = value.trim()
      if (text === '' || text.length > MAX_SNIPPET || text.toLowerCase() === r.title.toLowerCase()) continue
      row(text, `${key}: ${text}`)
    }
  }
  return rows
}

export const FUZZY_MIN = 4
export const FUZZY_WHEN = 8

/** How many edits a typed text of `length` may be from the name: one, two from 9 letters; none under `FUZZY_MIN`. */
export const editsAllowed = (length: number): number => (length < FUZZY_MIN ? 0 : length < 9 ? 1 : 2)

/**
 * The least edit distance between `needle` and any substring of `hay` (Sellers' algorithm), stopped at `limit + 1`:
 * one column of `needle.length + 1` cells per character of `hay`, in `col` and `prev` the caller keeps between calls.
 */
export function approxDistance(hay: string, needle: string, limit: number, prev: Int32Array, col: Int32Array): number {
  const m = needle.length
  for (let i = 0; i <= m; i++) prev[i] = i
  let best = m
  for (let j = 0; j < hay.length; j++) {
    const c = hay.charCodeAt(j)
    col[0] = 0
    let rowMin = 0
    for (let i = 1; i <= m; i++) {
      const sub = prev[i - 1] + (needle.charCodeAt(i - 1) === c ? 0 : 1)
      const del = prev[i] + 1
      const ins = col[i - 1] + 1
      const v = sub < del ? (sub < ins ? sub : ins) : del < ins ? del : ins
      col[i] = v
      if (v < rowMin || i === 1) rowMin = v
    }
    if (col[m] < best) best = col[m]
    if (best <= 0) return 0
    for (let i = 0; i <= m; i++) prev[i] = col[i]
  }
  return best > limit ? limit + 1 : best
}

/** What a scan cost: for the guard test. `fuzzy` is the rows the typo pass looked at. */
export interface SearchStats {
  fuzzy: number
}

/**
 * The rows the exact pass missed (`shown`) whose name is within `editsAllowed` of the typed text, nearest first, input
 * order within a distance, at most `cap`. A name shorter than the text less the edits cannot hold it: skipped unread.
 */
export function fuzzyRows(candidates: readonly SearchCandidate[], query: string, shown: ReadonlySet<string>, cap: number, stats?: SearchStats): SearchCandidate[] {
  const text = readNeedle(query).text
  const limit = editsAllowed(text.length)
  if (limit === 0 || cap <= 0) return []
  const prev = new Int32Array(text.length + 1)
  const col = new Int32Array(text.length + 1)
  const tiers: SearchCandidate[][] = Array.from({ length: limit }, () => [])
  for (const c of candidates) {
    if (shown.has(c.path) || c.lower.length < text.length - limit) continue
    if (stats !== undefined) stats.fuzzy++
    const d = approxDistance(c.lower, text, limit, prev, col)
    if (d >= 1 && d <= limit) tiers[d - 1].push(c)
  }
  return tiers.flat().slice(0, cap)
}

/** What the explore search shows for `query`: the sidebar search's rows (a note's text row only when no named row found it), then the typo matches, capped at `SEARCH_CAP`. */
export function exploreRows(candidates: readonly SearchCandidate[], query: string, stats?: SearchStats): SearchCandidate[] {
  const ranked = searchRows(candidates, query)
  // A note found by its title, alias or file name shows that row alone: its text rows add nothing.
  const named = new Set(ranked.flatMap((c) => (c.snippet === undefined ? [c.path] : [])))
  const exact = ranked.filter((c) => c.snippet === undefined || !named.has(c.path))
  if (exact.length >= FUZZY_WHEN) return exact
  const shown = new Set(exact.map((c) => c.path))
  const fuzzy = fuzzyRows(candidates, query, shown, SEARCH_CAP - exact.length, stats)
  if (fuzzy.length === 0) return exact
  // One row per note from the typo pass: its first row (the title's, then an alias's) says enough.
  const seen = new Set<string>()
  return [...exact, ...fuzzy.filter((c) => !seen.has(c.path) && seen.add(c.path) !== undefined)]
}
