import { describe, expect, it } from 'vitest'
import { cardPlan } from '@shared/cardSchedule'
import { sanitizeReviewSettings } from '@shared/reviews'
import { githubClient } from '../github/client'
import { POLL_MS, SEND_AFTER_MS } from '../sync/cadence'
import { createSyncEngine } from '../sync/engine'
import { githubRemote } from '../sync/githubRemote'
import { VAULT, fakeClock, pageText } from '../sync/testing'
import { createAnswers } from './answers'
import { VAULT_ROW, answer, answersSetup, at } from './testing'

describe('when the list is sent (decision 4)', () => {
  it(`${SEND_AFTER_MS / 1000} s after the LAST answer: a burst of answers is ONE commit`, async () => {
    const t = await answersSetup()
    for (let i = 0; i < 10; i++) {
      await t.add(answer(i % 2 === 0 ? 'NC-2' : 'NC-3', i))
      await t.tick(1_000)
    }
    expect(t.commits()).toBe(0)
    await t.tick(SEND_AFTER_MS - 1_001)
    expect(t.commits()).toBe(0)
    await t.tick(1)
    expect(t.commits()).toBe(1)
    expect(await t.remoteReviews()).toEqual([at(0), at(2), at(4), at(6), at(8)])
    expect(t.answers.state()).toMatchObject({ waiting: 0, sending: false, problem: null, lastSentAt: t.clock.now() })
  })

  it('at once when the app goes to the background', async () => {
    const t = await answersSetup()
    await t.add(answer('NC-2', 1))
    // As followPage and 4A do: the page is hidden.
    t.engine.setVisible(false)
    t.answers.setVisible(false)
    await t.answers.idle()
    expect(t.commits()).toBe(1)
    expect(t.clock.pending()).toBe(0) // no send timer left, and the engine does not poll while hidden
  })

  it('no signal: the answer waits ("1 answer waiting"); it goes at once when the connection comes back', async () => {
    const t = await answersSetup()
    t.s.github.offline = true
    await t.add(answer('NC-2', 1))
    await t.tick(SEND_AFTER_MS)
    expect(t.answers.state()).toMatchObject({ waiting: 1, problem: 'OFFLINE', sending: false })
    t.s.github.offline = false
    t.answers.online()
    await t.answers.idle()
    expect(t.commits()).toBe(1)
    expect(t.answers.state()).toMatchObject({ waiting: 0, problem: null })
  })

  it('no signal, and no "online" event: the engine\'s next good poll sends the waiting answers', async () => {
    const t = await answersSetup()
    t.s.github.offline = true
    await t.add(answer('NC-2', 1))
    await t.tick(SEND_AFTER_MS)
    t.s.github.offline = false
    await t.tick(POLL_MS)
    expect(t.commits()).toBe(1)
  })

  it('an answer made during a send waits for the next send; one send at a time', async () => {
    let release: () => void = () => {}
    let held = false
    const t = await answersSetup({
      fetch: (s) => async (url, init) => {
        if ((init.method ?? 'GET') === 'PATCH' && !held) {
          held = true
          await new Promise<void>((r) => (release = r))
        }
        return s.github.fetch(url, init)
      },
    })
    await t.add(answer('NC-2', 1))
    const first = t.answers.sendNow()
    await new Promise((r) => setTimeout(r, 0))
    for (let i = 0; i < 20 && !held; i++) await new Promise((r) => setTimeout(r, 0))
    expect(t.answers.state().sending).toBe(true)
    await t.add(answer('NC-3', 2))
    void t.answers.sendNow()
    release()
    await first
    await t.answers.idle()
    expect(t.commits()).toBe(2)
    expect(await t.remoteReviews('a.md', 'NC-3')).toEqual([at(2)])
  })
})

describe('the local copy: an answer counts at once, with no connection', () => {
  it('text() and view() hold the waiting answers, so Review and the due list are right offline', async () => {
    const t = await answersSetup()
    t.s.github.offline = true
    await t.add(answer('NC-2', 1), { kind: 'off', id: 'NC-17', on: true })
    expect(await t.answers.text('a.md')).toContain(`<!-- card: NC-2, ${at(1)} good -->`)
    expect((await t.store.read(VAULT, 'a.md'))!.content).not.toContain(at(1)) // the stored copy is GitHub's
    const view = await t.answers.view(t.engine.index()!)
    expect(view.records['a.md'].cards!.find((c) => c.id === 'NC-2')!.reviews.map((r) => r.at)).toEqual([at(1)])
    expect(view.records['cards/light-nc-17.md'].cards![0].off).toBe(true)
    expect(view.records['cards/light-nc-17.md']).toMatchObject({ kind: 'card', title: 'Speed of light' })
    expect(t.events.some((e) => e.type === 'changed' && e.paths.includes('a.md'))).toBe(true)
  })

  it('YAZ-5078: a file that a waiting action changes gets a new mtime and size in the view, so the shared due list reads it again', async () => {
    // `cardPlan` keeps each page's card facts by path, mtime and size (the Mac's index gives a new mtime on each
    // write). With the stored file's mtime, the phone's due list kept the facts from before the answer.
    const t = await answersSetup()
    t.s.github.offline = true
    const s = sanitizeReviewSettings({})
    const index = t.engine.index()!
    const due = async () => cardPlan(Object.values((await t.answers.view(index)).records), s, Date.UTC(2026, 10, 14, 6, 30)).queue.map((c) => `${c.id}${c.isNew ? ' new' : ''}`)
    expect(await due()).toContain('NC-2 new')
    const first = (await t.answers.view(index)).records['a.md']
    await t.add(answer('NC-2', 1))
    const after = (await t.answers.view(index)).records['a.md']
    expect(after.mtime).not.toBe(first.mtime)
    expect(after.size).toBe(new TextEncoder().encode((await t.answers.text('a.md'))!).length)
    expect(await due()).not.toContain('NC-2 new')
    // The same text again: the same mtime (the cache hits); an Undo back to the stored text: the stored record.
    expect((await t.answers.view(index)).records['a.md'].mtime).toBe(after.mtime)
    await t.answers.undo(t.answers.waiting()[0].group)
    expect((await t.answers.view(index)).records['a.md']).toBe(index.records['a.md'])
    expect(await due()).toContain('NC-2 new')
  })

  it('after the send the stored copy holds the answer, and the view does not lose it at any point', async () => {
    const t = await answersSetup()
    await t.add(answer('NC-2', 1))
    await t.tick(SEND_AFTER_MS)
    expect((await t.store.read(VAULT, 'a.md'))!.content).toContain(`<!-- card: NC-2, ${at(1)} good -->`)
    expect(t.engine.index()!.records['a.md'].cards!.find((c) => c.id === 'NC-2')!.reviews).toHaveLength(1)
    expect(await t.answers.text('a.md')).toBe((await t.store.read(VAULT, 'a.md'))!.content)
  })
})

describe('errors: the answers stay', () => {
  it('401: "Sign in again" (red); no send on each poll; after the new token, sendNow sends them', async () => {
    let refuse = true
    const t = await answersSetup({ fetch: (s) => async (url, init) => (refuse && (init.method ?? 'GET') !== 'GET' ? new Response(JSON.stringify({ message: 'Bad credentials' }), { status: 401 }) : s.github.fetch(url, init)) })
    await t.add(answer('NC-2', 1))
    await t.tick(SEND_AFTER_MS)
    expect(t.answers.state()).toMatchObject({ waiting: 1, problem: 'UNAUTHORIZED' })
    const calls = t.s.github.calls.filter((c) => c.method !== 'GET').length
    await t.tick(POLL_MS * 4)
    expect(t.s.github.calls.filter((c) => c.method !== 'GET').length).toBe(calls)
    refuse = false
    await t.answers.sendNow()
    expect(t.answers.state()).toMatchObject({ waiting: 0, problem: null })
    expect(await t.remoteReviews()).toEqual([at(1)])
  })

  it('403 on the write (no write access): READ_ONLY, the answers stay, no repeat on each poll', async () => {
    const t = await answersSetup({ fetch: (s) => async (url, init) => ((init.method ?? 'GET') !== 'GET' ? new Response(JSON.stringify({ message: 'Resource not accessible by personal access token' }), { status: 403 }) : s.github.fetch(url, init)) })
    await t.add(answer('NC-2', 1))
    await t.tick(SEND_AFTER_MS)
    expect(t.answers.state()).toMatchObject({ waiting: 1, problem: 'READ_ONLY' })
    const writes = t.s.github.calls.filter((c) => c.method !== 'GET').length
    await t.tick(POLL_MS * 4)
    expect(t.s.github.calls.filter((c) => c.method !== 'GET').length).toBe(writes)
  })

  it('"slow down": it waits until the time GitHub gives, then sends', async () => {
    const t = await answersSetup()
    await t.add(answer('NC-2', 1))
    const until = Math.ceil((t.clock.now() + SEND_AFTER_MS + 120_000) / 1000)
    let limited = true
    t.s.github.interrupt = (call) =>
      limited && call.method !== 'GET' ? new Response(JSON.stringify({ message: 'API rate limit exceeded' }), { status: 403, headers: { 'x-ratelimit-remaining': '0', 'x-ratelimit-reset': String(until) } }) : undefined
    await t.tick(SEND_AFTER_MS)
    expect(t.answers.state()).toMatchObject({ waiting: 1, problem: 'RATE_LIMITED', retryAt: until * 1000 })
    limited = false
    await t.tick(until * 1000 - t.clock.now() - 1)
    expect(t.commits()).toBe(0)
    await t.tick(1)
    expect(t.commits()).toBe(1)
    expect(t.answers.state()).toMatchObject({ waiting: 0, problem: null, retryAt: null })
  })

  it('"slow down" again and again: each wait doubles (1, 2, 4 minutes), up to 1 hour, as the engine waits', async () => {
    const t = await answersSetup()
    await t.add(answer('NC-2', 1))
    t.s.github.interrupt = (call) => (call.method !== 'GET' ? new Response(JSON.stringify({ message: 'You have exceeded a secondary rate limit' }), { status: 403 }) : undefined)
    await t.tick(SEND_AFTER_MS)
    const waits: number[] = []
    for (let i = 0; i < 3; i++) {
      const { retryAt } = t.answers.state()
      waits.push(retryAt! - t.clock.now())
      await t.tick(retryAt! - t.clock.now())
    }
    expect(waits).toEqual([60_000, 120_000, 240_000])
    t.s.github.interrupt = null
    await t.tick(t.answers.state().retryAt! - t.clock.now())
    expect(t.answers.state()).toMatchObject({ waiting: 0, problem: null })
  })

  it('a new vault starts with no wait count (YAZ-5282)', async () => {
    const t = await answersSetup()
    await t.add(answer('NC-2', 1))
    t.s.github.interrupt = (call) => (call.method !== 'GET' ? new Response(JSON.stringify({ message: 'You have exceeded a secondary rate limit' }), { status: 403 }) : undefined)
    await t.tick(SEND_AFTER_MS)
    for (let i = 0; i < 3; i++) await t.tick(t.answers.state().retryAt! - t.clock.now())
    // The person opens another vault (none here), then this one again: a new start for the list.
    await t.engine.open(null)
    await t.answers.idle()
    await t.engine.open(VAULT_ROW)
    await t.engine.idle()
    // The list sends its waiting answer at once on the new start; GitHub still says "slow down": the first wait again.
    await t.answers.idle()
    const { problem, retryAt } = t.answers.state()
    expect(problem).toBe('RATE_LIMITED')
    expect(retryAt! - t.clock.now()).toBe(60_000)
  })

  it('a card that is gone: "1 answer could not be saved" with its title; the other answers go; Discard removes it', async () => {
    const t = await answersSetup()
    await t.add(answer('NC-2', 1))
    await t.add(answer('NC-3', 2))
    await t.s.git.push({ 'a.md': pageText('A', 'NC-1', ['NC-3']) })
    await t.tick(SEND_AFTER_MS)
    expect(await t.remoteReviews('a.md', 'NC-3')).toEqual([at(2)])
    const lost = t.answers.state().lost
    expect(lost).toMatchObject([{ op: answer('NC-2', 1), title: 'Title NC-2' }])
    expect(t.answers.state().waiting).toBe(0)
    expect(await t.answers.discard(lost[0].seq)).toBe(true)
    expect(t.answers.state().lost).toEqual([])
  })
})

describe('one send at a time, and never while a sync pass writes the store', () => {
  it('a pass is downloading: the send starts only after the pass has written its checkpoint', async () => {
    let gate: Promise<void> | null = null
    let open: () => void = () => {}
    const log: string[] = []
    const t = await answersSetup({
      fetch: (s) => async (url, init) => {
        const method = init.method ?? 'GET'
        if (method === 'GET' && url.includes('/git/blobs/') && gate !== null) await gate
        log.push(`${method} ${new URL(url).pathname.split('/git/')[1]}`)
        return s.github.fetch(url, init)
      },
    })
    const pushed = await t.s.git.push({ 'b.md': pageText('B', 'NC-4', ['NC-5']) })
    const bBlob = t.s.git.trees.get(t.s.git.commits.get(pushed)!.tree)!.get('b.md')!
    gate = new Promise((r) => (open = r))
    const pass = t.engine.syncNow()
    await new Promise((r) => setTimeout(r, 0))
    await t.add(answer('NC-2', 1))
    const send = t.answers.sendNow()
    for (let i = 0; i < 20; i++) await new Promise((r) => setTimeout(r, 0))
    expect(log.some((l) => l.startsWith('POST'))).toBe(false)
    open()
    gate = null
    await pass
    await send
    await t.answers.idle()
    const firstWrite = log.findIndex((l) => l.startsWith('POST'))
    expect(firstWrite).toBeGreaterThan(log.indexOf(`GET blobs/${bBlob}`))
    expect(log.indexOf(`GET blobs/${bBlob}`)).toBeGreaterThan(-1)
    expect(t.commits()).toBe(1)
  })
})

describe('the list survives a closed app', () => {
  it('answers made with no signal, the app closed: at the next start they are still there and go at once', async () => {
    const t = await answersSetup()
    t.s.github.offline = true
    await t.add(answer('NC-2', 1))
    t.answers.stop()
    t.engine.stop()
    t.s.github.offline = false
    // The next start: a new engine and a new list on the same store.
    const clock = fakeClock()
    const engine = createSyncEngine({ store: t.store, tokens: t.s.tokens, clock, yieldToUi: async () => {}, makeRemote: (v, token) => githubRemote(githubClient(token, { fetch: t.s.github.fetch, now: clock.now }), v.repo, v.branch) })
    const answers = createAnswers({ store: t.store, engine, clock, yieldToUi: async () => {} })
    await engine.open(VAULT_ROW)
    await engine.idle()
    await answers.idle()
    expect(t.commits()).toBe(1)
    expect(await t.remoteReviews()).toEqual([at(1)])
    expect(answers.state().waiting).toBe(0)
  })
})

describe('YAZ-5183: a branch that keeps moving', () => {
  it('the branch moves before every ref move for 2 minutes: the waits between sends grow, never over 80 writes in a minute, and the review lands once', async () => {
    let movesUntil = 0
    let moves = 0
    let clockNow = () => 0
    const t = await answersSetup({
      fetch: (s) => async (url, init) => {
        if ((init.method ?? 'GET') === 'PATCH' && clockNow() < movesUntil) {
          moves++
          await s.git.push({ [`mac-${moves}.md`]: `# ${moves}\n` })
        }
        return s.github.fetch(url, init)
      },
    })
    clockNow = () => t.clock.now()
    movesUntil = t.clock.now() + 120_000
    await t.add(answer('NC-2', 1))
    const writes = () => t.s.github.calls.filter((c) => c.method !== 'GET').length
    const samples: { at: number; writes: number }[] = []
    const waits: number[] = []
    for (let i = 0; i < 120; i++) {
      await t.tick(5_000)
      samples.push({ at: t.clock.now(), writes: writes() })
      const { retryAt, problem } = t.answers.state()
      if (problem === 'STALE_HEAD' && retryAt !== null && (waits.length === 0 || waits[waits.length - 1] !== retryAt)) waits.push(retryAt)
    }
    for (const a of samples) {
      const inMinute = samples.filter((b) => b.at > a.at && b.at <= a.at + 60_000).map((b) => b.writes)
      if (inMinute.length > 0) expect(Math.max(...inMinute) - a.writes).toBeLessThanOrEqual(80)
    }
    const gaps = waits.slice(1).map((w, i) => w - waits[i])
    expect(gaps.length).toBeGreaterThan(0)
    for (let i = 1; i < gaps.length; i++) expect(gaps[i]).toBeGreaterThan(gaps[i - 1])
    expect(await t.remoteReviews()).toEqual([at(1)])
    expect(t.answers.state()).toMatchObject({ waiting: 0, problem: null })
  })
})

describe('YAZ-5073 checker gap 7: a send that needs the person does not repeat by itself', () => {
  for (const [status, code] of [[401, 'UNAUTHORIZED'], [403, 'READ_ONLY']] as const) {
    it(`${status} (${code}): the app hidden or the signal back does not send again; only sendNow does`, async () => {
      let tries = 0
      const t = await answersSetup({ fetch: (s) => async (url, init) => ((init.method ?? 'GET') !== 'GET' ? (tries++, new Response(JSON.stringify({ message: 'no' }), { status })) : s.github.fetch(url, init)) })
      await t.add(answer('NC-2', 1))
      await t.tick(SEND_AFTER_MS)
      expect(t.answers.state().problem).toBe(code)
      const writes = tries
      expect(writes).toBe(1)
      t.answers.online()
      t.answers.setVisible(false)
      t.answers.setVisible(true)
      await t.answers.idle()
      expect(tries).toBe(writes)
      await t.answers.sendNow()
      expect(tries).toBeGreaterThan(writes)
    })
  }
})

