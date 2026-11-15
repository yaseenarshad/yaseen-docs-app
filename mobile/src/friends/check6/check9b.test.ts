/* eslint-disable @typescript-eslint/no-explicit-any */
// CHECKER round 9: attacks on the round 8 design (only MARKED lists protect older gists). Made-up data, the strict fake.

import { expect, it } from 'vitest'
import { INDEX_FILE, NUMBERS_FILE, POINTER_FILE, readListFiles } from '@shared/friendGists'
import { LIST_PATH, parseListFile } from '@shared/friendListStore'
import { saveAccount } from '../../auth/account'
import { loadVaultList, saveVaultList, vaultId } from '../../store'
import { noRealWaits } from '../check4/run4.testing'
import { Model5 } from '../check5/model5.testing'

noRealWaits()
const K0 = { pStale: 0, p502: 0, pSecondary: 0, pContents404: 0 }

async function world(nA = 2, seed = 4242) {
  const m = new Model5(seed, K0)
  m.hookRepos()
  await m.setup4(nA, 1, 1, false, false)
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
const del = (m: Model5) => m.world.repos!.push('ali/vault', { [LIST_PATH]: null }, 'main', 'deleted')
const fileBack = (m: Model5, text: string) => m.world.repos!.push('ali/vault', { [LIST_PATH]: text }, 'main', 'the list file is back')
const notes = (m: Model5) => m.world.owned('ali').filter((g) => INDEX_FILE in g.files).map((g) => JSON.parse(g.files[INDEX_FILE]) as { v: number; home?: string })
const listIn = (m: Model5, repo: string) => {
  const t = m.world.repos!.file(repo, LIST_PATH)
  if (t === null) return null
  const f = parseListFile(t)
  if (f.kind !== 'ok') return null
  const r = readListFiles(f.files)
  return r.kind !== 'ok' ? null : { stats: r.value.stats, friends: r.value.friends.length, marked: 'wayOut' in f.extra, mark: f.extra.wayOut as string | undefined }
}
/** B reaches a numbers gist of A that EXISTS now (a leak after A ended all sharing). */
const bReachesAny = (m: Model5) => m.world.owned('ali').filter((g) => NUMBERS_FILE in g.files).some((g) => m.bfs('B', g.id).hit)
const pointersOf = (m: Model5) => m.world.owned('ali').filter((g) => POINTER_FILE in g.files).map((g) => ({ id: g.id, stats: (JSON.parse(g.files[POINTER_FILE]) as { stats: string }).stats }))
async function addVault(d: any, repo: string) {
  const v = { repo, branch: 'main', addedAt: Date.parse('2026-11-14T15:00:00Z') }
  const list = await loadVaultList(d.store)
  await saveVaultList(d.store, { vaults: [...list.vaults, v], open: list.open })
  await d.tokens.write(vaultId(v), `github_pat_11CHECK3_${'ali'.padEnd(70, '0')}`)
  await saveAccount(d.store, vaultId(v), { login: 'ali', name: 'ALI', avatarUrl: '', gists: 'yes', expiresAt: null, checkedAt: Date.parse('2026-11-14T15:00:00Z') })
}
function hook(m: Model5, fn: (d: any, url: string, method: string, init: any) => Promise<Response | undefined> | Response | undefined) {
  const orig = (m as any).fetchFor.bind(m)
  ;(m as any).fetchFor = (d: any) => {
    const f = orig(d)
    return async (url: string, init: any) => {
      const r = await fn(d, String(url), (init?.method ?? 'GET').toUpperCase(), init)
      return r ?? f(url, init)
    }
  }
  for (const d of [...m.devs.A, ...m.devs.B] as any[]) d.list = (m as any).newList(d)
}


const cReaches = (m: Model5) => { const home = notes(m)[0]?.home; const l = home ? listIn(m, home) : null; return l?.stats ? m.bfs('C', l.stats).hit && m.gist(l.stats) !== undefined : false }
async function addC(m: Model5, a: any) {
  const c = m.devs.C[0] as any
  const s = await a.list.share()
  m.give('A', 'C', s.link.split('#')[1])
  const p = await c.list.paste(s.link)
  m.give('C', 'A', p.sendBack.split('#')[1])
  const q = await a.list.paste(p.sendBack)
  return { share: s.kind, paste: q.kind }
}

it('R9-2 (I1): the way out in the HOME vault ENDS; then the Mac pushes the OLD list back over the new one; A opens and sends for 3 hours: B may reach no numbers gist that exists', async () => {
  const m = await world(1)
  const a = m.devs.A[0] as any
  const old = m.world.repos!.file('ali/vault', LIST_PATH)!
  const oldStats = { before: listIn(m, "ali/vault"), numbers: m.world.owned("ali").filter((g) => NUMBERS_FILE in g.files).map((g) => g.id.slice(0, 6)) }
  del(m)
  m.clock.advance(11 * 60_000)
  expect((await a.list.rows()).kind).toBe('home-gone')
  const r = await a.list.restart('ali/vault')
  expect(r.kind).toBe('done')
  const afterWayOut = { list: listIn(m, "ali/vault"), numbers: m.world.owned("ali").filter((g) => NUMBERS_FILE in g.files).map((g) => g.id.slice(0, 6)) }
  fileBack(m, old)
  const afterBack = listIn(m, "ali/vault")
  const out: any[] = []
  for (let i = 0; i < 3; i++) {
    m.clock.advance(61 * 60_000)
    a.list = (m as any).newList(a)
    const rows = await a.list.rows().catch((e: any) => ({ kind: 'throw ' + e.message }))
    const snd = { kind: await (m as any).send(a).catch((e: any) => "throw " + e.message) }
    out.push({ rows: rows.kind === 'ok' ? rows.rows.map((x: any) => x.state) : rows.kind, send: snd?.kind, list: listIn(m, "ali/vault"), statsExists: m.gist(listIn(m, "ali/vault")!.stats!) !== undefined, numbers: m.world.owned('ali').filter((g) => NUMBERS_FILE in g.files).length, bReachesAny: bReachesAny(m) })
  }
  console.log("R9-2", JSON.stringify({ oldStats, afterWayOut, afterBack, numbersEnd: m.world.owned("ali").filter((g) => NUMBERS_FILE in g.files).map((g) => g.id.slice(0, 6)) }), JSON.stringify(out))
  for (const o of out) expect(o.bReachesAny).toBe(false)
}, 120_000)

it('R9-3 (legit friend): phone 1 starts its way out into ANOTHER vault right after phone 0 wrote its new list; phone 0 ENDS (mark gone) and adds C; then phone 1 runs on: does C read A\'s numbers (at once, and after one more open and send)?', async () => {
  const m = await world(2)
  const [a0, a1] = m.devs.A as any[]
  await addVault(a0, 'ali/notes')
  await addVault(a1, 'ali/other')
  m.world.repos!.create('ali/notes', 'ali', { 'a.md': '# A\n' })
  m.world.repos!.create('ali/other', 'ali', { 'b.md': '# B\n' })
  a0.list = (m as any).newList(a0)
  a1.list = (m as any).newList(a1)
  m.world.repos!.remove('ali/vault')
  m.clock.advance(11 * 60_000)
  expect((await a0.list.rows()).kind).toBe('home-gone')
  expect((await a1.list.rows()).kind).toBe('home-gone')
  let release!: () => void
  const gate = new Promise<void>((r) => (release = r))
  let r1: Promise<any> | null = null
  let held = false
  hook(m, async (d, url, method) => {
    // Phone 0's list write in ali/notes landed: phone 1 starts its way out (it lists the gists now: phone 0's numbers gist is "before").
    if (d === a0 && method === 'PATCH' && /\/repos\/ali\/notes\/git\/refs\//.test(url) && r1 === null) {
      queueMicrotask(() => { r1 = a1.list.restart('ali/other').catch((e: any) => ({ kind: 'throw ' + e.message })) })
      return undefined
    }
    // Phone 1's first gist POST (its numbers gist, after its list of gists) waits until phone 0 ended and added C.
    if (d === a1 && method === 'POST' && /\/gists$/.test(url) && !held) { held = true; await gate }
    return undefined
  })
  const [b0, b1] = m.devs.A as any[]
  void b1
  const r0 = await b0.list.restart('ali/notes').catch((e: any) => ({ kind: 'throw ' + e.message }))
  for (let i = 0; i < 50 && !held; i++) await new Promise((r) => setTimeout(r, 1))
  const marks0 = listIn(m, 'ali/notes')
  const c = await addC(m, b0)
  const cBefore = cReaches(m)
  release()
  const out1 = await (r1 ?? Promise.resolve({ kind: 'never started' }))
  const row: any = { r0: r0.kind, r1: out1.kind, held, notesList0: marks0, c, cBefore, notes: notes(m).map((x) => x.home), cAfterRace: cReaches(m), lists: [listIn(m, 'ali/notes'), listIn(m, 'ali/other')] }
  m.clock.advance(61 * 60_000)
  for (const d of m.devs.A as any[]) d.list = (m as any).newList(d)
  row.rows0 = (await b0.list.rows().catch((e: any) => ({ kind: 'throw ' + e.message }))).kind
  const snd = { kind: await (m as any).send(b0).catch((e: any) => "throw " + e.message) }
  row.send = snd?.kind
  row.cAfterOpen = cReaches(m)
  row.listsAfter = [listIn(m, 'ali/notes'), listIn(m, 'ali/other')]
  console.log('R9-3', JSON.stringify(row))
  expect(row.held).toBe(true)
  expect(row.notes).toHaveLength(1)
  expect(row.cAfterOpen).toBe(true)
  expect(row.listsAfter.map((l: any) => l?.marked ?? false)).not.toContain(true)
}, 120_000)
