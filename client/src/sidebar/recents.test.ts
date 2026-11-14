import { describe, expect, it } from 'vitest'
import type { TreeNode, TreeResponse } from '@shared/types'
import { byVault, MAX_RECENTS, recentDays, recentFiles, recentSections, timeOf, type RecentFile } from './recents'

const page = (path: string, kind: 'markdown' | null = 'markdown'): TreeNode => ({ type: 'file', name: path.slice(path.lastIndexOf('/') + 1), path, size: 1, mtime: 1, kind })
const dir = (path: string, children: TreeNode[]): TreeNode => ({ type: 'dir', name: path.slice(path.lastIndexOf('/') + 1), path, children })
const tree = (root: string, nodes: TreeNode[]): TreeResponse => ({ root, tree: nodes, generatedAt: 1 })
const at = (y: number, m: number, d: number, h = 12, min = 0) => new Date(y, m - 1, d, h, min).getTime()

describe('recentFiles (YAZ-3235 D3, S14, S22)', () => {
  it('S14: one list for the vaults of the window; a file that two nested vaults logged is one row, at its newest save; a vault that the window does not show adds nothing', () => {
    // `/a/b` is a vault inside the vault `/a`: both trees have `/a/b/n.md`.
    const trees = new Map([
      ['/a', tree('/a', [page('/a/x.md'), dir('/a/b', [page('/a/b/n.md')])])],
      ['/a/b', tree('/a/b', [page('/a/b/n.md')])],
      ['/w', tree('/w', [page('/w/y.md')])],
      ['/gone', tree('/gone', [page('/gone/z.md')])],
    ])
    const files = recentFiles(trees, ['/a', '/a/b', '/w'], [{ '/a/x.md': 10, '/a/b/n.md': 20 }, { '/a/b/n.md': 30 }, { '/w/y.md': 25 }])
    expect(files).toEqual([
      { path: '/a/b/n.md', edited: 30 },
      { path: '/w/y.md', edited: 25 },
      { path: '/a/x.md', edited: 10 },
    ])
    // `/gone` has a tree and a log, but it is not a vault of the window.
    expect(recentFiles(trees, ['/w'], [{ '/w/y.md': 25, '/gone/z.md': 99 }])).toEqual([{ path: '/w/y.md', edited: 25 }])
  })

  it('YAZ-4450 D5: `only` keeps the files of that vault, the most specific one — the rule of its Recents group — before the 200 cut', () => {
    const trees = new Map([
      ['/a', tree('/a', [page('/a/x.md'), dir('/a/b', [page('/a/b/n.md')])])],
      ['/a/b', tree('/a/b', [page('/a/b/n.md')])],
      ['/w', tree('/w', [page('/w/y.md')])],
    ])
    // `/a` logged `/a/b/n.md` while it was open alone: that file is the nested vault's, in its filter and in its group.
    const logs: Record<string, number>[] = [{ '/a/x.md': 10, '/a/b/n.md': 20 }, {}, { '/w/y.md': 25 }]
    expect(recentFiles(trees, ['/a', '/a/b', '/w'], logs, '/a')).toEqual([{ path: '/a/x.md', edited: 10 }])
    expect(recentFiles(trees, ['/a', '/a/b', '/w'], logs, '/a/b')).toEqual([{ path: '/a/b/n.md', edited: 20 }])
    expect(byVault(recentFiles(trees, ['/a', '/a/b', '/w'], logs), ['/a', '/a/b', '/w']).map((g) => [g.root, g.files.map((f) => f.path)])).toEqual([['/a', ['/a/x.md']], ['/a/b', ['/a/b/n.md']], ['/w', ['/w/y.md']]])
    const many = Object.fromEntries(Array.from({ length: MAX_RECENTS + 5 }, (_, i) => [`/w/n${i}.md`, 1000 + i]))
    const big = new Map([...trees, ['/w', tree('/w', Object.keys(many).map((p) => page(p)))]])
    expect(recentFiles(big, ['/a', '/w'], [{ '/a/x.md': 1 }, many], '/a')).toEqual([{ path: '/a/x.md', edited: 1 }]) // never cut away by the other vault's 200
  })

  it('S7, S22: a logged file that the tree no longer has, a folder, and a file that the app cannot open (kind null) draw no row; a vault with no tree yet adds nothing', () => {
    const trees = new Map([['/v', tree('/v', [page('/v/a.md'), page('/v/b.zip', null), dir('/v/sub', [])])]])
    expect(recentFiles(trees, ['/v', '/w'], [{ '/v/a.md': 1, '/v/b.zip': 2, '/v/sub': 3, '/v/moved.md': 4 }, { '/w/a.md': 5 }])).toEqual([{ path: '/v/a.md', edited: 1 }])
    expect(recentFiles(new Map(), ['/v'], [{ '/v/a.md': 1 }])).toEqual([])
  })

  it('equal times stand in path order; a new tree is read again', () => {
    const first = tree('/v', [page('/v/c.md'), page('/v/a.md'), page('/v/b.md')])
    const log = { '/v/c.md': 5, '/v/b.md': 5, '/v/a.md': 5, '/v/d.md': 6 }
    expect(recentFiles(new Map([['/v', first]]), ['/v'], [log]).map((f) => f.path)).toEqual(['/v/a.md', '/v/b.md', '/v/c.md'])
    // The watcher brings a tree with `d.md`: a new object, so its files are read again.
    const next = tree('/v', [...first.tree, page('/v/d.md')])
    expect(recentFiles(new Map([['/v', next]]), ['/v'], [log]).map((f) => f.path)).toEqual(['/v/d.md', '/v/a.md', '/v/b.md', '/v/c.md'])
  })

  it(`S21: more than ${MAX_RECENTS} logged files: the ${MAX_RECENTS} newest`, () => {
    const paths = Array.from({ length: 250 }, (_, i) => `/v/n${i}.md`)
    const log = Object.fromEntries(paths.map((path, i) => [path, i]))
    const files = recentFiles(new Map([['/v', tree('/v', paths.map((p) => page(p)))]]), ['/v'], [log])
    expect(files).toHaveLength(MAX_RECENTS)
    expect([files[0], files[MAX_RECENTS - 1]]).toEqual([{ path: '/v/n249.md', edited: 249 }, { path: '/v/n50.md', edited: 50 }])
  })
})

describe('recentDays and timeOf (YAZ-3235 D5, D6, S15)', () => {
  const now = new Date(at(2026, 10, 23, 9))
  const file = (edited: number, path = `/v/${edited}.md`): RecentFile => ({ path, edited })
  const date = (ms: number, year: boolean) => new Date(ms).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric', year: year ? 'numeric' : undefined })

  it('S15: "Today", "Yesterday", then the date with weekday, month and day; the year only when it is not this year', () => {
    const files = [file(at(2026, 10, 23, 8)), file(at(2026, 10, 23, 0, 0)), file(at(2026, 10, 22, 23, 59)), file(at(2026, 10, 20)), file(at(2026, 1, 1, 0, 0)), file(at(2025, 12, 31, 23, 59))]
    const days = recentDays(files, now)
    expect(days.map((d) => [d.label, d.files.length])).toEqual([
      ['Today', 2],
      ['Yesterday', 1],
      [date(at(2026, 10, 20), false), 1],
      [date(at(2026, 1, 1), false), 1],
      [date(at(2025, 12, 31), true), 1],
    ])
    expect(days[2].label).not.toMatch(/2026/)
    expect(days[4].label).toMatch(/2025/)
    expect(days.map((d) => d.key)).toEqual([now.toDateString(), new Date(at(2026, 10, 22)).toDateString(), new Date(at(2026, 10, 20)).toDateString(), new Date(at(2026, 1, 1)).toDateString(), new Date(at(2025, 12, 31)).toDateString()])
    expect(recentDays([], now)).toEqual([])
  })

  it('"Yesterday" holds on the first day of a month and of a year', () => {
    expect(recentDays([file(at(2026, 2, 28, 22))], new Date(at(2026, 3, 1, 1)))[0].label).toBe('Yesterday')
    expect(recentDays([file(at(2025, 12, 31, 22))], new Date(at(2026, 1, 1, 1)))[0].label).toBe('Yesterday')
  })

  it('D6: the time of a save is hour and minute', () => {
    expect(timeOf(at(2026, 10, 23, 15, 42))).toBe(new Date(at(2026, 10, 23, 15, 42)).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' }))
    expect(timeOf(at(2026, 10, 23, 15, 42))).toMatch(/42/)
  })
})

describe('byVault and the Recents menu (YAZ-4450 D5, D7, D8)', () => {
  const f = (path: string, edited: number): RecentFile => ({ path, edited })

  it('byVault cuts a day by the vault that holds each file, the most specific one, in the window\'s vault order, each group newest first', () => {
    const files = [f('/w/x.md', 9), f('/v/sub/n.md', 8), f('/v/a.md', 7), f('/w/y.md', 6)]
    expect(byVault(files, ['/v', '/w'])).toEqual([
      { root: '/v', files: [f('/v/sub/n.md', 8), f('/v/a.md', 7)] },
      { root: '/w', files: [f('/w/x.md', 9), f('/w/y.md', 6)] },
    ])
    // D8: the window's order, not the newest save; a vault with no file that day has no group; a nested vault takes its own files.
    expect(byVault(files, ['/w', '/v', '/v/sub', '/empty']).map((g) => [g.root, g.files.length])).toEqual([['/w', 2], ['/v', 1], ['/v/sub', 1]])
  })

  it('the menu: "All vaults" apart, then each vault, ✓ on the pick; "Group by vault" last, only while all vaults show', () => {
    const vaults = [{ root: '/v', name: 'Pages' }, { root: '/w', name: 'Work' }]
    const picks: (string | null)[] = []
    const grouped = { on: true, set: (on: boolean) => picks.push(on ? 'on' : 'off') }
    const all = recentSections(vaults, null, (root) => picks.push(root), grouped)
    expect(all.map((group) => group.map((item) => `${item.label}${'hint' in item && item.hint !== undefined ? item.hint : ''}`))).toEqual([['All vaults✓'], ['Pages', 'Work'], ['Group by vault✓']])
    const work = all[1][1]
    if ('onSelect' in work) work.onSelect?.()
    const group = all[2][0]
    if ('onSelect' in group) group.onSelect?.()
    expect(picks).toEqual(['/w', 'off'])
    const one = recentSections(vaults, '/w', () => undefined, grouped)
    expect(one.map((g) => g.map((item) => `${item.label}${'hint' in item && item.hint !== undefined ? item.hint : ''}`))).toEqual([['All vaults'], ['Pages', 'Work✓']])
  })
})
