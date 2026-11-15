/**
 * YAZ-5043: the end of Due today, walked on today's code. The real `useCardReview` over an in-memory vault (as
 * `useCardReview.test.tsx`), and the real `CardInbox` drawn from its session, so each step reads what the screen says.
 *
 * Yaseen's flow: Due today alone; New cards alone; Due today with some Forgot → the end says today's % remembered and
 * offers "Review the missed cards" → the missed cards done → "Due today all done" → then it offers the new cards.
 *
 * The tests marked `TODAY:` pin what the code does now, where it is not yet the flow above, so a builder sees each one
 * fail on purpose when the end screens land (and turns it into the wanted check).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { cardBlock, cardRecords, parseCardLine, type CardRating } from '@shared/cardLine'
import { DEFAULT_REVIEW_SETTINGS, type ReviewSettings } from '@shared/reviews'
import type { IndexRecord } from '@shared/types'
import { createWikilinkResolveSource } from '../editor/wikilink/wikilinkPlugin'
import { useCardReview, type CardReviewApi } from './useCardReview'
import { CardInbox } from './CardInbox'
import { storage } from '../lib/storage'

;(globalThis as unknown as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true

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

/** Five known cards due today (two Remembered long ago: out of their steps), and three new cards. */
const DUE = ['DUE-1', 'DUE-2', 'DUE-3', 'DUE-4', 'DUE-5']
const NEW = ['NEW-1', 'NEW-2', 'NEW-3']
function seed(): void {
  const block = (id: string, review: string) => cardBlock(`Card ${id} {{answer}}`, parseCardLine(`<!-- card: ${id}${review} -->`)!)
  vault.set(`${ROOT}/Known.md`, `# Known\n\n${DUE.map((id) => block(id, ', 2026-09-01T09:00Z good, 2026-09-02T09:00Z good')).join('\n')}`)
  vault.set(`${ROOT}/Fresh.md`, `# Fresh\n\n${NEW.map((id) => block(id, '')).join('\n')}`)
}

let root: Root | null = null
let el: HTMLElement
let review: CardReviewApi
const wikilinks = createWikilinkResolveSource()

function Screen({ settings }: { settings: ReviewSettings }) {
  review = useCardReview(ROOT, source, settings, () => undefined)
  if (review.session === null) return null
  return (
    <CardInbox
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

async function mount(settings: ReviewSettings = { ...DEFAULT_REVIEW_SETTINGS }): Promise<void> {
  reindex()
  el = document.createElement('div')
  document.body.appendChild(el)
  root = createRoot(el)
  await act(async () => root?.render(<Screen settings={settings} />))
  await act(async () => review.start({}))
  await act(async () => reindex())
}
const step = async (run: () => unknown): Promise<void> => {
  await act(async () => void (await run()))
  await act(async () => reindex())
}
const showing = (): string | null => review.session?.card?.id ?? null
const answer = async (rating: CardRating): Promise<string> => {
  const id = showing()!
  await step(() => review.answer(rating))
  return id
}
const doneText = (): string[] => [...el.querySelectorAll('.card-inbox__done > *')].map((p) => p.textContent ?? '')
const pct = (answered: readonly CardRating[]): number => Math.round((100 * answered.filter((r) => r !== 'again').length) / answered.length)

beforeEach(() => {
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

describe('YAZ-5043: the end of Due today', () => {
  it('1. Due today alone: only the five due cards show, then "No due cards left." with the way to the new cards', async () => {
    await mount()
    expect(review.session?.counts).toMatchObject({ all: 8, due: 5, new: 3 })
    await step(() => review.setFilter('due'))
    const seen: string[] = []
    while (showing() !== null) seen.push(await answer('good'))
    expect(seen).toEqual(DUE)
    expect(doneText()[0]).toBe('No due cards left.')
    expect(doneText()).toContain('3 more in All cards')
  })

  it('2. New cards alone: only the three new cards show; each new card comes back once (two Remembered to leave its steps)', async () => {
    await mount()
    await step(() => review.setFilter('new'))
    const seen: string[] = []
    while (showing() !== null) seen.push(await answer('good'))
    expect(seen).toEqual([...NEW, ...NEW])
    expect(doneText()[0]).toBe('No new cards left.')
    expect(doneText()).toContain('5 more in All cards')
  })

  it('3a. Due today with two Forgot: the missed cards come back at the end of Due today, and all five are done after them', async () => {
    await mount()
    await step(() => review.setFilter('due'))
    for (const r of ['good', 'again', 'good', 'again', 'good'] as const) await answer(r)
    // The session knows the first pass: 3 of 5 remembered.
    expect(pct(review.session!.answered)).toBe(60)
    // The missed ones, in the order missed.
    expect(await answer('good')).toBe('DUE-2')
    expect(await answer('good')).toBe('DUE-4')
    expect(showing()).toBeNull()
    expect(doneText()[0]).toBe('No due cards left.')
  })

  it('3b. TODAY: no break after the first pass — no "You remembered 60%" and no "Review missed cards (2)"; the missed card just shows next', async () => {
    await mount()
    await step(() => review.setFilter('due'))
    for (const r of ['good', 'again', 'good', 'again', 'good'] as const) await answer(r)
    expect(showing()).toBe('DUE-2')
    expect(el.querySelector('.card-inbox__done')).toBeNull()
    expect(el.textContent).not.toMatch(/remembered \d+%/i)
    expect(el.textContent).not.toMatch(/review missed/i)
  })

  it('3c. TODAY: Due today done says no %, no "Due today all done", and offers no "Learn new cards" button, only "3 more in All cards"', async () => {
    await mount()
    await step(() => review.setFilter('due'))
    for (const r of ['good', 'again', 'good', 'good', 'good', 'good'] as const) await answer(r)
    expect(showing()).toBeNull()
    expect(doneText()).toEqual(['No due cards left.', '3 more in All cards', 'Today: 5 cards'])
    expect(el.querySelector('.card-inbox__done')?.textContent).not.toMatch(/\d+%/) // the bar's zoom says 100%; the done screen says none
    // "3 more in All cards" opens All cards: the new cards show next.
    const more = [...el.querySelectorAll<HTMLButtonElement>('.card-inbox__done-more')].find((b) => b.textContent === '3 more in All cards')!
    await act(async () => more.click())
    expect(review.session?.filter).toBe('all')
    expect(showing()).toBe('NEW-1')
  })

  it('4. TODAY: under All cards, a missed due card waits behind every new card, and Due today ends with no screen at all', async () => {
    await mount()
    expect(review.session?.filter).toBe('all')
    const seen: string[] = []
    seen.push(await answer('again')) // DUE-1 missed
    while (showing() !== null && seen.length < 20) seen.push(await answer('good'))
    // Due first, then new: no stop between them; the missed DUE-1 comes back only after the new cards' first pass.
    expect(seen.slice(0, 8)).toEqual([...DUE, ...NEW])
    expect(seen.indexOf('DUE-1', 1)).toBe(8)
    expect(doneText()[0]).toBe('Inbox complete.')
  })

  it('5. ⌘Z after the last due card takes the done screen back: the card shows again', async () => {
    await mount()
    await step(() => review.setFilter('due'))
    for (let i = 0; i < 5; i++) await answer('good')
    expect(showing()).toBeNull()
    await step(() => review.undo())
    expect(showing()).toBe('DUE-5')
  })
})
