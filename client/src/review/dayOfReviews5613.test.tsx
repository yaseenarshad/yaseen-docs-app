/**
 * YAZ-5613 (checker a, against the YAZ-5611 rules): a full day of reviews on the Mac, step by step. The real
 * `useCardReview` over an in-memory vault through the desktop host, and the real `CardInbox` drawn from its session:
 * each step reads what the SCREEN says — the card on show, "N of M", the progress bar, the menu's counts, the stops.
 *
 * The rules (YAZ-5611 spec, with Yaseen's decisions): each list count is the different cards left in it, and a ✕
 * never grows a count, M or the bar's whole (spec 8, 13, 14); the session goes Up next, Due today, New cards (spec 10);
 * a missed due card comes back after the other due cards, before the new cards (spec 12); a new card needs two ✓ and
 * its first ✓ moves it from New cards into Due today (Yaseen's Mochi rule: New −1, Due today +1); the end of Due today
 * stops once for the missed cards and once when done (spec 15); Undo puts the step back (spec 18); Add more adds for
 * today and its Undo takes it back (spec 17); a new day starts the new-card limit again (spec 21).
 *
 * Made-up data only.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { cardBlock, cardRecords, parseCardLine, type CardRating } from '@shared/cardLine'
import { DEFAULT_REVIEW_SETTINGS, type ReviewSettings } from '@shared/reviews'
import type { IndexRecord } from '@shared/types'
import { createWikilinkResolveSource } from '../editor/wikilink/wikilinkPlugin'
import { useCardReview, type CardReviewApi } from './useCardReview'
import { desktopReviewHost } from './desktopReviewHost'
import { CardInbox } from './CardInbox'
import { storage } from '../lib/storage'

;(globalThis as unknown as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true

/** Thursday 12 November 2026, 9:00 local time. */
const NOW = new Date(2026, 10, 12, 9, 0).getTime()
const ROOT = '/vault'
let vault = new Map<string, string>()
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
  records = [...vault].map(([path, content]) => scan(path, content))
  listeners.forEach((l) => l())
}

vi.mock('../views/writeProperty', () => ({
  transformFile: vi.fn(async (path: string, transform: (content: string) => string) => {
    const next = transform(vault.get(path)!)
    vault.set(path, next)
    return { mtime: 1, content: next }
  }),
}))
vi.mock('../api', async (importOriginal) => {
  const real = await importOriginal<typeof import('../api')>()
  return {
    ...real,
    api: {
      readFile: vi.fn(async (path: string) => {
        const content = vault.get(path)
        if (content === undefined) throw new real.BridgeRequestError('NOT_FOUND', 'gone')
        return { path, content, mtime: 1 }
      }),
      state: { setFolder: vi.fn(async () => undefined) },
      shell: { openLink: vi.fn() },
      vaultConfig: { read: vi.fn(async () => Promise.reject(new Error('ENOENT'))), onChange: () => () => undefined },
    },
  }
})

const block = (id: string, line: string) => cardBlock(`Card ${id} {{answer}}`, parseCardLine(`<!-- card: ${id}${line} -->`)!)
/** Known cards (two ✓ long ago, out of their steps), the most overdue first; one Up next card that is not due; new cards. */
function seed(): void {
  vault.set(`${ROOT}/Up.md`, `# Up\n\n${block('UP-1', ', 2026-11-01T09:00:00.000Z good, 2026-11-11T09:00:00.000Z good, next')}`)
  vault.set(
    `${ROOT}/Known.md`,
    `# Known\n\n${[
      block('DUE-1', ', 2026-08-01T09:00:00.000Z good, 2026-08-02T09:00:00.000Z good'),
      block('DUE-2', ', 2026-08-05T09:00:00.000Z good, 2026-08-06T09:00:00.000Z good'),
      block('DUE-3', ', 2026-08-10T09:00:00.000Z good, 2026-08-11T09:00:00.000Z good'),
    ].join('\n')}`,
  )
  vault.set(`${ROOT}/Fresh.md`, `# Fresh\n\n${['NEW-1', 'NEW-2', 'NEW-3', 'NEW-4'].map((id) => block(id, '')).join('\n')}`)
  vault.set(`${ROOT}/Later.md`, `# Later\n\n${block('LAT-1', ', 2026-11-01T09:00:00.000Z good, 2026-11-11T09:00:00.000Z good')}`)
}

let root: Root | null = null
let el: HTMLElement
let review: CardReviewApi
const wikilinks = createWikilinkResolveSource()
const SETTINGS: ReviewSettings = { ...DEFAULT_REVIEW_SETTINGS, newPerDay: 2 }

function Screen({ settings }: { settings: ReviewSettings }) {
  review = useCardReview(ROOT, source, settings, () => undefined, undefined, desktopReviewHost)
  if (review.session === null) return null
  return (
    <CardInbox
      shown
      review={review}
      session={review.session}
      vaultOf={() => ({ root: ROOT, wikilinks, wikilinkCandidates: { candidates: [], subscribe: () => () => undefined } as never })}
      openPage={vi.fn()}
      editCard={vi.fn()}
      openInTab={vi.fn()}
      openLinkIn={vi.fn()}
      openLayer={vi.fn()}
      onNotice={vi.fn()}
      openPlace={vi.fn()}
    />
  )
}

async function mount(settings: ReviewSettings = SETTINGS): Promise<void> {
  reindex()
  el = document.createElement('div')
  document.body.appendChild(el)
  root = createRoot(el)
  await act(async () => root?.render(<Screen settings={settings} />))
  await open()
}
/** The Inbox opened (again): a new session of the vault. */
const open = async (): Promise<void> => {
  await act(async () => review.close())
  await act(async () => review.start({}))
  await act(async () => reindex())
}
const step = async (run: () => unknown): Promise<void> => {
  await act(async () => void (await run()))
  await act(async () => reindex())
}
const showing = (): string | null => review.session?.card?.id ?? null
/** An answer to the card on show, 20 s after the last one (a person reads the card). */
const answer = async (rating: CardRating): Promise<void> => {
  vi.setSystemTime(Date.now() + 20_000)
  await step(() => review.answer(rating))
}
const button = (name: RegExp): HTMLButtonElement | undefined => [...el.querySelectorAll<HTMLButtonElement>('button')].find((b) => name.test(b.textContent ?? ''))
const press = async (name: RegExp): Promise<void> => {
  const b = button(name)
  expect(b, String(name)).toBeDefined()
  await step(() => b!.click())
}

/** The menu's counts, as its rows say them: the menu opened, read, closed. */
async function menu(): Promise<Record<string, string>> {
  const toggle = el.querySelector<HTMLButtonElement>('.card-inbox__filter')!
  await act(async () => toggle.click())
  const counts = Object.fromEntries([...document.querySelectorAll<HTMLElement>('.card-inbox__count[data-filter]')].map((c) => [c.dataset.filter!, c.textContent ?? '']))
  await act(async () => toggle.click())
  return counts
}
/** What the screen says at this step: the card (or the stop / done screen), "N of M", the bar's done / whole, the menu. */
async function look(): Promise<{ card: string; place: string | null; bar: string; menu: Record<string, string> }> {
  const end = el.querySelector('.due-end')
  const done = el.querySelector('.card-inbox__done > *')?.textContent
  const card = showing() ?? (end !== null ? `stop: ${el.querySelector('.due-end')?.getAttribute('data-kind')}` : `done: ${done ?? ''}`)
  const bar = el.querySelector('.card-inbox__progress')
  return {
    card,
    place: el.querySelector('.card-inbox__place')?.textContent ?? null,
    bar: `${bar?.getAttribute('aria-valuenow')}/${bar?.getAttribute('aria-valuemax')}`,
    menu: await menu(),
  }
}
const row = (card: string, place: string | null, bar: string, all: number, due: number, fresh: number, next?: number) => ({
  card,
  place,
  bar,
  menu: { all: String(all), due: String(due), new: String(fresh), ...(next !== undefined && { next: String(next) }) },
})

beforeEach(() => {
  window.matchMedia = ((q: string) => ({ matches: q.includes('reduce'), media: q, addEventListener() {}, removeEventListener() {} })) as unknown as typeof window.matchMedia
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(NOW)
  vault = new Map()
  storage.setUpNextTaken(ROOT, { day: '2000-1-1', cards: [] })
  storage.setCardsAdded(ROOT, { day: '2000-1-1', newCards: 0, upNext: 0 })
  seed()
})
afterEach(() => {
  act(() => root?.unmount())
  root = null
  el?.remove()
  vi.useRealTimers()
})

describe('YAZ-5613: a full day of reviews on the Mac, step by step (YAZ-5611 rules)', () => {
  it('morning: Up next, Due today with misses, the two stops, Undo, the new cards (two ✓ each, New → Due today)', async () => {
    await mount()
    const steps: [string, () => Promise<void>, ReturnType<typeof row>][] = [
      ['start', async () => undefined, row('UP-1', '1 of 6', '0/6', 6, 4, 2, 1)],
      // Up next first; a known card's ✓ lets it go.
      ['UP-1 ✓', () => answer('good'), row('DUE-1', '2 of 6', '1/6', 5, 3, 2)],
      // A ✕ grows nothing: the card waits at the end of the due cards.
      ['DUE-1 ✕', () => answer('again'), row('DUE-2', '3 of 6', '1/6', 5, 3, 2)],
      ['DUE-2 ✓', () => answer('good'), row('DUE-3', '4 of 6', '2/6', 4, 2, 2)],
      // The first pass of Due today is done with one miss: the stop, before the new cards.
      ['DUE-3 ✓', () => answer('good'), row('stop: missed', null, '3/6', 3, 1, 2)],
      ['Review missed cards', () => press(/^Review missed cards 1$/), row('DUE-1', '4 of 6', '3/6', 3, 1, 2)],
      ['DUE-1 ✕ again', () => answer('again'), row('DUE-1', '4 of 6', '3/6', 3, 1, 2)],
      ['Undo', () => step(() => review.undo()), row('DUE-1', '4 of 6', '3/6', 3, 1, 2)],
      ['DUE-1 ✕ again', () => answer('again'), row('DUE-1', '4 of 6', '3/6', 3, 1, 2)],
      // A known card needs one ✓ after its misses; Due today is done.
      ['DUE-1 ✓', () => answer('good'), row('stop: done', null, '4/6', 2, 0, 2)],
      ['Learn new cards', () => press(/^Learn new cards 2$/), row('NEW-1', '5 of 6', '4/6', 2, 0, 2)],
      // Yaseen's rule: a new card's first ✓ moves it into Due today (New −1, Due today +1); All cards the same.
      ['NEW-1 ✓ (first)', () => answer('good'), row('NEW-2', '6 of 6', '4/6', 2, 1, 1)],
      // A new card's ✕ keeps it under New cards; it comes back at the end.
      ['NEW-2 ✕', () => answer('again'), row('NEW-1', '6 of 6', '4/6', 2, 1, 1)],
      ['NEW-1 ✓ (second)', () => answer('good'), row('NEW-2', '6 of 6', '5/6', 1, 0, 1)],
      ['NEW-2 ✓ (first)', () => answer('good'), row('NEW-2', '6 of 6', '5/6', 1, 1, 0)],
      ['NEW-2 ✓ (second)', () => answer('good'), row('done: Inbox complete.', null, '6/6', 0, 0, 0)],
    ]
    const seen = []
    const want = []
    for (const [name, run, expected] of steps) {
      await run()
      seen.push({ step: name, ...(await look()) })
      want.push({ step: name, ...expected })
    }
    expect(seen).toEqual(want)
    // The % stop counted each due card's FIRST answer: UP-1, DUE-1 (missed), D-2, D-3.
    expect(review.session?.answered.length).toBe(11)
  })

  it('the afternoon: the Inbox opened again keeps the same cards in the lists; Add more and its Undo; the next day starts the limit again', async () => {
    await mount()
    // Up next and the three due cards, all remembered; NEW-1 begun (its first ✓).
    for (let i = 0; i < 4; i++) await answer('good')
    expect(await look()).toEqual(row('stop: done', null, '4/6', 2, 0, 2))
    await press(/^Learn new cards 2$/)
    await answer('good')
    const before = await look()
    expect(before).toEqual(row('NEW-2', '6 of 6', '4/6', 2, 1, 1))
    // Closed and opened again the same day: the same two cards left, in the same lists (NEW-1 in Due today, NEW-2 new);
    // the new-card limit counts NEW-1 as begun today, so no third new card joins.
    vi.setSystemTime(Date.now() + 60 * 60_000)
    await open()
    expect(await look()).toEqual(row('NEW-1', '1 of 2', '0/2', 2, 1, 1))
    await answer('good') // N-1's second ✓: it is done
    expect(await look()).toEqual(row('stop: done', null, '1/2', 1, 0, 1))
    await press(/^Learn new cards 1$/)
    await answer('good')
    await answer('good')
    expect(await look()).toEqual(row('done: Inbox complete.', null, '2/2', 0, 0, 0))
    expect(review.session?.more.new).toBe(2)
    // Add more for today: one more day of the Settings number (2), never more than what waits.
    await step(() => review.addCards('new'))
    expect(await look()).toEqual(row('NEW-3', '3 of 4', '2/4', 2, 0, 2))
    await step(() => review.undo())
    expect(await look()).toEqual(row('done: Inbox complete.', null, '2/2', 0, 0, 0))
    expect(review.session?.more.new).toBe(2)

    // The next day, 9:00: the limit starts again (2 new cards: N-3, N-4); no card of yesterday is in New cards; every
    // card in the lists is due before midnight.
    const tomorrow = new Date(2026, 10, 13, 9, 0).getTime()
    vi.setSystemTime(tomorrow)
    await open()
    const s = review.session!
    const midnight = new Date(2026, 10, 14).getTime()
    const ids: string[] = []
    for (let i = 0; i < s.counts.all && showing() !== null; i++) {
      ids.push(showing()!)
      expect(review.session!.card!.due).toBeLessThan(midnight)
      await act(async () => review.move(1))
    }
    expect(s.counts.new).toBe(2)
    expect(s.counts.all).toBe(s.counts.due + s.counts.new)
    expect(ids.filter((id) => id.startsWith('NEW-')).slice(-2)).toEqual(['NEW-3', 'NEW-4'])
  })

  // OPEN ITEM (YAZ-5613 result, item 1): today a new card's ✕ keeps it under New cards in the session, but the Inbox
  // opened again reads it as a Due today card (it has a review): New −1, Due today +1 with no ✓. `it.fails` holds the
  // bug in view; when the rule is settled and fixed, this turns red and becomes a plain `it`.
  it.fails('a new card ✕ once, then the Inbox opened again: it stays in its list, and no count jumps', async () => {
    await mount()
    for (let i = 0; i < 4; i++) await answer('good')
    await press(/^Learn new cards 2$/)
    await answer('again') // NEW-1 ✕: it stays under New cards (YAZ-5017)
    const inSession = await look()
    expect(inSession).toEqual(row('NEW-2', '6 of 6', '4/6', 2, 0, 2))
    vi.setSystemTime(Date.now() + 60_000)
    await open()
    const reopened = await look()
    // The same cards, in the same lists, as before the Inbox closed.
    expect(reopened.menu).toEqual(inSession.menu)
  })
})
