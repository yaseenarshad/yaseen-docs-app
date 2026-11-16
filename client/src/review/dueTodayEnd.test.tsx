/**
 * YAZ-5043: the end of Due today, walked on today's code. The real `useCardReview` over an in-memory vault (as
 * `useCardReview.test.tsx`), and the real `CardInbox` drawn from its session, so each step reads what the screen says.
 *
 * Yaseen's flow: Due today alone; New cards alone; Due today with some Forgot → the end says today's % remembered and
 * offers "Review the missed cards" → the missed cards done → "Due today all done" → then it offers the new cards.
 *
 * The end screens landed (YAZ-5043, Option A): the `TODAY:` tests of the scope are now the wanted results, and the
 * approved items have their checks (1, 2, 3, 5, 6, 8, 14–17).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import path from 'node:path'
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

/** The confetti (YAZ-5662): who asked for a burst, and from where. */
const confetti = vi.hoisted(() => ({ burst: vi.fn((_from: Element, _options?: unknown) => () => undefined) }))
vi.mock('./confetti', () => ({ confettiBurst: confetti.burst }))

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
/** A card with reviews, due in some days: not in today's queue until marked Up next (item 15). */
const LATER = 'LATER-1'
const NEW = ['NEW-1', 'NEW-2', 'NEW-3']
function seed(): void {
  const block = (id: string, review: string) => cardBlock(`Card ${id} {{answer}}`, parseCardLine(`<!-- card: ${id}${review} -->`)!)
  // Each a month more overdue than the next (Review rules v1, rule 5: the most overdue day first, then random): DUE-1 first.
  vault.set(`${ROOT}/Known.md`, `# Known\n\n${DUE.map((id, i) => block(id, `, 2026-0${3 + i}-01T09:00:00.000Z good, 2026-0${3 + i}-02T09:00:00.000Z good`)).join('\n')}`)
  vault.set(`${ROOT}/Fresh.md`, `# Fresh\n\n${NEW.map((id) => block(id, '')).join('\n')}`)
  vault.set(`${ROOT}/Later.md`, `# Later\n\n${block(LATER, ', 2026-11-01T09:00:00.000Z good, 2026-11-11T09:00:00.000Z good')}`)
}

let root: Root | null = null
let el: HTMLElement
let review: CardReviewApi
const wikilinks = createWikilinkResolveSource()

let shown = true
function Screen({ settings }: { settings: ReviewSettings }) {
  review = useCardReview(ROOT, source, settings, () => undefined, undefined, desktopReviewHost)
  if (review.session === null) return null
  return (
    <CardInbox
      shown={shown}
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
/** The done screen's lines, under its 🎉 (YAZ-5662). */
const doneText = (): string[] => [...el.querySelectorAll('.card-inbox__done > :not(.done-cheer__party)')].map((p) => p.textContent ?? '')
const pct = (answered: readonly CardRating[]): number => Math.round((100 * answered.filter((r) => r !== 'again').length) / answered.length)
const endText = (): string => el.querySelector('.due-end')?.textContent ?? ''
const button = (name: RegExp): HTMLButtonElement | undefined => [...el.querySelectorAll<HTMLButtonElement>('button')].find((b) => name.test(b.textContent ?? ''))
const press = async (name: RegExp): Promise<void> => {
  const b = button(name)
  expect(b, String(name)).toBeDefined()
  await step(() => b!.click())
}
/** Reduce motion on or off (item 5): the page's `matchMedia`. */
let reduce = false

beforeEach(() => {
  shown = true
  reduce = false
  window.matchMedia = ((q: string) => ({ matches: reduce && q.includes('reduce'), media: q, addEventListener() {}, removeEventListener() {} })) as unknown as typeof window.matchMedia
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
  it('1. Due today alone: only the five due cards show, then "Due today is done." with "Learn new cards 3", which starts them', async () => {
    await mount()
    expect(review.session?.counts).toMatchObject({ all: 8, due: 5, new: 3 })
    await step(() => review.setFilter('due'))
    const seen: string[] = []
    while (showing() !== null) seen.push(await answer('good'))
    expect(seen).toEqual(DUE)
    expect(doneText()[0]).toMatch(/Due today is done\./)
    expect(endText()).toContain('You remembered 100% of 5 cards.')
    expect(button(/^Learn new cards 3$/)).toBeDefined()
    await press(/^Learn new cards/)
    expect(review.session?.filter).toBe('new')
    expect(showing()).toBe('NEW-1')
  })

  it('2. New cards alone (item 14): only the three new cards show, and no % screen ever stops them; each first Remembered moves the card into Due today (YAZ-5610)', async () => {
    await mount()
    await step(() => review.setFilter('new'))
    const seen: string[] = []
    while (showing() !== null) {
      expect(el.querySelector('.due-end')).toBeNull()
      seen.push(await answer('good'))
    }
    // Yaseen's rule (from Mochi): a new card's first Remembered takes it out of New cards into Due today, where it comes
    // back the same day: New one less, Due today one more, All cards the same cards.
    expect(seen).toEqual(NEW)
    expect(review.session).toMatchObject({ end: null, counts: { new: 0, due: 8, all: 8 } })
    expect(doneText()[0]).toBe('No new cards left.')
    expect(doneText()).toContain('8 more in All cards')
  })

  it('3a. Due today with two Forgot: the first pass stops at "You remembered 60% of 5 cards." with ONE button, "Review missed cards 2"', async () => {
    await mount()
    await step(() => review.setFilter('due'))
    for (const r of ['good', 'again', 'good', 'again', 'good'] as const) await answer(r)
    expect(pct(review.session!.answered)).toBe(60)
    expect(showing()).toBeNull()
    expect(review.session?.end).toMatchObject({ kind: 'missed', percent: 60, count: 5, missed: 2 })
    expect(endText()).toContain('You remembered 60% of 5 cards.')
    expect(endText()).toContain('2 cards to look at again while they are fresh.')
    // Item 7: no skip. One button.
    expect([...el.querySelectorAll('.due-end button')].map((b) => b.textContent)).toEqual(['Review missed cards 2'])
    // The missed ones, in the order missed.
    await press(/^Review missed cards/)
    expect(await answer('good')).toBe('DUE-2')
    expect(await answer('good')).toBe('DUE-4')
    expect(showing()).toBeNull()
    expect(doneText()[0]).toMatch(/Due today is done\./)
  })

  it('3b. Item 3: the % counts first answers only — a missed card got right later, or missed again, does not change it', async () => {
    await mount()
    await step(() => review.setFilter('due'))
    for (const r of ['good', 'again', 'good', 'good', 'good'] as const) await answer(r)
    expect(review.session?.end?.percent).toBe(80)
    await press(/^Review missed cards/)
    expect(await answer('again')).toBe('DUE-2') // missed again: it comes back, no second % screen
    expect(showing()).toBe('DUE-2')
    expect(review.session?.end).toBeNull()
    expect(await answer('good')).toBe('DUE-2')
    expect(review.session?.end).toMatchObject({ kind: 'done', percent: 80, count: 5 })
    expect(endText()).toContain('You remembered 80% of 5 cards.')
  })

  it('3c. Due today done: the ring closes with a ✓, the screen says the %, and "Learn new cards 3" in place of "3 more in All cards"', async () => {
    await mount()
    await step(() => review.setFilter('due'))
    for (const r of ['good', 'again', 'good', 'good', 'good'] as const) await answer(r)
    await press(/^Review missed cards/)
    await answer('good')
    expect(showing()).toBeNull()
    expect(el.querySelector('.due-end')?.getAttribute('data-kind')).toBe('done')
    expect(el.querySelector('.due-end__check')).not.toBeNull()
    expect(doneText()[0]).toContain('Due today is done.')
    expect(endText()).toContain('You remembered 80% of 5 cards.')
    expect(button(/more in All cards/)).toBeUndefined()
    expect(el.querySelector('.card-inbox__done-from')?.textContent).toContain('All folders')
    await press(/^Learn new cards/)
    expect(showing()).toBe('NEW-1')
  })

  it('4. Items 1 and 2: under All cards a missed due card comes back BEFORE the new cards, with a stop after each pass', async () => {
    await mount()
    expect(review.session?.filter).toBe('all')
    const seen: string[] = []
    seen.push(await answer('again')) // DUE-1 missed
    for (let i = 0; i < 4; i++) seen.push(await answer('good'))
    expect(seen).toEqual(DUE)
    expect(showing()).toBeNull()
    expect(review.session?.end).toMatchObject({ kind: 'missed', percent: 80, missed: 1, fresh: 3 })
    await press(/^Review missed cards/)
    expect(await answer('good')).toBe('DUE-1')
    // The break before the new cards.
    expect(showing()).toBeNull()
    expect(review.session?.end).toMatchObject({ kind: 'done', fresh: 3 })
    await press(/^Learn new cards 3/)
    expect(review.session?.filter).toBe('all')
    while (showing() !== null && seen.length < 20) seen.push(await answer('good'))
    expect(seen.slice(5)).toEqual([...NEW, ...NEW])
    expect(doneText()[0]).toBe('Inbox complete.')
  })

  it('5. Item 6: ⌘Z on the % screen and on the done screen takes the stop back with the last answer: the card shows again', async () => {
    await mount()
    await step(() => review.setFilter('due'))
    for (const r of ['good', 'good', 'good', 'good', 'again'] as const) await answer(r)
    expect(review.session?.end?.kind).toBe('missed')
    await step(() => review.undo())
    expect(review.session?.end).toBeNull()
    expect(showing()).toBe('DUE-5')
    expect(await answer('good')).toBe('DUE-5')
    // Answered right this time: no missed card, so Due today is done at once — and ⌘Z there too.
    expect(review.session?.end).toMatchObject({ kind: 'done', percent: 100 })
    await step(() => review.undo())
    expect(review.session?.end).toBeNull()
    expect(showing()).toBe('DUE-5')
    await answer('again')
    expect(review.session?.end).toMatchObject({ kind: 'missed', percent: 80, count: 5 })
  })

  it('6. Item 8: a page review stops on the same screen', async () => {
    await mount()
    await act(async () => review.start({ page: `${ROOT}/Known.md` }))
    await act(async () => reindex())
    expect(review.session?.scope).toBe('page')
    for (const r of ['again', 'good', 'good', 'good', 'good'] as const) await answer(r)
    expect(endText()).toContain('You remembered 80% of 5 cards.')
    await press(/^Review missed cards 1/)
    await answer('good')
    expect(doneText()[0]).toContain('Due today is done.')
  })

  it('7. Item 15: a card that becomes due after the % screen closed never brings it back', async () => {
    await mount()
    await step(() => review.setFilter('due'))
    for (const r of ['again', 'good', 'good', 'good', 'good'] as const) await answer(r)
    await press(/^Review missed cards/)
    expect(showing()).toBe('DUE-1')
    // Marked Up next elsewhere (the page's ⋯): a card with reviews joins the session under Up next only (Review rules
    // v1, rule 7: one list per card; before, it joined Due today too and showed here).
    await step(() => review.setNext(`${ROOT}/Later.md`, LATER, true))
    expect(review.session?.counts).toMatchObject({ next: 1, due: 1 })
    expect(await answer('good')).toBe('DUE-1')
    expect(review.session?.end).toMatchObject({ kind: 'done' })
    // Under Up next it shows; its answer never brings the % screen back.
    await step(() => review.setFilter('next'))
    expect(showing()).toBe(LATER)
    await answer('good')
    expect(review.session?.end).toBeNull()
    expect(showing()).toBeNull()
  })

  it('8. Item 16: hidden (behind a page tab) the ring waits; it plays once when the tab shows, and stays still after', async () => {
    shown = false
    await mount()
    await step(() => review.setFilter('due'))
    for (const r of ['again', 'good', 'good', 'good', 'good'] as const) await answer(r)
    expect(el.querySelector('.due-end')?.getAttribute('data-motion')).toBe('wait')
    shown = true
    await step(() => reindex())
    await act(async () => root?.render(<Screen settings={{ ...DEFAULT_REVIEW_SETTINGS }} />))
    expect(el.querySelector('.due-end')?.getAttribute('data-motion')).toBe('play')
    // Behind a page tab again and back (focus mode, another tab): the stop does not wait or start over.
    shown = false
    await act(async () => root?.render(<Screen settings={{ ...DEFAULT_REVIEW_SETTINGS }} />))
    shown = true
    await act(async () => root?.render(<Screen settings={{ ...DEFAULT_REVIEW_SETTINGS }} />))
    expect(el.querySelector('.due-end')?.getAttribute('data-motion')).not.toBe('wait')
  })

  it('9. Item 5: with Reduce motion the ring shows full at once, still (no dots, no confetti)', async () => {
    reduce = true
    await mount()
    await step(() => review.setFilter('due'))
    for (let i = 0; i < 5; i++) await answer('good')
    expect(el.querySelector('.due-end')?.getAttribute('data-motion')).toBe('still')
    expect(document.querySelector('.due-end-confetti')).toBeNull()
  })

  it('10. Item 17: a history reset during the session does not change the %: it is this session\'s first answers only', async () => {
    await mount()
    await step(() => review.setFilter('due'))
    await answer('again') // DUE-1
    await answer('good') // DUE-2
    // Reset history of DUE-1 and DUE-2 elsewhere: their reviews erased.
    const reset = (id: string) => (text: string) => text.replace(new RegExp(`<!-- card: ${id}[^>]*-->`), `<!-- card: ${id} -->`)
    vault.set(`${ROOT}/Known.md`, reset('DUE-2')(reset('DUE-1')(vault.get(`${ROOT}/Known.md`)!)))
    await step(() => reindex())
    for (let i = 0; i < 3; i++) await answer('good')
    expect(review.session?.end).toMatchObject({ kind: 'missed', count: 5, remembered: 4, percent: 80 })
  })
})

describe('YAZ-5662: Inbox complete with a 🎉, a green ✓ and one burst of confetti', () => {
  const cheerCss = readFileSync(path.join(__dirname, 'doneCheer.css'), 'utf8')
  const dueCss = readFileSync(path.join(__dirname, 'dueTodayEnd.css'), 'utf8')
  /** The bursts from the done screen's 🎉 (the Due today ring has its own). */
  const cheers = (): number => confetti.burst.mock.calls.filter(([from]) => from.classList.contains('done-cheer__party')).length
  /** The burst waits for the 🎉 to land, then loads its code. */
  const settle = (): Promise<void> => act(async () => void (await new Promise((r) => setTimeout(r, 400))))
  /** The page of new cards alone: no Due today stop, so the done screen says its own title. */
  const freshPage = async (): Promise<void> => {
    await mount()
    await act(async () => review.start({ page: `${ROOT}/Fresh.md` }))
    await act(async () => reindex())
  }
  beforeEach(() => confetti.burst.mockClear())

  it('the screen shows the 🎉 above the title and a ✓ in front of it, and one burst after the last answer', async () => {
    await freshPage()
    while (showing() !== null) await answer('good')
    expect(review.session?.end).toBeNull()
    const party = el.querySelector('.card-inbox__done .done-cheer__party')
    expect(party?.textContent).toBe('🎉')
    const title = party?.nextElementSibling
    expect(title?.classList.contains('card-inbox__done-title')).toBe(true)
    // The ✓ is its `::before`, green (`--ok`, the Due today ring's), and the title still says only its words.
    expect(title?.classList.contains('done-cheer__title')).toBe(true)
    expect(title?.textContent).toBe('This page is done.')
    expect(cheerCss).toMatch(/\.done-cheer__title::before\s*\{[^}]*content:\s*'✓'[^}]*color:\s*var\(--ok\)/)
    expect(dueCss).toMatch(/\.due-end__arc--ok\s*\{[^}]*stroke:\s*var\(--ok\)/)
    // The confetti's canvas draws above the Inbox's own layer, not under it.
    const z = (css: string, sel: string) => Number(new RegExp(`\\${sel}\\s*\\{[^}]*z-index:\\s*(\\d+)`).exec(css)?.[1])
    expect(z(dueCss, '.due-end-confetti')).toBeGreaterThan(z(readFileSync(path.join(__dirname, 'cardScreens.css'), 'utf8'), '.card-inbox'))
    await settle()
    expect(cheers()).toBe(1)
  })

  it('once per landing: not again when the tab is opened again, nor for a session opened already done', async () => {
    await freshPage()
    while (showing() !== null) await answer('good')
    await settle()
    expect(cheers()).toBe(1)
    // Behind a page tab and back: the screen shows again, the confetti does not.
    shown = false
    await act(async () => root?.render(<Screen settings={{ ...DEFAULT_REVIEW_SETTINGS }} />))
    shown = true
    await act(async () => root?.render(<Screen settings={{ ...DEFAULT_REVIEW_SETTINGS }} />))
    await settle()
    expect(cheers()).toBe(1)
    // The same page opened again, nothing left in it: the 🎉 shows, with no answer this session no burst.
    await act(async () => review.start({ page: `${ROOT}/Fresh.md` }))
    await act(async () => reindex())
    expect(el.querySelector('.done-cheer__party')).not.toBeNull()
    await settle()
    expect(cheers()).toBe(1)
  })

  it('hidden at the last answer, it waits and plays when the tab shows', async () => {
    await freshPage()
    while (review.session!.counts.all > 1) await answer('good')
    shown = false
    await act(async () => root?.render(<Screen settings={{ ...DEFAULT_REVIEW_SETTINGS }} />))
    await answer('good')
    expect(showing()).toBeNull()
    await settle()
    expect(cheers()).toBe(0)
    shown = true
    await act(async () => root?.render(<Screen settings={{ ...DEFAULT_REVIEW_SETTINGS }} />))
    await settle()
    expect(cheers()).toBe(1)
  })

  it('with Reduce motion: the 🎉 and the ✓ still, no confetti', async () => {
    reduce = true
    await freshPage()
    while (showing() !== null) await answer('good')
    expect(el.querySelector('.done-cheer__party')?.getAttribute('data-motion')).toBe('still')
    expect(el.querySelector('.done-cheer__title')).not.toBeNull()
    await settle()
    expect(cheers()).toBe(0)
  })
})
