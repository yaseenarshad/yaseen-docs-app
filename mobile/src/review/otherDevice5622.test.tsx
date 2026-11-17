// @vitest-environment jsdom
import { act } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { answersSetup } from '../answers/testing'
import { NOW, inOrder, cardBlock, mountReview, page, reviewSetup, type ReviewHarness } from './testing'

/**
 * YAZ-5622 (audit item 6): a card answered on the Mac while the phone's session is open leaves the phone's session as
 * soon as the sync pass brings the Mac's answer: "N / M" counts it no more, and the phone never shows it again, so it
 * never gets a second review. A session opened after the pass never takes it. The same rule runs on the Mac (the
 * shared `useCardReview`, `useCardReview.host.test.tsx`). Made-up cards; the real engine and list on the fake GitHub.
 */
/** Known cards, out of their steps, due today. */
const OLD = '2026-09-01T09:00:00.000Z good, 2026-09-01T09:01:00.000Z good'
const card = (n: number, more = '') => cardBlock(`Q${n}?\n---\n{{w${n}}}`, `OD-${n}, ${inOrder(OLD, n - 1)}${more}`)
const files = (two = '') => ({ '.yaseendocs/review.json': '{}', 'a.md': page('A', card(1), card(2, two), card(3)) })
/** The Mac's ✓ on OD-2, a minute ago. */
const MAC = `, ${new Date(NOW - 60_000).toISOString()} good`

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

const showing = () => (h!.host.querySelector('.review__card') === null ? null : /OD-\d/.exec(h!.head())?.[0])
const place = () => /(\d+) \/ (\d+)/.exec(h!.text())?.slice(1).map(Number)
/** The sync pass that brings the Mac's commit. */
const pull = async () => {
  await act(async () => {
    await h!.engine.syncNow()
    await h!.engine.idle()
  })
  await h!.settle()
}

describe('YAZ-5622: a card answered on the Mac', () => {
  it('mid-session: out of "done / total" at once, and the phone never shows it', async () => {
    h = await reviewSetup(files())
    expect(showing()).toBe('OD-1')
    expect(place()).toEqual([0, 3])
    await h.s.git.push({ 'a.md': page('A', card(1), card(2, MAC), card(3)) })
    await pull()
    expect(showing()).toBe('OD-1')
    expect(place()).toEqual([0, 2])
    await h.click('Remembered')
    expect(showing()).toBe('OD-3')
    expect(place()).toEqual([1, 2])
    await h.click('Remembered')
    expect(showing()).toBeNull()
  })

  it('the card on show: the next card takes its place', async () => {
    h = await reviewSetup(files())
    expect(showing()).toBe('OD-1')
    // Timed (` 6s`): a file of another size than the other tests' (the plan's facts are kept by path, mtime and size).
    await h.s.git.push({ 'a.md': page('A', card(1, `${MAC} 6s`), card(2), card(3)) })
    await pull()
    expect(showing()).toBe('OD-2')
    expect(place()).toEqual([0, 2])
  })

  it('between sessions: a session opened after the pass never takes it', async () => {
    const t = await answersSetup({ files: files() })
    await t.s.git.push({ 'a.md': page('A', card(1), card(2, MAC), card(3)) })
    await t.engine.syncNow()
    await t.engine.idle()
    h = await mountReview(t)
    expect(showing()).toBe('OD-1')
    expect(place()).toEqual([0, 2])
    await h.click('Remembered')
    expect(showing()).toBe('OD-3')
  })
})
