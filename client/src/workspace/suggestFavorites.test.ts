/**
 * The third column of the new tab page (YAZ-2663 D4): "Used a lot, not a favorite yet". One pure
 * function of the record of each vault, the favorites and the time (R5). The cases are S14 to S17
 * of the record, S18 for a page that is gone, and the points the cases left open.
 */
import { describe, expect, it } from 'vitest'
import { OPEN_HALF_LIFE_MS, addOpen, type OpenStat } from '@shared/types'
import { suggestFavorites, type PathKind } from './suggestFavorites'

const NOW = 1_800_000_000_000
/** A page used `score` times' worth, last on show at `NOW`. */
const used = (score: number, last = NOW): OpenStat => ({ score, last })
/** Every path is a file that is there, but the ones named as folders or as gone. */
const kinds = (dirs: readonly string[] = [], gone: readonly string[] = []) => (path: string): PathKind | null => (gone.includes(path) ? null : dirs.includes(path) ? 'dir' : 'file')
const rows = (...args: Parameters<typeof suggestFavorites>) => suggestFavorites(...args).map((row) => [row.path, row.folder, Math.round(row.score * 100) / 100])

describe('suggestFavorites', () => {
  it('S15: three uses a day apart make a file a row; two do not', () => {
    const day = 24 * 60 * 60 * 1000
    const uses = (n: number) => Array.from({ length: n }, (_, i) => NOW - (n - 1 - i) * day).reduce((opens, at) => addOpen(opens, '/v/a.md', at), {} as Record<string, OpenStat>)
    expect(rows([{ root: '/v', opens: uses(3) }], [], NOW, kinds()).map(([path]) => path)).toEqual(['/v/a.md'])
    expect(rows([{ root: '/v', opens: uses(2) }], [], NOW, kinds())).toEqual([])
  })

  it('S14: 5 rows at most, the highest score first, from every vault of the window', () => {
    const v = { root: '/v', opens: { '/v/a.md': used(4), '/v/b.md': used(9), '/v/c.md': used(5), '/v/d.md': used(3) } }
    const w = { root: '/w/', opens: { '/w/x.md': used(7), '/w/y.md': used(6), '/w/z.md': used(8) } }
    expect(rows([v, w], [], NOW, kinds())).toEqual([
      ['/v/b.md', false, 9],
      ['/w/z.md', false, 8],
      ['/w/x.md', false, 7],
      ['/w/y.md', false, 6],
      ['/v/c.md', false, 5],
    ])
  })

  it('S15: a file is a row only when its score is at the limit NOW: a score is worth half after 14 days (D2)', () => {
    const opens = { '/v/just.md': used(2.5), '/v/under.md': used(2.49), '/v/old.md': used(4.9, NOW - OPEN_HALF_LIFE_MS), '/v/older.md': used(6, NOW - OPEN_HALF_LIFE_MS) }
    expect(rows([{ root: '/v', opens }], [], NOW, kinds())).toEqual([
      ['/v/older.md', false, 3],
      ['/v/just.md', false, 2.5],
    ])
  })

  it('S16: a folder is a row when 3 or more pages DIRECTLY in it are in the record; its score is their sum, and those pages are no rows of their own', () => {
    const opens = {
      // Three pages directly in Projects: one row for the folder, 4 + 1 + 1.
      '/v/Projects/a.md': used(4),
      '/v/Projects/b.md': used(1),
      '/v/Projects/c.md': used(1),
      // A page deeper is not directly in Projects: it is a row of its own.
      '/v/Projects/Alpha/deep.md': used(5),
      // Two pages are not three: each stands alone, and only the one that is used enough shows.
      '/v/Notes/a.md': used(3.5),
      '/v/Notes/b.md': used(1),
    }
    expect(rows([{ root: '/v', opens }], [], NOW, kinds())).toEqual([
      ['/v/Projects', true, 6],
      ['/v/Projects/Alpha/deep.md', false, 5],
      ['/v/Notes/a.md', false, 3.5],
    ])
  })

  it('S16: a folder needs the same score as a file, and the vault itself is never a row', () => {
    const opens = {
      // Three pages, worth 1.5 together: no row for Quiet, and none for its pages.
      '/v/Quiet/a.md': used(0.5),
      '/v/Quiet/b.md': used(0.5),
      '/v/Quiet/c.md': used(0.5),
      // Three pages at the top of the vault: the vault is no row, so each page stands alone.
      '/v/one.md': used(4),
      '/v/two.md': used(1),
      '/v/three.md': used(1),
    }
    expect(rows([{ root: '/v', opens }], [], NOW, kinds())).toEqual([['/v/one.md', false, 4]])
  })

  it('S16: a folder that was on show as a page is a folder row; with 3 pages in it, it is ONE row and its own uses add to the sum', () => {
    const opens = {
      '/v/Board': used(3),
      '/v/Projects': used(2),
      '/v/Projects/a.md': used(1),
      '/v/Projects/b.md': used(1),
      '/v/Projects/c.md': used(1),
    }
    expect(rows([{ root: '/v', opens }], [], NOW, kinds(['/v/Board', '/v/Projects']))).toEqual([
      ['/v/Projects', true, 5],
      ['/v/Board', true, 3],
    ])
  })

  it('S17: a favorite, and anything inside a favorite folder, is never a row', () => {
    const opens = {
      '/v/fav.md': used(9),
      // Inside the favorite folder Area, at any depth: the page, and the folder its pages would make.
      '/v/Area/in.md': used(8),
      '/v/Area/Sub/a.md': used(2),
      '/v/Area/Sub/b.md': used(2),
      '/v/Area/Sub/c.md': used(2),
      // A favorite folder that its pages would make a row: no row, and its pages do not come back as rows.
      '/v/Team/a.md': used(4),
      '/v/Team/b.md': used(4),
      '/v/Team/c.md': used(4),
      // A name that only starts like a favorite is no part of it.
      '/v/Area 2/x.md': used(3),
      // A folder that is no favorite counts its favorite page too: the row is the folder's.
      '/v/Mixed/fav.md': used(2),
      '/v/Mixed/b.md': used(2),
      '/v/Mixed/c.md': used(2),
    }
    expect(rows([{ root: '/v', opens }], ['/v/fav.md', '/v/Area', '/v/Team', '/v/Mixed/fav.md'], NOW, kinds())).toEqual([
      ['/v/Mixed', true, 6],
      ['/v/Area 2/x.md', false, 3],
    ])
  })

  it('S18: a page that is gone from the disk is no row, and it is not one of the 3 pages of its folder', () => {
    const opens = {
      '/v/gone.md': used(9),
      '/v/Projects/a.md': used(4),
      '/v/Projects/b.md': used(1),
      '/v/Projects/gone.md': used(1),
    }
    expect(rows([{ root: '/v', opens }], [], NOW, kinds([], ['/v/gone.md', '/v/Projects/gone.md']))).toEqual([['/v/Projects/a.md', false, 4]])
  })

  it('an empty record gives no rows, and equal scores keep one order', () => {
    expect(suggestFavorites([{ root: '/v', opens: {} }], [], NOW, kinds())).toEqual([])
    const opens = { '/v/b.md': used(3), '/v/a.md': used(3) }
    expect(rows([{ root: '/v', opens }], [], NOW, kinds())).toEqual([
      ['/v/a.md', false, 3],
      ['/v/b.md', false, 3],
    ])
  })
})
