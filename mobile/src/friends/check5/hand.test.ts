/* eslint-disable @typescript-eslint/no-explicit-any */
import { expect, it } from 'vitest'
import { INDEX_FILE, POINTER_FILE, readListFiles } from '@shared/friendGists'
import { LIST_PATH, parseListFile } from '@shared/friendListStore'
import { friendLink } from '@shared/friendsList'
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
const bMine = (m: Model5) => m.bEntries()[0].mine
const stats = (m: Model5) => listA(m).index.stats!

it('H1: the home vault repo is deleted on GitHub: what the phone says, and can it still stop sharing with B?', async () => {
  const m = await world(1)
  const a = m.devs.A[0] as any
  const mine = bMine(m)
  // The repo is gone: every call under /repos/ali/vault is 404 (GitHub's answer for a deleted repo).
  const real = a.list
  const f = m.fetchFor(a)
  const gone = async (url: string, init: any) => (new URL(url).pathname.startsWith('/repos/ali/vault') ? new Response(JSON.stringify({ message: 'Not Found' }), { status: 404, headers: { 'content-type': 'application/json' } }) : f(url, init))
  const { createFriendsList } = await import('../list')
  a.list = createFriendsList({ store: a.store, tokens: a.tokens, clock: m.clock, fetch: gone as any, sleep: async () => {} })
  void real
  const rows = await a.list.rows()
  const rem = await a.list.remove(mine)
  const share = await a.list.share()
  // Does B still read A's numbers through A's pointer?
  const p = m.gist(mine)?.files[POINTER_FILE]
  const named = p === undefined ? null : (JSON.parse(p) as { stats: string }).stats
  console.log('H1', JSON.stringify({ rows: rows.kind, remove: rem.kind, why: (rem as any).why, share: share.kind, bPointerAlive: p !== undefined, namesCurrent: named === stats(m) }))
  expect(rem.kind === 'done' || p === undefined).toBe(true)
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
