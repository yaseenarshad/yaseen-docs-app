/**
 * The "Reviews" section (YAZ-2322), mounted with react-dom in jsdom over a REAL
 * `WikilinkResolveSource` like the backlinks' test, so an index snapshot reaches it the live way.
 * `transformFile` is mocked: a write is observed as the transform it was handed, applied here to
 * the bytes it would meet. The log and the schedule have their own tests (`reviews.test.ts`,
 * `schedule.test.ts`); nothing here re-proves them.
 *
 * Only `Date` is faked, so "in 5 days" is deterministic and a write's promise settles on its own.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { DEFAULT_REVIEW_SETTINGS, reviewsOf } from '@shared/reviews'
import type { IndexRecord } from '@shared/types'
import { createWikilinkResolveSource, type MutableWikilinkResolveSource } from '../editor/wikilink/wikilinkPlugin'
import { ReviewsSection } from './ReviewsSection'

vi.mock('../views/writeProperty', () => ({ transformFile: vi.fn() }))

import { transformFile } from '../views/writeProperty'

const write = vi.mocked(transformFile)

;(globalThis as unknown as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true

/** Upkeep turned on — the only settings App hands the section. */
const S = { ...DEFAULT_REVIEW_SETTINGS, enabled: true }
const DAY = 86_400_000
const PATH = '/vault/Card.md'
const NOW = Date.parse('2026-10-04T12:00:00Z')
const FIRST = '2026-08-01T12:00:00Z'
const SECOND = '2026-09-03T12:00:00Z'

const card = (reviews = '') => `---\ntitle: Card\n${reviews}---\nBody\n`
const NEVER = card()
const ONE = card(`reviews:\n  - {at: ${FIRST}, rating: keep, text: "aaaaaaaa"}\n`)
/** Later review first on disk: the section reads them in time order. The first saw a body since edited. */
const TWO = card(`reviews:\n  - {at: ${SECOND}, rating: keep, text: "bbbbbbbb"}\n  - {at: ${FIRST}, rating: keep, text: "aaaaaaaa"}\n`)

/** The note's index record: last changed 25 days ago, its body as the second review saw it. */
const rec = (over: Partial<IndexRecord> = {}): IndexRecord => ({
  path: PATH,
  name: 'Card.md',
  basename: 'Card',
  folder: '',
  ext: 'md',
  size: 1,
  ctime: 0,
  mtime: NOW - 25 * DAY,
  properties: {},
  aliases: [],
  tags: [],
  links: [],
  embeds: [],
  text: 'bbbbbbbb',
  ...over,
})

/** A date as the section prints it — through the same call, so the test holds in any time zone. */
const day = (ms: number | string) => new Date(ms).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })

let root: Root | null = null
let container: HTMLElement | null = null
let source: MutableWikilinkResolveSource

const feed = (records: IndexRecord[]): void => act(() => source.update(() => null, records))

function unmount(): void {
  act(() => root?.unmount())
  root = null
  container?.remove()
  container = null
}

function mount(content: string, props: Partial<Parameters<typeof ReviewsSection>[0]> = { source, settings: S }): HTMLElement {
  unmount()
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  act(() => root?.render(<ReviewsSection file={{ path: PATH, content }} {...props} />))
  return container
}

const settle = (): Promise<void> => act(async () => {})
const click = (el: Element | null | undefined): void => act(() => void el?.dispatchEvent(new MouseEvent('click', { bubbles: true })))
const header = (el: HTMLElement) => el.querySelector<HTMLButtonElement>('.reviews__header')
const rows = (el: HTMLElement) => [...el.querySelectorAll<HTMLTableRowElement>('.reviews tbody tr')].map((tr) => [...tr.cells].map((td) => td.textContent))
const button = (el: HTMLElement, name: string) => [...el.querySelectorAll<HTMLButtonElement>('button')].find((b) => (b.getAttribute('aria-label') ?? b.textContent) === name)
const sheet = (el: HTMLElement) => el.querySelector('.confirm[role="dialog"]')
/** The transform the last write was handed, applied to `content`. */
const written = (content: string): string => {
  expect(write.mock.lastCall?.[0]).toBe(PATH)
  return (write.mock.lastCall?.[1] as (fresh: string) => string)(content)
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(NOW)
  source = createWikilinkResolveSource()
  write.mockResolvedValue({ mtime: 2, content: '' })
})

afterEach(() => {
  unmount()
  vi.resetAllMocks()
  vi.useRealTimers()
})

describe('ReviewsSection (YAZ-2322)', () => {
  it('a never-reviewed note shows when it is next checked, collapsed, and has no rows', () => {
    feed([rec()])
    const el = mount(NEVER)
    expect(header(el)?.getAttribute('aria-expanded')).toBe('false')
    expect(header(el)?.textContent).toBe(`Reviews (0)Next check ${day(NOW + 5 * DAY)} · in 5 days`)
    expect(el.querySelector('.reviews__body')).toBeNull()
    click(header(el))
    expect(header(el)?.getAttribute('aria-expanded')).toBe('true')
    expect(rows(el)).toEqual([])
    expect(el.querySelector('.reviews__body')?.textContent).toBe('No reviews yet.')
  })

  it('a note past its date is due now', () => {
    feed([rec({ mtime: NOW - 40 * DAY })])
    expect(header(mount(NEVER))?.textContent).toBe(`Reviews (0)Next check ${day(NOW - 10 * DAY)} · due now`)
  })

  it('a note due later today is due now, as the Inbox counts it', () => {
    feed([rec({ mtime: NOW - 30 * DAY + 60_000 })])
    expect(header(mount(NEVER))?.textContent).toBe(`Reviews (0)Next check ${day(NOW)} · due now`)
  })

  it('lists the reviews oldest first: the date, the days since the one before, the date it set, and whether the page changed since', () => {
    feed([rec()])
    const el = mount(TWO)
    // One review in a row saw the body as it is now: 60 days after it.
    expect(header(el)?.textContent).toBe(`Reviews (2)Next check ${day(Date.parse(SECOND) + 60 * DAY)} · in 4 weeks`)
    click(header(el))
    expect(rows(el)).toEqual([
      [day(FIRST), '', `next check ${day(Date.parse(FIRST) + 60 * DAY)}`, 'edited since', 'Delete'],
      [day(SECOND), '33 days later', `next check ${day(Date.parse(SECOND) + 60 * DAY)}`, '', 'Delete'],
    ])
  })

  it('with review off it says so and shows no date', () => {
    feed([rec({ properties: { review: false } })])
    expect(header(mount(TWO))?.textContent).toBe('Reviews (2)Review is off for this note.')
  })

  it('deleting a row removes exactly that review; deleting the last one removes the key', async () => {
    feed([rec()])
    const el = mount(TWO)
    click(header(el))
    click(button(el, `Delete review of ${day(SECOND)}`))
    expect(write).toHaveBeenCalledTimes(1)
    expect(reviewsOf(written(TWO)).map((r) => r.at)).toEqual([FIRST])
    click(button(el, `Delete review of ${day(FIRST)}`))
    expect(reviewsOf(written(TWO)).map((r) => r.at)).toEqual([SECOND])
    expect(written(ONE)).toBe(NEVER)
    await settle()
  })

  it('Reset asks first: cancelling writes nothing, confirming removes the whole log', async () => {
    feed([rec()])
    const el = mount(TWO)
    click(header(el))
    click(button(el, 'Reset review history'))
    expect(sheet(el)?.querySelector('.confirm__text')?.textContent).toBe("Reset this note's review history? This cannot be undone.")
    click(button(el, 'Cancel'))
    expect(sheet(el)).toBeNull()
    expect(write).not.toHaveBeenCalled()
    click(button(el, 'Reset review history'))
    click(button(el, 'Reset'))
    expect(sheet(el)).toBeNull()
    expect(write).toHaveBeenCalledTimes(1)
    expect(written(TWO)).toBe(NEVER)
    await settle()
  })

  it('a never-reviewed note has nothing to reset', () => {
    feed([rec()])
    const el = mount(NEVER)
    click(header(el))
    expect(button(el, 'Reset review history')).toBeUndefined()
  })

  it('a failed write is said inline, and the next one that lands clears it', async () => {
    write.mockRejectedValueOnce(new Error('disk full'))
    feed([rec()])
    const el = mount(TWO)
    click(header(el))
    click(button(el, `Delete review of ${day(SECOND)}`))
    await settle()
    expect(el.querySelector('.reviews [role="alert"]')?.textContent).toBe('Could not update the reviews: disk full')
    click(button(el, `Delete review of ${day(SECOND)}`))
    await settle()
    expect(el.querySelector('[role="alert"]')).toBeNull()
  })

  it('renders nothing without the settings (upkeep off: App hands none), without the index, or until the index has the note — then follows it', () => {
    feed([rec()])
    expect(mount(TWO, { source }).innerHTML).toBe('')
    expect(mount(TWO, { settings: S }).innerHTML).toBe('')
    feed([rec({ path: '/vault/Other.md' })])
    const el = mount(TWO)
    expect(el.innerHTML).toBe('')
    feed([rec()])
    expect(header(el)?.textContent).toContain('Reviews (2)')
    feed([rec({ properties: { review: false } })])
    expect(header(el)?.textContent).toBe('Reviews (2)Review is off for this note.')
  })
})
