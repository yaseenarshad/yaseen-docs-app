// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { NOW, inOrder, cardBlock, page, reviewSetup, type ReviewHarness } from './testing'

/**
 * YAZ-5693 (parity gap 3 of YAZ-5687): the hint line after an answer says the Mac's words, from the Mac's one piece
 * (`AnswerLine`, `cardInboxChip.tsx`): "✓ Remembered · Capital of Spain · back in 9 days · Undo", "✕ Forgot · … · back
 * later today · Undo". Only the mark has the answer's colour (the Mac's YAZ-5433). The phone's Undo is touch-sized
 * (`.review__undo`, its 44 pt box). Made-up data only.
 */
const OLD = '2026-10-02T09:00:00.000Z good, 2026-10-12T09:00:00.000Z good'
const FILES = {
  '.yaseendocs/review.json': '{}',
  'capitals.md': page(
    'Capitals',
    cardBlock('What is the capital of Spain?\n---\n{{Madrid}}', `CAP-1, title "Capital of Spain", ${inOrder(OLD, 0)}`),
    cardBlock('No title?\n---\n{{yes}}', `CAP-2, ${inOrder(OLD, 1)}`),
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
const line = () => (q('.review__hint .review__last')?.textContent ?? '').replace(/\s+/g, ' ').trim()

describe('YAZ-5693: the hint line says the Mac`s words, from the Mac`s piece', () => {
  it('Remembered: "✓ Remembered · <title> · back in N days · Undo"; the ID when the card has no title', async () => {
    h = await reviewSetup(FILES)
    await h.click('Remembered')
    expect(line()).toMatch(/^✓ Remembered · Capital of Spain · back in \d+ days · Undo$/)
    // The Mac's parts: the mark, the words (the name may give way with "…"), the Undo.
    expect(q('.review__last')?.getAttribute('data-rating')).toBe('good')
    expect(q('.review__last-mark')?.textContent).toBe('✓')
    expect(q('.review__last-name')?.textContent).toBe('Capital of Spain')
    // No "Last:", no "(Remembered)", no ↶.
    expect(line()).not.toMatch(/Last:|\(|↶/)
    await h.click('Forgot')
    expect(line()).toBe('✕ Forgot · CAP-2 · back later today · Undo')
    expect(q('.review__last')?.getAttribute('data-rating')).toBe('again')
  })

  it('one Undo, the touch-sized one; it takes the answer back', async () => {
    h = await reviewSetup(FILES)
    await h.click('Remembered')
    const undos = h.host.querySelectorAll<HTMLButtonElement>('.review__hint button')
    expect(undos).toHaveLength(1)
    expect(undos[0].className).toBe('review__undo')
    expect(undos[0].textContent).toBe('Undo')
    await h.click('Undo')
    expect(h.head()).toContain('CAP-1')
  })
})
