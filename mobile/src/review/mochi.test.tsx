// @vitest-environment jsdom
import { act } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { VAULT } from '../sync/testing'
import { readNewFrom, readOrders } from './newFromPick'
import { NOW, inOrder, cardBlock, page, reviewSetup, type ReviewHarness } from './testing'

/**
 * YAZ-5415: the Review screen like Mochi (the approved mockup, round 5). Tap anywhere (and what keeps its own tap), a
 * tap on a hidden part, the bounce at the end, ← → as the Mac, an answer before all parts show, Undo in the hint line,
 * the review menu (each list, Reset, the folder pick with two folders) and the progress bar (Mochi's two fills, YAZ-5676). The real engine
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

  it('an answer before all parts show; the answer\'s line with its Undo in the hint line until the next card\'s first tap (it stays in ⋯)', async () => {
    h = await reviewSetup(THREE)
    expect(h.cardText()).toBe('A?')
    await h.click('Forgot')
    expect(ids(h)).toEqual(['AR-1'])
    // YAZ-5500: the answer in words, with its Undo, in the hint line's place (one thing, not two).
    expect(hint()).toBe('✕ Forgot · AR-1 · back later today · Undo')
    expect(q('.review__hint .review__undo')?.getAttribute('aria-label')).toBe('Undo')
    expect(q('.review__last[role="status"] .review__last-mark')).not.toBeNull()
    await h.click('Undo')
    expect(h.head()).toBe('AR-1')
    expect(ids(h)).toEqual([])
    await h.click('Remembered')
    // No timer: it is still there after 4 s.
    await real(4_100)
    expect(hint()).toMatch(/^✓ Remembered · AR-1 · back (later today|today|in \d+ days?) · Undo$/)
    // The first tap on the next card puts it away: the plain hint again.
    await h.tap()
    expect(q('.review__hint .review__undo')).toBeNull()
    expect(hint()).toMatch(/^Tap anywhere · \d+ left$|^Did you remember it\?$/)
    await h.click('More card actions')
    await h.click('Undo last answer')
    expect(h.head()).toBe('AR-1')
    expect(ids(h)).toEqual([])
  }, 30_000)

  it('YAZ-5674: the count as Mochi`s, the Mac`s piece — a red ✕ K, the open list`s glyph, "done / total"; the glyph once', async () => {
    h = await reviewSetup(THREE)
    const place = () => q('.review__place')
    expect(place()?.textContent).toBe('0 / 3')
    expect(q('.review__filter-label')?.textContent).toBe('All cards')
    await h.click('Forgot')
    expect(place()?.querySelector('.session-count__misses')?.textContent).toBe('1')
    expect(place()?.querySelector('.session-count__done')?.textContent).toBe('1 / 4')
    expect(h.button(/Choose what to review/)?.getAttribute('aria-label')).toBe('All cards. Choose what to review')
    expect(place()?.querySelector('.session-count')?.getAttribute('aria-label')).toBe('1 missed, 1 of 4 done')
  })

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
    expect(rows()).toEqual(['All cards3', 'Up next1', 'Due today1', 'New cards1'] /* YAZ-5624: the count alone, as the Mac (YAZ-5434); YAZ-5685: no "from" on the row */)
    await h.click(/^Due today$/)
    expect(h.host.querySelector('.review__filter-label')?.textContent).toBe('Due today')
    expect(h.head()).toBe('MN-1')
    await h.click(/Choose what to review/)
    await h.click(/^New cards$/)
    // The new cards only: the Up next one is under Up next (rule 7).
    expect(h.host.querySelector('.review__filter-label')?.textContent).toBe('New cards')
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
    // The first new card needs two Remembered (the first adds it to today's reviews, YAZ-5702); then the done screen adds one more.
    for (let i = 0; i < 2; i++) await h.click('Remembered')
    expect(h.text()).toContain('Inbox complete')
    await h.click('Add 1 new card')
    await h.click('Add') // YAZ-5699: the ask's second tap
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
    // YAZ-5685: the folder pick is in the ⚙'s part under the Today line.
    await h.click('Review settings')
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

describe('YAZ-5679: the Mac`s toast on the phone, "Added card to reviews · Undo"', () => {
  it('a new card`s Remembered shows it above the controls; its Undo takes the answer back; a Forgot shows none', async () => {
    h = await reviewSetup({ '.yaseendocs/review.json': '{}', 'p.md': page('P', cardBlock('New?\n---\n{{n}}', 'LN-1'), cardBlock('Other?\n---\n{{o}}', 'LN-2')) })
    const toast = () => q('.review__hint > .learned-toast') // YAZ-5692: the hint line's own
    await h.click('Forgot')
    expect(toast()).toBeNull()
    await h.click('Remembered')
    expect(toast()?.textContent).toBe('Added card to reviews·Undo')
    expect(ids(h)).toEqual(['LN-1', 'LN-2'])
    await act(async () => toast()!.querySelector<HTMLButtonElement>('.learned-toast__undo')!.click())
    await h.settle()
    expect(toast()).toBeNull()
    expect(ids(h)).toEqual(['LN-1'])
  })
})

describe('the review sheet\'s ⚙ (YAZ-5685, the Mac\'s cards menu)', () => {
  const FILES = { '.yaseendocs/review.json': '{"newPerDay": 10}', 'languages/urdu.md': page('Urdu', cardBlock('U?', 'LA-1'), cardBlock('V?', 'LA-2')), 'trip/lisbon.md': page('Lisbon', cardBlock('L?', 'TR-1')) }
  const part = () => q('.review__sheet .review__sheet-settings')
  const cog = () => h!.button('Review settings')!

  it('the Today line ends with a ⚙ (folded); a tap opens "New cards" · "From  All folders ›" under it, a tap again folds it; a new sheet opens folded', async () => {
    h = await reviewSetup(FILES)
    await h.click(/Choose what to review/)
    const foot = q('.review__sheet-foot')!
    expect(foot.lastElementChild).toBe(cog())
    expect([cog().getAttribute('aria-expanded'), part()]).toEqual(['false', null])
    await h.click('Review settings')
    expect(cog().getAttribute('aria-expanded')).toBe('true')
    expect(part()!.previousElementSibling).toBe(foot)
    expect(part()!.querySelector('h6')!.textContent).toBe('New cards')
    expect([...part()!.querySelectorAll('li')].map((li) => (li.textContent ?? '').replace(/\s+/g, ' ').trim())).toEqual(['FromAll folders ›', 'Add todayNo more new cards in any folder', 'OrderDue firstShuffle', 'OrderIn orderShuffle'])
    await h.click('Review settings')
    expect(part()).toBeNull()
    await h.click('Review settings')
    await h.click(/^New cards from All folders/)
    const box = [...h.host.querySelectorAll<HTMLLabelElement>('.review__sheet-folder')].find((r) => r.textContent?.startsWith('trip'))!.querySelector('input')!
    await tapOn(box)
    await h.click(/New cards from…$/)
    // Back from the folder page: the part is still open, and the row says the pick quietly.
    expect(h.button(/^New cards from trip/)).not.toBeNull()
    const newRow = [...h.host.querySelectorAll('.review__sheet-row')].find((r) => r.querySelector('[data-filter="new"]'))!
    expect(newRow.querySelector('.review__sheet-row-pick')?.textContent).toBe('· trip')
    // Closed and opened again: folded.
    await tapOn(q('.review__card'))
    await h.click(/Choose what to review/)
    expect([cog().getAttribute('aria-expanded'), part()]).toEqual(['false', null])
  })

  const orderRows = () =>
    [...part()!.querySelectorAll('[role="radiogroup"]')].map((g) => [g.getAttribute('aria-label'), [...g.querySelectorAll('button[role="radio"]')].map((r) => `${r.textContent}${r.getAttribute('aria-checked') === 'true' ? ' ✓' : ''}`)])

  it('YAZ-5707: "All cards" · Order Due first · Shuffle and "Due today" · Order In order · Shuffle (44 pt each); a tap keeps this phone`s pick for that row alone (the phone writes no settings file)', async () => {
    h = await reviewSetup(FILES, { dueShuffle: true })
    await h.click(/Choose what to review/)
    await h.click('Review settings')
    expect(orderRows()).toEqual([
      ['Order of All cards', ['Due first ✓', 'Shuffle']],
      ['Order of Due today', ['In order', 'Shuffle ✓']],
    ])
    await tapOn([...part()!.querySelectorAll<HTMLButtonElement>('button[data-order="shuffle"]')][0])
    await vi.waitFor(async () => expect(await readOrders(h!.store, VAULT)).toEqual({ all: 'shuffle', due: null }))
    await tapOn(part()!.querySelector<HTMLButtonElement>('button[data-order="in-order"]'))
    await vi.waitFor(async () => expect(await readOrders(h!.store, VAULT)).toEqual({ all: 'shuffle', due: 'in-order' }))
    expect(orderRows().map((r) => r[1])).toEqual([['Due first', 'Shuffle ✓'], ['In order ✓', 'Shuffle']])
  })

  it('YAZ-5707: with no pick of its own the phone follows the Mac`s Order rows (review.json `allCardsOrder`, `dueTodayOrder`)', async () => {
    h = await reviewSetup({ ...FILES, '.yaseendocs/review.json': '{"newPerDay": 10, "allCardsOrder": "shuffle", "dueTodayOrder": "in-order"}' })
    await h.click(/Choose what to review/)
    await h.click('Review settings')
    expect(orderRows().map((r) => r[1])).toEqual([['Due first', 'Shuffle ✓'], ['In order ✓', 'Shuffle']])
  })

  it('YAZ-5690: "Add today [N] Add" under From adds that many new cards for today (the Mac`s field, 44 pt); the foot says "Today: N cards"', async () => {
    h = await reviewSetup({ ...FILES, '.yaseendocs/review.json': '{"newPerDay": 1}' })
    await h.click(/Choose what to review/)
    const newCount = () => [...h!.host.querySelectorAll('.review__sheet-row')].find((r) => r.querySelector('[data-filter="new"]'))!.querySelector('.review__sheet-n')!.textContent
    expect(newCount()).toBe('1')
    await h.click('Review settings')
    const row = () => part()!.querySelector<HTMLElement>('li[data-setting="add"]')!
    const number = row().querySelector<HTMLInputElement>('input.card-inbox__add-number')!
    expect([row().firstElementChild!.textContent, number.value, number.inputMode, row().querySelector('button')!.textContent]).toEqual(['Add today', '1', 'numeric', 'Add'])
    // YAZ-5690 round 3: one tap asks in place ("Add 1 new card to today?", Cancel first); the second adds.
    await tapOn(row().querySelector('button')!)
    await h.settle()
    expect(newCount()).toBe('1')
    expect([...row().querySelectorAll('.ask-in-place button')].map((b) => b.textContent)).toEqual(['Cancel', 'Add'])
    expect(row().querySelector('.ask-in-place .confirm__text')!.textContent).toBe('Add 1 new card to today?')
    await tapOn(row().querySelectorAll<HTMLButtonElement>('.ask-in-place button')[1]!)
    await h.settle()
    expect(newCount()).toBe('2')
    expect(q('.review__sheet-foot')!.textContent).not.toMatch(/learned|reviews/)
  })

  it('YAZ-5690 round 2: the ⚙ part has "Up next" · "Add today [N] Add" while a card is marked Up next; a tap on a count only picks its filter', async () => {
    const UP = { ...FILES, '.yaseendocs/review.json': '{"newPerDay": 10, "upNextPerDay": 1}', 'trip/lisbon.md': page('Lisbon', cardBlock('L?', 'TR-1, next'), cardBlock('M?', 'TR-2, next')) }
    h = await reviewSetup(UP)
    await h.click(/Choose what to review/)
    await h.click('Review settings')
    expect([...part()!.querySelectorAll('h6')].map((x) => x.textContent)).toEqual(['New cards', 'Up next', 'All cards', 'Due today'])
    const add = part()!.querySelectorAll('section')[1]!.querySelector<HTMLButtonElement>('button.card-inbox__add-go')!
    expect(part()!.querySelectorAll('section')[1]!.querySelector('input')!.getAttribute('aria-label')).toBe('How many Up next cards to add')
    await tapOn(add)
    await h.settle()
    await tapOn(part()!.querySelectorAll('section')[1]!.querySelectorAll<HTMLButtonElement>('.ask-in-place button')[1]!)
    await h.settle()
    const nextCount = () => [...h!.host.querySelectorAll('.review__sheet-row')].find((r) => r.querySelector('[data-filter="next"]'))!.querySelector('.review__sheet-n')!.textContent
    expect(nextCount()).toBe('2 / 2')
    // Nothing waits now: no Up next group.
    expect([...part()!.querySelectorAll('h6')].map((x) => x.textContent)).toEqual(['New cards', 'All cards', 'Due today'])
  })

  it('YAZ-5690 round 2: no new card beyond today`s limit: Add today says "No more new cards in any folder"; no Up next waiting: no group', async () => {
    h = await reviewSetup(FILES)
    await h.click(/Choose what to review/)
    await h.click('Review settings')
    expect([...part()!.querySelectorAll('h6')].map((x) => x.textContent)).toEqual(['New cards', 'All cards', 'Due today'])
    expect([...part()!.querySelectorAll('li')].map((li) => li.getAttribute('data-setting'))).toEqual(['from', 'add', 'order', 'order'])
    expect(part()!.querySelector('li[data-setting="add"] .card-inbox__add-none')?.textContent).toBe('No more new cards in any folder')
  })
})
