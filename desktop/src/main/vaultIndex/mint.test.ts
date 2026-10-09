import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { hostname, tmpdir } from 'node:os'
import path from 'node:path'
import { IDS_FILE } from '@shared/noteId'
import { VAULT_CONFIG_DIR } from '@shared/types'
import { COUNT_DIR, MADE_DAYS, MADE_MAX, _actAs, _resetMint, countNotesWith, countsOf, firstMac, highestNumber, initMint, macId, madeBy, makersOf, mintIds, readCounts, vaultIds, type CountFile } from './mint'

// The door (YAZ-2677 D4, R13 to R21): one count file for each Mac, the next number of the vault.
// Scenario record section C (S27 to S40). Each "Mac" here is one app data folder.

let root: string
let pro: string
let air: string
beforeEach(async () => {
  root = await mkdtemp(path.join(tmpdir(), 'mdapp-mint-'))
  pro = await mkdtemp(path.join(tmpdir(), 'mdapp-mint-pro-'))
  air = await mkdtemp(path.join(tmpdir(), 'mdapp-mint-air-'))
  await says({ enabled: true, letters: 'YAZ' })
  onMac(pro)
})
afterEach(async () => {
  vi.useRealTimers()
  _resetMint()
  await Promise.all([root, pro, air].map((dir) => rm(dir, { recursive: true, force: true })))
})

const idsFile = () => path.join(root, VAULT_CONFIG_DIR, IDS_FILE)
const countDir = () => path.join(root, VAULT_CONFIG_DIR, COUNT_DIR)
async function says(config: unknown): Promise<void> {
  await mkdir(path.join(root, VAULT_CONFIG_DIR), { recursive: true })
  await writeFile(idsFile(), JSON.stringify(config))
}
/** This process is now the app on the Mac whose app data folder is `dir`: nothing of the other Mac is in memory. */
function onMac(dir: string): void {
  _resetMint()
  initMint(dir)
}
/** The vault's notes hold no number higher than `top`. */
const vaultHolds = (top: number) => countNotesWith(() => top)
const countFile = async () => path.join(countDir(), `${await macId()}.json`)
const countOf = async () => JSON.parse(await readFile(await countFile(), 'utf8')) as { name: string; since: string; last: number; made: { from: number; to: number; at: string }[] }

describe("this Mac's ID (R13)", () => {
  it('is a random name made one time and kept in the app data, never the host name', async () => {
    const id = await macId()
    expect(id).toMatch(/^[0-9a-z]{12}$/)
    expect(id).not.toContain(hostname().toLowerCase())
    expect(JSON.parse(await readFile(path.join(pro, 'mac.json'), 'utf8'))).toEqual({ id })
    onMac(pro) // the app starts again
    expect(await macId()).toBe(id)
  })

  it('is another one on another Mac', async () => {
    const first = await macId()
    onMac(air)
    expect(await macId()).not.toBe(first)
  })

  it('a file that holds no ID is made again', async () => {
    await writeFile(path.join(pro, 'mac.json'), '{ "id": "../../etc" }')
    expect(await macId()).toMatch(/^[0-9a-z]{12}$/)
    await writeFile(path.join(air, 'mac.json'), 'not json')
    onMac(air)
    expect(await macId()).toMatch(/^[0-9a-z]{12}$/)
  })
})

describe('the next number (R16)', () => {
  it('S15: the first note of a new vault is number 1, with the vault\'s letters', async () => {
    expect(await mintIds(root, 1)).toEqual(['YAZ-1'])
  })

  it('S27: the highest number in the vault is 41, so the note gets 42', async () => {
    vaultHolds(41)
    expect(await mintIds(root, 1)).toEqual(['YAZ-42'])
  })

  it('S28: note 42 is deleted, and the next note gets 43: the count file remembers 42', async () => {
    vaultHolds(41)
    expect(await mintIds(root, 1)).toEqual(['YAZ-42'])
    // The note was made and deleted: the vault holds 41 again.
    expect(await mintIds(root, 1)).toEqual(['YAZ-43'])
    onMac(pro) // and after the app starts again
    vaultHolds(41)
    expect(await mintIds(root, 1)).toEqual(['YAZ-44'])
  })

  it("S29: the Pro made and deleted 42; the Air reads `last` in the Pro's count file and gives 43", async () => {
    vaultHolds(41)
    expect(await mintIds(root, 1)).toEqual(['YAZ-42'])
    const proFile = await countFile()
    const proBytes = await readFile(proFile, 'utf8')
    onMac(air)
    vaultHolds(41)
    expect(await mintIds(root, 1)).toEqual(['YAZ-43'])
    // R15: only the Mac that owns a count file writes it.
    expect(await readFile(proFile, 'utf8')).toBe(proBytes)
    expect((await readdir(countDir())).sort()).toEqual([path.basename(proFile), path.basename(await countFile())].sort())
  })

  it('S30, S31: a number that no note was written with is lost; the next note gets the next number', async () => {
    const [lost] = (await mintIds(root, 1))!
    expect(lost).toBe('YAZ-1')
    expect(await mintIds(root, 1)).toEqual(['YAZ-2'])
  })

  it('S32: two notes at the same moment get two numbers; the door serves one request at a time', async () => {
    const given = await Promise.all(Array.from({ length: 40 }, () => mintIds(root, 1)))
    expect(given.flat().map((id) => Number(id!.slice(4))).sort((a, b) => a - b)).toEqual(Array.from({ length: 40 }, (_, i) => i + 1))
    expect((await countOf()).last).toBe(40)
  })

  it('S37: a number written by hand that is higher than the count is the new floor', async () => {
    expect(await mintIds(root, 1)).toEqual(['YAZ-1'])
    vaultHolds(900)
    expect(await mintIds(root, 1)).toEqual(['YAZ-901'])
  })

  it('a caller that holds the notes gives their highest number itself, and the index is not asked', async () => {
    countNotesWith(() => {
      throw new Error('not asked')
    })
    expect(await mintIds(root, 1, 7)).toEqual(['YAZ-8'])
  })

  it('the highest number of some notes: IDs of this vault only, whatever their letters before; old IDs do not count (S20, R5)', () => {
    const notes = [{ id: 'YAZ-12' }, { id: 'OLD-40' }, { id: 'BUS-900' }, { id: 'k3m9x2pq7abc' }, {}, { id: 'yaz-13' }]
    expect(highestNumber(notes, ['YAZ', 'OLD'])).toBe(40)
    expect(highestNumber(notes, ['YAZ'])).toBe(13)
    expect(highestNumber([{ id: 'k3m9x2pq7abc' }], ['YAZ'])).toBe(0)
  })
})

describe('the count file (R14, R15, R18, R19)', () => {
  it('S39: the first number on this Mac makes the file, with `since` set to now', async () => {
    const before = Date.now()
    await mintIds(root, 1)
    const count = await countOf()
    expect(count.name).toBe(hostname())
    expect(Date.parse(count.since)).toBeGreaterThanOrEqual(before)
    expect(Date.parse(count.since)).toBeLessThanOrEqual(Date.now())
    expect(count.last).toBe(1)
    expect(count.made).toEqual([{ from: 1, to: 1, at: count.since }])
  })

  it('R18: the count is on disk before the ID comes back', async () => {
    vaultHolds(10)
    const [id] = (await mintIds(root, 1))!
    expect(id).toBe('YAZ-11')
    expect((await countOf()).last).toBe(11)
  })

  it('`since` stays; each number is added to `made` with its time', async () => {
    await mintIds(root, 1)
    const { since } = await countOf()
    await mintIds(root, 1)
    const count = await countOf()
    expect(count.since).toBe(since)
    expect(count.last).toBe(2)
    expect(count.made.map(({ from, to }) => [from, to])).toEqual([
      [1, 1],
      [2, 2],
    ])
  })

  it('R19: a sweep of many notes takes all its numbers with one write: one run in `made`', async () => {
    vaultHolds(3)
    const given = (await mintIds(root, 745))!
    expect(given).toHaveLength(745)
    expect(given[0]).toBe('YAZ-4')
    expect(given[744]).toBe('YAZ-748')
    const count = await countOf()
    expect(count.last).toBe(748)
    expect(count.made).toEqual([{ from: 4, to: 748, at: expect.any(String) }])
    // And the file of a large sweep stays small.
    expect((await readFile(await countFile(), 'utf8')).length).toBeLessThan(400)
  })

  it('S38: a count file that is not valid JSON is read as empty, and a good one is written', async () => {
    await mkdir(countDir(), { recursive: true })
    await writeFile(await countFile(), '{ "last": 7,')
    vaultHolds(5)
    expect(await mintIds(root, 1)).toEqual(['YAZ-6'])
    expect((await countOf()).last).toBe(6)
  })

  it("S38: another Mac's count file that is damaged counts as nothing, and is left as it is", async () => {
    await mkdir(countDir(), { recursive: true })
    const other = path.join(countDir(), 'aaaaaaaaaaaa.json')
    for (const bytes of ['not json', '[]', '{ "last": "9" }', '{ "last": -4 }', '{ "last": 1.5 }', '{ "last": 99999999999999999999 }']) {
      await writeFile(other, bytes)
      const [id] = (await mintIds(root, 1))!
      expect(Number(id.slice(4))).toBe((await countOf()).last)
      expect(await readFile(other, 'utf8')).toBe(bytes)
    }
    expect((await countOf()).last).toBe(6)
  })

  it("another Mac's count file that changes between two numbers is read again", async () => {
    await mkdir(countDir(), { recursive: true })
    const other = path.join(countDir(), 'aaaaaaaaaaaa.json')
    await writeFile(other, JSON.stringify({ name: 'Air', since: '2026-01-01T00:00:00.000Z', last: 10, made: [] }))
    expect(await mintIds(root, 1)).toEqual(['YAZ-11'])
    await writeFile(other, JSON.stringify({ name: 'Air', since: '2026-01-01T00:00:00.000Z', last: 250, made: [] }))
    expect(await mintIds(root, 1)).toEqual(['YAZ-251'])
    await rm(other)
    expect(await mintIds(root, 1)).toEqual(['YAZ-252'])
  })

  it('R20: the command is another process on this Mac: each reads what the other wrote to the one count file', async () => {
    expect(await mintIds(root, 1)).toEqual(['YAZ-1'])
    const file = await countFile()
    // The command ran: it gave 2 and 3.
    const held = await countOf()
    await writeFile(file, JSON.stringify({ ...held, last: 3, made: [...held.made, { from: 2, to: 3, at: held.since }] }))
    expect(await mintIds(root, 1)).toEqual(['YAZ-4'])
    expect((await countOf()).made.map(({ from, to }) => [from, to])).toEqual([
      [1, 1],
      [2, 3],
      [4, 4],
    ])
  })

  it('only `.json` files in the folder are count files; a folder or another file there is not read', async () => {
    await mkdir(path.join(countDir(), 'zzz.json'), { recursive: true })
    await writeFile(path.join(countDir(), 'notes.txt'), '{ "last": 500 }')
    expect(await mintIds(root, 1)).toEqual(['YAZ-1'])
  })

  it('reads each count file of the vault, for the issues that ask which Mac was first', async () => {
    await mintIds(root, 2)
    onMac(air)
    await mintIds(root, 1)
    const counts = await readCounts(root)
    expect([...counts.values()].map((c) => c.last).sort()).toEqual([2, 3])
    expect(counts.get(await macId())?.made).toEqual([{ from: 3, to: 3, at: expect.any(String) }])
  })
})

describe('`made` keeps 30 days (R21)', () => {
  it('drops a run that is older, and keeps one that is not', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2026-01-01T12:00:00.000Z'))
    await mintIds(root, 1)
    vi.setSystemTime(new Date('2026-01-20T12:00:00.000Z'))
    await mintIds(root, 1)
    vi.setSystemTime(new Date(Date.parse('2026-01-01T12:00:00.000Z') + MADE_DAYS * 24 * 60 * 60 * 1000 + 1))
    await mintIds(root, 1)
    const count = await countOf()
    expect(count.made.map(({ from }) => from)).toEqual([2, 3])
    // The number itself is never forgotten.
    expect(count.last).toBe(3)
    expect(count.since).toBe('2026-01-01T12:00:00.000Z')
  })

  it('and never more than its limit of runs: the oldest go first', async () => {
    await mkdir(countDir(), { recursive: true })
    const at = new Date().toISOString()
    const made = Array.from({ length: MADE_MAX + 20 }, (_, i) => ({ from: i + 1, to: i + 1, at }))
    await writeFile(await countFile(), JSON.stringify({ name: 'x', since: at, last: MADE_MAX + 20, made }))
    await mintIds(root, 1)
    const count = await countOf()
    expect(count.made).toHaveLength(MADE_MAX)
    expect(count.made[MADE_MAX - 1].from).toBe(MADE_MAX + 21)
    expect(count.made[0].from).toBe(22)
  })
})

describe("the vault's answer and letters (R9 to R12)", () => {
  it('a vault that does not use IDs gets no number, and nothing is written into it', async () => {
    for (const config of [{ enabled: false, letters: 'YAZ' }, { letters: 'YAZ' }, 'not json']) {
      await writeFile(idsFile(), typeof config === 'string' ? config : JSON.stringify(config))
      expect(await mintIds(root, 1)).toBeNull()
      expect(await readdir(path.join(root, VAULT_CONFIG_DIR))).toEqual([IDS_FILE])
    }
    await rm(path.join(root, VAULT_CONFIG_DIR), { recursive: true })
    expect(await mintIds(root, 1)).toBeNull()
    expect(await readdir(root)).toEqual([])
  })

  it('R11: a vault with no letters uses the default of its folder name, saved with the first number; each other key stays (R10)', async () => {
    await says({ enabled: true, was: ['OLD'], note: 'kept' })
    const letters = path.basename(root).toUpperCase().replace(/[^A-Z]/g, '').slice(0, 3)
    expect(await vaultIds(root)).toMatchObject({ answer: true, letters: [letters, 'OLD'], saved: false })
    expect(await mintIds(root, 1)).toEqual([`${letters}-1`])
    expect(JSON.parse(await readFile(idsFile(), 'utf8'))).toEqual({ enabled: true, was: ['OLD'], note: 'kept', letters })
    expect(await vaultIds(root)).toMatchObject({ answer: true, letters: [letters, 'OLD'], saved: true })
  })

  it('a vault that has its letters is not written to again', async () => {
    const bytes = await readFile(idsFile(), 'utf8')
    await mintIds(root, 3)
    expect(await readFile(idsFile(), 'utf8')).toBe(bytes)
  })

  it('reads the letters in any case, and `was`', async () => {
    await says({ enabled: true, letters: 'doc', was: ['yaz'] })
    expect(await vaultIds(root)).toMatchObject({ answer: true, letters: ['DOC', 'YAZ'], saved: true })
    expect(await mintIds(root, 1)).toEqual(['DOC-1'])
  })
})

describe('the cost of one number', () => {
  it('is one small atomic write: measured', async () => {
    vaultHolds(0)
    await mkdir(countDir(), { recursive: true })
    await writeFile(path.join(countDir(), 'aaaaaaaaaaaa.json'), JSON.stringify({ name: 'Air', since: '2026-01-01T00:00:00.000Z', last: 3, made: [] }))
    await mintIds(root, 1)
    const runs = 50
    const start = performance.now()
    for (let i = 0; i < runs; i++) await mintIds(root, 1)
    const each = (performance.now() - start) / runs
    console.info(`[mint] one number: ${each.toFixed(2)} ms (mean of ${runs}, 2 count files, ${(await readFile(await countFile(), 'utf8')).length} bytes)`)
    // Generous: the write is fsynced, and the CI disk is slow. A read of each count file or of the vault for each number would be far over it.
    expect(each).toBeLessThan(250)
  })
})

// What issues 5 and 6 ask of the count files (YAZ-2677 R22, R23, R33): which Mac is the vault's
// first, and which Macs gave a number.
describe('the first Mac, and the Macs that gave a number (R22, R23, R33)', () => {
  const count = (since: string, made: [from: number, to: number, at: string][] = []): CountFile => ({ name: 'mac', since, last: Math.max(0, ...made.map(([, to]) => to)), made: made.map(([from, to, at]) => ({ from, to, at })) })
  const T = (time: string) => `2026-10-09T${time}:00.000Z`
  const NOW = Date.parse(T('12:00'))

  it('the first Mac has the oldest count file; of two made at one moment, the Mac ID that is first in order; a vault with no count file has none', () => {
    expect(firstMac(new Map())).toBeUndefined()
    expect(firstMac(new Map([['bbb', count(T('10:07'))], ['zzz', count(T('09:00'))], ['aaa', count(T('11:00'))]]))).toBe('zzz')
    expect(firstMac(new Map([['bbb', count(T('09:00'))], ['aaa', count(T('09:00'))]]))).toBe('aaa')
    expect(firstMac(new Map([['only', count(T('09:00'))]]))).toBe('only')
  })

  it('the Macs that hold a number in `made`, the one that gave it first in front; a run holds each number from its first to its last', () => {
    const files = new Map([
      ['air', count(T('10:07'), [[101, 101, T('10:07')]])],
      ['pro', count(T('09:00'), [[90, 100, T('09:00')], [101, 101, T('10:00')]])],
      ['old', count(T('08:00'), [[1, 50, T('08:00')]])],
    ])
    expect(makersOf(files, 101, NOW)).toEqual([{ mac: 'pro', at: Date.parse(T('10:00')) }, { mac: 'air', at: Date.parse(T('10:07')) }])
    expect(makersOf(files, 95, NOW)).toEqual([{ mac: 'pro', at: Date.parse(T('09:00')) }])
    expect(makersOf(files, 50, NOW).map((m) => m.mac)).toEqual(['old'])
    expect(makersOf(files, 51, NOW)).toEqual([])
    expect(makersOf(files, 102, NOW)).toEqual([])
  })

  it('equal times: the Mac ID that is first in order is in front (R23, S50)', () => {
    const files = new Map([['bbb', count(T('10:00'), [[7, 7, T('10:00')]])], ['aaa', count(T('10:00'), [[7, 7, T('10:00')]])]])
    expect(makersOf(files, 7, NOW).map((m) => m.mac)).toEqual(['aaa', 'bbb'])
  })

  it('a run older than 30 days is not counted, whether or not its Mac dropped it yet (S49)', () => {
    const files = new Map([['pro', count(T('09:00'), [[7, 7, T('10:00')]])], ['air', count(T('09:30'), [[7, 7, T('10:07')]])]])
    const month = MADE_DAYS * 24 * 60 * 60 * 1000
    expect(makersOf(files, 7, Date.parse(T('10:00')) + month)).toHaveLength(2)
    expect(makersOf(files, 7, Date.parse(T('10:00')) + month + 1).map((m) => m.mac)).toEqual(['air'])
    expect(makersOf(files, 7, Date.parse(T('10:07')) + month + 1)).toEqual([])
    expect(madeBy(files.get('pro'), 7, NOW)).toBe(true)
    expect(madeBy(files.get('pro'), 8, NOW)).toBe(false)
    expect(madeBy(undefined, 7, NOW)).toBe(false)
  })

  it('`countsOf` tells this Mac from the others, and reads a count file again only when it changed', async () => {
    await mintIds(root, 2)
    const proId = await macId()
    onMac(air)
    expect((await countsOf(root)).me).not.toBe(proId)
    // The Air gave no number here yet: it has no count file, and the Pro is the first Mac.
    expect([...(await countsOf(root)).files.keys()]).toEqual([proId])
    expect(firstMac((await countsOf(root)).files)).toBe(proId)
    await mintIds(root, 1)
    const { me, files } = await countsOf(root)
    expect([...files.keys()].sort()).toEqual([me, proId].sort())
    expect(firstMac(files)).toBe(proId)
    // A count file that did not change is not parsed again: the door hands out what it holds.
    expect((await countsOf(root)).files.get(proId)).toBe(files.get(proId))
    await writeFile(path.join(countDir(), `${proId}.json`), JSON.stringify({ name: 'x', since: '2020-01-01T00:00:00.000Z', last: 2, made: [] }))
    expect((await countsOf(root)).files.get(proId)).toEqual({ name: 'x', since: '2020-01-01T00:00:00.000Z', last: 2, made: [] })
  })

  it('a count file with `last: 0` is a Mac that gave no number yet: it is read, and it can be the first Mac', async () => {
    await mkdir(countDir(), { recursive: true })
    await writeFile(path.join(countDir(), `${await macId()}.json`), JSON.stringify({ name: 'first', since: '2020-01-01T00:00:00.000Z', last: 0, made: [] }))
    expect(firstMac((await countsOf(root)).files)).toBe(await macId())
    expect(await mintIds(root, 1)).toEqual(['YAZ-1'])
    expect((await countOf()).since).toBe('2020-01-01T00:00:00.000Z')
  })

  it('two vault folders can stand for two Macs in one test: each has its own Mac ID and its own count file', async () => {
    const other = await mkdtemp(path.join(tmpdir(), 'mdapp-mint-other-'))
    try {
      await mkdir(path.join(other, VAULT_CONFIG_DIR), { recursive: true })
      await writeFile(path.join(other, VAULT_CONFIG_DIR, IDS_FILE), JSON.stringify({ enabled: true, letters: 'YAZ' }))
      _actAs(other, air)
      expect(await macId(other)).not.toBe(await macId(root))
      expect(await macId(root)).toBe(await macId())
      await mintIds(other, 1)
      expect(await readdir(path.join(other, VAULT_CONFIG_DIR, COUNT_DIR))).toEqual([`${await macId(other)}.json`])
    } finally {
      await rm(other, { recursive: true, force: true })
    }
  })
})
