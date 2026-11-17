/**
 * REVIEW NUMBERS LIKE MOCHI (YAZ-5672): Mochi's measured numbers (YAZ-5671 findings 1–20) as the expected values, run on
 * the ONE session code both apps share (`useCardReview` with an in-memory host; the phone's host is the same interface).
 * The harness began as YAZ-5669's scripted 10-card audit. Made-up cards only.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { cardBlock, cardRecords, cardReviewsOf, cardTime, pageCards, parseCardLine, type CardRating, type CardReview } from '@shared/cardLine'
import { answerLabel, answerRatings, cardHistory, cardPlan, isCardDue, reviewedToday } from '@shared/cardSchedule'
import { DEFAULT_REVIEW_SETTINGS, sanitizeReviewSettings, type ReviewSettings } from '@shared/reviews'
import type { IndexRecord } from '@shared/types'
import { useCardReview, type CardReviewApi } from './useCardReview'
import { todayDone } from './reviewTime'
import { memoryReviewHost, type MemoryReviewHost } from './memoryReviewHost'

// Due today In order: these tests read the plan's order (YAZ-5707's Shuffle has its own tests below).
const S: ReviewSettings = { ...DEFAULT_REVIEW_SETTINGS, fuzz: false, dueTodayOrder: 'in-order' }
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
/** Two ✓ on day `d` of 2026 (month `m`): a known card, due long before today. */
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


/** The top right as Mochi shows it: "✕ 2 · 4 / 6", then the bar's grey and red ends in % and the menu's counts. */
const top = (): string => {
  const s = review.session!
  const { done, total, waiting } = s.progress
  const pct = (n: number) => Math.round((100 * n) / Math.max(1, total))
  return `${s.misses > 0 ? `✕ ${s.misses} · ` : ''}${done} / ${total} | grey ${pct(done)} red ${pct(done + waiting)} | all ${s.counts.all} due ${s.counts.due} new ${s.counts.new}`
}
/** Answers the card on show. */
const go = async (r: CardRating) => {
  const id = review.session?.card?.id
  if (id === undefined) throw new Error(`no card on show: ${JSON.stringify(review.session?.end)}`)
  await answer(id, r)
}
const dueCards = (n: number) => page('D.md', ...Array.from({ length: n }, (_, i): [string, string] => [`DUE-${i + 1}`, known(9)]))
const newCards = (n: number) => page('N.md', ...Array.from({ length: n }, (_, i): [string, string] => [`NEW-${i + 1}`, '']))

describe('YAZ-5675: what each answer does to the numbers (Mochi, YAZ-5671)', () => {
  it('finding 15: 4 due cards, Forgot Forgot Remembered Remembered, then the missed pass', async () => {
    dueCards(4)
    await mount()
    await act(async () => review.setFilter('due'))
    expect(top()).toBe('0 / 4 | grey 0 red 0 | all 4 due 4 new 0')
    await go('again')
    expect(top()).toBe('✕ 1 · 1 / 5 | grey 20 red 40 | all 4 due 4 new 0')
    await go('again')
    expect(top()).toBe('✕ 2 · 2 / 6 | grey 33 red 67 | all 4 due 4 new 0')
    await go('good')
    expect(top()).toBe('✕ 2 · 3 / 6 | grey 50 red 83 | all 3 due 3 new 0')
    await go('good')
    expect(top()).toBe('✕ 2 · 4 / 6 | grey 67 red 100 | all 2 due 2 new 0')
    expect(review.session?.end).toMatchObject({ kind: 'missed', percent: 50, missed: 2 })
    await act(async () => review.goOn())
    // The missed pass: the ✕ goes; a Forgot moves nothing; each Remembered takes 1 off the total.
    expect(top()).toBe('4 / 6 | grey 67 red 100 | all 2 due 2 new 0')
    await go('again')
    expect(top()).toBe('4 / 6 | grey 67 red 100 | all 2 due 2 new 0')
    await go('good')
    expect(top()).toBe('4 / 5 | grey 80 red 100 | all 1 due 1 new 0')
    await go('good')
    expect(top()).toBe('4 / 4 | grey 100 red 100 | all 0 due 0 new 0')
  })

  it('findings 11 and 4: New cards — a Forgot moves nothing; a Remembered is done +1, New −1 and Due today +1', async () => {
    newCards(4)
    await mount()
    await act(async () => review.setFilter('new'))
    expect(top()).toBe('0 / 4 | grey 0 red 0 | all 4 due 0 new 4')
    await go('again')
    expect(top()).toBe('0 / 4 | grey 0 red 0 | all 4 due 0 new 4')
    await go('good')
    expect(top()).toBe('1 / 4 | grey 25 red 25 | all 4 due 1 new 3')
    await go('good')
    await go('good')
    expect(top()).toBe('3 / 4 | grey 75 red 75 | all 4 due 3 new 1')
    // The forgotten card comes back until you get it.
    await go('again')
    expect(top()).toBe('3 / 4 | grey 75 red 75 | all 4 due 3 new 1')
    await go('good')
    expect(top()).toBe('4 / 4 | grey 100 red 100 | all 4 due 4 new 0')
  })

  it('findings 5, 6 and 18: All cards — a due Forgot adds 1 to the total, a new card learned adds 1; the numbers survive a filter switch', async () => {
    dueCards(1)
    newCards(1)
    await mount()
    expect(top()).toBe('0 / 2 | grey 0 red 0 | all 2 due 1 new 1')
    await go('again')
    expect(top()).toBe('✕ 1 · 1 / 3 | grey 33 red 67 | all 2 due 1 new 1')
    await go('good')
    expect(top()).toBe('✕ 1 · 2 / 4 | grey 50 red 75 | all 2 due 2 new 0')
    await act(async () => review.setFilter('new'))
    expect(top()).toBe('1 / 1 | grey 100 red 100 | all 2 due 2 new 0')
    await act(async () => review.setFilter('all'))
    expect(top()).toBe('✕ 1 · 2 / 4 | grey 50 red 75 | all 2 due 2 new 0')
  })

  it('⌘Z takes the numbers back with the answer', async () => {
    dueCards(3)
    await mount()
    await go('again')
    expect(top()).toBe('✕ 1 · 1 / 4 | grey 25 red 50 | all 3 due 3 new 0')
    await step(() => review.undo())
    expect(top()).toBe('0 / 3 | grey 0 red 0 | all 3 due 3 new 0')
  })
})

describe('YAZ-5679: "Added card to reviews · Undo" when a new card is learned (Mochi, YAZ-5671 findings 11, 20)', () => {
  it('a new card`s Remembered sets `learned`; its Forgot, a due card`s answer and ⌘Z do not; ⌘Z takes the answer back', async () => {
    dueCards(1)
    newCards(2)
    await mount()
    await act(async () => review.setFilter('new'))
    expect(review.session?.learned).toBeNull()
    await go('again')
    expect(review.session?.learned).toBeNull()
    await go('good')
    const learned = review.session?.learned
    expect(learned).toEqual(expect.any(String))
    expect(top()).toBe('1 / 2 | grey 50 red 50 | all 3 due 2 new 1')
    // Undo takes the answer back: the numbers too.
    await step(() => review.undo())
    expect(review.session?.learned).toBeNull()
    expect(top()).toBe('0 / 2 | grey 0 red 0 | all 3 due 1 new 2')
    await go('good')
    expect(review.session?.learned).not.toBe(learned)
    await act(async () => review.setFilter('due'))
    await go('good')
    expect(review.session?.learned).toBeNull()
  })
})

describe('YAZ-5681: the ✕ and the red follow the open filter (differs from Mochi on purpose)', () => {
  it('3 misses in Due today; New cards: no ✕ and no red; back to Due today: ✕ 3; All cards: ✕ 3', async () => {
    dueCards(4)
    newCards(2)
    await mount()
    await act(async () => review.setFilter('due'))
    await go('again')
    await go('again')
    await go('again')
    expect(top()).toBe('✕ 3 · 3 / 7 | grey 43 red 86 | all 6 due 4 new 2')
    await act(async () => review.setFilter('new'))
    expect(top()).toBe('0 / 2 | grey 0 red 0 | all 6 due 4 new 2')
    await act(async () => review.setFilter('due'))
    expect(top()).toBe('✕ 3 · 3 / 7 | grey 43 red 86 | all 6 due 4 new 2')
    await act(async () => review.setFilter('all'))
    expect(top()).toBe('✕ 3 · 3 / 9 | grey 33 red 67 | all 6 due 4 new 2')
  })
})

describe('YAZ-5680 check 3: today`s line follows the answers at once, also before the index has the write (the Mac`s index lags)', () => {
  it('two answers with no index update: 2 cards; ⌘Z with no index update: back to 1; the index catching up changes nothing', async () => {
    dueCards(3)
    await mount()
    const today = () => review.session!.today.cards
    expect(today()).toBe(0)
    // No reindex after each answer: the index has not caught up yet.
    const raw = async (r: CardRating) => {
      await shown(review.session!.card!.id)
      await act(async () => void review.showAnswers())
      vi.setSystemTime(Date.now() + 20_000)
      await act(async () => void (await review.answer(r)))
    }
    await raw('good')
    await raw('again')
    expect(today()).toBe(2)
    await act(async () => void (await review.undo()))
    expect(today()).toBe(1)
    await act(async () => reindex())
    expect(today()).toBe(1)
  })
})

describe('YAZ-5710: the one Today line counts every different card answered today, once (it was YAZ-5684`s N learned · M reviews)', () => {
  it('due A ✓, B ✕, C ✓, missed B ✓; then, in a new session, new N1 ✕, N1 ✓, N2 ✓ → "Today: 5 cards"', async () => {
    dueCards(3)
    newCards(2)
    await mount()
    await act(async () => review.setFilter('due'))
    await go('good')
    await go('again')
    await go('good')
    await act(async () => review.goOn())
    await go('good')
    expect(review.session?.today.cards).toBe(3)
    // Closed and opened again the same day: counted from the cards' own review lines, not this session.
    await act(async () => review.close())
    await act(async () => review.start())
    await act(async () => review.setFilter('new'))
    await go('again')
    await go('good')
    await go('good')
    expect(review.session?.today.cards).toBe(5)
    expect(todayDone({ ...review.session!.today, seconds: 0 })).toBe('Today: 5 cards')
    // The learned cards' second ✓ later today adds nothing: each card counts once.
    await act(async () => review.setFilter('due'))
    while (review.session?.card) await go('good')
    expect(review.session?.today.cards).toBe(5)
  })
})

describe('YAZ-5702: only misses come back; FSRS in days only, as Mochi (YAZ-5703)', () => {
  /** A card with a ✓ and then a ✕ days ago (a recent lapse): the case that came back twice under the old one-minute steps. */
  const lapsed = (d: number) => `, 2026-11-0${d}T09:00:00.000Z good, 2026-11-0${d + 1}T09:00:00.000Z again`

  it('Yaseen`s case: 21 due (2 with a recent lapse), 13 ✕ and 8 ✓ → ✕ 13 · 21 / 34, Due today 13, the bar full', async () => {
    page('D.md', ...Array.from({ length: 19 }, (_, i): [string, string] => [`DUE-${i + 1}`, known(9)]), ['DUE-20', lapsed(3)], ['DUE-21', lapsed(5)])
    await mount()
    await act(async () => review.setFilter('due'))
    expect(top()).toBe('0 / 21 | grey 0 red 0 | all 21 due 21 new 0')
    const missed = new Set(Array.from({ length: 13 }, (_, i) => `DUE-${i + 1}`))
    for (let i = 0; i < 21; i++) await go(missed.has(review.session!.card!.id) ? 'again' : 'good')
    expect(top()).toBe('✕ 13 · 21 / 34 | grey 62 red 100 | all 13 due 13 new 0')
    expect(review.session?.end).toMatchObject({ kind: 'missed', percent: 38, missed: 13 })
    // The missed pass: each ✓ is done for today.
    await act(async () => review.goOn())
    for (let i = 0; i < 13; i++) await go('good')
    expect(top()).toBe('21 / 21 | grey 100 red 100 | all 0 due 0 new 0')
    // And not back later today, nor in a new session.
    vi.setSystemTime(Date.now() + 3 * 3_600_000)
    await reopen()
    expect(review.session?.card ?? null).toBeNull()
    expect(plan().queue.length).toBe(0)
  })

  it('a ✕ then ✓ on a card with a recent lapse: back once in the missed pass, then done for today; due in days', async () => {
    page('D.md', ['DUE-20', lapsed(3)], ['DUE-1', known(9)])
    await mount()
    await act(async () => review.setFilter('due'))
    const first = review.session!.card!.id
    const other = first === 'DUE-20' ? 'DUE-1' : 'DUE-20'
    // DUE-20 missed, whichever comes first; DUE-1 remembered.
    await answer(first, first === 'DUE-20' ? 'again' : 'good')
    await answer(other, other === 'DUE-20' ? 'again' : 'good')
    expect(top()).toBe('✕ 1 · 2 / 3 | grey 67 red 100 | all 1 due 1 new 0')
    await act(async () => review.goOn())
    await answer('DUE-20', 'good')
    expect(top()).toBe('2 / 2 | grey 100 red 100 | all 0 due 0 new 0')
    const reviews = reviewsOf('D.md', 'DUE-20')
    // The .md keeps every answer.
    expect(reviews.map((r) => r.rating)).toEqual(['good', 'again', 'again', 'good'])
    const last = cardHistory(reviews, S).at(-1)!
    expect(last.comesBack).toBe(false)
    expect(last.interval).toBeGreaterThanOrEqual(1)
    expect(isCardDue(last.due, Date.now())).toBe(false)
  })

  /** Nothing comes back later today, nor in a session opened again. */
  const doneForToday = async () => {
    expect(review.session?.card ?? null).toBeNull()
    vi.setSystemTime(Date.now() + 3 * 3_600_000)
    await reopen()
    expect(review.session?.card ?? null).toBeNull()
    expect(plan().queue).toEqual([])
  }

  describe('the four rows: due ✓, due ✕, new ✕, new ✓', () => {
    it('due ✓: done for today, no stop, nothing back (also a card with a recent lapse)', async () => {
      page('D.md', ['DUE-1', known(9)], ['DUE-20', lapsed(3)])
      await mount()
      // Due today: the stops are its own (YAZ-5707: All cards never stops).
      await act(async () => review.setFilter('due'))
      await go('good')
      await go('good')
      expect(review.session?.end).toMatchObject({ kind: 'done' })
      await doneForToday()
    })

    it('due ✕: back only in "Review missed cards"; its ✓ there is done for today', async () => {
      page('D.md', ['DUE-1', known(9)], ['DUE-20', lapsed(3)])
      await mount()
      await act(async () => review.setFilter('due'))
      await go('again')
      await go('again')
      expect(review.session?.card ?? null).toBeNull()
      expect(review.session?.end).toMatchObject({ kind: 'missed', missed: 2 })
      await act(async () => review.goOn())
      await go('good')
      await go('good')
      await doneForToday()
    })

    it('new ✕: back in the new-cards run until its first ✓', async () => {
      newCards(1)
      await mount()
      await answer('NEW-1', 'again')
      await answer('NEW-1', 'again')
      await shown('NEW-1')
      expect(review.session?.counts).toMatchObject({ new: 1, due: 0 })
    })

    it('new ✓: added to today`s reviews, ONE more review today, also in an Inbox opened again; its ✓ is done for today', async () => {
      newCards(1)
      await mount()
      await answer('NEW-1', 'good')
      expect(review.session?.counts).toMatchObject({ new: 0, due: 1 })
      await reopen()
      expect(review.session?.counts).toMatchObject({ new: 0, due: 1 })
      await answer('NEW-1', 'good')
      await doneForToday()
    })

    it('new ✓, then ✕ on its same-day review: back as a missed card; its ✓ then is done for today', async () => {
      newCards(1)
      await mount()
      await answer('NEW-1', 'good')
      await answer('NEW-1', 'again')
      await answer('NEW-1', 'good')
      await doneForToday()
      expect(reviewsOf('N.md', 'NEW-1').map((r) => r.rating)).toEqual(['good', 'again', 'good'])
    })
  })

  it('new cards unchanged: a Forgot new card comes back until its first ✓, which sends it to Due today', async () => {
    newCards(1)
    await mount()
    await act(async () => review.setFilter('new'))
    await go('again')
    await go('again')
    await go('good')
    expect(review.session?.counts.due).toBe(1)
  })
})

describe('YAZ-5707: All cards is ONE run, as Mochi (YAZ-5703 finding E5): due, new, the learned cards` same-day reviews, then the missed cards at the end; no stop', () => {
  /** Answers every card as it comes: ✕ on the ids in `miss` (their first time), ✓ on all else, until nothing is left; returns the kinds seen first. */
  const runAll = async (miss: readonly string[]): Promise<{ firsts: string[]; tops: Map<string, string> }> => {
    const firsts: string[] = []
    const seen = new Set<string>()
    const tops = new Map<string, string>()
    for (let i = 0; i < 100 && review.session?.card != null; i++) {
      expect(review.session.end).toBeNull()
      const card = review.session.card
      // The chip reads `isNew`: a NEW card shows "New card" until its first ✓, a due card never does.
      expect(card.isNew).toBe(card.id.startsWith('NEW') && !seen.has(card.id))
      if (!seen.has(card.id)) firsts.push(card.id)
      const rating: CardRating = miss.includes(card.id) && !seen.has(card.id) ? 'again' : 'good'
      seen.add(card.id)
      await answer(card.id, rating)
      tops.set(`after ${firsts.length}${rating === 'again' ? ' ✕' : ''}:${i}`, top())
      if (firsts.length === 24 && !tops.has('end of first answers')) {
        const next = review.session?.card
        if (next != null && seen.has(next.id)) tops.set('end of first answers', top())
      }
    }
    return { firsts, tops }
  }

  it('Yaseen`s case, Due first: 14 due + 10 new, 2 ✕ → one run, ✕ 2 · 24 / 36 after the first answers, no stop, the misses last, then Inbox complete with a full bar', async () => {
    dueCards(14)
    newCards(10)
    await mount()
    expect(top()).toBe('0 / 24 | grey 0 red 0 | all 24 due 14 new 10')
    const { firsts, tops } = await runAll(['DUE-1', 'DUE-2'])
    // Due first: every due card, then the new cards, in one run (no "% / Review missed cards" stop, no "Learn new cards").
    expect(firsts.slice(0, 14).every((id) => id.startsWith('DUE'))).toBe(true)
    expect(firsts.slice(14).every((id) => id.startsWith('NEW'))).toBe(true)
    // After the 24 first answers: 2 misses (+1 each) and 10 learned cards (+1 each: their same-day review joins).
    expect(tops.get('end of first answers')).toBe('✕ 2 · 24 / 36 | grey 67 red 72 | all 12 due 12 new 0')
    // Inbox complete: the bar full, nothing left, no stop screen.
    expect(review.session?.card ?? null).toBeNull()
    expect(review.session?.end).toBeNull()
    expect(top()).toBe('34 / 34 | grey 100 red 100 | all 0 due 0 new 0')
  })

  it('the order of the tail: the learned cards` same-day reviews, then the missed cards at the very end (chip ✕ Again), the ✕ shown until they are done', async () => {
    dueCards(2)
    newCards(1)
    await mount()
    const missed = review.session!.card!.id
    await go('again')
    expect(top()).toBe('✕ 1 · 1 / 4 | grey 25 red 50 | all 3 due 2 new 1')
    await go('good')
    expect(top()).toBe('✕ 1 · 2 / 4 | grey 50 red 75 | all 2 due 1 new 1')
    // No stop between the due part and the new part.
    expect(review.session?.end).toBeNull()
    await answer('NEW-1', 'good')
    expect(top()).toBe('✕ 1 · 3 / 5 | grey 60 red 80 | all 2 due 2 new 0')
    await answer('NEW-1', 'good')
    expect(top()).toBe('✕ 1 · 4 / 5 | grey 80 red 100 | all 1 due 1 new 0')
    // The bar is full; no stop: the missed card comes straight back.
    expect(review.session?.end).toBeNull()
    await shown(missed)
    expect(review.session?.card).toMatchObject({ repeat: true, forgot: true })
    await answer(missed, 'good')
    expect(top()).toBe('4 / 4 | grey 100 red 100 | all 0 due 0 new 0')
    expect(review.session?.card ?? null).toBeNull()
    expect(review.session?.end).toBeNull()
  })

  it('a ✕ on a learned card`s same-day review makes it a missed card at the end; a ✕ on a new card moves nothing and keeps it in the run', async () => {
    newCards(2)
    dueCards(1)
    await mount()
    await answer('DUE-1', 'good')
    await answer('NEW-1', 'again')
    expect(top()).toBe('1 / 3 | grey 33 red 33 | all 2 due 0 new 2')
    await answer('NEW-2', 'good')
    expect(top()).toBe('2 / 4 | grey 50 red 50 | all 2 due 1 new 1')
    await answer('NEW-1', 'good')
    expect(top()).toBe('3 / 5 | grey 60 red 60 | all 2 due 2 new 0')
    await answer('NEW-2', 'again')
    expect(top()).toBe('✕ 1 · 4 / 6 | grey 67 red 83 | all 2 due 2 new 0')
    await answer('NEW-1', 'good')
    await answer('NEW-2', 'good')
    expect(top()).toBe('5 / 5 | grey 100 red 100 | all 0 due 0 new 0')
  })

  it('Due today keeps its stop: "You remembered N%" and Review missed cards', async () => {
    dueCards(2)
    newCards(1)
    await mount()
    await act(async () => review.setFilter('due'))
    await go('again')
    await go('good')
    expect(review.session?.end).toMatchObject({ kind: 'missed', missed: 1, percent: 50 })
  })

  it('finding E5: the run carries today`s earlier work: 2 new cards learned in an earlier session → All cards starts at 2 / 7', async () => {
    newCards(5)
    await mount()
    await act(async () => review.setFilter('new'))
    await answer('NEW-1', 'good')
    await answer('NEW-2', 'good')
    await reopen()
    expect(top()).toBe('2 / 7 | grey 29 red 29 | all 5 due 2 new 3')
    // E5's rows: a new card's Forgot moves nothing; a learned new card +1 (its same-day review joins); a due ✕ +1 and ✕ 1.
    await go('good')
    expect(top()).toBe('3 / 7 | grey 43 red 43 | all 4 due 1 new 3')
    await go('good')
    await answer('NEW-3', 'again')
    expect(top()).toBe('4 / 7 | grey 57 red 57 | all 3 due 0 new 3')
    await answer('NEW-4', 'good')
    expect(top()).toBe('5 / 8 | grey 63 red 63 | all 3 due 1 new 2')
  })

  describe('the Order setting: Due first (default) · Shuffle', () => {
    /** A seeded Math.random: the same mix each run. */
    const seeded = () => {
      let x = 7
      return vi.spyOn(Math, 'random').mockImplementation(() => ((x = (x * 16807) % 2147483647) - 1) / 2147483646)
    }

    it('the defaults: All cards Due first, Due today Shuffle (Mochi, E6); each its own key in review.json', () => {
      expect(DEFAULT_REVIEW_SETTINGS.allCardsOrder).toBe('due-first')
      expect(DEFAULT_REVIEW_SETTINGS.dueTodayOrder).toBe('shuffle')
      expect(sanitizeReviewSettings({ dueTodayOrder: 'in-order' })).toMatchObject({ dueTodayOrder: 'in-order', allCardsOrder: 'due-first' })
      expect(sanitizeReviewSettings({ dueTodayOrder: 'later' }).dueTodayOrder).toBe('shuffle')
      expect(sanitizeReviewSettings({ allCardsOrder: 'shuffle' }).allCardsOrder).toBe('shuffle')
      expect(sanitizeReviewSettings({ allCardsOrder: 'sideways' }).allCardsOrder).toBe('due-first')
    })

    it('Yaseen`s case in Shuffle: due and new mixed, each card`s chip right, the same numbers: ✕ 2 · 24 / 36, then Inbox complete at 34 / 34', async () => {
      const random = seeded()
      dueCards(14)
      newCards(10)
      await mount({ ...S, allCardsOrder: 'shuffle' })
      expect(top()).toBe('0 / 24 | grey 0 red 0 | all 24 due 14 new 10')
      const { firsts, tops } = await runAll(['DUE-1', 'DUE-2'])
      random.mockRestore()
      // Mixed: a new card before the last due card.
      expect(firsts.findIndex((id) => id.startsWith('NEW'))).toBeLessThan(firsts.length - 1 - [...firsts].reverse().findIndex((id) => id.startsWith('DUE')))
      // Each kind keeps its own order (most overdue first; the new cards' order), so Due today and New cards read the same.
      expect(firsts.filter((id) => id.startsWith('NEW'))).toEqual(Array.from({ length: 10 }, (_, i) => `NEW-${i + 1}`))
      expect(tops.get('end of first answers')).toBe('✕ 2 · 24 / 36 | grey 67 red 72 | all 12 due 12 new 0')
      expect(review.session?.card ?? null).toBeNull()
      expect(review.session?.end).toBeNull()
      expect(top()).toBe('34 / 34 | grey 100 red 100 | all 0 due 0 new 0')
    })

    /** Due cards one day apart: DUE-1 the most overdue, so In order is DUE-1, DUE-2, … */
    const spread = (n: number) => page('D.md', ...Array.from({ length: n }, (_, i): [string, string] => [`DUE-${i + 1}`, known(Math.min(9, i + 1), 1)]))
    const dueRun = async (): Promise<string[]> => {
      const ids: string[] = []
      while (review.session?.card != null && ids.length < 20) {
        ids.push(review.session.card.id)
        await answer(review.session.card.id, 'good')
      }
      return ids
    }

    it('Due today In order: the most overdue first (the plan`s order)', async () => {
      spread(6)
      await mount({ ...S, dueTodayOrder: 'in-order' })
      await act(async () => review.setFilter('due'))
      expect(await dueRun()).toEqual(['DUE-1', 'DUE-2', 'DUE-3', 'DUE-4', 'DUE-5', 'DUE-6'])
    })

    it('Due today Shuffle (the default): the due cards in a random order, each once, then Due today is done; All cards Due first keeps that order before the new cards', async () => {
      const random = seeded()
      spread(6)
      newCards(2)
      await mount({ ...S, dueTodayOrder: 'shuffle' })
      random.mockRestore()
      await act(async () => review.setFilter('due'))
      const ids = await dueRun()
      expect([...ids].sort()).toEqual(['DUE-1', 'DUE-2', 'DUE-3', 'DUE-4', 'DUE-5', 'DUE-6'])
      expect(ids).not.toEqual(['DUE-1', 'DUE-2', 'DUE-3', 'DUE-4', 'DUE-5', 'DUE-6'])
      expect(review.session?.end).toMatchObject({ kind: 'done' })
    })

    it('Due today Shuffle is stable for the session (⌘Z, a filter switch); a change of the row reorders the cards not answered yet at once', async () => {
      const random = seeded()
      spread(6)
      await mount({ ...S, dueTodayOrder: 'shuffle' })
      random.mockRestore()
      await act(async () => review.setFilter('due'))
      const first = review.session!.card!.id
      await answer(first, 'good')
      const second = review.session!.card!.id
      await step(() => review.undo())
      await answer(first, 'good')
      expect(review.session!.card!.id).toBe(second)
      await act(async () => review.setFilter('all'))
      await act(async () => review.setFilter('due'))
      expect(review.session!.card!.id).toBe(second)
      // In order now: the card on show stays, the others follow the plan's order.
      await act(async () => root?.render(<Probe settings={{ ...S, dueTodayOrder: 'in-order' }} />))
      const rest = (await dueRun()).slice(1)
      expect(rest).toEqual([...rest].sort())
    })

    it('Shuffle is stable for the session: ⌘Z and a filter switch never mix again', async () => {
      const random = seeded()
      dueCards(6)
      newCards(6)
      await mount({ ...S, allCardsOrder: 'shuffle' })
      random.mockRestore()
      const order = () => review.session!.card!.id
      const first = order()
      await answer(first, 'good')
      const second = order()
      await step(() => review.undo())
      await shown(first)
      await answer(first, 'good')
      expect(order()).toBe(second)
      await act(async () => review.setFilter('due'))
      await act(async () => review.setFilter('all'))
      expect(order()).toBe(second)
    })
  })
})
