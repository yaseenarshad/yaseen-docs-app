import { describe, expect, it } from 'vitest'
import { answer, answersSetup } from '../answers/testing'
import { REQUEST_TIMEOUT_MS } from '../github/client'
import { POLL_MS, SEND_AFTER_MS } from '../sync/cadence'
import { answersPart, syncDot } from './dot'

/**
 * Each change of the dot, driven by 3B's real engine and 3C's real answer list on the fake GitHub (fake clock). The
 * test records each new colour and words, as the person sees them in the top bar.
 */
async function watch(options: Parameters<typeof answersSetup>[0] = {}) {
  const t = await answersSetup(options)
  let online = true
  const seen: string[] = []
  const look = () => {
    const d = syncDot({ sync: t.engine.state(), answers: answersPart(t.answers.state(), t.answers.waiting()), online, token: { kind: 'none' } })
    const now = `${d.state} ${d.words}`
    if (seen.at(-1) !== now) seen.push(now)
  }
  t.engine.subscribe(look)
  t.answers.subscribe(look)
  look()
  return {
    ...t,
    seen,
    look,
    setOnline(on: boolean) {
      online = on
      look()
    },
  }
}

describe('the dot follows the engine and the answer list (decision 12)', () => {
  it('an answer: green → amber "1 answer waiting" → blue while it sends → green', async () => {
    const t = await watch()
    await t.add(answer('NC-2', 1))
    await t.tick(SEND_AFTER_MS)
    expect(t.seen).toEqual(['synced Synced', 'pending 1 answer waiting', 'syncing Syncing…', 'synced Synced'])
    expect(t.commits()).toBe(1)
  })

  it('an answer of a card that was Up next is ONE answer (two card actions)', async () => {
    const t = await watch()
    await t.answers.add([
      { op: { kind: 'next', id: 'NC-2', on: false }, path: 'a.md', title: 'Title NC-2' },
      { op: answer('NC-2', 1), path: 'a.md', title: 'Title NC-2' },
    ])
    expect(t.answers.waiting()).toHaveLength(2)
    expect(t.seen.at(-1)).toBe('pending 1 answer waiting')
    await t.add(answer('NC-3', 2))
    expect(t.seen.at(-1)).toBe('pending 2 answers waiting')
  })

  it('the signal goes with nothing waiting: grey "No signal"; it comes back: blue, then green', async () => {
    const t = await watch()
    t.s.github.offline = true
    await t.tick(POLL_MS)
    expect(t.seen.at(-1)).toBe('off No signal')
    t.s.github.offline = false
    await t.tick(POLL_MS)
    expect(t.seen.slice(-3)).toEqual(['off No signal', 'syncing Syncing…', 'synced Synced'])
  })

  it('the phone says it is offline before the engine knows: grey at once', async () => {
    const t = await watch()
    t.setOnline(false)
    expect(t.seen).toEqual(['synced Synced', 'off No signal'])
    t.setOnline(true)
    expect(t.seen.at(-1)).toBe('synced Synced')
  })

  it('the signal goes with answers waiting: amber with both; it comes back: the answers go, then green', async () => {
    const t = await watch()
    t.s.github.offline = true
    t.setOnline(false)
    await t.add(answer('NC-2', 1))
    await t.add(answer('NC-3', 1))
    await t.tick(SEND_AFTER_MS)
    expect(t.seen.at(-1)).toBe('pending 2 answers waiting · no signal')
    // Once an answer waits, the dot is never a plain grey: the person sees that answers wait.
    expect(t.seen).toEqual(['synced Synced', 'off No signal', 'pending 1 answer waiting · no signal', 'pending 2 answers waiting · no signal'])
    t.s.github.offline = false
    t.setOnline(true)
    t.answers.online()
    await t.tick(0)
    expect(t.seen.slice(-3)).toEqual(['pending 2 answers waiting', 'syncing Syncing…', 'synced Synced'])
    expect(t.answers.waiting()).toHaveLength(0)
  })

  it('401: red "Sign in again", the answers stay; after a new token, blue then green, and the answers go', async () => {
    const t = await watch()
    t.s.github.interrupt = () => new Response(JSON.stringify({ message: 'Bad credentials' }), { status: 401 })
    await t.add(answer('NC-2', 1))
    await t.tick(SEND_AFTER_MS)
    await t.tick(POLL_MS)
    expect(t.seen.at(-1)).toBe('attention Sign in again')
    expect(t.answers.waiting()).toHaveLength(1)
    // "Sign in again" (N6): the new token is stored, then the engine syncs and the list sends (3C's result comment).
    t.s.github.interrupt = null
    await t.engine.syncNow()
    await t.answers.sendNow()
    await t.tick(0)
    expect(t.seen.slice(-2)).toEqual(['syncing Syncing…', 'synced Synced'])
    expect(t.answers.waiting()).toHaveLength(0)
  })

  it('"slow down" (round 10 item 20): amber while the app waits, never red; then green at GitHub\'s time', async () => {
    const t = await watch()
    const until = Math.floor(t.clock.now() / 1000) + 120
    t.s.github.rateLimitedUntil = until
    await t.tick(POLL_MS)
    expect(t.seen.at(-1)).toBe('pending Waiting for GitHub')
    await t.add(answer('NC-2', 1))
    expect(t.seen.at(-1)).toBe('pending 1 answer waiting')
    t.s.github.rateLimitedUntil = null
    await t.tick(130_000)
    await t.tick(SEND_AFTER_MS)
    expect(t.seen.at(-1)).toBe('synced Synced')
    expect(t.seen.some((s) => s.startsWith('attention'))).toBe(false)
  })

  it('a request that hangs (YAZ-5173): blue, then grey after the time limit; a pull to refresh gives green', async () => {
    let hang = false
    const t = await watch({ fetch: (s) => (url, init) => (hang ? new Promise<Response>(() => {}) : s.github.fetch(url, init)) })
    hang = true
    t.clock.advance(POLL_MS)
    await new Promise((r) => setTimeout(r, 0))
    expect(t.seen.at(-1)).toBe('syncing Syncing…')
    for (let i = 0; i < 3; i++) t.clock.advance(REQUEST_TIMEOUT_MS)
    await new Promise((r) => setTimeout(r, 10))
    expect(t.seen.at(-1)).toBe('off No signal')
    hang = false
    await t.engine.syncNow()
    expect(t.seen.at(-1)).toBe('synced Synced')
  })

  it('a lost answer (round 12 item 9): amber "1 answer could not be saved" until it is discarded', async () => {
    const t = await watch()
    await t.add({ kind: 'review', id: 'NC-404', review: { at: '2026-11-14T06:01Z', rating: 'good' } })
    await t.tick(SEND_AFTER_MS)
    expect(t.seen.at(-1)).toBe('pending 1 answer could not be saved')
    await t.tick(POLL_MS * 3)
    expect(t.seen.at(-1)).toBe('pending 1 answer could not be saved')
    for (const lost of t.answers.state().lost) await t.answers.discard(lost.seq)
    expect(t.seen.at(-1)).toBe('synced Synced')
  })
})
