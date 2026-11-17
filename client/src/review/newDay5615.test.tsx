/**
 * YAZ-5615 (checker c, against the YAZ-5611 rules): a new day during a review, on the review hook the Mac and the phone
 * both run (`useCardReview`, here with the in-memory host). Spec 21: the day is the local calendar day from midnight;
 * at midnight the counts and "Today: …" are the new day's; an open session keeps its queue. A Mac that sleeps over
 * midnight runs no timer (Chromium's timers stop while it sleeps): the new day must show as soon as the window is back
 * (focus, or the page shows again), as the Calendar view and Recent do. Made-up data only.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { cardBlock, cardRecords, parseCardLine } from '@shared/cardLine'
import { DEFAULT_REVIEW_SETTINGS, type ReviewSettings } from '@shared/reviews'
import type { IndexRecord } from '@shared/types'
import { useCardReview, type CardReviewApi } from './useCardReview'
import { memoryReviewHost, type MemoryReviewHost } from './memoryReviewHost'

;(globalThis as unknown as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true

const S: ReviewSettings = { ...DEFAULT_REVIEW_SETTINGS, newPerDay: 1, fuzz: false }
const ROOT = '/vault'
/** Friday 13 November 2026, 23:58 local time. */
const LATE = new Date(2026, 10, 13, 23, 58).getTime()
/** Saturday 14 November, 8:00: the Mac slept the night. */
const MORNING = new Date(2026, 10, 14, 8, 0).getTime()

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
function reindex(): void {
  records = [...host.files].map(([path, content]) => {
    const name = path.slice(path.lastIndexOf('/') + 1)
    return { path, name, basename: name.replace(/\.md$/, ''), title: name, folder: '', ext: 'md', size: content.length, ctime: 0, mtime: 0, properties: {}, aliases: [], tags: [], links: [], embeds: [], cards: cardRecords(content) }
  })
  listeners.forEach((l) => l())
}
const block = (id: string, line: string) => cardBlock(`Card ${id} {{answer}}`, parseCardLine(`<!-- card: ${id}${line} -->`)!)

let root: Root | null = null
let review: CardReviewApi
function Probe() {
  review = useCardReview(ROOT, source, S, () => undefined, undefined, host)
  return null
}
async function mount(): Promise<void> {
  reindex()
  root = createRoot(document.createElement('div'))
  await act(async () => root?.render(<Probe />))
}
const step = async (run: () => unknown): Promise<void> => {
  await act(async () => void (await run()))
  await act(async () => reindex())
  // The card on show is read from its page (a promise): let it land.
  for (let i = 0; i < 5; i++) await act(async () => void (await Promise.resolve()))
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date', 'setTimeout', 'clearTimeout'] })
  vi.setSystemTime(LATE)
  host = memoryReviewHost(
    new Map([
      // DUE-1 is due tonight; TOM-1 (two ✓ on 10 Nov, a wait of days) is due on Saturday, not tonight.
      [`${ROOT}/Known.md`, `# Known\n\n${block('DUE-1', ', 2026-08-01T09:00:00.000Z good, 2026-08-02T09:00:00.000Z good')}\n${block('TOM-1', ', 2026-11-10T09:00:00.000Z good, 2026-11-10T09:15:00.000Z good')}`],
      [`${ROOT}/Fresh.md`, `# Fresh\n\n${block('NEW-1', '')}\n${block('NEW-2', '')}`],
    ]),
  )
})
afterEach(() => {
  act(() => root?.unmount())
  root = null
  vi.useRealTimers()
})

/** The vault's counts as the Inbox row shows them, the session's lists, and today's work. */
const counts = () => ({ due: review.dueCount, today: review.session?.today.cards ?? null })

describe('YAZ-5615: a new day during a review (spec 21)', () => {
  it('tonight TOM-1 is not due; the setup is as the test means it', async () => {
    await mount()
    expect(review.dueCount).toBe(2) // DUE-1 and one new card
  })

  it('at midnight the vault count is the new day\'s and "Today" starts again; the open session keeps its queue', async () => {
    await mount()
    await step(() => review.start({}))
    await step(() => review.answer('good')) // DUE-1 done: a known card's ✓ lets it go
    // All cards is one run (YAZ-5707): the new card next, with no stop.
    expect(review.session!.end).toBeNull()
    expect(review.session!.card!.id).toBe('NEW-1')
    expect(counts()).toEqual({ due: 1, today: 1 })
    // Midnight: the review's own timer moves the day.
    await act(async () => void vi.advanceTimersByTime(3 * 60_000))
    // TOM-1 is due now, and Saturday has its own new card: NEW-1 (in the session) and the due card.
    expect(review.dueCount).toBe(2)
    expect(review.session!.today.cards).toBe(0)
    // The open session keeps its queue: the card on show stays, nothing of the new day joins it.
    expect(review.session!.card!.id).toBe('NEW-1')
    expect(review.session!.counts.all).toBe(1)
  })

  it('a Mac that slept over midnight (no timer ran): a focus of the window shows the new day', async () => {
    await mount()
    expect(review.dueCount).toBe(2)
    // The Mac sleeps from 23:58 to 8:00: the clock moved, the timer did not fire.
    vi.setSystemTime(MORNING)
    await act(async () => void window.dispatchEvent(new Event('focus')))
    // Saturday: DUE-1 (still due), TOM-1, and one new card.
    expect(review.dueCount).toBe(3)
  })

  it('the phone (or a Mac window) that comes back to the front after midnight shows the new day', async () => {
    await mount()
    vi.setSystemTime(MORNING)
    await act(async () => void document.dispatchEvent(new Event('visibilitychange')))
    expect(review.dueCount).toBe(3)
  })

  it('after the late wake the next midnight still moves the day', async () => {
    await mount()
    vi.setSystemTime(MORNING)
    await act(async () => void window.dispatchEvent(new Event('focus')))
    expect(review.dueCount).toBe(3)
    // Sunday 15 November: the new card limit starts again, one more new card (NEW-2) is due too.
    await step(() => review.start({}))
    await step(() => review.answer('good')) // DUE-1
    await step(() => review.answer('good')) // TOM-1
    await step(() => review.goOn()) // past "Due today is done."
    await step(() => review.answer('good')) // NEW-1 first ✓: added to today's reviews (YAZ-5702)
    expect(review.dueCount).toBe(1)
    await act(async () => void vi.advanceTimersByTime(new Date(2026, 10, 15).getTime() - Date.now() + 1_000))
    expect(review.dueCount).toBe(2) // NEW-1 added today, and NEW-2 for Sunday
  })

  it('a focus on the same day changes no count', async () => {
    await mount()
    await step(() => review.start({}))
    const before = { dueCount: review.dueCount, counts: review.session!.counts }
    vi.setSystemTime(LATE + 60_000)
    await act(async () => void window.dispatchEvent(new Event('focus')))
    expect({ dueCount: review.dueCount, counts: review.session!.counts }).toEqual(before)
  })
})
