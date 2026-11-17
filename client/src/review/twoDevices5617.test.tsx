/**
 * YAZ-5617 (review check e): two devices and sync DURING a review, on the Mac (the shared `useCardReview`, with the
 * in-memory host). The phone answers while the Mac's session is open; Docs' sync then unites the two sides as the
 * desktop does (`uniteCardLines`, YAZ-5088/5089, then the line merge of different lines, `mergeLinesApart`). The rules
 * (YAZ-5611): each answer is written ONE time and none is lost (spec 24); a card the other device finished leaves the
 * open session and is never shown again (spec 10, YAZ-5622); the counts and "N / M" count the cards left (spec 8, 13);
 * Undo takes back only this device's answer (spec 18); the new-card limit is for the whole vault (spec 4).
 * The phone's side of the same cases: `mobile/src/review/twoDevices5617.test.tsx`. Made-up cards only.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { cardBlock, cardRecords, cardReviewsOf, cardTime, changeCard, pageCards, parseCardLine, withCardReview, type CardRating } from '@shared/cardLine'
import { uniteCardLines } from '@shared/cardMerge'
import { mergeLinesApart } from '@shared/lineMerge'
import { DEFAULT_REVIEW_SETTINGS, type ReviewSettings } from '@shared/reviews'
import type { IndexRecord } from '@shared/types'
import { useCardReview, type CardReviewApi } from './useCardReview'
import { memoryReviewHost, type MemoryReviewHost } from './memoryReviewHost'

const S: ReviewSettings = { ...DEFAULT_REVIEW_SETTINGS, dueTodayOrder: 'in-order' }
const NOW = new Date(2026, 10, 12, 9, 0).getTime()
const ROOT = '/mac'
const PATH = `${ROOT}/D.md`
/** Known cards, out of their steps, due today. */
/** A known card due today, begun in `month` of 2026: an earlier month is more overdue, so it comes first (Review rules v1, rule 5). */
const KNOWN_ON = (month: number) => `2026-0${month}-01T09:00:00.000Z good, 2026-0${month}-01T09:01:00.000Z good`

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
  return { path, name, basename: name.replace(/\.md$/, ''), title: name.replace(/\.md$/, ''), folder: '', ext: 'md', size: content.length, ctime: 0, mtime: 0, properties: {}, aliases: [], tags: [], links: [], embeds: [], cards: cardRecords(content) }
}
function reindex(): void {
  records = [...host.files].map(([path, content]) => scan(path, content))
  listeners.forEach((l) => l())
}
const pageText = (...cards: [string, string][]) => `# D\n\n${cards.map(([text, l]) => cardBlock(text, parseCardLine(`<!-- card: ${l} -->`)!)).join('\n\n')}\n`
const reviews = (content: string, id: string) => cardReviewsOf(pageCards(content).find((c) => c.line.parts.some((p) => p.kind === 'id' && p.id === id))!.line)
const ratings = (id: string) => reviews(host.files.get(PATH)!, id).map((r) => r.rating)

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
}
const step = async (run: () => unknown): Promise<void> => {
  await act(async () => void (await run()))
  await act(async () => reindex())
}
const shown = async (id: string) => {
  if (review.session?.end != null) act(() => review.goOn())
  await vi.waitFor(() => expect(review.session?.card).toMatchObject({ id }))
}
const answer = async (id: string, rating: CardRating): Promise<void> => {
  await shown(id)
  vi.setSystemTime(Date.now() + 20_000)
  await step(() => review.answer(rating))
}
/** The rest of the session, each card Remembered; the IDs it showed. */
const finish = async (): Promise<string[]> => {
  const seen: string[] = []
  for (let i = 0; i < 40; i++) {
    if (review.session?.end != null) act(() => review.goOn())
    const id = review.session?.card?.id
    if (id == null) break
    seen.push(id)
    await answer(id, 'good')
  }
  return seen
}
const place = () => [review.session?.progress.done, review.session?.progress.total]

/**
 * The phone, and Docs' sync between it and the Mac. `base` is the page as both last synced; the phone answers on its
 * own copy; `sync()` unites the two sides as the desktop's resolve does (the card rule first, then the lines apart),
 * writes the result to the Mac's file and the index takes it in. Both sides must come out the same: no conflict copy.
 */
let base = ''
let phone = ''
const phoneAnswers = (id: string, rating: CardRating, at = Date.now()) => {
  phone = changeCard(phone, id, (l) => withCardReview(l, { at: cardTime(at), rating, seconds: 3 }))
}
async function sync(): Promise<void> {
  const mine = host.files.get(PATH)!
  const [t, m] = uniteCardLines(base, phone, mine)
  const merged = t === m ? t : mergeLinesApart(base, t, m)
  expect(merged, 'the sync made no conflict copy').not.toBeNull()
  host.files.set(PATH, merged!)
  base = phone = merged!
  await act(async () => reindex())
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(NOW)
  host = memoryReviewHost(new Map(), 'Mac vault')
  base = phone = pageText(['Due {{a}}?', `TD-1, ${KNOWN_ON(5)}`], ['Due {{b}}?', `TD-2, ${KNOWN_ON(6)}`], ['Due {{c}}?', `TD-3, ${KNOWN_ON(7)}`], ['New {{d}}?', 'TD-4'])
  host.files.set(PATH, base)
})
afterEach(() => {
  act(() => root?.unmount())
  root = null
  vi.useRealTimers()
})

describe('YAZ-5617 Mac: the phone answers while the Mac reviews', () => {
  it('both devices answer the SAME card before a sync: the page keeps both answers, once each, and no device shows it again', async () => {
    await mount()
    await act(async () => review.start())
    expect(review.session?.counts).toMatchObject({ all: 4, due: 3, new: 1 })
    phoneAnswers('TD-1', 'good', NOW + 5_000)
    await answer('TD-1', 'good')
    await sync()
    expect(ratings('TD-1')).toEqual(['good', 'good', 'good', 'good'])
    // The two answers, one each, in time order: the phone's (5 s), then the Mac's (after its 20 s).
    const [p, m] = reviews(host.files.get(PATH)!, 'TD-1').slice(2).map((r) => r.at)
    expect(p).toBe(cardTime(NOW + 5_000))
    expect(m > p).toBe(true)
    // A second sync changes nothing: no answer comes twice.
    const once = host.files.get(PATH)
    await sync()
    expect(host.files.get(PATH)).toBe(once)
    expect(await finish()).toEqual(['TD-2', 'TD-3', 'TD-4', 'TD-4'])
    expect(review.dueCount).toBe(0)
  })

  it('the phone answers a card further on: the Mac counts it no more, never shows it, and both devices keep every answer', async () => {
    await mount()
    await act(async () => review.start())
    await answer('TD-1', 'good')
    expect(place()).toEqual([1, 4])
    phoneAnswers('TD-3', 'good')
    await sync()
    expect(review.session?.counts).toMatchObject({ all: 2, due: 1, new: 1 })
    expect(place()).toEqual([1, 3])
    expect(await finish()).toEqual(['TD-2', 'TD-4', 'TD-4'])
    for (const id of ['TD-1', 'TD-2', 'TD-3']) expect(ratings(id)).toEqual(['good', 'good', 'good'])
    expect(ratings('TD-4')).toEqual(['good', 'good'])
  })

  it('a ✕ on the phone keeps the card due: the Mac still shows it, and its answer there is a second review, kept with the phone`s', async () => {
    await mount()
    await act(async () => review.start())
    phoneAnswers('TD-2', 'again')
    await sync()
    expect(review.session?.counts).toMatchObject({ all: 4, due: 3 })
    await answer('TD-1', 'good')
    await answer('TD-2', 'good')
    expect(ratings('TD-2')).toEqual(['good', 'good', 'again', 'good'])
  })

  it('Undo after the sync brought the phone`s answer on the same card: only the Mac`s answer goes; the phone`s stays, and the card stays out', async () => {
    await mount()
    await act(async () => review.start())
    await answer('TD-1', 'good')
    phoneAnswers('TD-1', 'good', NOW + 30_000)
    await sync()
    await step(() => review.undo())
    expect(reviews(host.files.get(PATH)!, 'TD-1').slice(2).map((r) => r.at)).toEqual([cardTime(NOW + 30_000)])
    // The phone finished it: the Mac does not ask for it again (a second review of today).
    expect(await finish()).not.toContain('TD-1')
    expect(ratings('TD-1')).toEqual(['good', 'good', 'good'])
  })

  it("the phone's first ✓ on a new card: New −1, Due today +1; the Mac gives it its second ✓, and it is done (YAZ-5611 two checks)", async () => {
    await mount()
    await act(async () => review.start())
    expect(review.session?.counts).toMatchObject({ all: 4, due: 3, new: 1 })
    phoneAnswers('TD-4', 'good')
    await sync()
    expect(review.session?.counts.all).toBe(4)
    const seen = await finish()
    expect(seen.filter((id) => id === 'TD-4')).toHaveLength(1)
    expect(ratings('TD-4')).toEqual(['good', 'good'])
    expect(review.dueCount).toBe(0)
  })

  it('the new-card limit is for the whole vault: new cards the phone began today use the Mac`s places', async () => {
    host.files.set(`${ROOT}/N.md`, pageText(...[5, 6, 7].map((n): [string, string] => [`New {{${n}}}`, `TD-${n}`])))
    await mount({ ...S, newPerDay: 2 })
    await act(async () => review.start())
    expect(review.session?.counts.new).toBe(2)
    // The phone begins two other new cards (its own folder pick): today's two places are used.
    const begin = (text: string, id: string) => changeCard(text, id, (l) => withCardReview(l, { at: cardTime(NOW), rating: 'good' }))
    host.files.set(`${ROOT}/N.md`, begin(begin(host.files.get(`${ROOT}/N.md`)!, 'TD-6'), 'TD-7'))
    await act(async () => reindex())
    const seen = await finish()
    const begun = cardRecords(host.files.get(PATH)! + host.files.get(`${ROOT}/N.md`)!).filter((c) => c.reviews.length > 0 && c.reviews.every((r) => r.at >= cardTime(NOW)))
    expect(begun.map((c) => c.id).sort()).toEqual(['TD-6', 'TD-7'])
    expect(seen).not.toContain('TD-4')
    expect(seen).not.toContain('TD-5')
  })
})
