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


const log: string[] = []
const where = (tag: string) => {
  const s = review.session!
  const bar = s.progress.runs.map((r) => (r.missed ? 'R' : r.open ? 'o' : 'G').repeat(r.count)).join('') + '.'.repeat(Math.max(0, s.progress.size - s.progress.runs.reduce((a, r) => a + r.count, 0)))
  log.push([tag.padEnd(26), `filter=${s.filter}`.padEnd(11), `card=${s.card?.id ?? (s.end ? 'END:' + s.end.kind : 'done')}`.padEnd(14), `${s.position} of ${s.total}`.padEnd(9), `menu all ${s.counts.all} due ${s.counts.due} new ${s.counts.new}`.padEnd(24), `Today ${s.today.cards} cards/${s.today.reviews} ans`.padEnd(22), `bar ${s.progress.done}/${s.progress.size} [${bar}]`.padEnd(22), `dock ${review.dueCount}`, s.end ? `end ${s.end.percent}% of ${s.end.count}, missed ${s.end.missed}, learn new ${s.end.fresh}` : ''].join(' | '))
}
const go = async (r: CardRating) => { if (review.session?.end) { await act(async () => review.goOn()); where('  (press the end button)') } const id = review.session?.card?.id; if (!id) return; await answer(id, r); where(`${r === 'good' ? '✓' : '✕'} ${id}`) }
describe('repro 5669', () => {
  it('A: start on New cards', async () => {
    page('D.md', ...['DUE-1','DUE-2','DUE-3','DUE-4','DUE-5','DUE-6','DUE-7'].map((id): [string,string] => [id, known(9)]))
    page('N.md', ['NEW-1', ''], ['NEW-2', ''], ['NEW-3', ''])
    await mount(); where('open (All)')
    await act(async () => review.setFilter('new')); where('switch New cards')
    await go('good'); await go('again'); await go('good'); await go('good'); await go('good'); await go('good')
    await act(async () => review.setFilter('due')); where('switch Due today')
    await go('good'); await go('again'); await go('good')
    await step(() => review.undo()); where('⌘Z')
    await act(async () => review.setFilter('all')); where('switch All')
    for (let i = 0; i < 14 && (review.session?.card || review.session?.end); i++) await go(i === 2 ? 'again' : 'good')
    console.log('\n' + log.join('\n'))
  })
  it('B: start on All', async () => {
    page('D.md', ...['DUE-1','DUE-2','DUE-3','DUE-4','DUE-5','DUE-6','DUE-7'].map((id): [string,string] => [id, known(9)]))
    page('N.md', ['NEW-1', ''], ['NEW-2', ''], ['NEW-3', ''])
    log.length = 0
    await mount(); where('open (All)')
    for (let i = 0; i < 8 && review.session?.card; i++) await go(i === 1 || i === 4 ? 'again' : 'good')
    if (review.session?.end) { await act(async () => review.goOn()); where('Review missed') }
    for (let i = 0; i < 4 && review.session?.card; i++) await go('good')
    if (review.session?.end) { await act(async () => review.goOn()); where('Learn new') }
    await act(async () => review.setFilter('new')); where('switch New cards')
    for (let i = 0; i < 8 && review.session?.card; i++) await go('good')
    console.log('\n' + log.join('\n'))
  })

  it('C: the demo vault lines', async () => {
    log.length = 0
    vi.setSystemTime(new Date('2026-11-17T00:04:00.000Z').getTime())
    page('Demo.md', ['DEMO-26', ', 2026-11-10T16:45Z good, 2026-11-13T06:47Z good'], ['DEMO-27', ', 2026-11-13T05:24Z good, 2026-11-13T06:47Z good'], ['DEMO-28', ', 2026-11-09T14:45Z good, 2026-11-13T05:24Z good'], ['DEMO-29', ', 2026-11-13T05:24Z good, 2026-11-13T06:47Z good'], ['DEMO-31', ', 2026-11-13T05:24Z good, 2026-11-13T06:47Z good'], ['DEMO-32', ', 2026-10-03T14:45Z good, 2026-10-07T18:45Z good, 2026-10-18T13:45Z good, 2026-11-08T17:45Z good'], ['DEMO-34', ', 2026-11-13T05:24Z good, 2026-11-13T20:40Z good'], ['DEMO-35', ', 2026-11-13T05:24Z good, 2026-11-13T20:40Z good'], ['DEMO-36', ', 2026-11-07T13:45Z good, 2026-11-13T05:24Z good'], ['DEMO-37', ', 2026-09-03T12:45Z good, 2026-09-07T16:45Z good, 2026-09-18T11:45Z again, 2026-09-19T15:45Z good, 2026-10-31T10:45Z good'])
    await mount(); where('open (All)')
    await act(async () => review.setFilter('new')); where('switch New cards')
    for (const r of ['again','good','good','good','good','good','good','again','good','again'] as CardRating[]) await go(r)
    console.log('\n' + log.join('\n'))
  })
})
