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


// ---------------------------------------------------------------------------------------------------------------------
// CHECKER round 7 (YAZ-5444 way out attacks). Made-up data, the strict fake.

const fileBack = (m: Model5, text: string) => m.world.repos!.push('ali/vault', { [LIST_PATH]: text }, 'main', 'the list file is back')
const del = (m: Model5) => m.world.repos!.push('ali/vault', { [LIST_PATH]: null }, 'main', 'the list file is not there (deleted, or a replica that lags)')

/**
 * R7-1 and R7-1b (YAZ-5462). The list file comes back AFTER the way out's check and BEFORE its new list. The checker's
 * version fired at the way out's first gist DELETE: with the old order (deletes, then the new list) that is exactly that
 * moment. With the fix the deletes come AFTER the new list, so the first DELETE is no longer "before its new list"; the
 * builder moved the trigger to the moment the title names, in the new order (the builder's round 7 fix):
 * - R7-1: at the way out's first write after its check (the new numbers gist, `POST /gists`);
 * - R7-1b: at the ref `PATCH` of the new list itself (between the read that saw no file and the move of the branch):
 *   the compare-and-swap of `onlyIfMissing` must refuse it (the missing test of that guard).
 * A file that a person puts back AFTER the way out wrote its new list is a new change on GitHub (it writes over the
 * app's new list); the way out found no list, by the compare-and-swap, so I9 does not apply to it.
 */
async function comesBack(trigger: (url: string, method: string) => boolean, name: string) {
  const m = await world(1)
  const a = m.devs.A[0] as any
  const mine = bMine(m)
  const numbers = stats(m)
  const old = m.world.repos!.file('ali/vault', LIST_PATH)!
  del(m)
  m.clock.advance(11 * 60_000)
  expect((await a.list.rows()).kind).toBe('home-gone')
  const orig = (m as any).fetchFor.bind(m)
  let back = false
  let armed = false
  ;(m as any).fetchFor = (d: any) => {
    const f = orig(d)
    return async (url: string, init: any) => {
      if (armed && !back && trigger(String(url), (init?.method ?? 'GET').toUpperCase())) {
        back = true
        fileBack(m, old)
      }
      return f(url, init)
    }
  }
  a.list = (m as any).newList(a)
  armed = true
  const out = await a.list.restart('ali/vault')
  const listNow = parseListFile(m.world.repos!.file('ali/vault', LIST_PATH)!)
  const statsNow = listNow.kind === 'ok' ? (readListFiles(listNow.files) as any).value.stats : null
  console.log(name, JSON.stringify({ back, restart: out.kind, listIsOld: m.world.repos!.file('ali/vault', LIST_PATH) === old, bPointerAlive: m.gist(mine) !== undefined, numbersAlive: m.gist(numbers) !== undefined, listNamesNumbers: statsNow === numbers, listNumbersExist: statsNow !== null && m.gist(statsNow) !== undefined }))
  for (let i = 0; i < 3; i++) {
    m.clock.advance(61 * 60_000)
    const r = await a.list.rows()
    const snd = await a.list.send?.().catch((e: any) => 'throw ' + e.message)
    const l2 = parseListFile(m.world.repos!.file('ali/vault', LIST_PATH)!)
    const st2 = l2.kind === 'ok' ? (readListFiles(l2.files) as any).value.stats : null
    console.log(name, 'later', i, JSON.stringify({ rows: r.kind === 'ok' ? r.rows?.map((x: any) => x.state) : r.kind, send: typeof snd === 'string' ? snd : snd?.kind, listNumbersExist: st2 !== null && m.gist(st2) !== undefined, bReaches: m.bfs('B', st2).hit }))
  }
  expect(back).toBe(true)
  // I9: a way out that finds a readable list there deletes nothing.
  expect(m.world.repos!.file('ali/vault', LIST_PATH)).toBe(old)
  expect(out.kind).toBe('home-is-there')
  expect(m.gist(mine)).toBeDefined()
  expect(m.gist(numbers)).toBeDefined()
}

it('R7-1: the list file comes BACK while the way out runs (after its check, before its new list): nothing may be deleted (I9)', async () => {
  await comesBack((url, method) => method === 'POST' && /\/gists$/.test(new URL(url).pathname), 'R7-1')
})

it('R7-1b: the list file comes BACK between the way out\'s read and its ref PATCH: the compare-and-swap refuses, nothing is deleted (I9)', async () => {
  await comesBack((url, method) => method === 'PATCH' && /\/repos\/ali\/vault\/git\/refs\//.test(new URL(url).pathname), 'R7-1b')
})

it('R7-2: a phone whose clock is 12 minutes FAST, a list made 1 minute ago (a lagging replica has no file yet): no way out may run', async () => {
  const m = await world(1)
  const mine = bMine(m)
  const old = m.world.repos!.file('ali/vault', LIST_PATH)!
  // The note is fresh (the list was made 1 minute ago by A's other phone), the replica lags: no file yet.
  m.clock.advance(60_000)
  del(m)
  ;(m as any).skew = { A1: 12 * 60_000 }
  // BUILDER (YAZ-5492 nit): the REAL path of a phone. A browser cannot read GitHub's `Date` header (CORS); the phone
  // learns GitHub's time only from the core reset. What the new phone's `fetch` gives the app is counted here.
  const heard = { date: 0, core: 0 }
  const orig = (m as any).fetchFor.bind(m)
  ;(m as any).fetchFor = (d: any) => {
    const f = orig(d)
    return async (url: string, init: any) => {
      const res: Response = await f(url, init)
      if (res.headers.get('date') !== null) heard.date++
      if (res.headers.get('x-ratelimit-resource') === 'core' && res.headers.get('x-ratelimit-reset') !== null) heard.core++
      return res
    }
  }
  const fresh = (await (m as any).device('A', 1)) as any
  m.devs.A.push(fresh)
  const rows = await fresh.list.rows()
  const out = rows.kind === 'home-gone' ? await fresh.list.restart('ali/vault') : { kind: 'not offered' }
  fileBack(m, old) // the replica catches up
  console.log('R7-2', JSON.stringify({ rows: rows.kind, restart: out.kind, bPointerAlive: m.gist(mine) !== undefined, heard }))
  expect(heard.date).toBe(0)
  expect(heard.core).toBeGreaterThan(0)
  expect(rows.kind).not.toBe('home-gone')
  expect(m.gist(mine)).toBeDefined()
})

it('R7-3: TWO phones of A run the way out in the home vault at the same moment: one list, its numbers gist exists, B is cut off', async () => {
  const m = await world(2)
  const [a0, a1] = m.devs.A as any[]
  const mine = bMine(m)
  const numbers = stats(m)
  del(m)
  m.clock.advance(11 * 60_000)
  expect((await a0.list.rows()).kind).toBe('home-gone')
  expect((await a1.list.rows()).kind).toBe('home-gone')
  const [r0, r1] = await Promise.all([a0.list.restart('ali/vault'), a1.list.restart('ali/vault')])
  const now = listAt(m)
  console.log('R7-3', JSON.stringify({ r0: r0.kind, r1: r1.kind, home: now.home, statsExists: m.gist(now.index.stats!) !== undefined, notes: notes(m).length, bPointerAlive: m.gist(mine) !== undefined, oldNumbersAlive: m.gist(numbers) !== undefined }))
  expect(m.gist(mine)).toBeUndefined()
  expect(m.gist(now.index.stats!)).toBeDefined()
  expect(notes(m)).toHaveLength(1)
  expect((await a0.list.rows()).kind).toBe('ok')
  expect((await a1.list.rows()).kind).toBe('ok')
})

it('R7-3b: two phones: one runs the way out in the HOME vault, the other in ANOTHER vault, at the same moment', async () => {
  const m = await world(2)
  const [a0, a1] = m.devs.A as any[]
  await addVault(a1, 'ali/notes')
  m.world.repos!.create('ali/notes', 'ali', { 'a.md': '# A page\n' })
  const mine = bMine(m)
  del(m)
  m.clock.advance(11 * 60_000)
  expect((await a0.list.rows()).kind).toBe('home-gone')
  expect((await a1.list.rows()).kind).toBe('home-gone')
  const [r0, r1] = await Promise.all([a0.list.restart('ali/vault'), a1.list.restart('ali/notes')])
  const now = listAt(m)
  console.log('R7-3b', JSON.stringify({ r0: r0.kind, r1: r1.kind, home: now.home, statsExists: m.gist(now.index.stats!) !== undefined, notes: notes(m), bPointerAlive: m.gist(mine) !== undefined }))
  expect(m.gist(mine)).toBeUndefined()
  expect(m.gist(now.index.stats!)).toBeDefined()
  expect(notes(m)).toHaveLength(1)
})

it('R7-4: after the way out, A adds C at once on phone 0 while phone 1 (same moment) still runs its own way out: C must stay', async () => {
  const m = await world(2)
  const [a0, a1] = m.devs.A as any[]
  del(m)
  m.clock.advance(11 * 60_000)
  expect((await a0.list.rows()).kind).toBe('home-gone')
  expect((await a1.list.rows()).kind).toBe('home-gone')
  // a1's way out starts first and stops for a while after its check (slow GitHub); meanwhile a0 runs its own, then shares a link.
  const r0 = await a0.list.restart('ali/vault')
  const s = await a0.list.share()
  const r1 = await a1.list.restart('ali/vault')
  const linkId = s.kind === 'ok' ? s.link.split('#')[1] : null
  console.log('R7-4', JSON.stringify({ r0: r0.kind, share: s.kind, r1: r1.kind, linkAlive: linkId !== null && m.gist(linkId) !== undefined, statsExists: m.gist(listAt(m).index.stats!) !== undefined }))
  expect(m.gist(listAt(m).index.stats!)).toBeDefined()
})

/**
 * R7-5 (YAZ-5464). The checker's version answered 409 for EVERY `git` and `contents` call of `ali/vault`, writes too, so
 * no way out could ever write a list there. GitHub's own answer for a repo with no commit (its docs; the builder could
 * not see one live, see the report) is 409 "Git Repository is empty." for the branch, the files and every git data
 * call, while the Contents API's `PUT` makes the first commit. The builder's version makes that repo with the strict
 * fake's new step (`createEmpty`), which answers so.
 */
it('R7-5: the home vault is made again EMPTY (no commit: GitHub answers 409 for its branch): is there a way out?', async () => {
  const m = await world(1)
  const mine = bMine(m)
  const numbers = stats(m)
  m.world.repos!.remove('ali/vault')
  m.world.repos!.createEmpty('ali/vault', 'ali')
  const a = m.devs.A[0] as any
  a.list = (m as any).newList(a)
  m.clock.advance(11 * 60_000)
  const rows = await a.list.rows().catch((e: any) => ({ kind: 'throw ' + e.message }))
  const out = await a.list.restart('ali/vault').catch((e: any) => ({ kind: 'throw ' + e.message }))
  console.log('R7-5', JSON.stringify({ rows: rows.kind, vaults: (rows as any).vaults, restart: out.kind, bPointerAlive: m.gist(mine) !== undefined }))
  expect(m.gist(mine)).toBeUndefined()
  expect(m.gist(numbers)).toBeUndefined()
  // The new list is the first commit of the empty vault, and its numbers gist is there.
  const now = listAt(m)
  expect(now.home).toBe('ali/vault')
  expect(m.gist(now.index.stats!)).toBeDefined()
  expect((await a.list.rows()).kind).toBe('ok')
})

it('R7-5b: an EMPTY vault that the Mac pushes again (no list file) while the way out runs: the way out still writes on top', async () => {
  const m = await world(1)
  const mine = bMine(m)
  m.world.repos!.remove('ali/vault')
  m.world.repos!.createEmpty('ali/vault', 'ali')
  const a = m.devs.A[0] as any
  m.clock.advance(11 * 60_000)
  expect((await a.list.rows()).kind).toBe('home-gone')
  const orig = (m as any).fetchFor.bind(m)
  let pushed = false
  ;(m as any).fetchFor = (d: any) => {
    const f = orig(d)
    return async (url: string, init: any) => {
      if (!pushed && (init?.method ?? 'GET').toUpperCase() === 'PUT') {
        pushed = true
        m.world.repos!.push('ali/vault', { 'a.md': '# A page\n' }, 'main', 'the Mac pushes the vault again')
      }
      return f(url, init)
    }
  }
  a.list = (m as any).newList(a)
  const out = await a.list.restart('ali/vault')
  console.log('R7-5b', JSON.stringify({ pushed, restart: out.kind, bPointerAlive: m.gist(mine) !== undefined }))
  expect(out.kind).toBe('done')
  expect(m.gist(mine)).toBeUndefined()
  expect(m.world.repos!.file('ali/vault', 'a.md')).not.toBeNull()
  expect(m.gist(listAt(m).index.stats!)).toBeDefined()
})

it('R7-5c: a 409 that is NOT "Git Repository is empty" stays an error (never "the file is gone")', async () => {
  const m = await world(1)
  const mine = bMine(m)
  const orig = (m as any).fetchFor.bind(m)
  ;(m as any).fetchFor = (d: any) => {
    const f = orig(d)
    return async (url: string, init: any) => {
      if (/\/repos\/ali\/vault\/(git|contents)/.test(String(url))) return new Response(JSON.stringify({ message: 'Repository rule violations found' }), { status: 409, headers: { 'content-type': 'application/json' } })
      return f(url, init)
    }
  }
  const a = m.devs.A[0] as any
  a.list = (m as any).newList(a)
  m.clock.advance(11 * 60_000)
  const rows = await a.list.rows().catch((e: any) => ({ kind: 'throw ' + e.message }))
  const out = await a.list.restart('ali/vault').catch((e: any) => ({ kind: 'throw ' + e.message }))
  console.log('R7-5c', JSON.stringify({ rows: rows.kind, restart: out.kind }))
  expect(rows.kind).not.toBe('home-gone')
  expect(out.kind).not.toBe('done')
  expect(m.gist(mine)).toBeDefined()
})

it('R7-6 (builder): the way out STOPS after its new list, before its deletes: the next open finishes them (the mark)', async () => {
  const m = await world(1)
  const a = m.devs.A[0] as any
  const mine = bMine(m)
  const numbers = stats(m)
  del(m)
  m.clock.advance(11 * 60_000)
  expect((await a.list.rows()).kind).toBe('home-gone')
  const orig = (m as any).fetchFor.bind(m)
  let cut = true
  ;(m as any).fetchFor = (d: any) => {
    const f = orig(d)
    return async (url: string, init: any) => {
      // No connection from the first gist DELETE on (the phone stops there).
      if (cut && (init?.method ?? 'GET').toUpperCase() === 'DELETE') throw new TypeError('Failed to fetch')
      return f(url, init)
    }
  }
  a.list = (m as any).newList(a)
  const out = await a.list.restart('ali/vault')
  const marked = /"wayOut"/.test(m.world.repos!.file('ali/vault', LIST_PATH) ?? '')
  console.log('R7-6 stopped', JSON.stringify({ restart: out.kind, marked, bPointerAlive: m.gist(mine) !== undefined }))
  expect(out.kind).not.toBe('done')
  expect(marked).toBe(true)
  cut = false
  a.list = (m as any).newList(a)
  const rows = await a.list.rows()
  console.log('R7-6 next open', JSON.stringify({ rows: rows.kind, marked: /"wayOut"/.test(m.world.repos!.file('ali/vault', LIST_PATH) ?? ''), bPointerAlive: m.gist(mine) !== undefined }))
  expect(rows.kind).toBe('ok')
  expect(m.gist(mine)).toBeUndefined()
  expect(m.gist(numbers)).toBeUndefined()
  expect(m.world.repos!.file('ali/vault', LIST_PATH)).not.toMatch(/"wayOut"/)
  expect(m.gist(listAt(m).index.stats!)).toBeDefined()
})
