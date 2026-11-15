/* eslint-disable @typescript-eslint/no-explicit-any */
// BUILDER (YAZ-5492), the nits of checker round 8 that the checker's own tests do not name. Made-up data, the strict fake.
import { expect, it } from 'vitest'
import { NUMBERS_FILE, readListFiles } from '@shared/friendGists'
import { LIST_PATH, parseListFile } from '@shared/friendListStore'
import { noRealWaits } from '../check4/run4.testing'
import { Model5 } from '../check5/model5.testing'

noRealWaits()
const K0 = { pStale: 0, p502: 0, pSecondary: 0, pContents404: 0 }

async function world() {
  const m = new Model5(4242, K0)
  m.hookRepos()
  await m.setup4(1, 1, 1, false, false, false)
  const a = m.devs.A[0] as any
  const b = m.devs.B[0] as any
  const s = await a.list.share()
  m.give('A', 'B', s.link.split('#')[1])
  const p = await b.list.paste(s.link)
  m.give('B', 'A', p.sendBack.split('#')[1])
  expect((await a.list.paste(p.sendBack)).kind).toBe('added')
  await a.list.rows()
  await b.list.rows()
  return m
}
const numbersGists = (m: Model5) => m.world.owned('ali').filter((g) => NUMBERS_FILE in g.files && Object.keys(g.files).length === 1 && /"v":1/.test(g.files[NUMBERS_FILE])).map((g) => g.id)
const listStats = (m: Model5) => {
  const t = m.world.repos!.file('ali/vault', LIST_PATH)
  const f = t === null ? null : parseListFile(t)
  const r = f === null || f.kind !== 'ok' ? null : readListFiles(f.files)
  return r === null || r.kind !== 'ok' ? null : r.value.stats
}
/** The list file is gone for good: the phone offers the way out in the home vault. */
async function gone(m: Model5) {
  const a = m.devs.A[0] as any
  m.world.repos!.push('ali/vault', { [LIST_PATH]: null }, 'main', 'deleted')
  m.clock.advance(11 * 60_000)
  expect((await a.list.rows()).kind).toBe('home-gone')
  return a
}
function onRefPatch(m: Model5, fn: (forward: () => Promise<Response>) => Promise<Response>) {
  const orig = (m as any).fetchFor.bind(m)
  ;(m as any).fetchFor = (d: any) => {
    const f = orig(d)
    return async (url: string, init: any) => ((init?.method ?? 'GET').toUpperCase() === 'PATCH' && /\/git\/refs\//.test(String(url)) ? fn(() => f(url, init)) : f(url, init))
  }
  for (const d of m.devs.A as any[]) d.list = (m as any).newList(d)
}

it('R8-N1: the way out\'s new list is NOT written (GitHub refuses the branch move): its new numbers gist goes at once (no stray gist)', async () => {
  const m = await world()
  const a = await gone(m)
  const before = numbersGists(m)
  onRefPatch(m, async () => new Response(JSON.stringify({ message: 'Server Error' }), { status: 500, headers: { 'content-type': 'application/json' } }))
  const out = await a.list.restart('ali/vault').catch((e: any) => ({ kind: 'throw ' + e.message }))
  const after = numbersGists(m)
  console.log('R8-N1', JSON.stringify({ restart: out.kind, before: before.length, after: after.length, list: listStats(m) }))
  expect(out.kind).not.toBe('done')
  expect(listStats(m)).toBeNull()
  expect(after.filter((id) => !before.includes(id))).toEqual([])
})

it('R8-N1b: the branch move LANDS but its answer is lost: the list names the new numbers gist, so it stays (read back first)', async () => {
  const m = await world()
  const a = await gone(m)
  onRefPatch(m, async (forward) => {
    await forward()
    throw new TypeError('Load failed')
  })
  const out = await a.list.restart('ali/vault').catch((e: any) => ({ kind: 'throw ' + e.message }))
  const stats = listStats(m)
  console.log('R8-N1b', JSON.stringify({ restart: out.kind, list: stats, exists: stats !== null && m.gist(stats) !== undefined }))
  expect(stats).not.toBeNull()
  expect(m.gist(stats!)).toBeDefined()
})
