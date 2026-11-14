import { describe, expect, it } from 'vitest'
import {
  INDEX_FILE,
  NUMBERS_FILE,
  POINTER_FILE,
  ensureFriendsFiles,
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
  removeFriend,
  removeMany,
  repairPairs,
  shareLink,
  type ListOptions,
} from '@shared/friendsList'
import { emptyBudget, recordUpdate } from '@shared/friendSend'
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
    expect(FRIEND_LINK_BASE).toBe('https://notecards.yaseenarshad.com/friend')
  })

  it('reads a pasted text in any shape', () => {
    for (const text of [
      friendLink(ID),
      `  ${friendLink(ID)}  `,
      `${friendLink(ID)}/`,
      `Add me on Notecards: ${friendLink(ID)} see you`,
      `https://preview.notecards.yaseenarshad.com/friend#${ID}`,
      `https://notecards.yaseenarshad.com/friend/${ID}`,
      `https://notecards.yaseenarshad.com/friend/${ID}/`,
      `https://notecards.yaseenarshad.com/friend?id=${ID}`,
      `notecards.yaseenarshad.com/friend#${ID}`,
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
    expect(parseFriendLink(`https://notecards.yaseenarshad.com.evil.example/friend#${ID}`)).toEqual({ kind: 'other-app' })
    expect(parseFriendLink('https://notecards.yaseenarshad.com/friend#nothex!')).toEqual({ kind: 'not-a-link' })
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
    expect(back.handle.index.friends).toEqual([{ name: 'Bea', theirs: beaMine, mine: share.pointer }])
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
  return { ali: { ...ali, handle }, bea: { ...bea, handle: b.handle }, aliForBea: share.pointer, beaForAli: b.handle.index.friends[0].mine }
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
    expect(w.updates('ali') - before).toBe(31 + 3)
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
    const shared = removed.handle.index.shared![0].mine
    const cancelled = await removeFriend(ali.api, removed.handle, shared, emptyBudget(), opts(w))
    expect(cancelled.kind).toBe('done')
    expect(cancelled.handle.index.shared).toEqual([])
    expectClean(w, 'ali', cancelled.handle)
    expect((await removeFriend(ali.api, cancelled.handle, ID, emptyBudget(), opts(w))).kind).toBe('not-found')
  })

  it('an orphan numbers gist from a stop between "make" and "write it in the list" is deleted when the remove finishes', async () => {
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
    // One re-key for four removes: the list 3 times, and each of the 4 other pointers (2 friends, 1 group, 1 shared link) once.
    expect(w.updates('ali') - before).toBe(3 + 4)
    expect((await readFriends(ali.api, done.handle, newListCache(), w.now())).rows.every((r) => r.state !== 'removing')).toBe(true)
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
