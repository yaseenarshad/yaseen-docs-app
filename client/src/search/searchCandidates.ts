/**
 * Title search candidates (YAZ-802): the rows the search box matches a query against, ranked by
 * the ONE completion matcher (`links/completion.ts`) so search ranks exactly like `[[`
 * completion does. 🔒 D3 on YAZ-739: the query matches the note's TITLE (YAZ-2420 🔒 D14) and its
 * frontmatter ALIASES only — `folder` rides along as the row's display label and is never matched.
 * Amended by 🔒 D2 on YAZ-1491: a note STILL never matches on its folder; the folder itself is one
 * row (`folderCandidates`, fed from the tree the Sidebar already holds — 🔒 D1), matched by its own
 * title through the same matcher, in the same flat list.
 *
 * Deliberately NOT `linkCandidates`: a link candidate must insert text that resolves back to its
 * own record, so duplicate basenames there are folder-disambiguated and only the shallowest keeps
 * the bare name. Search opens `path` directly, so there is nothing to disambiguate — every note
 * gets a row under its own title, and duplicates are told apart by the folder label.
 */
import type { IndexRecord } from '@shared/types'
import { basename, relTo } from '../lib/paths'
import { matchLinkCandidates } from '../links/completion'
import { foldersByDir } from '../links/shortcuts'

/** One search row: what the query matches, what it reads as, what activating it targets. */
export interface SearchCandidate {
  /** What the row is: a note (`file`) or a folder (`dir`). Activating either OPENS its page. */
  kind: 'file' | 'dir'
  /** The text the query matches: the note's title, one of its aliases, or the folder's title. */
  name: string
  /** `name.toLowerCase()`, precomputed so the ranking scan (GRO-2197) allocates nothing per keystroke. */
  lower: string
  /** Row text: the title, or `Alias — Title` (the alias row's disambiguation). */
  label: string
  /** Absolute path — the open (or reveal) action's target. */
  path: string
  /** Root-relative folder for the row's secondary label ('' at the vault root). */
  folder: string
  /** The note's or folder's id, on the row of its title: what `searchRows` finds it by (YAZ-2420 🔒 D32). */
  id?: string
}

/** Result cap for title search — a scrollable result list, not the `[[` picker's MAX_SUGGESTIONS popup. */
export const SEARCH_CAP = 50

/**
 * Candidates for one index snapshot, in records order (i.e. path-sorted): every record under its
 * title, followed by one row per frontmatter alias. An alias equal to its own title
 * (case-insensitively) is SKIPPED — it would only duplicate the row above it (mirrors
 * `linkCandidates`' degenerate-alias skip).
 */
export function searchCandidates(records: readonly IndexRecord[]): SearchCandidate[] {
  return records.flatMap((r) => {
    const row = (name: string, label: string): SearchCandidate => ({ kind: 'file', name, lower: name.toLowerCase(), label, path: r.path, folder: r.folder })
    const aliases = r.aliases.filter((alias) => alias.toLowerCase() !== r.title.toLowerCase())
    return [{ ...row(r.title, r.title), id: r.id }, ...aliases.map((alias) => row(alias, `${alias} — ${r.title}`))]
  })
}

/**
 * One row per folder in the loaded tree (🔒 D1, YAZ-1491): matched by its own title (YAZ-2420
 * 🔒 D14; its directory's name when it has none), labelled by its parent. `dirs` are
 * ABSOLUTE paths in tree order (`allDirs`, treeState.ts), so a folder's row sits above its
 * children's — and, spliced ahead of `searchCandidates`, above any note that ties with it in a
 * rank bucket. `folder` follows `IndexRecord.folder`: root-relative, `/`
 * separated, `''` directly under the root. A folder's title and id are its settings record's (`folders`).
 */
export function folderCandidates(root: string, dirs: readonly string[], folders: readonly IndexRecord[]): SearchCandidate[] {
  const settings = foldersByDir(folders)
  return dirs.map((dir) => {
    const rel = relTo(root, dir)
    const cut = rel.lastIndexOf('/')
    const held = settings.get(dir)
    const name = held?.title ?? basename(dir)
    return { kind: 'dir', name, lower: name.toLowerCase(), label: name, path: dir, folder: cut === -1 ? '' : rel.slice(0, cut), id: held?.id }
  })
}

/** Rows matching `query`, ranked exact → prefix → substring by the shared matcher, capped at SEARCH_CAP. */
export function searchTitles(candidates: readonly SearchCandidate[], query: string): SearchCandidate[] {
  return matchLinkCandidates(candidates, query, SEARCH_CAP)
}

/**
 * What the search box shows for `query` (YAZ-2420 🔒 D32): when the text holds the id of a note or
 * a folder anywhere in it — a pasted id, an `[[id]]` link, a file name, a whole path — exactly
 * those, each under its title; otherwise `searchTitles`. An id is held whole or not at all: no part
 * of one matches.
 */
export function searchRows(candidates: readonly SearchCandidate[], query: string): SearchCandidate[] {
  const text = query.toLowerCase()
  const held = candidates.filter((c) => c.id !== undefined && text.includes(c.id))
  return held.length > 0 ? held : searchTitles(candidates, query)
}
