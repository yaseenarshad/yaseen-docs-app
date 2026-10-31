/** The pure parts of the perf harness (YAZ-2131 1C): run order, summaries, the work-dir guard and the fixtures. */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { noisePng, sentinel, writeCode, writeDrawing, writeNote } from './genVault.mjs'
import { abba, loadSensitive, overCeilings, slope, summarizeRuns } from './lib/stats.mjs'
import * as longDay from './scenarios/long-day.mjs'
import { flowDiagram } from './scenarios/drawio.mjs'
import { claimWorkDir, writeState } from './lib/work.mjs'
import { parseFootprint } from './lib/app.mjs'
import { RING, crosses, seedVaults } from './scenarios/multi-vault.mjs'
import { NOTES } from './scenarios/typing.mjs'
import { BIG_CODE_LINES, bigCodeText, writeBigCode } from './scenarios/bigCode.mjs'

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

describe('perf ceilings (YAZ-3044 A19)', () => {
  it('names each median over its ceiling by more than the tolerance, for its own scenario only', () => {
    const ceilings = { 'drawio.drawioOpenMs': { max: 760, target: 650 }, 'launch.x': { max: 1 }, $comment: 'text' }
    expect(overCeilings('drawio', { drawioOpenMs: { median: 870 } }, ceilings, 0.15)).toEqual([])
    expect(overCeilings('drawio', { drawioOpenMs: { median: 880 } }, ceilings, 0.15)).toEqual(['drawio.drawioOpenMs median 880 > ceiling 760'])
    expect(overCeilings('drawio', { drawioOpenMs: { median: null } }, ceilings, 0)).toEqual([])
  })

  it('a row\'s own tolerance wins over perfTolerance: long-day\'s ratio ceiling 1.1 fails at 1.11, not only past 1.265 (YAZ-3861)', () => {
    const ceilings = { 'long-day.heapEndOverStartRatio': { max: 1.1, tolerance: 0 } }
    expect(overCeilings('long-day', { heapEndOverStartRatio: { median: 1.1 } }, ceilings, 0.15)).toEqual([])
    expect(overCeilings('long-day', { heapEndOverStartRatio: { median: 1.11 } }, ceilings, 0.15)).toEqual(['long-day.heapEndOverStartRatio median 1.11 > ceiling 1.1'])
    // Under 10 a summary keeps 2 decimals, so 1.14 is not rounded down to a passing 1.1.
    expect(summarizeRuns([{ r: 1.144 }, { r: 123.44 }]).r).toMatchObject({ min: 1.14, max: 123.4 })
  })

  it('budget.json holds long-day\'s four ceilings and long-day-open\'s one at tolerance 0: ratio 1.1, slope 1 MB per cycle, footprint 300 MB, worker heap 10 MB, heap after a wake (YAZ-3737 D7, YAZ-3862, YAZ-3870, YAZ-3915)', () => {
    const { perf } = JSON.parse(fs.readFileSync(new URL('./budget.json', import.meta.url), 'utf8'))
    expect(perf['long-day.heapEndOverStartRatio']).toMatchObject({ max: 1.1, tolerance: 0 })
    expect(perf['long-day.heapSlopeMbPerCycle']).toMatchObject({ max: 1, tolerance: 0 })
    expect(perf['long-day.rendererFootprintEndMb']).toMatchObject({ max: 300, tolerance: 0 })
    expect(perf['long-day.workerHeapEndMb']).toMatchObject({ max: 10, tolerance: 0 })
    // RSS swings with memory pressure on macOS (YAZ-3915): reported, never gated.
    expect(perf['long-day.rendererRssEndMb']).toBeUndefined()
    // long-day-open's one row (YAZ-3915): the JS heap with the tabs asleep and one woken; RSS swings with memory pressure.
    expect(perf['long-day-open.heapAfterWakeMb']).toMatchObject({ max: 55, tolerance: 0 })
    // None is load-sensitive: the names end in neither Ms, Sec nor Pct.
    expect(Object.keys(perf).filter((k) => k.startsWith('long-day') && loadSensitive(k))).toEqual([])
  })

  it('budget.json keeps Draw\'s draw.io open ceiling (YAZ-3028 D5)', () => {
    const budget = JSON.parse(fs.readFileSync(new URL('./budget.json', import.meta.url), 'utf8'))
    expect(budget.perf['drawio.drawioOpenMs']).toEqual({ max: 760, target: 650 })
    expect(budget.perfTolerance).toBe(0.15)
  })

  it('the draw.io fixture is n boxes joined in a line', () => {
    const xml = flowDiagram(4)
    expect(xml.startsWith('<mxfile')).toBe(true)
    expect(xml.match(/vertex="1"/g)).toHaveLength(4)
    expect(xml.match(/edge="1"/g)).toHaveLength(3)
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
    expect(s.settings).toEqual({})
  })

  it('long-day and long-day-open seed the memory reload off, so no reload lands in the run (YAZ-3915)', () => {
    const profile = tmp()
    expect(longDay.SETTINGS).toEqual({ memoryReload: false })
    writeState(profile, [{ id: 'w1', root: '/v', tabs: [] }], longDay.SETTINGS)
    expect(JSON.parse(fs.readFileSync(path.join(profile, 'yaseendocs.json'), 'utf8')).settings).toEqual({ memoryReload: false })
  })

  it('multi-vault seeds ONE window on two vaults: `roots` holds both, `root` is the first, and the tabs are of both (YAZ-2602)', () => {
    const profile = tmp()
    seedVaults(profile, ['/a', '/b'], ['/a/1.md', '/a/2.md', '/b/1.md', '/b/2.md'])
    const s = JSON.parse(fs.readFileSync(path.join(profile, 'yaseendocs.json'), 'utf8'))
    expect(s.windows.map((w) => [w.id, w.root, w.roots, w.file])).toEqual([['w1', '/a', ['/a', '/b'], '/a/1.md']])
    expect(s.windows[0].tabs).toEqual(['/a/1.md', '/a/2.md', '/b/1.md', '/b/2.md'])
  })

  it('typing has the prose note twice, and the two rows differ by the Section indent switch alone (YAZ-2724)', () => {
    const rows = Object.fromEntries(NOTES.map(([key, ...note]) => [key, note]))
    expect(rows.prose5k).toEqual(['Prose 5k', 'prose', 5000])
    expect(rows.prose5kIndent).toEqual([...rows.prose5k, true])
    // The rows from before it keep their keys, so their numbers still line up with baseline.json.
    expect(NOTES.slice(0, 2).map(([key, , kind]) => [key, kind])).toEqual([['bullets5k', 'bullets'], ['bullets20k', 'bullets']])
  })

  it('the prose note is the one made of top-level blocks: three times the bullet note of its length (YAZ-2724)', () => {
    const dir = tmp()
    // A block is a run of lines between blank lines; a list is one.
    const blocks = (name, kind) => fs.readFileSync(writeNote(dir, name, kind, 5000), 'utf8').split(/\n{2,}/).filter((part) => part.trim() !== '').length
    expect([blocks('Prose 5k', 'prose'), blocks('Bullets 5k', 'bullets')]).toEqual([1821, 596])
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

describe('the 5 MB code file of open-big-code and typing-code (YAZ-3501)', () => {
  it('is big-5mb.ts: a comment, then 52,000 constants, about 5 MB, written afresh each time', () => {
    const text = bigCodeText()
    const lines = text.split('\n')
    expect(lines).toHaveLength(BIG_CODE_LINES + 2)
    expect(lines[1]).toBe("export const value0 = { id: 0, name: 'row 0', tags: ['alpha', 'beta', 'gamma'], active: false }")
    expect(text.length).toBeGreaterThan(5_000_000)
    const dir = tmp()
    const file = writeBigCode(dir)
    fs.writeFileSync(file, 'typed into')
    expect(fs.readFileSync(writeBigCode(dir), 'utf8')).toBe(text)
  })
})

describe('long-day (YAZ-3861, YAZ-3737 D7)', () => {
  it('is opt-in, one run, no warm-up', () => {
    expect([longDay.optIn, longDay.runs, longDay.warmup]).toEqual([true, 1, 0])
  })

  it('the slope is the least-squares growth per cycle over every cycle; the ratio is the last cycle over cycle 3, after the warm cycles (YAZ-3862)', () => {
    expect(slope([100, 102, 104, 106])).toBe(2)
    expect(slope([300, 310, 310, 300])).toBe(0)
    expect(slope([42])).toBe(0)
    expect(longDay.WARM_CYCLES).toBe(2)
    expect(longDay.leakMetrics([180, 190, 200, 210, 220])).toEqual({ heapCycle1Mb: 180, heapStartMb: 200, heapEndMb: 220, heapEndOverStartRatio: 1.1, heapSlopeMbPerCycle: 10 })
    // Fewer cycles than that: the last one is the start.
    expect(longDay.leakMetrics([40, 42])).toMatchObject({ heapCycle1Mb: 40, heapStartMb: 42, heapEndOverStartRatio: 1 })
  })

  it('parseFootprint reads each process of `footprint -f bytes` as MB (YAZ-3862)', () => {
    const text = '====\nElectron Helper (Renderer) [52742]: 64-bit    Footprint: 487587840 B (16384 bytes per page)\n====\n====\nElectron Helper (Renderer) [7]: 64-bit    Footprint: 1048576 B (16384 bytes per page)\n'
    expect(parseFootprint(text)).toEqual(new Map([[52742, 465], [7, 1]]))
    expect(parseFootprint('')).toEqual(new Map())
  })

  it('a cycle opens 20 files of every kind the issue names, once each', () => {
    const dir = tmp()
    const fx = longDay.setup(dir, { cycles: 3, snapshots: path.join(dir, 'snapshots') })
    expect(fx.files).toHaveLength(20)
    expect(new Set(fx.files.map((f) => f.file)).size).toBe(20)
    const count = (kind) => fx.files.filter((f) => f.kind === kind).length
    expect([count('note'), count('diagram'), count('drawing'), count('code'), count('bigCode')]).toEqual([15, 1, 1, 2, 1])
    expect(fx.files.map((f) => path.basename(f.file)).filter((b) => !b.endsWith('.md'))).toEqual(['Flow.drawio', 'Sketch.excalidraw', 'Small TS.ts', 'Small PY.py', 'big-5mb.ts'])
    expect(fx.files.every((f) => f.file.startsWith(fx.vault + path.sep) && fs.existsSync(f.file))).toBe(true)
    expect(fs.readdirSync(fx.emptyVault)).toEqual([])
    expect(fs.existsSync(fx.snapshots)).toBe(true)
  })

  it('the drawing carries its pictures in `files`: one PNG per image element, real and the same every time (D14)', () => {
    const [a, b] = [tmp(), tmp()]
    const text = fs.readFileSync(writeDrawing(a, 'Sketch'), 'utf8')
    expect(fs.readFileSync(writeDrawing(b, 'Sketch'), 'utf8')).toBe(text)
    const scene = JSON.parse(text)
    const images = scene.elements.filter((e) => e.type === 'image')
    expect(images).toHaveLength(3)
    for (const { fileId } of images) {
      const png = Buffer.from(scene.files[fileId].dataURL.replace('data:image/png;base64,', ''), 'base64')
      expect(png.subarray(1, 4).toString()).toBe('PNG')
      expect(png.readUInt32BE(16)).toBe(256) // IHDR width
    }
    expect(noisePng(8, 1).equals(noisePng(8, 1))).toBe(true)
    expect(noisePng(8, 1).equals(noisePng(8, 2))).toBe(false)
  })

  it('small code files open with their sentinel as the first line', () => {
    const dir = tmp()
    const ts = fs.readFileSync(writeCode(dir, 'Small TS', 'ts'), 'utf8').split('\n')
    const py = fs.readFileSync(writeCode(dir, 'Small PY', 'py', 30), 'utf8').split('\n')
    expect([ts[0], py[0]]).toEqual(['// sentinel-small-ts', '# sentinel-small-py'])
    expect([ts.length, py.length]).toEqual([122, 32])
  })

  it('the end of a --snapshots run removes the work dir but its snapshots', () => {
    const d = path.join(tmp(), 'work')
    const work = claimWorkDir(d)
    fs.writeFileSync(path.join(work.dirFor('long-day'), 'x'), '')
    fs.mkdirSync(path.join(work.root, 'snapshots'))
    work.remove('snapshots')
    expect(fs.readdirSync(d).sort()).toEqual(['.yaseen-docs-perf', 'snapshots'])
    expect(() => claimWorkDir(d)).not.toThrow() // still ours
  })
})
