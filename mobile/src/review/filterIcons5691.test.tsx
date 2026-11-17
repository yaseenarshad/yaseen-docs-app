// @vitest-environment jsdom
import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { FilterIcon } from '@client/review/cardFilters'
import type { CardFilter } from '@client/review/useCardReview'
import { NOW, inOrder, cardBlock, page, reviewSetup, type ReviewHarness } from './testing'

/**
 * YAZ-5691 (parity gap 1 of YAZ-5687): the phone's filter glyphs are the Mac's own icons — the inbox tray (All cards),
 * the arrow up to a line (Up next), the circle with a check (Due today), the dotted circle (New cards) — in the count
 * at the top and in each row of the review sheet. One piece (`cardFilters.tsx`), no text signs (▣ ⤒ ◷ ◌). Made-up data.
 */
const OLD = '2026-10-04T09:00:00.000Z good'
const FILES = {
  '.yaseendocs/review.json': '{"newPerDay": 1}',
  'p.md': page('P', cardBlock('Old?\n---\n{{old}}', `MN-1, ${inOrder(OLD, 0)}`), cardBlock('New?\n---\n{{new}}', 'MN-2'), cardBlock('Marked?\n---\n{{m}}', 'MN-3, next')),
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

const mac = (filter: CardFilter) => renderToStaticMarkup(<FilterIcon filter={filter} />)
const SIGNS = /[▣⤒◷◌]/

describe('YAZ-5691: the phone wears the Mac`s filter icons', () => {
  it('the count at the top: the open filter`s Mac icon before "done / total", no text sign', async () => {
    h = await reviewSetup(FILES)
    const done = () => h!.host.querySelector('.review__count-btn .session-count__done')
    expect(done()?.querySelector('svg')?.outerHTML).toBe(mac('all'))
    expect(done()?.textContent).toBe('0 / 3')
    await h.click(/Choose what to review/)
    await h.click(/^Due today$/)
    expect(done()?.querySelector('svg')?.outerHTML).toBe(mac('due'))
    expect(h.host.querySelector('.review__count-btn')?.textContent).not.toMatch(SIGNS)
  })

  it('the sheet: each row`s icon is the Mac menu`s, in the Mac`s order; no text signs', async () => {
    h = await reviewSetup(FILES)
    await h.click(/Choose what to review/)
    const rows = [...h.host.querySelectorAll<HTMLElement>('.review__sheet-row')]
    expect(rows.map((r) => r.querySelector('[data-filter]')?.getAttribute('data-filter'))).toEqual(['all', 'next', 'due', 'new'])
    for (const r of rows) {
      const id = r.querySelector('[data-filter]')!.getAttribute('data-filter') as CardFilter
      expect(r.querySelector('.review__sheet-ic')?.innerHTML).toBe(mac(id))
    }
    expect(h.host.querySelector('.review__sheet')?.textContent).not.toMatch(SIGNS)
  })
})
