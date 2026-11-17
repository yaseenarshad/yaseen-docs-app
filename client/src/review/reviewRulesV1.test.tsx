/**
 * Review rules v1 (YAZ-5657; the LOCKED comment "## LOCKED — Review rules v1" on YAZ-5655): one test per rule that
 * changed, each named by its number, plus rule 13 and the "kept" list. They run the ONE session code both apps share:
 * `useCardReview` with an in-memory host (the phone's host is the same interface, `reviewHost.ts`) and `cardPlan` /
 * `cardHistory` of `@shared/cardSchedule`. Made-up cards only.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { cardBlock, cardRecords, cardReviewsOf, cardTime, pageCards, parseCardLine, type CardRating, type CardReview } from '@shared/cardLine'
import { CARD_LEARNING_STEPS, CARD_RELEARNING_STEPS, answerLabel, answerRatings, cardHistory, cardPlan, isCardDue, reviewedToday } from '@shared/cardSchedule'
import { DEFAULT_REVIEW_SETTINGS, type ReviewSettings } from '@shared/reviews'
import type { IndexRecord } from '@shared/types'
import { useCardReview, type CardReviewApi } from './useCardReview'
import { memoryReviewHost, type MemoryReviewHost } from './memoryReviewHost'

const S: ReviewSettings = { ...DEFAULT_REVIEW_SETTINGS, fuzz: false }
const NOW = new Date(2026, 10, 12, 9, 0).getTime()
const ROOT = '/rules'
const DAY = 86_400_000

let host: MemoryReviewHost
let records: IndexRecord[] = []
let listeners: Array<() => void> = []
const source = {
  get records() {
    return records
  },
  folders: [] as IndexRecord[],
  subscribe(l: () => void) {
    listeners.push(l)
    return () => (listeners = listeners.filter((x) => x !== l))
  },
}
function scan(path: string, content: string): IndexRecord {
  const name = path.slice(path.lastIndexOf('/') + 1)
  // The mtime follows the text, as a file's does: the card on show is read again when the other device wrote it.
  return { path, name, basename: name.replace(/\.md$/, ''), title: name.replace(/\.md$/, ''), folder: '', ext: 'md', size: content.length, ctime: 0, mtime: content.length, properties: {}, aliases: [], tags: [], links: [], embeds: [], cards: cardRecords(content) }
}
function reindex(): void {
  records = [...host.files].map(([path, content]) => scan(path, content))
  listeners.forEach((l) => l())
}
/** A page of cards: `[id, line after the id]`. */
const page = (name: string, ...cards: [string, string][]): void => {
  host.files.set(`${ROOT}/${name}`, `# ${name}\n\n${cards.map(([id, rest]) => cardBlock(`Card ${id} {{x}}`, parseCardLine(`<!-- card: ${id}${rest} -->`)!)).join('\n')}`)
}
const reviewsOf = (name: string, id: string): CardReview[] => cardReviewsOf(pageCards(host.files.get(`${ROOT}/${name}`)!).find((c) => c.line.parts.some((p) => p.kind === 'id' && p.id === id))!.line)
/** Two ✓ on day `d` of 2026 (month `m`): a known card, out of its steps, due long before today. */
const known = (m: number, d = 1) => `, 2026-0${m}-0${d}T09:00:00.000Z good, 2026-0${m}-0${d}T09:01:00.000Z good`
/** The other device's answer: the file changes, then the index has it (a sync). */
const elsewhere = async (name: string, id: string, rating: CardRating, at = Date.now()) => {
  await host.writeCardAnswer(`${ROOT}/${name}`, id, { at: cardTime(at), rating })
  await act(async () => reindex())
}

;(globalThis as unknown as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true
let root: Root | null = null
let review: CardReviewApi
function Probe({ settings }: { settings: ReviewSettings }) {
  review = useCardReview(ROOT, source, settings, () => undefined, undefined, host)
  return null
}
async function mount(settings: ReviewSettings = S): Promise<void> {
  reindex()
  root = createRoot(document.createElement('div'))
  await act(async () => root?.render(<Probe settings={settings} />))
  await act(async () => review.start())
}
const step = async (run: () => unknown): Promise<void> => {
  await act(async () => void (await run()))
  await act(async () => reindex())
}
const shown = async (id: string) => vi.waitFor(() => expect(review.session?.card).toMatchObject({ id, page: { id } }))
const answer = async (id: string, rating: CardRating, wait = 20_000): Promise<void> => {
  await shown(id)
  await act(async () => void review.showAnswers())
  vi.setSystemTime(Date.now() + wait)
  await step(() => review.answer(rating))
}
const reopen = async () => {
  await act(async () => review.close())
  await act(async () => review.start())
}
const plan = (settings: ReviewSettings = S, taken: readonly string[] = []) => cardPlan(records, settings, Date.now(), '', undefined, undefined, taken)

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(NOW)
  host = memoryReviewHost(new Map(), 'Rules vault')
})
afterEach(() => {
  act(() => root?.unmount())
  root = null
  vi.useRealTimers()
})

describe('Review rules v1 (YAZ-5655, built in YAZ-5657)', () => {
  it('rule 2: a ✕ on a new card keeps it New until its first ✓, also when the Inbox opens again; it counts once against New cards a day', async () => {
    page('N.md', ['NEW-1', ''], ['NEW-2', ''], ['NEW-3', ''])
    await mount({ ...S, newPerDay: 2 })
    expect(review.session?.counts).toMatchObject({ all: 2, due: 0, new: 2 })
    await answer('NEW-1', 'again')
    expect(review.session?.counts).toMatchObject({ all: 2, due: 0, new: 2 })
    await reopen()
    // Still a New card (Mochi), and it holds the one place it took: NEW-2 is the other; NEW-3 waits.
    expect(review.session?.counts).toMatchObject({ all: 2, due: 0, new: 2 })
    expect(plan({ ...S, newPerDay: 2 }).queue.map((c) => [c.id, c.isNew])).toEqual([['NEW-1', true], ['NEW-2', true]])
    // Its first ✓ moves it to Due today (rule 3), the same day.
    await answer('NEW-1', 'good')
    expect(review.session?.counts).toMatchObject({ all: 2, due: 1, new: 1 })
    // The next day a ✕-only card begun before is still a New card and holds its place: the limit takes 2 more.
    page('O.md', ['OLD-1', ', 2026-11-10T09:00:00.000Z again'])
    reindex()
    vi.setSystemTime(NOW + DAY)
    expect(plan({ ...S, newPerDay: 2 }).queue.filter((c) => c.isNew).map((c) => c.id)).toEqual(['OLD-1', 'NEW-2', 'NEW-3'])
  })

  it('rule 5: inside Due today the most overdue day comes first, then one random order for the day (not the ID order)', () => {
    host.files.clear()
    // Twelve cards due on one day (all begun on 1 March), and two more overdue (begun in February).
    const same = Array.from({ length: 12 }, (_, i): [string, string] => [`SAME-${i + 1}`, known(3)])
    page('D.md', ['FEB-2', known(2, 2)], ...same, ['FEB-1', known(2, 1)])
    reindex()
    const ids = plan().queue.map((c) => c.id)
    expect(ids.slice(0, 2)).toEqual(['FEB-1', 'FEB-2'])
    const day = ids.slice(2)
    expect(new Set(day)).toEqual(new Set(same.map(([id]) => id)))
    expect(day).not.toEqual(same.map(([id]) => id))
    // One order for the day: a redraw keeps it; the next day shuffles again.
    expect(plan().queue.map((c) => c.id)).toEqual(ids)
    vi.setSystemTime(NOW + DAY)
    expect(plan().queue.map((c) => c.id).slice(2)).not.toEqual(day)
  })

  it('rule 7: each card is in one list only — a due Up next card is under Up next alone, so All cards = Up next + Due today + New cards', async () => {
    page('A.md', ['UP-1', `, next${known(5)}`], ['DUE-1', known(6)], ['DUE-2', known(7)], ['NEW-1', ''])
    await mount()
    expect(review.session?.counts).toEqual({ all: 4, next: 1, due: 2, new: 1 })
    await act(async () => review.setFilter('due'))
    expect([review.session?.card?.id, review.session?.progress.total]).toEqual(['DUE-1', 2])
    await act(async () => review.setFilter('next'))
    expect([review.session?.card?.id, review.session?.progress.total]).toEqual(['UP-1', 1])
  })

  it('rule 8: the % screen counts every card answered in that pass, an Up next card too (a new one as well)', async () => {
    page('A.md', ['UP-1', ', next'], ['DUE-1', known(5)], ['DUE-2', known(6)])
    await mount()
    await answer('UP-1', 'good')
    await answer('DUE-1', 'again')
    await answer('DUE-2', 'good')
    expect(review.session?.end).toMatchObject({ kind: 'missed', count: 3, remembered: 2, percent: 67, missed: 1 })
  })

  it('rule 10: an Up next card never takes a New cards place — not in the session, not after the Inbox opens again; a card begun as a plain new card keeps its place', async () => {
    page('A.md', ['UP-1', ', next'], ['NEW-1', ''], ['NEW-2', ''])
    await mount({ ...S, newPerDay: 1 })
    expect(review.session?.counts).toEqual({ all: 2, next: 1, due: 0, new: 1 })
    await answer('UP-1', 'again')
    // UP-1 is a New card now (its mark went with the answer, rule 2), and NEW-1 is still today's new card.
    expect(review.session?.counts).toEqual({ all: 2, next: 0, due: 0, new: 2 })
    await reopen()
    expect(review.session?.counts).toEqual({ all: 2, next: 0, due: 0, new: 2 })
    expect(review.dueCount).toBe(2)
  })

  it('rule 10: a card begun as a plain new card, then marked Up next and answered, keeps the New cards place it took', async () => {
    page('A.md', ['NEW-1', ''], ['NEW-2', ''])
    await mount({ ...S, newPerDay: 1 })
    await answer('NEW-1', 'again')
    await step(() => review.setNext(`${ROOT}/A.md`, 'NEW-1', true))
    await reopen()
    expect(review.session?.counts).toEqual({ all: 1, next: 1, due: 0, new: 0 })
    await answer('NEW-1', 'good')
    await reopen()
    expect(plan({ ...S, newPerDay: 1 }, host.upNextTakenToday(ROOT)).queue.map((c) => c.id)).toEqual(['NEW-1'])
  })

  it('rule 11: an Archive that frees a New cards place brings the next new card into the open session at once', async () => {
    page('A.md', ['NEW-1', ''], ['NEW-2', ''])
    await mount({ ...S, newPerDay: 1 })
    expect(review.session?.counts.all).toBe(1)
    await shown('NEW-1')
    await step(() => review.turnOff())
    await shown('NEW-2')
    expect(review.session?.counts).toMatchObject({ all: 1, new: 1 })
  })

  it('rule 11: Reset on the "Due today is done." stop never shows a card that is not in today`s list', async () => {
    page('A.md', ['DUE-1', known(5)], ['NEW-1', ''], ['NEW-2', ''])
    await mount({ ...S, newPerDay: 1 })
    await step(() => review.addCards('new', 1))
    // NEW-1 begun under New cards (its first ✓), then DUE-1 under All cards: the stop, with NEW-2 under it.
    await act(async () => review.setFilter('new'))
    await answer('NEW-1', 'good')
    await act(async () => review.setFilter('all'))
    await answer('DUE-1', 'good')
    expect(review.session?.end?.kind).toBe('done')
    // Reset: today's number back to 1, which NEW-1 used. NEW-2 is not in today's list, so it never shows.
    await step(() => review.resetCards('new'))
    await act(async () => review.goOn())
    await shown('NEW-1')
    await answer('NEW-1', 'good')
    expect(review.session?.card).toBeNull()
    expect(reviewsOf('A.md', 'NEW-2')).toEqual([])
  })

  it('rule 12: cards begun on the other device join the open session after a sync, as Due today cards for their second ✓', async () => {
    page('A.md', ['DUE-1', known(5)], ['NEW-1', ''], ['NEW-2', ''])
    await mount({ ...S, newPerDay: 1 })
    expect(review.session?.counts).toEqual({ all: 2, next: 0, due: 1, new: 1 })
    // The phone begins NEW-2 (past the Mac's one place: the phone has its own order).
    await elsewhere('A.md', 'NEW-2', 'good')
    // The vault's one place is used by NEW-2: NEW-1 leaves, NEW-2 joins as a Due today card.
    expect(review.session?.counts).toEqual({ all: 2, next: 0, due: 2, new: 0 })
    await answer('DUE-1', 'good')
    await act(async () => review.goOn())
    await shown('NEW-2')
    expect(review.session?.card?.isNew).toBe(false)
    await answer('NEW-2', 'good', 70_000)
    expect(reviewsOf('A.md', 'NEW-2').map((r) => r.rating)).toEqual(['good', 'good'])
    expect(review.session?.card).toBeNull()
  })

  it('rule 13 (kept): the day starts at local midnight', () => {
    const midnight = new Date(2026, 10, 13).getTime()
    expect(isCardDue(midnight - 1, NOW)).toBe(true)
    expect(isCardDue(midnight, NOW)).toBe(false)
    expect(reviewedToday([{ cards: [{ id: 'A-1', off: false, next: false, reviews: [{ at: cardTime(midnight - 1), rating: 'good' }] } as never] }], midnight).reviews).toBe(0)
  })

  describe('rule 14: "the same day" for the schedule is the LOCAL day', () => {
    const was = process.env.TZ
    afterEach(() => {
      if (was === undefined) delete process.env.TZ
      else process.env.TZ = was
    })
    it('in Denver, a ✕ at 16:00 and a ✓ at 18:00 are one day (UTC midnight falls between them), as the same two in London', () => {
      /** The waits FSRS gives for the log, by local clock times (October 2026: day, hour, minute), on a device in `zone`. */
      const waits = (zone: string) => {
        process.env.TZ = zone
        const log: [number, number, number, CardRating][] = [[1, 9, 0, 'good'], [1, 9, 1, 'good'], [12, 16, 0, 'again'], [12, 18, 0, 'good']]
        return cardHistory(log.map(([d, h, m, rating]) => ({ at: cardTime(new Date(2026, 9, d, h, m).getTime()), rating })), S).map((r) => r.interval)
      }
      // 16:00 and 18:00 in Denver are 22:00 and 00:00 UTC: by the UTC day they were two days, so the wait came out longer.
      expect(waits('America/Denver')).toEqual(waits('Europe/London'))
    })
  })

  it('rule 15: an answer saves the time the button was PRESSED — pressed after midnight, it is the new day`s work', async () => {
    page('A.md', ['DUE-1', known(5)])
    vi.setSystemTime(new Date(2026, 10, 12, 23, 59, 30).getTime())
    await mount()
    await shown('DUE-1')
    await act(async () => void review.showAnswers())
    const pressed = new Date(2026, 10, 13, 0, 0, 10).getTime()
    vi.setSystemTime(pressed)
    await step(() => review.answer('good'))
    expect(reviewsOf('A.md', 'DUE-1').at(-1)?.at).toBe(cardTime(pressed))
    expect(reviewedToday(records, pressed).reviews).toBe(1)
  })

  it('rule 16: two answers on one card in the same millisecond — the second gets +1 ms', async () => {
    page('A.md', ['DUE-1', known(5)])
    await mount()
    await shown('DUE-1')
    // The other device answered at this very millisecond; the clock does not move before this answer.
    await elsewhere('A.md', 'DUE-1', 'again', NOW)
    await shown('DUE-1')
    await vi.waitFor(() => expect(review.session?.card?.page?.reviews).toHaveLength(3))
    // The same millisecond as the other device's answer (`waitFor` moved the fake clock).
    vi.setSystemTime(NOW)
    await step(() => review.answer('good'))
    expect(reviewsOf('A.md', 'DUE-1').slice(-2).map((r) => r.at)).toEqual([cardTime(NOW), cardTime(NOW + 1)])
  })

  it('kept: the names, two buttons (four as a setting), learning steps 1m 1m, relearning 1m', () => {
    expect(answerRatings(S).map((r) => answerLabel(r, S))).toEqual(['Forgot', 'Remembered'])
    expect(answerRatings({ ...S, buttons: 4 }).map((r) => answerLabel(r, { ...S, buttons: 4 }))).toEqual(['Again', 'Hard', 'Good', 'Easy'])
    expect([CARD_LEARNING_STEPS, CARD_RELEARNING_STEPS]).toEqual([['1m', '1m'], ['1m']])
  })
})
