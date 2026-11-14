import { describe, expect, it } from 'vitest'
import { githubClient, type FetchLike } from '../github/client'
import { fakeGit, fakeGithub } from '../github/testing'
import { memoryBackend, openVaultStore, tokenStoreOn, type PhoneVault, type TokenStore } from '../store'
import { POLL_MS } from './cadence'
import { createSyncEngine, type SyncEngineOptions } from './engine'
import { githubRemote } from './githubRemote'
import { INDEX_STATE, type PhoneIndex } from './phoneIndex'
import { syncPass } from './pass'
import { BRANCH, REPO, TOKEN, VAULT, cardFileText, fakeClock, pageText, syncSetup, type SyncSetup } from './testing'

const VAULT_ROW: PhoneVault = { repo: REPO, branch: BRANCH, addedAt: 0 }
const noYield = async () => {}
const pass = (s: SyncSetup) => syncPass({ remote: s.remote, store: s.store, vault: VAULT, yieldToUi: noYield })

async function setup(files: Record<string, string | Uint8Array> = { 'a.md': pageText('A', 'NC-1') }, extra: Partial<SyncEngineOptions> = {}, wrap?: (f: FetchLike) => FetchLike) {
  const s = await syncSetup(files)
  const clock = fakeClock()
  const fetch = wrap ? wrap(s.github.fetch) : s.github.fetch
  const engine = createSyncEngine({
    store: s.store,
    tokens: s.tokens,
    clock,
    yieldToUi: noYield,
    makeRemote: (vault, token) => githubRemote(githubClient(token, { fetch, now: clock.now }), vault.repo, vault.branch),
    ...extra,
  })
  const tick = async (ms: number) => {
    clock.advance(ms)
    await engine.idle()
    await new Promise((r) => setTimeout(r, 0))
    await engine.idle()
  }
  return { s, clock, engine, tick, refs: () => s.count('ref') }
}

describe('checker YAZ-5072: rate limit', () => {
  it('3B-A: a rate limit whose reset time has already passed (phone clock a little ahead) does not retry with no wait', async () => {
    const t = await setup()
    await t.engine.open(VAULT_ROW)
    await t.engine.idle()
    const before = t.refs()
    // GitHub: 403, remaining 0, reset 5 s BEFORE the phone's clock.
    t.s.github.rateLimitedUntil = Math.floor(t.clock.now() / 1000) - 5
    await t.engine.syncNow()
    expect(t.engine.state().status).toBe('slowed')
    // 10 timer turns with NO time passing.
    for (let i = 0; i < 10; i++) await t.tick(0)
    // Expected: at most the one failed call; the engine waits some time before it asks again.
    expect(t.refs() - before).toBeLessThanOrEqual(1)
  })
})

describe('checker YAZ-5072: the polling timer after an error', () => {
  it('3B-B: one failed read of the token store (IndexedDB "connection lost") does not stop the polling for good', async () => {
    const s0 = await syncSetup({ 'a.md': pageText('A', 'NC-1') })
    let fail = 0
    const tokens: TokenStore = { ...s0.tokens, read: async (v) => (fail-- > 0 ? Promise.reject(new Error('UnknownError: Connection to Indexed Database server lost')) : s0.tokens.read(v)) }
    const t = await setup(undefined, { tokens, store: s0.store, makeRemote: (vault, token) => githubRemote(githubClient(token, { fetch: s0.github.fetch }), vault.repo, vault.branch) })
    const unhandled: unknown[] = []
    const onUnhandled = (e: unknown) => unhandled.push(e)
    process.on('unhandledRejection', onUnhandled)
    try {
      await t.engine.open(VAULT_ROW)
      await t.engine.idle()
      fail = 1
      t.clock.advance(POLL_MS) // this poll's token read fails
      const idleError = await t.engine.idle().then(() => null, (e: Error) => e.message)
      await new Promise((r) => setTimeout(r, 10))
      // Expected: the failure becomes a status, idle() does not throw, and the next poll is planned.
      expect({ idleError, status: t.engine.state().status, timers: t.clock.pending(), unhandled: unhandled.length }).toEqual({ idleError: null, status: 'off', timers: 1, unhandled: 0 })
    } finally {
      process.off('unhandledRejection', onUnhandled)
    }
  })
})

describe('checker YAZ-5072: switching vault mid-pass', () => {
  it('3B-C: opening vault B while vault A downloads shows B from storage at once, and B syncs, without waiting for A', async () => {
    const gitA = await fakeGit({ 'a.md': pageText('A', 'NC-1'), 'a2.md': pageText('A2', 'NC-2') }, 'main')
    const gitB = await fakeGit({ 'b.md': pageText('B', 'NC-9') }, 'main')
    const github = fakeGithub({ tokens: { [TOKEN]: { login: 'yaseen', repos: { 'yaseen/a': 'write', 'yaseen/b': 'write' } } }, repos: [{ fullName: 'yaseen/a', git: gitA }, { fullName: 'yaseen/b', git: gitB }] })
    const backend = memoryBackend()
    const store = await openVaultStore(backend)
    const tokens = tokenStoreOn(backend)
    await tokens.write('yaseen/a@main', TOKEN)
    await tokens.write('yaseen/b@main', TOKEN)
    // A slow network for vault A's blobs only (a first download of 611 pages takes ~45 s on a good network).
    let waitingA = false
    let release!: () => void
    const held = new Promise<void>((r) => (release = r))
    const fetch: FetchLike = async (url, init) => {
      if (url.includes('/yaseen/a/git/blobs/')) {
        waitingA = true
        await held
      }
      return github.fetch(url, init)
    }
    const clock = fakeClock()
    const engine = createSyncEngine({ store, tokens, clock, yieldToUi: noYield, makeRemote: (v, tok) => githubRemote(githubClient(tok, { fetch }), v.repo, v.branch) })
    const B: PhoneVault = { repo: 'yaseen/b', branch: 'main', addedAt: 1 }
    const A: PhoneVault = { repo: 'yaseen/a', branch: 'main', addedAt: 0 }
    // B synced once before, so its copy is on the phone.
    await engine.open(B)
    await engine.idle()
    expect(engine.index()!.records['b.md'].title).toBe('B')
    await engine.open(A) // A's first download starts and hangs on the slow blobs
    await new Promise((r) => setTimeout(r, 20))
    expect(waitingA).toBe(true)
    let opened = false
    const openB = engine.open(B).then(() => (opened = true))
    await new Promise((r) => setTimeout(r, 50))
    const shown = engine.index()?.records['b.md']?.title ?? null
    release()
    await openB
    await engine.idle()
    // Expected: B's stored copy shows at once (N1: "Opens from storage").
    expect({ opened, shown }).toEqual({ opened: true, shown: 'B' })
  })
})

describe('checker YAZ-5072: file(path) and a pass at the same time', () => {
  it('3B-D: a picture fetched on demand while a pass changes it does not keep the old version for good', async () => {
    let releaseBlob: (() => void) | null = null
    let holdNextBlob = false
    const wrap = (f: FetchLike): FetchLike => async (url, init) => {
      if (holdNextBlob && url.includes('/git/blobs/')) {
        holdNextBlob = false
        await new Promise<void>((r) => (releaseBlob = r))
      }
      return f(url, init)
    }
    const t = await setup({ 'a.md': pageText('A', 'NC-1'), 'p.png': new Uint8Array([1, 1, 1]) }, {}, wrap)
    await t.engine.open(VAULT_ROW)
    await t.engine.idle()
    await t.s.git.push({ 'p.png': new Uint8Array([2, 2, 2]) }) // the Mac changes the picture
    holdNextBlob = true
    const shown = t.engine.file('p.png') // the page shows the picture: the download of v1 is slow
    await new Promise((r) => setTimeout(r, 10))
    await t.engine.syncNow() // the poll takes in v2
    releaseBlob!()
    await shown
    await t.s.git.push({ 'a.md': pageText('A again', 'NC-1') })
    await t.engine.syncNow()
    await t.engine.syncNow()
    // Expected: the phone shows the picture of the head (v2).
    expect((await t.engine.file('p.png'))!.content).toEqual(new Uint8Array([2, 2, 2]))
  })
})

describe('checker YAZ-5072: a request that never ends', () => {
  it('3B-E: a GitHub request that hangs (no answer, no error) ends after a time limit; the engine goes grey and polls again', async () => {
    let hang = false
    const wrap = (f: FetchLike): FetchLike => (url, init) => (hang ? new Promise<Response>(() => {}) : f(url, init))
    const t = await setup(undefined, {}, wrap)
    await t.engine.open(VAULT_ROW)
    await t.engine.idle()
    hang = true
    t.clock.advance(POLL_MS) // this poll's request never ends
    for (let i = 0; i < 10; i++) t.clock.advance(60_000) // ten minutes
    await new Promise((r) => setTimeout(r, 10))
    hang = false
    const pulled = await Promise.race([t.engine.syncNow().then(() => 'ended'), new Promise((r) => setTimeout(() => r('still waiting'), 50))])
    expect({ status: t.engine.state().status, pulled }).toEqual({ status: 'synced', pulled: 'ended' })
  })
})

describe('checker YAZ-5072: probes that are expected to pass', () => {
  it('paths with spaces, #, %, emoji, non-ASCII; a case-only rename; a big binary', async () => {
    const s = await syncSetup({
      'my notes/a #1 100%.md': pageText('Hash', 'NC-1'),
      'émoji 🚀/über.md': pageText('Uber', 'NC-2'),
      'Foo.md': pageText('Foo', 'NC-3'),
      'big.bin': new Uint8Array(3_000_000),
    })
    const r = await pass(s)
    expect(r.kind).toBe('synced')
    const idx = (await s.store.getState<PhoneIndex>(VAULT, INDEX_STATE))!
    expect(idx.records['my notes/a #1 100%.md'].title).toBe('Hash')
    expect(idx.records['émoji 🚀/über.md'].folder).toBe('émoji 🚀')
    expect(s.count('blob')).toBe(3)
    const foo = pageText('Foo', 'NC-3')
    await s.git.push({ 'Foo.md': null, 'foo.md': foo })
    const r2 = await pass(s)
    expect(r2.kind === 'synced' && r2.diff.renamed).toEqual([{ from: 'Foo.md', to: 'foo.md' }])
    expect((await s.store.read(VAULT, 'foo.md'))?.content).toBe(foo)
    expect(await s.store.read(VAULT, 'Foo.md')).toBeNull()
    expect(s.count('blob')).toBe(3)
    for (const c of s.github.calls) expect(c.url).not.toContain(TOKEN)
  })

  it('invalid card files and broken frontmatter do not stop the pass', async () => {
    const bad = {
      'c1.md': '---\nkind: card\ntitle: [unclosed\n---\n\n```card\nX\n```\n<!-- card: NC-1 -->\n',
      'c2.md': '---\nkind: card\n---\n',
      'c3.md': '---\nkind: card\ntitle: 42\n---\n```card\n```\n<!-- card: -->\n<!-- card: NC-2 {"r":"garbage -->',
      'c4.md': '---\na: &a ["x","x","x","x","x","x","x","x","x"]\nb: &b [*a,*a,*a,*a,*a,*a,*a,*a,*a]\nc: &c [*b,*b,*b,*b,*b,*b,*b,*b,*b]\nd: &d [*c,*c,*c,*c,*c,*c,*c,*c,*c]\ne: [*d,*d,*d,*d,*d,*d,*d,*d,*d]\nkind: card\n---\n',
      'c5.md': '﻿---\nkind: card\ntitle: BOM\n---\n',
      'c6.md': new Uint8Array([0xff, 0xfe, 0x00, 0x41, 0xc3]),
      'ok.md': cardFileText('Fine', 'NC-7'),
    }
    const s = await syncSetup(bad)
    const r = await pass(s)
    expect(r.kind).toBe('synced')
    const idx = (await s.store.getState<PhoneIndex>(VAULT, INDEX_STATE))!
    expect(Object.keys(idx.records).sort()).toEqual(Object.keys(bad).sort())
    expect(idx.records['ok.md'].kind).toBe('card')
  })

  it('a blob 5xx mid-pass: grey off, next tick recovers with no second fetch of stored files; 401 mid-pass: attention', async () => {
    const files: Record<string, string> = {}
    for (let i = 0; i < 20; i++) files[`p${i}.md`] = pageText(`P${i}`, `NC-${i + 1}`)
    const t = await setup(files)
    let n = 0
    t.s.github.interrupt = (c) => (c.url.includes('/git/blobs/') && ++n === 8 ? new Response('boom', { status: 502 }) : undefined)
    await t.engine.open(VAULT_ROW)
    await t.engine.idle()
    expect(t.engine.state()).toMatchObject({ status: 'off', problem: 'GITHUB_DOWN', ready: false })
    const blobs = t.s.count('blob')
    t.s.github.interrupt = null
    await t.tick(POLL_MS)
    expect(t.engine.state()).toMatchObject({ status: 'synced', ready: true })
    expect(t.s.count('blob') - blobs).toBeLessThanOrEqual(20 - 7 + 5)
    await t.s.git.push({ 'p1.md': 'x', 'p2.md': 'y' })
    t.s.github.interrupt = (c) => (c.url.includes('/git/blobs/') ? new Response('{"message":"Bad credentials"}', { status: 401 }) : undefined)
    await t.tick(POLL_MS)
    expect(t.engine.state()).toMatchObject({ status: 'attention', problem: 'UNAUTHORIZED' })
    const calls = t.s.github.calls.length
    await t.tick(POLL_MS * 4)
    expect(t.s.github.calls.length).toBe(calls)
    expect(t.engine.index()!.records['p1.md'].title).toBe('P1')
  })

  it('hidden mid-pass: the pass ends, no timer while hidden', async () => {
    const t = await setup()
    await t.engine.open(VAULT_ROW)
    const p = t.engine.syncNow()
    t.engine.setVisible(false)
    await p
    await t.engine.idle()
    expect(t.clock.pending()).toBe(0)
  })

  it('commit: only the exact 422 is STALE_HEAD; other 422s are not', async () => {
    const s = await syncSetup({ 'a.md': 'A' })
    const h = await s.remote.head()
    if (h === 'unchanged') throw new Error('no')
    s.github.interrupt = (c) => (c.method === 'PATCH' ? new Response(JSON.stringify({ message: 'Update is not a fast-forward' }), { status: 422 }) : undefined)
    await expect(s.remote.commit(h.sha, [{ path: 'a.md', content: 'B' }], 'm')).rejects.toMatchObject({ code: 'UNEXPECTED' })
    s.github.interrupt = (c) => (c.method === 'POST' && c.url.endsWith('/git/commits') ? new Response(JSON.stringify({ message: 'Update is not a fast forward' }), { status: 422 }) : undefined)
    await expect(s.remote.commit(h.sha, [{ path: 'a.md', content: 'B' }], 'm')).rejects.toMatchObject({ code: 'UNEXPECTED' })
  })

  it('perf, each run (not the best of five): a 1,700-file first download; plus one big page', async () => {
    const files: Record<string, string | Uint8Array> = {}
    for (let i = 0; i < 520; i++) files[`pages/p${i}.md`] = pageText(`Page ${i}`, `NC-${i + 1}`, [`NC-${2000 + i * 2}`], `Links [[Page ${(i + 1) % 520}]]\n\n${'Some made-up words. '.repeat(40)}\n\n`)
    for (let i = 0; i < 90; i++) files[`cards/c-nc-${5000 + i}.md`] = cardFileText(`Card ${i}`, `NC-${5000 + i}`)
    for (let i = 0; i < 1089; i++) files[`assets/images/i${i}.png`] = new Uint8Array([i % 256, 1, 2, 3])
    let gaps: number[] = []
    let last = performance.now()
    let probing = true
    const probe = () => {
      const now = performance.now()
      gaps.push(now - last)
      last = now
      if (probing) setTimeout(probe, 0)
    }
    setTimeout(probe, 0)
    const realYield = () => new Promise<void>((r) => setTimeout(r, 0))
    const runs: string[] = []
    for (let run = 0; run < 5; run++) {
      const s = await syncSetup(files)
      await new Promise((r) => setTimeout(r, 5))
      gaps = []
      last = performance.now()
      await syncPass({ remote: s.remote, store: s.store, vault: VAULT, yieldToUi: realYield })
      runs.push(Math.max(...gaps).toFixed(1))
    }
    const big = `---\ntitle: Big\n---\n\n${Array.from({ length: 40_000 }, (_, i) => `Line ${i} with [[Link ${i % 300}]] and #tag${i % 50} and words.`).join('\n')}\n`
    const s = await syncSetup({ 'big.md': big })
    await new Promise((r) => setTimeout(r, 5))
    gaps = []
    last = performance.now()
    await syncPass({ remote: s.remote, store: s.store, vault: VAULT, yieldToUi: realYield })
    const bigHold = Math.max(...gaps)
    probing = false
    console.log(`[checker perf] 1,700 files, longest hold per run: ${runs.join(', ')} ms; one ${(big.length / 1e6).toFixed(1)} MB page: longest hold ${bigHold.toFixed(1)} ms`)
  })
})
