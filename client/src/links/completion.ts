/**
 * The ONE `[[…]]` completion matcher (Links B, GRO-2191 — locked ruling): Bases' cell editors
 * (`views/view/EditableCell.tsx` — LinkEditor and ChipsEditor) and the editor's `[[` picker
 * (`editor/wikilink/wikilinkPicker.ts`) all match through here, so completion behaves the same
 * everywhere — which is how the F2 ranking upgrade (GRO-2197) landed once, in place. Matching
 * is case-insensitive over the candidate NAME, ranked exact → prefix → substring → word → joined
 * (YAZ-3748 D2), capped at MAX_SUGGESTIONS after ranking.
 *
 * `linkCandidates(records)` derives the editor picker's candidates from an index snapshot:
 * every markdown note under its TITLE (YAZ-2420 🔒 D17 — the basename of a note that has no
 * `title:`), plus one row per frontmatter ALIAS (Links E2, GRO-2214). Duplicate titles follow the
 * resolver's shallowest-depth rule (`views/engine.ts` `makeResolver`, GRO-2190): the bare title
 * resolves to the shallowest match (equal depth → first in path order), so only that record gets
 * the bare name — every other duplicate is disambiguated as `folder/title`, and inserts
 * `folder/basename`, which resolves root-relatively.
 * An alias row is typed as the alias but INSERTS the piped `[[Note|Alias]]`, so it is
 * unambiguous by construction too — the target is that note's own unambiguous name, whoever
 * else claims the alias (aliases resolve after basenames, and two notes may share one). Two
 * notes claiming the same alias therefore both show, told apart by the note half of the label —
 * which is already `folder/title` when their titles collide as well.
 * A note WITH a frontmatter `id` (YAZ-2293, 🔒) is linked by it instead: both its name row and
 * its alias rows insert the plain `[[id]]` — no name, no pipe — so the link survives any rename
 * or move. The names above are then only what such a row is TYPED and READ as; a note with no
 * id keeps inserting them, and the exception below is theirs alone.
 * Inserting exactly a candidate's `insert` text therefore always links to its record — with ONE
 * honest exception (GRO-2197 audit): the `r.folder === ''` clause below hands the bare title
 * to EVERY root-level record, so two files at the vault ROOT that share a title, in any case
 * (or `A.md` next to `A.markdown`) both offer a bare row while the resolver, which case-folds,
 * can only give the name to one of them. There is no unambiguous name to offer the second, so
 * this is recorded rather than fixed.
 */
import type { IndexRecord } from '@shared/types'
import { isViewOnly } from '@shared/fileKind'

/** Suggestion cap shared by every completion surface (was EditableCell's local constant). */
export const MAX_SUGGESTIONS = 8

/** One completion row: what it matches, what it inserts between the brackets, what it reads as. */
export interface LinkCandidate {
  /** The text the typed fragment matches: the note's link name, or one of its aliases. */
  name: string
  /** Placed between `[[` and `]]` — the note's or folder's `id`; without one the name, or the piped `Note|Alias` of an alias row. */
  insert: string
  /** Row text: the name alone, `Alias — Note` (the alias row's disambiguation) or a folder's `Name (folder)`. */
  label: string
  /**
   * `name.toLowerCase()`, precomputed by the constructors so the ranking scan (GRO-2197 —
   * full pass, no early exit) allocates nothing per keystroke. Optional: hand-built literals
   * may omit it, and the matcher derives it on the fly when absent.
   */
  lower?: string
  /**
   * The record this row names (YAZ-957). Set by `linkCandidates`, absent on hand-built rows —
   * without it a caller wanting "this note's name" has to match rows back by position or by
   * resolving them, and both are wrong in a way that only shows up on a duplicate basename.
   */
  path?: string
}

/** A plain link name as a candidate: it matches, inserts and reads as itself. */
export const nameCandidate = (name: string): LinkCandidate => ({ name, insert: name, label: name, lower: name.toLowerCase() })

/**
 * Picker-only composition: every recognized view-only TARGET spelling belongs to the
 * navigation-only route, even before its catalog entry exists. Semantic aliases whose DISPLAY
 * happens to match remain valid because their target (before `|`) is still an ordinary note.
 * So does a row inserting an `id` (YAZ-2293): an id is no view-only spelling, and unlike its
 * name it does link to a note NAMED like a view-only file. Resolution sources stay split.
 */
export function mergeLinkCandidates(markdown: readonly LinkCandidate[], viewOnly: readonly LinkCandidate[]): LinkCandidate[] {
  return [
    ...markdown.filter((candidate) => !isViewOnly(candidate.insert.split('|', 1)[0].trim())),
    ...viewOnly,
  ]
}

/** An alias of `note` (that note's own unambiguous name): typed as the alias, inserted as the note's `id` — piped behind `target`, the text that links to it, when it has none. */
const aliasCandidate = (alias: string, note: string, target: string, path: string, id?: string): LinkCandidate => ({
  name: alias,
  insert: id ?? `${target}|${alias}`,
  label: `${alias} — ${note}`,
  lower: alias.toLowerCase(),
  path,
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
 * A run of characters that are not letters, digits or combining marks: what splits a name into words, and what a joined
 * match leaves out (YAZ-3748 D2). A combining mark is part of its letter: `é` stored as `e` + U+0301 (NFD, as macOS file
 * names can be) stays one word, so `resume` finds no `Résumé` in either form — no accent folding (D4).
 */
const NOT_WORD = /[^\p{L}\p{N}\p{M}]+/gu
const WORD_CHAR = /[\p{L}\p{N}\p{M}]/u

/** The fewest letters a joined match reads (YAZ-3748 B5): `a b` joins to `ab`, which half the names hold, so it finds no `Table`. */
const JOINED_MIN = 3

/** The typed text as the matcher reads it, read once per keystroke (YAZ-3748): trimmed and lowercased, its words, and its words run together. */
export interface Needle {
  text: string
  words: string[]
  joined: string
}

/** `loose: false` reads no words, so only the three text tiers can match (the Settings search, YAZ-3408 — D1). */
export function readNeedle(fragment: string, loose = true): Needle {
  const text = fragment.trim().toLowerCase()
  const words = loose ? text.split(NOT_WORD).filter((w) => w !== '') : []
  return { text, words, joined: words.join('') }
}

/**
 * A letter, digit or combining mark at `i` of `s`: an ASCII test first, so a plain name costs no regex and no new string
 * per character. It reads one UTF-16 unit, so a letter outside the BMP (`𝐀`, two units) reads as a split here, while
 * `readNeedle` splits by code point. Accepted: such names are rare, and the worst case is one extra word start.
 */
function wordCharAt(s: string, i: number): boolean {
  const c = s.charCodeAt(i)
  return c < 128 ? (c >= 48 && c <= 57) || (c >= 97 && c <= 122) || (c >= 65 && c <= 90) : WORD_CHAR.test(s[i])
}

/** Where `q` first starts a word of `lower` (at 0, or after a character that is no letter, digit or mark), or -1. */
function wordStart(lower: string, q: string): number {
  for (let at = lower.indexOf(q); at !== -1; at = lower.indexOf(q, at + 1)) if (at === 0 || !wordCharAt(lower, at - 1)) return at
  return -1
}

/** Each of `words` starts a word of `lower`: a plain loop, as it runs for most rows on each keystroke. */
function startsEachWord(lower: string, words: readonly string[]): boolean {
  for (const q of words) if (wordStart(lower, q) === -1) return false
  return true
}

/**
 * Where `joined` first sits in `lower` with the characters that are no letter, digit or mark skipped (`workinglog` in
 * `working-log` → [0, 11], YAZ-3748 D2), as a [start, end) range of `lower`; null when it does not. It makes no string
 * and keeps no cache: it runs for most rows on each keystroke, and every index change makes new rows.
 */
function joinedAt(lower: string, joined: string): [number, number] | null {
  for (let start = lower.indexOf(joined[0]); start !== -1; start = lower.indexOf(joined[0], start + 1)) {
    let i = start
    let j = 0
    while (i < lower.length && j < joined.length) {
      if (lower[i] === joined[j]) i++, j++
      else if (!wordCharAt(lower, i)) i++
      else break
    }
    if (j === joined.length) return [start, i]
  }
  return null
}

/**
 * A row's tier for `needle`, best first (GRO-2197, YAZ-3748 D2): 0 the same name, 1 a name that starts with the text,
 * 2 a name that holds it, 3 a name where each typed word starts a word, in any order (`yaseen workflow` →
 * `1-yaseen-engineering-workflow`), 4 a name that holds the joined text (`working log` → `Workinglog`, `workinglog` →
 * `Working-Log`) once it has JOINED_MIN letters (B5); -1 no match. Case-insensitive over the row's NAME.
 */
export function matchTier(row: { name: string; lower?: string }, needle: Needle): number {
  const lower = row.lower ?? row.name.toLowerCase()
  const at = lower.indexOf(needle.text)
  if (at !== -1) return lower === needle.text ? 0 : at === 0 ? 1 : 2
  if (needle.words.length === 0) return -1
  // One word that is the whole text cannot start a word here: the text tier just failed to find it at all.
  if (!(needle.words.length === 1 && needle.words[0] === needle.text) && startsEachWord(lower, needle.words)) return 3
  return needle.joined.length >= JOINED_MIN && joinedAt(lower, needle.joined) !== null ? 4 : -1
}

/**
 * Candidates matching `fragment`, RANKED (GRO-2197, YAZ-3748 D2) by `matchTier`: exact name match first, then prefix
 * matches, then substring matches, then word and joined matches — case-insensitive over the candidate NAME (an alias row
 * matches on the alias, never on the note half of its label or insert), input order preserved
 * within each tier. The needle is the fragment with its ENDS trimmed (Obsidian: `[[ al`
 * still matches Alpha); inside it, a space is a letter to the first three tiers and a split between words to the
 * last two. Ranking needs the full scan, so there is no early exit: the per-candidate work is one `indexOf` over the
 * precomputed `lower`, plus a word scan and a joined scan (`joinedAt`) for a row the text does not hold, and
 * `cap` (MAX_SUGGESTIONS by default) caps the result AFTER ranking (the completion.test perf smoke keeps 1,000+ files
 * honest). An empty fragment matches everything — the first cap-full. `loose: false` keeps the first three tiers alone
 * (Settings, D1). Generic over the row type so surfaces with their own richer candidate
 * (title search, YAZ-802) match through here without fabricating link-only fields.
 */
export function matchLinkCandidates<T extends { name: string; lower?: string }>(
  candidates: readonly T[],
  fragment: string,
  cap: number = MAX_SUGGESTIONS,
  loose = true,
): T[] {
  const needle = readNeedle(fragment, loose)
  const tiers: T[][] = [[], [], [], [], []]
  for (const candidate of candidates) {
    const tier = matchTier(candidate, needle)
    if (tier !== -1) tiers[tier].push(candidate)
  }
  return tiers.flat().slice(0, cap)
}

/**
 * `label` lowercased, with a way back from a [start, end) range of the lowercased text to the same letters of `label`
 * (YAZ-3748 B7). Nearly every label keeps its length, so the range is its own. A few letters grow (Turkish `İ` is `i̇`,
 * two code units): then the label is lowered one character at a time, and each code unit keeps where its character stands.
 */
function lowered(label: string): { lower: string; back: (start: number, end: number) => [number, number] } {
  const whole = label.toLowerCase()
  if (whole.length === label.length) return { lower: whole, back: (start, end) => [start, end] }
  let lower = ''
  const starts: number[] = []
  const ends: number[] = []
  let at = 0
  for (const ch of label) {
    const low = ch.toLowerCase()
    for (let i = 0; i < low.length; i++) starts.push(at), ends.push(at + ch.length)
    lower += low
    at += ch.length
  }
  return { lower, back: (start, end) => [starts[start], ends[end - 1]] }
}

/**
 * Where `needle` shows in `label`, as [start, end) ranges to mark (YAZ-3748 D3), tried in the matcher's own order: the
 * whole text where the label holds it, else each typed word where it starts a word (overlaps as one), else the joined
 * text across the marks it skipped (B5: once it has JOINED_MIN letters). None when nothing fits — an alias or an id
 * matched — or the text is empty. The ranges are the LABEL's positions, even where lowercasing changes its length (B7).
 */
export function matchRanges(label: string, needle: Needle): [number, number][] {
  if (needle.text === '') return []
  const { lower, back } = lowered(label)
  const at = lower.indexOf(needle.text)
  if (at !== -1) return [back(at, at + needle.text.length)]
  if (needle.words.length === 0) return []
  const starts = needle.words.map((q) => wordStart(lower, q))
  if (starts.every((start) => start !== -1)) return merged(starts.map((start, i) => back(start, start + needle.words[i].length)))
  const range = needle.joined.length < JOINED_MIN ? null : joinedAt(lower, needle.joined)
  return range === null ? [] : [back(range[0], range[1])]
}

/** Ranges in label order, overlapping or touching ones as one (`work working` marks `Working` once). Sorts `ranges` in place: its caller makes it new. */
function merged(ranges: [number, number][]): [number, number][] {
  const out: [number, number][] = []
  for (const [start, end] of ranges.sort((a, b) => a[0] - b[0])) {
    const last = out[out.length - 1]
    if (last !== undefined && start <= last[1]) last[1] = Math.max(last[1], end)
    else out.push([start, end])
  }
  return out
}

/** Folder depth exactly as `makeResolver` counts it: root = 0. */
const depthOf = (r: IndexRecord): number => (r.folder === '' ? 0 : r.folder.split('/').length)

/**
 * What Bases' cell editors complete over: the index TITLES (YAZ-2420 🔒 D17) — no aliases, no
 * folder disambiguation — each written as every link the app writes (YAZ-2293): the note's `id`
 * when it has one, else the title, the basename of a note that has none.
 */
export const titleCandidates = (records: readonly IndexRecord[]): LinkCandidate[] =>
  records.map((r) => ({ ...nameCandidate(r.title), insert: r.id ?? r.title }))

/**
 * Candidates for one index snapshot, in records order (i.e. path-sorted): per record its name —
 * the title when this record is what the bare title resolves to (unique, or the shallowest
 * duplicate — equal depth to the first in order, mirroring `makeResolver`), else
 * `folder/title`, inserting the root-relative `folder/basename` — followed by one alias row per
 * frontmatter alias, inserting the piped form; every row of a record with an `id` inserts that id
 * instead (module doc).
 * Duplicate detection is case-insensitive, like resolution. Two alias rows are
 * SKIPPED (GRO-2197): an alias equal to the chosen name (case-insensitively) would only add a
 * degenerate `[[X|X]]` next to the plain `[[X]]` row, and an alias containing `[` or `]` would
 * build a piped insert the wikilink regex (`wikilinkPlugin.ts` WIKILINK_RE, inner class
 * `[^[\]]+`) re-parses as a DIFFERENT link — breaking the every-insert-links-to-its-record
 * invariant above.
 */
export function linkCandidates(records: readonly IndexRecord[]): LinkCandidate[] {
  const shallowest = new Map<string, { index: number; depth: number }>()
  records.forEach((r, index) => {
    const key = r.title.toLowerCase()
    const depth = depthOf(r)
    const prev = shallowest.get(key)
    if (prev === undefined || depth < prev.depth) shallowest.set(key, { index, depth })
  })
  return records.flatMap((r, index) => {
    const bare = shallowest.get(r.title.toLowerCase())?.index === index || r.folder === ''
    const name = bare ? r.title : `${r.folder}/${r.title}`
    // What links to it with no id: the title while it resolves here, else the path, which no title joins.
    const target = bare ? r.title : `${r.folder}/${r.basename}`
    // GRO-2197: no `[[X|X]]` row for an alias that IS the chosen name, no bracketed alias
    // whose piped insert would re-parse as a different link (module doc above).
    const aliases = r.aliases.filter((alias) => alias.toLowerCase() !== name.toLowerCase() && !/[[\]]/.test(alias))
    // The record rides along (YAZ-957) — added HERE, where it is known, so `nameCandidate` keeps
    // its single argument and `names.map(nameCandidate)` can never pass an index as a path.
    return [{ ...nameCandidate(name), insert: r.id ?? target, path: r.path }, ...aliases.map(alias => aliasCandidate(alias, name, target, r.path, r.id))]
  })
}
