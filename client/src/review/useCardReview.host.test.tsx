/**
 * YAZ-5067 (decision 3, "One review logic for both apps"): `useCardReview` takes its host as a parameter. With an
 * in-memory host (`memoryReviewHost`) the hook runs the same session as on the desktop — a forgotten card comes back,
 * Undo takes back the last answer, the daily limits hold — and it never reaches the desktop's files, app state or
 * bridge: `api` is not mocked here, and `storage` must stay untouched.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { cardBlock, cardRecords, cardReviewsOf, pageCards, parseCardLine } from '@shared/cardLine'
import { cardWithTitle } from '@shared/cardText'
import { DEFAULT_REVIEW_SETTINGS, type ReviewSettings } from '@shared/reviews'
import type { IndexRecord } from '@shared/types'
import { useCardReview, type CardReviewApi } from './useCardReview'
import { memoryReviewHost, type MemoryReviewHost } from './memoryReviewHost'
import { storage } from '../lib/storage'

const S: ReviewSettings = { ...DEFAULT_REVIEW_SETTINGS }
const NOW = new Date(2026, 10, 12, 9, 0).getTime()
const ROOT = '/phone'

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

/** The index of a file: a CARD FILE (`kind: card`) is a record of kind `card` with its `title`. */
function scan(path: string, content: string): IndexRecord {
  const name = path.slice(path.lastIndexOf('/') + 1)
  const folder = path.slice(ROOT.length + 1, Math.max(ROOT.length + 1, path.lastIndexOf('/')))
  const title = /^---\n[^]*?^title: (.*)$/m.exec(content)?.[1]
  const file = /^---\nkind: card\n/.test(content)
  return { path, name, basename: name.replace(/\.md$/, ''), title: title ?? name.replace(/\.md$/, ''), folder, ext: 'md', size: content.length, ctime: 0, mtime: 0, properties: {}, aliases: [], tags: [], links: [], embeds: [], cards: cardRecords(content), ...(file && { kind: 'card' as const }) }
}
function reindex(): void {
  records = [...host.files].map(([path, content]) => scan(path, content))
  listeners.forEach((l) => l())
}
const page = (path: string, ...cards: [string, string][]): void => {
  host.files.set(`${ROOT}/${path}`, `# ${path}\n\n${cards.map(([text, l]) => cardBlock(text, parseCardLine(`<!-- card: ${l} -->`)!)).join('\n')}`)
}
const reviewsOn = (path: string, id: string) => cardReviewsOf(pageCards(host.files.get(`${ROOT}/${path}`)!).find((c) => c.line.parts.some((p) => p.kind === 'id' && p.id === id))!.line)

;(globalThis as unknown as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true

let root: Root | null = null
let review: CardReviewApi
const notices: string[] = []

function Probe({ settings }: { settings: ReviewSettings }) {
  review = useCardReview(ROOT, source, settings, (text) => void notices.push(text), undefined, host)
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
const shown = (id: string) => vi.waitFor(() => expect(review.session?.card).toMatchObject({ id, page: { id } }))
const answer = async (id: string, rating: 'again' | 'good'): Promise<void> => {
  await shown(id)
  vi.setSystemTime(Date.now() + 20_000)
  await step(() => review.answer(rating))
}

/** The desktop's doors: the hook with a host must use none of them. */
const desktop = () => [
  vi.spyOn(storage, 'vaultName'),
  vi.spyOn(storage, 'getUpNextTaken'),
  vi.spyOn(storage, 'setUpNextTaken'),
  vi.spyOn(storage, 'getCardsAdded'),
  vi.spyOn(storage, 'setCardsAdded'),
]
let doors: ReturnType<typeof desktop>

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(NOW)
  host = memoryReviewHost(new Map(), 'Phone vault')
  notices.length = 0
  doors = desktop()
  // A known card, due (out of its steps), and a new card.
  page('K.md', ['Known {{a}}?', 'WIKI-5, 2026-09-01T09:00Z good, 2026-09-01T09:01Z good'], ['New {{b}}?', 'WIKI-6'])
})

afterEach(() => {
  act(() => root?.unmount())
  root = null
  vi.useRealTimers()
  vi.restoreAllMocks()
})

describe('useCardReview with a host of its own (YAZ-5067)', () => {
  it('the same session: a forgotten card comes back at the end, Undo takes the last answer back byte for byte; the host is the only door', async () => {
    await mount()
    expect(review.dueCount).toBe(2)
    await act(async () => review.start())
    const before = host.files.get(`${ROOT}/K.md`)
    await answer('WIKI-5', 'again')
    expect(reviewsOn('K.md', 'WIKI-5').map((r) => r.rating)).toEqual(['good', 'good', 'again'])
    await shown('WIKI-6')
    expect([review.session?.position, review.session?.total]).toEqual([2, 3])
    // Undo: the review out, the file the same bytes, the card back at its place.
    await step(() => review.undo())
    expect(host.files.get(`${ROOT}/K.md`)).toBe(before)
    await shown('WIKI-5')
    expect([review.session?.position, review.session?.total, review.session?.canUndo]).toEqual([1, 2, false])
    // Forgot, then the new card twice Remembered; the forgotten card comes back last.
    await answer('WIKI-5', 'again')
    await answer('WIKI-6', 'good')
    await shown('WIKI-5')
    await answer('WIKI-5', 'good')
    await answer('WIKI-6', 'good')
    expect(review.session?.card).toBeNull()
    expect(review.dueCount).toBe(0)
    // The breadcrumb's vault is the host's name.
    expect(notices).toEqual([])
    expect(host.writes()).toBe(6)
    for (const door of doors) expect(door).not.toHaveBeenCalled()
  })

  it('the daily limits hold: new cards a day, and "Add more for today" counts in the host, never in the app state; Up next a day uses the host`s day list', async () => {
    page('New.md', ...[10, 11, 12].map((n): [string, string] => [`New {{${n}}}`, `WIKI-${n}`]))
    // Two marked cards, known and not due (begun on another day, so neither takes a new card of today).
    const known = '2026-11-11T07:00Z good, 2026-11-11T07:01Z good, 2026-11-12T08:00Z good'
    page('Next.md', ['Marked {{x}}?', `WIKI-20, next, ${known}`], ['Marked {{y}}?', `WIKI-21, next, ${known}`])
    await mount({ ...S, newPerDay: 1, upNextPerDay: 1 })
    // Known WIKI-5 due, ONE new card (WIKI-6), ONE Up next (WIKI-20).
    expect(review.dueCount).toBe(3)
    await act(async () => review.start())
    expect(review.session).toMatchObject({ counts: { new: 1, next: 1 }, more: { new: 3, next: 1 } })
    act(() => review.addCards('new', 2))
    expect(host.cardsAddedToday(ROOT)).toEqual({ newCards: 2, upNext: 0 })
    expect(review.session).toMatchObject({ counts: { new: 3 }, more: { new: 1 } })
    // The Up next card first; its answer takes a place of the day in the host's list, and its undo gives it back.
    await shown('WIKI-20')
    await answer('WIKI-20', 'good')
    expect(host.upNextTakenToday(ROOT)).toEqual(['WIKI-20'])
    expect(review.dueCount).toBe(4) // WIKI-21 waits for another day: the day's one place is used
    await step(() => review.undo())
    expect(host.upNextTakenToday(ROOT)).toEqual([])
    for (const door of doors) expect(door).not.toHaveBeenCalled()
  })

  it('a card FILE`s card and a page`s card: both review; the card file shows its `title` (YAZ-5044), as on the Mac', async () => {
    host.files.clear()
    host.files.set(`${ROOT}/Bio/Mitosis.md`, `---\nkind: card\ntitle: Mitosis\n---\n${cardBlock('Cells {{split}}', parseCardLine('<!-- card: WIKI-30 -->')!)}`)
    page('Bio/Cells.md', ['What is a {{cell}}?', 'WIKI-31'])
    await mount()
    expect(review.dueCount).toBe(2)
    await act(async () => review.start())
    await shown('WIKI-30')
    expect(review.session?.card?.page).toMatchObject({ fileTitle: 'Mitosis', text: cardWithTitle('Mitosis', 'Cells {{split}}') })
    expect(review.session?.place.map((p) => [p.kind, p.label])).toEqual([
      ['vault', 'Phone vault'],
      ['folder', 'Bio'],
    ])
    await answer('WIKI-30', 'good')
    expect(cardReviewsOf(pageCards(host.files.get(`${ROOT}/Bio/Mitosis.md`)!)[0].line).map((r) => r.rating)).toEqual(['good'])
    // The card file's properties stay byte for byte.
    expect(host.files.get(`${ROOT}/Bio/Mitosis.md`)).toMatch(/^---\nkind: card\ntitle: Mitosis\n---\n/)
    await shown('WIKI-31')
    expect(review.session?.card?.page).toMatchObject({ text: 'What is a {{cell}}?' })
    expect(review.session?.card?.page?.fileTitle).toBeUndefined()
    expect(review.session?.place.map((p) => [p.kind, p.label])).toEqual([
      ['vault', 'Phone vault'],
      ['folder', 'Bio'],
      ['page', 'Cells'],
    ])
    for (const door of doors) expect(door).not.toHaveBeenCalled()
  })
})
