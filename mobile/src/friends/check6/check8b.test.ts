/* eslint-disable @typescript-eslint/no-explicit-any */
// CHECKER round 8 (YAZ-5462 YAZ-5463 YAZ-5464): attacks on the way out after the fixes. Made-up data, the strict fake.
// Copied from the checker's folder (YAZ-5492). Builder's additions are marked BUILDER.
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
  await m.setup4(nA, 1, 1, false, false, false)
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


it('R8-5b: after the two-vault race, A adds C and sends: does C ever read A\'s numbers (does the list heal)?', async () => {
  const m = await world(2, 4242)
  const [a0, a1] = m.devs.A as any[]
  await addVault(a0, 'ali/notes')
  await addVault(a1, 'ali/other')
  m.world.repos!.create('ali/notes', 'ali', { 'a.md': '# A\n' })
  m.world.repos!.create('ali/other', 'ali', { 'b.md': '# B\n' })
  a0.list = (m as any).newList(a0)
  a1.list = (m as any).newList(a1)
  m.world.repos!.remove('ali/vault')
  m.clock.advance(11 * 60_000)
  await a0.list.rows(); await a1.list.rows()
  await Promise.all([a0.list.restart('ali/notes'), a1.list.restart('ali/other')])
  const home = notes(m)[0].home!
  const winner = home === 'ali/notes' ? a0 : a1
  const loser = winner === a0 ? a1 : a0
  const c = m.devs.C[0] as any
  const s = await loser.list.share()
  m.give('A', 'C', s.link.split('#')[1])
  const p = await c.list.paste(s.link)
  m.give('C', 'A', p.sendBack.split('#')[1])
  const q = await loser.list.paste(p.sendBack)
  const out: any[] = []
  for (let i = 0; i < 4; i++) {
    m.clock.advance(61 * 60_000)
    const snd = await winner.list.send?.().catch((e: any) => 'throw ' + e.message)
    const snd2 = await loser.list.send?.().catch((e: any) => 'throw ' + e.message)
    const l = listIn(m, notes(m)[0].home!)
    const cRows = await c.list.rows()
    out.push({ send: typeof snd === 'string' ? snd : snd?.kind, send2: typeof snd2 === 'string' ? snd2 : snd2?.kind, home: notes(m)[0].home, listNumbersExist: l?.stats ? m.gist(l.stats) !== undefined : null, cReaches: l?.stats ? m.bfs('C', l.stats).hit && m.gist(l.stats) !== undefined : null, cRow: JSON.stringify(cRows.rows?.map((r: any) => r.state) ?? cRows.kind) })
  }
  console.log('R8-5b', JSON.stringify({ home, share: s.kind, paste: q.kind }), JSON.stringify(out))
  expect(out.at(-1).cReaches).toBe(true)
}, 120_000)

it('R8-1b: why the original R7-1 timing answers "offline"', async () => {
  const m = await world(1)
  const a = m.devs.A[0] as any
  const old = m.world.repos!.file('ali/vault', LIST_PATH)!
  del(m)
  m.clock.advance(11 * 60_000)
  await a.list.rows()
  let back = false
  const calls: string[] = []
  hook(m, (_d, url, method) => {
    calls.push(method + ' ' + new URL(url).pathname)
    if (!back && method === 'DELETE') { back = true; fileBack(m, old) }
    return undefined
  })
  const out = await a.list.restart('ali/vault')
  console.log('R8-1b', out.kind, JSON.stringify(out), '\n' + calls.slice(-25).join('\n'))
})
