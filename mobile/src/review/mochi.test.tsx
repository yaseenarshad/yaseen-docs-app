// @vitest-environment jsdom
import { act } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { VAULT } from '../sync/testing'
import { readNewFrom } from './newFromPick'
import { NOW, inOrder, cardBlock, page, reviewSetup, type ReviewHarness } from './testing'

/**
 * YAZ-5415: the Review screen like Mochi (the approved mockup, round 5). Tap anywhere (and what keeps its own tap), a
 * tap on a hidden part, the bounce at the end, ← → as the Mac, an answer before all parts show, Undo in the hint line,
 * the review menu (each list, Reset, the folder pick with two folders) and the progress bar in steps. The real engine
 * and answer list on the fake GitHub (`testing.ts`).
 */
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

const OLD = '2026-10-04T09:00:00.000Z good'
const ids = (hh: ReviewHarness) => hh.answers.waiting().filter((w) => w.op.kind === 'review').map((w) => w.op.id)
const q = (sel: string) => h!.host.querySelector<HTMLElement>(sel)
const hint = () => (q('.review__hint')?.textContent ?? '').replace(/\s+/g, ' ').trim()
const shownWords = () => [...h!.host.querySelectorAll('.phone-card__body .card__hidden')].map((e) => e.textContent?.trim())
const blanks = () => h!.host.querySelectorAll('.phone-card__body .card__blank').length
/** A tap on `el`, as a finger: after the new card's short "seen" time (YAZ-5226). */
async function tapOn(el: Element | null) {
  if (el === null) throw new Error(`Nothing to tap on: ${h!.host.textContent}`)
  await h!.seen()
  await act(async () => (el as HTMLElement).click())
  await h!.settle()
}
const real = (ms: number) => act(async () => void (await new Promise((r) => setTimeout(r, ms))))

describe('tap anywhere (YAZ-5415, round 4)', () => {
  const ONE = { '.yaseendocs/review.json': '{}', 'p.md': page('Memory', cardBlock('{{Spaced}} repetition makes the next gap {{longer}}; a miss makes it {{short}}.', `MC-1, ${inOrder(OLD, 0)}`), cardBlock('Two?', `MC-2, ${inOrder(OLD, 1)}`)) }

  it('the card, the empty space, the hint line and the crumb each show the next part', async () => {
    h = await reviewSetup(ONE)
    expect(hint()).toBe('Tap anywhere · 3 left')
    await tapOn(q('.review__crumb'))
    expect(shownWords()).toEqual(['Spaced'])
    await tapOn(q('.review__hint-text'))
    expect(shownWords()).toEqual(['Spaced', 'longer'])
    expect(hint()).toBe('Tap anywhere · 1 left')
    await tapOn(q('.review__stage'))
    expect(shownWords()).toEqual(['Spaced', 'longer', 'short'])
    expect(hint()).toBe('Did you remember it?')
  })

  it('NOT: ← → ⋯ and an open menu (a tap outside it only closes it); a link in the card keeps its tap', async () => {
    h = await reviewSetup({ ...ONE, 'p.md': page('Memory', cardBlock('See [the guide](https://example.com/guide) and {{this}}.', `MC-1, ${inOrder(OLD, 0)}`), cardBlock('Two?', `MC-2, ${inOrder(OLD, 1)}`)) })
    await h.click('More card actions')
    expect(q('.review__menu--more')).not.toBeNull()
    await tapOn(q('.review__hint-text'))
    expect(q('.review__menu--more')).toBeNull()
    expect(blanks()).toBe(1)
    await h.click(/Choose what to review/)
    expect(q('.review__sheet')).not.toBeNull()
    await tapOn(q('.review__card'))
    expect(q('.review__sheet')).toBeNull()
    expect(blanks()).toBe(1)
    await h.click('Next card')
    await h.click('Previous card')
    expect(blanks()).toBe(1)
    // A link in the text opens as the browser opens it; it never steps the card.
    const a = q('.phone-card__body a')
    a?.addEventListener('click', (e) => e.preventDefault())
    await tapOn(a)
    expect(blanks()).toBe(1)
    expect(ids(h)).toEqual([])
  })

  it('a tap on a hidden part shows THAT part (as the Mac\'s click); the next tap shows the next one still hidden', async () => {
    h = await reviewSetup(ONE)
    await tapOn(h.host.querySelector('.card__blank[data-hidden="2"]'))
    expect(shownWords()).toEqual(['short'])
    expect(hint()).toBe('Tap anywhere · 2 left')
    // The mark goes to the first part still hidden: the next tap anywhere shows it.
    expect(q('.card__blank[data-next]')?.dataset.hidden).toBe('0')
    await h.tap()
    expect(shownWords()).toEqual(['Spaced', 'short'])
  })

  it('the end of the card: a tap when every part shows bounces ✕ and ✓ once (again on each tap); it shows and answers nothing', async () => {
    h = await reviewSetup(ONE)
    for (let i = 0; i < 3; i++) await h.tap()
    expect(q('.review__answers')?.dataset.nudge).toBeUndefined()
    await h.tap()
    expect(q('.review__answers')?.dataset.nudge).toBe('a')
    await h.tap()
    expect(q('.review__answers')?.dataset.nudge).toBe('b')
    expect(shownWords()).toHaveLength(3)
    expect(ids(h)).toEqual([])
    // A card with nothing hidden is at its end at once.
    await h.click('Remembered')
    await h.tap()
    expect(q('.review__answers')?.dataset.nudge).toBe('a')
  })
})

describe('the controls (YAZ-5415): ← → as the Mac, an answer at any time, Undo in the hint line', () => {
  const THREE = { '.yaseendocs/review.json': '{}', 'p.md': page('P', ...['A', 'B', 'C'].map((x, i) => cardBlock(`${x}?\n---\n{{${x.toLowerCase()}}}`, `AR-${i + 1}, ${inOrder(OLD, i)}`))) }

  it('← and → move between cards; neither gives nor takes back an answer; a skipped card stays due and comes back at the end', async () => {
    h = await reviewSetup(THREE)
    expect(h.button('Previous card')?.disabled).toBe(true)
    await h.click('Next card')
    expect(h.head()).toBe('AR-2')
    // YAZ-5675 (Mochi): "done / total"; → answers nothing.
    expect(h.text()).toContain('0 / 3')
    await h.click('Previous card')
    expect(h.head()).toBe('AR-1')
    expect(ids(h)).toEqual([])
    // Skip AR-1, answer the other two: AR-1 comes back.
    await h.click('Next card')
    await h.click('Remembered')
    expect(h.head()).toBe('AR-3')
    await h.click('Remembered')
    expect(h.head()).toBe('AR-1')
    expect(ids(h)).toEqual(['AR-2', 'AR-3'])
    // ← never takes an answer back.
    expect(h.button('Previous card')?.disabled).toBe(true)
  })

  it('an answer before all parts show; "Last: … · ↶ Undo" in the hint line until the next card\'s first tap (it stays in ⋯)', async () => {
    h = await reviewSetup(THREE)
    expect(h.cardText()).toBe('A?')
    await h.click('Forgot')
    expect(ids(h)).toEqual(['AR-1'])
    // YAZ-5500: the answer in words, with its Undo, in the hint line's place (one thing, not two).
    expect(hint()).toBe('Last: AR-1 (Forgot) · ↶ Undo')
    expect(q('.review__hint .review__undo')?.getAttribute('aria-label')).toBe('Undo')
    expect(q('.review__last[role="status"] .review__lastanswer')).not.toBeNull()
    await h.click('Undo')
    expect(h.head()).toBe('AR-1')
    expect(ids(h)).toEqual([])
    await h.click('Remembered')
    // No timer: it is still there after 4 s.
    await real(4_100)
    expect(hint()).toBe('Last: AR-1 (Remembered) · ↶ Undo')
    // The first tap on the next card puts it away: the plain hint again.
    await h.tap()
    expect(q('.review__hint .review__undo')).toBeNull()
    expect(hint()).toMatch(/^Tap anywhere · \d+ left$|^Did you remember it\?$/)
    await h.click('More card actions')
    await h.click('Undo last answer')
    expect(h.head()).toBe('AR-1')
    expect(ids(h)).toEqual([])
  }, 30_000)

  it('YAZ-5676: the progress bar as Mochi`s: grey done ÷ total, then red for the misses waiting, both from the left', async () => {
    h = await reviewSetup(THREE)
    const widths = () => ['grey', 'red'].map((part) => h!.host.querySelector<HTMLElement>(`.review__progress .session-bar__${part}`)?.style.width)
    expect(widths()).toEqual(['0%', '0%'])
    await h.click('Remembered')
    await h.click('Forgot')
    // A Forgot is done +1 and the total +1 (the card comes back at the end of the session): 2 / 4, red after the grey.
    expect(widths()).toEqual(['50%', '75%'])
    expect(q('.review__progress')?.getAttribute('aria-valuenow')).toBe('2')
    expect(q('.review__progress')?.getAttribute('aria-valuemax')).toBe('4')
  })
})

describe('the review menu (YAZ-5415, as the Mac\'s cards menu)', () => {
  it('each list with its count; a pick shows only those cards; Up next only while a card is marked', async () => {
    h = await reviewSetup({
      '.yaseendocs/review.json': '{"newPerDay": 1}',
      'p.md': page('P', cardBlock('Old?\n---\n{{old}}', `MN-1, ${OLD}`), cardBlock('New?\n---\n{{new}}', 'MN-2'), cardBlock('Marked?\n---\n{{m}}', 'MN-3, next'), cardBlock('Wait?\n---\n{{w}}', 'MN-4')),
    })
    await h.click(/Choose what to review/)
    const rows = () => [...h!.host.querySelectorAll('.review__sheet-row')].map((r) => (r.textContent ?? '').replace(/\s+/g, ' ').trim())
    // Review rules v1, rule 7: MN-3 (new, Up next) is under Up next only; before, New cards said 2.
    expect(rows()).toEqual(['▣All cards3', '⤒Up next1', '◷Due today1', '◌New cardsfrom All folders ›1'] /* YAZ-5624: the count alone, as the Mac (YAZ-5434) */)
    await h.click(/^Due today$/)
    expect(h.text()).toContain('Due today ▾')
    expect(h.head()).toBe('MN-1')
    await h.click(/Choose what to review/)
    await h.click(/^New cards$/)
    // The new cards only: the Up next one is under Up next (rule 7).
    expect(h.text()).toContain('New cards ▾')
    expect(h.host.querySelector('.review__chip')?.textContent).toBe('New')
    expect(h.head()).toBe('MN-2')
    expect(h.text()).toContain('0 / 1')
    await h.click(/Choose what to review/)
    await h.click(/^Up next$/)
    expect(h.head()).toBe('MN-3')
    await h.click(/Choose what to review/)
    await h.click(/^All cards$/)
    expect(h.text()).toContain('0 / 3')
  })

  it('Reset sets today\'s new cards back to the Settings number (never below today\'s work); Undo takes it back', async () => {
    h = await reviewSetup({ '.yaseendocs/review.json': '{"newPerDay": 1}', 'p.md': page('P', ...[1, 2, 3].map((n) => cardBlock(`N${n}?`, `RS-${n}`))) })
    // The first new card needs two Remembered (its same-day steps); then the done screen adds one more.
    for (let i = 0; i < 2; i++) await h.click('Remembered')
    expect(h.text()).toContain('Inbox complete')
    await h.click('Add 1 new card')
    expect(h.head()).toBe('RS-2')
    await h.click(/Choose what to review/)
    // YAZ-5624: the count alone, as the Mac's New cards row (YAZ-5434): today's cards left, never "/ total".
    const newRow = () => (h!.host.querySelector('.review__sheet-row [data-kind="new"]')?.textContent ?? '').trim()
    expect(newRow()).toBe('1')
    expect(h.button(/Reset today's new cards/)).not.toBeNull()
    await h.click(/Reset today's new cards/)
    // Today is the Settings number again (1, done already): the added cards not on show leave; the one on show stays.
    expect(h.head()).toBe('RS-2')
    expect(newRow()).toBe('1')
    expect(h.button(/Reset today's new cards/)).toBeNull()
    expect(hint()).toContain("Reset today's new cards")
    await h.click('Undo')
    await h.click(/Choose what to review/)
    expect(newRow()).toBe('1')
    expect(h.button(/Reset today's new cards/)).not.toBeNull()
  })

  it('New cards "from All folders ›": the folder page takes two folders; the count follows; the pick is kept', async () => {
    const pageIn = (title: string, n: number, id: string) => page(title, ...Array.from({ length: n }, (_, i) => cardBlock(`${title} ${i}?`, `${id}-${i + 1}`)))
    h = await reviewSetup({
      '.yaseendocs/review.json': '{"newPerDay": 10}',
      'languages/urdu.md': pageIn('Urdu', 2, 'LA'),
      'learning/memory.md': pageIn('Memory', 3, 'LE'),
      'trip/lisbon.md': pageIn('Lisbon', 4, 'TR'),
    })
    await h.click(/Choose what to review/)
    await h.click(/^New cards from All folders/)
    const folders = () => [...h!.host.querySelectorAll('.review__sheet-folder')].map((r) => (r.textContent ?? '').replace(/\s+/g, ' ').trim())
    expect(folders()).toEqual(['All folders9', 'languages2', 'learning3', 'trip4'])
    const tick = async (label: string) => {
      const box = [...h!.host.querySelectorAll<HTMLLabelElement>('.review__sheet-folder')].find((r) => r.textContent?.startsWith(label))?.querySelector('input')
      await tapOn(box ?? null)
    }
    await tick('languages')
    await tick('learning')
    const ticked = () => [...h!.host.querySelectorAll<HTMLInputElement>('.review__sheet-folder input')].map((i) => i.checked)
    expect(ticked()).toEqual([false, true, true, false])
    expect(h.text()).toContain('Stays until you clear it.')
    await h.click(/New cards from…$/)
    expect(h.button(/^New cards from languages, learning/)).not.toBeNull()
    // Today's new cards come from the two folders only: 2 + 3.
    expect((h.host.querySelector('.review__sheet-row [data-kind="new"]')?.textContent ?? '').trim()).toBe('5')
    expect(await readNewFrom(h.store, VAULT)).toEqual(['languages', 'learning'])
    await h.click(/^New cards$/)
    expect(h.head()).toMatch(/^L[AE]-/)
  })
})
