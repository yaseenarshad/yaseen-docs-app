/**
 * YAZ-5621 (Review audit item 5): on the Mac, Archive card is on the Undo stack, as on the phone (YAZ-5078). The real
 * `useCardReview` with the desktop host over an in-memory vault, and the real `CardInbox` drawn from its session (as
 * `dueTodayEnd.test.tsx`). Made-up cards only.
 *
 * Before the fix the Mac's host left the archive off the stack: no "Archived · Undo", and ⌘Z took back the answer
 * BEFORE the archive.
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

/** Three known cards due today, on one page; each a month more overdue than the next (Review rules v1, rule 5: the most overdue day first). */
const IDS = ['ARC-1', 'ARC-2', 'ARC-3']
const PAGE = `${ROOT}/Archive.md`
function seed(): void {
  const block = (id: string, i: number) => cardBlock(`Card ${id} {{answer}}`, parseCardLine(`<!-- card: ${id}, 2026-0${4 + i}-01T09:00:00.000Z good, 2026-0${4 + i}-02T09:00:00.000Z good -->`)!)
  vault.set(PAGE, `# Archive\n\n${IDS.map(block).join('\n')}`)
}

let root: Root | null = null
let el: HTMLElement
let review: CardReviewApi
const wikilinks = createWikilinkResolveSource()

function Screen() {
  review = useCardReview(ROOT, source, { ...DEFAULT_REVIEW_SETTINGS, dueTodayOrder: 'in-order' }, () => undefined, undefined, desktopReviewHost)
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

async function mount(): Promise<void> {
  reindex()
  el = document.createElement('div')
  document.body.appendChild(el)
  root = createRoot(el)
  await act(async () => root?.render(<Screen />))
  await act(async () => review.start({}))
  await act(async () => reindex())
}
const step = async (run: () => unknown): Promise<void> => {
  await act(async () => void (await run()))
  await act(async () => reindex())
}
const showing = (): string | null => review.session?.card?.id ?? null
/** The line under the buttons. */
const lastText = (): string => el.querySelector('.card-inbox__last')?.textContent ?? ''
const menuRow = (label: string) => [...document.querySelectorAll<HTMLButtonElement>('.ctx-menu [role="menuitem"]')].find((b) => b.textContent === label)
/** ⋯, then its Archive card, then the ask's Archive (YAZ-5697 round 2: the ONE card menu). */
const archive = async (): Promise<void> => {
  await step(() => el.querySelector<HTMLButtonElement>('.card-inbox__head-more')!.click())
  await step(() => menuRow('Archive card')!.click())
  await vi.waitFor(() => expect(document.querySelector('.ctx-menu__ask')).not.toBeNull())
  await step(() => menuRow('Archive')!.click())
}
const cmdZ = async (): Promise<void> => {
  await step(() => void (el.querySelector('.card-inbox') ?? document.body).dispatchEvent(new KeyboardEvent('keydown', { key: 'z', metaKey: true, bubbles: true, cancelable: true })))
}
const lineOf = (id: string): string => vault.get(PAGE)!.split('\n').find((l) => l.includes(`card: ${id}`))!

beforeEach(() => {
  window.matchMedia = ((q: string) => ({ matches: false, media: q, addEventListener() {}, removeEventListener() {} })) as unknown as typeof window.matchMedia
  vi.useFakeTimers({ toFake: ['Date', 'setTimeout', 'clearTimeout'] })
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

describe('YAZ-5621: Archive card has an Undo on the Mac, as on the phone', () => {
  it('YAZ-5697 round 2: the Inbox head\'s ⋯ is the ONE card menu (the card\'s rows, YAZ-5963); one click on Archive card never archives', async () => {
    await mount()
    const first = showing()!
    await step(() => el.querySelector<HTMLButtonElement>('.card-inbox__head-more')!.click())
    expect([...document.querySelectorAll<HTMLButtonElement>('.ctx-menu .ctx-menu__item')].map((b) => b.textContent)).toEqual(['Open card', 'Move to Up next', 'Archive card', 'Title in review'])
    await step(() => menuRow('Archive card')!.click())
    await vi.waitFor(() => expect(document.querySelector('.ctx-menu__ask')?.textContent).toContain('Archive this card?'))
    expect(showing()).toBe(first)
    expect(lineOf(first)).not.toContain(', off')
    await step(() => menuRow('Cancel')!.click())
    expect(showing()).toBe(first)
    expect(lineOf(first)).not.toContain(', off')
  })

  it('archive, then the line\'s Undo: "Archived · Undo" shows for 4 seconds, and Undo puts the card back, its file byte for byte', async () => {
    await mount()
    const before = vault.get(PAGE)
    expect(showing()).toBe('ARC-1')
    await archive()
    expect(lineOf('ARC-1')).toContain(', off')
    expect(showing()).toBe('ARC-2')
    expect(review.session?.canUndo).toBe(true)
    expect(lastText()).toMatch(/^Archived · Undo/)
    const undo = el.querySelector<HTMLButtonElement>('.card-inbox__last-undo')!
    expect(undo.disabled).toBe(false)
    await step(() => undo.click())
    expect(vault.get(PAGE)).toBe(before)
    expect(showing()).toBe('ARC-1')
    expect(review.session?.canUndo).toBe(false)
    expect(lastText()).toBe('')
  })

  it('the short line goes after 4 seconds; Undo stays on ⌘Z', async () => {
    await mount()
    await archive()
    expect(lastText()).toMatch(/^Archived/)
    await act(async () => void vi.advanceTimersByTime(4000))
    expect(lastText()).toBe('')
    await cmdZ()
    expect(showing()).toBe('ARC-1')
    expect(lineOf('ARC-1')).not.toContain('off')
  })

  it('answer, then archive, then ⌘Z: ⌘Z takes back the archive, not the answer before it', async () => {
    await mount()
    await step(() => review.answer('good'))
    const answered = vault.get(PAGE)
    expect(showing()).toBe('ARC-2')
    await archive()
    expect(lineOf('ARC-2')).toContain(', off')
    // The answer's line goes while the archive is the last thing done: its Undo would take back the archive.
    expect(lastText()).toMatch(/^Archived · Undo/)
    await cmdZ()
    expect(vault.get(PAGE)).toBe(answered)
    expect(showing()).toBe('ARC-2')
    expect(review.session?.answered).toEqual(['good'])
  })

  it('answer, archive, ⌘Z, ⌘Z: the archive goes back first, then the answer', async () => {
    await mount()
    const before = vault.get(PAGE)
    await step(() => review.answer('good'))
    const answered = vault.get(PAGE)
    await archive()
    await cmdZ()
    expect(vault.get(PAGE)).toBe(answered)
    expect(showing()).toBe('ARC-2')
    await cmdZ()
    expect(vault.get(PAGE)).toBe(before)
    expect(showing()).toBe('ARC-1')
    expect(review.session?.answered).toEqual([])
    expect(review.session?.canUndo).toBe(false)
  })
})
