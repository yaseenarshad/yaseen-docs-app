/**
 * YAZ-5616 (checker d, real taps on the phone; the YAZ-5611 rules), the Mac's twin of
 * `mobile/src/review/newListFirst5616.test.tsx`: new cards begun in the New cards list, then the rest of the day under
 * another list. A new card needs two ✓ the same day (Yaseen's rule): its first ✓ moves it into Due today and it comes
 * back in the same session. Before the fix the end of Due today counted only the plain new cards: with none left it
 * offered nothing, and the session ended with the begun cards still in it. The real `useCardReview` and `CardInbox`
 * over an in-memory vault (the harness of `dayOfReviews5613.test.tsx`). Made-up data only.
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
function seed(): void {
  vault.set(`${ROOT}/Known.md`, `# Known\n\n${[block('DUE-1', ', 2026-08-01T09:00:00.000Z good, 2026-08-02T09:00:00.000Z good'), block('DUE-2', ', 2026-08-05T09:00:00.000Z good, 2026-08-06T09:00:00.000Z good')].join('\n')}`)
  vault.set(`${ROOT}/Fresh.md`, `# Fresh\n\n${['NEW-1', 'NEW-2', 'NEW-3'].map((id) => block(id, '')).join('\n')}`)
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
/** What the screen says at this step: the card (or the stop / done screen), "done / total", the bar's done / whole, the menu. */
async function look(): Promise<{ card: string; place: string | null; bar: string; menu: Record<string, string> }> {
  const end = el.querySelector('.due-end')
  const done = el.querySelector('.card-inbox__done > :not(.done-cheer__party)')?.textContent
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

/** Every card the screen shows from here, each ✓, through the stops' one button, to the done screen. */
async function rest(): Promise<string[]> {
  const seen: string[] = []
  for (let i = 0; i < 20; i++) {
    const { card } = await look()
    seen.push(card)
    if (card === 'stop: done' && button(/^Learn new cards/) !== undefined) await press(/^Learn new cards/)
    else if (card.startsWith('stop') || card.startsWith('done')) break
    else await answer('good')
  }
  return seen
}

describe('YAZ-5616: new cards begun in the New cards list come back the same day (Mac)', () => {
  it('then All cards: the due cards, "Due today is done." offers the 2 begun cards, their second ✓, Inbox complete', async () => {
    await mount()
    await act(async () => review.setFilter('new'))
    await answer('good') // NEW-1's first ✓: it moves into Due today, out of this list
    await answer('good') // NEW-2's first ✓
    expect((await look()).card).toBe('done: No new cards left.')
    await act(async () => review.setFilter('all'))
    expect(await rest()).toEqual(['DUE-1', 'DUE-2', 'stop: done', 'NEW-1', 'NEW-2', 'done: Inbox complete.'])
    // YAZ-5675 (Mochi): All cards counts each new card's first ✓ and its second (the card came back today): 2 + 2 + 2.
    expect((await look()).bar).toBe('6/6')
  })

  it('then Due today: the begun cards are Due today cards, so its end leads on to them', async () => {
    await mount()
    await act(async () => review.setFilter('new'))
    await answer('good')
    await answer('good')
    await act(async () => review.setFilter('due'))
    // Nothing is left in any list: the vault's done screen.
    expect(await rest()).toEqual(['DUE-1', 'DUE-2', 'stop: done', 'NEW-1', 'NEW-2', 'done: Inbox complete.'])
  })
})
