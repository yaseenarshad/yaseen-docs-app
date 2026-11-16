// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { NOW, cardBlock, page, reviewSetup, type ReviewHarness } from './testing'

/**
 * YAZ-5503/5505: Review's ⋯ holds the shared card actions (Up next, Archive card, Fix later, Title on the front), each
 * with two taps. One tap on Archive card only arms it ("Tap again to archive"): the card stays, nothing waits to send.
 * The second tap archives it. "Undo last answer" stays first and "Open page" last.
 */
let h: ReviewHarness | undefined
beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(NOW)
})
afterEach(() => {
  h?.unmount()
  vi.useRealTimers()
})
const OLD = '2026-10-04T09:00:00.000Z good'
const FILES = { '.yaseendocs/review.json': '{}', 'p.md': page('P', ...[1, 2].map((n) => cardBlock(`Q${n}?\n---\n{{w${n}}}`, `TT-${n}, ${OLD}`))) }
const rows = (hh: ReviewHarness) => [...hh.host.querySelectorAll('.review__menu--more [role="menuitem"]')].map((b) => (b.textContent ?? '').replace(/\s+/g, ' ').trim())

describe("Review's ⋯ card actions (YAZ-5505)", () => {
  it('Archive card needs two taps: the first arms it, the second archives', async () => {
    h = await reviewSetup(FILES)
    expect(h.head()).toBe('TT-1')
    await h.click('More card actions')
    await h.click('Archive card', { once: true })
    expect(rows(h)[0]).toBe('Undo last answer')
    expect(rows(h).at(-1)).toBe('Open page')
    expect(rows(h)).toContain('Tap again to archive')
    // One tap: nothing done.
    expect(h.head()).toBe('TT-1')
    expect(h.answers.waiting()).toHaveLength(0)
    await h.click('Tap again to archive')
    expect(h.head()).toBe('TT-2')
    expect(h.last()).toBe('Archived↶ Undo')
    expect(h.answers.waiting().map((w) => w.op.kind)).toEqual(['off'])
  })
})
