/* eslint-disable @typescript-eslint/no-explicit-any */
import { expect, it } from 'vitest'
import { INDEX_FILE, NUMBERS_FILE, POINTER_FILE, readListFiles } from '@shared/friendGists'
import { LIST_PATH, parseListFile } from '@shared/friendListStore'
import { friendLink, homeGoneMessage } from '@shared/friendsList'
import { saveAccount } from '../../auth/account'
import { loadVaultList, saveVaultList, vaultId } from '../../store'
import { noRealWaits } from '../check4/run4.testing'
import { Model5 } from './model5.testing'

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
// `{"rows":"no-list-access","remove":"no-list-access","share":"no-list-access","bPointerAlive":true,"namesCurrent":true}`.
it('H1: the home vault repo is deleted on GitHub: what the phone says, and can it still stop sharing with B?', async () => {
  const m = await world(1)
  const a = m.devs.A[0] as any
  const mine = bMine(m)
  const oldStats = stats(m)
  await addVault(a, 'ali/notes')
  // The repo is gone: GitHub answers 404 for every call under /repos/ali/vault.
  m.world.repos!.remove('ali/vault')
  const rows = await a.list.rows()
  const rem = await a.list.remove(mine)
  const share = await a.list.share()
  console.log('H1', JSON.stringify({ rows, remove: rem.kind, share: share.kind, bPointerAlive: m.gist(mine) !== undefined }))
  // Plain words: what happened, and where the list can start again.
  expect(rows).toEqual({ kind: 'home-gone', home: 'ali/vault', vaults: ['ali/notes'] })
  expect(homeGoneMessage('ali/vault')).toMatch(/ali\/vault.*deleted, or your token lost access/)
  expect(rem.kind).toBe('home-gone')
  expect(share.kind).toBe('home-gone')
  // The way out never runs while the home answers, nor into the gone vault itself.
  expect((await a.list.restart('ali/vault')).kind).toBe('bad-target')
  const r = await a.list.restart('ali/notes')
  expect(r).toEqual({ kind: 'done', vault: 'ali/notes' })
  // B cannot reach A's numbers in any way: the pointer is gone, the old numbers gist is gone, the new one is unknown to B.
  expect(m.gist(mine)).toBeUndefined()
  expect(m.gist(oldStats)).toBeUndefined()
  const now = listAt(m)
  expect(m.bfs('B', now.index.stats).hit).toBe(false)
  // B still KNOWS the old numbers gist's ID (it read it before), but that gist is deleted (above): it reads nothing.
  // ONE note, naming the new vault; the list there is new and empty; no other pointer or numbers gist of A is left.
  expect(notes(m)).toEqual([{ v: 3, home: 'ali/notes', about: expect.any(String) } as never])
  expect(now.home).toBe('ali/notes')
  expect(now.index.friends).toEqual([])
  const left = m.world.owned('ali').filter((g) => POINTER_FILE in g.files || (NUMBERS_FILE in g.files && g.id !== now.index.stats))
  expect(left).toEqual([])
  // Friends work again: A shares, B pastes, and B reads A's NEW numbers.
  expect((await a.list.rows()).kind).toBe('ok')
  const s = await a.list.share()
  expect(s.kind).toBe('ok')
  const p = await (m.devs.B[0] as any).list.paste(s.link)
  expect(p.kind).toBe('added')
  expect(pointerStats(m, s.link.split('#')[1])).toBe(listAt(m).index.stats)
})

it('H1b (YAZ-5399): the home vault repo is RENAMED (or transferred) on GitHub: GitHub`s redirect is followed, the note names the new name, nothing stops', async () => {
  const m = await world(2)
  const [a0, a1] = m.devs.A as any[]
  const mine = bMine(m)
  m.world.repos!.rename('ali/vault', 'ali/vault-2024')
  // In the running session, the list's calls follow the redirect: nothing stops.
  expect((await a0.list.rows()).kind).toBe('ok')
  // The next open of the list (a new session) reads the repo's new name and writes it into the note.
  a0.list = m.newList(a0)
  expect((await a0.list.rows()).kind).toBe('ok')
  expect(notes(m)).toEqual([expect.objectContaining({ v: 3, home: 'ali/vault-2024' })])
  // The other phone (its vault still under the old name) follows the note and the redirect; a remove finishes.
  const r = await a1.list.remove(mine)
  expect(r.kind).toBe('done')
  expect(m.gist(mine)).toBeUndefined()
  expect(m.bfs('B', listAt(m).index.stats).hit).toBe(false)
})

it('H1c (YAZ-5399): the way out stops half way (after its deletes): the app offers it again, and the second run ends it', async () => {
  const m = await world(1)
  const a = m.devs.A[0] as any
  const mine = bMine(m)
  await addVault(a, 'ali/notes')
  m.world.repos!.remove('ali/vault')
  expect((await a.list.rows()).kind).toBe('home-gone')
  // The phone stops at its first list commit in the new vault (the new numbers gist is made, the note not yet).
  const repos = m.world.repos!
  const prev = repos.observe!
  let killed = false
  repos.observe = (mv) => {
    prev(mv)
    if (!killed && mv.repo === 'ali/notes' && repos.fileAt('ali/notes', mv.to, LIST_PATH) !== null) {
      killed = true
      a.dead = true
      a.fireCrash()
    }
  }
  expect(await Promise.race([a.list.restart('ali/notes'), a.crashed])).toBe('crash')
  repos.observe = prev
  // The stopped run's calls after the stop never answer (the app is closed); let it reach its next call first.
  for (let i = 0; i < 200; i++) await null
  expect(notes(m)).toEqual([expect.objectContaining({ home: 'ali/vault' })])
  expect(m.gist(mine)).toBeUndefined()
  a.dead = false
  a.lock = undefined
  m.arm(a)
  a.list = m.newList(a)
  expect((await a.list.rows()).kind).toBe('home-gone')
  expect((await a.list.restart('ali/notes')).kind).toBe('done')
  const now = listAt(m)
  expect(notes(m)).toEqual([expect.objectContaining({ home: 'ali/notes' })])
  expect(m.world.owned('ali').filter((g) => NUMBERS_FILE in g.files).map((g) => g.id)).toEqual([now.index.stats])
  expect((await a.list.rows()).kind).toBe('ok')
})

it('H2: the device that holds the intent is lost forever: another phone finishes the remove after the lease', async () => {
  const m = await world(2)
  const [a0, a1] = m.devs.A as any[]
  const mine = bMine(m)
  const old = stats(m)
  // A0 dies the moment its intent lands in the list.
  const repos = m.world.repos!
  const prev = repos.observe!
  let killed = false
  repos.observe = (mv) => {
    prev(mv)
    const t = repos.fileAt('ali/vault', mv.to, LIST_PATH)
    if (!killed && t !== null && /"i\.\d+"/.test(t)) {
      killed = true
      a0.dead = true
      a0.fireCrash()
    }
  }
  const r0 = await Promise.race([a0.list.remove(mine), a0.crashed])
  expect(killed).toBe(true)
  expect(r0).toBe('crash')
  const r1 = await a1.list.remove(mine).catch((e: Error) => e.message)
  const rows1 = await a1.list.rows()
  const busy = { r1: (r1 as any).kind ?? r1, why: (r1 as any).why, retryAt: (r1 as any).retryAt ? ((r1 as any).retryAt - m.clock.now()) / 1000 : null, rows: rows1.kind === 'ok' ? rows1.rows.map((x: any) => x.state).join(',') : rows1.kind }
  m.clock.advance(2 * 60_000 + 1000)
  const rows2 = await a1.list.rows()
  const l = listA(m)
  const st = readListFiles(m.repoFiles('ali', null)!)
  console.log('H2', JSON.stringify({ busy, after: rows2.kind === 'ok' ? rows2.rows.map((x: any) => `${x.name}:${x.state}`).join(',') : rows2.kind, newStats: l.index.stats !== old, pending: st.kind === 'ok' ? st.list.pending.length : -1, bPointer: m.gist(mine) !== undefined }))
  expect(m.gist(mine)).toBeUndefined()
  expect(l.index.stats).not.toBe(old)
  expect(st.kind === 'ok' && st.list.pending.length).toBe(0)
  expect(m.bfs('B', l.index.stats).hit).toBe(false)
})

it('H3: a remove of B starts (tombstone written), the app stops; B shares a new link and another A phone pastes it; then the remove runs', async () => {
  const m = await world(2)
  const [a0, a1] = m.devs.A as any[]
  const b = m.devs.B[0] as any
  const mine = bMine(m)
  const repos = m.world.repos!
  const prev = repos.observe!
  let killed = false
  repos.observe = (mv) => {
    prev(mv)
    const t = repos.fileAt('ali/vault', mv.to, LIST_PATH)
    if (!killed && t !== null && /"x\./.test(t)) {
      killed = true
      a0.dead = true
      a0.fireCrash()
    }
  }
  await Promise.race([a0.list.remove(mine), a0.crashed])
  expect(killed).toBe(true)
  // B shares a new link; A1 pastes it ("added"), and sends its own link back; B pastes it.
  const s = await b.list.share()
  const p = await a1.list.paste(s.link)
  let back: any = null
  if (p.kind === 'added' && p.sendBack !== null) back = await b.list.paste(p.sendBack)
  // A0 restarts and the remove finishes.
  a0.dead = false
  a0.lock = undefined
  m.arm(a0)
  a0.list = m.newList(a0)
  m.clock.advance(3 * 60_000)
  await a0.list.rows()
  await a1.list.rows()
  const rb = await b.list.rows()
  const l = listA(m)
  const bNow = m.bEntries()
  console.log('H3', JSON.stringify({ paste: p.kind, back: back?.kind, bEntries: bNow.length, bRows: rb.kind === 'ok' ? rb.rows.map((x: any) => `${x.name}:${x.state}`).join(',') : rb.kind, oldPointerGone: m.gist(mine) === undefined }))
  // Honest end: either B is a friend again whose pointer names the CURRENT numbers, or B is not in the list.
  for (const e of bNow) {
    const ptr = m.gist(e.mine)?.files[POINTER_FILE]
    expect(ptr === undefined ? null : (JSON.parse(ptr) as { stats: string }).stats).toBe(l.index.stats)
  }
  expect(m.gist(mine)).toBeUndefined()
})

it('H4: the note in the gist holds only the repo name; the repo file holds the names; privacy facts', async () => {
  const m = await world(1)
  const note = m.world.owned('ali').find((g) => INDEX_FILE in g.files)!
  const o = JSON.parse(note.files[INDEX_FILE]) as Record<string, unknown>
  expect(Object.keys(o).sort()).toEqual(['about', 'home', 'v'])
  expect(Object.keys(note.files)).toEqual([INDEX_FILE])
  const text = m.world.repos!.file('ali/vault', LIST_PATH)!
  expect(parseListFile(text).kind).toBe('ok')
  // No gist of anyone except A's note names the repo, the list path or the note's ID.
  for (const who of ['ali', 'bea', 'cem'])
    for (const g of m.world.owned(who)) {
      if (/"v":3/.test(g.files[INDEX_FILE] ?? '')) continue
      const all = [...Object.values(g.files), ...(m.revisions.get(g.id) ?? [])].join('\n')
      expect(all).not.toMatch(/ali\/vault|yaseendocs|friends\.json/i)
      expect(all).not.toContain(note.id)
    }
})

it('H5: stale read right after a write: the paste of a second device sees no list (stale head before the list existed)', async () => {
  const m = new Model5(777, { pStale: 1, p502: 0, pSecondary: 0, pContents404: 0 })
  m.hookRepos()
  for (let i = 0; i < 2; i++) m.devs.A.push(await m.device('A', i))
  m.devs.C.push(await m.device('C', 0))
  const a0 = m.devs.A[0] as any
  const a1 = m.devs.A[1] as any
  const s = await a0.list.share()
  expect(s.kind).toBe('ok')
  m.armed = true
  const c = m.devs.C[0] as any
  const t = async (f: () => Promise<any>) => { try { const x = await f(); return x.kind } catch (e) { return 'THREW ' + (e as Error).message } }
  const p = await c.list.paste(s.link).catch((e: Error) => ({ kind: 'THREW ' + e.message, sendBack: null }))
  m.armed = false
  const pb = await c.list.paste(s.link)
  m.armed = true
  const q = await t(() => a1.list.paste(pb.sendBack ?? friendLink('0'.repeat(32))))
  const r = await t(() => a1.list.rows())
  m.armed = false
  const r2 = await a1.list.rows()
  console.log('H5', JSON.stringify({ c: p.kind, cAgain: pb.kind, a1paste: q, a1rowsStale: r, a1rowsFresh: r2.kind, stale: m.world.repos!.staleGiven }))
})

it('H6 (shrunk): A removes B; ONE stale branch read right after the tombstone commit: the remove answers done, and B still reads A`s current numbers', async () => {
  const m = await world(1)
  const a = m.devs.A[0] as any
  const mine = bMine(m)
  const repos = m.world.repos!
  const prev = repos.observe!
  let armed = true
  repos.observe = (mv) => {
    prev(mv)
    const t = repos.fileAt('ali/vault', mv.to, LIST_PATH)
    if (armed && t !== null && /"x\./.test(t)) {
      armed = false
      m.staleOnce = true
    }
  }
  const r = await a.list.remove(mine)
  const st = readListFiles(m.repoFiles('ali', null)!)
  const waits = st.kind === 'ok' ? st.list.pending.length : -1
  const reach = m.bfs('B', listA(m).index.stats)
  console.log('H6', JSON.stringify({ remove: r.kind, removesWaitingInList: waits, bPointerStillThere: m.gist(mine) !== undefined, bReachesCurrentNumbers: reach.hit }))
  // Expected: `done` only when nothing waits and B cannot reach the current numbers.
  expect(r.kind === 'done' ? waits === 0 && !reach.hit : true).toBe(true)
})
