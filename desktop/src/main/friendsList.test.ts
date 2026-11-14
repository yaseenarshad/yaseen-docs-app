import { describe, expect, it } from 'vitest'
import {
  INDEX_FILE,
  NUMBERS_FILE,
  POINTER_FILE,
  emptyNumbers,
  ensureFriendsFiles,
  isOurNumbersGist,
  findFriendsIndex,
  makePointer,
  pointersOf,
  writeFriendsIndex,
  type GistsApi,
  type IndexHandle,
  type WriteOptions,
} from '@shared/friendGists'
import { fakeGistWorld, type FakeGistWorld } from '@shared/friendGistsFake'
import {
  FRIEND_LINK_BASE,
  GONE_RECHECK_MS,
  finishRemove,
  friendLink,
  newListCache,
  parseFriendLink,
  pasteLink,
  pasteMessage,
  pendingRemove,
  readFriends,
  dropHeldShares,
  markPaired,
  removeFriend,
  removeMany,
  repairPairs,
  shareLink,
  type ListOptions,
} from '@shared/friendsList'
import { emptyBudget, recordUpdate } from '@shared/friendSend'
import { ORPHAN_AGE_MS, sweepOrphans } from '@shared/friendGroups'
import type { FriendStats } from '@shared/friendStats'

/**
 * YAZ-5083 (4E2): the friends list on a fake gist API (no real GitHub call). Decisions 14 (round 16), 15, 20, 22;
 * round 12 items 5 (automatic pairing) and 6 ("No longer shares with you").
 */
const NOW = Date.parse('2026-11-14T08:00:00Z')
const ID = 'a1b2c3d4e5f60718293a4b5c6d7e8f90'
const opts = (w: FakeGistWorld): ListOptions => ({ describe: (kind) => `notecards-test ${kind}`, sleep: async () => {}, now: w.now })
const stats = (name: string, cards = 3): FriendStats => ({
  v: 1,
  login: name.toLowerCase(),
  name,
  avatar: '',
  days: [{ day: '2026-11-14', cards, seconds: 60, remembered: cards, forgot: 0, newCards: 0, done: true }],
  totals: { cards: 10, inReview: 5, newLeft: 5, mature: 0, dueLeft: 0, addedThisWeek: 1, streak: 1, bestStreak: 1, bestDay: cards, bestWeek: cards },
  at: new Date(NOW).toISOString(),
})

function people(names: string[] = ['ali', 'bea']) {
  const accounts = Object.fromEntries(names.flatMap((n) => [[n, { login: n }], [`${n}-mac`, { login: n }]]))
  return fakeGistWorld({ accounts, start: NOW })
}
async function person(w: FakeGistWorld, token: string, name = token): Promise<{ api: GistsApi; handle: IndexHandle }> {
  const api = w.api(token)
  const made = await ensureFriendsFiles(api, { vaults: [`${token}/vault`], nickname: null, numbers: stats(name[0].toUpperCase() + name.slice(1)) }, opts(w))
  if (made.kind !== 'ok') throw new Error('no list')
  return { api, handle: made.handle }
}
const fresh = async (api: GistsApi, w: FakeGistWorld) => {
  const f = await findFriendsIndex(api, opts(w))
  if (f.kind !== 'ok') throw new Error('no list')
  return f.handle
}
/** After a remove: one numbers gist (the list's), every pointer names it, nothing else is left, no remove waits. */
function expectClean(w: FakeGistWorld, login: string, handle: IndexHandle) {
  const owned = w.owned(login)
  const numbers = owned.filter((g) => NUMBERS_FILE in g.files)
  expect(numbers.map((g) => g.id)).toEqual([handle.index.stats])
  const pointers = pointersOf(handle.index)
  for (const p of pointers) expect(JSON.parse(w.text(p, POINTER_FILE)!).stats).toBe(handle.index.stats)
  expect(owned.filter((g) => POINTER_FILE in g.files).map((g) => g.id).sort()).toEqual([...pointers].sort())
  expect(owned.filter((g) => INDEX_FILE in g.files)).toHaveLength(1)
  expect(pendingRemove(handle)).toBeNull()
}

describe('the friend link (decision 20; round 10, addition 7)', () => {
  it('is the address of the landing page with the pointer ID after #: the ID never reaches a server log', () => {
    expect(friendLink(ID)).toBe(`${FRIEND_LINK_BASE}#${ID}`)
    expect(FRIEND_LINK_BASE).toBe('https://notecard.yaseenarshad.com/friend')
  })

  it('reads a pasted text in any shape', () => {
    for (const text of [
      friendLink(ID),
      `  ${friendLink(ID)}  `,
      `${friendLink(ID)}/`,
      `Add me on Notecard: ${friendLink(ID)} see you`,
      `https://preview.notecard.yaseenarshad.com/friend#${ID}`,
      `https://notecard.yaseenarshad.com/friend/${ID}`,
      `https://notecard.yaseenarshad.com/friend/${ID}/`,
      `https://notecard.yaseenarshad.com/friend?id=${ID}`,
      `notecard.yaseenarshad.com/friend#${ID}`,
      ID,
      ` ${ID.toUpperCase()}\n`,
      `${ID}/`,
      `https://gist.github.com/ali/${ID}`,
      `https://api.github.com/gists/${ID}`,
    ])
      expect(parseFriendLink(text), text).toEqual({ kind: 'ok', id: ID })
  })

  it('refuses a link of another app, a text with no link, and an empty paste, each with plain words', () => {
    expect(parseFriendLink('https://stepup.app/invite/12345')).toEqual({ kind: 'other-app' })
    expect(parseFriendLink(`https://evil.example/friend#${ID}`)).toEqual({ kind: 'other-app' })
    expect(parseFriendLink(`https://notecard.yaseenarshad.com.evil.example/friend#${ID}`)).toEqual({ kind: 'other-app' })
    expect(parseFriendLink('https://notecard.yaseenarshad.com/friend#nothex!')).toEqual({ kind: 'not-a-link' })
    expect(parseFriendLink('hello there')).toEqual({ kind: 'not-a-link' })
    expect(parseFriendLink('12345')).toEqual({ kind: 'not-a-link' })
    expect(parseFriendLink('   ')).toEqual({ kind: 'empty' })
    for (const kind of ['other-app', 'not-a-link', 'empty'] as const) expect(pasteMessage({ kind })).toMatch(/\w+ \w+/)
  })
})

describe('add a friend: share, then paste, on both sides (decision 20; round 12, item 5)', () => {
  it('order 1: Ali shares, Bea pastes it, Bea sends hers back, Ali pastes it: both paired', async () => {
    const w = people()
    const ali = await person(w, 'ali')
    const bea = await person(w, 'bea')
    const share = await shareLink(ali.api, ali.handle, opts(w))
    expect(share.handle.index.shared).toEqual([{ mine: share.pointer, at: expect.any(String) }])
    expect(JSON.parse(w.text(share.pointer, POINTER_FILE)!)).toEqual({ v: 1, stats: ali.handle.index.stats })

    // Before Ali adds Bea: Ali sees one shared link and no friend.
    let aliRows = await readFriends(ali.api, share.handle, newListCache(), w.now())
    expect(aliRows.rows).toEqual([])
    expect(aliRows.shared).toEqual([{ mine: share.pointer, link: friendLink(share.pointer), at: expect.any(String) }])

    const pasted = await pasteLink(bea.api, bea.handle, `Add me: ${share.link}`, opts(w))
    expect(pasted).toMatchObject({ kind: 'added', name: 'Ali', paired: false, sendBack: expect.stringContaining(FRIEND_LINK_BASE) })
    if (pasted.kind !== 'added') return
    expect(pasted.handle.index.friends).toEqual([{ name: 'Ali', theirs: share.pointer, mine: expect.any(String) }])
    const beaMine = pasted.handle.index.friends[0].mine
    expect(JSON.parse(w.text(beaMine, POINTER_FILE)!)).toEqual({ v: 1, stats: bea.handle.index.stats, reads: share.pointer })

    // Before Ali adds Bea: Bea sees Ali's numbers, with "Waiting for Ali to add you" and her link to send back.
    const beaRows = await readFriends(bea.api, pasted.handle, newListCache(), w.now())
    expect(beaRows.rows).toEqual([expect.objectContaining({ name: 'Ali', state: 'waiting', label: 'Waiting for Ali to add you', sendBack: friendLink(beaMine) })])
    expect(beaRows.rows[0].read).toMatchObject({ kind: 'ok', stats: { name: 'Ali' } })

    const back = await pasteLink(ali.api, share.handle, pasted.sendBack!, opts(w))
    expect(back).toMatchObject({ kind: 'added', name: 'Bea', paired: true, sendBack: null })
    if (back.kind !== 'added') return
    expect(back.handle.index.friends).toEqual([{ name: 'Bea', theirs: beaMine, mine: share.pointer, paired: true }])
    expect(back.handle.index.shared).toEqual([])
    expect(JSON.parse(w.text(share.pointer, POINTER_FILE)!)).toEqual({ v: 1, stats: ali.handle.index.stats, reads: beaMine })

    aliRows = await readFriends(ali.api, back.handle, newListCache(), w.now())
    expect(aliRows.rows).toEqual([expect.objectContaining({ name: 'Bea', state: 'ok', label: null, sendBack: null })])
    expect((await readFriends(bea.api, pasted.handle, newListCache(), w.now())).rows[0]).toMatchObject({ state: 'ok' })
  })

  it('order 2: both share first, both paste: both wait; one link sent back pairs them, from either side', async () => {
    for (const settler of ['ali', 'bea'] as const) {
      const w = people()
      let ali = await person(w, 'ali')
      let bea = await person(w, 'bea')
      const aShare = await shareLink(ali.api, ali.handle, opts(w))
      const bShare = await shareLink(bea.api, bea.handle, opts(w))
      const a = await pasteLink(ali.api, aShare.handle, bShare.link, opts(w))
      const b = await pasteLink(bea.api, bShare.handle, aShare.link, opts(w))
      if (a.kind !== 'added' || b.kind !== 'added') throw new Error('not added')
      expect([a.paired, b.paired]).toEqual([false, false])
      ali = { ...ali, handle: a.handle }
      bea = { ...bea, handle: b.handle }
      expect((await readFriends(ali.api, ali.handle, newListCache(), w.now())).rows[0]).toMatchObject({ state: 'waiting', sendBack: a.sendBack })
      expect((await readFriends(bea.api, bea.handle, newListCache(), w.now())).rows[0]).toMatchObject({ state: 'waiting', sendBack: b.sendBack })

      // One of them pastes the other's send-back link. It is the same friend: no second entry.
      const [who, other, link] = settler === 'ali' ? [ali, bea, b.sendBack!] : [bea, ali, a.sendBack!]
      const again = await pasteLink(who.api, who.handle, link, opts(w))
      expect(again).toMatchObject({ kind: 'added', paired: true })
      if (again.kind !== 'added') return
      expect(again.handle.index.friends).toHaveLength(1)
      // The other side heals on its next read: its own pointer is the one the friend reads now.
      const otherHandle = await fresh(other.api, w)
      const read = await readFriends(other.api, otherHandle, newListCache(), w.now())
      const healed = await repairPairs(other.api, otherHandle, read.repairs, opts(w))
      for (const [api, handle] of [
        [who.api, again.handle],
        [other.api, healed],
      ] as const) {
        const rows = (await readFriends(api, handle, newListCache(), w.now())).rows
        expect(rows).toHaveLength(1)
        expect(rows[0].state).toBe('ok')
      }
      // Each side keeps exactly the pointers its list names (the unused extra one is deleted).
      for (const [login, handle] of [
        [settler, again.handle],
        [settler === 'ali' ? 'bea' : 'ali', healed],
      ] as const)
        expect(
          w
            .owned(login)
            .filter((g) => POINTER_FILE in g.files)
            .map((g) => g.id)
            .sort(),
        ).toEqual(pointersOf(handle.index).sort())
    }
  })

  it('my own link is refused with plain words; so is my other device`s link', async () => {
    const w = people()
    const ali = await person(w, 'ali')
    const share = await shareLink(ali.api, ali.handle, opts(w))
    expect(await pasteLink(ali.api, share.handle, share.link, opts(w))).toEqual({ kind: 'own-link' })
    // The Mac made a pointer that this phone's list does not show yet: the same numbers gist gives it away.
    const macPointer = await makePointer(w.api('ali-mac'), ali.handle.index.stats!, opts(w))
    expect(await pasteLink(ali.api, share.handle, macPointer, opts(w))).toEqual({ kind: 'own-link' })
    expect(pasteMessage({ kind: 'own-link' })).toBe('That is your own link. Send it to a friend, and paste the link they send you.')
  })

  it('a friend I already have: no second entry', async () => {
    const w = people()
    const ali = await person(w, 'ali')
    const bea = await person(w, 'bea')
    const share = await shareLink(ali.api, ali.handle, opts(w))
    const first = await pasteLink(bea.api, bea.handle, share.link, opts(w))
    if (first.kind !== 'added') throw new Error('not added')
    const second = await pasteLink(bea.api, first.handle, share.link, opts(w))
    expect(second).toMatchObject({ kind: 'already', name: 'Ali' })
    expect((await fresh(bea.api, w)).index.friends).toHaveLength(1)
    expect(pasteMessage(second)).toBe('Ali is already in your friends.')
  })

  it('a link that is gone, a gist that is not a friend link, a newer app, no connection: plain words, nothing added', async () => {
    const w = people()
    const ali = await person(w, 'ali')
    const bea = await person(w, 'bea')
    const share = await shareLink(ali.api, ali.handle, opts(w))
    await ali.api.remove(share.pointer)
    expect(await pasteLink(bea.api, bea.handle, share.link, opts(w))).toEqual({ kind: 'not-found' })
    expect(await pasteLink(bea.api, bea.handle, ali.handle.index.stats!, opts(w))).toEqual({ kind: 'not-a-friend-link' })
    const newer = await ali.api.create('x', { [POINTER_FILE]: JSON.stringify({ v: 2, stats: ali.handle.index.stats }) })
    expect(await pasteLink(bea.api, bea.handle, newer.id, opts(w))).toEqual({ kind: 'newer-app' })
    w.offline = true
    expect(await pasteLink(bea.api, bea.handle, newer.id, opts(w))).toEqual({ kind: 'offline' })
    w.offline = false
    expect((await fresh(bea.api, w)).index.friends).toEqual([])
    for (const kind of ['not-found', 'not-a-friend-link', 'newer-app', 'offline'] as const) expect(pasteMessage({ kind })).toMatch(/\./)
  })

  it('a friend whose numbers file is broken can still be added; the row says so later', async () => {
    const w = people()
    const ali = await person(w, 'ali')
    const bea = await person(w, 'bea')
    w.setFiles(ali.handle.index.stats!, { [NUMBERS_FILE]: '{"v":1,' })
    const share = await shareLink(ali.api, ali.handle, opts(w))
    const pasted = await pasteLink(bea.api, bea.handle, share.link, opts(w))
    expect(pasted).toMatchObject({ kind: 'added', name: 'Friend' })
    if (pasted.kind !== 'added') return
    expect((await readFriends(bea.api, pasted.handle, newListCache(), w.now())).rows[0].state).toBe('unreadable')
  })
})

/** Ali and Bea paired, plus `more` friends of Ali (made-up pointers), one group and one shared link. */
async function paired(w: FakeGistWorld, more = 0) {
  const ali = await person(w, 'ali')
  const bea = await person(w, 'bea')
  const share = await shareLink(ali.api, ali.handle, opts(w))
  const b = await pasteLink(bea.api, bea.handle, share.link, opts(w))
  if (b.kind !== 'added') throw new Error('not added')
  const a = await pasteLink(ali.api, share.handle, b.sendBack!, opts(w))
  if (a.kind !== 'added') throw new Error('not added')
  // Bea's app reads her rows once and sees the pair (YAZ-5274: it marks "paired", as the phone's rows() does).
  const bRows = await readFriends(bea.api, b.handle, newListCache(), w.now())
  const bHandle = await markPaired(bea.api, b.handle, bRows.newlyPaired, opts(w))
  let handle = a.handle
  const extra: string[] = []
  for (let i = 0; i < more; i++) extra.push(await makePointer(ali.api, handle.index.stats!, opts(w)))
  const group = await makePointer(ali.api, handle.index.stats!, opts(w))
  handle = await writeFriendsIndex(ali.api, handle, {
    ...handle.index,
    friends: [...handle.index.friends, ...extra.map((mine, i) => ({ name: `F${i}`, theirs: `abc${i}`, mine }))],
    groups: [{ name: 'Club', group: 'def0', mine: group, admin: false }],
  })
  handle = (await shareLink(ali.api, handle, opts(w))).handle
  return { ali: { ...ali, handle }, bea: { ...bea, handle: bHandle }, aliForBea: share.pointer, beaForAli: b.handle.index.friends[0].mine }
}

describe('remove a friend (round 16)', () => {
  it('deletes my pointer for them, makes a NEW numbers gist with the same numbers, moves every other pointer to it, deletes the old one', async () => {
    const w = people()
    const { ali, bea, aliForBea } = await paired(w, 3)
    const old = ali.handle.index.stats!
    const oldText = w.text(old, NUMBERS_FILE)
    const result = await removeFriend(ali.api, ali.handle, aliForBea, emptyBudget(), opts(w))
    expect(result.kind).toBe('done')
    const handle = result.handle
    expect(handle.index.friends.map((f) => f.name)).toEqual(['F0', 'F1', 'F2'])
    expect(handle.index.stats).not.toBe(old)
    expect(w.text(handle.index.stats!, NUMBERS_FILE)).toBe(oldText)
    expect(w.text(old, NUMBERS_FILE)).toBeNull()
    expect(w.text(aliForBea, POINTER_FILE)).toBeNull()
    expectClean(w, 'ali', handle)
    // Bea has no way to the new numbers: her row says "No longer shares with you".
    const rows = (await readFriends(bea.api, bea.handle, newListCache(), w.now())).rows
    expect(rows[0]).toMatchObject({ name: 'Ali', state: 'gone', label: 'No longer shares with you' })
  })

  it('a stop at ANY point (the app closed) is finished by the next start', async () => {
    let points = 0
    for (let k = 1; ; k++) {
      const w = people()
      const { ali, aliForBea } = await paired(w, 2)
      let writes = 0
      w.failNext = (call) => (call.op !== 'list' && call.op !== 'read' && ++writes === k ? 'OFFLINE' : undefined)
      const first = await removeFriend(ali.api, ali.handle, aliForBea, emptyBudget(), opts(w))
      w.failNext = null
      if (first.kind === 'done') break
      points++
      expect(first).toMatchObject({ kind: 'paused', why: 'offline' })
      // The next start: a new app finds the list, sees the remove that waits, and finishes it.
      const handle = await fresh(w.api('ali'), w)
      const done = await finishRemove(w.api('ali'), handle, emptyBudget(), opts(w))
      // YAZ-5276: a numbers gist made just before a stop is no longer found by its file name; the sweep takes it later.
      w.advance(ORPHAN_AGE_MS + 1000)
      await sweepOrphans(w.api('ali'), done.handle)
      expect(done.kind, `stop at write ${k}`).toBe('done')
      if (k === 1) {
        // The first write is the list itself: it failed, so the remove never started. Bea stays; nothing changed.
        expect(done.handle.index.friends.map((f) => f.name)).toEqual(['Bea', 'F0', 'F1'])
        expect(w.text(aliForBea, POINTER_FILE)).not.toBeNull()
      } else {
        expect(done.handle.index.friends.map((f) => f.name)).toEqual(['F0', 'F1'])
        expect(w.text(aliForBea, POINTER_FILE)).toBeNull()
      }
      expectClean(w, 'ali', done.handle)
    }
    expect(points).toBeGreaterThanOrEqual(7)
  })

  it('with 30 friends it fits the reserve in one go; with the budget nearly used it runs in parts that survive a closed app', async () => {
    const w = people()
    const { ali, aliForBea } = await paired(w, 29)
    const pointers = pointersOf(ali.handle.index).length
    expect(pointers).toBe(32) // 30 friends, 1 group, 1 shared link
    const before = w.updates('ali')
    const full = await removeFriend(ali.api, ali.handle, aliForBea, emptyBudget(), opts(w))
    expect(full.kind).toBe('done')
    // One update for each other pointer and three for the list: inside the reserve (32 + 5) the sender keeps.
    // YAZ-5274: the unused shared link is deleted, not moved: 29 friends and 1 group move, and 3 list writes.
    expect(w.updates('ali') - before).toBe(30 + 3)
    expectClean(w, 'ali', full.handle)

    const w2 = people()
    const two = await paired(w2, 29)
    // The Mac and cheers used most of the hour: GitHub says 12 are left.
    const low = recordUpdate(emptyBudget(), w2.now(), { remaining: 12, limit: 100, resetAt: w2.now() + 3600_000 })
    const part = await removeFriend(two.ali.api, two.ali.handle, two.aliForBea, low, opts(w2))
    expect(part).toMatchObject({ kind: 'paused', why: 'budget', retryAt: expect.any(Number) })
    expect(w2.text(two.aliForBea, POINTER_FILE)).toBeNull() // Bea is cut off at once
    expect(pendingRemove(part.handle)).not.toBeNull()
    // The app closes. An hour later a new start finishes the rest.
    w2.advance(3600_000)
    const handle = await fresh(w2.api('ali'), w2)
    expect(pendingRemove(handle)).not.toBeNull()
    const rest = await finishRemove(w2.api('ali'), handle, emptyBudget(), opts(w2))
    expect(rest.kind).toBe('done')
    expectClean(w2, 'ali', rest.handle)
  })

  it('a gone friend (they removed me) is removed the same way; a shared link is cancelled the same way', async () => {
    const w = people()
    const { ali, bea, beaForAli, aliForBea } = await paired(w)
    const beaGone = await removeFriend(bea.api, bea.handle, beaForAli, emptyBudget(), opts(w))
    expect(beaGone.kind).toBe('done')
    const rows = (await readFriends(ali.api, ali.handle, newListCache(), w.now())).rows
    expect(rows.find((r) => r.mine === aliForBea)).toMatchObject({ state: 'gone' })
    const removed = await removeFriend(ali.api, ali.handle, aliForBea, emptyBudget(), opts(w))
    expect(removed.kind).toBe('done')
    // YAZ-5274: the remove also stopped the unused shared link. A new one is cancelled with the same steps.
    expect(removed.handle.index.shared).toEqual([])
    const fresh2 = await shareLink(ali.api, removed.handle, opts(w))
    const cancelled = await removeFriend(ali.api, fresh2.handle, fresh2.pointer, emptyBudget(), opts(w))
    expect(cancelled.kind).toBe('done')
    expect(cancelled.handle.index.shared).toEqual([])
    expect(w.text(fresh2.pointer, POINTER_FILE)).toBeNull()
    expectClean(w, 'ali', cancelled.handle)
    expect((await removeFriend(ali.api, cancelled.handle, ID, emptyBudget(), opts(w))).kind).toBe('not-found')
  })

  it('an orphan numbers gist from a stop between "make" and "write it in the list" is deleted by the sweep after the remove finishes', async () => {
    const w = people()
    const { ali, aliForBea } = await paired(w)
    // Stop right after the new numbers gist is made: the next write (the list) fails.
    let afterCreate = false
    w.failNext = (call) => {
      if (call.op === 'create') afterCreate = true
      else if (afterCreate && call.op === 'update') return 'OFFLINE'
      return undefined
    }
    const first = await removeFriend(ali.api, ali.handle, aliForBea, emptyBudget(), opts(w))
    expect(first.kind).toBe('paused')
    expect(w.owned('ali').filter((g) => NUMBERS_FILE in g.files)).toHaveLength(2)
    const done = await finishRemove(w.api('ali'), await fresh(w.api('ali'), w), emptyBudget(), opts(w))
    // YAZ-5276: the remove deletes only the old numbers gist by its ID; the orphan goes with the sweep, an hour later.
    w.advance(ORPHAN_AGE_MS + 1000)
    await sweepOrphans(w.api('ali'), done.handle)
    expect(done.kind).toBe('done')
    expectClean(w, 'ali', done.handle)
  })
})

describe('YAZ-5235: a remove cuts every pointer that the removed friend ever got', () => {
  it("order 2: after Bea removes Ali, no pointer ID that Ali ever saw leads to Bea's numbers", async () => {
    const w = people()
    const ali = await person(w, 'ali')
    const bea = await person(w, 'bea')
    const aShare = await shareLink(ali.api, ali.handle, opts(w))
    const bShare = await shareLink(bea.api, bea.handle, opts(w))
    const a = await pasteLink(ali.api, aShare.handle, bShare.link, opts(w))
    const b = await pasteLink(bea.api, bShare.handle, aShare.link, opts(w))
    if (a.kind !== 'added' || b.kind !== 'added') throw new Error('not added')
    expect(await pasteLink(ali.api, a.handle, b.sendBack!, opts(w))).toMatchObject({ kind: 'added', paired: true })
    const aliSaw = [bShare.pointer, b.handle.index.friends[0].mine]
    const beaH = await fresh(bea.api, w)
    const r = await removeFriend(bea.api, beaH, beaH.index.friends[0].mine, emptyBudget(), opts(w))
    if (r.kind !== 'done') throw new Error(r.kind)
    const leaks = aliSaw.filter((p) => w.text(p, POINTER_FILE) !== null && JSON.parse(w.text(p, POINTER_FILE)!).stats === r.handle.index.stats)
    expect(leaks).toEqual([]) // now: [bShare.pointer]
  })

  it('every gist ID the removed friend ever read: none leads to the new numbers, in both orders of the heal and both removes', async () => {
    for (const settler of ['ali', 'bea'] as const)
      for (const remover of ['ali', 'bea'] as const) {
        const w = people()
        const ali = await person(w, 'ali')
        const bea = await person(w, 'bea')
        const aShare = await shareLink(ali.api, ali.handle, opts(w))
        const bShare = await shareLink(bea.api, bea.handle, opts(w))
        const a = await pasteLink(ali.api, aShare.handle, bShare.link, opts(w))
        const b = await pasteLink(bea.api, bShare.handle, aShare.link, opts(w))
        if (a.kind !== 'added' || b.kind !== 'added') throw new Error('not added')
        const [who, link] = settler === 'ali' ? [ali, b.sendBack!] : [bea, a.sendBack!]
        expect(await pasteLink(who.api, await fresh(who.api, w), link, opts(w))).toMatchObject({ kind: 'added', paired: true })
        // Both apps read their rows a few times (each read can clean up).
        for (const p of [ali, bea]) await readFriends(p.api, await fresh(p.api, w), newListCache(), w.now())
        const [rem, other] = remover === 'ali' ? [ali, 'bea'] : [bea, 'ali']
        const h = await fresh(rem.api, w)
        const r = await removeFriend(rem.api, h, h.index.friends[0].mine, emptyBudget(), opts(w))
        if (r.kind !== 'done') throw new Error(r.kind)
        const seen = new Set(w.calls.filter((c) => c.token === other && c.op === 'read' && c.id !== null).map((c) => c.id!))
        const leaks = [...seen].filter((id) => {
          const t = w.text(id, POINTER_FILE)
          return t !== null && JSON.parse(t).stats === r.handle.index.stats
        })
        expect(leaks, `${settler} settles, ${remover} removes`).toEqual([])
        expect(seen.has(r.handle.index.stats!)).toBe(false)
      }
  })
})

describe('YAZ-5236: a remove is kept until it is done', () => {
  it('a remove that the budget pauses is saved, and finishes later by itself', async () => {
    const w = people()
    const ali = await person(w, 'ali')
    const bea = await person(w, 'bea')
    const s = await shareLink(ali.api, ali.handle, opts(w))
    const b = await pasteLink(bea.api, bea.handle, s.link, opts(w))
    if (b.kind !== 'added') throw new Error(b.kind)
    const a = await pasteLink(ali.api, s.handle, b.sendBack!, opts(w))
    if (a.kind !== 'added') throw new Error(a.kind)
    let used = emptyBudget()
    for (let i = 0; i < 100; i++) used = recordUpdate(used, w.now(), null)
    expect((await removeFriend(ali.api, a.handle, s.pointer, used, opts(w))).kind).toBe('paused')
    w.advance(61 * 60_000)
    const later = await finishRemove(ali.api, await fresh(ali.api, w), emptyBudget(), opts(w))
    expect(later.handle.index.friends).toEqual([]) // now: Bea is still a friend
  })

  it('removeMany takes many friends out in ONE re-key; a waiting remove shows its rows as "Removing…"', async () => {
    const w = people()
    const { ali } = await paired(w, 5)
    const mines = ali.handle.index.friends.slice(0, 4).map((f) => f.mine)
    const before = w.updates('ali')
    let used = emptyBudget()
    for (let i = 0; i < 99; i++) used = recordUpdate(used, w.now(), null)
    const first = await removeMany(ali.api, ali.handle, mines, used, opts(w))
    expect(first.kind).toBe('paused')
    const rows = await readFriends(ali.api, first.handle, newListCache(), w.now())
    expect(rows.rows.filter((r) => r.state === 'removing').map((r) => r.mine).sort()).toEqual([...mines].sort())
    expect(rows.rows.find((r) => r.state === 'removing')!.label).toBe('Removing…')
    const done = await finishRemove(ali.api, first.handle, emptyBudget(), opts(w))
    expect(done.kind).toBe('done')
    expect(done.handle.index.friends.map((f) => f.mine)).not.toContain(mines[0])
    expect(done.handle.index.friends).toHaveLength(2)
    // One re-key for four removes: the list 3 times, and each of the 3 other pointers (2 friends, 1 group) once.
    expect(w.updates('ali') - before).toBe(3 + 3) // YAZ-5274: the unused shared link is deleted, not moved
    expect((await readFriends(ali.api, done.handle, newListCache(), w.now())).rows.every((r) => r.state !== 'removing')).toBe(true)
  })
})

describe('YAZ-5274: a remove ends every link the removed person holds or could hold', () => {
  it('order 2 before the heal: after Ali removes Bea, the link Bea pasted does not lead to Ali`s new numbers', async () => {
    const w = people()
    const ali = await person(w, 'ali')
    const bea = await person(w, 'bea')
    const aShare = await shareLink(ali.api, ali.handle, opts(w))
    const bShare = await shareLink(bea.api, bea.handle, opts(w))
    await pasteLink(ali.api, await fresh(ali.api, w), bShare.link, opts(w))
    await pasteLink(bea.api, await fresh(bea.api, w), aShare.link, opts(w))
    const ah = await fresh(ali.api, w)
    const r = await removeFriend(ali.api, ah, ah.index.friends[0].mine, emptyBudget(), opts(w))
    if (r.kind !== 'done') throw new Error(r.kind)
    expect(JSON.parse(w.text(aShare.pointer, POINTER_FILE) ?? '{}').stats).not.toBe(r.handle.index.stats) // now: equal
    const rows = await readFriends(bea.api, await fresh(bea.api, w), newListCache(), w.now())
    expect(rows.rows[0].state).not.toBe('waiting') // now: 'waiting', with Ali`s new numbers
    expect(rows.rows[0]).toMatchObject({ state: 'stopped', label: 'This link stopped working. Share a new one.' })
  })

  it('path 2: Bea heals and removes Ali first; Ali removes Bea later: no ID Bea read leads to Ali`s new numbers', async () => {
    const w = people()
    const ali = await person(w, 'ali')
    const bea = await person(w, 'bea')
    const aShare = await shareLink(ali.api, ali.handle, opts(w))
    const bShare = await shareLink(bea.api, bea.handle, opts(w))
    const a = await pasteLink(ali.api, await fresh(ali.api, w), bShare.link, opts(w))
    await pasteLink(bea.api, await fresh(bea.api, w), aShare.link, opts(w))
    if (a.kind !== 'added') throw new Error(a.kind)
    expect(await pasteLink(bea.api, await fresh(bea.api, w), a.sendBack!, opts(w))).toMatchObject({ kind: 'added', paired: true })
    const bh = await fresh(bea.api, w)
    expect((await removeFriend(bea.api, bh, bh.index.friends[0].mine, emptyBudget(), opts(w))).kind).toBe('done')
    const ah = await fresh(ali.api, w)
    const r = await removeFriend(ali.api, ah, ah.index.friends[0].mine, emptyBudget(), opts(w))
    if (r.kind !== 'done') throw new Error(r.kind)
    const seen = new Set(w.calls.filter((c) => c.token === 'bea' && c.op === 'read' && c.id !== null).map((c) => c.id!))
    expect([...seen].filter((id) => JSON.parse(w.text(id, POINTER_FILE) ?? '{}').stats === r.handle.index.stats)).toEqual([]) // now: [aShare.pointer]
  })

  it('a link sent and never pasted also stops at a remove (nobody can tell who holds it); a link made after the remove keeps working', async () => {
    const w = people()
    const { ali, aliForBea } = await paired(w)
    const unused = ali.handle.index.shared![0].mine
    const r = await removeFriend(ali.api, ali.handle, aliForBea, emptyBudget(), opts(w))
    if (r.kind !== 'done') throw new Error(r.kind)
    expect(w.text(unused, POINTER_FILE)).toBeNull()
    expect(r.handle.index.shared).toEqual([])
    const after = await shareLink(ali.api, r.handle, opts(w))
    expect(JSON.parse(w.text(after.pointer, POINTER_FILE)!).stats).toBe(r.handle.index.stats)
  })

  it('property: random share / paste / send-back / rows on both sides, 1 to 3 devices each; after Ali removes Bea, no ID Bea ever read leads to Ali`s numbers', async () => {
    let runs = 0
    let removes = 0
    const leaks: string[] = []
    for (let seed = 1; seed <= 300; seed++) {
      let x = seed * 7919
      const rnd = (n: number) => {
        // mulberry32: 32-bit, exact in JS numbers
        x = (x + 0x6d2b79f5) | 0
        let t = Math.imul(x ^ (x >>> 15), 1 | x)
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
        return ((t ^ (t >>> 14)) >>> 0) % n
      }
      const devs = { ali: ['ali', 'ali-mac', 'ali-ipad'].slice(0, 1 + rnd(3)), bea: ['bea', 'bea-mac', 'bea-ipad'].slice(0, 1 + rnd(3)) }
      const w = fakeGistWorld({ accounts: Object.fromEntries([...devs.ali.map((t) => [t, { login: 'ali' }]), ...devs.bea.map((t) => [t, { login: 'bea' }])]), start: NOW })
      await person(w, 'ali')
      const b0 = w.api(devs.bea[0])
      const made = await ensureFriendsFiles(b0, { vaults: ['bea/vault'], nickname: null, numbers: stats('Bea') }, opts(w))
      if (made.kind !== 'ok') throw new Error('no list')
      const links: Record<'ali' | 'bea', string[]> = { ali: [], bea: [] } // links each side SENT to the other
      const steps = 4 + rnd(10)
      for (let i = 0; i < steps; i++) {
        const side = rnd(2) === 0 ? 'ali' : 'bea'
        const other = side === 'ali' ? 'bea' : 'ali'
        const api = w.api(devs[side][rnd(devs[side].length)])
        const h = await fresh(api, w)
        const op = rnd(3)
        if (op === 0) links[side].push((await shareLink(api, h, opts(w))).link)
        else if (op === 1 && links[other].length > 0) {
          const r = await pasteLink(api, h, links[other][rnd(links[other].length)], opts(w))
          if (r.kind === 'added' && r.sendBack !== null) links[side].push(r.sendBack)
        } else {
          const rows = await readFriends(api, h, newListCache(), w.now())
          let next = h
          if (rows.held.length > 0) next = await dropHeldShares(api, next, rows.held, opts(w))
          if (rows.repairs.length > 0) await repairPairs(api, next, rows.repairs, opts(w))
        }
      }
      runs++
      const aliApi = w.api(devs.ali[rnd(devs.ali.length)])
      const ah = await fresh(aliApi, w)
      if (ah.index.friends.length === 0) continue
      removes++
      const r = await removeMany(aliApi, ah, ah.index.friends.map((f) => f.mine), emptyBudget(), opts(w))
      if (r.kind !== 'done') throw new Error(`${seed}: ${r.kind}`)
      // Bea's apps read their rows again after the remove (with her tokens).
      for (const t of devs.bea) await readFriends(w.api(t), await fresh(w.api(t), w), newListCache(), w.now())
      const seen = new Set(w.calls.filter((c) => devs.bea.includes(c.token ?? '') && c.op === 'read' && c.id !== null).map((c) => c.id!))
      const numbers = r.handle.index.stats!
      if (seen.has(numbers)) leaks.push(`${seed}: read the numbers gist`)
      for (const id of seen) if (JSON.parse(w.text(id, POINTER_FILE) ?? '{}').stats === numbers) leaks.push(`${seed}: ${id}`)
    }
    expect(runs).toBe(300)
    expect(removes).toBeGreaterThan(100)
    expect(leaks).toEqual([])
  })
})

describe('YAZ-5276: a remove deletes only the old numbers gist that the list names, and only when it is ours', () => {
  it('the format check: only a gist with exactly our one numbers file, in our format, is ours', async () => {
    const w = people()
    const ali = await person(w, 'ali')
    const ours = JSON.stringify(emptyNumbers(w.now()))
    expect(await isOurNumbersGist(ali.api, w.seed('ali', { [NUMBERS_FILE]: ours }))).toBe(true)
    expect(await isOurNumbersGist(ali.api, w.seed('ali', { [NUMBERS_FILE]: ours, 'README.md': 'mine' }))).toBe(false) // a second file
    expect(await isOurNumbersGist(ali.api, w.seed('ali', { [NUMBERS_FILE]: '{"my":"backup"}' }))).toBe(false) // not our format
    expect(await isOurNumbersGist(ali.api, w.seed('ali', { [NUMBERS_FILE]: 'not json' }))).toBe(false)
    expect(await isOurNumbersGist(ali.api, w.seed('ali', { 'stats.json': ours }))).toBe(false) // another name
    expect(await isOurNumbersGist(ali.api, 'abcdef0123456789abcdef0123456789')).toBe(false) // not there
    w.failNext = (c) => (c.op === 'read' ? 'GITHUB_DOWN' : undefined)
    await expect(isOurNumbersGist(ali.api, ali.handle.index.stats!)).rejects.toThrow() // in doubt: no answer, so no delete
  })

  it('a remove keeps the old numbers gist that the list names when it is not in our format', async () => {
    const w = people()
    const ali = await person(w, 'ali')
    const s = await shareLink(ali.api, ali.handle, opts(w))
    const old = ali.handle.index.stats!
    w.setFiles(old, { [NUMBERS_FILE]: '{"my":"own numbers"}' })
    expect((await removeFriend(ali.api, await fresh(ali.api, w), s.pointer, emptyBudget(), opts(w))).kind).toBe('done')
    expect(w.text(old, NUMBERS_FILE)).toBe('{"my":"own numbers"}')
    expect((await fresh(ali.api, w)).index.stats).not.toBe(old)
  })

  it('a remove does not delete a gist of another tool that also holds a file named notecards-stats.json', async () => {
    const w = people()
    const ali = await person(w, 'ali')
    const s = await shareLink(ali.api, ali.handle, opts(w))
    const other = w.seed('ali', { [NUMBERS_FILE]: '{"my":"backup"}', 'README.md': 'my own copy' })
    expect((await removeFriend(ali.api, await fresh(ali.api, w), s.pointer, emptyBudget(), opts(w))).kind).toBe('done')
    expect(w.text(other, 'README.md')).not.toBeNull() // now: deleted
  })

  it('two devices finish the same waiting remove at once: the list ends on a numbers gist that exists, and only one stays', async () => {
    const bad: number[] = []
    for (let seed = 1; seed <= 10; seed++) {
      const w = people()
      const ali = await person(w, 'ali')
      const bea = await person(w, 'bea')
      const s1 = await shareLink(ali.api, ali.handle, opts(w))
      const p = await pasteLink(bea.api, await fresh(bea.api, w), s1.link, opts(w))
      if (p.kind !== 'added') throw new Error(p.kind)
      await pasteLink(ali.api, await fresh(ali.api, w), p.sendBack!, opts(w))
      const s2 = await shareLink(ali.api, await fresh(ali.api, w), opts(w))
      w.failNext = (c) => (c.op === 'remove' ? 'OFFLINE' : undefined)
      expect((await removeFriend(ali.api, await fresh(ali.api, w), s2.pointer, emptyBudget(), opts(w))).kind).toBe('paused')
      w.shuffle(seed)
      const mac = w.api('ali-mac')
      await Promise.all([finishRemove(ali.api, await fresh(ali.api, w), emptyBudget(), opts(w)), finishRemove(mac, await fresh(mac, w), emptyBudget(), opts(w))])
      const h = await fresh(ali.api, w)
      if (w.text(h.index.stats!, NUMBERS_FILE) === null || pendingRemove(h) !== null) bad.push(seed)
      else {
        // The friend that stays (Bea) reads the numbers gist of the list.
        for (const f of h.index.friends) expect(JSON.parse(w.text(f.mine, POINTER_FILE)!).stats, `seed ${seed}`).toBe(h.index.stats)
        expect(w.owned('ali').filter((g) => NUMBERS_FILE in g.files && Object.keys(g.files).length === 1), `seed ${seed}`).toHaveLength(1)
      }
    }
    expect(bad).toEqual([]) // now: [1, 2, 4, 5, 6, 7, 8, 9, 10]
  })
})

describe('YAZ-5191 in 4E2: add and remove never write over a list that cannot be read', () => {
  it('paste, share, remove and finish stop with "needs-repair" and change nothing', async () => {
    const w = people()
    const { ali, aliForBea } = await paired(w, 1)
    const text = '{"v":1,"friends":['
    w.setFiles(ali.handle.id, { [INDEX_FILE]: text })
    const writes = () => w.calls.filter((c) => c.op !== 'list' && c.op !== 'read').length
    const n = writes()
    expect(await pasteLink(ali.api, ali.handle, ID, opts(w))).toEqual({ kind: 'needs-repair' })
    expect(pasteMessage({ kind: 'needs-repair' })).toContain('notecards-friends.json')
    await expect(shareLink(ali.api, ali.handle, opts(w))).rejects.toThrow()
    expect(await removeFriend(ali.api, ali.handle, aliForBea, emptyBudget(), opts(w))).toMatchObject({ kind: 'paused', why: 'needs-repair' })
    expect(await finishRemove(ali.api, ali.handle, emptyBudget(), opts(w))).toMatchObject({ kind: 'paused', why: 'needs-repair' })
    expect(writes()).toBe(n)
    expect(w.text(ali.handle.id, INDEX_FILE)).toBe(text)
    expect(w.text(aliForBea, POINTER_FILE)).not.toBeNull()
  })
})

describe('a friend who removed me (round 12, item 6)', () => {
  it('shows "No longer shares with you" with no crash, and asks GitHub again at most once an hour', async () => {
    const w = people()
    const { ali, bea, aliForBea } = await paired(w)
    await removeFriend(ali.api, ali.handle, aliForBea, emptyBudget(), opts(w))
    const cache = newListCache()
    const first = await readFriends(bea.api, bea.handle, cache, w.now())
    expect(first.rows[0]).toMatchObject({ state: 'gone', label: 'No longer shares with you', sendBack: null })
    const n = w.calls.length
    for (let i = 0; i < 30; i++) {
      w.advance(60_000) // the Friends tab reads each minute
      expect((await readFriends(bea.api, bea.handle, cache, w.now())).rows[0].state).toBe('gone')
    }
    expect(w.calls.length).toBe(n)
    w.advance(GONE_RECHECK_MS)
    await readFriends(bea.api, bea.handle, cache, w.now())
    expect(w.calls.length).toBe(n + 1)
    // Nothing is deleted automatically: Bea's entry and her pointer stay until she taps Remove.
    expect((await fresh(bea.api, w)).index.friends).toHaveLength(1)
  })
})
