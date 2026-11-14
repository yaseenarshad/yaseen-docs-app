import { afterEach, describe, expect, it } from 'vitest'
import { cardRecords } from '@shared/cardLine'
import { SEND_AFTER_MS } from '../sync/cadence'
import { BRANCH, VAULT, card, pageText } from '../sync/testing'
import { ANSWERS_STATE, openOutbox } from './outbox'
import { applyOps, type CardOp } from './ops'
import { openPhoneDays, phoneReviewHost } from './reviewHost'
import { answer, answersSetup, at } from './testing'

// Checker probes for YAZ-5073, round 2 (after YAZ-5180..5184). Each 3C-x test names a bug; the others are probes that pass.

type Setup = Awaited<ReturnType<typeof answersSetup>>
const tick0 = () => new Promise((r) => setTimeout(r, 0))
const fileAt = async (t: Setup, path = 'a.md') => (await t.s.git.filesAt(t.head()))[path]
const reviewsOf = async (t: Setup, id = 'NC-2', path = 'a.md') => cardRecords(await fileAt(t, path)).find((c) => c.id === id)!.reviews
const withLine = (line: string) => ({ 'a.md': pageText('A', 'NC-1', ['NC-3']).replace('# A\n\n', `# A\n\n${card('NC-2').replace('<!-- card: NC-2 -->', line)}\n\n`) })
const hostOf = async (t: Setup) => phoneReviewHost({ answers: t.answers, days: await openPhoneDays(t.store, VAULT, t.clock.now), vaultName: () => 'v' })
const isWrite = (init: RequestInit) => (init.method ?? 'GET') !== 'GET'

describe('checker round 2: "tried" marks', () => {
  it('probe: killed after "tried" is stored, before the commit: Undo sends unreview; the file ends byte for byte as before; the older review stays', async () => {
    let failWrites = true
    const files = withLine(`<!-- card: NC-2, ${at(0)} good -->`)
    const t = await answersSetup({
      files,
      fetch: (s) => async (url, init) => {
        if (isWrite(init) && failWrites) throw new TypeError('Load failed') // the app dies before any write lands
        return s.github.fetch(url, init)
      },
    })
    const before = await fileAt(t)
    const host = await hostOf(t)
    const R = { at: at(1), rating: 'good' as const }
    const next = await host.writeCardAnswer('a.md', 'NC-2', R)
    await t.tick(SEND_AFTER_MS)
    expect(t.answers.waiting().every((w) => w.tried === true)).toBe(true)
    // A restart: a new list reads the stored one; the tried mark is kept.
    expect((await openOutbox(t.store, VAULT)).waiting().some((w) => w.tried === true)).toBe(true)
    await host.undoCardAnswer('a.md', 'NC-2', R.at, next)
    expect(t.answers.waiting().map((w) => w.op.kind)).toEqual(['review', 'unreview'])
    failWrites = false
    const commitsBefore = t.commits()
    await t.answers.sendNow()
    await t.tick(SEND_AFTER_MS)
    expect(await fileAt(t)).toBe(before)
    expect(t.commits() - commitsBefore).toBe(0) // nothing to write: a clean no-op
    expect(t.answers.waiting()).toEqual([])
    expect((await host.readCard('a.md', 'NC-2'))!.reviews.map((r) => r.at)).toEqual([at(0)])
  })

  it('probe: killed after the commit, before the ref moved: Undo; GitHub ends with no new review', async () => {
    let dropPatch = true
    const t = await answersSetup({
      fetch: (s) => async (url, init) => {
        if ((init.method ?? 'GET') === 'PATCH' && dropPatch) {
          dropPatch = false
          throw new TypeError('Load failed') // the PATCH never left the phone
        }
        return s.github.fetch(url, init)
      },
    })
    const host = await hostOf(t)
    const R = { at: at(1), rating: 'good' as const }
    const next = await host.writeCardAnswer('a.md', 'NC-2', R)
    await t.tick(SEND_AFTER_MS)
    await host.undoCardAnswer('a.md', 'NC-2', R.at, next)
    await t.answers.sendNow()
    await t.tick(SEND_AFTER_MS)
    expect(await t.remoteReviews()).toEqual([])
    expect(t.answers.waiting()).toEqual([])
  })

  for (const [status, body] of [
    [401, { message: 'Bad credentials' }],
    [403, { message: 'Resource not accessible by personal access token' }],
  ] as const) {
    it(`probe: a ${status} on the commit: the action stays tried; Undo, then a new sign-in: GitHub unchanged, list empty`, async () => {
      let refuse = true
      const t = await answersSetup({
        fetch: (s) => async (url, init) => {
          if (isWrite(init) && refuse) return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
          return s.github.fetch(url, init)
        },
      })
      const before = await fileAt(t)
      const host = await hostOf(t)
      const R = { at: at(1), rating: 'good' as const }
      const next = await host.writeCardAnswer('a.md', 'NC-2', R)
      await t.tick(SEND_AFTER_MS)
      expect(t.answers.state().problem).not.toBeNull()
      await host.undoCardAnswer('a.md', 'NC-2', R.at, next)
      refuse = false
      await t.answers.sendNow()
      await t.tick(SEND_AFTER_MS)
      expect(await fileAt(t)).toBe(before)
      expect(t.answers.waiting()).toEqual([])
      // A later answer is a normal unsent answer again: its Undo removes it with no write.
      const R2 = { at: at(5), rating: 'good' as const }
      const n2 = await host.writeCardAnswer('a.md', 'NC-2', R2)
      await host.undoCardAnswer('a.md', 'NC-2', R2.at, n2)
      expect(t.answers.waiting()).toEqual([])
    })
  }

  it('probe: Undo two times of a tried answer; an older review of another minute stays', async () => {
    let dropPatchAnswer = true
    const t = await answersSetup({
      files: withLine(`<!-- card: NC-2, ${at(0)} good -->`),
      fetch: (s) => async (url, init) => {
        const res = await s.github.fetch(url, init)
        if ((init.method ?? 'GET') === 'PATCH' && dropPatchAnswer) {
          dropPatchAnswer = false
          throw new TypeError('Load failed')
        }
        return res
      },
    })
    const host = await hostOf(t)
    const R = { at: at(1), rating: 'good' as const }
    const next = await host.writeCardAnswer('a.md', 'NC-2', R)
    await t.tick(SEND_AFTER_MS)
    await host.undoCardAnswer('a.md', 'NC-2', R.at, next)
    await host.undoCardAnswer('a.md', 'NC-2', R.at, next)
    await t.answers.sendNow()
    await t.tick(SEND_AFTER_MS)
    expect(await t.remoteReviews()).toEqual([at(0)])
  })

  it('probe: Undo of a tried answer, then the same answer again in the same minute: one review', async () => {
    let dropPatchAnswer = true
    const t = await answersSetup({
      fetch: (s) => async (url, init) => {
        const res = await s.github.fetch(url, init)
        if ((init.method ?? 'GET') === 'PATCH' && dropPatchAnswer) {
          dropPatchAnswer = false
          throw new TypeError('Load failed')
        }
        return res
      },
    })
    const host = await hostOf(t)
    const R = { at: at(1), rating: 'good' as const }
    const next = await host.writeCardAnswer('a.md', 'NC-2', R)
    await t.tick(SEND_AFTER_MS)
    await host.undoCardAnswer('a.md', 'NC-2', R.at, next)
    await host.writeCardAnswer('a.md', 'NC-2', R)
    await t.answers.sendNow()
    await t.tick(SEND_AFTER_MS)
    expect(await t.remoteReviews()).toEqual([at(1)])
  })

  it('probe: Archive during a send, then un-archive: GitHub ends with no `off`', async () => {
    let release: () => void = () => {}
    let holding = false
    let hold = true
    const t = await answersSetup({
      fetch: (s) => async (url, init) => {
        if ((init.method ?? 'GET') === 'PATCH' && hold) {
          hold = false
          holding = true
          await new Promise<void>((r) => (release = r))
        }
        return s.github.fetch(url, init)
      },
    })
    const host = await hostOf(t)
    const { withCardOff } = await import('@shared/cardLine')
    await host.changeCardLine('a.md', 'NC-2', (l) => withCardOff(l, true))
    t.clock.advance(SEND_AFTER_MS)
    for (let i = 0; i < 200 && !holding; i++) await tick0()
    await host.changeCardLine('a.md', 'NC-2', (l) => withCardOff(l, false))
    release()
    await t.answers.idle()
    await t.tick(SEND_AFTER_MS * 2)
    expect(cardRecords(await fileAt(t)).find((c) => c.id === 'NC-2')!.off).toBeFalsy()
  })
})

describe('checker round 2: a review is named by its minute and its rating', () => {
  // STOPPED (YAZ-5198): the Mac's own merge rule (`uniteCardLines`, decision 5) keeps two reviews with one time and one
  // rating as ONE when only one side holds both. So "two identical reviews are two" is a decision for Yaseen (note on
  // YAZ-5057, "For Yaseen: two identical reviews in one minute"). Turn this test on when he decides.
  it.skip('3C-D: two "again" answers to one card in one minute, Undo of the second after its send: GitHub must keep the first', async () => {
    const t = await answersSetup()
    const host = await hostOf(t)
    const A = { at: at(1), rating: 'again' as const }
    // A Forgot puts the card back at the end of the session (YAZ-5020): in a short session it shows again at once.
    await host.writeCardAnswer('a.md', 'NC-2', A)
    const n2 = await host.writeCardAnswer('a.md', 'NC-2', { ...A })
    await t.tick(SEND_AFTER_MS) // sent
    await host.undoCardAnswer('a.md', 'NC-2', A.at, n2) // Undo of the SECOND answer only
    await t.tick(SEND_AFTER_MS)
    // Expected: the first answer stays (the person undid one answer of two).
    expect({ github: await t.remoteReviews(), phone: (await host.readCard('a.md', 'NC-2'))!.reviews.length }).toEqual({ github: [at(1)], phone: 1 })
  })

  it('probe: the Mac wrote the same review twice in one minute; one unreview sent two times takes ONE', () => {
    const page = withLine(`<!-- card: NC-2, ${at(1)} again 3s, ${at(1)} again 4s -->`)['a.md']
    const op: CardOp = { kind: 'unreview', id: 'NC-2', at: at(1), rating: 'again' }
    const once = applyOps(page, [op]).content
    const twice = applyOps(once, [op]).content
    console.log('Mac duplicates, unreview x1:', cardRecords(once).find((c) => c.id === 'NC-2')!.reviews.length, 'x2:', cardRecords(twice).find((c) => c.id === 'NC-2')!.reviews.length)
  })

  it('probe: delete review uses the parsed line: the time with seconds (`12s`) and the rating name exactly that review', async () => {
    const t = await answersSetup({ files: withLine(`<!-- card: NC-2, ${at(1)} hard 12s, ${at(1)} good 7s -->`) })
    const host = await hostOf(t)
    await host.deleteCardReview('a.md', 'NC-2', at(1)) // the last at 06:01: "good"
    await t.tick(SEND_AFTER_MS)
    await t.answers.sendNow()
    expect(await reviewsOf(t)).toEqual([{ at: at(1), rating: 'hard', seconds: 12 }])
  })

  it('probe: a list stored before YAZ-5181 (an `unreview` with no rating) loads and sends; no crash', async () => {
    const t0 = await answersSetup({ files: withLine(`<!-- card: NC-2, ${at(0)} good, ${at(1)} good -->`) })
    await t0.store.setState(VAULT, ANSWERS_STATE, { v: 1, next: 2, waiting: [{ seq: 1, group: 1, op: { kind: 'unreview', id: 'NC-2', at: at(1) }, path: 'a.md', title: 'x', madeAt: 0 }], lost: [] })
    const box = await openOutbox(t0.store, VAULT)
    expect(box.waiting()).toHaveLength(1)
    // Use the stored list through a fresh `createAnswers`.
    const { createAnswers } = await import('./answers')
    const answers = createAnswers({ store: t0.store, engine: t0.engine, clock: t0.clock, yieldToUi: async () => {} })
    await answers.idle()
    await t0.tick(SEND_AFTER_MS)
    await answers.idle()
    expect(await t0.remoteReviews()).toEqual([at(0)])
    answers.stop()
  })
})

describe('checker round 2: the Web Lock', () => {
  const g = globalThis as { navigator?: { locks?: unknown } }
  const saved = g.navigator?.locks
  afterEach(() => {
    if (g.navigator) (g.navigator as { locks?: unknown }).locks = saved
  })
  /** A fake of `navigator.locks`: one holder per name, FIFO; records the order of names held at once. */
  function installLocks() {
    const queues = new Map<string, Promise<unknown>>()
    const held = new Set<string>()
    const nested: string[] = []
    const locks = {
      request<T>(name: string, fn: () => Promise<T>): Promise<T> {
        const run = (queues.get(name) ?? Promise.resolve()).then(async () => {
          if (held.size > 0) nested.push(`${[...held].join('+')} -> ${name}`)
          held.add(name)
          try {
            return await fn()
          } finally {
            held.delete(name)
          }
        })
        queues.set(name, run.catch(() => undefined))
        return run
      },
    }
    if (!g.navigator) Object.defineProperty(globalThis, 'navigator', { value: {}, configurable: true, writable: true })
    Object.defineProperty(g.navigator!, 'locks', { value: locks, configurable: true, writable: true })
    return { nested }
  }

  it('probe: with Web Locks, two tabs add at once: both stay; a send under the engine lane takes the list lock inside it, never the other way', async () => {
    const { nested } = installLocks()
    const t = await answersSetup()
    const a = await openOutbox(t.store, VAULT)
    const b = await openOutbox(t.store, VAULT)
    await Promise.all([a.add([{ op: answer('NC-2', 1), path: 'a.md', title: 'x' }], 1), b.add([{ op: answer('NC-3', 2), path: 'a.md', title: 'y' }], 2)])
    expect((await openOutbox(t.store, VAULT)).waiting().map((w) => w.op.id).sort()).toEqual(['NC-2', 'NC-3'])
    await t.add(answer('NC-2', 3))
    await t.tick(SEND_AFTER_MS)
    console.log('locks held at once:', [...new Set(nested)].join(' | ') || 'none')
    for (const n of nested) expect(n.startsWith('notecards-answers:')).toBe(false) // never list -> sync
  })
})

describe('checker round 2: the backoff on a branch that keeps moving', () => {
  it('probe: 20 answers during the wait go in the next try, in ONE commit, in order; hidden and signal-back do not send early; after a good send the wait starts at 1 minute again', async () => {
    let moving = true
    let moves = 0
    const t = await answersSetup({
      fetch: (s) => async (url, init) => {
        if ((init.method ?? 'GET') === 'PATCH' && moving) await s.git.push({ [`mac-${++moves}.md`]: `# ${moves}\n` })
        return s.github.fetch(url, init)
      },
    })
    await t.add(answer('NC-2', 1))
    await t.tick(SEND_AFTER_MS)
    expect(t.answers.state().problem).toBe('STALE_HEAD')
    const retryAt = t.answers.state().retryAt!
    expect(retryAt - t.clock.now()).toBe(60_000)
    const writes = () => t.s.github.calls.filter((c) => c.method !== 'GET').length
    const w0 = writes()
    moving = false
    for (let i = 0; i < 20; i++) {
      await t.add(answer(i % 2 === 0 ? 'NC-3' : 'NC-1', 10 + i))
      await t.tick(1000)
    }
    t.answers.setVisible(false)
    t.answers.online()
    await t.tick(10)
    expect(writes()).toBe(w0) // still waiting
    const c0 = t.commits()
    await t.tick(retryAt - t.clock.now() + 1)
    expect(t.commits() - c0).toBe(1)
    expect(t.answers.waiting()).toEqual([])
    const nc3 = cardRecords(await fileAt(t)).find((c) => c.id === 'NC-3')!.reviews.map((r) => r.at)
    expect(nc3).toEqual([...nc3].sort())
    expect(nc3).toHaveLength(10)
    // The branch moves again: the wait starts again at 1 minute.
    moving = true
    await t.add(answer('NC-2', 40))
    await t.tick(SEND_AFTER_MS)
    expect(t.answers.state().problem).toBe('STALE_HEAD')
    expect(t.answers.state().retryAt! - t.clock.now()).toBe(60_000)
  })
})
