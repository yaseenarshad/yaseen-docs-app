import { describe, expect, it } from 'vitest'
import { cardRecords, type CardReview } from '@shared/cardLine'
import { uniteCardLines } from '@shared/cardMerge'
import { GithubError, githubClient, type FetchLike } from '../github/client'
import { memoryBackend, openVaultStore } from '../store'
import { githubRemote } from '../sync/githubRemote'
import { syncPass } from '../sync/pass'
import { INDEX_STATE, type PhoneIndex } from '../sync/phoneIndex'
import { BRANCH, REPO, TOKEN, VAULT, card, cardFileText, pageText, syncSetup, type SyncSetup } from '../sync/testing'
import type { CardOp } from './ops'
import { openOutbox, type Outbox } from './outbox'
import { MAX_STALE_HEADS, commitSubject, sendOutbox } from './send'

const at = (minute: number) => `2026-11-14T06:${String(minute).padStart(2, '0')}Z`
const good = (minute: number): CardReview => ({ at: at(minute), rating: 'good' })
const answer = (id: string, minute: number): CardOp => ({ kind: 'review', id, review: good(minute) })
const quiet = async () => {}

/** One phone on the fake GitHub: its store synced once, its answer list, and its send. */
async function phone(s: SyncSetup, fetch: FetchLike = s.github.fetch, store?: Awaited<ReturnType<typeof openVaultStore>>) {
  const own = store ?? s.store
  const remote = githubRemote(githubClient(TOKEN, { fetch }), REPO, BRANCH)
  await syncPass({ remote, store: own, vault: VAULT, yieldToUi: quiet })
  const box = await openOutbox(own, VAULT)
  const add = (...ops: CardOp[]) => box.add(ops.map((op) => ({ op, path: '', title: `Title ${op.id}` })), 0)
  const send = (options: { remote?: typeof remote; outbox?: Outbox } = {}) => sendOutbox({ remote: options.remote ?? remote, store: own, vault: VAULT, outbox: options.outbox ?? box, yieldToUi: quiet })
  return { remote, box, add, send, store: own }
}

async function setup(files: Record<string, string>) {
  const s = await syncSetup(files)
  const head = () => s.git.branches.get(BRANCH)!
  const remoteFiles = async () => s.git.filesAt(head())
  const commitsSince = (from: string) => {
    let n = 0
    for (let c: string | undefined = head(); c !== undefined && c !== from; c = s.git.commits.get(c)!.parents[0]) n++
    return n
  }
  const reviewsOf = async (path: string, id: string) => cardRecords((await remoteFiles())[path]).find((c) => c.id === id)?.reviews.map((r) => r.at) ?? null
  const patches = () => s.github.calls.filter((c) => c.method === 'PATCH').length
  return { s, head, remoteFiles, commitsSince, reviewsOf, patches }
}

const FILES = {
  'a.md': pageText('A', 'NC-1', ['NC-2', 'NC-3']),
  'b.md': pageText('B', 'NC-4', ['NC-5']),
  'cards/speed-of-light-nc-17.md': cardFileText('Speed of light', 'NC-17'),
  'embeds.md': pageText('Embeds', 'NC-30', [], 'See ![[NC-17]].\n\n'),
}

describe('sendOutbox (decision 2): ONE commit through the Git Data API', () => {
  it('several pages and a card file: one commit, the AutoSync subject, each action in the file that HOLDS the card (never the embedding page)', async () => {
    const t = await setup(FILES)
    const p = await phone(t.s)
    const before = t.head()
    await p.add(answer('NC-2', 1), { kind: 'off', id: 'NC-5', on: true }, answer('NC-17', 2), { kind: 'fix', id: 'NC-3', on: true })
    const writes = t.s.count('write')
    const report = await p.send()
    expect(report).toMatchObject({ result: 'sent', sent: 4, lost: 0, staleHeads: 0 })
    expect(t.commitsSince(before)).toBe(1)
    expect(t.s.count('write') - writes).toBe(3) // tree, commit, ref (text inline)
    expect(t.s.git.commits.get(t.head())!.message).toBe('sync (phone): a.md, b.md, speed-of-light-nc-17.md')
    const now = await t.remoteFiles()
    expect(await t.reviewsOf('a.md', 'NC-2')).toEqual([at(1)])
    expect(now['a.md']).toContain('<!-- card: NC-3, fix -->')
    expect(now['b.md']).toContain('<!-- card: NC-5, off -->')
    expect(await t.reviewsOf('cards/speed-of-light-nc-17.md', 'NC-17')).toEqual([at(2)])
    expect(now['cards/speed-of-light-nc-17.md'].startsWith('---\nkind: card\ntitle: Speed of light\n---\n')).toBe(true)
    expect(now['embeds.md']).toBe(FILES['embeds.md'])
    expect(p.box.waiting()).toEqual([])
    // The phone's copy now holds the commit: the next send has nothing to do and costs no write.
    expect((await p.store.checkpoint(VAULT))!.commit).toBe(t.head())
    expect(await p.send()).toMatchObject({ result: 'nothing' })
  })

  it('the subject names three files, then "+N more" (as AutoSync: basenames)', () => {
    expect(commitSubject(['a.md'])).toBe('sync (phone): a.md')
    expect(commitSubject(['x/a.md', 'b.md', 'c.md', 'd.md', 'e.md'])).toBe('sync (phone): a.md, b.md, c.md +2 more')
  })

  it('the Mac changed the card\'s TEXT between the answer and the send: the answer lands on the new text', async () => {
    const t = await setup(FILES)
    const p = await phone(t.s)
    await p.add(answer('NC-2', 1))
    const macText = pageText('A', 'NC-1', ['NC-3']).replace('# A\n\n', `# A\n\n${card('NC-2', 'A NEW question {{x}}?')}\n\n`)
    await t.s.git.push({ 'a.md': macText })
    await p.send()
    const now = (await t.remoteFiles())['a.md']
    expect(now).toContain('A NEW question {{x}}?')
    expect(now).toBe(macText.replace('<!-- card: NC-2 -->', `<!-- card: NC-2, ${at(1)} good -->`))
  })

  it('the card moved to another page before the send: the action finds it by ID there', async () => {
    const t = await setup(FILES)
    const p = await phone(t.s)
    await p.add(answer('NC-2', 1))
    await t.s.git.push({ 'a.md': pageText('A', 'NC-1', ['NC-3']), 'b.md': pageText('B', 'NC-4', ['NC-5', 'NC-2']) })
    await p.send()
    expect(await t.reviewsOf('b.md', 'NC-2')).toEqual([at(1)])
    expect((await t.remoteFiles())['a.md']).toBe(pageText('A', 'NC-1', ['NC-3']))
  })

  it('the Mac moved the card from the page into its own card file (YAZ-5037) before the send: the review lands in the card file', async () => {
    const t = await setup(FILES)
    const p = await phone(t.s)
    await p.add(answer('NC-2', 1), { kind: 'next', id: 'NC-2', on: true })
    await t.s.git.push({ 'a.md': pageText('A', 'NC-1', ['NC-3'], 'See ![[NC-2]].\n\n'), 'cards/what-nc-2.md': cardFileText('What', 'NC-2') })
    const report = await p.send()
    expect(report).toMatchObject({ result: 'sent', lost: 0 })
    const now = await t.remoteFiles()
    expect(now['cards/what-nc-2.md']).toContain(`<!-- card: NC-2, next, ${at(1)} good -->`)
    expect(now['cards/what-nc-2.md'].startsWith('---\nkind: card\ntitle: What\n---\n')).toBe(true)
    expect(now['a.md']).toBe(pageText('A', 'NC-1', ['NC-3'], 'See ![[NC-2]].\n\n'))
  })

  it('the card was deleted: the action is LOST (kept with its title, never sent again); the other actions still go in the same commit', async () => {
    const t = await setup(FILES)
    const p = await phone(t.s)
    await p.add(answer('NC-2', 1))
    await p.add(answer('NC-5', 2))
    await t.s.git.push({ 'a.md': pageText('A', 'NC-1', ['NC-3']) })
    const before = t.head()
    const report = await p.send()
    expect(report).toMatchObject({ result: 'sent', sent: 1, lost: 1 })
    expect(t.commitsSince(before)).toBe(1)
    expect(await t.reviewsOf('b.md', 'NC-5')).toEqual([at(2)])
    expect(p.box.waiting()).toEqual([])
    expect(p.box.lost()).toMatchObject([{ op: answer('NC-2', 1), title: 'Title NC-2' }])
    const writes = t.s.count('write')
    expect(await p.send()).toMatchObject({ result: 'nothing' })
    expect(t.s.count('write')).toBe(writes)
  })

  it('only lost actions: no commit at all', async () => {
    const t = await setup(FILES)
    const p = await phone(t.s)
    await p.add(answer('NC-99', 1))
    const writes = t.s.count('write')
    expect(await p.send()).toMatchObject({ result: 'nothing', lost: 1 })
    expect(t.s.count('write')).toBe(writes)
  })
})

describe('sendOutbox: a moved branch, a lost answer, a closed app', () => {
  /** A fetch that pushes a Mac commit just before each of the first `n` ref moves: GitHub then refuses the move. */
  const macPushesBeforePatch = (t: Awaited<ReturnType<typeof setup>>, n: number): FetchLike => {
    let left = n
    return async (url, init) => {
      if ((init.method ?? 'GET') === 'PATCH' && left > 0) {
        left--
        await t.s.git.push({ [`mac-${left}.md`]: `# Mac ${left}\n` })
      }
      return t.s.github.fetch(url, init)
    }
  }

  it('STALE_HEAD once: read again, apply again to the new text, repeat; the Mac\'s change stays', async () => {
    const t = await setup(FILES)
    const p = await phone(t.s, macPushesBeforePatch(t, 1))
    await p.add(answer('NC-2', 1))
    const report = await p.send()
    expect(report).toMatchObject({ result: 'sent', staleHeads: 1 })
    expect(t.patches()).toBe(2)
    expect(await t.reviewsOf('a.md', 'NC-2')).toEqual([at(1)])
    expect((await t.remoteFiles())['mac-0.md']).toBe('# Mac 0\n')
  })

  it('three STALE_HEADs in a row: the fourth move goes; one review, all three Mac commits kept', async () => {
    const t = await setup(FILES)
    const p = await phone(t.s, macPushesBeforePatch(t, 3))
    await p.add(answer('NC-2', 1))
    const before = t.head()
    expect(await p.send()).toMatchObject({ result: 'sent', staleHeads: 3 })
    expect(t.patches()).toBe(4)
    expect(t.commitsSince(before)).toBe(4)
    expect(await t.reviewsOf('a.md', 'NC-2')).toEqual([at(1)])
    for (const n of [0, 1, 2]) expect((await t.remoteFiles())[`mac-${n}.md`]).toBe(`# Mac ${n}\n`)
  })

  it(`more than ${MAX_STALE_HEADS} STALE_HEADs: it stops with STALE_HEAD and the actions stay`, async () => {
    const t = await setup(FILES)
    const p = await phone(t.s, macPushesBeforePatch(t, MAX_STALE_HEADS + 1))
    await p.add(answer('NC-2', 1))
    await expect(p.send()).rejects.toMatchObject({ code: 'STALE_HEAD' })
    expect(p.box.waiting()).toHaveLength(1)
    expect(await t.reviewsOf('a.md', 'NC-2')).toEqual([])
  })

  it('the send reached GitHub (the ref moved) but its answer never came: the actions stay; the next send writes NOTHING and lets them go (no second review)', async () => {
    const t = await setup(FILES)
    let lose = true
    const lossy: FetchLike = async (url, init) => {
      const res = await t.s.github.fetch(url, init)
      if ((init.method ?? 'GET') === 'PATCH' && lose) {
        lose = false
        throw new TypeError('Load failed')
      }
      return res
    }
    const p = await phone(t.s, lossy)
    await p.add(answer('NC-2', 1), { kind: 'off', id: 'NC-3', on: true })
    expect(await p.send()).toMatchObject({ result: 'offline' })
    expect(p.box.waiting()).toHaveLength(2)
    expect(await t.reviewsOf('a.md', 'NC-2')).toEqual([at(1)])
    const before = t.head()
    const writes = t.s.count('write')
    expect(await p.send()).toMatchObject({ result: 'sent', sent: 2 })
    expect(t.s.count('write')).toBe(writes)
    expect(t.head()).toBe(before)
    expect(await t.reviewsOf('a.md', 'NC-2')).toEqual([at(1)])
    expect(p.box.waiting()).toEqual([])
  })

  it('the app closed between "commit made" and "ref moved": at the next start the actions are still there and go ONE time', async () => {
    const t = await setup(FILES)
    const dies: FetchLike = async (url, init) => {
      if ((init.method ?? 'GET') === 'PATCH') throw new TypeError('Load failed')
      return t.s.github.fetch(url, init)
    }
    const p = await phone(t.s, dies)
    await p.add(answer('NC-2', 1))
    const before = t.head()
    expect(await p.send()).toMatchObject({ result: 'offline' })
    expect(t.head()).toBe(before)
    // The next start: the list again from the store, a remote that works.
    const next = await phone(t.s, t.s.github.fetch)
    expect(next.box.waiting()).toHaveLength(1)
    expect(await next.send()).toMatchObject({ result: 'sent' })
    expect(t.commitsSince(before)).toBe(1)
    expect(await t.reviewsOf('a.md', 'NC-2')).toEqual([at(1)])
  })

  it('no signal: "offline", nothing is written, the actions stay', async () => {
    const t = await setup(FILES)
    const p = await phone(t.s)
    await p.add(answer('NC-2', 1))
    t.s.github.offline = true
    expect(await p.send()).toMatchObject({ result: 'offline' })
    expect(p.box.waiting()).toHaveLength(1)
    t.s.github.offline = false
    t.s.github.down = true
    expect(await p.send()).toMatchObject({ result: 'offline' })
    expect(p.box.waiting()).toHaveLength(1)
  })
})

describe('sendOutbox: errors keep the actions', () => {
  it('401 (token cancelled): UNAUTHORIZED; the actions stay', async () => {
    const t = await setup(FILES)
    const p = await phone(t.s)
    await p.add(answer('NC-2', 1))
    t.s.github.revoke(TOKEN)
    await expect(p.send()).rejects.toMatchObject({ code: 'UNAUTHORIZED' })
    expect(p.box.waiting()).toHaveLength(1)
  })

  it('403 on the write (no write access): READ_ONLY; the actions stay', async () => {
    const s = await syncSetup(FILES, { access: 'read' })
    const p = await phone(s)
    await p.add(answer('NC-2', 1))
    await expect(p.send()).rejects.toMatchObject({ code: 'READ_ONLY' })
    expect(p.box.waiting()).toHaveLength(1)
  })

  it('"slow down": RATE_LIMITED with the time to try again; the actions stay', async () => {
    const t = await setup(FILES)
    const p = await phone(t.s)
    await p.add(answer('NC-2', 1))
    const until = Math.ceil(Date.now() / 1000) + 600
    t.s.github.rateLimitedUntil = until
    const error = await p.send().catch((e: unknown) => e)
    expect(error).toBeInstanceOf(GithubError)
    expect(error).toMatchObject({ code: 'RATE_LIMITED', resetAt: until * 1000 })
    expect(p.box.waiting()).toHaveLength(1)
  })

  for (const [status, message] of [[422, 'Reference does not exist'], [409, 'Git Repository is empty.'], [422, 'Reference update failed']] as const) {
    it(`${status} "${message}" on the ref move is NOT a moved branch: no repeat, the actions stay`, async () => {
      const t = await setup(FILES)
      const refuse: FetchLike = async (url, init) => ((init.method ?? 'GET') === 'PATCH' ? new Response(JSON.stringify({ message }), { status, headers: { 'content-type': 'application/json' } }) : t.s.github.fetch(url, init))
      const p = await phone(t.s, refuse)
      await p.add(answer('NC-2', 1))
      const calls = t.s.github.calls.length
      await expect(p.send()).rejects.toMatchObject({ code: 'UNEXPECTED' })
      expect(t.s.github.calls.slice(calls).filter((c) => c.method === 'POST' && c.url.endsWith('/git/commits'))).toHaveLength(1)
      expect(p.box.waiting()).toHaveLength(1)
    })
  }
})

describe('sendOutbox: many answers, two phones', () => {
  it('500 waiting answers on 50 pages: ONE commit, one ref move', async () => {
    const files: Record<string, string> = {}
    for (let p = 0; p < 50; p++) files[`p${String(p).padStart(2, '0')}.md`] = pageText(`P${p}`, `NC-${p}`, Array.from({ length: 10 }, (_, c) => `NC-${1000 + p * 10 + c}`))
    const t = await setup(files)
    const p = await phone(t.s)
    const ops: CardOp[] = []
    for (let n = 0; n < 500; n++) ops.push(answer(`NC-${1000 + n}`, n % 60))
    await p.add(...ops)
    const before = t.head()
    const t0 = performance.now()
    expect(await p.send()).toMatchObject({ result: 'sent', sent: 500, lost: 0 })
    expect(performance.now() - t0).toBeLessThan(10_000)
    expect(t.commitsSince(before)).toBe(1)
    expect(t.patches()).toBe(1)
    expect(t.s.git.commits.get(t.head())!.message).toBe('sync (phone): p00.md, p01.md, p02.md +47 more')
    const now = await t.remoteFiles()
    expect(Object.values(now).flatMap((text) => cardRecords(text)).filter((c) => c.reviews.length === 1)).toHaveLength(500)
  })

  it('two phones answer ONE card: both reviews land, each one time; a Mac that answered it too unites all three (decision 5)', async () => {
    const t = await setup(FILES)
    const base = (await t.remoteFiles())['a.md']
    const phoneA = await phone(t.s)
    const phoneB = await phone(t.s, t.s.github.fetch, await openVaultStore(memoryBackend()))
    await phoneA.add(answer('NC-2', 1))
    await phoneB.add(answer('NC-2', 2))
    await phoneA.send()
    await phoneB.send() // its copy is older: it reads the new head first and adds to A's line
    const theirs = (await t.remoteFiles())['a.md']
    expect(await t.reviewsOf('a.md', 'NC-2')).toEqual([at(1), at(2)])
    // The Mac answered NC-2 at 06:03 before it pulled: its line and GitHub's differ, and the merge rule unites them.
    const mine = base.replace('<!-- card: NC-2 -->', `<!-- card: NC-2, ${at(3)} good -->`)
    const [united] = uniteCardLines(base, theirs, mine)
    expect(cardRecords(united).find((c) => c.id === 'NC-2')!.reviews.map((r) => r.at)).toEqual([at(1), at(2), at(3)])
  })

  it('archive then unarchive before the send: the list holds both, in order; nothing to write, and both leave', async () => {
    const t = await setup(FILES)
    const p = await phone(t.s)
    await p.add({ kind: 'off', id: 'NC-2', on: true })
    await p.add({ kind: 'off', id: 'NC-2', on: false })
    const writes = t.s.count('write')
    expect(await p.send()).toMatchObject({ result: 'sent', sent: 2 })
    expect(t.s.count('write')).toBe(writes)
    expect(p.box.waiting()).toEqual([])
  })
})

describe('YAZ-5073 checker gap 6: an action the file does not hold after all', () => {
  it('the index names a.md for a card that a.md does not hold: the action is LOST (kept for Discard), never dropped silently', async () => {
    const t = await setup(FILES)
    const p = await phone(t.s)
    await p.add(answer('NC-9', 1), answer('NC-2', 2))
    // A pass whose index says a.md holds NC-9 (as a stale or wrong record would).
    const pass = async () => {
      await syncPass({ remote: p.remote, store: p.store, vault: VAULT, yieldToUi: quiet })
      const index = (await p.store.getState<PhoneIndex>(VAULT, INDEX_STATE))!
      const a = index.records['a.md']
      index.records['a.md'] = { ...a, cards: [...(a.cards ?? []), { id: 'NC-9', off: false, next: false, reviews: [] }] }
      await p.store.setState(VAULT, INDEX_STATE, index)
    }
    const report = await sendOutbox({ remote: p.remote, store: p.store, vault: VAULT, outbox: p.box, pass })
    expect(report).toMatchObject({ result: 'sent', sent: 1, lost: 1 })
    expect(p.box.lost().map((l) => l.op)).toEqual([answer('NC-9', 1)])
    expect(p.box.waiting()).toEqual([])
    expect(await t.reviewsOf('a.md', 'NC-2')).toEqual([at(2)])
  })
})

