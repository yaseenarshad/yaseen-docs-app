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

it('R8-1: the ORIGINAL R7-1 timing (the file comes back at the way out\'s first gist DELETE, now AFTER its new list): no access may be kept or gained', async () => {
  const m = await world(1)
  const a = m.devs.A[0] as any
  const mine = bMine(m)
  const numbers = stats(m)
  const old = m.world.repos!.file('ali/vault', LIST_PATH)!
  del(m)
  m.clock.advance(11 * 60_000)
  expect((await a.list.rows()).kind).toBe('home-gone')
  let back = false
  hook(m, (_d, _u, method) => {
    if (!back && method === 'DELETE') {
      back = true
      fileBack(m, old)
    }
    return undefined
  })
  const out = await a.list.restart('ali/vault')
  const now = listIn(m, 'ali/vault')
  console.log('R8-1', JSON.stringify({ back, restart: out.kind, listIsOld: m.world.repos!.file('ali/vault', LIST_PATH) === old, bPointerAlive: m.gist(mine) !== undefined, oldNumbersAlive: m.gist(numbers) !== undefined, listNumbersExist: now?.stats ? m.gist(now.stats) !== undefined : null, notes: notes(m).length, bReachesAny: bReachesAny(m) }))
  const later: unknown[] = []
  for (let i = 0; i < 3; i++) {
    m.clock.advance(61 * 60_000)
    const r = await a.list.rows()
    const snd = await a.list.send?.().catch((e: any) => 'throw ' + e.message)
    const l = listIn(m, 'ali/vault')
    later.push({ rows: r.kind === 'ok' ? r.rows?.map((x: any) => x.state) : r.kind, send: typeof snd === 'string' ? snd : snd?.kind, listNumbersExist: l?.stats ? m.gist(l.stats) !== undefined : null, bReachesAny: bReachesAny(m) })
  }
  console.log('R8-1 later', JSON.stringify(later))
  // Removing access is allowed here (the way out had written its new list); keeping or gaining it is not.
  expect(m.gist(mine)).toBeUndefined()
  expect(bReachesAny(m)).toBe(false)
})

it('R8-2: the ORIGINAL R7-5 (409 "Git Repository is empty" for EVERY git and contents call, the PUT too): nothing half-done', async () => {
  const m = await world(1)
  const a = m.devs.A[0] as any
  const mine = bMine(m)
  const numbers = stats(m)
  hook(m, (_d, url) => (/\/repos\/ali\/vault\/(git|contents)/.test(url) ? new Response(JSON.stringify({ message: 'Git Repository is empty.' }), { status: 409, headers: { 'content-type': 'application/json' } }) : undefined))
  m.clock.advance(11 * 60_000)
  const rows = await a.list.rows().catch((e: any) => ({ kind: 'throw ' + e.message }))
  const before = m.world.owned('ali').length
  const out = await a.list.restart('ali/vault').catch((e: any) => ({ kind: 'throw ' + e.message }))
  console.log('R8-2', JSON.stringify({ rows: rows.kind, restart: out.kind, bPointerAlive: m.gist(mine) !== undefined, numbersAlive: m.gist(numbers) !== undefined, gistsBefore: before, gistsAfter: m.world.owned('ali').length, notes: notes(m).length }))
  // Either the way out ran in full, or it changed nothing (no stray numbers gist, the note and B's pointer as they were).
  if (out.kind !== 'done') {
    expect(m.gist(mine)).toBeDefined()
    expect(m.gist(numbers)).toBeDefined()
    expect(m.world.owned('ali').length).toBe(before)
  }
})

it('R8-3: way out into ANOTHER vault; the home file comes back right after the new list there: the recheck refuses, nothing deleted', async () => {
  const m = await world(1)
  const a = m.devs.A[0] as any
  await addVault(a, 'ali/notes')
  m.world.repos!.create('ali/notes', 'ali', { 'a.md': '# A page\n' })
  const mine = bMine(m)
  const numbers = stats(m)
  const old = m.world.repos!.file('ali/vault', LIST_PATH)!
  del(m)
  m.clock.advance(11 * 60_000)
  a.list = (m as any).newList(a)
  expect((await a.list.rows()).kind).toBe('home-gone')
  let wrote = false
  let back = false
  hook(m, (_d, url, method) => {
    if (method === 'PATCH' && /\/repos\/ali\/notes\/git\/refs\//.test(url)) wrote = true
    else if (wrote && !back && /\/repos\/ali\/vault\//.test(url)) {
      back = true
      fileBack(m, old)
    }
    return undefined
  })
  const out = await a.list.restart('ali/notes')
  const n = listIn(m, 'ali/notes')
  console.log('R8-3', JSON.stringify({ back, restart: out.kind, bPointerAlive: m.gist(mine) !== undefined, numbersAlive: m.gist(numbers) !== undefined, notesList: n, notesListNumbersExist: n?.stats ? m.gist(n.stats) !== undefined : null, notes: notes(m) }))
  expect(back).toBe(true)
  expect(out.kind).toBe('home-is-there')
  expect(m.gist(mine)).toBeDefined()
  expect(m.gist(numbers)).toBeDefined()
  expect(n?.marked ?? false).toBe(false)
  expect((await a.list.rows()).kind).toBe('ok')
})

/** A crash of the way out at its call `k` (the app is closed there; GitHub took the call or not, at random), then the person goes on. */
async function crashAt(k: number, target: 'ali/vault' | 'ali/notes', seed: number) {
  const m = await world(1, seed)
  const a = m.devs.A[0] as any
  if (target === 'ali/notes') {
    await addVault(a, 'ali/notes')
    m.world.repos!.create('ali/notes', 'ali', { 'a.md': '# A page\n' })
    a.list = (m as any).newList(a)
  }
  const mine = bMine(m)
  const numbers = stats(m)
  del(m)
  m.clock.advance(11 * 60_000)
  expect((await a.list.rows()).kind).toBe('home-gone')
  a.calls = 0
  a.crashAt = k
  const first: any = await m.act(a, 'restart', (x: any) => x.restart(target))
  const steps: string[] = [first === 'crash' ? 'crash' : first.kind]
  // The person opens Friends again (later), and runs the way out again when it is offered.
  let rows: any = null
  for (let t = 0; t < 4; t++) {
    m.clock.advance(11 * 60_000)
    rows = await m.act(a, 'rows', (x: any) => x.rows())
    if (rows === 'crash') { steps.push('crash'); continue }
    steps.push(rows.kind)
    if (rows.kind === 'home-gone') { const rr: any = await m.act(a, 'restart', (x: any) => x.restart(target)); steps.push(rr === 'crash' ? 'crash' : rr.kind) }
    else if (rows.kind === 'ok') break
  }
  const vaultList = listIn(m, 'ali/vault')
  const notesList = listIn(m, 'ali/notes')
  const ns = notes(m)
  const home = ns.length === 1 ? ns[0].home! : null
  const l = home === null ? null : listIn(m, home)
  const r = {
    k,
    target,
    steps: steps.join(' > '),
    bPointerAlive: m.gist(mine) !== undefined,
    oldNumbersAlive: m.gist(numbers) !== undefined,
    notes: ns.map((x) => x.home),
    marked: l?.marked ?? null,
    listNumbersExist: l?.stats ? m.gist(l.stats) !== undefined : null,
    strayNumbers: m.world.owned('ali').filter((g) => NUMBERS_FILE in g.files && g.id !== l?.stats).length,
    strayPointers: pointersOf(m).length,
    vaultMarked: vaultList?.marked ?? null,
    notesMarked: notesList?.marked ?? null,
    bReachesAny: bReachesAny(m),
    calls: a.calls,
  }
  return r
}

for (const target of ['ali/vault', 'ali/notes'] as const)
  it(`R8-4 ${target}: a crash at EACH call of the way out, then the person opens Friends again: B ends cut off, one list, one note, no mark left`, async () => {
    const bad: string[] = []
    const rows: unknown[] = []
    for (let k = Number(process.env.K0 ?? 1); k <= Number(process.env.K1 ?? 45); k++)
      for (const seed of [4242, 77, 913]) {
        const r: any = await Promise.race([crashAt(k, target, seed), new Promise((ok) => setTimeout(() => ok({ k, target, steps: 'HANG', notes: [] }), 15_000))])
        rows.push(r)
        if (r.steps === 'HANG') { bad.push(`k=${k} seed=${seed}: HANG`); continue }
        const why = [
          r.bPointerAlive && 'B pointer alive',
          r.oldNumbersAlive && 'old numbers alive',
          r.bReachesAny && 'B reaches A numbers',
          r.notes.length !== 1 && `notes ${JSON.stringify(r.notes)}`,
          r.marked && 'mark left',
          r.listNumbersExist === false && 'list names a gone numbers gist',
          !/ok$/.test(r.steps) && `ends ${r.steps}`,
        ].filter(Boolean)
        if (why.length > 0) bad.push(`k=${k} seed=${seed}: ${why.join(', ')} | ${JSON.stringify(r)}`)
      }
    console.log(`R8-4 ${target}`, bad.length, 'bad of', rows.length, '\n' + bad.slice(0, 12).join('\n'))
    expect(bad).toEqual([])
  }, 600_000)

it('R8-5 (builder\'s open issue): two phones run the way out at the same moment in DIFFERENT vaults (neither the home)', async () => {
  const out: any[] = []
  for (const seed of [4242, 1, 2, 3, 5, 8, 13, 21, 34, 55, 89, 144]) {
    const m = await world(2, seed)
    const [a0, a1] = m.devs.A as any[]
    await addVault(a0, 'ali/notes')
    await addVault(a1, 'ali/other')
    m.world.repos!.create('ali/notes', 'ali', { 'a.md': '# A\n' })
    m.world.repos!.create('ali/other', 'ali', { 'b.md': '# B\n' })
    a0.list = (m as any).newList(a0)
    a1.list = (m as any).newList(a1)
    const mine = bMine(m)
    m.world.repos!.remove('ali/vault')
    m.clock.advance(11 * 60_000)
    expect((await a0.list.rows()).kind).toBe('home-gone')
    expect((await a1.list.rows()).kind).toBe('home-gone')
    const [r0, r1] = await Promise.all([a0.list.restart('ali/notes').catch((e: any) => ({ kind: 'throw ' + e.message })), a1.list.restart('ali/other').catch((e: any) => ({ kind: 'throw ' + e.message }))])
    const ns = notes(m)
    const named = ns.length === 1 ? listIn(m, ns[0].home!) : null
    const row: any = { seed, r0: r0.kind, r1: r1.kind, notes: ns.map((x) => x.home), bPointerAlive: m.gist(mine) !== undefined, bReachesAny: bReachesAny(m), namedListNumbersExist: named?.stats ? m.gist(named.stats) !== undefined : null, numbersGists: m.world.owned('ali').filter((g) => NUMBERS_FILE in g.files).length }
    // Later: both phones open Friends, A adds C on phone 0; does C reach A's numbers?
    m.clock.advance(61 * 60_000)
    row.rows0 = (await a0.list.rows().catch((e: any) => ({ kind: 'throw ' + e.message }))).kind
    row.rows1 = (await a1.list.rows().catch((e: any) => ({ kind: 'throw ' + e.message }))).kind
    const ns2 = notes(m)
    const named2 = ns2.length === 1 ? listIn(m, ns2[0].home!) : null
    row.after = { notes: ns2.map((x) => x.home), listNumbersExist: named2?.stats ? m.gist(named2.stats) !== undefined : null, marks: [listIn(m, 'ali/notes')?.marked, listIn(m, 'ali/other')?.marked] }
    out.push(row)
  }
  for (const r of out) console.log('R8-5', JSON.stringify(r))
  // Never a leak: B (removed by the way out) reaches nothing.
  for (const r of out) {
    expect(r.bPointerAlive).toBe(false)
    expect(r.bReachesAny).toBe(false)
  }
  // BUILDER (YAZ-5492): and the list heals: one note, the list it names has its numbers gist, and no mark is left.
  for (const r of out) {
    expect(r.notes).toHaveLength(1)
    expect(r.namedListNumbersExist).toBe(true)
    expect(r.after.listNumbersExist).toBe(true)
    expect(r.after.marks).not.toContain(true)
  }
}, 300_000)

it('R8-6: a STALE read of the marked list on a new phone, after the way out ended and A removed a friend (a new numbers generation): nothing of the new generation may be deleted', async () => {
  const m = await world(1)
  const a = m.devs.A[0] as any
  del(m)
  m.clock.advance(11 * 60_000)
  expect((await a.list.rows()).kind).toBe('home-gone')
  let markedHead: string | null = null
  m.world.repos!.observe = ((prev) => (mv: any) => {
    prev?.(mv)
    if (mv.repo === 'ali/vault' && /"wayOut"/.test(m.world.repos!.fileAt('ali/vault', mv.to, LIST_PATH) ?? '')) markedHead = mv.to
  })(m.world.repos!.observe)
  expect((await a.list.restart('ali/vault')).kind).toBe('done')
  expect(markedHead).not.toBeNull()
  // A adds C and B again (both new pointers name the new numbers gist), then removes B: a new numbers generation.
  const c = m.devs.C[0] as any
  const b = m.devs.B[0] as any
  for (const [x, X] of [
    [c, 'C'],
    [b, 'B'],
  ] as const) {
    const s = await a.list.share()
    m.give('A', X, s.link.split('#')[1])
    const p = await x.list.paste(s.link)
    m.give(X, 'A', p.sendBack.split('#')[1])
    expect((await a.list.paste(p.sendBack)).kind).toBe('added')
  }
  const rowsA = await a.list.rows()
  const bRow = rowsA.rows.find((r: any) => r.name === 'BEA' || /bea/i.test(JSON.stringify(r)))
  const rm = await a.list.remove(bRow?.id ?? bRow?.mine ?? m.bEntries()[0].mine).catch((e: any) => ({ kind: 'throw ' + e.message }))
  for (let i = 0; i < 4; i++) {
    m.clock.advance(61 * 60_000)
    await a.list.rows()
    await a.list.send?.().catch(() => undefined)
  }
  const now = listIn(m, 'ali/vault')!
  const cEntry = listA(m).index.friends.find((f: any) => !m.bEntries().some((e) => e.mine === f.mine))
  const cReachesBefore = m.bfs('C', now.stats!).hit && m.gist(now.stats!) !== undefined
  // A NEW phone of A (no memory) reads a lagging replica: the head of the marked list, once per head read for a while.
  const fresh = (await (m as any).device('A', 1)) as any
  m.devs.A.push(fresh)
  let lag = 3
  hook(m, (d, url, method) => {
    if (d !== fresh || lag <= 0 || method !== 'GET' || !/\/repos\/ali\/vault\/git\/ref\/heads\/main$/.test(new URL(url).pathname)) return undefined
    lag--
    return new Response(JSON.stringify({ ref: 'refs/heads/main', object: { sha: markedHead, type: 'commit' } }), { status: 200, headers: { 'content-type': 'application/json', etag: `"${markedHead}"` } })
  })
  const rows = await fresh.list.rows().catch((e: any) => ({ kind: 'throw ' + e.message }))
  const nowAfter = listIn(m, 'ali/vault')!
  const r = { remove: rm.kind, rows: rows.kind, gen: now.stats === now.mark ? 'same' : 'new', newNumbersAlive: m.gist(now.stats!) !== undefined && m.gist(nowAfter.stats!) !== undefined, cPointerAlive: cEntry ? m.gist(cEntry.mine) !== undefined : null, cReachesBefore, cReachesAfter: m.bfs('C', nowAfter.stats!).hit && m.gist(nowAfter.stats!) !== undefined, bReachesAny: bReachesAny(m) }
  console.log('R8-6', JSON.stringify(r))
  expect(r.newNumbersAlive).toBe(true)
  expect(r.cPointerAlive).toBe(true)
}, 120_000)

it('R8-7: GitHub time UNKNOWN (no Date header, no core reset on any answer): the way out is never offered and nothing is deleted', async () => {
  const m = await world(1)
  const a = m.devs.A[0] as any
  const mine = bMine(m)
  del(m)
  m.clock.advance(11 * 60_000)
  const orig = (m as any).fetchFor.bind(m)
  ;(m as any).fetchFor = (d: any) => {
    const f = orig(d)
    return async (url: string, init: any) => {
      const res: Response = await f(url, init)
      const h = new Headers(res.headers)
      h.delete('date')
      for (const k of [...h.keys()]) if (k.startsWith('x-ratelimit')) h.delete(k)
      return new Response(res.status === 204 || res.status === 304 ? null : await res.arrayBuffer(), { status: res.status, headers: h })
    }
  }
  a.list = (m as any).newList(a)
  const rows = await a.list.rows()
  const out = await a.list.restart('ali/vault')
  console.log('R8-7', JSON.stringify({ rows: rows.kind, restart: out.kind, bPointerAlive: m.gist(mine) !== undefined }))
  expect(rows.kind).not.toBe('home-gone')
  expect(out.kind).not.toBe('done')
  expect(m.gist(mine)).toBeDefined()
})

it('R8-7b: on a real phone GitHub\'s Date header is hidden by CORS; only the core reset is seen (a lower bound up to 60 min behind): when is the way out offered?', async () => {
  const m = await world(1)
  const a = m.devs.A[0] as any
  del(m)
  // The core window started 50 minutes before the file went (GitHub's x-ratelimit-reset is then 10 minutes ahead).
  const resetAt = m.clock.now() + 10 * 60_000
  const orig = (m as any).fetchFor.bind(m)
  ;(m as any).fetchFor = (d: any) => {
    const f = orig(d)
    return async (url: string, init: any) => {
      const res: Response = await f(url, init)
      const h = new Headers(res.headers)
      h.delete('date')
      h.set('x-ratelimit-resource', 'core')
      h.set('x-ratelimit-limit', '5000')
      h.set('x-ratelimit-remaining', '4000')
      let reset = resetAt
      while (reset <= m.clock.now()) reset += 60 * 60_000
      h.set('x-ratelimit-reset', String(Math.floor(reset / 1000)))
      return new Response(res.status === 204 || res.status === 304 ? null : await res.arrayBuffer(), { status: res.status, headers: h })
    }
  }
  a.list = (m as any).newList(a)
  const seen: string[] = []
  for (let min = 11; min <= 81; min += 10) {
    m.clock.advance(min === 11 ? 11 * 60_000 : 10 * 60_000)
    seen.push(`${min}m:${(await a.list.rows()).kind}`)
  }
  console.log('R8-7b', seen.join(' '))
  expect(seen.some((s) => s.endsWith('home-gone'))).toBe(true)
})

it('R8-8: TWO phones run the way out at the same moment in an EMPTY remade home vault: one first commit, the other refused, B cut off', async () => {
  const m = await world(2)
  const [a0, a1] = m.devs.A as any[]
  const mine = bMine(m)
  m.world.repos!.remove('ali/vault')
  m.world.repos!.createEmpty('ali/vault', 'ali')
  a0.list = (m as any).newList(a0)
  a1.list = (m as any).newList(a1)
  m.clock.advance(11 * 60_000)
  expect((await a0.list.rows()).kind).toBe('home-gone')
  expect((await a1.list.rows()).kind).toBe('home-gone')
  const [r0, r1] = await Promise.all([a0.list.restart('ali/vault').catch((e: any) => ({ kind: 'throw ' + e.message })), a1.list.restart('ali/vault').catch((e: any) => ({ kind: 'throw ' + e.message }))])
  const l = listIn(m, 'ali/vault')
  console.log('R8-8', JSON.stringify({ r0: r0.kind, r1: r1.kind, list: l, listNumbersExist: l?.stats ? m.gist(l.stats) !== undefined : null, notes: notes(m).length, bPointerAlive: m.gist(mine) !== undefined, numbersGists: m.world.owned('ali').filter((g) => NUMBERS_FILE in g.files).length }))
  expect(m.gist(mine)).toBeUndefined()
  expect(l?.stats ? m.gist(l.stats) !== undefined : false).toBe(true)
  expect(notes(m)).toHaveLength(1)
  expect((await a0.list.rows()).kind).toBe('ok')
  expect((await a1.list.rows()).kind).toBe('ok')
})

it('R8-9: an EMPTY home vault; the Mac pushes its first commit (no list file) at the way out\'s PUT, and again right after: the way out still ends B\'s access', async () => {
  const m = await world(1)
  const a = m.devs.A[0] as any
  const mine = bMine(m)
  m.world.repos!.remove('ali/vault')
  m.world.repos!.createEmpty('ali/vault', 'ali')
  m.clock.advance(11 * 60_000)
  a.list = (m as any).newList(a)
  expect((await a.list.rows()).kind).toBe('home-gone')
  let n = 0
  hook(m, (_d, url, method) => {
    // The first PUT meets a branch that the Mac made a moment before; then each ref PATCH meets one more Mac push.
    if ((method === 'PUT' && /contents/.test(url)) || (method === 'PATCH' && /\/repos\/ali\/vault\/git\/refs/.test(url))) {
      if (n++ < 2) m.world.repos!.push('ali/vault', { [`p${n}.md`]: '# page\n' }, 'main', 'the Mac pushes')
    }
    return undefined
  })
  const out = await a.list.restart('ali/vault').catch((e: any) => ({ kind: 'throw ' + e.message }))
  const l = listIn(m, 'ali/vault')
  console.log('R8-9', JSON.stringify({ pushes: n, restart: out.kind, list: l, bPointerAlive: m.gist(mine) !== undefined }))
  expect(out.kind).toBe('done')
  expect(m.gist(mine)).toBeUndefined()
})
