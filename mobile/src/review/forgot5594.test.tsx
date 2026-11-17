// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { BACK_LINE } from './ReviewView'
import { cardBlock, inOrder, page, reviewSetup, type ReviewHarness } from './testing'

/**
 * YAZ-5594 (Urgent; Yaseen: "im hitting the X and its not removing NC205... but the progress bar is contining to go
 * red and the btottom says last NC205 forgot undo but NC205 still shows"). The demo vault's "Try / Cards in a page":
 * NC-205 ("Missed for a while (overdue)") was the last due card. Its Forgot gave the % screen, "Review missed cards 1",
 * and then each ✕ brought NC-205 straight back: the Mac's rule (YAZ-5702 a ✕ comes back, YAZ-5043 missed cards before
 * new cards, the shared `useCardReview`): a Forgot brings the card back until it is remembered, and with no
 * other missed card it is the next card itself. The Mac does the same. The phone said only "Last: NC-205 (Forgot)", so
 * it looked stuck. Now: the line says why it is back, the card wears "Again", and it comes in again (an animation).
 * Remembered lets it go and the new cards come. The card's own text (made-up demo data); the real engine and list.
 */
const NOW = Date.UTC(2026, 10, 15, 19, 10)
const NC205 = cardBlock(
  'What is a pastel de nata?\n---\nA custard tart.',
  'NC-205, 2026-09-20T08:00:00.000Z good 8s, 2026-09-24T08:00:00.000Z good 6s, 2026-10-05T08:00:00.000Z good 5s, 2026-11-15T15:39:00.000Z again 4s',
)
const NC207 = cardBlock('"Good night" in Portuguese is {{boa noite}}.', 'NC-207')
const NC206 = cardBlock('"Good morning" in Portuguese is {{bom dia}}.', 'NC-206, title "Good morning", 2026-11-12T07:30:00.000Z good 5s')

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

const q = (sel: string) => h!.host.querySelector<HTMLElement>(sel)
const showing = () => (q('.review__card') === null ? null : h!.head())
const hint = () => (q('.review__hint')?.textContent ?? '').replace(/\s+/g, ' ').trim()
const place = () => /(\d+) \/ (\d+)/.exec(h!.text())?.slice(1).map(Number)
/** The bar's grey and red ends, in whole %. */
/** Due today (YAZ-5707: its % screen and "Review missed cards" are Due today's; All cards is one run with no stop). */
const dueToday = async () => {
  await h!.click(/Choose what to review/)
  await h!.click('Due today')
}
const ends = () => ['grey', 'red'].map((part) => Math.round(parseFloat(h!.host.querySelector<HTMLElement>(`.review__progress .session-bar__${part}`)?.style.width ?? '0')))

describe('YAZ-5594: ✕ on the last missed card', () => {
  it('Yaseen\'s NC-205: each ✕ brings it back at once, and the screen SAYS so (never looks stuck); ✓ lets it go', async () => {
    h = await reviewSetup({ '.yaseendocs/review.json': '{"newPerDay": 10}', 'Try/Cards in a page.md': page('Cards in a page', NC205, NC207) })
    await dueToday()
    expect(showing()).toBe('NC-205')
    expect(q('.review__again')).toBeNull()
    await h.click('Forgot')
    await h.click('Review missed cards 1')
    // The missed card, as missed: "Again" on it.
    expect(showing()).toBe('NC-205')
    expect(q('.review__again')?.textContent).toBe('Again')
    const backs: (string | undefined)[] = []
    for (let i = 0; i < 3; i++) {
      const [at, of] = place()!
      const bar = ends()
      await h.click('Forgot')
      // The Mac's rule: it is back (the only missed card; the new card waits)...
      expect(showing()).toBe('NC-205')
      // ...the missed pass (YAZ-5675, Mochi): a ✕ moves nothing; the red still shows after the grey.
      expect(ends()).toEqual(bar)
      expect(bar[1]).toBeGreaterThan(bar[0])
      expect(place()).toEqual([at, of])
      // ...and the screen says why, in place of the plain Forgot line, with the Undo.
      expect(hint()).toBe(`${BACK_LINE} · Undo`)
      expect(hint()).not.toContain('Last:')
      expect(q('.review__again')?.textContent).toBe('Again')
      // From the front again, and it comes in again: a new animation name each time.
      expect(h.text()).toContain('Side 1 of 2')
      backs.push(q('.review__card')?.dataset.back)
    }
    expect(backs.every((b) => b === 'a' || b === 'b')).toBe(true)
    expect(backs[0]).not.toBe(backs[1])
    expect(backs[1]).not.toBe(backs[2])
    // The first tap on it puts the line away (as any answer's line); "Again" stays on the card.
    await h.tap()
    expect(hint()).not.toContain(BACK_LINE)
    expect(q('.review__again')).not.toBeNull()
    // ✓ lets it go: Due today is done ("Finished reviewing missed cards.", YAZ-5678), and the new card comes next.
    await h.click('Remembered')
    expect(showing()).toBeNull()
    expect(q('.review__done-title')?.textContent).toBe('Finished reviewing missed cards.')
    await h.click('Learn new cards 1')
    expect(showing()).toBe('NC-207')
    expect(q('.review__card')?.dataset.back).toBeUndefined()
    expect(q('.review__again')).toBeNull()
  })

  it('Undo of the ✕ that brought it back: the line and the animation go', async () => {
    h = await reviewSetup({ '.yaseendocs/review.json': '{"newPerDay": 10}', 'Try/Cards in a page.md': page('Cards in a page', NC205, NC207) })
    await dueToday()
    await h.click('Forgot')
    await h.click('Review missed cards 1')
    await h.click('Forgot')
    expect(hint()).toBe(`${BACK_LINE} · Undo`)
    await h.click('Undo')
    expect(showing()).toBe('NC-205')
    expect(hint()).not.toContain(BACK_LINE)
    expect(q('.review__card')?.dataset.back).toBeUndefined()
  })

  it('with another card still to come, ✕ moves on as ✓ does: the plain "✕ Forgot · … · back later today" line (the Mac\'s, YAZ-5693), no animation', async () => {
    h = await reviewSetup({ '.yaseendocs/review.json': '{"newPerDay": 10}', 'Try/Cards in a page.md': page('Cards in a page', NC205, NC206, NC207) })
    expect(showing()).toBe('Good morning · NC-206')
    await h.click('Forgot')
    expect(showing()).toBe('NC-205')
    expect(hint()).toBe('✕ Forgot · Good morning · back later today · Undo')
    expect(q('.review__card')?.dataset.back).toBeUndefined()
    expect(q('.review__again')).toBeNull()
  })

  it('YAZ-5675 (Mochi): 3 cards, the last forgotten 3 times then remembered — its first Forgot adds 1 to the total once; the list says 1', async () => {
    const known = (x: string, id: string, i: number) => cardBlock(`${x}?\n---\n{{${x.toLowerCase()}}}`, `${id}, ${inOrder('2026-10-04T09:00:00.000Z good, 2026-10-04T09:01:00.000Z good', i)}`)
    h = await reviewSetup({ '.yaseendocs/review.json': '{}', 'p.md': page('P', known('A', 'PB-1', 0), known('B', 'PB-2', 1), known('C', 'PB-3', 2)) })
    await dueToday()
    const bar = () => [...ends(), q('.review__progress')?.getAttribute('aria-valuenow'), q('.review__progress')?.getAttribute('aria-valuemax')]
    const dueRow = async () => {
      await h!.click(/Choose what to review/)
      const row = [...h!.host.querySelectorAll('.review__sheet-row')].map((r) => (r.textContent ?? '').replace(/\s+/g, ' ').trim()).find((t) => t.includes('Due today'))
      await h!.click(/Choose what to review/)
      return row
    }
    expect([place(), ...bar()]).toEqual([[0, 3], 0, 0, '0', '3'])
    await h.click('Remembered')
    await h.click('Remembered')
    expect([place(), ...bar()]).toEqual([[2, 3], 67, 67, '2', '3'])
    await h.click('Forgot')
    await h.click('Review missed cards 1')
    for (let i = 0; i < 2; i++) {
      expect(showing()).toBe('PB-3')
      expect([place(), ...bar()]).toEqual([[3, 4], 75, 100, '3', '4'])
      await h.click('Forgot')
    }
    expect([place(), ...bar()]).toEqual([[3, 4], 75, 100, '3', '4'])
    // Undo of the last ✕: the same card, the same bar and count.
    await h.click('Undo')
    expect([place(), ...bar()]).toEqual([[3, 4], 75, 100, '3', '4'])
    await h.click('Forgot')
    // The list's count: the one card left, not one per ✕.
    expect(await dueRow()).toBe('Due today1')
    await h.click('Remembered')
    expect(q('.review__done-title')?.textContent).toBe('Finished reviewing missed cards.')
    expect(bar()).toEqual([100, 100, '3', '3'])
  })
})

describe('YAZ-5626: "Again" only on a card back after a ✕ (Yaseen)', () => {
  it('a new card back for its second ✓ wears no "Again"; a ✕ on it, or on a new card, brings it back with "Again"', async () => {
    h = await reviewSetup({ '.yaseendocs/review.json': '{"newPerDay": 10}', 'Try/Cards in a page.md': page('Cards in a page', NC207) })
    expect(showing()).toBe('NC-207')
    expect(q('.review__again')).toBeNull()
    // The first ✓: the new card comes back for its second round (YAZ-5610), with no "Again".
    await h.click('Remembered')
    expect(showing()).toBe('NC-207')
    expect(q('.review__again')).toBeNull()
    // A ✕ on its second round: back, with "Again".
    await h.click('Forgot')
    expect(showing()).toBe('NC-207')
    expect(q('.review__again')?.textContent).toBe('Again')
  })

  it('a ✕ on a new card: it comes back with "Again"', async () => {
    h = await reviewSetup({ '.yaseendocs/review.json': '{"newPerDay": 10}', 'Try/Cards in a page.md': page('Cards in a page', NC207) })
    await h.click('Forgot')
    expect(showing()).toBe('NC-207')
    expect(q('.review__again')?.textContent).toBe('Again')
  })
})

describe('YAZ-5676: the phone draws Mochi`s bar, as the Mac', () => {
  it('3 cards, the first missed: the red travels right with the grey; full at the % screen; each ✓ of the missed pass turns it grey', async () => {
    const known = (x: string, id: string, i: number) => cardBlock(`${x}?\n---\n{{${x.toLowerCase()}}}`, `${id}, ${inOrder('2026-10-04T09:00:00.000Z good, 2026-10-04T09:01:00.000Z good', i)}`)
    h = await reviewSetup({ '.yaseendocs/review.json': '{}', 'p.md': page('P', known('A', 'PB-1', 0), known('B', 'PB-2', 1), known('C', 'PB-3', 2)) })
    await dueToday()
    await h.click('Forgot')
    expect(ends()).toEqual([25, 50])
    await h.click('Remembered')
    expect(ends()).toEqual([50, 75])
    await h.click('Remembered')
    expect(ends()).toEqual([75, 100])
    await h.click('Review missed cards 1')
    expect(showing()).toBe('PB-1')
    expect(ends()).toEqual([75, 100])
    await h.click('Forgot')
    expect(ends()).toEqual([75, 100])
    await h.click('Remembered')
    expect(ends()).toEqual([100, 100])
  })
})
