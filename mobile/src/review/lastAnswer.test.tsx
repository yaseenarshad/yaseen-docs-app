// @vitest-environment jsdom
import { act } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { UNDO_SHOWN_MS } from './words'
import { NOW, inOrder, cardBlock, page, reviewSetup, type ReviewHarness } from './testing'

/**
 * YAZ-5500 (reopened): right after ✕ or ✓, the hint line under the card says the answer, in place of the hint. One thing:
 * the separate 4-second Undo is folded into it. No timer: it stays until the first action on the next card — a tap
 * that shows a part, ← or →, or the deck drawer — and then the plain hint is back. Undo stays in ⋯. One line cut with
 * "…"; a tap on its words never steps the card. YAZ-5693: the words are the Mac's ("✕ Forgot · <title> · back later
 * today · Undo"; the ID when the card has no title), from the Mac's piece. The real engine and answer list
 * (`testing.ts`). Made-up data only.
 */
const OLD = '2026-10-02T09:00:00.000Z good, 2026-10-12T09:00:00.000Z good'
const FILES = {
  '.yaseendocs/review.json': '{}',
  'capitals.md': page(
    'Capitals',
    cardBlock('What is the capital of Spain?\n---\n{{Madrid}}', `CAP-1, title "Capital of Spain", ${inOrder(OLD, 0)}`),
    cardBlock('A card with no title?\n---\n{{yes}} and {{no}}', `CAP-2, ${inOrder(OLD, 1)}`),
    cardBlock('Third?\n---\n{{three}}', `CAP-3, ${inOrder(OLD, 2)}`),
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
const plain = /^(Tap anywhere · \d+ left|Did you remember it\?)$/

describe('YAZ-5500: the last answer in the hint line, right after answering', () => {
  it('"✕ Forgot · <title> · back later today · Undo" at once, in place of the hint; no timer; the ID with no title', async () => {
    h = await reviewSetup(FILES)
    expect(hint()).toMatch(plain)
    await h.click('Forgot')
    expect(hint()).toBe('✕ Forgot · Capital of Spain · back later today · Undo')
    // One Undo, in the line: no second Undo of its own beside it.
    expect(h.host.querySelectorAll('.review__hint .review__undo')).toHaveLength(1)
    expect(q('.review__hint-text')).toBeNull()
    // YAZ-5693: the Mac's line — its mark, in the answer's colour by the line's data-rating (the CSS), nothing inline.
    expect(q('.review__last-mark')?.textContent).toBe('✕')
    expect(q('.review__last')?.getAttribute('data-rating')).toBe('again')
    expect(q('.review__last-text')?.getAttribute('style')).toBeNull()
    // No timer: past the old 4 seconds, it stays.
    await real(UNDO_SHOWN_MS + 300)
    expect(hint()).toBe('✕ Forgot · Capital of Spain · back later today · Undo')
    // The next answer: its own line, by ID (the card has no title).
    expect(h.head()).toBe('CAP-2')
    await h.click('Remembered')
    expect(hint()).toMatch(/^✓ Remembered · CAP-2 · back in \d+ days? · Undo$/)
  })

  it('the first tap on the next card (a part shows) puts it away: the plain hint again', async () => {
    h = await reviewSetup(FILES)
    await h.click('Remembered')
    expect(h.head()).toBe('CAP-2')
    const shown = () => h!.host.querySelectorAll('.phone-card__body .card__side').length * 100 + h!.host.querySelectorAll('.phone-card__body .card__hidden').length
    const before = shown()
    await h.tap()
    expect(shown()).toBeGreaterThan(before)
    expect(q('.review__last-mark')).toBeNull()
    expect(q('.review__hint .review__undo')).toBeNull()
    expect(hint()).toMatch(plain)
    // Undo stays in ⋯.
    await h.click('More card actions')
    expect(h.button('Undo last answer')?.disabled).toBe(false)
  })

  it('a tap on the line\'s words never steps the card, and keeps the line', async () => {
    h = await reviewSetup(FILES)
    await h.click('Remembered')
    const shown = () => h!.host.querySelectorAll('.phone-card__body .card__side').length * 100 + h!.host.querySelectorAll('.phone-card__body .card__hidden').length
    const before = shown()
    await h.seen()
    await act(async () => q('.review__last-name')!.click())
    await h.settle()
    expect(shown()).toBe(before)
    expect(hint()).toMatch(/^✓ Remembered · Capital of Spain · back in \d+ days? · Undo$/)
  })

  it('a tap in the 400 ms after the answer (the second tap of a double tap) does not put it away', async () => {
    h = await reviewSetup(FILES)
    await h.click('Remembered')
    expect(q('[data-guard]')).not.toBeNull()
    await act(async () => q('.review__card')!.click())
    await h.settle()
    expect(hint()).toMatch(/^✓ Remembered · Capital of Spain · back in \d+ days? · Undo$/)
  })

  it('→ puts it away (and ← is disabled at the first remaining card under YAZ-6019 Stop at the ends)', async () => {
    h = await reviewSetup(FILES)
    await h.click('Remembered')
    expect(h.head()).toBe('CAP-2')
    expect(h.button('Previous card')?.disabled).toBe(true)
    await h.click('Next card')
    expect(h.head()).toBe('CAP-3')
    expect(hint()).toMatch(plain)
  })

  it('opening the deck drawer puts it away', async () => {
    h = await reviewSetup(FILES)
    await h.click('Forgot')
    expect(hint()).toContain('Forgot · Capital of Spain')
    await h.click(/Choose what to review/)
    expect(q('.review__sheet')).not.toBeNull()
    expect(q('.review__last-mark')).toBeNull()
    expect(hint()).toMatch(plain)
  })

  it('YAZ-5710: on a finish screen the deck drawer keeps it; closed, its Undo takes the last answer back (the Mac\'s ⌘Z)', async () => {
    h = await reviewSetup({ '.yaseendocs/review.json': '{}', 'capitals.md': page('Capitals', cardBlock('What is the capital of Spain?\n---\n{{Madrid}}', `CAP-1, title "Capital of Spain", ${inOrder(OLD, 0)}`)) })
    await h.click('Remembered')
    expect(q('.review__card')).toBeNull()
    expect(hint()).toMatch(/^✓ Remembered · Capital of Spain · back in \d+ days? · Undo$/)
    await h.click(/Choose what to review/)
    expect(q('.review__sheet')).not.toBeNull()
    await h.click(/Choose what to review/)
    expect(q('.review__sheet')).toBeNull()
    expect(hint()).toMatch(/^✓ Remembered · Capital of Spain · back in \d+ days? · Undo$/)
    await h.click('Undo')
    expect(h.head()).toContain('CAP-1')
    expect(q('.review__last-mark')).toBeNull()
    expect(h.answers.waiting()).toHaveLength(0)
  })

  it('opening ⋯ keeps it; its Undo takes the answer back, and the line with it', async () => {
    h = await reviewSetup(FILES)
    await h.click('Forgot')
    await h.click('More card actions')
    await h.click('More card actions')
    expect(hint()).toBe('✕ Forgot · Capital of Spain · back later today · Undo')
    await h.click('Undo')
    expect(h.head()).toContain('CAP-1')
    expect(q('.review__last-mark')).toBeNull()
    expect(h.answers.waiting()).toHaveLength(0)
  })

  it('Undo of the answer in ⋯, after the line went, still works', async () => {
    h = await reviewSetup(FILES)
    await h.click('Forgot')
    await h.tap()
    expect(q('.review__last-mark')).toBeNull()
    await h.click('More card actions')
    await h.click('Undo last answer')
    expect(h.head()).toContain('CAP-1')
    expect(q('.review__last-mark')).toBeNull()
  })

  it('one line: a long title gives way with "…", the answer word stays whole (the CSS)', async () => {
    const { readFileSync } = await import('node:fs')
    const { dirname, resolve } = await import('node:path')
    const { fileURLToPath } = await import('node:url')
    const css = readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), 'review.css'), 'utf8')
    expect(css).toMatch(/\.review__last \{[^}]*white-space: nowrap;/)
    expect(css).toMatch(/\.review__last-name \{[^}]*overflow: hidden;[^}]*text-overflow: ellipsis;/)
    expect(css).toMatch(/\.review__last-mark \{[^}]*flex: none;/)
    // The status box it sits in may shrink to the screen, so the title (not the Undo) gives way.
    expect(css).toMatch(/\.review__last \{[^}]*min-width: 0;[^}]*max-width: 100%;/)
    // YAZ-5693 (the Mac's YAZ-5433): only the mark has a colour; the words are the line's own grey.
    expect(css).not.toMatch(/\.review__last-(text|name) \{[^}]*color:/)
  })
})
