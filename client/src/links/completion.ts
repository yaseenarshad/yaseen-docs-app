/**
 * The ONE `[[…]]` completion matcher (Links B, GRO-2191 — locked ruling): Bases' cell editors
 * (`bases/view/EditableCell.tsx` — LinkEditor and ChipsEditor) and the editor's `[[` picker
 * (`editor/wikilink/wikilinkPicker.ts`) all match through here, so completion behaves the same
 * everywhere — which is how the F2 ranking upgrade (GRO-2197) landed once, in place. Matching
 * is case-insensitive over the candidate NAME, ranked exact → prefix → substring, capped at
 * MAX_SUGGESTIONS after ranking.
 *
 * `linkCandidates(records)` derives the editor picker's candidates from an index snapshot:
 * every markdown note under its SHORTEST unambiguous link target, plus one row per frontmatter
 * ALIAS (Links E2, GRO-2214). Duplicate basenames follow the resolver's shallowest-depth rule
 * (`bases/engine.ts` `makeResolver`, GRO-2190): the bare basename resolves to the shallowest
 * match (equal depth → first in path order), so only that record gets the bare name — every
 * other duplicate is disambiguated as `folder/basename`, which resolves root-relatively.
 * An alias row is typed as the alias but INSERTS the piped `[[Note|Alias]]`, so it is
 * unambiguous by construction too — the target is that note's own unambiguous name, whoever
 * else claims the alias (aliases resolve after basenames, and two notes may share one). Two
 * notes claiming the same alias therefore both show, told apart by the note half of the label —
 * which is already `folder/basename` when their basenames collide as well.
 * Inserting exactly a candidate's `insert` text therefore always links to its record — with ONE
 * honest exception (GRO-2197 audit): the `r.folder === ''` clause below hands the bare basename
 * to EVERY root-level record, so two files at the vault ROOT whose basenames differ only by case
 * (or `A.md` next to `A.markdown`) both offer a bare row while the resolver, which case-folds,
 * can only give the name to one of them. There is no unambiguous name to offer the second, so
 * this is recorded rather than fixed.
 */
import type { IndexRecord } from '@shared/types'

/** Suggestion cap shared by every completion surface (was EditableCell's local constant). */
export const MAX_SUGGESTIONS = 8

/** One completion row: what it matches, what it inserts between the brackets, what it reads as. */
export interface LinkCandidate {
  /** The text the typed fragment matches: the note's link name, or one of its aliases. */
  name: string
  /** Placed between `[[` and `]]` — the name, or the piped `Note|Alias` of an alias row. */
  insert: string
  /** Row text: the name alone, or `Alias — Note` (the alias row's disambiguation). */
  label: string
  /**
   * `name.toLowerCase()`, precomputed by the constructors so the ranking scan (GRO-2197 —
   * full pass, no early exit) allocates nothing per keystroke. Optional: hand-built literals
   * may omit it, and the matcher derives it on the fly when absent.
   */
  lower?: string
}

/** A plain link name as a candidate: it matches, inserts and reads as itself. */
export const nameCandidate = (name: string): LinkCandidate => ({ name, insert: name, label: name, lower: name.toLowerCase() })

/** An alias of `note` (that note's own unambiguous name): typed as the alias, inserted piped. */
const aliasCandidate = (alias: string, note: string): LinkCandidate => ({
  name: alias,
  insert: `${note}|${alias}`,
  label: `${alias} — ${note}`,
  lower: alias.toLowerCase(),
})

/**
 * The fragment of an unclosed trailing `[[` in `text` (`'foo [[ba'` → `'ba'`, `'[['` → `''`),
 * or null when the text does not end inside one (`[[x]]` is closed). Brackets never appear in
 * the fragment; a `|` does — alias handling is the caller's (the editor picker closes on it,
 * the cell editors simply stop matching any basename).
 */
export function trailingLinkFragment(text: string): string | null {
  return /\[\[([^[\]]*)$/.exec(text)?.[1] ?? null
}

/**
 * Candidates matching `fragment`, RANKED (GRO-2197): exact name match first, then prefix
 * matches, then substring matches — case-insensitive over the candidate NAME (an alias row
 * matches on the alias, never on the note half of its label or insert), input order preserved
 * within each bucket. The needle is the fragment with its ENDS trimmed (Obsidian: `[[ al`
 * still matches Alpha) — internal whitespace stays significant. Ranking needs the full scan,
 * so there is no early exit: the per-candidate work is one `indexOf` over the precomputed
 * `lower`, and `cap` (MAX_SUGGESTIONS by default) caps the result AFTER ranking (the
 * completion.test perf smoke keeps 1,000+ files honest). An empty fragment matches everything —
 * the first cap-full. Generic over the row type so surfaces with their own richer candidate
 * (title search, YAZ-802) match through here without fabricating link-only fields.
 */
export function matchLinkCandidates<T extends { name: string; lower?: string }>(
  candidates: readonly T[],
  fragment: string,
  cap: number = MAX_SUGGESTIONS,
): T[] {
  const needle = fragment.trim().toLowerCase()
  const exact: T[] = []
  const prefix: T[] = []
  const substring: T[] = []
  for (const candidate of candidates) {
    const lower = candidate.lower ?? candidate.name.toLowerCase()
    const at = lower.indexOf(needle)
    if (at === -1) continue
    if (lower === needle) exact.push(candidate)
    else if (at === 0) prefix.push(candidate)
    else substring.push(candidate)
  }
  return [...exact, ...prefix, ...substring].slice(0, cap)
}

/** The same match over plain names — Bases' cell editors complete over index basenames, no aliases in play. */
export function matchLinkNames(names: readonly string[], fragment: string): string[] {
  return matchLinkCandidates(names.map(nameCandidate), fragment).map(c => c.insert)
}

/** Folder depth exactly as `makeResolver` counts it: root = 0. */
const depthOf = (r: IndexRecord): number => (r.folder === '' ? 0 : r.folder.split('/').length)

/**
 * Candidates for one index snapshot, in records order (i.e. path-sorted): per record its name —
 * the basename when this record is what the bare basename resolves to (unique, or the shallowest
 * duplicate — equal depth to the first in order, mirroring `makeResolver`), else the
 * root-relative `folder/basename` — followed by one alias row per frontmatter alias, inserting
 * the piped form. Duplicate detection is case-insensitive, like resolution. Two alias rows are
 * SKIPPED (GRO-2197): an alias equal to the chosen name (case-insensitively) would only add a
 * degenerate `[[X|X]]` next to the plain `[[X]]` row, and an alias containing `[` or `]` would
 * build a piped insert the wikilink regex (`wikilinkPlugin.ts` WIKILINK_RE, inner class
 * `[^[\]]+`) re-parses as a DIFFERENT link — breaking the every-insert-links-to-its-record
 * invariant above.
 */
export function linkCandidates(records: readonly IndexRecord[]): LinkCandidate[] {
  const shallowest = new Map<string, { index: number; depth: number }>()
  records.forEach((r, index) => {
    const key = r.basename.toLowerCase()
    const depth = depthOf(r)
    const prev = shallowest.get(key)
    if (prev === undefined || depth < prev.depth) shallowest.set(key, { index, depth })
  })
  return records.flatMap((r, index) => {
    const name =
      shallowest.get(r.basename.toLowerCase())?.index === index || r.folder === '' ? r.basename : `${r.folder}/${r.basename}`
    // GRO-2197: no `[[X|X]]` row for an alias that IS the chosen name, no bracketed alias
    // whose piped insert would re-parse as a different link (module doc above).
    const aliases = r.aliases.filter((alias) => alias.toLowerCase() !== name.toLowerCase() && !/[[\]]/.test(alias))
    return [nameCandidate(name), ...aliases.map(alias => aliasCandidate(alias, name))]
  })
}
