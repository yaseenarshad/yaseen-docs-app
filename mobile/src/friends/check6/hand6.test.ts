/* eslint-disable @typescript-eslint/no-explicit-any */
import { expect, it } from 'vitest'
import { INDEX_FILE, NUMBERS_FILE, POINTER_FILE, readListFiles } from '@shared/friendGists'
import { LIST_PATH, parseListFile } from '@shared/friendListStore'
import { friendLink, homeGoneMessage } from '@shared/friendsList'
import { saveAccount } from '../../auth/account'
import { loadVaultList, saveVaultList, vaultId } from '../../store'
import { noRealWaits } from '../check4/run4.testing'
import { Model5 } from '../check5/model5.testing'

noRealWaits()
const K0 = { pStale: 0, p502: 0, pSecondary: 0, pContents404: 0 }

async function world(nA = 2) {
  const m = new Model5(4242, K0)
  m.hookRepos()
  await m.setup4(nA, 1, 1, false, false, false)
  // Pair B with A (A shares, B pastes, B's link back, A pastes).
  const a = m.devs.A[0] as any
  const b = m.devs.B[0] as any
  const s = await a.list.share()
  m.give('A', 'B', s.link.split('#')[1])
  const p = await b.list.paste(s.link)
  m.give('B', 'A', p.sendBack.split('#')[1])
  const q = await a.list.paste(p.sendBack)
  expect(q.kind).toBe('added')
  await a.list.rows()
  await b.list.rows()
  return m
}
const listA = (m: Model5) => m.listOf('A')!
/** A's list where A's note says it is (YAZ-5399: after a start again, another vault). */
const listAt = (m: Model5) => {
  const note = m.world.owned('ali').find((g) => INDEX_FILE in g.files)!
  const home = (JSON.parse(note.files[INDEX_FILE]) as { home: string }).home
  const file = parseListFile(m.world.repos!.file(home, LIST_PATH)!)
  if (file.kind !== 'ok') throw new Error(file.kind)
  const read = readListFiles(file.files)
  if (read.kind !== 'ok') throw new Error(read.kind)
  return { home, index: read.value }
}
const bMine = (m: Model5) => m.bEntries()[0].mine
const stats = (m: Model5) => listA(m).index.stats!

/** A second vault of A on the phone (the same account), where the list can start again (YAZ-5399). */
async function addVault(d: any, repo: string) {
  const v = { repo, branch: 'main', addedAt: Date.parse('2026-11-14T15:00:00Z') }
  const list = await loadVaultList(d.store)
  await saveVaultList(d.store, { vaults: [...list.vaults, v], open: list.open })
  await d.tokens.write(vaultId(v), `github_pat_11CHECK3_${'ali'.padEnd(70, '0')}`)
  await saveAccount(d.store, vaultId(v), { login: 'ali', name: 'ALI', avatarUrl: '', gists: 'yes', expiresAt: null, checkedAt: Date.parse('2026-11-14T15:00:00Z') })
}
const pointerStats = (m: Model5, id: string) => {
  const p = m.gist(id)?.files[POINTER_FILE]
  return p === undefined ? null : (JSON.parse(p) as { stats: string }).stats
}
const notes = (m: Model5) => m.world.owned('ali').filter((g) => INDEX_FILE in g.files).map((g) => JSON.parse(g.files[INDEX_FILE]) as { v: number; home?: string })

// CHECKER round 5 (YAZ-5399), with the way out of the decision on YAZ-5399 (builder of the round 5 fixes): the checker's
// version expected that a person can still stop sharing with B; it failed with

// ---------------------------------------------------------------------------------------------------------------------
// CHECKER round 6 (YAZ-5083). Made-up data, the strict fake.

const oldFriendReaches = (m: Model5, stats: string | null) => m.bfs('B', stats).hit

it('R6-1: the list FILE is deleted on GitHub (the home vault still answers): can A still stop sharing with B?', async () => {
  const m = await world(1)
  const a = m.devs.A[0] as any
  const mine = bMine(m)
  const numbers = stats(m)
  await addVault(a, 'ali/notes')
  m.world.repos!.push('ali/vault', { [LIST_PATH]: null }, 'main', 'a person deleted the list file on github.com')
  m.clock.advance(11 * 60_000)
  const rows = await a.list.rows()
  const rem = await a.list.remove(mine)
  const out = await a.list.restart('ali/notes')
  console.log('R6-1', JSON.stringify({ rows: rows.kind, remove: rem.kind, restart: out.kind, bPointerAlive: m.gist(mine) !== undefined, bReachesNumbers: oldFriendReaches(m, numbers) }))
  // The requirement of decision 22 and YAZ-5399: a person can always stop sharing with a friend.
  expect(m.gist(mine) === undefined || !oldFriendReaches(m, numbers)).toBe(true)
})

it('R6-1b: the home vault is deleted and made again under the SAME name (empty): can A still stop sharing with B?', async () => {
  const m = await world(1)
  const a = m.devs.A[0] as any
  const mine = bMine(m)
  const numbers = stats(m)
  await addVault(a, 'ali/notes')
  m.world.repos!.remove('ali/vault')
  m.world.repos!.create('ali/vault', 'ali', { 'a.md': '# A page\n' })
  m.clock.advance(11 * 60_000)
  const rows = await a.list.rows()
  const rem = await a.list.remove(mine)
  const out = await a.list.restart('ali/notes')
  console.log('R6-1b', JSON.stringify({ rows: rows.kind, remove: rem.kind, restart: out.kind, bPointerAlive: m.gist(mine) !== undefined, bReachesNumbers: oldFriendReaches(m, numbers) }))
  expect(m.gist(mine) === undefined || !oldFriendReaches(m, numbers)).toBe(true)
})

it('R6-2: a person puts back an OLDER list on GitHub (rev goes down): each phone is quiet for at most 10 minutes, then works; never stuck', async () => {
  const m = await world(2)
  const [a0, a1] = m.devs.A as any[]
  const repos = m.world.repos!
  const old = repos.file('ali/vault', LIST_PATH)!
  for (let i = 0; i < 3; i++) expect((await a0.list.share()).kind).toBe('ok')
  expect((await a1.list.rows()).kind).toBe('ok')
  const revOf = () => (JSON.parse(repos.file('ali/vault', LIST_PATH)!) as { rev: number }).rev
  const high = revOf()
  repos.push('ali/vault', { [LIST_PATH]: old }, 'main', 'restore an older list')
  expect(revOf()).toBeLessThan(high)
  const r0 = await a0.list.rows()
  const r1 = await a1.list.rows()
  m.clock.advance(11 * 60_000)
  const r0b = await a0.list.rows()
  const s = await a0.list.share()
  const r0c = await a0.list.rows()
  const r1b = await a1.list.rows()
  // a1 remembers a rev that is HIGHER than a0's new write: still quiet only inside its own window.
  m.clock.advance(11 * 60_000)
  const r1c = await a1.list.rows()
  const r1s = await a1.list.share()
  console.log('R6-2', JSON.stringify({ high, after: revOf(), r0: r0.kind, r1: r1.kind, r0b: r0b.kind, share: s.kind, r0c: r0c.kind, r1b: r1b.kind, r1c: r1c.kind, r1share: r1s.kind }))
  expect(r0b.kind).toBe('ok')
  expect(s.kind).toBe('ok')
  expect(r0c.kind).toBe('ok')
  expect(r1c.kind).toBe('ok')
  expect(r1s.kind).toBe('ok')
})

it('R6-3: after "Start the friends list again", no OLD friend (B), no holder of an old unused link (C) and no old session of A`s other phone reaches the NEW numbers', async () => {
  const m = await world(2)
  const [a0, a1] = m.devs.A as any[]
  const c = m.devs.C[0] as any
  // An unused link of A that C holds, and a group of A with B in it would be the same class; a shared link is enough here.
  const s = await a0.list.share()
  m.give('A', 'C', s.link.split('#')[1])
  await addVault(a0, 'ali/notes')
  m.world.repos!.remove('ali/vault')
  expect((await a0.list.rows()).kind).toBe('home-gone')
  expect((await a0.list.restart('ali/notes')).kind).toBe('done')
  const fresh = listAt(m).index.stats
  // A's other phone, in its OLD session (it opened the list before the restart), runs rows and sends.
  const o1 = await a1.list.rows()
  await m.run({ t: 'send', who: 'A', dev: 1 })
  // B and C act with what they kept: B reads, C pastes the old link.
  await m.run({ t: 'rows', who: 'B', dev: 0 })
  const cp = await c.list.paste(s.link)
  await m.run({ t: 'send', who: 'B', dev: 0 })
  await a0.list.rows()
  console.log('R6-3', JSON.stringify({ a1Rows: o1.kind, cPaste: cp.kind, bReachesNew: m.bfs('B', fresh).hit, cReachesNew: m.bfs('C', fresh).hit }))
  expect(m.bfs('B', fresh).hit).toBe(false)
  expect(m.bfs('C', fresh).hit).toBe(false)
  expect(cp.kind).not.toBe('added')
})

it('R6-4: a remove whose reads stay STALE past the 6 tries: it stops quietly, and the next run finishes it (no dead end)', async () => {
  const m = await world(1)
  const a = m.devs.A[0] as any
  const mine = bMine(m)
  const numbers = stats(m)
  m.world.repos!.staleNext = 40
  const r1 = await a.list.remove(mine)
  m.world.repos!.staleNext = 0
  const mid = { kind: r1.kind, bPointer: m.gist(mine) !== undefined, waits: (listA(m).index as any) }
  void mid
  const r2 = await a.list.rows()
  const r3 = await a.list.remove(mine)
  console.log('R6-4', JSON.stringify({ first: r1.kind, rows: r2.kind, again: r3.kind, bPointer: m.gist(mine) !== undefined, bReachesCurrent: m.bfs('B', listA(m).index.stats).hit, bReachesOld: m.bfs('B', numbers).hit }))
  expect(r1.kind).not.toBe('done')
  expect(m.gist(mine)).toBeUndefined()
  expect(m.bfs('B', listA(m).index.stats).hit).toBe(false)
})

// ---------------------------------------------------------------------------------------------------------------------
// BUILDER (YAZ-5444): the edges of the way out for a list FILE that is gone. Made-up data, the strict fake.

it('YAZ-5444 a: a list file missing INSIDE the stale window (a lag, or a delete a moment ago) offers no way out and deletes nothing', async () => {
  const m = await world(1)
  const a = m.devs.A[0] as any
  const mine = bMine(m)
  await addVault(a, 'ali/notes')
  m.world.repos!.push('ali/vault', { [LIST_PATH]: null }, 'main', 'a person deleted the list file on github.com')
  m.clock.advance(2 * 60_000)
  const rows = await a.list.rows()
  const out = await a.list.restart('ali/notes')
  // Inside the window a missing file is a stale read (quiet, YAZ-5398): no way out is offered.
  expect(rows.kind).not.toBe('home-gone')
  expect(out.kind).toBe('home-is-there')
  expect(m.gist(mine)).toBeDefined()
  expect(m.world.repos!.file('ali/notes', LIST_PATH)).toBeNull()
})

it('YAZ-5444 b: the way out offers the home vault itself, and starts the list again THERE (B`s pointer gone, a new numbers gist)', async () => {
  const m = await world(1)
  const a = m.devs.A[0] as any
  const mine = bMine(m)
  const numbers = stats(m)
  m.world.repos!.push('ali/vault', { [LIST_PATH]: null }, 'main', 'a person deleted the list file on github.com')
  m.clock.advance(11 * 60_000)
  const rows = await a.list.rows()
  expect(rows).toMatchObject({ kind: 'home-gone', home: 'ali/vault', fileGone: true })
  expect(rows.vaults).toContain('ali/vault')
  expect(homeGoneMessage('ali/vault', true)).toMatch(/ali\/vault.*friends\.json is gone/)
  expect((await a.list.restart('ali/vault')).kind).toBe('done')
  expect(m.gist(mine)).toBeUndefined()
  expect(m.gist(numbers)).toBeUndefined()
  const now = listAt(m)
  expect(now.home).toBe('ali/vault')
  expect(now.index.stats).not.toBe(numbers)
  expect(notes(m)).toHaveLength(1)
  expect((await a.list.rows()).kind).toBe('ok')
  expect((await a.list.share()).kind).toBe('ok')
})

it('YAZ-5444 c: a list file that is BACK before the way out runs is never replaced (and nothing is deleted)', async () => {
  const m = await world(1)
  const a = m.devs.A[0] as any
  const mine = bMine(m)
  const repos = m.world.repos!
  const old = repos.file('ali/vault', LIST_PATH)!
  repos.push('ali/vault', { [LIST_PATH]: null }, 'main', 'a person deleted the list file on github.com')
  m.clock.advance(11 * 60_000)
  expect((await a.list.rows()).kind).toBe('home-gone')
  repos.push('ali/vault', { [LIST_PATH]: old }, 'main', 'a person put the list file back')
  expect((await a.list.restart('ali/vault')).kind).toBe('home-is-there')
  expect(repos.file('ali/vault', LIST_PATH)).toBe(old)
  expect(m.gist(mine)).toBeDefined()
})

it('YAZ-5444 d: A`s OTHER phone (it read the list before the delete) takes the list that the way out starts in the same vault at once', async () => {
  const m = await world(2)
  const [a0, a1] = m.devs.A as any[]
  // a1 reads the list (rev n) 9 minutes on; then the file is deleted; 2 minutes later a0 (its last read 11 minutes ago)
  // gets the way out and starts the list again in the same vault. a1's memory of rev n is still fresh: the new list's
  // rev is above n, so a1 takes it at once (a rev 1 would read as a stale read for up to 10 minutes).
  m.clock.advance(9 * 60_000)
  expect((await a1.list.rows()).kind).toBe('ok')
  m.world.repos!.push('ali/vault', { [LIST_PATH]: null }, 'main', 'a person deleted the list file on github.com')
  m.clock.advance(2 * 60_000)
  expect((await a0.list.rows()).kind).toBe('home-gone')
  expect((await a0.list.restart('ali/vault')).kind).toBe('done')
  expect((await a1.list.rows()).kind).toBe('ok')
  expect((await a1.list.share()).kind).toBe('ok')
})
