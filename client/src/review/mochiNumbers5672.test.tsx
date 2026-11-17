/**
 * REVIEW NUMBERS LIKE MOCHI (YAZ-5672): Mochi's measured numbers (YAZ-5671 findings 1–20) as the expected values, run on
 * the ONE session code both apps share (`useCardReview` with an in-memory host; the phone's host is the same interface).
 * The harness began as YAZ-5669's scripted 10-card audit. Made-up cards only.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { cardBlock, cardRecords, cardReviewsOf, cardTime, pageCards, parseCardLine, type CardRating, type CardReview } from '@shared/cardLine'
import { CARD_LEARNING_STEPS, CARD_RELEARNING_STEPS, answerLabel, answerRatings, cardHistory, cardPlan, isCardDue, reviewedToday } from '@shared/cardSchedule'
import { DEFAULT_REVIEW_SETTINGS, type ReviewSettings } from '@shared/reviews'
import type { IndexRecord } from '@shared/types'
import { useCardReview, type CardReviewApi } from './useCardReview'
import { todayCards } from './reviewTime'
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
    dueCards(2)
    newCards(1)
    await mount()
    expect(top()).toBe('0 / 3 | grey 0 red 0 | all 3 due 2 new 1')
    await go('again')
    expect(top()).toBe('✕ 1 · 1 / 4 | grey 25 red 50 | all 3 due 2 new 1')
    await go('good')
    expect(top()).toBe('✕ 1 · 2 / 4 | grey 50 red 75 | all 2 due 1 new 1')
    // The % screen of the first pass; then the missed card.
    await act(async () => review.goOn())
    await go('good')
    expect(top()).toBe('2 / 3 | grey 67 red 67 | all 1 due 0 new 1')
    // "Finished reviewing missed cards." · Learn new cards 1.
    expect(review.session?.end).toMatchObject({ kind: 'done', fresh: 1 })
    await act(async () => review.goOn())
    await go('good')
    expect(top()).toBe('3 / 4 | grey 75 red 75 | all 1 due 1 new 0')
    await act(async () => review.setFilter('new'))
    expect(top()).toBe('1 / 1 | grey 100 red 100 | all 1 due 1 new 0')
    await act(async () => review.setFilter('all'))
    expect(top()).toBe('3 / 4 | grey 75 red 75 | all 1 due 1 new 0')
    // Its second ✓, as a Due today card: done +1.
    await go('good')
    expect(top()).toBe('4 / 4 | grey 100 red 100 | all 0 due 0 new 0')
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
  it('two answers with no index update: 2 reviews; ⌘Z with no index update: back to 1; the index catching up changes nothing', async () => {
    dueCards(3)
    await mount()
    const today = () => [review.session!.today.learned, review.session!.today.reviews]
    expect(today()).toEqual([0, 0])
    // No reindex after each answer: the index has not caught up yet.
    const raw = async (r: CardRating) => {
      await shown(review.session!.card!.id)
      await act(async () => void review.showAnswers())
      vi.setSystemTime(Date.now() + 20_000)
      await act(async () => void (await review.answer(r)))
    }
    await raw('good')
    await raw('again')
    expect(today()).toEqual([0, 2])
    await act(async () => void (await review.undo()))
    expect(today()).toEqual([0, 1])
    await act(async () => reindex())
    expect(today()).toEqual([0, 1])
  })
})

describe('YAZ-5684: the Today line counts like Mochi`s Dashboard (finding 13): N learned · M reviews', () => {
  it('due A ✓, B ✕, C ✓, missed B ✓; then, in a new session, new N1 ✕, N1 ✓, N2 ✓ → "Today: 2 learned · 3 reviews"', async () => {
    dueCards(3)
    newCards(2)
    await mount()
    await act(async () => review.setFilter('due'))
    await go('good')
    await go('again')
    await go('good')
    await act(async () => review.goOn())
    await go('good')
    expect(review.session?.today).toMatchObject({ learned: 0, reviews: 3 })
    // Closed and opened again the same day: counted from the cards' own review lines, not this session.
    await act(async () => review.close())
    await act(async () => review.start())
    await act(async () => review.setFilter('new'))
    await go('again')
    await go('good')
    await go('good')
    expect(review.session?.today).toMatchObject({ learned: 2, reviews: 3 })
    expect(todayCards(review.session!.today)).toBe('Today: 2 learned · 3 reviews')
    // The learned cards' second ✓ later today adds nothing (they were not due cards this morning).
    await act(async () => review.setFilter('due'))
    while (review.session?.card) await go('good')
    expect(review.session?.today).toMatchObject({ learned: 2, reviews: 3 })
  })
})

describe('YAZ-5702: only misses come back (the YAZ-5655 amendment; Mochi, YAZ-5671)', () => {
  /** A card with a ✓ and then a ✕ while it was still learning (a recent lapse): FSRS keeps it in its learning steps. */
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
    // The missed pass: each ✓ is done for today, also on a card FSRS still keeps in a step.
    await act(async () => review.goOn())
    for (let i = 0; i < 13; i++) await go('good')
    expect(top()).toBe('21 / 21 | grey 100 red 100 | all 0 due 0 new 0')
    // And not back later today, nor in a new session; tomorrow it is due again.
    vi.setSystemTime(Date.now() + 3 * 3_600_000)
    await reopen()
    expect(review.session?.card ?? null).toBeNull()
    expect(plan().queue.length).toBe(0)
  })

  it('a ✕ then ✓ on a card with a recent lapse: back once in the missed pass, then done for today; due tomorrow', async () => {
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
    // The .md keeps every answer; only when the card shows again changed.
    expect(reviews.map((r) => r.rating)).toEqual(['good', 'again', 'again', 'good'])
    const last = cardHistory(reviews, S).at(-1)!
    expect(last.inSteps).toBe(false)
    expect(isCardDue(last.due, Date.now())).toBe(false)
    expect(isCardDue(last.due, new Date(2026, 10, 13, 0, 0).getTime())).toBe(true)
  })

  /** Nothing comes back later today, nor in a session opened again. */
  const doneForToday = async () => {
    expect(review.session?.card ?? null).toBeNull()
    vi.setSystemTime(Date.now() + 3 * 3_600_000)
    await reopen()
    expect(review.session?.card ?? null).toBeNull()
    expect(plan().queue).toEqual([])
  }

  describe('the four rows: due ✓, due ✕, new ✕, new ✓ (CHANGED: a ✓ that FSRS keeps in a step, on a card that had a ✓)', () => {
    it('due ✓ (CHANGED for a card with a recent lapse): done for today, no stop, nothing back', async () => {
      page('D.md', ['DUE-1', known(9)], ['DUE-20', lapsed(3)])
      await mount()
      await go('good')
      await go('good')
      expect(review.session?.end).toMatchObject({ kind: 'done' })
      await doneForToday()
    })

    it('due ✕ (unchanged): back only in "Review missed cards"; its ✓ there is done for today (CHANGED for a card with a recent lapse)', async () => {
      page('D.md', ['DUE-1', known(9)], ['DUE-20', lapsed(3)])
      await mount()
      await go('again')
      await go('again')
      expect(review.session?.card ?? null).toBeNull()
      expect(review.session?.end).toMatchObject({ kind: 'missed', missed: 2 })
      await act(async () => review.goOn())
      await go('good')
      await go('good')
      await doneForToday()
    })

    it('new ✕ (unchanged): back in the new-cards run until its first ✓', async () => {
      newCards(1)
      await mount()
      await answer('NEW-1', 'again')
      await answer('NEW-1', 'again')
      await shown('NEW-1')
      expect(review.session?.counts).toMatchObject({ new: 1, due: 0 })
    })

    it('new ✓ (unchanged): added to reviews, ONE more review today; its ✓ is done for today', async () => {
      newCards(1)
      await mount()
      await answer('NEW-1', 'good')
      expect(review.session?.counts).toMatchObject({ new: 0, due: 1 })
      await answer('NEW-1', 'good')
      await doneForToday()
    })

    it('new ✓, then ✕ on its same-day review: back as a missed card; its ✓ then is done for today (CHANGED: it came back once more)', async () => {
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
