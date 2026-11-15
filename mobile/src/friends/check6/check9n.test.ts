/* eslint-disable @typescript-eslint/no-explicit-any */
// YAZ-5516 (N9-3): the two tests the round 9 checker suggested, each on ONE layer. Made-up data, the strict fake.
// R9-4: the heal reads the list AGAIN before it makes a generation (`healNumbers`, a stale copy after another device's
// remove). R9-5: the way out keeps the numbers gist of a MARKED list (`wayOutNumbers`), seen with no heal run after it.

import { expect, it } from 'vitest'
import { INDEX_FILE, NUMBERS_FILE, readListFiles } from '@shared/friendGists'
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
  await m.setup4(nA, 1, 1, false, false, false)
  const a = m.devs.A[0] as any
  const b = m.devs.B[0] as any
  const s = await a.list.share()
  m.give('A', 'B', s.link.split('#')[1])
  const p = await b.list.paste(s.link)
  m.give('B', 'A', p.sendBack.split('#')[1])
  const q = await a.list.paste(p.sendBack)
  expect(q.kind).toBe('added')
  for (const d of m.devs.A as any[]) await d.list.rows()
  await b.list.rows()
  return m
}
const numbersGists = (m: Model5) => m.world.owned('ali').filter((g) => NUMBERS_FILE in g.files).map((g) => g.id)
const listIn = (m: Model5, repo: string) => {
  const t = m.world.repos!.file(repo, LIST_PATH)
  if (t === null) return null
  const f = parseListFile(t)
  if (f.kind !== 'ok') return null
  const r = readListFiles(f.files)
  return r.kind !== 'ok' ? null : { stats: r.value.stats, marked: 'wayOut' in f.extra }
}
async function addVault(d: any, repo: string) {
  const v = { repo, branch: 'main', addedAt: Date.parse('2026-11-14T15:00:00Z') }
  const list = await loadVaultList(d.store)
  await saveVaultList(d.store, { vaults: [...list.vaults, v], open: list.open })
  await d.tokens.write(vaultId(v), `github_pat_11CHECK3_${'ali'.padEnd(70, '0')}`)
  await saveAccount(d.store, vaultId(v), { login: 'ali', name: 'ALI', avatarUrl: '', gists: 'yes', expiresAt: null, checkedAt: Date.parse('2026-11-14T15:00:00Z') })
}

it('R9-4 (heal reads again): phone 1 opens on a STALE copy of the list after phone 0 removed B; the copy names the numbers gist that the remove deleted: no second generation', async () => {
  const m = await world(2)
  const [a0, a1] = m.devs.A as any[]
  const before = listIn(m, 'ali/vault')!.stats!
  const oldHead = m.world.repos!.head('ali/vault')!
  const rem = await a0.list.remove(m.bEntries()[0].mine)
  expect(rem.kind).toBe('done')
  const after = listIn(m, 'ali/vault')!.stats!
  expect(after).not.toBe(before)
  expect(m.gist(before)).toBeUndefined()
  expect(numbersGists(m)).toEqual([after])
  // Phone 1 opens Friends again; a lagging replica gives its FIRST head read the head from before the remove (the
  // list names the numbers gist the remove deleted). Phone 1 saw that list last, so it is not older than its copy.
  let lagged = 0
  const orig = (m as any).fetchFor.bind(m)
  ;(m as any).fetchFor = (d: any) => {
    const f = orig(d)
    return async (url: string, init: any) => {
      if (d === a1 && lagged === 0 && (init?.method ?? 'GET').toUpperCase() === 'GET' && /\/repos\/ali\/vault\/git\/ref\/heads\/main/.test(String(url))) {
        lagged++
        return new Response(JSON.stringify({ ref: 'refs/heads/main', object: { sha: oldHead, type: 'commit' } }), { status: 200, headers: { 'content-type': 'application/json', etag: `W/"${oldHead.slice(0, 32)}"` } })
      }
      return f(url, init)
    }
  }
  a1.list = (m as any).newList(a1)
  const rows = await a1.list.rows()
  const row = { rows: rows.kind, lagged, list: listIn(m, 'ali/vault'), numbers: numbersGists(m).map((x) => x.slice(0, 6)) }
  console.log('R9-4', JSON.stringify(row))
  expect(lagged).toBe(1)
  // One generation: the remove's. The heal read the list again, saw the newer one, and made nothing.
  expect(numbersGists(m)).toEqual([after])
  expect(listIn(m, 'ali/vault')!.stats).toBe(after)
}, 120_000)

it('R9-5 (wayOutNumbers): phone 1 stops after its way out wrote its MARKED list in another vault; then phone 0 runs its way out: the marked list keeps its numbers gist (no heal ran)', async () => {
  const m = await world(2)
  const [a0, a1] = m.devs.A as any[]
  // Phone 0 has BOTH vaults (so it can see phone 1's marked list); phone 1 has its own only.
  await addVault(a0, 'ali/notes')
  await addVault(a0, 'ali/other')
  await addVault(a1, 'ali/other')
  m.world.repos!.create('ali/notes', 'ali', { 'a.md': '# A\n' })
  m.world.repos!.create('ali/other', 'ali', { 'b.md': '# B\n' })
  m.world.repos!.remove('ali/vault')
  m.clock.advance(11 * 60_000)
  for (const d of [a0, a1]) {
    d.list = (m as any).newList(d)
    expect((await d.list.rows()).kind).toBe('home-gone')
  }
  // Phone 1 loses its connection at its first gist DELETE: its new list (with the mark) is written, nothing deleted.
  const orig = (m as any).fetchFor.bind(m)
  let cut = true
  ;(m as any).fetchFor = (d: any) => {
    const f = orig(d)
    return async (url: string, init: any) => {
      if (cut && d === a1 && (init?.method ?? 'GET').toUpperCase() === 'DELETE') throw new TypeError('Failed to fetch')
      return f(url, init)
    }
  }
  for (const d of [a0, a1]) d.list = (m as any).newList(d)
  const r1 = await a1.list.restart('ali/other').catch((e: any) => ({ kind: 'throw ' + e.message }))
  const other = listIn(m, 'ali/other')
  expect(r1.kind).not.toBe('done')
  expect(other?.marked).toBe(true)
  const n1 = other!.stats!
  expect(m.gist(n1)).toBeDefined()
  // Phone 0's way out into its own vault: phone 1's numbers gist was there when it started (an "old" gist).
  const r0 = await a0.list.restart('ali/notes')
  const row = { r1: r1.kind, r0: r0.kind, n1: n1.slice(0, 6), n1There: m.gist(n1) !== undefined, lists: [listIn(m, 'ali/notes'), listIn(m, 'ali/other')], numbers: numbersGists(m).map((x) => x.slice(0, 6)), notes: m.world.owned('ali').filter((g) => INDEX_FILE in g.files).map((g) => g.files[INDEX_FILE]) }
  console.log('R9-5', JSON.stringify(row))
  cut = false
  expect(r0.kind).toBe('done')
  // The marked list's numbers gist is still there (no heal of phone 1's list has run).
  expect(m.gist(n1)).toBeDefined()
}, 120_000)
