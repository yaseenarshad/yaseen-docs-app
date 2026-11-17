// @vitest-environment jsdom
import { act } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { seedReaderVault } from '../../dev/readerVault'
import { forgetSearch } from '../../search/searchState'
import { mount, newPhone, type Harness } from '../../screens/testing'

/**
 * YAZ-5477 (the Mac's YAZ-5466): a card FILE's own view shows its comments under the card, with the page's Comment
 * button and box (the same `PageComments`, no copy). A card in a page shows none (they are the page's), and Review has
 * no comment box. Made-up files.
 */
const block = (text: string, line: string) => `\`\`\`card\n${text}\n\`\`\`\n<!-- card: ${line} -->`
const COMMENTS = [
  'comments:',
  '  - {id: demo0001, n: 1, at: "2026-11-10T09:00:00Z", by: sam, body: "Is the date right?"}',
  '  - {id: demo0002, n: 1, at: "2026-11-10T09:30:00Z", by: demo, reply_to: demo0001, body: "Yes."}',
  '  - {id: demo0003, n: 2, at: "2026-11-11T08:00:00Z", by: demo, resolved: "2026-11-12T08:00:00Z", body: "Old point."}',
].join('\n')
const FILES: Record<string, string> = {
  '.yaseendocs/review.json': '{"enabled": true}',
  'Geo.md': `---\ntitle: Geo\n${COMMENTS.replace('Is the date right?', 'A page comment')}\n---\n\n${block('How many islands?\n---\nA {{thousand}}', 'GEO-1, title "Islands"')}\n`,
  'cards/capital-of-spain-geo-3.md': `---\nkind: card\n${COMMENTS}\n---\n\n${block('The capital is {{Madrid}}.', 'GEO-3, title "Capital of Spain"')}\n`,
}

let h: Harness | null = null
beforeEach(() => {
  URL.createObjectURL = vi.fn(() => 'blob:phone/1')
  URL.revokeObjectURL = vi.fn()
})
afterEach(() => {
  h?.unmount()
  h = null
  forgetSearch()
})

async function waitFor(x: Harness, done: () => boolean, ms = 3000): Promise<void> {
  const until = Date.now() + ms
  while (!done()) {
    if (Date.now() > until) throw new Error(`Timed out. Screen: ${x.text()}`)
    await act(async () => void (await new Promise((r) => setTimeout(r, 10))))
  }
}
async function typeQuery(x: Harness, value: string): Promise<void> {
  const box = x.host.querySelector<HTMLInputElement>('input[type="search"]')!
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(box, value)
    box.dispatchEvent(new Event('input', { bubbles: true }))
  })
  await x.settle()
  await act(async () => void (await new Promise((r) => setTimeout(r, 30))))
}
const send = (x: Harness) => [...x.host.querySelectorAll('button')].find((b) => b.textContent?.trim() === 'Comment')

describe('comments on a card file, on the phone (YAZ-5477)', () => {
  it('the card file view: its comments under the card and its Comment button; a card in a page: none', async () => {
    const phone = await newPhone()
    await seedReaderVault(phone.store, phone.tokens, FILES)
    h = await mount({ phone })
    await h.click('Search')
    await waitFor(h, () => h!.host.querySelector('.search__rows, .tree') !== null)
    await typeQuery(h, 'capital of spain')
    await h.click(/^Capital of Spain/)
    await waitFor(h, () => h!.host.querySelector('.card-view__card .card__body') !== null && h!.host.querySelector('.page-comments') !== null)
    const view = h.host.querySelector('.card-view')!
    const section = view.querySelector('.page-comments')!
    // Under the card: after the card box in the column.
    expect(view.querySelector('.card-view__card')!.compareDocumentPosition(section) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(section.textContent).toContain('Comments · 2')
    expect([...section.querySelectorAll('.page-comments__item')].map((i) => i.querySelector('.page-comments__body')?.textContent)).toEqual(['Is the date right?', 'Yes.'])
    expect(section.textContent).toContain('1 resolved')
    // YAZ-5478: the inline box at the end of the comments, its Comment button, and the count near the title.
    expect(section.querySelector('textarea')?.getAttribute('placeholder')).toBe('Add a comment…')
    expect(send(h)).toBeDefined()
    expect(view.querySelector('.comments-count')?.textContent).toBe('2')
    // The card's own words never carry the comments.
    expect(view.querySelector('.card-view__card')!.textContent).not.toMatch(/Is the date right|demo0001/)

    await h.click('Back')
    await typeQuery(h, 'islands')
    await h.click(/^Islands/)
    await waitFor(h, () => h!.host.querySelector('.card-view__card .card__body') !== null)
    expect(h.host.querySelector('.page-comments')).toBeNull()
    expect(send(h)).toBeUndefined()
    expect(h.host.querySelector('.comments-count')).toBeNull()
    expect(h.text()).not.toContain('A page comment')
  })

  it('Review has no comment box: no file of the Review screen draws the comments block', () => {
    // The harness's fake sync has no answer list, so Review never opens its cards here: the screen's code is read.
    const files = import.meta.glob(['../../review/**/*.{ts,tsx}', '../../screens/Review.tsx', '!../../**/*.test.*'], { query: '?raw', import: 'default', eager: true }) as Record<string, string>
    expect(Object.keys(files).length).toBeGreaterThan(3)
    for (const [name, code] of Object.entries(files)) expect([name, /PageComments|CommentsView|page-comments/.test(code)]).toEqual([name, false])
  })
})
