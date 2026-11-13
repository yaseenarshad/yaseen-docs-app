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
  notices.length = 0
  // Due: answered "good" 30 days ago (still in its steps). Not due: two "good" an hour ago (out of its steps, YAZ-5020:
  // a new card needs two). New: no review. Off: never.
  page('Geo.md', ['Capital of {{France}}?', 'WIKI-1, 2026-10-13T09:00Z good'], ['Capital of {{Peru}}?', 'WIKI-2, 2026-11-12T07:00Z good, 2026-11-12T07:01Z good'])
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

  it('YAZ-4999: setNext (the Inbox chip`s ×) writes the mark off and reads the card again', async () => {
    page('Geo.md', ['Capital of {{Peru}}?', 'WIKI-2, next'])
    await mount()
    await act(async () => review.start())
    await vi.waitFor(() => expect(review.session?.card?.page?.next).toBe(true))
    await step(() => review.setNext(`${ROOT}/Geo.md`, 'WIKI-2', false))
    expect(vault.get(`${ROOT}/Geo.md`)).toContain('<!-- card: WIKI-2 -->')
    await vi.waitFor(() => expect(review.session?.card?.page?.next).toBe(false))
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
