/**
 * `useCardReview` (YAZ-4967): the Inbox count and one card review session. The index is a fake source scanned from
 * an in-memory vault after every write (`cardRecords`, as the index does); `transformFile` applies the real
 * transforms to that vault, and `api.readFile` reads it.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { cardBlock, cardRecords, cardTime, cardReviewsOf, pageCards, parseCardLine, type CardLine } from '@shared/cardLine'
import { cardState } from '@shared/cardSchedule'
import { DEFAULT_REVIEW_SETTINGS, type ReviewSettings } from '@shared/reviews'
import type { IndexRecord } from '@shared/types'
import { cardPlace, useCardReview, type CardReviewApi } from './useCardReview'
import { api } from '../api'
import { storage } from '../lib/storage'

const S: ReviewSettings = { ...DEFAULT_REVIEW_SETTINGS }
const NOW = new Date(2026, 10, 12, 9, 0).getTime()
const ROOT = '/vault'

let vault = new Map<string, string>()
/** YAZ-5029: the pages whose reads wait, and the reads waiting. */
const held = new Set<string>()
let waiting: { path: string; resolve: () => void }[] = []
/** The waiting reads of `path` go on, in the order given (`order` 'last first': the newest read first). */
const release = async (path: string, order: 'in turn' | 'last first' = 'in turn'): Promise<void> => {
  const go = waiting.filter((w) => w.path === path)
  waiting = waiting.filter((w) => w.path !== path)
  held.delete(path)
  for (const w of order === 'in turn' ? go : go.reverse()) await act(async () => w.resolve())
}
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
  const folder = path.slice(ROOT.length + 1, Math.max(ROOT.length + 1, path.lastIndexOf('/')))
  return { path, name, basename: name.replace(/\.md$/, ''), title: name.replace(/\.md$/, ''), folder, ext: 'md', size: content.length, ctime: 0, mtime: 0, properties: {}, aliases: [], tags: [], links: [], embeds: [], cards: cardRecords(content) }
}

/** What the watcher does after a write: a fresh snapshot — new objects — then every subscriber woken. */
function reindex(): void {
  records = [...vault].map(([path, content]) => scan(path, content))
  listeners.forEach((l) => l())
}

const line = (text: string): CardLine => parseCardLine(`<!-- card: ${text} -->`)!
/** A page of cards: each `[text, card line]`. */
const page = (path: string, ...cards: [string, string][]): void => {
  vault.set(`${ROOT}/${path}`, `# ${path}\n\n${cards.map(([text, l]) => cardBlock(text, line(l))).join('\n')}`)
}
const reviewsOn = (path: string, id: string) => cardReviewsOf(pageCards(vault.get(`${ROOT}/${path}`)!).find((c) => c.line.parts.some((p) => p.kind === 'id' && p.id === id))!.line)

vi.mock('../views/writeProperty', () => ({
  transformFile: vi.fn(async (path: string, transform: (content: string) => string) => {
    const content = vault.get(path)
    if (content === undefined) throw new Error('cannot write')
    const next = transform(content)
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
        // YAZ-5029: a held page is read late, as a slow disk: the read waits until `release`, then reads the vault.
        if (held.has(path)) await new Promise<void>((resolve) => waiting.push({ path, resolve }))
        const content = vault.get(path)
        if (content === undefined) throw new real.BridgeRequestError('NOT_FOUND', 'gone')
        return { path, content, mtime: 1 }
      }),
      // YAZ-5028: the day's Up next list goes to the app state (`state.setFolder`), never to the browser.
      state: { setFolder: vi.fn(async () => undefined) },
    },
  }
})

;(globalThis as unknown as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true

let root: Root | null = null
let review: CardReviewApi
const notices: string[] = []
/** The last notice's button (the delete's Undo). */
let noticeAction: { label: string; run: () => void } | undefined

function Probe({ settings }: { settings: ReviewSettings }) {
  review = useCardReview(ROOT, source, settings, (text, _icon, _type, action) => {
    notices.push(text)
    noticeAction = action
  })
  return null
}

async function mount(settings: ReviewSettings = S): Promise<void> {
  reindex()
  root = createRoot(document.createElement('div'))
  await act(async () => root?.render(<Probe settings={settings} />))
}

/** A step, then the index catching up with the file it wrote. */
const step = async (run: () => unknown): Promise<void> => {
  await act(async () => void (await run()))
  await act(async () => reindex())
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(NOW)
  vault = new Map()
  held.clear()
  waiting = []
  notices.length = 0
  storage.setUpNextTaken(ROOT, { day: '2000-1-1', cards: [] }) // YAZ-5028: the day's Up next list, of no day
  storage.setCardsAdded(ROOT, { day: '2000-1-1', newCards: 0, upNext: 0 }) // YAZ-5042: the day's added numbers, of no day
  vi.mocked(api.state.setFolder).mockClear()
  // Due: answered "good" 30 days ago (still in its steps). Not due: two "good" an hour ago (out of its steps, YAZ-5020:
  // a new card needs two). New: no review. Off: never.
  page('Geo.md', ['Capital of {{France}}?', 'WIKI-1, 2026-10-13T09:00Z good'], ['Capital of {{Peru}}?', 'WIKI-2, 2026-11-12T07:00Z good, 2026-11-12T07:01Z good'])
  page('Bio/Cells.md', ['What is a {{cell}}?', 'WIKI-3'], ['Off card', 'WIKI-4, title "Off card", off'])
})

afterEach(() => {
  act(() => root?.unmount())
  root = null
  vi.useRealTimers()
})

describe('useCardReview', () => {
  it('the queue: a due card and a new card are in it, a card not due and a card turned off are not; the count says the same', async () => {
    await mount()
    expect(review.dueCount).toBe(2)
    await act(async () => review.start())
    expect(review.session).toMatchObject({ label: 'Inbox', position: 1, total: 2 })
    expect(review.session?.card).toMatchObject({ path: `${ROOT}/Geo.md`, id: 'WIKI-1', isNew: false, page: { text: 'Capital of {{France}}?' } })
    await act(async () => review.answer('again'))
    await vi.waitFor(() => expect(review.session?.card).toMatchObject({ id: 'WIKI-3', isNew: true, page: { text: 'What is a {{cell}}?' } }))
  })

  it('an answer writes exactly the review the button showed, fixed when the buttons appeared — also a minute later', async () => {
    await mount()
    await act(async () => review.start())
    let shown = null as ReturnType<CardReviewApi['showAnswers']>
    act(() => void (shown = review.showAnswers()))
    expect(shown?.map((a) => a.review.rating)).toEqual(['again', 'good'])
    expect(review.session?.answers).toBe(shown)
    vi.setSystemTime(NOW + 90_000) // the reader waits: the fixed minute stays
    const remembered = shown!.find((a) => a.review.rating === 'good')!
    await step(() => review.answer('good'))
    expect(reviewsOn('Geo.md', 'WIKI-1').at(-1)).toEqual(remembered.review)
    expect(cardState(reviewsOn('Geo.md', 'WIKI-1'), S).due).toBe(remembered.due)
    expect(review.session?.card?.id).toBe('WIKI-3')
    expect(review.session?.canUndo).toBe(true)
    expect(review.dueCount).toBe(1)
  })

  it('undo removes the last answer\'s review and shows that card again', async () => {
    await mount()
    await act(async () => review.start())
    const before = vault.get(`${ROOT}/Geo.md`)
    await step(() => review.answer('again'))
    expect(vault.get(`${ROOT}/Geo.md`)).not.toBe(before)
    await step(() => review.undo())
    expect(vault.get(`${ROOT}/Geo.md`)).toBe(before)
    expect(review.session).toMatchObject({ position: 1, canUndo: false })
    expect(review.session?.card).toMatchObject({ id: 'WIKI-1', page: { reviews: [{ at: '2026-10-13T09:00Z', rating: 'good' }] } })
    expect(review.session?.answers).toBeNull()
  })

  it('YAZ-4999: an up-next card comes first, though not due; its answer removes `next` in the same write, and undo puts the file back byte for byte', async () => {
    // WIKI-2 is not due (answered an hour ago): up next makes it due now. `next` sits after an unknown part, so a re-insert elsewhere would show.
    page('Geo.md', ['Capital of {{France}}?', 'WIKI-1, 2026-10-13T09:00Z good'], ['Capital of {{Peru}}?', 'WIKI-2, mochi x1, next, 2026-11-12T07:00Z good'])
    const before = vault.get(`${ROOT}/Geo.md`)!
    await mount()
    expect(review.dueCount).toBe(3)
    await act(async () => review.start())
    await vi.waitFor(() => expect(review.session?.card).toMatchObject({ id: 'WIKI-2', next: true, page: { next: true } }))
    const writes = vi.mocked((await import('../views/writeProperty')).transformFile).mock.calls.length
    await step(() => review.answer('good'))
    // ONE write: the review in, `next` out.
    expect(vi.mocked((await import('../views/writeProperty')).transformFile).mock.calls.length).toBe(writes + 1)
    const after = vault.get(`${ROOT}/Geo.md`)!
    expect(after).toContain(`<!-- card: WIKI-2, mochi x1, 2026-11-12T07:00Z good, ${cardTime(NOW)} good -->`)
    expect(review.dueCount).toBe(2)
    await step(() => review.undo())
    expect(vault.get(`${ROOT}/Geo.md`)).toBe(before)
    expect(review.session?.card).toMatchObject({ id: 'WIKI-2', page: { next: true } })
  })

  it('YAZ-5321: `upNext` says whether any card of the vault is marked Up next (an archived one does not count): off when its last mark goes, on again with one', async () => {
    page('Geo.md', ['Capital of {{France}}?', 'WIKI-1, 2026-10-13T09:00Z good'], ['Capital of {{Peru}}?', 'WIKI-2, next, 2026-11-12T07:00Z good'], ['Capital of {{Chad}}?', 'WIKI-3, off, next'])
    await mount()
    await act(async () => review.start())
    await vi.waitFor(() => expect(review.session?.card).toMatchObject({ id: 'WIKI-2' }))
    expect(review.session?.upNext).toBe(true)
    // The answer takes the last mark off (WIKI-3 is archived): no Up next.
    await step(() => review.answer('good'))
    await vi.waitFor(() => expect(review.session?.upNext).toBe(false))
    // Its undo puts the mark back.
    await step(() => review.undo())
    await vi.waitFor(() => expect(review.session?.upNext).toBe(true))
  })

  it('YAZ-4999: setNext (the Inbox chip`s ×) writes the mark off and reads the card again', async () => {
    page('Geo.md', ['Capital of {{Peru}}?', 'WIKI-2, next'])
    await mount()
    await act(async () => review.start())
    await vi.waitFor(() => expect(review.session?.card?.page?.next).toBe(true))
    await step(() => review.setNext(`${ROOT}/Geo.md`, 'WIKI-2', false))
    expect(vault.get(`${ROOT}/Geo.md`)).toContain('<!-- card: WIKI-2 -->')
    await vi.waitFor(() => expect(review.session?.card?.page?.next).toBe(false))
  })

  it('YAZ-5054: a session says what it reviews (`cards`), and a start can resume a moved Inbox: its filter and the card on show', async () => {
    page('Bio/More.md', ['What is a {{gene}}?', 'WIKI-5'])
    await mount()
    await act(async () => review.start({ folder: 'Bio' }))
    expect(review.session?.cards).toEqual({ folder: 'Bio' })
    expect(review.session?.card?.id).toBe('WIKI-3')
    // The card on show and the filter come along; a card no longer in the queue starts at the filter's first card.
    await act(async () => review.start({ folder: 'Bio' }, { filter: 'new', card: { path: `${ROOT}/Bio/More.md`, id: 'WIKI-5' } }))
    expect(review.session).toMatchObject({ filter: 'new', cards: { folder: 'Bio' }, card: { id: 'WIKI-5' } })
    await act(async () => review.start({}, { filter: 'due', card: { path: `${ROOT}/Gone.md`, id: 'WIKI-9' } }))
    expect(review.session).toMatchObject({ filter: 'due', cards: {}, card: { id: 'WIKI-1' } })
  })

  it('"Review this page" keeps only that page\'s cards; "Review this folder" only the folder\'s', async () => {
    await mount()
    await act(async () => review.start({ page: `${ROOT}/Bio/Cells.md` }))
    expect(review.session).toMatchObject({ label: 'Cells', total: 1, card: { id: 'WIKI-3' } })
    await act(async () => review.start({ folder: 'Bio' }))
    expect(review.session?.total).toBe(1)
    await act(async () => review.start({ page: `${ROOT}/Geo.md` }))
    expect(review.session).toMatchObject({ total: 1, card: { id: 'WIKI-1' } })
  })

  it('YAZ-5017: the filter — counts per filter (Due today = reviewed and due, New cards = never reviewed), the queue and "n of m" follow it, ← → stay inside it; the path says where the cards come from', async () => {
    page('Bio/More.md', ['A {{second}} new card', 'WIKI-5'], ['Old {{one}}', 'WIKI-6, 2026-10-01T09:00Z good'])
    await mount()
    await act(async () => review.start())
    // Due: WIKI-6 (most overdue first), WIKI-1; new: WIKI-3, WIKI-5.
    expect(review.session).toMatchObject({ filter: 'all', counts: { all: 4, due: 2, new: 2 }, position: 1, total: 4, from: ['vault'], card: { id: 'WIKI-6' } })
    await act(async () => review.setFilter('new'))
    expect(review.session).toMatchObject({ filter: 'new', position: 1, total: 2, card: { id: 'WIKI-3', isNew: true }, canBack: false, canNext: true })
    act(() => review.move(1))
    expect(review.session).toMatchObject({ position: 2, total: 2, card: { id: 'WIKI-5' }, canNext: false })
    await act(async () => review.setFilter('due'))
    expect(review.session).toMatchObject({ position: 1, total: 2, card: { id: 'WIKI-6', isNew: false } })
    await vi.waitFor(() => expect(review.session?.card?.page).not.toBeNull())
    await step(() => review.answer('good'))
    // One due card answered: "2 of 2", the counts drop by one, the new cards stay.
    await vi.waitFor(() => expect(review.session).toMatchObject({ position: 2, total: 2, counts: { all: 3, due: 1, new: 2 }, card: { id: 'WIKI-1' } }))
    await vi.waitFor(() => expect(review.session?.card?.page).not.toBeNull())
    await step(() => review.answer('good'))
    // No due card left: no card under the filter, the new cards still counted.
    expect(review.session).toMatchObject({ card: null, counts: { all: 2, due: 0, new: 2 } })
    await act(async () => review.setFilter('all'))
    expect(review.session).toMatchObject({ card: { id: 'WIKI-3' }, position: 3, total: 4 })
    // The scope's path: the folder's parts, the page's name.
    await act(async () => review.start({ folder: 'Bio' }))
    expect(review.session).toMatchObject({ filter: 'all', from: ['Bio'] })
    await act(async () => review.start({ page: `${ROOT}/Bio/Cells.md` }))
    expect(review.session?.from).toEqual(['Cells'])
  })

  it('YAZ-5017 round 2, YAZ-5132: `place` is the CURRENT card`s vault › folders › page, by title (the one breadcrumb: the head has no "in <page>"); it changes between cards of two folders', async () => {
    page('Bio/Deep/More.md', ['A {{second}} new card', 'WIKI-5'])
    source.folders = [scan(`${ROOT}/Bio/Deep/.folder.md`, '')]
    source.folders[0].title = 'Deep down'
    try {
      await mount()
      await act(async () => review.start())
      // WIKI-1 (Geo.md, due) first, then the new cards: WIKI-3 (Bio/Cells.md), WIKI-5 (Bio/Deep/More.md).
      // A page at the vault's top: the vault alone.
      expect(review.session?.place).toEqual([
        { kind: 'vault', label: 'vault', path: ROOT },
        { kind: 'page', label: 'Geo', path: `${ROOT}/Geo.md` },
      ])
      act(() => review.move(1))
      expect(review.session?.place.map((p) => [p.kind, p.label, p.path])).toEqual([
        ['vault', 'vault', ROOT],
        ['folder', 'Bio', `${ROOT}/Bio`],
        ['page', 'Cells', `${ROOT}/Bio/Cells.md`],
      ])
      act(() => review.move(1))
      expect(review.session?.place.map((p) => p.label)).toEqual(['vault', 'Bio', 'Deep down', 'More'])
      expect(review.session?.place[2].path).toBe(`${ROOT}/Bio/Deep`)
      // The scope stays what is under review, apart from the card's place.
      expect(review.session?.from).toEqual(['vault'])
    } finally {
      source.folders = []
    }
  })

  it('YAZ-5132: a card FILE`s place is its folders only — its name is its title, which the head shows (and hides while `notitle` hides it)', () => {
    const file = { ...scan(`${ROOT}/Bio/Mitosis.md`, ''), kind: 'card' as const, title: 'Mitosis' }
    const pageRecord = scan(`${ROOT}/Bio/Cells.md`, '')
    expect(cardPlace(ROOT, 'vault', [], [file, pageRecord], file.path).map((p) => [p.kind, p.label])).toEqual([
      ['vault', 'vault'],
      ['folder', 'Bio'],
    ])
    expect(cardPlace(ROOT, 'vault', [], [file, pageRecord], pageRecord.path).map((p) => [p.kind, p.label])).toEqual([
      ['vault', 'vault'],
      ['folder', 'Bio'],
      ['page', 'Cells'],
    ])
  })

  it('YAZ-5028: Up next — only the cards marked `next`, new or reviewed, never `off`; "n of m" follows it; an answer takes the card out', async () => {
    // WIKI-2 (reviewed, not due) and WIKI-5 (new) are up next; WIKI-7 is `off` and `next`: off wins.
    page('Geo.md', ['Capital of {{France}}?', 'WIKI-1, 2026-10-13T09:00Z good'], ['Capital of {{Peru}}?', 'WIKI-2, next, 2026-11-12T07:00Z good, 2026-11-12T07:01Z good'])
    page('Bio/More.md', ['A {{second}} new card', 'WIKI-5, next'], ['Off {{one}}', 'WIKI-7, off, next'])
    await mount()
    await act(async () => review.start())
    expect(review.session).toMatchObject({ filter: 'all', counts: { all: 4, next: 2, due: 2, new: 2 } })
    await act(async () => review.setFilter('next'))
    expect(review.session).toMatchObject({ filter: 'next', position: 1, total: 2, card: { id: 'WIKI-2', next: true, isNew: false }, canNext: true })
    act(() => review.move(1))
    expect(review.session).toMatchObject({ position: 2, total: 2, card: { id: 'WIKI-5', next: true, isNew: true }, canNext: false })
    act(() => review.move(-1))
    await vi.waitFor(() => expect(review.session?.card?.page).not.toBeNull())
    await step(() => review.answer('good'))
    // WIKI-2 answered: out of Up next (`next` gone), "2 of 2".
    await vi.waitFor(() => expect(review.session).toMatchObject({ position: 2, total: 2, counts: { next: 1 }, card: { id: 'WIKI-5' } }))
    await vi.waitFor(() => expect(review.session?.card?.page).not.toBeNull())
    // A new card's first Remembered keeps it in its steps: the repeat is not up next, so Up next is done.
    await step(() => review.answer('good'))
    expect(review.session).toMatchObject({ card: null, counts: { next: 0 } })
    expect(review.session?.counts.all).toBeGreaterThan(0)
  })

  it('YAZ-5028, changed by YAZ-5042 Decision 1: Up next a day — only that many marked cards are Up next today, first; the others keep the mark and wait for another day; an answer uses a place for the day', async () => {
    // WIKI-1 due, WIKI-3 new (beforeEach); marked: WIKI-5 and WIKI-6 new, WIKI-2 reviewed and not due.
    page('Geo.md', ['Capital of {{France}}?', 'WIKI-1, 2026-10-13T09:00Z good'], ['Capital of {{Peru}}?', 'WIKI-2, next, 2026-11-12T07:00Z good, 2026-11-12T07:01Z good'])
    page('Bio/More.md', ['A {{fifth}} card', 'WIKI-5, next'], ['A {{sixth}} card', 'WIKI-6, next'])
    await mount({ ...S, upNextPerDay: 1 })
    // The queue, card by card with → (each read before the next: a card not read yet leaves the one before on show).
    const order = async (): Promise<(string | undefined)[]> => {
      const ids = [review.session?.card?.id]
      while (review.session?.canNext) {
        act(() => review.move(1))
        await vi.waitFor(() => expect(review.session?.card?.id).not.toBe(ids.at(-1)))
        ids.push(review.session?.card?.id)
      }
      return ids
    }
    await act(async () => review.start())
    // One place: WIKI-2 first, and the one Up next. WIKI-5 and WIKI-6 wait for another day (YAZ-5042 Decision 1).
    expect(await order()).toEqual(['WIKI-2', 'WIKI-1', 'WIKI-3'])
    expect(review.session?.counts).toMatchObject({ all: 3, next: 1 })
    expect(review.session?.more).toEqual({ new: 0, next: 2 })
    // ⌘Z of an answer that took the mark off gives the place back.
    await act(async () => review.start())
    await vi.waitFor(() => expect(review.session?.card?.page).not.toBeNull())
    await step(() => review.answer('good'))
    await step(() => review.undo())
    await act(async () => review.start())
    expect(review.session?.card?.id).toBe('WIKI-2')
    expect(review.session?.counts.next).toBe(1)
    // WIKI-2 answered: its mark goes, and the day's one place is used. A new Inbox has no Up next today.
    await vi.waitFor(() => expect(review.session?.card?.page).not.toBeNull())
    await step(() => review.answer('good'))
    await act(async () => review.start())
    expect(await order()).toEqual(['WIKI-1', 'WIKI-3'])
    expect(review.session?.counts.next).toBe(0)
    expect(vault.get(`${ROOT}/Bio/More.md`)).toContain('WIKI-5, next')
  })

  it('YAZ-5028 Decision ("so it kinda works like new?"): Up next a day 2 with 3 marked — the Up next row says 2 and lists 2, first in All cards; empty, 3', async () => {
    page('Up.md', ['A {{one}}', 'WIKI-5, next'], ['A {{two}}', 'WIKI-6, next'], ['A {{three}}', 'WIKI-7, next'])
    await mount({ ...S, upNextPerDay: 2 })
    await act(async () => review.start())
    expect(review.session?.counts.next).toBe(2)
    expect(review.session?.card?.id).toBe('WIKI-5')
    act(() => review.setFilter('next'))
    expect(review.session).toMatchObject({ filter: 'next', position: 1, total: 2, card: { id: 'WIKI-5' } })
    act(() => review.move(1))
    expect(review.session).toMatchObject({ position: 2, total: 2, card: { id: 'WIKI-6' }, canNext: false })
    // The third keeps its mark in the file, and waits for another day (YAZ-5042 Decision 1).
    expect(vault.get(`${ROOT}/Up.md`)).toContain('WIKI-7, next')
    // Empty (no limit): all three.
    act(() => root?.render(<Probe settings={{ ...S, upNextPerDay: null }} />))
    await act(async () => review.start())
    expect(review.session?.counts.next).toBe(3)
  })

  it('YAZ-5028: the day\'s Up next list lives in the app state (the vault\'s folder bucket, `state.setFolder`), not in the browser; ⌘Z takes the card out again', async () => {
    page('Up.md', ['A {{one}}', 'WIKI-5, next'], ['A {{two}}', 'WIKI-6, next'])
    await mount({ ...S, upNextPerDay: 1 })
    await act(async () => review.start())
    await vi.waitFor(() => expect(review.session?.card?.page).not.toBeNull())
    await step(() => review.answer('good'))
    expect(storage.getUpNextTaken(ROOT)).toEqual({ day: '2026-11-12', cards: ['WIKI-5'] })
    expect(api.state.setFolder).toHaveBeenLastCalledWith(ROOT, { upNext: { day: '2026-11-12', cards: ['WIKI-5'] } })
    expect(localStorage.length).toBe(0)
    await step(() => review.undo())
    expect(storage.getUpNextTaken(ROOT)).toEqual({ day: '2026-11-12', cards: [] })
    // The list another window wrote (its broadcast lands in the same cache) holds here too: no place left today.
    storage.setUpNextTaken(ROOT, { day: '2026-11-12', cards: ['WIKI-0'] })
    await act(async () => review.start())
    expect(review.session?.counts.next).toBe(0)
    // A list of an older day is none.
    storage.setUpNextTaken(ROOT, { day: '2026-11-11', cards: ['WIKI-6'] })
    await act(async () => review.start())
    expect(review.session?.counts.next).toBe(1)
  })

  describe('YAZ-5042: add more cards for today, from the Inbox', () => {
    // WIKI-1 due, WIKI-3 new (beforeEach); five more new cards, WIKI-10..14. New cards a day 2: WIKI-3 and WIKI-10 today.
    const fiveNew = () => page('New.md', ...[10, 11, 12, 13, 14].map((n): [string, string] => [`New {{${n}}}`, `WIKI-${n}`]))
    const read = () => vi.waitFor(() => expect(review.session?.card?.page).not.toBeNull())
    const ids = () => review.session?.counts
    // No new card begun today (beforeEach's WIKI-2 was first answered today: it takes one of the day's new cards).
    beforeEach(() => page('Geo.md', ['Capital of {{France}}?', 'WIKI-1, 2026-10-13T09:00Z good']))

    it('the counts: the cards that wait past today\'s number, and the add (one more day of the number); the add joins the session, grows the count, and keeps the Settings number', async () => {
      fiveNew()
      const settings = { ...S, newPerDay: 2 }
      await mount(settings)
      expect(review.dueCount).toBe(3)
      await act(async () => review.start())
      expect(review.session).toMatchObject({ counts: { all: 3, new: 2 }, more: { new: 4, next: 0 }, adds: { new: 2, next: 0 }, lastAdd: null, total: 3 })
      act(() => review.addCards('new'))
      // The two next new cards by ID join today; the count grows; 2 still wait.
      expect(review.session).toMatchObject({ counts: { all: 5, new: 4 }, more: { new: 2 }, adds: { new: 2 }, lastAdd: { kind: 'new', count: 2 }, canUndo: true, total: 5, card: { id: 'WIKI-1' } })
      expect(review.dueCount).toBe(5)
      // Kept in the app state for today, per vault; never the Settings number.
      expect(storage.getCardsAdded(ROOT)).toEqual({ day: '2026-11-12', newCards: 2, upNext: 0 })
      expect(api.state.setFolder).toHaveBeenLastCalledWith(ROOT, { added: { day: '2026-11-12', newCards: 2, upNext: 0 } })
      expect(settings.newPerDay).toBe(2)
      // Once nothing waits, no Add: a click adds nothing.
      act(() => review.addCards('new'))
      expect(review.session).toMatchObject({ counts: { all: 7, new: 6 }, more: { new: 0 }, adds: { new: 0 } })
      act(() => review.addCards('new'))
      expect(review.session).toMatchObject({ counts: { all: 7, new: 6 } })
      expect(storage.getCardsAdded(ROOT)?.newCards).toBe(4)
      expect(localStorage.length).toBe(0)
    })

    it('undo (the line\'s Undo and Cmd + Z both call `undo`): takes back the added cards not answered yet, while the add is the last thing done', async () => {
      fiveNew()
      await mount({ ...S, newPerDay: 2 })
      await act(async () => review.start())
      await read()
      act(() => review.addCards('new'))
      await step(() => review.undo())
      expect(review.session).toMatchObject({ counts: { all: 3, new: 2 }, more: { new: 4 }, lastAdd: null, canUndo: false, total: 3 })
      expect(storage.getCardsAdded(ROOT)).toEqual({ day: '2026-11-12', newCards: 0, upNext: 0 })
      // An answer after the add: Cmd + Z undoes the answer first; the add is the last thing again, and the next undo takes it.
      act(() => review.addCards('new'))
      await read()
      await step(() => review.answer('again'))
      expect(review.session?.lastAdd).toBeNull()
      await step(() => review.undo())
      expect(review.session).toMatchObject({ card: { id: 'WIKI-1' }, lastAdd: { kind: 'new', count: 2 }, counts: { new: 4 } })
      expect(reviewsOn('Geo.md', 'WIKI-1')).toHaveLength(1)
      await step(() => review.undo())
      expect(review.session).toMatchObject({ lastAdd: null, canUndo: false, counts: { all: 3, new: 2 } })
    })

    it('the done screen: an add shows the first added card at once, also under a filter that would hide it (then All cards)', async () => {
      page('Geo.md', ['Capital of {{France}}?', 'WIKI-1, 2026-10-13T09:00Z good'])
      page('Bio/Cells.md', ['What is a {{cell}}?', 'WIKI-3'], ['A {{second}} one', 'WIKI-6'])
      page('Up.md', ['A {{one}}', 'WIKI-8, next'], ['A {{two}}', 'WIKI-9, next'])
      await mount({ ...S, newPerDay: 0, upNextPerDay: 0 })
      await act(async () => review.start())
      await read()
      await step(() => review.answer('good'))
      // Setting 0: the step is 10, never more than what waits.
      expect(review.session).toMatchObject({ card: null, more: { new: 2, next: 2 }, adds: { new: 2, next: 2 } })
      act(() => review.setFilter('due'))
      act(() => review.addCards('new'))
      await vi.waitFor(() => expect(review.session?.card?.id).toBe('WIKI-3'))
      expect(review.session).toMatchObject({ filter: 'all', card: { id: 'WIKI-3', isNew: true }, counts: { all: 2, new: 2 }, lastAdd: { kind: 'new', count: 2 } })
      // With a card on show, it stays; the Up next cards come right after it.
      act(() => review.addCards('next'))
      expect(review.session).toMatchObject({ card: { id: 'WIKI-3' }, counts: { all: 4, next: 2 }, lastAdd: { kind: 'next', count: 2 } })
      act(() => review.move(1))
      await vi.waitFor(() => expect(review.session?.card).toMatchObject({ id: 'WIKI-8', next: true }))
    })

    it('Up next: the add joins the next marked cards right after the card on show, as Up next', async () => {
      page('Up.md', ['A {{one}}', 'WIKI-5, next'], ['A {{two}}', 'WIKI-6, next'], ['A {{three}}', 'WIKI-7, next'])
      await mount({ ...S, upNextPerDay: 1 })
      await act(async () => review.start())
      await read()
      expect(review.session).toMatchObject({ card: { id: 'WIKI-5', next: true }, counts: { next: 1 }, more: { next: 2 }, adds: { next: 1 } })
      act(() => review.addCards('next'))
      expect(review.session).toMatchObject({ card: { id: 'WIKI-5' }, counts: { next: 2 }, more: { next: 1 }, lastAdd: { kind: 'next', count: 1 } })
      act(() => review.move(1))
      await vi.waitFor(() => expect(review.session?.card).toMatchObject({ id: 'WIKI-6', next: true }))
      expect(storage.getCardsAdded(ROOT)).toEqual({ day: '2026-11-12', newCards: 0, upNext: 1 })
    })

    it('resets at midnight: an added number of another day is none', async () => {
      fiveNew()
      storage.setCardsAdded(ROOT, { day: '2026-11-11', newCards: 4, upNext: 0 })
      await mount({ ...S, newPerDay: 2 })
      expect(review.dueCount).toBe(3)
      act(() => {
        review.start()
      })
      act(() => review.addCards('new'))
      expect(review.dueCount).toBe(5)
      // The next day: the add is gone, the Settings number again.
      vi.setSystemTime(new Date(2026, 10, 13, 0, 1).getTime())
      await act(async () => review.start())
      expect(review.session).toMatchObject({ counts: { new: 2 }, more: { new: 4 } })
    })

    it('folder or page review: counts that folder\'s cards; the add uses the vault\'s number', async () => {
      fiveNew()
      page('Bio/More.md', ['Bio {{a}}', 'WIKI-20'], ['Bio {{b}}', 'WIKI-21'], ['Bio {{c}}', 'WIKI-22'])
      await mount({ ...S, newPerDay: 2 })
      await act(async () => review.start({ folder: 'Bio' }))
      // Bio: WIKI-3 and WIKI-20 today; WIKI-21, 22 wait.
      expect(review.session).toMatchObject({ scope: 'folder', counts: { new: 2 }, more: { new: 2 }, adds: { new: 2 } })
      act(() => review.addCards('new'))
      expect(review.session).toMatchObject({ counts: { new: 4 }, more: { new: 0 }, adds: { new: 0 } })
      // The added number is the vault's: a page review after it takes 4 a day too, so 1 of New.md's 5 waits.
      await act(async () => review.start({ page: `${ROOT}/New.md` }))
      expect(review.session).toMatchObject({ scope: 'page', counts: { new: 4 }, more: { new: 1 } })
    })

    it('round 2: "Add [n] more" adds the typed number (10 + 12 = 22), a number above what waits adds all that waits; Reset sets today back to the Settings number; Undo and Cmd + Z take back the last add or Reset', async () => {
      page('New.md', ...Array.from({ length: 8 }, (_, i): [string, string] => [`New {{${i}}}`, `WIKI-${10 + i}`]))
      const settings = { ...S, newPerDay: 2 }
      await mount(settings)
      await act(async () => review.start())
      await read()
      // WIKI-3 and WIKI-10 today; 7 wait. Each kind has a number a day; nothing to reset yet.
      expect(review.session).toMatchObject({ counts: { new: 2 }, more: { new: 7 }, adds: { new: 2 }, limited: { new: true, next: false }, canReset: { new: false, next: false } })
      act(() => review.addCards('new', 3))
      expect(review.session).toMatchObject({ counts: { new: 5 }, more: { new: 4 }, lastAdd: { kind: 'new', count: 3, reset: false }, canReset: { new: true } })
      expect(storage.getCardsAdded(ROOT)?.newCards).toBe(3)
      // Above what waits: all that waits, no more.
      act(() => review.addCards('new', 50))
      expect(review.session).toMatchObject({ counts: { new: 9 }, more: { new: 0 }, lastAdd: { kind: 'new', count: 4 } })
      expect(storage.getCardsAdded(ROOT)?.newCards).toBe(7)
      // 0, or nothing typed that is a number: nothing.
      act(() => review.addCards('new', 0))
      expect(storage.getCardsAdded(ROOT)?.newCards).toBe(7)
      // Reset: back to the Settings number; the added cards not answered yet leave; the card on show stays.
      act(() => review.resetCards('new'))
      expect(review.session).toMatchObject({ card: { id: 'WIKI-1' }, counts: { new: 2 }, more: { new: 7 }, lastAdd: { kind: 'new', count: 7, reset: true }, canReset: { new: false }, canUndo: true })
      expect(storage.getCardsAdded(ROOT)?.newCards).toBe(0)
      expect(settings.newPerDay).toBe(2)
      // Its undo brings them back; the undo before it takes back the add before.
      await step(() => review.undo())
      expect(review.session).toMatchObject({ counts: { new: 9 }, more: { new: 0 }, lastAdd: { kind: 'new', count: 4, reset: false } })
      expect(storage.getCardsAdded(ROOT)?.newCards).toBe(7)
      await step(() => review.undo())
      expect(review.session).toMatchObject({ counts: { new: 5 }, more: { new: 4 } })
    })

    it('round 2: Reset never goes below what today already did (new cards begun past the number stay today)', async () => {
      page('New.md', ...Array.from({ length: 6 }, (_, i): [string, string] => [`New {{${i}}}`, `WIKI-${10 + i}`]))
      await mount({ ...S, newPerDay: 1 })
      await act(async () => review.start({ page: `${ROOT}/New.md` }))
      await read()
      // One new card a day: WIKI-10 today; an add of 2 brings WIKI-11 and WIKI-12.
      expect(review.session).toMatchObject({ card: { id: 'WIKI-10' }, counts: { new: 1 }, more: { new: 5 } })
      act(() => review.addCards('new', 2))
      // All three begun today: today did 3, so 2 of the added number are today's work.
      for (let i = 0; i < 3; i++) {
        await read()
        await step(() => review.answer('good'))
      }
      expect(review.session?.canReset.new).toBe(false)
      act(() => review.addCards('new', 2))
      expect(storage.getCardsAdded(ROOT)?.newCards).toBe(4)
      act(() => review.resetCards('new'))
      // Back to 3 today (1 + the 2 already done), not 1: the two just added leave.
      expect(storage.getCardsAdded(ROOT)?.newCards).toBe(2)
      expect(review.session).toMatchObject({ more: { new: 3 }, lastAdd: { kind: 'new', reset: true } })
      expect(review.session?.canReset.new).toBe(false)
    })

    it('no limit (an empty box): nothing waits, no add', async () => {
      fiveNew()
      await mount({ ...S, newPerDay: null, upNextPerDay: null })
      await act(async () => review.start())
      expect(review.session).toMatchObject({ more: { new: 0, next: 0 }, adds: { new: 0, next: 0 } })
      act(() => review.addCards('new'))
      expect(storage.getCardsAdded(ROOT)).toEqual({ day: '2000-1-1', newCards: 0, upNext: 0 })
      expect(ids()?.new).toBe(6)
    })
  })

  describe('YAZ-5031: Up next follows the marks on the card lines', () => {
    // WIKI-1 reviewed and due, WIKI-2 reviewed and not due, WIKI-3 new, WIKI-8 in its same-day steps (one Remembered a
    // minute ago: a new card needs two). `marked` puts `next` on all four, or on none.
    const lines = (marked: boolean) => {
      const n = marked ? ', next' : ''
      page('Geo.md', ['Capital of {{France}}?', `WIKI-1${n}, 2026-10-13T09:00Z good`], ['Capital of {{Peru}}?', `WIKI-2${n}, 2026-11-12T07:00Z good, 2026-11-12T07:01Z good`])
      page('Bio/Cells.md', ['What is a {{cell}}?', `WIKI-3${n}`], ['Off card', 'WIKI-4, title "Off card", off'])
      page('Bio/Learn.md', ['A {{step}} card', `WIKI-8${n}, ${cardTime(NOW - 60_000)} good`])
    }

    it('marked at start — new, reviewed and due, reviewed and not due, in its steps — they are the Up next count and filter, and first in All cards', async () => {
      lines(true)
      await mount()
      await act(async () => review.start())
      expect(review.session).toMatchObject({ filter: 'all', counts: { all: 4, next: 4 }, position: 1, total: 4, card: { id: 'WIKI-1', next: true } })
      await act(async () => review.setFilter('next'))
      expect(review.session).toMatchObject({ filter: 'next', position: 1, total: 4, counts: { next: 4 } })
    })

    it('marked while the Inbox is open (the demo: the marks came after the session began) — the count, the filter and All cards take them; the card on show stays, they come right after it', async () => {
      lines(false)
      await mount()
      await act(async () => review.start())
      // WIKI-8 (in its steps) is due now, WIKI-1 is due, WIKI-3 is new; WIKI-2 is not due.
      expect(review.session).toMatchObject({ counts: { all: 3, next: 0 } })
      const shown = review.session?.card?.id
      lines(true)
      await act(async () => reindex())
      expect(review.session).toMatchObject({ counts: { all: 4, next: 4 }, position: 1, card: { id: shown, next: true } })
      // Right after it: the other three marked, by ID number; WIKI-2 (not due) joined the session.
      const order = [shown]
      for (let i = 0; i < 3; i++) {
        act(() => review.move(1))
        order.push(review.session?.card?.id)
      }
      expect(order.slice(1)).toEqual(['WIKI-1', 'WIKI-2', 'WIKI-3', 'WIKI-8'].filter((id) => id !== shown))
      expect(review.session?.card?.next).toBe(true)
      act(() => review.move(-1))
      act(() => review.move(-1))
      act(() => review.move(-1))
      await act(async () => review.setFilter('next'))
      expect(review.session).toMatchObject({ filter: 'next', total: 4, counts: { next: 4 } })
      // The mark off again (another window, the page's ⋯): Up next empties, the card that is not due leaves the queue.
      await act(async () => review.setFilter('all'))
      lines(false)
      await act(async () => reindex())
      expect(review.session).toMatchObject({ counts: { all: 3, next: 0 }, card: { id: shown, next: false } })
    })

    it('marked while the Inbox is open, then answered: ONE write takes the review in and `next` out; undo puts the bytes back', async () => {
      await mount()
      await act(async () => review.start())
      await vi.waitFor(() => expect(review.session?.card).toMatchObject({ id: 'WIKI-1', page: { reviews: [{ rating: 'good' }] } }))
      page('Geo.md', ['Capital of {{France}}?', 'WIKI-1, next, 2026-10-13T09:00Z good'], ['Capital of {{Peru}}?', 'WIKI-2, 2026-11-12T07:00Z good, 2026-11-12T07:01Z good'])
      const before = vault.get(`${ROOT}/Geo.md`)!
      await act(async () => reindex())
      // The fake index keeps mtime 0, so the card's text is not read again: the mark comes from the index.
      expect(review.session?.card).toMatchObject({ id: 'WIKI-1', next: true })
      const writes = vi.mocked((await import('../views/writeProperty')).transformFile).mock.calls.length
      await step(() => review.answer('good'))
      expect(vi.mocked((await import('../views/writeProperty')).transformFile).mock.calls.length).toBe(writes + 1)
      expect(vault.get(`${ROOT}/Geo.md`)).toContain(`<!-- card: WIKI-1, 2026-10-13T09:00Z good, ${cardTime(NOW)} good -->`)
      expect(review.session?.counts.next).toBe(0)
      await step(() => review.undo())
      expect(vault.get(`${ROOT}/Geo.md`)).toBe(before)
      expect(review.session).toMatchObject({ card: { id: 'WIKI-1', next: true }, counts: { next: 1 } })
    })

    it('an index that has not caught up with an answer yet does not bring the answered card back as up next', async () => {
      page('Geo.md', ['Capital of {{France}}?', 'WIKI-1, next, 2026-10-13T09:00Z good'], ['Capital of {{Peru}}?', 'WIKI-2, 2026-11-12T07:00Z good, 2026-11-12T07:01Z good'])
      await mount()
      await act(async () => review.start())
      await vi.waitFor(() => expect(review.session?.card).toMatchObject({ id: 'WIKI-1', page: { next: true } }))
      const stale = records
      await act(async () => review.answer('good'))
      // Another page changed: a new snapshot, but Geo.md's record is still the one before the answer.
      records = [...stale]
      await act(async () => listeners.forEach((l) => l()))
      expect(review.session).toMatchObject({ card: { id: 'WIKI-3' }, counts: { next: 0, all: 1 } })
    })
  })

  it('YAZ-5020: the progress bar`s answers — each answer in order (a Forgot is `again`), ⌘Z takes the last back; its whole is the session`s size at start; a new session starts empty', async () => {
    await mount()
    await act(async () => review.start())
    expect(review.session).toMatchObject({ answered: [], size: 2 })
    await vi.waitFor(() => expect(review.session?.card?.page).not.toBeNull())
    // Same-day steps (YAZ-5020): a Forgot and a new card's first Remembered each add a repeat, so the whole grows.
    await step(() => review.answer('again'))
    expect(review.session).toMatchObject({ answered: ['again'], size: 3 })
    await vi.waitFor(() => expect(review.session?.card?.page).not.toBeNull())
    await step(() => review.answer('good'))
    expect(review.session).toMatchObject({ card: { id: 'WIKI-1' }, answered: ['again', 'good'], size: 4 })
    await step(() => review.undo())
    expect(review.session).toMatchObject({ answered: ['again'], size: 3 })
    await act(async () => review.start())
    expect(review.session?.answered).toEqual([])
  })

  it('a card whose page is gone when its turn comes is passed over; review off has no count and no session', async () => {
    await mount()
    await act(async () => review.start())
    vault.delete(`${ROOT}/Bio/Cells.md`)
    await step(() => review.answer('good'))
    expect(review.session?.card).toBeNull()
    expect(notices).toEqual([])
    act(() => root?.unmount())
    await mount({ ...S, enabled: false })
    expect(review.dueCount).toBe(0)
    await act(async () => review.start())
    expect(review.session).toBeNull()
  })

  it('deleteReview works on any card, in a session or not; its notice`s Undo writes the review back', async () => {
    await mount()
    const before = reviewsOn('Geo.md', 'WIKI-2')
    await act(async () => review.deleteReview(`${ROOT}/Geo.md`, 'WIKI-2', { at: '2026-11-12T07:00Z', rating: 'good' }))
    expect(reviewsOn('Geo.md', 'WIKI-2')).toEqual([{ at: '2026-11-12T07:01Z', rating: 'good' }])
    expect([notices.at(-1), noticeAction?.label]).toEqual(['Review deleted', 'Undo'])
    await act(async () => noticeAction?.run())
    await vi.waitFor(() => expect(reviewsOn('Geo.md', 'WIKI-2')).toEqual(before))
  })

  it('the delete`s Undo puts the review back in its own place: the file is the same bytes (first, middle and last review; `off` and an unknown part)', async () => {
    // Not in time order, so a re-insert by time or at the end would show in the bytes.
    page('Mixed.md', ['Q {{a}}', 'WIKI-9, off, 2026-09-01T08:00Z good, mochi x1, 2026-10-02T09:30Z hard, 2026-08-03T10:00Z again'])
    const original = vault.get(`${ROOT}/Mixed.md`)!
    await mount()
    for (const [at, rating] of [['2026-09-01T08:00Z', 'good'], ['2026-10-02T09:30Z', 'hard'], ['2026-08-03T10:00Z', 'again']] as const) {
      await act(async () => review.deleteReview(`${ROOT}/Mixed.md`, 'WIKI-9', { at, rating }))
      expect(vault.get(`${ROOT}/Mixed.md`)).not.toBe(original)
      await act(async () => noticeAction?.run())
      await vi.waitFor(() => expect(vault.get(`${ROOT}/Mixed.md`)).toBe(original))
    }
  })

  it('YAZ-5004: → and ← move through the queue with no answer; the card left stays in it, "1 of 2" follows; an answer after → leaves the card passed over in the queue', async () => {
    await mount()
    await act(async () => review.start())
    expect(review.session).toMatchObject({ position: 1, total: 2, canBack: false, canNext: true })
    const before = vault.get(`${ROOT}/Geo.md`)
    act(() => review.move(1))
    await vi.waitFor(() => expect(review.session?.card).toMatchObject({ id: 'WIKI-3', page: { text: 'What is a {{cell}}?' } }))
    expect(review.session).toMatchObject({ position: 2, canBack: true, canNext: false })
    act(() => review.move(1)) // the end: nothing
    expect(review.session?.card?.id).toBe('WIKI-3')
    act(() => review.move(-1))
    await vi.waitFor(() => expect(review.session?.card).toMatchObject({ id: 'WIKI-1', page: { text: 'Capital of {{France}}?' } }))
    expect(review.session).toMatchObject({ position: 1, canBack: false, canNext: true })
    expect(vault.get(`${ROOT}/Geo.md`)).toBe(before)
    act(() => review.move(1))
    await vi.waitFor(() => expect(review.session?.card?.page).not.toBeNull())
    await step(() => review.answer('good'))
    // WIKI-1, passed over, is still in the queue: it shows next.
    await vi.waitFor(() => expect(review.session?.card).toMatchObject({ id: 'WIKI-1', page: { text: 'Capital of {{France}}?' } }))
    // WIKI-3 was new: its first Remembered puts it back at the end (YAZ-5020), one more in the session.
    expect(review.session).toMatchObject({ position: 2, total: 3 })
  })

  it('YAZ-5004: turnOff (the Inbox ⋯) writes `off` on the card showing and takes it out of the queue', async () => {
    await mount()
    await act(async () => review.start())
    await vi.waitFor(() => expect(review.session?.card?.page).not.toBeNull())
    await step(() => review.turnOff())
    expect(vault.get(`${ROOT}/Geo.md`)).toContain('<!-- card: WIKI-1, off, 2026-10-13T09:00Z good -->')
    await vi.waitFor(() => expect(review.session?.card?.id).toBe('WIKI-3'))
    expect(review.dueCount).toBe(1)
  })

  it('YAZ-5003: a new version of the showing card`s page (Edit card in the card window) is read again in place: the new text, the same turn, its fixed answers kept', async () => {
    await mount()
    await act(async () => review.start())
    await vi.waitFor(() => expect(review.session?.card?.page).not.toBeNull())
    let shown = null as ReturnType<CardReviewApi['showAnswers']>
    act(() => void (shown = review.showAnswers()))
    vault.set(`${ROOT}/Geo.md`, vault.get(`${ROOT}/Geo.md`)!.replace('Capital of {{France}}?', 'The capital of {{France}}?'))
    await act(async () => {
      records = [...vault].map(([path, content]) => ({ ...scan(path, content), mtime: path.endsWith('Geo.md') ? 5 : 0 }))
      listeners.forEach((l) => l())
    })
    await vi.waitFor(() => expect(review.session?.card?.page?.text).toBe('The capital of {{France}}?'))
    expect(review.session?.answers).toBe(shown)
  })
})

describe('useCardReview: same-day steps (YAZ-5020)', () => {
  /** A known card (out of its steps, due) and a new card. */
  beforeEach(() => {
    vault = new Map()
    page('K.md', ['Known {{a}}?', 'WIKI-5, 2026-09-01T09:00Z good, 2026-09-01T09:01Z good'], ['New {{b}}?', 'WIKI-6'])
  })
  const shown = async (id: string): Promise<void> => vi.waitFor(() => expect(review.session?.card).toMatchObject({ id, page: { id } }))
  /** Answers the card showing once it is read, `seconds` later than the last answer. */
  const answer = async (id: string, rating: 'again' | 'good', seconds = 20): Promise<void> => {
    await shown(id)
    vi.setSystemTime(Date.now() + seconds * 1000)
    await step(() => review.answer(rating))
  }
  const place = () => [review.session?.card?.id ?? null, review.session?.position, review.session?.total]

  it('Forgot sends a known card to the end, one Remembered lets it go; a new card needs two Remembered; "3 of 4" counts the repeats', async () => {
    await mount()
    await act(async () => review.start())
    expect(place()).toEqual(['WIKI-5', 1, 2])
    await answer('WIKI-5', 'again')
    await shown('WIKI-6')
    expect(place()).toEqual(['WIKI-6', 2, 3])
    await answer('WIKI-6', 'good')
    await shown('WIKI-5')
    expect(place()).toEqual(['WIKI-5', 3, 4])
    await answer('WIKI-5', 'good')
    await shown('WIKI-6')
    expect(place()).toEqual(['WIKI-6', 4, 4])
    await answer('WIKI-6', 'good')
    expect(review.session?.card).toBeNull()
    expect(reviewsOn('K.md', 'WIKI-5').map((r) => r.rating)).toEqual(['good', 'good', 'again', 'good'])
    expect(reviewsOn('K.md', 'WIKI-6').map((r) => r.rating)).toEqual(['good', 'good'])
    expect(cardState(reviewsOn('K.md', 'WIKI-6'), S)).toMatchObject({ inSteps: false })
    expect(review.dueCount).toBe(0)
  })

  it('a new card: Remembered, Forgot, Remembered, Remembered — it leaves after the second Remembered that follows the Forgot; also in one minute', async () => {
    vault = new Map()
    page('N.md', ['New {{b}}?', 'WIKI-6'])
    await mount()
    await act(async () => review.start())
    const ratings = ['good', 'again', 'good', 'good'] as const
    for (const [i, rating] of ratings.entries()) {
      expect(place()).toEqual(['WIKI-6', i + 1, i + 1])
      await answer('WIKI-6', rating, 0)
    }
    expect(review.session?.card).toBeNull()
    expect(new Set(reviewsOn('N.md', 'WIKI-6').map((r) => r.at)).size).toBe(1) // all four in one minute
    expect(review.dueCount).toBe(0)
  })

  it('closed before the cards come back, the Inbox opened again the same day shows them at once', async () => {
    await mount()
    await act(async () => review.start())
    await answer('WIKI-5', 'again')
    await answer('WIKI-6', 'good')
    act(() => review.close())
    expect(review.dueCount).toBe(2)
    await act(async () => review.start())
    expect(review.session).toMatchObject({ position: 1, total: 2 })
    expect(review.session?.card?.id).toBe('WIKI-5')
  })

  it('undo puts back the file byte for byte and the queue: the repeat out, the card at its place, the count one smaller', async () => {
    await mount()
    await act(async () => review.start())
    const before = vault.get(`${ROOT}/K.md`)
    await answer('WIKI-5', 'again')
    expect(place()).toEqual(['WIKI-6', 2, 3])
    await step(() => review.undo())
    expect(vault.get(`${ROOT}/K.md`)).toBe(before)
    await shown('WIKI-5')
    expect(place()).toEqual(['WIKI-5', 1, 2])
    expect(review.session).toMatchObject({ canBack: false, canNext: true, canUndo: false })
    // After →: the answered card goes back to the place it was answered at, with the card passed over before it.
    act(() => review.move(1))
    await answer('WIKI-6', 'good')
    await shown('WIKI-5')
    expect(place()).toEqual(['WIKI-5', 2, 3])
    await step(() => review.undo())
    expect(vault.get(`${ROOT}/K.md`)).toBe(before)
    await shown('WIKI-6')
    expect(place()).toEqual(['WIKI-6', 2, 2])
    expect(review.session).toMatchObject({ canBack: true, canNext: false })
  })
})

describe('useCardReview: fast ← → (YAZ-5029)', () => {
  /** Five cards on five pages, so each read is its own page's. */
  beforeEach(() => {
    vault = new Map()
    for (let i = 1; i <= 5; i++) page(`P${i}.md`, [`Card {{${i}}}`, `WIKI-${10 + i}`])
  })
  /** Each card the session hands out, after every render: the Inbox draws exactly these. */
  const seen: (string | null)[] = []
  function Watch() {
    review = useCardReview(ROOT, source, S, (text) => void notices.push(text))
    const card = review.session?.card
    seen.push(card === undefined || card === null ? null : card.page === null ? `${card.id}:empty` : `${card.id}:${card.page.id}`)
    return null
  }
  const mountWatch = async () => {
    reindex()
    root = createRoot(document.createElement('div'))
    await act(async () => root?.render(<Watch />))
  }

  it('the next and the previous cards are read ahead: → shows the next card at once, with its text — no frame without it', async () => {
    await mountWatch()
    await act(async () => review.start())
    await vi.waitFor(() => expect(review.session?.card?.page?.id).toBe('WIKI-11'))
    // The neighbours are read while the first card shows.
    await act(async () => await Promise.resolve())
    seen.length = 0
    act(() => review.move(1))
    expect(review.session?.card).toMatchObject({ id: 'WIKI-12', page: { id: 'WIKI-12', text: 'Card {{2}}' } })
    act(() => review.move(1))
    expect(review.session?.card).toMatchObject({ id: 'WIKI-13', page: { text: 'Card {{3}}' } })
    act(() => review.move(-1))
    expect(review.session?.card).toMatchObject({ id: 'WIKI-12', page: { text: 'Card {{2}}' } })
    expect(seen.filter((c) => c === null || c.endsWith(':empty'))).toEqual([])
  })

  it('a card read late: the card before stays, whole, until its text is ready — never an empty card; then the new one shows', async () => {
    held.add(`${ROOT}/P2.md`)
    await mountWatch()
    await act(async () => review.start())
    await vi.waitFor(() => expect(review.session?.card?.page?.id).toBe('WIKI-11'))
    seen.length = 0
    act(() => review.move(1))
    // "2 of 5" at once; the card on show is still the first, with its own text (its head and its text agree).
    expect(review.session?.position).toBe(2)
    expect(review.session?.card).toMatchObject({ id: 'WIKI-11', page: { id: 'WIKI-11' } })
    expect(review.session?.answers).toBeNull()
    await release(`${ROOT}/P2.md`)
    expect(review.session?.card).toMatchObject({ id: 'WIKI-12', page: { id: 'WIKI-12', text: 'Card {{2}}' } })
    expect(seen.filter((c) => c === null || c.endsWith(':empty'))).toEqual([])
  })

  it('a stale read never wins: → then ← before the slow page is read, and its late read does not replace the card showing', async () => {
    held.add(`${ROOT}/P2.md`)
    await mountWatch()
    await act(async () => review.start())
    await vi.waitFor(() => expect(review.session?.card?.page?.id).toBe('WIKI-11'))
    act(() => review.move(1))
    act(() => review.move(-1))
    expect(review.session?.card).toMatchObject({ id: 'WIKI-11', page: { id: 'WIKI-11' } })
    await release(`${ROOT}/P2.md`, 'last first')
    expect(review.session?.card).toMatchObject({ id: 'WIKI-11', page: { id: 'WIKI-11', text: 'Card {{1}}' } })
    expect(review.session?.position).toBe(1)
  })

  it('a page changed on disk after it was read ahead is read again: the cached text never outlives its file', async () => {
    await mountWatch()
    await act(async () => review.start())
    await vi.waitFor(() => expect(review.session?.card?.page?.id).toBe('WIKI-11'))
    await act(async () => await Promise.resolve())
    vault.set(`${ROOT}/P2.md`, vault.get(`${ROOT}/P2.md`)!.replace('Card {{2}}', 'Card {{two}}'))
    await act(async () => {
      records = [...vault].map(([path, content]) => ({ ...scan(path, content), mtime: path.endsWith('P2.md') ? 7 : 0 }))
      listeners.forEach((l) => l())
    })
    act(() => review.move(1))
    await vi.waitFor(() => expect(review.session?.card).toMatchObject({ id: 'WIKI-12', page: { text: 'Card {{two}}' } }))
  })
})

describe('YAZ-5033: the answer saves how long it took; today`s total', () => {
  it('answer(rating, seconds) writes `<time> good 13s`, and its undo puts the file back byte for byte (with `next` and an older timed review)', async () => {
    page('Geo.md', ['Capital of {{Peru}}?', 'WIKI-2, mochi x1, next, 2026-11-12T07:00Z good 40s'])
    const before = vault.get(`${ROOT}/Geo.md`)!
    await mount()
    await act(async () => review.start())
    await vi.waitFor(() => expect(review.session?.card).toMatchObject({ id: 'WIKI-2', page: { next: true } }))
    await step(() => review.answer('good', 13))
    expect(vault.get(`${ROOT}/Geo.md`)).toContain(`<!-- card: WIKI-2, mochi x1, 2026-11-12T07:00Z good 40s, ${cardTime(NOW)} good 13s -->`)
    expect(reviewsOn('Geo.md', 'WIKI-2').at(-1)).toEqual({ at: cardTime(NOW), rating: 'good', seconds: 13 })
    await step(() => review.undo())
    expect(vault.get(`${ROOT}/Geo.md`)).toBe(before)
  })

  it('no seconds (or a value a part cannot hold): the review is written as before, with none', async () => {
    await mount()
    await act(async () => review.start())
    await vi.waitFor(() => expect(review.session?.card?.id).toBe('WIKI-1'))
    await step(() => review.answer('again', 1.5))
    expect(vault.get(`${ROOT}/Geo.md`)).toContain(`<!-- card: WIKI-1, 2026-10-13T09:00Z good, ${cardTime(NOW)} again -->`)
    await vi.waitFor(() => expect(review.session?.card?.id).toBe('WIKI-3'))
    await step(() => review.answer('good'))
    expect(reviewsOn('Bio/Cells.md', 'WIKI-3')).toEqual([{ at: cardTime(NOW), rating: 'good' }])
  })

  it('session.today: the cards answered today across the vault, from the index, with their seconds; it follows each answer', async () => {
    // WIKI-2 was answered twice today, an hour ago, with no seconds: one card, 0 s. (Local times: any time zone.)
    page('Geo.md', ['Capital of {{France}}?', 'WIKI-1, 2026-10-13T09:00Z good'], ['Capital of {{Peru}}?', `WIKI-2, ${cardTime(NOW - 3_600_000)} good, ${cardTime(NOW - 3_540_000)} good`])
    await mount()
    await act(async () => review.start())
    expect(review.session?.today).toEqual({ cards: 1, reviews: 2, seconds: 0 })
    await step(() => review.answer('good', 13))
    expect(review.session?.today).toEqual({ cards: 2, reviews: 3, seconds: 13 })
    await vi.waitFor(() => expect(review.session?.card?.id).toBe('WIKI-3'))
    await step(() => review.answer('again', 50))
    expect(review.session?.today).toEqual({ cards: 3, reviews: 4, seconds: 63 })
    await step(() => review.undo())
    expect(review.session?.today).toEqual({ cards: 2, reviews: 3, seconds: 13 })
  })
})

describe('YAZ-5046: an archived card is never reviewed', () => {
  it('the review\'s counts and queue leave archived cards out (YAZ-5319: the Inbox lists none; a folder page\'s table finds them)', async () => {
    page('Old.md', ['Old fact', 'WIKI-8, title "Old fact", off, 2025-01-01T09:00Z good'], ['Kept', 'WIKI-9'])
    await mount()
    await act(async () => review.start())
    await vi.waitFor(() => expect(review.session?.card?.page).not.toBeNull())
    expect(review.session?.counts).toEqual({ all: 3, next: 0, due: 1, new: 2 })
    expect(review.session).not.toHaveProperty('archived')
  })
})
