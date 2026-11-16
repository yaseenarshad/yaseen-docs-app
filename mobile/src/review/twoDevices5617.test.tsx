// @vitest-environment jsdom
import { act } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { BRANCH } from '../sync/testing'
import { NOW, cardBlock, page, reviewSetup, type ReviewHarness } from './testing'

/**
 * YAZ-5617 (review check e): two devices and sync DURING a review, on the phone: the real Review screen, engine and
 * answer list on the fake GitHub; the Mac's commits land there while the phone's session is open. The rules (YAZ-5611):
 * each answer is on GitHub ONE time and none is lost (spec 24, the merge rule YAZ-5088); a card the Mac finished
 * leaves the phone's session and never shows again (spec 10, YAZ-5622); "N / M" counts the cards left (spec 13);
 * Undo takes back only the phone's answer (spec 18). The Mac's side: `client/src/review/twoDevices5617.test.tsx`.
 * Made-up cards only.
 */
/** Known cards, out of their steps, due today. */
const OLD = '2026-09-01T09:00:00.000Z good, 2026-09-01T09:01:00.000Z good'
const card = (n: number, more = '') => cardBlock(`Q${n}?\n---\n{{w${n}}}`, `TD-${n}, ${OLD}${more}`)
const FILES = { '.yaseendocs/review.json': '{}', 'a.md': page('A', card(1), card(2), card(3)) }
/** The Mac's answer, `ago` ms before now. */
const mac = (rating: 'good' | 'again', ago = 60_000) => `, ${new Date(NOW - ago).toISOString()} ${rating}`

let h: ReviewHarness | undefined
beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(NOW)
  window.matchMedia = ((q: string) => ({ matches: false, media: q, addEventListener() {}, removeEventListener() {} })) as unknown as typeof window.matchMedia
})
afterEach(() => {
  h?.unmount()
  h = undefined
  vi.useRealTimers()
})
vi.mock('@client/review/confetti', () => ({ confettiBurst: () => () => undefined }))

const showing = () => (h!.host.querySelector('.review__card') === null ? null : /TD-\d/.exec(h!.head())?.[0])
const place = () => /(\d+) \/ (\d+)/.exec(h!.text())?.slice(1).map(Number)
/** The sync pass that brings the Mac's commit. */
const pull = async () => {
  await act(async () => {
    await h!.engine.syncNow()
    await h!.engine.idle()
  })
  await h!.settle()
}
/** The reviews of each card on GitHub now, after the known two: `[time, rating]`. */
const remote = async () => {
  const out: Record<string, string[]> = {}
  for (const [id, line] of Object.entries(await h!.remoteLines())) out[id] = line.replace(/^<!-- card: TD-\d+, /, '').replace(/ -->$/, '').split(', ').slice(2).map((r) => r.split(' ').slice(1, 2).join(''))
  return out
}

describe('YAZ-5617 phone: the Mac answers while the phone reviews', () => {
  it('both devices answer the SAME card before either syncs: GitHub keeps both answers, once each; the Mac`s other card leaves the session', async () => {
    h = await reviewSetup(FILES)
    expect(showing()).toBe('TD-1')
    await h.click('Remembered')
    expect(showing()).toBe('TD-2')
    // The Mac answered TD-1 and TD-3 while the phone was offline; its commit lands before the phone sends.
    await h.s.git.push({ 'a.md': page('A', card(1, mac('good')), card(2), card(3, mac('good'))) })
    await h.wait(5_000)
    await pull()
    expect(await remote()).toEqual({ 'TD-1': ['good', 'good'], 'TD-2': [], 'TD-3': ['good'] })
    // The phone's answer and the Mac's: two different times.
    const line = (await h.remoteLines())['TD-1']
    expect(new Set(line.match(/\d{4}-\d\d-\d\dT[\d:.]+Z/g)).size).toBe(4)
    expect(showing()).toBe('TD-2')
    expect(place()).toEqual([2, 2])
    await h.click('Remembered')
    expect(showing()).toBeNull()
    await h.wait(5_000)
    await pull()
    expect(await remote()).toEqual({ 'TD-1': ['good', 'good'], 'TD-2': ['good'], 'TD-3': ['good'] })
  })

  it('a ✕ on the Mac keeps the card due: the phone still shows it, and its answer is kept with the Mac`s', async () => {
    h = await reviewSetup(FILES)
    await h.s.git.push({ 'a.md': page('A', card(1), card(2, mac('again')), card(3)) })
    await pull()
    expect(place()).toEqual([1, 3])
    await h.click('Remembered')
    expect(showing()).toBe('TD-2')
    await h.click('Remembered')
    await h.wait(5_000)
    await pull()
    expect((await remote())['TD-2']).toEqual(['again', 'good'])
  })

  it('Undo on the phone after the Mac answered the same card: only the phone`s answer goes, and the card does not come back', async () => {
    h = await reviewSetup(FILES)
    await h.click('Remembered')
    expect(showing()).toBe('TD-2')
    await h.wait(5_000)
    expect((await remote())['TD-1']).toEqual(['good'])
    // The Mac answers TD-1 too (its own session), after the phone's send.
    await h.s.git.push({ 'a.md': (await h.s.git.filesAt(h.s.git.branches.get(BRANCH)!))['a.md'].replace(/(TD-1, [^>]*?) -->/, `$1${mac('good', -1_000)} -->`) })
    await pull()
    expect((await remote())['TD-1']).toEqual(['good', 'good'])
    await h.click('Undo')
    // The Mac finished it: the phone does not ask for it again.
    expect(showing()).toBe('TD-2')
    await h.wait(5_000)
    await pull()
    const line = (await h.remoteLines())['TD-1']
    expect((await remote())['TD-1']).toEqual(['good'])
    expect(line).toContain(new Date(NOW + 1_000).toISOString())
  })
})
