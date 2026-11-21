/** Explore's empty box (YAZ-4945): Opened and Edited, and the muted times; the kept list of Explore's opens. */
import { beforeEach, describe, expect, it } from 'vitest'
import { exploreRecents, moveExploreRecent, rememberExploreRecent, reloadExploreRecents, resetExploreRecents } from './exploreRecents'
import { ago, recentSections, SECTION_CAP } from './recentSections'

const none = () => ({})

describe('the two sections', () => {
  it('Opened: Explore`s opens and the vault`s open history, each file once at its newest open, newest first, 8 at most', () => {
    const explore = Array.from({ length: 6 }, (_, i) => ({ path: `/v/e${i}.md`, at: 100 - i }))
    const opens = { '/v/e0.md': { score: 3, last: 50 }, '/v/t1.md': { score: 1, last: 99.5 }, '/v/t2.excalidraw': { score: 1, last: 10 }, '/v/t3.drawio': { score: 1, last: 5 } }
    const { opened } = recentSections({ vaults: [{ root: '/v' }], explore, opensOf: () => opens, editsOf: none })
    expect(opened.map((e) => e.path)).toEqual(['/v/e0.md', '/v/t1.md', '/v/e1.md', '/v/e2.md', '/v/e3.md', '/v/e4.md', '/v/e5.md', '/v/t2.excalidraw'])
    expect(opened).toHaveLength(SECTION_CAP)
    expect(opened[0].at).toBe(100)
  })

  it('Edited: the save log, newest first, 8 at most; a file under Opened is not repeated', () => {
    const edits = Object.fromEntries(Array.from({ length: 12 }, (_, i) => [`/v/s${i}.md`, 1000 - i]))
    const { opened, edited } = recentSections({ vaults: [{ root: '/v' }], explore: [{ path: '/v/s0.md', at: 1 }], opensOf: none, editsOf: () => edits })
    expect(opened.map((e) => e.path)).toEqual(['/v/s0.md'])
    expect(edited.map((e) => e.path)).toEqual(['/v/s1.md', '/v/s2.md', '/v/s3.md', '/v/s4.md', '/v/s5.md', '/v/s6.md', '/v/s7.md', '/v/s8.md'])
  })

  it('only pages, drawings and diagrams; only this window`s vaults; a folder-of-a-vault window only under its folder', () => {
    const explore = [
      { path: '/v/sub/a.md', at: 5 },
      { path: '/v/b.md', at: 4 },
      { path: '/other/c.md', at: 3 },
      { path: '/v/sub/p.pdf', at: 2 },
      { path: '/v/sub/d.drawio', at: 1 },
    ]
    expect(recentSections({ vaults: [{ root: '/v' }], explore, opensOf: none, editsOf: none }).opened.map((e) => e.path)).toEqual(['/v/sub/a.md', '/v/b.md', '/v/sub/d.drawio'])
    expect(recentSections({ vaults: [{ root: '/v', folder: '/v/sub' }], explore, opensOf: none, editsOf: () => ({ '/v/e.md': 9, '/v/sub/f.md': 8 }) })).toEqual({
      opened: [
        { path: '/v/sub/a.md', at: 5 },
        { path: '/v/sub/d.drawio', at: 1 },
      ],
      edited: [{ path: '/v/sub/f.md', at: 8 }],
    })
  })
})

describe('the time on the right', () => {
  const now = new Date(2026, 10, 12, 15, 0).getTime()
  it('now, minutes, hours today, yesterday, days, then the date', () => {
    expect(ago(now - 20_000, now)).toBe('now')
    expect(ago(now - 5 * 60_000, now)).toBe('5 min')
    expect(ago(now - 3 * 3_600_000, now)).toBe('3 h')
    expect(ago(new Date(2026, 10, 11, 23, 0).getTime(), now)).toBe('yesterday')
    expect(ago(new Date(2026, 10, 8, 12, 0).getTime(), now)).toBe('4 d')
    expect(ago(new Date(2026, 9, 3, 12, 0).getTime(), now)).toMatch(/Oct/)
  })
})

describe('Explore`s opens are kept', () => {
  beforeEach(() => resetExploreRecents())
  it('after a restart (read again from storage), newest first, each once; a rename and a delete follow and are kept too', () => {
    rememberExploreRecent('/v/a.md', 1)
    rememberExploreRecent('/v/b.drawio', 2)
    rememberExploreRecent('/v/a.md', 3)
    reloadExploreRecents()
    expect(exploreRecents()).toEqual([
      { path: '/v/a.md', at: 3 },
      { path: '/v/b.drawio', at: 2 },
    ])
    moveExploreRecent('/v/a.md', '/v/sub/a.md')
    moveExploreRecent('/v/b.drawio', null)
    reloadExploreRecents()
    expect(exploreRecents()).toEqual([{ path: '/v/sub/a.md', at: 3 }])
  })
})
