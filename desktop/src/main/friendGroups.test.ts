import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { INDEX_FILE, NUMBERS_FILE, POINTER_FILE, ensureFriendsFiles, findFriendsIndex, makePointer, pointersOf, type GistsApi, type IndexHandle } from '@shared/friendGists'
import { fakeGistWorld, type FakeGistWorld } from '@shared/friendGistsFake'
import {
  GROUP_FILE,
  GROUP_LINK_BASE,
  GROUP_NAME_MAX,
  JOIN_LINK_BASE,
  NOT_ADDED_AFTER_MS,
  ORPHAN_AGE_MS,
  addMember,
  cleanGroupName,
  createGroup,
  dailyMark,
  deleteGroup,
  groupFileText,
  groupLink,
  groupStreak,
  groupViewMessage,
  joinGroup,
  joinLink,
  joinMessage,
  leaveGroup,
  markJoined,
  parseAnyLink,
  parseGroupFile,
  readGroup,
  readJoinRequest,
  removeMember,
  sweepOrphans,
} from '@shared/friendGroups'
import { finishRemove, newListCache, pendingRemove, type ListOptions } from '@shared/friendsList'
import { emptyBudget } from '@shared/friendSend'
import type { FriendDay, FriendStats } from '@shared/friendStats'

/**
 * YAZ-5084 (4E3): groups run by an admin (decision 18; round 14: remove, leave, "Delete group"; round 16: one pointer
 * for each group; round 10, addition 13: the group streak). A fake gist API; no real GitHub call.
 */
const TZ = process.env.TZ
beforeAll(() => {
  process.env.TZ = 'America/New_York'
})
afterAll(() => {
  process.env.TZ = TZ
})

const NOW = Date.parse('2026-11-14T16:00:00Z') // 11:00 in New York
const G = 'a1b2c3d4e5f60718293a4b5c6d7e8f90'
const P = '0f1e2d3c4b5a69788796a5b4c3d2e1f0'
const opts = (w: FakeGistWorld): ListOptions => ({ describe: (kind) => `notecards-test ${kind}`, sleep: async () => {}, now: w.now })
const day = (d: string, cards: number, done: boolean): FriendDay => ({ day: d, cards, seconds: cards * 10, remembered: cards, forgot: 0, newCards: 0, done })
const stats = (login: string, days: FriendDay[] = [day('2026-11-14', 3, true)]): FriendStats => ({
  v: 1,
  login,
  name: login[0].toUpperCase() + login.slice(1),
  avatar: '',
  days,
  totals: { cards: 10, inReview: 5, newLeft: 5, mature: 0, dueLeft: 0, addedThisWeek: 1, streak: 1, bestStreak: 1, bestDay: 3, bestWeek: 3 },
  at: new Date(NOW).toISOString(),
})

const people = (names = ['ali', 'bea', 'cem']) => fakeGistWorld({ accounts: Object.fromEntries(names.map((n) => [n, { login: n }])), start: NOW })
async function person(w: FakeGistWorld, login: string): Promise<{ api: GistsApi; handle: IndexHandle }> {
  const api = w.api(login)
  const made = await ensureFriendsFiles(api, { vaults: [`${login}/vault`], nickname: null, numbers: stats(login) }, opts(w))
  if (made.kind !== 'ok') throw new Error('no list')
  return { api, handle: made.handle }
}
const fresh = async (api: GistsApi, w: FakeGistWorld) => {
  const f = await findFriendsIndex(api, opts(w))
  if (f.kind !== 'ok') throw new Error(f.kind)
  return f.handle
}
const writes = (w: FakeGistWorld) => w.calls.filter((c) => c.op !== 'list' && c.op !== 'read').length

/** Ali runs "Club"; Bea (and Cem) joined and were added. */
async function club(w: FakeGistWorld, members = ['bea']) {
  const ali = await person(w, 'ali')
  const made = await createGroup(ali.api, ali.handle, '  Club  ', 'ali', opts(w))
  if (made.kind !== 'ok') throw new Error(made.kind)
  const out: Record<string, { api: GistsApi; handle: IndexHandle; pointer: string }> = {}
  for (const login of members) {
    const p = await person(w, login)
    const joined = await joinGroup(p.api, p.handle, made.link, opts(w))
    if (joined.kind !== 'joined') throw new Error(joined.kind)
    const added = await addMember(ali.api, made.handle, made.group, joined.sendToAdmin, opts(w))
    if (added.kind !== 'done') throw new Error(added.kind)
    out[login] = { api: p.api, handle: joined.handle, pointer: joined.handle.index.groups[0].mine }
  }
  return { ali: { ...ali, handle: made.handle }, group: made.group, link: made.link, members: out }
}

describe('links: group, join request, friend (decision 18)', () => {
  it('builds and reads each kind, in any shape; a bare ID is read by its file later', () => {
    expect(groupLink(G)).toBe(`${GROUP_LINK_BASE}#${G}`)
    expect(joinLink(G, P)).toBe(`${JOIN_LINK_BASE}#${G}-${P}`)
    expect(parseAnyLink(`Join us! ${groupLink(G)}/ `)).toEqual({ kind: 'group', id: G })
    expect(parseAnyLink(`https://preview.notecards.yaseenarshad.com/group/${G.toUpperCase()}`)).toEqual({ kind: 'group', id: G })
    expect(parseAnyLink(`  ${joinLink(G, P)}  `)).toEqual({ kind: 'join', group: G, pointer: P })
    expect(parseAnyLink(`https://notecards.yaseenarshad.com/friend#${P}`)).toEqual({ kind: 'friend', id: P })
    expect(parseAnyLink(G)).toEqual({ kind: 'id', id: G })
    expect(parseAnyLink(`https://gist.github.com/ali/${G}`)).toEqual({ kind: 'id', id: G })
    expect(parseAnyLink('https://stepup.app/group/9')).toEqual({ kind: 'other-app' })
    expect(parseAnyLink(`${JOIN_LINK_BASE}#${G}`)).toEqual({ kind: 'not-a-link' })
    expect(parseAnyLink('  ')).toEqual({ kind: 'empty' })
  })

  it('a group name is one line, trimmed, at most GROUP_NAME_MAX letters; an empty one is refused', () => {
    expect(cleanGroupName('  Study\n group  ')).toBe('Study group')
    expect(cleanGroupName('x'.repeat(200))).toHaveLength(GROUP_NAME_MAX)
    expect(cleanGroupName('   ')).toBeNull()
  })
})

describe('the group file (decision 18): read entry by entry, never written over when it cannot be read', () => {
  it('reads each member alone, cuts long texts for the screens only, keeps what it cannot read', () => {
    const raw = { v: 1, name: 'N'.repeat(300), admin: 'ali', later: 1, members: [{ login: 'ali', pointer: P }, { login: 'x', pointer: 'not hex' }, { login: 7, pointer: G, more: true }] }
    const read = parseGroupFile(JSON.stringify(raw))
    expect(read).toMatchObject({ kind: 'ok', value: { v: 1, admin: 'ali', members: [{ login: 'ali', pointer: P }, { login: '', pointer: G }] } })
    if (read.kind !== 'ok') return
    expect(read.value.name.length).toBeLessThanOrEqual(100)
    const back = JSON.parse(groupFileText({ ...read.value, members: [...read.value.members, { login: 'bea', pointer: 'ab12' }] }, read.raw))
    expect(back).toEqual({ ...raw, members: [{ login: 'ali', pointer: P }, { login: 7, pointer: G, more: true }, { login: 'bea', pointer: 'ab12' }, { login: 'x', pointer: 'not hex' }] })
    expect(parseGroupFile(JSON.stringify({ ...raw, v: 2 }))).toEqual({ kind: 'newer' })
    for (const bad of ['', '{', '[]', 'null', '{"v":0}']) expect(parseGroupFile(bad).kind).toBe('unreadable')
  })
})

describe('YAZ-5241 in the group file', () => {
  it('members, name or admin of the wrong shape: "unreadable", never an empty value', () => {
    const ok = { v: 1, name: 'Club', admin: 'ali', members: [] }
    for (const bad of [{ members: {} }, { members: 'x' }, { name: 5 }, { admin: [] }]) expect(parseGroupFile(JSON.stringify({ ...ok, ...bad })).kind, JSON.stringify(bad)).toBe('unreadable')
  })
})

describe('create, join, add (decision 18; round 16)', () => {
  it('"New group": my pointer, the group file in MY gist with only the name and logins, and the group in my list', async () => {
    const w = people()
    const ali = await person(w, 'ali')
    const made = await createGroup(ali.api, ali.handle, '  Club  ', 'ali', opts(w))
    if (made.kind !== 'ok') throw new Error(made.kind)
    expect(made.link).toBe(groupLink(made.group))
    const entry = made.handle.index.groups[0]
    expect(entry).toEqual({ name: 'Club', group: made.group, mine: expect.any(String), admin: true, joined: true })
    expect(JSON.parse(w.text(made.group, GROUP_FILE)!)).toEqual({ v: 1, name: 'Club', admin: 'ali', members: [{ login: 'ali', pointer: entry.mine }] })
    expect(JSON.parse(w.text(entry.mine, POINTER_FILE)!)).toEqual({ v: 1, stats: ali.handle.index.stats })
    expect(w.owned('ali').find((g) => g.id === made.group)!.public).toBe(false)
    expect(await createGroup(ali.api, made.handle, '   ', 'ali', opts(w))).toEqual({ kind: 'bad-name' })
  })

  it('Bea joins with the group link: her pointer, "waiting" until the admin adds her; the admin sees her request first', async () => {
    const w = people()
    const ali = await person(w, 'ali')
    const made = await createGroup(ali.api, ali.handle, 'Club', 'ali', opts(w))
    if (made.kind !== 'ok') throw new Error(made.kind)
    const bea = await person(w, 'bea')
    const joined = await joinGroup(bea.api, bea.handle, `hey ${made.link}`, opts(w))
    expect(joined).toMatchObject({ kind: 'joined', name: 'Club', group: made.group, sendToAdmin: expect.stringContaining(JOIN_LINK_BASE) })
    if (joined.kind !== 'joined') return
    const mine = joined.handle.index.groups[0]
    expect(mine).toMatchObject({ name: 'Club', group: made.group, admin: false })
    expect(mine.joined).toBeUndefined()
    expect(JSON.parse(w.text(mine.mine, POINTER_FILE)!)).toEqual({ v: 1, stats: bea.handle.index.stats }) // no reads, no mark

    const waiting = await readGroup(bea.api, joined.handle, made.group, newListCache(), w.now())
    expect(waiting).toEqual({ kind: 'waiting', group: made.group, name: 'Club', sendToAdmin: joined.sendToAdmin })

    // The admin's view of who asks to join: the request, read before it is added.
    const request = await readJoinRequest(ali.api, made.handle, joined.sendToAdmin)
    expect(request).toEqual({ kind: 'request', group: made.group, groupName: 'Club', pointer: mine.mine, login: 'bea', name: 'Bea' })
    expect(await addMember(ali.api, made.handle, made.group, joined.sendToAdmin, opts(w))).toMatchObject({ kind: 'done' })
    expect(await readJoinRequest(ali.api, made.handle, joined.sendToAdmin)).toEqual({ kind: 'already-member', name: 'Bea' })

    const view = await readGroup(bea.api, joined.handle, made.group, newListCache(), w.now())
    expect(view).toMatchObject({ kind: 'ok', name: 'Club', admin: 'ali', iAmAdmin: false, members: [{ login: 'ali', me: false, admin: true, state: 'ok' }, { login: 'bea', me: true, state: 'ok' }] })
    expect(joinMessage(joined)).toMatch(/admin/)
  })

  it('a group I run, a group I am in, a friend link, a gone group, a broken or newer group file: plain results, nothing written', async () => {
    const w = people()
    const { ali, group, link, members } = await club(w)
    const n = writes(w)
    expect(await joinGroup(ali.api, ali.handle, link, opts(w))).toEqual({ kind: 'own-group', name: 'Club' })
    expect(await joinGroup(members.bea.api, members.bea.handle, link, opts(w))).toMatchObject({ kind: 'already', name: 'Club' })
    expect(await joinGroup(members.bea.api, members.bea.handle, `https://notecards.yaseenarshad.com/friend#${P}`, opts(w))).toEqual({ kind: 'is-friend-link' })
    expect(await joinGroup(members.bea.api, members.bea.handle, joinLink(group, P), opts(w))).toEqual({ kind: 'is-join-request' })
    // A bare ID of a pointer is a friend's link, not a group.
    expect(await joinGroup(members.bea.api, members.bea.handle, members.bea.pointer, opts(w))).toEqual({ kind: 'is-friend-link' })
    expect(await joinGroup(members.bea.api, members.bea.handle, groupLink(G), opts(w))).toEqual({ kind: 'not-found' })
    expect(writes(w)).toBe(n)

    const cem = await person(w, 'cem')
    const m = writes(w)
    w.setFiles(group, { [GROUP_FILE]: '{"v":1,"members":[' })
    expect(await joinGroup(cem.api, cem.handle, link, opts(w))).toEqual({ kind: 'needs-repair' })
    w.setFiles(group, { [GROUP_FILE]: JSON.stringify({ v: 3, x: 1 }) })
    expect(await joinGroup(cem.api, cem.handle, link, opts(w))).toEqual({ kind: 'newer-app' })
    expect(writes(w)).toBe(m)
  })

  it('an admin with two groups: two files, two pointers; a member of one does not see the other', async () => {
    const w = people()
    const { ali, members } = await club(w)
    const second = await createGroup(ali.api, ali.handle, 'Run club', 'ali', opts(w))
    if (second.kind !== 'ok') throw new Error(second.kind)
    expect(second.handle.index.groups.map((g) => g.name)).toEqual(['Club', 'Run club'])
    expect(new Set(second.handle.index.groups.map((g) => g.mine)).size).toBe(2)
    expect(members.bea.handle.index.groups.map((g) => g.group)).not.toContain(second.group)
  })
})

describe('remove a member, leave, "Delete group" (round 14)', () => {
  it('the admin removes Bea: the others stop seeing her; Bea`s app says "removed" and leaves (her pointer goes)', async () => {
    const w = people()
    const { ali, group, members } = await club(w, ['bea', 'cem'])
    // Bea's app saw her in the group one time (the phone does this on its first read).
    const seen = await readGroup(members.bea.api, members.bea.handle, group, newListCache(), w.now())
    expect(seen).toMatchObject({ kind: 'ok', firstSeen: true })
    await markJoined(members.bea.api, members.bea.handle, group, opts(w))
    expect(await removeMember(ali.api, ali.handle, group, members.bea.pointer, opts(w))).toMatchObject({ kind: 'done' })
    const cemView = await readGroup(members.cem.api, members.cem.handle, group, newListCache(), w.now())
    expect(cemView.kind === 'ok' && cemView.members.map((m) => m.login)).toEqual(['ali', 'cem'])

    const beaHandle = await fresh(members.bea.api, w)
    expect(await readGroup(members.bea.api, beaHandle, group, newListCache(), w.now())).toEqual({ kind: 'removed', group, name: 'Club' })
    const left = await leaveGroup(members.bea.api, beaHandle, group, emptyBudget(), opts(w))
    expect(left.kind).toBe('done')
    expect(w.text(members.bea.pointer, POINTER_FILE)).toBeNull()
    expect((await fresh(members.bea.api, w)).index.groups).toEqual([])
  })

  it('Bea leaves: her pointer goes; the admin sees "Left the group" with no numbers, and removes the row', async () => {
    const w = people()
    const { ali, group, members } = await club(w, ['bea', 'cem'])
    const left = await leaveGroup(members.bea.api, members.bea.handle, group, emptyBudget(), opts(w))
    expect(left.kind).toBe('done')
    const view = await readGroup(ali.api, ali.handle, group, newListCache(), w.now())
    if (view.kind !== 'ok') throw new Error(view.kind)
    expect(view.members.find((m) => m.login === 'bea')).toMatchObject({ state: 'left', label: 'Left the group', read: { kind: 'gone' } })
    // Cem (not the admin) sees the row with no numbers.
    const cem = await readGroup(members.cem.api, members.cem.handle, group, newListCache(), w.now())
    expect(cem.kind === 'ok' && cem.members.find((m) => m.login === 'bea')).toMatchObject({ state: 'left', label: null })
    expect(await removeMember(ali.api, ali.handle, group, members.bea.pointer, opts(w))).toMatchObject({ kind: 'done' })
    expect(await removeMember(ali.api, ali.handle, group, members.bea.pointer, opts(w))).toEqual({ kind: 'not-a-member' })
  })

  it('the admin cannot leave; "Delete group" deletes the group file and my pointer; members see "gone" and leave', async () => {
    const w = people()
    const { ali, group, members } = await club(w)
    expect(await leaveGroup(ali.api, ali.handle, group, emptyBudget(), opts(w))).toEqual({ kind: 'admin-cannot-leave' })
    const adminPointer = ali.handle.index.groups[0].mine
    const deleted = await deleteGroup(ali.api, ali.handle, group, emptyBudget(), opts(w))
    expect(deleted.kind).toBe('done')
    expect(w.text(group, GROUP_FILE)).toBeNull()
    expect(w.text(adminPointer, POINTER_FILE)).toBeNull()
    expect((await fresh(ali.api, w)).index.groups).toEqual([])
    expect(await readGroup(members.bea.api, members.bea.handle, group, newListCache(), w.now())).toEqual({ kind: 'gone', group, name: 'Club' })
    expect((await leaveGroup(members.bea.api, members.bea.handle, group, emptyBudget(), opts(w))).kind).toBe('done')
    expect(await deleteGroup(members.bea.api, await fresh(members.bea.api, w), group, emptyBudget(), opts(w))).toEqual({ kind: 'not-found' })
  })

  it('only the admin changes the group: a member`s remove or add is "not-admin"', async () => {
    const w = people()
    const { group, members } = await club(w, ['bea', 'cem'])
    expect(await removeMember(members.bea.api, members.bea.handle, group, members.cem.pointer, opts(w))).toEqual({ kind: 'not-admin' })
    expect(await addMember(members.bea.api, members.bea.handle, group, joinLink(group, P), opts(w))).toEqual({ kind: 'not-admin' })
  })

  it('a group file that cannot be read is never written over: add and remove give "needs-repair"; readers see it too', async () => {
    const w = people()
    const { ali, group, members } = await club(w, ['bea'])
    const cem = await person(w, 'cem')
    const joined = await joinGroup(cem.api, cem.handle, groupLink(group), opts(w))
    if (joined.kind !== 'joined') throw new Error(joined.kind)
    const text = '{"v":1,"name":"Club","members":[{"login":"ali"'
    w.setFiles(group, { [GROUP_FILE]: text })
    const n = writes(w)
    expect(await addMember(ali.api, ali.handle, group, joined.sendToAdmin, opts(w))).toEqual({ kind: 'needs-repair' })
    expect(await removeMember(ali.api, ali.handle, group, members.bea.pointer, opts(w))).toEqual({ kind: 'needs-repair' })
    expect(await readGroup(members.bea.api, members.bea.handle, group, newListCache(), w.now())).toEqual({ kind: 'needs-repair', group, name: 'Club' })
    expect(writes(w)).toBe(n)
    expect(w.text(group, GROUP_FILE)).toBe(text)
  })

  it('leave and "Delete group" are finished by the next start after a stop at ANY point, and leave no orphan gist', async () => {
    for (const action of ['leave', 'delete'] as const) {
      let points = 0
      for (let k = 1; ; k++) {
        const w = people()
        const { ali, group, members } = await club(w, ['bea'])
        const who = action === 'leave' ? members.bea : { ...ali, pointer: ali.handle.index.groups[0].mine }
        const login = action === 'leave' ? 'bea' : 'ali'
        let count = 0
        w.failNext = (call) => (call.op !== 'list' && call.op !== 'read' && ++count === k ? 'OFFLINE' : undefined)
        const first = action === 'leave' ? await leaveGroup(who.api, who.handle, group, emptyBudget(), opts(w)) : await deleteGroup(who.api, who.handle, group, emptyBudget(), opts(w))
        w.failNext = null
        if (first.kind === 'done') break
        points++
        // The next start: finish what waits, then sweep (an hour later) what no list names.
        w.advance(ORPHAN_AGE_MS + 1000)
        let handle = await fresh(w.api(login), w)
        const done = await finishRemove(w.api(login), handle, emptyBudget(), opts(w))
        handle = done.handle
        if (pendingRemove(handle) === null && handle.index.groups.some((g) => g.group === group)) {
          // The stop came before the first write of the list: the action never started. Tap it again.
          const again = action === 'leave' ? await leaveGroup(who.api, handle, group, emptyBudget(), opts(w)) : await deleteGroup(who.api, handle, group, emptyBudget(), opts(w))
          expect(again.kind).toBe('done')
          handle = await fresh(w.api(login), w)
        }
        await sweepOrphans(w.api(login), handle, w.now())
        expect(handle.index.groups).toEqual([])
        expect(w.text(who.pointer, POINTER_FILE)).toBeNull()
        if (action === 'delete') expect(w.text(group, GROUP_FILE)).toBeNull()
        const owned = w.owned(login)
        expect(owned.filter((g) => NUMBERS_FILE in g.files).map((g) => g.id)).toEqual([handle.index.stats])
        expect(owned.filter((g) => POINTER_FILE in g.files || GROUP_FILE in g.files)).toEqual([])
      }
      expect(points, action).toBeGreaterThanOrEqual(action === 'leave' ? 4 : 5)
    }
  })

  it('a stop while a group is made or joined leaves gists that the sweep deletes an hour later, and only those', async () => {
    for (const stopAt of [1, 2, 3]) {
      const w = people()
      const ali = await person(w, 'ali')
      let count = 0
      w.failNext = (call) => (call.op !== 'list' && call.op !== 'read' && ++count === stopAt ? 'OFFLINE' : undefined)
      const made = await createGroup(ali.api, ali.handle, 'Club', 'ali', opts(w))
      w.failNext = null
      expect(made.kind).toBe('offline')
      const handle = await fresh(ali.api, w)
      expect(await sweepOrphans(ali.api, handle, w.now())).toEqual([]) // too new: another device may be at work
      w.advance(ORPHAN_AGE_MS + 1000)
      await sweepOrphans(ali.api, handle, w.now())
      expect(w.owned('ali').filter((g) => !(INDEX_FILE in g.files) && !(NUMBERS_FILE in g.files))).toEqual([])
      expect(w.owned('ali').filter((g) => NUMBERS_FILE in g.files)).toHaveLength(1)
    }
  })

  it('the sweep keeps every gist that the list names, and does nothing while a remove waits', async () => {
    const w = people()
    const { ali } = await club(w, ['bea'])
    w.advance(ORPHAN_AGE_MS * 2)
    const handle = await fresh(ali.api, w)
    const before = w.owned('ali').map((g) => g.id)
    expect(await sweepOrphans(ali.api, handle, w.now())).toEqual([])
    expect(w.owned('ali').map((g) => g.id)).toEqual(before)
    expect(pointersOf(handle.index).every((p) => before.includes(p))).toBe(true)
  })
})

describe('YAZ-5238: the sweep deletes only what is provably an orphan, by GitHub`s clock', () => {
  it('a device clock one day ahead does not delete a pointer or a group file that another device made a second ago', async () => {
    const w = people()
    const ali = await person(w, 'ali')
    const pointer = await makePointer(ali.api, ali.handle.index.stats!, opts(w))
    const group = w.seed('ali', { [GROUP_FILE]: JSON.stringify({ v: 1, name: 'New', admin: 'ali', members: [] }) })
    await sweepOrphans(ali.api, await fresh(ali.api, w), w.now() + 24 * 3600_000)
    expect(w.text(pointer, POINTER_FILE)).not.toBeNull() // now: deleted
    expect(w.text(group, GROUP_FILE)).not.toBeNull() // now: deleted
  })

  it('a gist of another device mid-flow survives; one that GitHub dates over the limit goes; a look-alike or a group in use stays', async () => {
    const w = people()
    const ali = await person(w, 'ali')
    const old = await makePointer(ali.api, ali.handle.index.stats!, opts(w))
    const lookAlike = w.seed('ali', { [POINTER_FILE]: 'my own text, not JSON' })
    const inUse = w.seed('ali', { [GROUP_FILE]: JSON.stringify({ v: 1, name: 'Lost', admin: 'ali', members: [{ login: 'ali', pointer: old }, { login: 'bea', pointer: P }] }) })
    w.advance(ORPHAN_AGE_MS + 1000)
    const midFlow = await makePointer(ali.api, ali.handle.index.stats!, opts(w)) // another device, one second ago
    const deleted = await sweepOrphans(ali.api, await fresh(ali.api, w), 0) // the device clock is wrong and is not used
    expect(deleted).toEqual([])
    expect(w.text(midFlow, POINTER_FILE)).not.toBeNull()
    expect(w.text(lookAlike, POINTER_FILE)).not.toBeNull()
    expect(w.text(inUse, GROUP_FILE)).not.toBeNull()
    expect(w.text(old, POINTER_FILE)).not.toBeNull() // named by a group file of mine (in use): kept
  })

  it('deletes NOTHING when a read fails, the list needs repair, or GitHub`s time is not known', async () => {
    const w = people()
    const ali = await person(w, 'ali')
    const orphan = await makePointer(ali.api, ali.handle.index.stats!, opts(w))
    w.advance(ORPHAN_AGE_MS + 1000)
    const handle = await fresh(ali.api, w)
    w.failNext = (call) => (call.op === 'read' ? 'GITHUB_DOWN' : undefined)
    expect(await sweepOrphans(ali.api, handle, w.now())).toEqual([])
    const noClock: GistsApi = { ...ali.api, serverTime: () => null }
    expect(await sweepOrphans(noClock, handle, w.now())).toEqual([])
    const listText = w.text(handle.id, INDEX_FILE)!
    w.setFiles(handle.id, { [INDEX_FILE]: '{"v":1,"friends":' })
    expect(await sweepOrphans(ali.api, handle, w.now())).toEqual([])
    w.setFiles(handle.id, { [INDEX_FILE]: listText })
    expect(w.text(orphan, POINTER_FILE)).not.toBeNull()
    expect(await sweepOrphans(ali.api, handle, w.now())).toEqual([orphan])
  })
})

describe('YAZ-5239: the login of a join request is the one GitHub vouches for', () => {
  it('a join request whose numbers claim the login of a member does not push that member out', async () => {
    const w = people(['ali', 'bea', 'eve'])
    const c = await club(w, ['bea'])
    const eve = await person(w, 'eve') // then: her numbers say login "bea"
    w.setFiles(eve.handle.index.stats!, { [NUMBERS_FILE]: JSON.stringify(stats('bea')) })
    const joined = await joinGroup(eve.api, eve.handle, c.link, opts(w))
    if (joined.kind !== 'joined') throw new Error(joined.kind)
    await addMember(c.ali.api, await fresh(c.ali.api, w), c.group, joined.sendToAdmin, opts(w))
    const members = JSON.parse(w.text(c.group, GROUP_FILE)!).members.map((m: { pointer: string }) => m.pointer)
    expect(members).toContain(c.members.bea.pointer) // now: Bea's entry is gone
  })

  it('the request shows the gist owner`s login; a claim of the admin`s login cannot replace the admin; a second request of a member is a refused duplicate', async () => {
    const w = people(['ali', 'bea', 'eve'])
    const c = await club(w, ['bea'])
    const eve = await person(w, 'eve')
    w.setFiles(eve.handle.index.stats!, { [NUMBERS_FILE]: JSON.stringify(stats('ali')) })
    const joined = await joinGroup(eve.api, eve.handle, c.link, opts(w))
    if (joined.kind !== 'joined') throw new Error(joined.kind)
    const aliH = await fresh(c.ali.api, w)
    expect(await readJoinRequest(c.ali.api, aliH, joined.sendToAdmin)).toMatchObject({ kind: 'request', login: 'eve' })
    expect(await addMember(c.ali.api, aliH, c.group, joined.sendToAdmin, opts(w))).toMatchObject({ kind: 'done' })
    expect(await readGroup(c.ali.api, aliH, c.group, newListCache(), w.now())).toMatchObject({ kind: 'ok', iAmAdmin: true })
    const file = JSON.parse(w.text(c.group, GROUP_FILE)!)
    expect(file.members.map((m: { login: string }) => m.login)).toEqual(['ali', 'bea', 'eve'])

    // Bea asks again with a new pointer: a duplicate of a member, refused; nobody is replaced.
    const again = await makePointer(c.members.bea.api, c.members.bea.handle.index.stats!, opts(w))
    expect(await readJoinRequest(c.ali.api, aliH, joinLink(c.group, again))).toMatchObject({ kind: 'duplicate', login: 'bea' })
    expect(await addMember(c.ali.api, aliH, c.group, joinLink(c.group, again), opts(w))).toMatchObject({ kind: 'duplicate', login: 'bea' })
    expect(JSON.parse(w.text(c.group, GROUP_FILE)!).members).toEqual(file.members)
  })

  it('the duplicate check ignores letter case: a second GitHub login "BEA" is a duplicate of member "bea"', async () => {
    const w = fakeGistWorld({ accounts: { ali: { login: 'ali' }, bea: { login: 'bea' }, bea2: { login: 'BEA' } }, start: NOW })
    const c = await club(w, ['bea'])
    const twin = w.api('bea2')
    const made = await ensureFriendsFiles(twin, { vaults: [], nickname: null, numbers: stats('bea') }, opts(w))
    if (made.kind !== 'ok') throw new Error(made.kind)
    const joined = await joinGroup(twin, made.handle, c.link, opts(w))
    if (joined.kind !== 'joined') throw new Error(joined.kind)
    const aliH = await fresh(c.ali.api, w)
    expect(await readJoinRequest(c.ali.api, aliH, joined.sendToAdmin)).toMatchObject({ kind: 'duplicate', login: 'BEA' })
    expect(await addMember(c.ali.api, aliH, c.group, joined.sendToAdmin, opts(w))).toEqual({ kind: 'duplicate', login: 'BEA' })
    const ownerAdmin = fakeGistWorld({ accounts: { ali: { login: 'ali' }, ali2: { login: 'ALI' } }, start: NOW })
    const c2 = await club(ownerAdmin, [])
    const twin2 = ownerAdmin.api('ali2')
    const made2 = await ensureFriendsFiles(twin2, { vaults: [], nickname: null, numbers: stats('ali') }, opts(ownerAdmin))
    if (made2.kind !== 'ok') throw new Error(made2.kind)
    const j2 = await joinGroup(twin2, made2.handle, c2.link, opts(ownerAdmin))
    if (j2.kind !== 'joined') throw new Error(j2.kind)
    expect(await addMember(c2.ali.api, await fresh(c2.ali.api, ownerAdmin), c2.group, j2.sendToAdmin, opts(ownerAdmin))).toEqual({ kind: 'duplicate', login: 'ALI' })
  })

  it('with no owner in GitHub`s answer (an adapter that does not give it), a request is "unverified" and Add refuses it', async () => {
    const w = people(['ali', 'bea'])
    const c = await club(w, [])
    const bea = await person(w, 'bea')
    const joined = await joinGroup(bea.api, bea.handle, c.link, opts(w))
    if (joined.kind !== 'joined') throw new Error(joined.kind)
    const blind: GistsApi = { ...c.ali.api, read: async (id, etag) => {
      const g = await c.ali.api.read(id, etag)
      return g === 'unchanged' ? g : { ...g, owner: undefined }
    } }
    const aliH = await fresh(c.ali.api, w)
    expect(await readJoinRequest(blind, aliH, joined.sendToAdmin)).toEqual({ kind: 'unverified' })
    expect(await addMember(blind, aliH, c.group, joined.sendToAdmin, opts(w))).toEqual({ kind: 'unverified' })
  })
})

describe('YAZ-5240: "removed" by state, and "not added" when the admin never adds', () => {
  it('a person added and removed before their app ever read the group sees "removed" (the file records the remove)', async () => {
    const w = people()
    const c = await club(w, ['bea'])
    expect(c.members.bea.handle.index.groups[0].joined).toBeUndefined() // her app never read the group
    expect(await removeMember(c.ali.api, c.ali.handle, c.group, c.members.bea.pointer, opts(w))).toMatchObject({ kind: 'done' })
    w.advance(90 * 86400_000)
    expect(await readGroup(c.members.bea.api, c.members.bea.handle, c.group, newListCache(), w.now())).toEqual({ kind: 'removed', group: c.group, name: 'Club' })
  })

  it('never added: "waiting" for 7 days after the ask, then "not-added" with the way out; nothing leaves by itself', async () => {
    const w = people()
    const ali = await person(w, 'ali')
    const made = await createGroup(ali.api, ali.handle, 'Club', 'ali', opts(w))
    if (made.kind !== 'ok') throw new Error(made.kind)
    const bea = await person(w, 'bea')
    const joined = await joinGroup(bea.api, bea.handle, made.link, opts(w))
    if (joined.kind !== 'joined') throw new Error(joined.kind)
    expect(joined.handle.index.groups[0].asked).toEqual(expect.any(String))
    w.advance(NOT_ADDED_AFTER_MS - 60_000)
    expect((await readGroup(bea.api, joined.handle, made.group, newListCache(), w.now())).kind).toBe('waiting')
    w.advance(2 * 60_000)
    const view = await readGroup(bea.api, joined.handle, made.group, newListCache(), w.now())
    expect(view).toEqual({ kind: 'not-added', group: made.group, name: 'Club', sendToAdmin: joined.sendToAdmin })
    expect(groupViewMessage(view)).toBe('The admin did not add you. Send them your join link again, or tap Leave.')
    expect(NOT_ADDED_AFTER_MS).toBe(7 * 86400_000)
  })

  it('the remove mark is bounded and goes when the person is added again', async () => {
    const w = people()
    const c = await club(w, ['bea'])
    await removeMember(c.ali.api, c.ali.handle, c.group, c.members.bea.pointer, opts(w))
    expect(JSON.parse(w.text(c.group, GROUP_FILE)!).removed).toEqual([c.members.bea.pointer])
    const read = parseGroupFile(JSON.stringify({ v: 1, name: 'x', admin: 'ali', members: [], removed: Array.from({ length: 300 }, (_, i) => i.toString(16).padStart(32, '0')) }))
    expect(read.kind === 'ok' && read.value.removed!.length).toBe(200)
    expect(parseGroupFile(JSON.stringify({ v: 1, name: 'x', admin: 'ali', members: [], removed: 'x' })).kind).toBe('unreadable')
  })
})

describe('reading a group (decisions 23 and 25; round 10, addition 13)', () => {
  it('50 members: one read of the group file and two of each member; the next read is all free 304s', async () => {
    const names = Array.from({ length: 50 }, (_, i) => `m${i}`)
    const w = people(['ali', ...names])
    const { ali, group } = await club(w, names)
    const cache = newListCache()
    let n = w.calls.length
    const view = await readGroup(ali.api, ali.handle, group, cache, w.now())
    if (view.kind !== 'ok') throw new Error(view.kind)
    expect(view.members).toHaveLength(51)
    expect(w.calls.length - n).toBe(1 + 51 * 2)
    n = w.calls.length
    await readGroup(ali.api, ali.handle, group, cache, w.now())
    expect(w.calls.slice(n).every((c) => c.answer === 304)).toBe(true)
    expect(w.calls.length - n).toBe(1 + 51 * 2)
  })

  it('each row has the member`s numbers and the daily mark; the group streak is in the view', async () => {
    const w = people()
    const { ali, group, members } = await club(w, ['bea'])
    const beaStats = members.bea.handle.index.stats!
    await members.bea.api.update(beaStats, { [NUMBERS_FILE]: JSON.stringify(stats('bea', [day('2026-11-14', 0, false), day('2026-11-13', 4, true)])) })
    const view = await readGroup(ali.api, ali.handle, group, newListCache(), w.now())
    if (view.kind !== 'ok') throw new Error(view.kind)
    expect(view.members.map((m) => [m.login, m.mark])).toEqual([
      ['ali', 'done'],
      ['bea', 'not-started'],
    ])
    expect(view.streak).toBe(0) // the 13th: Ali has no entry (her first answer is the 14th)
  })
})

describe('groupStreak (round 10, addition 13; decision 9: each member`s own local days)', () => {
  const m = (...days: FriendDay[]) => ({ days })
  const T = '2026-11-14'
  it('counts the days in a row that everyone finished; an unfinished today does not stop it', () => {
    expect(groupStreak([m(day(T, 3, true), day('2026-11-13', 1, true), day('2026-11-12', 1, true)), m(day(T, 2, true), day('2026-11-13', 1, true), day('2026-11-12', 0, false))], T)).toBe(2)
    expect(groupStreak([m(day(T, 0, false), day('2026-11-13', 1, true)), m(day(T, 2, true), day('2026-11-13', 1, true))], T)).toBe(1)
    expect(groupStreak([m(day(T, 1, true), day('2026-11-13', 0, false), day('2026-11-12', 1, true)), m(day(T, 1, true), day('2026-11-13', 1, true), day('2026-11-12', 1, true))], T)).toBe(1)
  })

  it('a member in Tokyo is a day ahead; a member in Hawaii has not reached today yet: neither breaks it', () => {
    const tokyo = m(day('2026-11-15', 1, false), day(T, 2, true), day('2026-11-13', 1, true))
    const hawaii = m(day('2026-11-13', 1, true), day('2026-11-12', 1, true))
    const ny = m(day(T, 1, true), day('2026-11-13', 1, true), day('2026-11-12', 1, true))
    expect(groupStreak([tokyo, ny], T)).toBe(2)
    expect(groupStreak([ny, hawaii], T)).toBe(2)
  })

  it('a member who stopped sending three days ago stops the streak; nobody, or a member with no answer, is 0', () => {
    const stale = m(day('2026-11-11', 1, true), day('2026-11-10', 1, true))
    const ny = m(day(T, 1, true), day('2026-11-13', 1, true), day('2026-11-12', 1, true), day('2026-11-11', 1, true))
    expect(groupStreak([ny, stale], T)).toBe(0)
    expect(groupStreak([], T)).toBe(0)
    expect(groupStreak([ny, m()], T)).toBe(0)
  })

  it('dailyMark (decision 25): not started, started, done; null with no entry for today', () => {
    const s = (d: FriendDay[], dueLeft = 3) => ({ ...stats('x', d), totals: { ...stats('x').totals, dueLeft } })
    expect(dailyMark(s([day(T, 0, false)]), T)).toBe('not-started')
    expect(dailyMark(s([day(T, 2, false)]), T)).toBe('started')
    expect(dailyMark(s([day(T, 2, true)], 0), T)).toBe('done')
    expect(dailyMark(s([day('2026-11-13', 2, true)]), T)).toBeNull()
  })
})
