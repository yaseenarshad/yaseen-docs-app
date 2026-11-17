// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cardBlock, page, reviewSetup, type ReviewHarness } from './testing'

/**
 * YAZ-5616 (checker d, real taps on the phone; the YAZ-5611 rules): new cards begun in the New cards list, then the
 * rest of the day under another list. A new card needs two ✓ the same day (Yaseen's rule): its first ✓ moves it into
 * Due today and it comes back in the same session. The real-touch proof (`publish/proveReviewTaps.ts`) found the bug:
 * the end of Due today ("Due today is done.") counted only the plain new cards, so with none left it offered nothing
 * and the session ended with the begun cards still in it (the bar at 5 / 8). The Mac's twin:
 * `client/src/review/newListFirst5616.test.tsx`. Made-up data only.
 */
const NOW = new Date(2026, 10, 12, 9, 0).getTime()
const block = (id: string, line: string) => cardBlock(`Card ${id}?\n---\n{{answer}}`, `${id}${line}`)
const FILES = {
  '.yaseendocs/review.json': '{"newPerDay": 2}',
  'Known.md': page('Known', block('DUE-1', ', 2026-08-01T09:00:00.000Z good, 2026-08-02T09:00:00.000Z good'), block('DUE-2', ', 2026-08-05T09:00:00.000Z good, 2026-08-06T09:00:00.000Z good')),
  'Fresh.md': page('Fresh', ...['NEW-1', 'NEW-2', 'NEW-3'].map((id) => block(id, ''))),
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
const card = (): string => {
  if (q('.review__card') !== null) return /[A-Z]+-\d+/.exec(h!.head())?.[0] ?? h!.head()
  const end = q('.due-end')
  if (end !== null) return `stop: ${end.dataset.kind}`
  return `done: ${q('.review__done-title')?.textContent ?? ''}`
}
const answer = async (name: 'Remembered' | 'Forgot') => {
  vi.setSystemTime(Date.now() + 20_000)
  await h!.click(name)
}
const pick = async (list: string) => {
  await h!.click(/Choose what to review/)
  await h!.click(list)
}
/** Every card the screen shows from here, each ✓, through the stops' one button, to the done screen. */
const rest = async (): Promise<string[]> => {
  const seen: string[] = []
  for (let i = 0; i < 20; i++) {
    const now = card()
    seen.push(now)
    if (now === 'stop: done' && q('.due-end__go') !== null) await h!.click(/^Learn new cards/)
    else if (now.startsWith('stop') || now.startsWith('done')) break
    else await answer('Remembered')
  }
  return seen
}

describe('YAZ-5616: new cards begun in the New cards list come back the same day (phone)', () => {
  it('then All cards: the due cards, "Due today is done." offers the 2 begun cards, their second ✓, Inbox complete', async () => {
    h = await reviewSetup(FILES)
    await pick('New cards')
    await answer('Remembered') // NEW-1's first ✓: it moves into Due today, out of this list
    await answer('Remembered') // NEW-2's first ✓
    // YAZ-5678 (Mochi's words): the learned cards wait under Due today; its button goes there.
    expect(card()).toBe('done: Finished learning cards.')
    await h.click('Review cards 4')
    expect(await rest()).toEqual(['DUE-1', 'DUE-2', 'stop: done', 'NEW-1', 'NEW-2', 'done: Inbox complete.'])
    // YAZ-5675 (Mochi): Due today counts the 2 due cards and the 2 learned cards' second ✓.
    expect(q('.review__progress')?.getAttribute('aria-valuenow')).toBe('4')
    expect(q('.review__progress')?.getAttribute('aria-valuemax')).toBe('4')
  })

  it('then Due today: the begun cards are Due today cards, so its end leads on to them', async () => {
    h = await reviewSetup(FILES)
    await pick('New cards')
    await answer('Remembered')
    await answer('Remembered')
    await pick('Due today')
    // Nothing is left in any list: the vault's done screen.
    expect(await rest()).toEqual(['DUE-1', 'DUE-2', 'stop: done', 'NEW-1', 'NEW-2', 'done: Inbox complete.'])
  })
})
