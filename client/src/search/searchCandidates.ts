/**
 * Title search candidates (YAZ-802): the rows the search box matches a query against, ranked by
 * the ONE completion matcher (`links/completion.ts`) so search ranks exactly like `[[`
 * completion does. 🔒 D3 on YAZ-739: the query matches the note's BASENAME and its frontmatter
 * ALIASES only — `folder` rides along as the row's display label and is never matched.
 *
 * Deliberately NOT `linkCandidates`: a link candidate must insert text that resolves back to its
 * own record, so duplicate basenames there are folder-disambiguated and only the shallowest keeps
 * the bare name. Search opens `path` directly, so there is nothing to disambiguate — every note
 * gets a row under its own basename, and duplicates are told apart by the folder label.
 */
import type { IndexRecord } from '@shared/types'
import { matchLinkCandidates } from '../links/completion'

/** One search row: what the query matches, what it reads as, what opening it targets. */
export interface SearchCandidate {
  /** The text the query matches: the note's basename, or one of its aliases. */
  name: string
  /** `name.toLowerCase()`, precomputed so the ranking scan (GRO-2197) allocates nothing per keystroke. */
  lower: string
  /** Row text: the basename, or `Alias — Basename` (the alias row's disambiguation). */
  label: string
  /** Absolute path — the open action's target. */
  path: string
  /** Root-relative folder for the row's secondary label ('' at the vault root). */
  folder: string
}

/** Result cap for title search — a scrollable result list, not the `[[` picker's MAX_SUGGESTIONS popup. */
export const SEARCH_CAP = 50

/**
 * Candidates for one index snapshot, in records order (i.e. path-sorted): every record under its
 * basename, followed by one row per frontmatter alias. An alias equal to its own basename
 * (case-insensitively) is SKIPPED — it would only duplicate the row above it (mirrors
 * `linkCandidates`' degenerate-alias skip).
 */
export function searchCandidates(records: readonly IndexRecord[]): SearchCandidate[] {
  return records.flatMap((r) => {
    const row = (name: string, label: string): SearchCandidate => ({ name, lower: name.toLowerCase(), label, path: r.path, folder: r.folder })
    const aliases = r.aliases.filter((alias) => alias.toLowerCase() !== r.basename.toLowerCase())
    return [row(r.basename, r.basename), ...aliases.map((alias) => row(alias, `${alias} — ${r.basename}`))]
  })
}

/** Rows matching `query`, ranked exact → prefix → substring by the shared matcher, capped at SEARCH_CAP. */
export function searchTitles(candidates: readonly SearchCandidate[], query: string): SearchCandidate[] {
  return matchLinkCandidates(candidates, query, SEARCH_CAP)
}
