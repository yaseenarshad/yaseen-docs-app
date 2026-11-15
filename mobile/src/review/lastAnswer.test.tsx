// @vitest-environment jsdom
import { act } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { UNDO_SHOWN_MS } from './words'
import { NOW, cardBlock, page, reviewSetup, type ReviewHarness } from './testing'

/**
 * YAZ-5500 (Yaseen's pick: A, text only): after an answer, the hint line under the card says "Last: <title> (Forgot)"
 * or "(Remembered)"; the ID when the card has no title. No ✕ or ✓ and no colour cue. It shows once the 4-second
 * "↶ Undo" has gone (YAZ-5415 round 5, YAZ-5502), stays until the next answer, is one line cut with "…", and a tap on it
 * never steps the card. The real engine and answer list (`testing.ts`). Made-up data only.
 */
const OLD = '2026-10-02T09:00Z good, 2026-10-12T09:00Z good'
const FILES = {
  '.yaseendocs/review.json': '{}',
  'capitals.md': page(
    'Capitals',
    cardBlock('What is the capital of Spain?\n---\n{{Madrid}}', `CAP-1, title "Capital of Spain", ${OLD}`),
    cardBlock('A card with no title?\n---\n{{yes}} and {{no}}', `CAP-2, ${OLD}`),
    cardBlock('Third?\n---\n{{three}}', `CAP-3, ${OLD}`),
  ),
}

let h: ReviewHarness | undefined
beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(NOW)
})
afterEach(() => {
  h?.unmount()
  h = undefined
  vi.useRealTimers()
})

const q = (sel: string) => h!.host.querySelector<HTMLElement>(sel)
const hint = () => (q('.review__hint')?.textContent ?? '').replace(/\s+/g, ' ').trim()
const real = (ms: number) => act(async () => void (await new Promise((r) => setTimeout(r, ms))))

describe('YAZ-5500: the last answer in the hint line', () => {
  it('first the 4-second Undo; then "Last: <title> (Forgot)" until the next answer; the ID with no title', async () => {
    h = await reviewSetup(FILES)
    await h.click('Forgot')
    // The 4-second Undo first (YAZ-5502), no Last line yet.
    expect(q('.review__hint .review__undo')).not.toBeNull()
    expect(q('.review__lastanswer')).toBeNull()
    await real(UNDO_SHOWN_MS + 150)
    expect(q('.review__hint .review__undo')).toBeNull()
    expect(hint()).toBe('Last: Capital of Spain (Forgot)')
    // Text only: no marks, no colour of its own.
    expect(hint()).not.toMatch(/[✕✓]/)
    expect(q('.review__lastanswer')?.getAttribute('style')).toBeNull()
    expect(q('.review__lastanswer [data-rating]')).toBeNull()
    // It stays.
    await real(1000)
    expect(hint()).toBe('Last: Capital of Spain (Forgot)')
    // The next answer: its own Undo, then its own line, by ID (the card has no title).
    expect(h.head()).toBe('CAP-2')
    await h.click('Remembered')
    expect(q('.review__lastanswer')).toBeNull()
    await real(UNDO_SHOWN_MS + 150)
    expect(hint()).toBe('Last: CAP-2 (Remembered)')
  })

  it('a tap on the line never steps the card; the card\'s own tap still does', async () => {
    h = await reviewSetup(FILES)
    await h.click('Remembered')
    await real(UNDO_SHOWN_MS + 150)
    expect(h.head()).toBe('CAP-2')
    // What shows of the card: its sides, and its hidden words shown.
    const shown = () => h!.host.querySelectorAll('.phone-card__body .card__side').length * 100 + h!.host.querySelectorAll('.phone-card__body .card__hidden').length
    const before = shown()
    await h.seen()
    await act(async () => q('.review__lastanswer-name')!.click())
    await h.settle()
    expect(shown()).toBe(before)
    await h.tap()
    expect(shown()).toBeGreaterThan(before)
    // A tap shows a part: the line stays.
    expect(hint()).toBe('Last: Capital of Spain (Remembered)')
  })

  it('Undo of the answer (in ⋯ after the 4 s) takes the line away with it', async () => {
    h = await reviewSetup(FILES)
    await h.click('Forgot')
    await real(UNDO_SHOWN_MS + 150)
    expect(hint()).toContain('Last: Capital of Spain')
    await h.click('More card actions')
    await h.click('Undo last answer')
    expect(h.head()).toContain('CAP-1')
    expect(q('.review__lastanswer')).toBeNull()
  })

  it('one line: a long title gives way with "…", the answer word stays whole (the CSS)', async () => {
    const { readFileSync } = await import('node:fs')
    const { dirname, resolve } = await import('node:path')
    const { fileURLToPath } = await import('node:url')
    const css = readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), 'review.css'), 'utf8')
    expect(css).toMatch(/\.review__lastanswer \{[^}]*white-space: nowrap;/)
    expect(css).toMatch(/\.review__lastanswer-name \{[^}]*overflow: hidden;[^}]*text-overflow: ellipsis;/)
    expect(css).toMatch(/\.review__lastanswer-rating \{[^}]*flex: none;/)
    expect(css).not.toMatch(/\.review__lastanswer[^{]*\{[^}]*color:/)
  })
})
