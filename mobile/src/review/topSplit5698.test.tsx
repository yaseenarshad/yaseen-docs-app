// @vitest-environment jsdom
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { FilterIcon } from '@client/review/cardFilters'
import { NOW, inOrder, cardBlock, page, reviewSetup, type ReviewHarness } from './testing'

/**
 * YAZ-5698 (Yaseen, Mochi's iPhone: ☰ left, the count centred, ⋯ right): the phone's Review top bar is split. LEFT the
 * filter button (its icon and "All cards"; a tap opens the cards sheet); CENTRE the count (the red ✕ K, the filter's
 * icon, "done / total"), not a button; the right end as before. The real centring and the narrow phones are measured by
 * `proveLayout.ts` ("Review top bar"); jsdom has no layout. Made-up data.
 */
const OLD = '2026-10-04T09:00:00.000Z good'
const FILES = {
  '.yaseendocs/review.json': '{"newPerDay": 2}',
  'p.md': page('P', cardBlock('Old?\n---\n{{old}}', `TS-1, ${inOrder(OLD, 0)}`), cardBlock('New?\n---\n{{new}}', 'TS-2'), cardBlock('Two?\n---\n{{two}}', 'TS-3')),
}

let h: ReviewHarness | undefined
beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(NOW)
})
afterEach(() => {
  h?.unmount()
  h = undefined
  vi.useRealTimers()
})

const q = (s: string) => h!.host.querySelector<HTMLElement>(s)

describe('YAZ-5698: the filter on the left, the count in the centre', () => {
  it('the filter is its own button: its icon and its name, a tap opens the cards sheet', async () => {
    h = await reviewSetup(FILES)
    const filter = q('.review__filter')
    expect(filter?.tagName).toBe('BUTTON')
    expect(filter?.querySelector('svg')?.outerHTML).toBe(renderToStaticMarkup(<FilterIcon filter="all" />))
    expect(filter?.querySelector('.review__filter-label')?.textContent).toBe('All cards')
    expect(filter?.getAttribute('aria-label')).toBe('All cards. Choose what to review')
    expect(filter?.querySelector('.session-count')).toBeNull()
    await h.click(/Choose what to review/)
    expect(q('.review__sheet')).not.toBeNull()
    expect(filter?.getAttribute('aria-expanded')).toBe('true')
    await h.click(/^Due today$/)
    expect(q('.review__filter .review__filter-label')?.textContent).toBe('Due today')
  })

  it('the count is no button and opens nothing: ✕ K, the icon, "done / total", after the filter', async () => {
    h = await reviewSetup(FILES)
    await h.click('Forgot')
    const place = q('.review__place')
    expect(place?.closest('button')).toBeNull()
    expect(place?.querySelector('.session-count__misses')?.textContent).toBe('1')
    expect(place?.querySelector('.session-count__done')?.textContent).toBe('1 / 4')
    expect(place?.querySelector('.session-count')?.getAttribute('aria-label')).toBe('1 missed, 1 of 4 done')
    // In the bar's order: the filter first, then the count.
    const filter = q('.review__filter')!
    expect(filter.compareDocumentPosition(place!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    // A tap on it opens nothing and is no "tap anywhere" step: the card stays as it was.
    const card = q('.review__card')?.innerHTML
    place!.click()
    await h.settle()
    expect(q('.review__sheet')).toBeNull()
    expect(q('.review__card')?.innerHTML).toBe(card)
  })

  it('the bar`s box is three columns of which the outer two are equal, and it reaches as far right as left (the true centre)', () => {
    const css = readFileSync(join(import.meta.dirname, '../styles.css'), 'utf8')
    const box = /\.topbar__review \{([^}]*)\}/.exec(css)?.[1] ?? ''
    expect(box).toMatch(/grid-template-columns: minmax\(0, 1fr\) auto minmax\(0, 1fr\);/)
    // The dot and the ⚙ sit over the box's right column: the box ends at the header's right padding + 2 px (6 px each side).
    expect(box).toMatch(/margin-right: calc\(/)
  })
})
