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
