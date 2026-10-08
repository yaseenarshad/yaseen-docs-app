/** The pure parts of the perf harness (YAZ-2131 1C): run order, summaries, the work-dir guard and the fixtures. */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { sentinel, writeNote } from './genVault.mjs'
import { abba, loadSensitive, summarizeRuns } from './lib/stats.mjs'
import { claimWorkDir, writeState } from './lib/work.mjs'
import { RING, crosses, seedVaults } from './scenarios/multi-vault.mjs'

const made = []
const tmp = () => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'perf-harness-'))
  made.push(d)
  return d
}
afterEach(() => made.splice(0).forEach((d) => fs.rmSync(d, { recursive: true, force: true })))

describe('run order and summaries', () => {
  it('interleaves two builds ABBA: each goes first in every other round', () => {
    expect([0, 1, 2, 3].map((i) => abba(i, ['A', 'B']).join(''))).toEqual(['AB', 'BA', 'AB', 'BA'])
    expect(abba(1, ['A'])).toEqual(['A'])
  })

  it('reports median and p95 per metric, and keeps a timed-out run visible as null', () => {
    const m = summarizeRuns([{ ms: 10, fds: 5 }, { ms: 30 }, { ms: 20, fds: 5 }, { ms: null }])
    expect(m.ms).toMatchObject({ median: 20, p95: 30, min: 10, max: 30, runs: [10, 30, 20, null] })
    expect(m.fds.median).toBe(5)
    expect(summarizeRuns([{ ms: null }]).ms).toEqual({ median: null, runs: [null] })
  })

  it('flags time and CPU metrics as load-sensitive, not sizes or counts', () => {
    expect(['spawnToDocMs', 'addCpuSec', 'mainCpuPct', 'mainRssMb', 'fds2k'].filter(loadSensitive)).toEqual(['spawnToDocMs', 'addCpuSec', 'mainCpuPct'])
  })
})

describe('the work dir', () => {
  it('is claimed under a temp root, marked, and removed at the end', () => {
    const d = path.join(tmp(), 'work')
    const work = claimWorkDir(d)
    fs.writeFileSync(path.join(work.dirFor('launch'), 'x'), '')
    expect(fs.readdirSync(work.dirFor('launch'))).toEqual([]) // each claim of a scenario dir starts empty
    expect(() => claimWorkDir(d)).not.toThrow() // ours: reusable
    work.remove()
    expect(fs.existsSync(d)).toBe(false)
  })

  it('refuses a dir outside the temp roots (the real profile, a real vault) and a foreign non-empty one', () => {
    expect(() => claimWorkDir(path.join(os.homedir(), 'Library/Application Support/Yaseen Docs'))).toThrow(/must be under/)
    const foreign = tmp()
    fs.writeFileSync(path.join(foreign, 'note.md'), '# mine\n')
    expect(() => claimWorkDir(foreign)).toThrow(/not made by this harness/)
    expect(fs.readFileSync(path.join(foreign, 'note.md'), 'utf8')).toBe('# mine\n')
  })
})

describe('fixtures', () => {
  it('writes the same big note every time, ending in its sentinel', () => {
    const [a, b] = [tmp(), tmp()]
    const fa = writeNote(a, 'Bullets 1k', 'bullets', 1000)
    const fb = writeNote(b, 'Bullets 1k', 'bullets', 1000)
    const text = fs.readFileSync(fa, 'utf8')
    expect(text).toBe(fs.readFileSync(fb, 'utf8'))
    expect(text.trimEnd().split('\n').at(-1)).toBe(sentinel('Bullets 1k'))
    expect(text.split('\n')).toHaveLength(1000 + 5) // # title, blank, 1000 lines, blank, sentinel, final newline
  })

  it('seeds one window per entry on the Files lens, active file = first tab', () => {
    const profile = tmp()
    writeState(profile, [{ id: 'w1', root: '/v', tabs: ['/v/a.md', '/v/b.md'] }, { id: 'w2', root: '/v', tabs: [] }])
    const s = JSON.parse(fs.readFileSync(path.join(profile, 'yaseendocs.json'), 'utf8'))
    expect(s.windows.map((w) => [w.id, w.file, w.sidebarLens])).toEqual([['w1', '/v/a.md', 'files'], ['w2', null, 'files']])
    expect(s.recents).toHaveLength(1)
  })

  it('multi-vault seeds ONE window on two vaults: `roots` holds both, `root` is the first, and the tabs are of both (YAZ-2602)', () => {
    const profile = tmp()
    seedVaults(profile, ['/a', '/b'], ['/a/1.md', '/a/2.md', '/b/1.md', '/b/2.md'])
    const s = JSON.parse(fs.readFileSync(path.join(profile, 'yaseendocs.json'), 'utf8'))
    expect(s.windows.map((w) => [w.id, w.root, w.roots, w.file])).toEqual([['w1', '/a', ['/a', '/b'], '/a/1.md']])
    expect(s.windows[0].tabs).toEqual(['/a/1.md', '/a/2.md', '/b/1.md', '/b/2.md'])
  })

  it('multi-vault takes its tab switches in a ring, so every other one stays inside a vault and every other one crosses to the other', () => {
    expect(RING.map((to, i) => [RING.at(i - 1), to, crosses(i)])).toEqual([
      ['Beta 2', 'Alpha 1', true],
      ['Alpha 1', 'Alpha 2', false],
      ['Alpha 2', 'Beta 1', true],
      ['Beta 1', 'Beta 2', false],
    ])
  })
})
