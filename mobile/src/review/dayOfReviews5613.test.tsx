// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cardBlock, mountReview, page, reviewSetup, type ReviewHarness } from './testing'

/**
 * YAZ-5613 (checker a, against the YAZ-5611 rules): a full day of reviews on the phone, step by step — the same day
 * as the Mac's `client/src/review/dayOfReviews5613.test.tsx`, on the real Review screen (the real engine and answer
 * list on the fake GitHub). Each step reads what the screen says: the card, "N / M", the bar, the sheet's counts.
 *
 * The rules: a ✕ never grows a count, M or the bar's whole; Up next, Due today, then New cards; a missed due card
 * comes back after the other due cards; a new card needs two ✓, and its first ✓ moves it from New cards into Due today
 * (Yaseen's Mochi rule); the two stops of Due today; Undo; the Review tab opened again the same day keeps each card in
 * its list. Made-up data only.
 */
const NOW = new Date(2026, 10, 12, 9, 0).getTime()
const block = (id: string, line: string) => cardBlock(`Card ${id}?\n---\n{{answer}}`, `${id}${line}`)
const FILES = {
  '.yaseendocs/review.json': '{"newPerDay": 2}',
  'Up.md': page('Up', block('UP-1', ', 2026-11-01T09:00:00.000Z good, 2026-11-11T09:00:00.000Z good, next')),
  'Known.md': page(
    'Known',
    block('DUE-1', ', 2026-08-01T09:00:00.000Z good, 2026-08-02T09:00:00.000Z good'),
    block('DUE-2', ', 2026-08-05T09:00:00.000Z good, 2026-08-06T09:00:00.000Z good'),
    block('DUE-3', ', 2026-08-10T09:00:00.000Z good, 2026-08-11T09:00:00.000Z good'),
  ),
  'Fresh.md': page('Fresh', ...['NEW-1', 'NEW-2', 'NEW-3', 'NEW-4'].map((id) => block(id, ''))),
  'Later.md': page('Later', block('LAT-1', ', 2026-11-01T09:00:00.000Z good, 2026-11-11T09:00:00.000Z good')),
}

let h: ReviewHarness | undefined
beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(NOW)
  window.matchMedia = ((q: string) => ({ matches: q.includes('reduce'), media: q, addEventListener() {}, removeEventListener() {} })) as unknown as typeof window.matchMedia
})
afterEach(() => {
  h?.unmount()
  h = undefined
  vi.useRealTimers()
})
vi.mock('@client/review/confetti', () => ({ confettiBurst: () => () => undefined }))

const q = (sel: string) => h!.host.querySelector<HTMLElement>(sel)
/** The card's ID on show, else the stop or the done screen. */
const card = (): string => {
  if (q('.review__card') !== null) return /[A-Z]+-\d+/.exec(h!.head())?.[0] ?? h!.head()
  const end = q('.due-end')
  if (end !== null) return `stop: ${end.dataset.kind}`
  return `done: ${q('.review__done-title')?.textContent ?? ''}`
}
/** The sheet's counts, by filter: the sheet opened, read, closed. */
const sheet = async (): Promise<Record<string, string>> => {
  await h!.click(/Choose what to review/)
  const rows = Object.fromEntries([...h!.host.querySelectorAll('.review__sheet-row')].map((r) => [r.querySelector<HTMLElement>('[data-filter]')!.dataset.filter!, (r.querySelector('.review__sheet-n')?.textContent ?? '').trim()]))
  await h!.click(/Choose what to review/)
  return rows
}
const look = async () => {
  const bar = q('.review__progress')
  const place = q('.review__card') === null ? null : (q('.review__place')?.textContent ?? '').replace(/\s+/g, ' ').trim()
  return { card: card(), place, bar: `${bar?.getAttribute('aria-valuenow')}/${bar?.getAttribute('aria-valuemax')}`, menu: await sheet() }
}
const row = (card: string, place: string | null, bar: string, all: number, due: number, fresh: number, next?: number) => ({
  card,
  place,
  bar,
  menu: { all: String(all), due: String(due), new: String(fresh), ...(next !== undefined && { next: String(next) }) },
})
/** An answer, 20 s after the last one (a person reads the card). */
const answer = async (name: 'Remembered' | 'Forgot') => {
  vi.setSystemTime(Date.now() + 20_000)
  await h!.click(name)
}
/** Undo from the ⋯ (the line's Undo goes once the sheet opened, as after any first tap; Undo stays in ⋯). */
const undo = async () => {
  await h!.click('More card actions')
  await h!.click(/^Undo/)
}
/** The Review tab drawn again on the same vault (closed and opened again): a new session. */
const reopen = async (after: number) => {
  vi.setSystemTime(Date.now() + after)
  const t = h!
  t.unmount()
  h = await mountReview(t as unknown as Parameters<typeof mountReview>[0])
}

describe('YAZ-5613: a full day of reviews on the phone, step by step (YAZ-5611 rules)', () => {
  it('morning: Up next, Due today with misses, the two stops, Undo, the new cards (two ✓ each, New → Due today)', async () => {
    h = await reviewSetup(FILES)
    const steps: [string, () => Promise<void>, ReturnType<typeof row>][] = [
      // Review rules v1, rule 7: UP-1 is under Up next only (before: Due today 4, with UP-1 in it too).
      ['start', async () => undefined, row('UP-1', '1 / 6', '0/6', 6, 3, 2, 1)],
      ['UP-1 ✓', () => answer('Remembered'), row('DUE-1', '2 / 6', '1/6', 5, 3, 2)],
      ['DUE-1 ✕', () => answer('Forgot'), row('DUE-2', '3 / 6', '1/6', 5, 3, 2)],
      ['DUE-2 ✓', () => answer('Remembered'), row('DUE-3', '4 / 6', '2/6', 4, 2, 2)],
      ['DUE-3 ✓', () => answer('Remembered'), row('stop: missed', null, '3/6', 3, 1, 2)],
      ['Review missed cards', () => h!.click('Review missed cards 1'), row('DUE-1', '4 / 6', '3/6', 3, 1, 2)],
      ['DUE-1 ✕ again', () => answer('Forgot'), row('DUE-1', '4 / 6', '3/6', 3, 1, 2)],
      ['Undo (in ⋯)', undo, row('DUE-1', '4 / 6', '3/6', 3, 1, 2)],
      ['DUE-1 ✕ again', () => answer('Forgot'), row('DUE-1', '4 / 6', '3/6', 3, 1, 2)],
      ['DUE-1 ✓', () => answer('Remembered'), row('stop: done', null, '4/6', 2, 0, 2)],
      ['Learn new cards', () => h!.click('Learn new cards 2'), row('NEW-1', '5 / 6', '4/6', 2, 0, 2)],
      ['NEW-1 ✓ (first)', () => answer('Remembered'), row('NEW-2', '6 / 6', '4/6', 2, 1, 1)],
      ['NEW-2 ✕', () => answer('Forgot'), row('NEW-1', '6 / 6', '4/6', 2, 1, 1)],
      ['NEW-1 ✓ (second)', () => answer('Remembered'), row('NEW-2', '6 / 6', '5/6', 1, 0, 1)],
      ['NEW-2 ✓ (first)', () => answer('Remembered'), row('NEW-2', '6 / 6', '5/6', 1, 1, 0)],
      ['NEW-2 ✓ (second)', () => answer('Remembered'), row('done: Inbox complete.', null, '6/6', 0, 0, 0)],
    ]
    const seen = []
    const want = []
    for (const [name, run, expected] of steps) {
      await run()
      seen.push({ step: name, ...(await look()) })
      want.push({ step: name, ...expected })
    }
    expect(seen).toEqual(want)
  })

  it('the Review tab opened again the same day: the same cards in the same lists (a begun new card in Due today), no third new card', async () => {
    h = await reviewSetup(FILES)
    for (let i = 0; i < 4; i++) await answer('Remembered')
    await h.click('Learn new cards 2')
    await answer('Remembered') // NEW-1's first ✓
    expect(await look()).toEqual(row('NEW-2', '6 / 6', '4/6', 2, 1, 1))
    await reopen(60 * 60_000)
    expect(await look()).toEqual(row('NEW-1', '1 / 2', '0/2', 2, 1, 1))
    await answer('Remembered')
    expect(await look()).toEqual(row('stop: done', null, '1/2', 1, 0, 1))
    await h.click('Learn new cards 1')
    await answer('Remembered')
    await answer('Remembered')
    expect(await look()).toEqual(row('done: Inbox complete.', null, '2/2', 0, 0, 0))
    // The next day, 9:00: the new-card limit starts again (NEW-3, NEW-4), and no card of yesterday is a new card.
    vi.setSystemTime(new Date(2026, 10, 13, 9, 0).getTime())
    await reopen(0)
    const next = (await look()).menu
    expect(next.new).toBe('2')
    expect(Number(next.all)).toBe(Number(next.due) + Number(next.new))
  })

  // Open item 1 of YAZ-5613, settled by Review rules v1, rule 2 (as on the Mac): a new card's ✕ keeps it a New card,
  // also after the tab opens again (it was `it.fails`).
  it('rule 2: a new card ✕ once, then the tab opened again: it stays in its list, and no count jumps', async () => {
    h = await reviewSetup(FILES)
    for (let i = 0; i < 4; i++) await answer('Remembered')
    await h.click('Learn new cards 2')
    await answer('Forgot') // NEW-1 ✕: it stays under New cards
    const inSession = await look()
    expect(inSession).toEqual(row('NEW-2', '6 / 6', '4/6', 2, 0, 2))
    await reopen(60_000)
    expect((await look()).menu).toEqual(inSession.menu)
  })
})
