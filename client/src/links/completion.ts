/**
 * The ONE `[[…]]` completion matcher (Links B, GRO-2191 — locked ruling): Bases' cell editors
 * (`bases/view/EditableCell.tsx` — LinkEditor and ChipsEditor) and the editor's `[[` picker
 * (`editor/wikilink/wikilinkPicker.ts`) all match through here, so completion behaves the same
 * everywhere and ranking can upgrade IN PLACE later (alias-aware ranking lands with E2,
 * GRO-2214). v1 matching is case-insensitive substring over the candidate name, given order,
 * capped at MAX_SUGGESTIONS.
 *
 * `linkCandidates(records)` derives the editor picker's candidate names from an index snapshot:
 * every markdown note as its SHORTEST unambiguous link target. Duplicate basenames follow the
 * resolver's shallowest-depth rule (`bases/engine.ts` `makeResolver`, GRO-2190): the bare
 * basename resolves to the shallowest match (equal depth → first in path order), so only that
 * record gets the bare name — every other duplicate is disambiguated as `folder/basename`,
 * which resolves root-relatively. Inserting exactly the candidate name therefore always links
 * to that record.
 */
import type { IndexRecord } from '@shared/types'

/** Suggestion cap shared by every completion surface (was EditableCell's local constant). */
export const MAX_SUGGESTIONS = 8

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
 * Candidate names matching `fragment`: case-insensitive substring, input order, first
 * MAX_SUGGESTIONS only (the scan stops at the cap, so 1,000+ files stay lag-free).
 * An empty fragment matches everything — the first MAX_SUGGESTIONS names.
 */
export function matchLinkNames(names: readonly string[], fragment: string): string[] {
  const needle = fragment.toLowerCase()
  const out: string[] = []
  for (const name of names) {
    if (!name.toLowerCase().includes(needle)) continue
    out.push(name)
    if (out.length === MAX_SUGGESTIONS) break
  }
  return out
}

/** Folder depth exactly as `makeResolver` counts it: root = 0. */
const depthOf = (r: IndexRecord): number => (r.folder === '' ? 0 : r.folder.split('/').length)

/**
 * One candidate name per record (records order, i.e. path-sorted): the basename when this
 * record is what the bare basename resolves to (unique, or the shallowest duplicate — equal
 * depth to the first in order, mirroring `makeResolver`), else the root-relative
 * `folder/basename`. Duplicate detection is case-insensitive, like resolution.
 */
export function linkCandidates(records: readonly IndexRecord[]): string[] {
  const shallowest = new Map<string, { index: number; depth: number }>()
  records.forEach((r, index) => {
    const key = r.basename.toLowerCase()
    const depth = depthOf(r)
    const prev = shallowest.get(key)
    if (prev === undefined || depth < prev.depth) shallowest.set(key, { index, depth })
  })
  return records.map((r, index) =>
    shallowest.get(r.basename.toLowerCase())?.index === index || r.folder === ''
      ? r.basename
      : `${r.folder}/${r.basename}`,
  )
}
