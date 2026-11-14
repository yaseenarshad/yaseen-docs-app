import { describe, expect, it } from 'vitest'
import {
  INDEX_FILE,
  LIST_VERSION,
  NUMBERS_FILE,
  POINTER_FILE,
  LIST_NEEDS_REPAIR,
  SETTLE_MS,
  WRITE_GAP_MS,
  agoLabel,
  ensureFriendsFiles,
  findFriendsIndex,
  makePointer,
  parseFriendsIndex,
  readListFiles,
  readFriend,
  relinkPointers,
  replaceNumbersGist,
  updatedAgo,
  writeFriendsIndex,
  type FriendReadCache,
  type FriendsIndex,
  type WriteOptions,
} from '@shared/friendGists'
import { fakeGistWorld } from '@shared/friendGistsFake'
import type { FriendStats } from '@shared/friendStats'

/**
 * YAZ-5082 (4E1): the gist files of friends, on a fake gist API (no real GitHub call). Round 16 of YAZ-5057: ONE
 * numbers gist for the person, ONE pointer gist for each friend and group, the list in `notecards-friends.json`.
 */
const T1 = 'tok-yaseen-phone'
const T2 = 'tok-yaseen-mac'
const SAM = 'tok-sam'
const NOW = Date.parse('2026-11-14T06:00:00Z')
const opts: WriteOptions = { describe: (kind) => `notecards-test ${kind}`, sleep: async () => {} }
/** For the races: each wait gives the other device real time to run (the fake's calls also wait 0 to 3 ms at random). */
const raceOpts: WriteOptions = { ...opts, sleep: (ms) => new Promise((done) => setTimeout(done, ms >= 5000 ? 25 : 2)) }
/** The friends list as the app reads it: every list file of the gist (YAZ-5312, version 2). */
const listIn = (w: ReturnType<typeof fakeGistWorld>, id: string) => readListFiles(w.owned('yaseen').find((g) => g.id === id)?.files ?? {})
const world = () =>
  fakeGistWorld({ accounts: { [T1]: { login: 'yaseen' }, [T2]: { login: 'yaseen' }, [SAM]: { login: 'sam' }, 'tok-nogists': { login: 'yaseen', gists: false } }, start: NOW })

const STATS: FriendStats = {
  v: 1,
  login: 'sam',
  name: 'Sam',
  avatar: 'https://avatars.githubusercontent.com/u/2',
  days: [{ day: '2026-11-14', cards: 12, seconds: 300, remembered: 10, forgot: 2, newCards: 3, done: true }],
  totals: { cards: 400, inReview: 300, newLeft: 90, mature: 120, dueLeft: 0, addedThisWeek: 5, streak: 4, bestStreak: 9, bestDay: 60, bestWeek: 200 },
  at: '2026-11-14T05:00:00.000Z',
}
const seed = { vaults: ['yaseen/vault'], nickname: null }

describe('the friends list file (decision 15)', () => {
  it('reads a good index, keeps unknown fields on write, and never throws', () => {
    const index: FriendsIndex = { v: 1, nickname: null, vaults: ['a/b'], stats: 'abc123', friends: [{ name: 'Sam', theirs: 'aa', mine: 'bb' }], groups: [] }
    const read = parseFriendsIndex(JSON.stringify({ ...index, later: { x: 1 } }))
    expect(read).toMatchObject({ kind: 'ok', value: index })
    expect(read.kind === 'ok' && read.raw.later).toEqual({ x: 1 })
    expect(parseFriendsIndex(JSON.stringify({ ...index, v: 2 }))).toEqual({ kind: 'newer' })
    // Only a file that is not a JSON object with `v: 1` is unreadable (YAZ-5191).
    for (const bad of ['', '{', 'null', '[]', '{"v":0}', '"text"']) expect(parseFriendsIndex(bad).kind).toBe('unreadable')
    // Entry by entry: a bad entry is left out of the value; the others stay.
    const mixed = parseFriendsIndex(JSON.stringify({ ...index, friends: [{ name: 1 }, ...index.friends] }))
    expect(mixed).toMatchObject({ kind: 'ok', value: { friends: index.friends } })
    // YAZ-5241: a FIELD of the wrong shape (here `stats`) makes the whole file unreadable.
    expect(parseFriendsIndex(JSON.stringify({ ...index, stats: '../x' })).kind).toBe('unreadable')
  })
})

describe('make or find the files (one of each, on each device)', () => {
  it('makes ONE index and ONE numbers gist, both secret; the index names the numbers gist', async () => {
    const w = world()
    const made = await ensureFriendsFiles(w.api(T1), seed, opts)
    expect(made.kind).toBe('ok')
    if (made.kind !== 'ok') return
    const mine = w.owned('yaseen')
    expect(mine.map((g) => Object.keys(g.files)[0]).sort()).toEqual([INDEX_FILE, NUMBERS_FILE])
    expect(mine.every((g) => !g.public)).toBe(true)
    expect(made.handle.index.stats).toBe(mine.find((g) => NUMBERS_FILE in g.files)!.id)
    expect(made.handle.index.vaults).toEqual(['yaseen/vault'])
  })

  it('a reinstall and a second device FIND the files by name: no duplicate', async () => {
    const w = world()
    const first = await ensureFriendsFiles(w.api(T1), seed, opts)
    const again = await ensureFriendsFiles(w.api(T1), seed, opts)
    const mac = await ensureFriendsFiles(w.api(T2), { vaults: ['yaseen/other'], nickname: 'Yas' }, opts)
    expect(w.owned('yaseen')).toHaveLength(2)
    expect(again.kind === 'ok' && first.kind === 'ok' && again.handle.id).toBe(first.kind === 'ok' && first.handle.id)
    expect(mac.kind === 'ok' && mac.handle.index.stats).toBe(first.kind === 'ok' && first.handle.index.stats)
    // A found index keeps its own settings: the second device does not overwrite "Vaults that count".
    expect(mac.kind === 'ok' && mac.handle.index.vaults).toEqual(['yaseen/vault'])
  })

  it('two devices that start at the same time end with ONE index and ONE numbers gist (the oldest wins)', async () => {
    let twins = 0
    for (let round = 0; round < 6; round++) {
      const w = world()
      w.shuffle(round)
      const [a, b] = await Promise.all([ensureFriendsFiles(w.api(T1), seed, raceOpts), ensureFriendsFiles(w.api(T2), seed, raceOpts)])
      const mine = w.owned('yaseen')
      expect(mine.filter((g) => INDEX_FILE in g.files)).toHaveLength(1)
      expect(mine.filter((g) => NUMBERS_FILE in g.files)).toHaveLength(1)
      expect(a.kind === 'ok' && b.kind === 'ok').toBe(true)
      if (a.kind !== 'ok' || b.kind !== 'ok') return
      expect(a.handle.id).toBe(b.handle.id)
      expect(a.handle.index.stats).toBe(b.handle.index.stats)
      const index = listIn(w, a.handle.id)
      expect(index.kind === 'ok' && index.value.stats).toBe(a.handle.index.stats)
      if (w.calls.filter((c) => c.op === 'create').length === 4) twins++
    }
    // The race is real in these rounds: both devices made a list and a numbers gist, and one pair was deleted.
    expect(twins).toBeGreaterThan(0)
  })

  it('three devices at once also end with one of each', async () => {
    const w = fakeGistWorld({ accounts: { a: { login: 'y' }, b: { login: 'y' }, c: { login: 'y' } }, start: NOW })
    w.shuffle(3)
    await Promise.all(['a', 'b', 'c'].map((t) => ensureFriendsFiles(w.api(t), seed, raceOpts)))
    expect(w.owned('y')).toHaveLength(2)
  })

  it('duplicates left from before are joined: the friends of both, then the extra index is deleted', async () => {
    const w = world()
    const api = w.api(T1)
    const old = await api.create('x', { [INDEX_FILE]: JSON.stringify({ v: 1, nickname: null, vaults: ['a/b'], stats: null, friends: [{ name: 'Sam', theirs: 'a1', mine: 'b1' }], groups: [] }) })
    w.advance(2000) // GitHub's created_at has whole seconds
    await api.create('x', { [INDEX_FILE]: JSON.stringify({ v: 1, nickname: 'Y', vaults: ['a/b'], stats: null, friends: [{ name: 'Ali', theirs: 'a2', mine: 'b2' }], groups: [{ name: 'G', group: 'c3', mine: 'b3', admin: false }] }) })
    const found = await findFriendsIndex(api, opts)
    expect(found.kind).toBe('ok')
    if (found.kind !== 'ok') return
    expect(found.handle.id).toBe(old.id)
    expect(found.handle.index.friends.map((f) => f.name)).toEqual(['Sam', 'Ali'])
    expect(found.handle.index.groups).toHaveLength(1)
    expect(found.handle.index.nickname).toBe('Y')
    expect(w.owned('yaseen')).toHaveLength(1)
  })

  it('an index written by a newer app is not touched', async () => {
    const w = world()
    await w.api(T1).create('x', { [INDEX_FILE]: JSON.stringify({ v: LIST_VERSION + 1, anything: true }) })
    expect((await ensureFriendsFiles(w.api(T1), seed, opts)).kind).toBe('newer')
    expect(w.owned('yaseen')).toHaveLength(1)
  })

  it('writeFriendsIndex keeps the fields an older app does not know (round 10, item 17)', async () => {
    const w = world()
    const api = w.api(T1)
    const made = await ensureFriendsFiles(api, seed, opts)
    if (made.kind !== 'ok') throw new Error('no index')
    await api.update(made.handle.id, { [INDEX_FILE]: JSON.stringify({ ...made.handle.index, later: [1, 2] }) })
    const found = await findFriendsIndex(api, opts)
    if (found.kind !== 'ok') throw new Error('no index')
    await writeFriendsIndex(api, found.handle, { ...found.handle.index, nickname: 'Yas' })
    expect(JSON.parse(w.text(made.handle.id, INDEX_FILE)!)).toMatchObject({ v: LIST_VERSION, nickname: 'Yas', later: [1, 2] })
  })
})

describe('YAZ-5191: a friends list that this app cannot read is never written over', () => {
  it('a list that this app cannot read (one name over 200 letters) is never written over: its friends stay', async () => {
    const w = world()
    const api = w.api(T1)
    const statsId = w.seed('yaseen', { [NUMBERS_FILE]: JSON.stringify(STATS) })
    const listId = w.seed('yaseen', { [INDEX_FILE]: JSON.stringify({ v: 1, nickname: null, vaults: ['yaseen/vault'], stats: statsId, friends: [
      { name: 'x'.repeat(201), theirs: 'aa11', mine: 'bb22' },
      { name: 'Sam', theirs: 'cc33', mine: 'dd44' },
    ], groups: [] }) })
    await ensureFriendsFiles(api, seed, opts)
    expect(JSON.parse(w.text(listId, INDEX_FILE)!).friends).toHaveLength(2) // now: 0
  })

  it('a write keeps each entry that this app cannot read, and each long name whole (cut only for the screens)', async () => {
    const w = world()
    const api = w.api(T1)
    const statsId = w.seed('yaseen', { [NUMBERS_FILE]: JSON.stringify(STATS) })
    const long = 'L'.repeat(260)
    const odd = { name: 'Odd', theirs: 'not hex', mine: 'zz', later: 1 }
    const listId = w.seed('yaseen', {
      [INDEX_FILE]: JSON.stringify({ v: 1, nickname: 'N'.repeat(250), vaults: ['a/b', 7], stats: statsId, friends: [{ name: long, theirs: 'aa11', mine: 'bb22' }, odd], groups: [{ name: 'G', group: 'ee55', mine: 'ff66' }] }),
    })
    const found = await findFriendsIndex(api, opts)
    if (found.kind !== 'ok') throw new Error(found.kind)
    expect(found.handle.index.friends).toEqual([{ name: long.slice(0, 200), theirs: 'aa11', mine: 'bb22' }])
    await writeFriendsIndex(api, found.handle, { ...found.handle.index, friends: [...found.handle.index.friends, { name: 'Sam', theirs: 'cc33', mine: 'dd44' }] })
    // YAZ-5312: the version 1 array stays as it was (each long name whole, the entry this app cannot read); Sam has his own file.
    const after = JSON.parse(w.text(listId, INDEX_FILE)!)
    expect(after.friends).toEqual([{ name: long, theirs: 'aa11', mine: 'bb22' }, odd])
    const read = listIn(w, listId)
    expect(read.kind === 'ok' && read.value.friends).toEqual([{ name: long.slice(0, 200), theirs: 'aa11', mine: 'bb22' }, { name: 'Sam', theirs: 'cc33', mine: 'dd44' }])
    expect(after.nickname).toBe('N'.repeat(250))
    expect(after.vaults).toEqual(['a/b', 7])
    expect(after.groups).toEqual([{ name: 'G', group: 'ee55', mine: 'ff66' }])
  })

  it('a list that is not JSON: find says "broken", and NO call writes to it (ensure, add, remove)', async () => {
    const w = world()
    const api = w.api(T1)
    const text = '{"v":1,"friends":[{"name":"Sam","theirs":"cc33","mine":"dd44"}],'
    const listId = w.seed('yaseen', { [INDEX_FILE]: text })
    expect(await findFriendsIndex(api, opts)).toEqual({ kind: 'broken', id: listId })
    expect(await ensureFriendsFiles(api, seed, opts)).toEqual({ kind: 'broken' })
    expect(w.calls.filter((c) => c.op !== 'list' && c.op !== 'read')).toEqual([])
    expect(w.text(listId, INDEX_FILE)).toBe(text)
    expect(LIST_NEEDS_REPAIR).toContain('notecards-friends.json')
  })

  it('a list with broken JSON is never written over', async () => {
    const w = world()
    const listId = w.seed('yaseen', { [INDEX_FILE]: '{"v":1,"friends":[{"name":"Sam","theirs":"cc33","mine":"dd44"}],' })
    await ensureFriendsFiles(w.api(T1), seed, opts)
    expect(w.text(listId, INDEX_FILE)).toContain('"Sam"') // now: an empty list
  })
})

describe('YAZ-5241: a field of the wrong shape makes the list "needs repair"; it is never written over', () => {
  it('a list whose friends (or vaults) is not a list is never written over', async () => {
    for (const bad of [
      (s: string) => ({ v: 1, nickname: null, vaults: ['ali/vault'], stats: s, friends: { sam: { name: 'Sam', theirs: 'cc33', mine: 'dd44' } }, groups: [] }),
      (s: string) => ({ v: 1, nickname: null, vaults: 'ali/vault', stats: s, friends: [{ name: 'Sam', theirs: 'cc33', mine: 'dd44' }], groups: [] }),
    ]) {
      const w = world()
      const statsId = w.seed('yaseen', { [NUMBERS_FILE]: JSON.stringify(STATS) })
      const text = JSON.stringify(bad(statsId))
      const listId = w.seed('yaseen', { [INDEX_FILE]: text })
      const found = await findFriendsIndex(w.api(T1), opts)
      if (found.kind === 'ok') await writeFriendsIndex(w.api(T1), found.handle, { ...found.handle.index, nickname: 'x' })
      expect(JSON.parse(w.text(listId, INDEX_FILE)!).friends).toEqual(JSON.parse(text).friends) // now: []
      expect(JSON.parse(w.text(listId, INDEX_FILE)!).vaults).toEqual(JSON.parse(text).vaults) // now: []
    }
  })

  it('each field of the wrong shape (groups, shared, stats, nickname) is "broken" too; absent fields are fine', () => {
    const ok = { v: 1, nickname: null, vaults: [], stats: null, friends: [], groups: [] }
    for (const bad of [{ groups: 'x' }, { shared: {} }, { stats: 'not a gist id!' }, { stats: 5 }, { nickname: 7 }, { vaults: null }, { friends: null }])
      expect(parseFriendsIndex(JSON.stringify({ ...ok, ...bad })).kind, JSON.stringify(bad)).toBe('unreadable')
    expect(parseFriendsIndex(JSON.stringify({ v: 1 })).kind).toBe('ok')
  })

  it('a pointer that cannot be read is never written over when the numbers gist moves', async () => {
    const w = world()
    const api = w.api(T1)
    const made = await ensureFriendsFiles(api, seed, opts)
    if (made.kind !== 'ok') throw new Error('no list')
    const pointer = w.seed('yaseen', { [POINTER_FILE]: '{"v":1,"stats":' })
    const result = await relinkPointers(api, [pointer], made.handle.index.stats!, opts)
    expect(result.updated).toEqual([])
    expect(w.text(pointer, POINTER_FILE)).toBe('{"v":1,"stats":')
  })
})

describe('a deleted numbers gist is made again (round 16: new numbers gist, update the other pointers)', () => {
  it('makes a new numbers gist, writes its ID into every pointer, keeps each pointer`s own fields, and updates the index', async () => {
    const w = world()
    const api = w.api(T1)
    const made = await ensureFriendsFiles(api, seed, opts)
    if (made.kind !== 'ok') throw new Error('no index')
    const oldStats = made.handle.index.stats!
    const p1 = await makePointer(api, oldStats, opts, { reads: 'abcdef01' })
    const p2 = await makePointer(api, oldStats, opts)
    const gone = await makePointer(api, oldStats, opts)
    await api.update(p1, { [POINTER_FILE]: JSON.stringify({ v: 1, stats: oldStats, reads: 'abcdef01', mark: { kind: 'cheer', at: '2026-11-14T05:00:00.000Z' }, later: 'kept' }) })
    await api.remove(gone)
    const handle = await writeFriendsIndex(api, made.handle, {
      ...made.handle.index,
      friends: [
        { name: 'Sam', theirs: 'abcdef01', mine: p1 },
        { name: 'Gone', theirs: 'abcdef02', mine: gone },
      ],
      groups: [{ name: 'Club', group: 'abcdef03', mine: p2, admin: false }],
    })
    await api.remove(oldStats) // deleted on GitHub
    const before = w.updates('yaseen')

    const result = await replaceNumbersGist(api, handle, JSON.stringify({ ...STATS, login: 'yaseen' }), opts)
    const fresh = result.handle.index.stats!
    expect(fresh).not.toBe(oldStats)
    expect(w.text(fresh, NUMBERS_FILE)).toContain('"login":"yaseen"')
    expect(JSON.parse(w.text(p1, POINTER_FILE)!)).toEqual({ v: 1, stats: fresh, reads: 'abcdef01', mark: { kind: 'cheer', at: '2026-11-14T05:00:00.000Z' }, later: 'kept' })
    expect(JSON.parse(w.text(p2, POINTER_FILE)!)).toEqual({ v: 1, stats: fresh })
    expect(result.pointers).toEqual({ updated: [p1, p2], gone: [gone] })
    expect(listIn(w, handle.id)).toMatchObject({ kind: 'ok', value: { stats: fresh } })
    // Two pointer updates and one index update: gist_update counts each PATCH.
    expect(w.updates('yaseen') - before).toBe(3)
  })

  it('with the old numbers gist still there (a remove, 4E2), the old one is deleted at the end', async () => {
    const w = world()
    const api = w.api(T1)
    const made = await ensureFriendsFiles(api, seed, opts)
    if (made.kind !== 'ok') throw new Error('no index')
    const old = made.handle.index.stats!
    const result = await replaceNumbersGist(api, made.handle, JSON.stringify(STATS), opts)
    expect(result.old).toBe(old)
    expect(w.text(old, NUMBERS_FILE)).toBeNull()
  })

  it('waits about 1 second between writes', async () => {
    const w = world()
    const waits: number[] = []
    const slow: WriteOptions = { ...opts, sleep: async (ms) => void waits.push(ms) }
    const made = await ensureFriendsFiles(w.api(T1), seed, slow)
    if (made.kind !== 'ok') throw new Error('no index')
    const writes = w.calls.filter((c) => c.op !== 'list' && c.op !== 'read').length
    expect(waits.filter((ms) => ms === WRITE_GAP_MS)).toHaveLength(writes - 1)
    expect(WRITE_GAP_MS).toBe(1000)
    // One longer wait before the second look for a twin made by another device at the same time.
    expect(waits.filter((ms) => ms === SETTLE_MS)).toHaveLength(1)
  })
})

describe('reading a friend through the pointer (4E2 builds the list on it)', () => {
  async function friend() {
    const w = world()
    const sam = w.api(SAM)
    const made = await ensureFriendsFiles(sam, { vaults: ['sam/v'], nickname: null }, opts)
    if (made.kind !== 'ok') throw new Error('no index')
    const stats = made.handle.index.stats!
    w.advance(60_000)
    await sam.update(stats, { [NUMBERS_FILE]: JSON.stringify(STATS) })
    const pointer = await makePointer(sam, stats, opts, { reads: 'abcdef01' })
    return { w, sam, stats, pointer }
  }

  it('reads the pointer, then the numbers, with MY token; the update time is GitHub`s', async () => {
    const { w, pointer } = await friend()
    w.advance(2 * 3600_000)
    const cache: FriendReadCache = new Map()
    const read = await readFriend(w.api(T1), pointer, cache)
    expect(read).toMatchObject({ kind: 'ok', stats: STATS, pointer: { stats: expect.any(String), reads: 'abcdef01' } })
    if (read.kind !== 'ok') return
    expect(agoLabel(updatedAgo(read.updatedAt, w.now()))).toBe('2h ago')
    expect(w.calls.filter((c) => c.token === T1).every((c) => c.op === 'read')).toBe(true)
  })

  it('a second read with the ETags costs two free 304s and gives the same numbers', async () => {
    const { w, pointer } = await friend()
    const cache: FriendReadCache = new Map()
    const api = w.api(T1)
    const first = await readFriend(api, pointer, cache)
    const n = w.calls.length
    const second = await readFriend(api, pointer, cache)
    expect(second).toEqual(first)
    expect(w.calls.slice(n).map((c) => c.answer)).toEqual([304, 304])
  })

  it('a removed friend (pointer deleted) is "gone"; a numbers gist between two IDs is "no-numbers"', async () => {
    const { w, sam, stats, pointer } = await friend()
    const cache: FriendReadCache = new Map()
    await sam.remove(stats)
    expect((await readFriend(w.api(T1), pointer, cache)).kind).toBe('no-numbers')
    await sam.remove(pointer)
    expect((await readFriend(w.api(T1), pointer, cache)).kind).toBe('gone')
  })

  it('an unknown `v` is "newer-app"; a broken file is "unreadable"; neither throws', async () => {
    const { w, sam, stats, pointer } = await friend()
    const api = w.api(T1)
    const cache: FriendReadCache = new Map()
    await sam.update(stats, { [NUMBERS_FILE]: JSON.stringify({ ...STATS, v: 2 }) })
    expect(await readFriend(api, pointer, cache)).toEqual({ kind: 'newer-app' })
    await sam.update(stats, { [NUMBERS_FILE]: '{"v":1,"days":[' })
    expect(await readFriend(api, pointer, cache)).toMatchObject({ kind: 'unreadable' })
    w.setFiles(stats, { 'other.json': '{}' })
    expect(await readFriend(api, pointer, cache)).toMatchObject({ kind: 'unreadable' })
    await sam.update(pointer, { [POINTER_FILE]: JSON.stringify({ v: 7, stats }) })
    expect(await readFriend(api, pointer, cache)).toEqual({ kind: 'newer-app' })
    await sam.update(pointer, { [POINTER_FILE]: JSON.stringify({ v: 1, stats: 'not hex!' }) })
    expect(await readFriend(api, pointer, cache)).toMatchObject({ kind: 'unreadable' })
    expect(await readFriend(api, 'not a gist id', cache)).toMatchObject({ kind: 'unreadable' })
  })

  it('offline or rate-limited: the last numbers stay, marked old; no throw', async () => {
    const { w, pointer } = await friend()
    const api = w.api(T1)
    const cache: FriendReadCache = new Map()
    const first = await readFriend(api, pointer, cache)
    w.offline = true
    expect(await readFriend(api, pointer, cache)).toEqual({ ...first, stale: 'offline' })
    w.offline = false
    w.failNext = () => 'RATE_LIMITED'
    expect(await readFriend(api, pointer, cache)).toMatchObject({ kind: 'ok', stale: 'rate-limited' })
    w.offline = true
    expect(await readFriend(api, pointer, new Map())).toEqual({ kind: 'offline' })
  })
})

describe('"updated … ago" (round 10, item 12)', () => {
  it('labels', () => {
    expect(agoLabel(null)).toBe('no update yet')
    expect(agoLabel(0)).toBe('now')
    expect(agoLabel(59_000)).toBe('now')
    expect(agoLabel(5 * 60_000)).toBe('5m ago')
    expect(agoLabel(2 * 3600_000 + 59 * 60_000)).toBe('2h ago')
    expect(agoLabel(3 * 86400_000)).toBe('3d ago')
  })

  it('clock skew: a friend`s clock 3 hours fast does not matter (GitHub`s time is used); my slow clock gives "now", never a time to come', async () => {
    const w = world()
    const sam = w.api(SAM)
    const made = await ensureFriendsFiles(sam, { vaults: [], nickname: null }, opts)
    if (made.kind !== 'ok') throw new Error('no index')
    const stats = made.handle.index.stats!
    // Sam's phone thinks it is 3 hours later.
    await sam.update(stats, { [NUMBERS_FILE]: JSON.stringify({ ...STATS, at: new Date(w.now() + 3 * 3600_000).toISOString() }) })
    const pointer = await makePointer(sam, stats, opts)
    w.advance(10 * 60_000)
    const read = await readFriend(w.api(T1), pointer, new Map())
    if (read.kind !== 'ok') throw new Error(read.kind)
    expect(agoLabel(updatedAgo(read.updatedAt, w.now()))).toBe('10m ago')
    // My phone is 20 minutes slow: the update looks 10 minutes in the future.
    expect(updatedAgo(read.updatedAt, w.now() - 20 * 60_000)).toBe(0)
    expect(agoLabel(updatedAgo(read.updatedAt, w.now() - 20 * 60_000))).toBe('now')
  })
})
