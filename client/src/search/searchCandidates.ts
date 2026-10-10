/**
 * Title search candidates (YAZ-802): the rows the search box matches a query against, ranked by
 * the ONE completion matcher (`links/completion.ts`) so search ranks exactly like `[[`
 * completion does. 🔒 D3 on YAZ-739: the query matches the note's TITLE (YAZ-2420 🔒 D14) and its
 * frontmatter ALIASES only — `folder` rides along as the row's display label and is never matched.
 * Amended by 🔒 D2 on YAZ-1491: a note STILL never matches on its folder; the folder itself is one
 * row (`folderCandidates`, fed from the tree the Sidebar already holds — 🔒 D1), matched by its own
 * title through the same matcher, in the same ranking. Amended again by 🔒 D3 on YAZ-2620: the
 * search finds each row the tree shows, so a tree file that is no note is one row too
 * (`fileCandidates`), matched by its file name. The sidebar draws the ranked rows as a tree
 * (`searchTree`); the shortcut picker, over notes alone, as the flat list.
 *
 * Deliberately NOT `linkCandidates`: a link candidate must insert text that resolves back to its
 * own record, so duplicate basenames there are folder-disambiguated and only the shallowest keeps
 * the bare name. Search opens `path` directly, so there is nothing to disambiguate — every note
 * gets a row under its own title, and duplicates are told apart by the folder they stand in.
 */
import type { IndexRecord } from '@shared/types'
import { basename, relTo } from '../lib/paths'
import { matchLinkCandidates } from '../links/completion'
import { foldersByDir } from '../links/shortcuts'

/** One search row: what the query matches, what it reads as, what activating it targets. */
export interface SearchCandidate {
  /** What the row is: a note or another file (`file`), or a folder (`dir`). Enter OPENS a file's page and shows a folder in Files (YAZ-2662 D1). */
  kind: 'file' | 'dir'
  /** The text the query matches: the note's title, one of its aliases, the folder's title, or another file's name. */
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

/** Result cap for title search — scrollable results, not the `[[` picker's MAX_SUGGESTIONS popup. The sidebar says so when it is reached (🔒 D6, YAZ-2620). */
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

/**
 * One row per tree file that is not a note (🔒 D3, YAZ-2620) — a script, a PDF, an image — matched
 * by its file name, extension included. `files` are ABSOLUTE paths in tree order (`otherFiles`,
 * treeState.ts), off the tree the Sidebar already holds: no index read, no disk read. Spliced
 * BEHIND `searchCandidates`, so a tie in a rank bucket reads folder, note, other file.
 */
export function fileCandidates(root: string, files: readonly string[]): SearchCandidate[] {
  return files.map((path) => {
    const name = basename(path)
    const rel = relTo(root, path)
    const cut = rel.lastIndexOf('/')
    return { kind: 'file', name, lower: name.toLowerCase(), label: name, path, folder: cut === -1 ? '' : rel.slice(0, cut) }
  })
}

const NO_PATHS: ReadonlySet<string> = new Set()

/** `rows` with the rows at the paths of `first` before the others, each part in its own order: one look in the set for each row. */
function firstRows(rows: SearchCandidate[], first: ReadonlySet<string>): SearchCandidate[] {
  const top: SearchCandidate[] = []
  const rest: SearchCandidate[] = []
  for (const row of rows) (first.has(row.path) ? top : rest).push(row)
  return [...top, ...rest]
}

/**
 * Rows matching `query`, ranked exact → prefix → substring by the shared matcher, capped at SEARCH_CAP.
 * `first` is the paths of the rows that are a pinned item or are inside one (YAZ-2662 D4): each
 * match there goes before each other match, each part in its ranked order, and the cap cuts AFTER
 * that, so it cuts no pinned match while another match shows. Without it — the shortcut picker's
 * call — the ranking is the matcher's own.
 */
export function searchTitles(candidates: readonly SearchCandidate[], query: string, first: ReadonlySet<string> = NO_PATHS): SearchCandidate[] {
  if (first.size === 0) return matchLinkCandidates(candidates, query, SEARCH_CAP)
  return firstRows(matchLinkCandidates(candidates, query, candidates.length), first).slice(0, SEARCH_CAP)
}

/**
 * What the search box shows for `query` (YAZ-2420 🔒 D32): when the text holds the id of a note or
 * a folder anywhere in it — a pasted id, an `[[id]]` link, a file name, a whole path — exactly
 * those, each under its title; otherwise `searchTitles`. An id is held whole or not at all: no part
 * of one matches. Either way the rows of `first` lead (YAZ-2662 D4, S25).
 */
export function searchRows(candidates: readonly SearchCandidate[], query: string, first: ReadonlySet<string> = NO_PATHS): SearchCandidate[] {
  const text = query.toLowerCase()
  const held = candidates.filter((c) => c.id !== undefined && text.includes(c.id))
  return held.length > 0 ? firstRows(held, first) : searchTitles(candidates, query, first)
}
