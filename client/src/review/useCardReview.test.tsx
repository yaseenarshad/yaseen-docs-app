/**
 * `useCardReview` (YAZ-4967): the Inbox count and one card review session. The index is a fake source scanned from
 * an in-memory vault after every write (`cardRecords`, as the index does); `transformFile` applies the real
 * transforms to that vault, and `api.readFile` reads it.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { cardBlock, cardRecords, cardReviewsOf, pageCards, parseCardLine, type CardLine } from '@shared/cardLine'
import { cardState } from '@shared/cardSchedule'
import { DEFAULT_REVIEW_SETTINGS, type ReviewSettings } from '@shared/reviews'
import type { IndexRecord } from '@shared/types'
import { useCardReview, type CardReviewApi } from './useCardReview'

const S: ReviewSettings = { ...DEFAULT_REVIEW_SETTINGS }
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
        const content = vault.get(path)
        if (content === undefined) throw new real.BridgeRequestError('NOT_FOUND', 'gone')
        return { path, content, mtime: 1 }
      }),
    },
  }
})

;(globalThis as unknown as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true

let root: Root | null = null
let review: CardReviewApi
const notices: string[] = []

function Probe({ settings }: { settings: ReviewSettings }) {
  review = useCardReview(ROOT, source, settings, (text) => void notices.push(text))
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
  notices.length = 0
  // Due: answered "good" 30 days ago. Not due: answered "good" an hour ago. New: no review. Off: never.
  page('Geo.md', ['Capital of {{France}}?', 'WIKI-1, 2026-10-13T09:00Z good'], ['Capital of {{Peru}}?', 'WIKI-2, 2026-11-12T07:00Z good'])
  page('Bio/Cells.md', ['What is a {{cell}}?', 'WIKI-3'], ['Off card', 'WIKI-4, off'])
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
    await act(async () => review.skip())
    expect(review.session?.card).toMatchObject({ id: 'WIKI-3', isNew: true, page: { text: 'What is a {{cell}}?' } })
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

  it('"Review this page" keeps only that page\'s cards; "Review this folder" only the folder\'s', async () => {
    await mount()
    await act(async () => review.start({ page: `${ROOT}/Bio/Cells.md` }))
    expect(review.session).toMatchObject({ label: 'Cells', total: 1, card: { id: 'WIKI-3' } })
    await act(async () => review.start({ folder: 'Bio' }))
    expect(review.session?.total).toBe(1)
    await act(async () => review.start({ page: `${ROOT}/Geo.md` }))
    expect(review.session).toMatchObject({ total: 1, card: { id: 'WIKI-1' } })
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

  it('deleteReview works on any card, in a session or not', async () => {
    await mount()
    await act(async () => review.deleteReview(`${ROOT}/Geo.md`, 'WIKI-2', '2026-11-12T07:00Z'))
    expect(reviewsOn('Geo.md', 'WIKI-2')).toEqual([])
  })
})
