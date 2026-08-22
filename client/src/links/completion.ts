/**
 * The ONE `[[…]]` completion matcher (Links B, GRO-2191 — locked ruling): Bases' cell editors
 * (`bases/view/EditableCell.tsx` — LinkEditor and ChipsEditor) and the editor's `[[` picker
 * (`editor/wikilink/wikilinkPicker.ts`) all match through here, so completion behaves the same
 * everywhere and ranking can upgrade IN PLACE later. Matching is case-insensitive substring
 * over the candidate NAME, given order, capped at MAX_SUGGESTIONS.
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
 * Inserting exactly a candidate's `insert` text therefore always links to its record.
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
}

/** A plain link name as a candidate: it matches, inserts and reads as itself. */
export const nameCandidate = (name: string): LinkCandidate => ({ name, insert: name, label: name })

/** An alias of `note` (that note's own unambiguous name): typed as the alias, inserted piped. */
const aliasCandidate = (alias: string, note: string): LinkCandidate => ({
  name: alias,
  insert: `${note}|${alias}`,
  label: `${alias} — ${note}`,
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
 * Candidates matching `fragment`: case-insensitive substring over the candidate NAME (an alias
 * row matches on the alias, never on the note half of its label or insert), input order, first
 * MAX_SUGGESTIONS only (the scan stops at the cap, so 1,000+ files stay lag-free).
 * An empty fragment matches everything — the first MAX_SUGGESTIONS candidates.
 */
export function matchLinkCandidates(candidates: readonly LinkCandidate[], fragment: string): LinkCandidate[] {
  const needle = fragment.toLowerCase()
  const out: LinkCandidate[] = []
  for (const candidate of candidates) {
    if (!candidate.name.toLowerCase().includes(needle)) continue
    out.push(candidate)
    if (out.length === MAX_SUGGESTIONS) break
  }
  return out
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
 * the piped form. Duplicate detection is case-insensitive, like resolution.
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
    return [nameCandidate(name), ...r.aliases.map(alias => aliasCandidate(alias, name))]
  })
}
