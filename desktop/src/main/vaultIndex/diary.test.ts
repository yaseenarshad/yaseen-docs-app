// The diary (YAZ-2677 D7, R21, R27): what one Mac remembers, in its app data, about the links to
// the IDs it made in one vault. The whole fix that reads it is in `twoMacs.test.ts`.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { IDS_FILE } from '@shared/noteId'
import { VAULT_CONFIG_DIR, type IndexRecord } from '@shared/types'
import { CLASHES_MAX, LINKS_MAX, _resetDiary, flushDiaries, namedIds, openDiary, saveDiary, see } from './diary'
import { MADE_DAYS, _actAs, _resetMint, countsOf, mintIds } from './mint'

let root: string
let appData: string
const LETTERS = ['YAZ']
const DAY = 24 * 60 * 60 * 1000

beforeEach(async () => {
  vi.useFakeTimers({ toFake: ['Date', 'setTimeout', 'clearTimeout'] })
  vi.setSystemTime(new Date('2026-10-09T10:00:00.000Z'))
  root = await mkdtemp(path.join(tmpdir(), 'mdapp-diary-'))
  appData = await mkdtemp(path.join(tmpdir(), 'mdapp-diary-app-'))
  _actAs(root, appData)
  await mkdir(path.join(root, VAULT_CONFIG_DIR), { recursive: true })
  await writeFile(path.join(root, VAULT_CONFIG_DIR, IDS_FILE), JSON.stringify({ enabled: true, letters: 'YAZ' }))
})
afterEach(async () => {
  _resetDiary()
  _resetMint()
  vi.useRealTimers()
  await Promise.all([root, appData].map((dir) => rm(dir, { recursive: true, force: true })))
})

const record = (name: string, over: Partial<IndexRecord> = {}): IndexRecord => ({ path: path.join(root, name), name, basename: name.replace(/\.md$/, ''), title: name, folder: '', ext: 'md', size: 1, ctime: 1, mtime: 1, properties: {}, aliases: [], tags: [], links: [], embeds: [], ...over })
/** The diary as a sweep opens it now. */
const book = async () => openDiary(root, await countsOf(root), LETTERS, Date.now())
const files = async (): Promise<string[]> => readdir(path.join(appData, 'id-diary')).catch(() => [])
const onDisk = async (): Promise<{ links: Record<string, Record<string, number>>; clashes: Record<string, unknown> }> => JSON.parse(await readFile(path.join(appData, 'id-diary', (await files())[0]), 'utf8'))

describe('namedIds: each ID a note names', () => {
  it('a link, an embed, an `also_in` entry and a link place of a folder’s settings, as the app writes an ID; names and old IDs are left out', () => {
    const r = record('a.md', {
      links: ['yaz-7', 'Some note', 'YAZ-12', '6cbnmcq5n2sj', 'YAZ-7'],
      embeds: ['YAZ-3'],
      properties: { also_in: ['yaz-9', 'not an id'], folder_settings: { views: [{ type: 'table', order: ['[[YAZ-4|x]]', '[[Name]]'] }] } },
    })
    expect(namedIds(r).sort()).toEqual(['YAZ-12', 'YAZ-3', 'YAZ-4', 'YAZ-7', 'YAZ-9'])
    expect(namedIds(record('b.md', { links: ['Just a name'] }))).toEqual([])
  })
})

describe('the diary of links (R27)', () => {
  it('keeps the file and the time when the index first sees a link to an ID THIS Mac made, and keeps that first time', async () => {
    await mintIds(root, 2, 0)
    const plan = record('plan.md', { links: ['YAZ-1'] })
    see(root, plan, Date.now())
    vi.setSystemTime(new Date('2026-10-09T10:30:00.000Z'))
    see(root, plan, Date.now())
    see(root, record('log.md', { properties: { also_in: ['yaz-2'] } }), Date.now())
    const links = (await book()).links
    expect([...links.keys()].sort()).toEqual(['YAZ-1', 'YAZ-2'])
    expect(links.get('YAZ-1')).toEqual(new Map([[plan.path, Date.parse('2026-10-09T10:00:00.000Z')]]))
    expect(links.get('YAZ-2')).toEqual(new Map([[path.join(root, 'log.md'), Date.parse('2026-10-09T10:30:00.000Z')]]))
  })

  it('does not keep a link to an ID another Mac made, to an ID of another vault, or to a name', async () => {
    await mintIds(root, 1, 0)
    see(root, record('a.md', { links: ['YAZ-2', 'BUS-1', 'GPT-4', 'A name'] }), Date.now())
    expect((await book()).links.size).toBe(0)
  })

  it('an index event writes no file: the write comes later, one for all of them, and at quit', async () => {
    await mintIds(root, 1, 0)
    for (let i = 0; i < 50; i++) see(root, record(`n${i}.md`, { links: ['YAZ-1'] }), Date.now())
    expect(await files()).toEqual([])
    await vi.advanceTimersByTimeAsync(1999)
    expect(await files()).toEqual([])
    await flushDiaries()
    expect(await files()).toHaveLength(1)
    expect(Object.keys((await onDisk()).links['YAZ-1'])).toHaveLength(50)
    // Nothing new: nothing is written again.
    const before = await readFile(path.join(appData, 'id-diary', (await files())[0]), 'utf8')
    see(root, record('n1.md', { links: ['YAZ-1'] }), Date.now())
    await flushDiaries()
    expect(await readFile(path.join(appData, 'id-diary', (await files())[0]), 'utf8')).toBe(before)
  })

  it('is read back after a restart, and a file that is not a diary of this vault is an empty diary', async () => {
    await mintIds(root, 1, 0)
    const plan = record('plan.md', { links: ['YAZ-1'] })
    see(root, plan, Date.now())
    const first = await book()
    first.clashes.set('YAZ-1', { mine: plan.path, at: Date.now(), to: 'YAZ-2', links: 3, done: true })
    first.dirty = true
    await saveDiary(root)
    _resetDiary()
    const again = await book()
    expect(again.links.get('YAZ-1')?.get(plan.path)).toBe(Date.parse('2026-10-09T10:00:00.000Z'))
    expect(again.clashes.get('YAZ-1')).toEqual({ mine: plan.path, at: Date.now(), to: 'YAZ-2', links: 3, done: true })
    _resetDiary()
    await writeFile(path.join(appData, 'id-diary', (await files())[0]), '{ "version": 1, "root": "/another/vault", "links": { "YAZ-1": { "/x.md": 1 } } }')
    expect((await book()).links.size).toBe(0)
    _resetDiary()
    await writeFile(path.join(appData, 'id-diary', (await files())[0]), '{ not json')
    expect((await book()).links.size).toBe(0)
  })

  it('an entry leaves when its ID leaves `made` after 30 days, and a pair that was seen 30 days ago too (R21)', async () => {
    await mintIds(root, 1, 0)
    see(root, record('plan.md', { links: ['YAZ-1'] }), Date.now())
    const first = await book()
    first.clashes.set('YAZ-1', { mine: 'x', at: Date.now() })
    expect(first.links.size).toBe(1)
    vi.setSystemTime(new Date(Date.parse('2026-10-09T10:00:00.000Z') + MADE_DAYS * DAY + 1))
    const later = await book()
    expect(later.links.size).toBe(0)
    expect(later.clashes.size).toBe(0)
  })

  it('an ID written with letters the vault had before is kept under the letters of now', async () => {
    await mintIds(root, 1, 0)
    see(root, record('plan.md', { links: ['YAZ-1'] }), Date.now())
    await book()
    const renamed = await openDiary(root, await countsOf(root), ['DOC', 'YAZ'], Date.now())
    expect([...renamed.links.keys()]).toEqual(['DOC-1'])
    see(root, record('log.md', { links: ['yaz-1'] }), Date.now())
    expect([...(await openDiary(root, await countsOf(root), ['DOC', 'YAZ'], Date.now())).links.get('DOC-1')!.keys()].map((file) => path.basename(file)).sort()).toEqual(['log.md', 'plan.md'])
  })

  it(`holds ${CLASHES_MAX} pairs at most: the ones seen longest ago leave first`, async () => {
    const first = await book()
    for (let i = 0; i < CLASHES_MAX + 3; i++) first.clashes.set(`YAZ-${i + 1}`, { mine: `/n${i}.md`, at: Date.now() + i })
    const kept = await book()
    expect(kept.clashes.size).toBe(CLASHES_MAX)
    expect([kept.clashes.has('YAZ-1'), kept.clashes.has('YAZ-3'), kept.clashes.has('YAZ-4'), kept.clashes.has(`YAZ-${CLASHES_MAX + 3}`)]).toEqual([false, false, true, true])
  })

  it(`holds ${LINKS_MAX} entries at most: one past the limit is not kept`, async () => {
    await mintIds(root, 1, 0)
    for (let i = 0; i < LINKS_MAX + 25; i++) see(root, record(`n${i}.md`, { links: ['YAZ-1'] }), Date.now())
    expect((await book()).links.get('YAZ-1')?.size).toBe(LINKS_MAX)
  })
})
