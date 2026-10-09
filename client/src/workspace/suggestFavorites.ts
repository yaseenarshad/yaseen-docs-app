import { openScore, stripSlash, type OpenStat } from '@shared/types'
import { dirname } from '../lib/paths'

/** The third column shows this many rows at most (YAZ-2663 D4). */
export const SUGGEST_MAX = 5
/**
 * A row needs this score NOW (D4): a file its own, a folder the sum of its pages'. D4 says "3 uses".
 * A use is worth a little less than 1 a moment later (D2: a score halves in 14 days), so three uses
 * are never worth a full 3. 2.5 is three uses inside about a week.
 */
export const SUGGEST_MIN_SCORE = 2.5
/** A folder is a row when this many pages directly in it are in the record (D4). */
export const SUGGEST_MIN_PAGES = 3

/** What the Files tree says a path is. */
export type PathKind = 'file' | 'dir'

/** A row of the third column: a page, or a folder that stands for the pages directly in it. */
export interface Suggestion {
  path: string
  folder: boolean
  /** What its uses are worth now. */
  score: number
}

/**
 * Pure (YAZ-2663 R5): the rows of "Used a lot, not a favorite yet", the highest score first, off
 * the record of each vault of the window, the favorites of them all and the time (D4, S14 to S17).
 * `kindOf` is the Files tree's answer: a page that is gone from the disk (null) is no row and
 * counts for no folder (S18).
 *
 * What the cases left open:
 *   - a folder row needs SUGGEST_MIN_SCORE too, as a file does;
 *   - the vault itself is never a row: the pages at its top stand alone;
 *   - a folder counts every page directly in it, a favorite page too; only a ROW is never a
 *     favorite, or inside a favorite folder;
 *   - a folder that was on show as a page of its own (a folder is a tab) is a folder row; with
 *     SUGGEST_MIN_PAGES pages in it, it is one row and its own uses add to the sum.
 */
export function suggestFavorites(
  vaults: readonly { root: string; opens: Readonly<Record<string, OpenStat>> }[],
  favorites: readonly string[],
  now: number,
  kindOf: (path: string) => PathKind | null,
): Suggestion[] {
  const rows: Suggestion[] = []
  for (const { root, opens } of vaults) {
    const top = stripSlash(root)
    const live = Object.entries(opens).flatMap(([path, stat]) => {
      const kind = kindOf(path)
      return kind === null ? [] : [{ path, folder: kind === 'dir', score: openScore(stat, now) }]
    })
    const groups = new Map<string, { pages: number; score: number }>()
    for (const page of live) {
      const dir = dirname(page.path)
      if (dir === top) continue
      const group = groups.get(dir) ?? { pages: 0, score: 0 }
      groups.set(dir, { pages: group.pages + 1, score: group.score + page.score })
    }
    for (const [dir, group] of groups) if (group.pages < SUGGEST_MIN_PAGES) groups.delete(dir)
    for (const page of live) {
      const own = groups.get(page.path)
      if (own !== undefined) own.score += page.score
      else if (!groups.has(dirname(page.path))) rows.push(page)
    }
    for (const [dir, group] of groups) rows.push({ path: dir, folder: true, score: group.score })
  }
  const favorite = (path: string): boolean => favorites.some((held) => path === held || path.startsWith(`${held}/`))
  return rows
    .filter((row) => row.score >= SUGGEST_MIN_SCORE && !favorite(row.path))
    .sort((a, b) => b.score - a.score || (a.path < b.path ? -1 : 1))
    .slice(0, SUGGEST_MAX)
}
