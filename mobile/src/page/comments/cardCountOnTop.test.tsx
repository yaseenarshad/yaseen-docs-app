// @vitest-environment jsdom
import { act } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { seedReaderVault } from '../../dev/readerVault'
import { forgetSearch } from '../../search/searchState'
import { mount, newPhone, type Harness } from '../../screens/testing'
import { HAS_CHROME, inChrome } from '../chromeLayout.testing'

/**
 * YAZ-5511: in the card view of a card file with comments, the comment count (YAZ-5478: the speech bubble and the open
 * count, top right) is on the screen and on top: `elementFromPoint` at its centre is the count. The view is drawn here
 * (jsdom) and laid out in headless Chrome with the phone's stylesheets (`chromeLayout.testing.ts`), light and dark. A
 * tap on it goes to the comments under the card. Made-up files.
 */
const block = (text: string, line: string) => `\`\`\`card\n${text}\n\`\`\`\n<!-- card: ${line} -->`
const COMMENTS = [
  'comments:',
  '  - {id: demo0021, n: 1, at: "2026-11-10T09:00:00Z", by: sam, body: "Is the date right?"}',
  '  - {id: demo0022, n: 2, at: "2026-11-10T09:30:00Z", by: demo, body: "Add the year."}',
].join('\n')
const FILES: Record<string, string> = {
  '.yaseendocs/review.json': '{"enabled": true}',
  'cards/bridge-of-triana-demo-7.md': `---\nkind: card\n${COMMENTS}\n---\n\n${block('Which bridge crosses to Triana?\n---\nThe Isabel II bridge.', 'DEMO-7, title "Bridge of Triana", 2026-11-01T08:00Z good')}\n`,
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
  vi.restoreAllMocks()
})

async function waitFor(x: Harness, done: () => boolean, ms = 3000): Promise<void> {
  const until = Date.now() + ms
  while (!done()) {
    if (Date.now() > until) throw new Error(`Timed out. Screen: ${x.text()}`)
    await act(async () => void (await new Promise((r) => setTimeout(r, 10))))
  }
}

async function openCardFile(): Promise<Harness> {
  const phone = await newPhone()
  await seedReaderVault(phone.store, phone.tokens, FILES)
  const x = await mount({ phone })
  await x.click('Search')
  await waitFor(x, () => x.host.querySelector('.search__rows, .tree') !== null)
  const box = x.host.querySelector<HTMLInputElement>('input[type="search"]')!
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(box, 'triana')
    box.dispatchEvent(new Event('input', { bubbles: true }))
  })
  await x.settle()
  await act(async () => void (await new Promise((r) => setTimeout(r, 30))))
  await x.click(/^Bridge of Triana/)
  await waitFor(x, () => x.host.querySelector('.card-view__card .card__body') !== null && x.host.querySelector('.card-view .comments-count') !== null)
  return x
}

const ON_TOP = `(() => {
  const count = document.querySelector('.card-view .comments-count')
  const card = document.querySelector('.card-view .card-view__card')
  const r = count.getBoundingClientRect()
  const c = card.getBoundingClientRect()
  const x = r.left + r.width / 2
  const y = r.top + r.height / 2
  const hit = document.elementFromPoint(x, y)
  return { rect: [r.left, r.top, r.right, r.bottom].map(Math.round), onScreen: r.width > 0 && r.left >= 0 && r.right <= innerWidth && r.top >= 0 && r.bottom <= innerHeight, hit: hit === null ? null : hit.closest('.comments-count') === count ? 'count' : (hit.className || hit.tagName), overCard: r.bottom > c.top && r.top < c.bottom && r.right > c.left && r.left < c.right }
})()`

describe('the comment count of a card file is on top of its card (YAZ-5511)', () => {
  it.skipIf(!HAS_CHROME)('in the card view of a card file with comments, the count is on screen and elementFromPoint at its centre hits it', async () => {
    h = await openCardFile()
    expect(h.host.querySelector('.card-view .comments-count')?.textContent).toBe('2')
    const html = `<div id="root">${h.host.innerHTML}</div>`
    for (const scheme of ['light', 'dark'] as const) {
      const m = await inChrome<{ rect: number[]; onScreen: boolean; hit: string | null; overCard: boolean }>(html, ON_TOP, { scheme })
      expect(m.onScreen, `${scheme}: the count at ${m.rect.join(',')} is on the screen`).toBe(true)
      expect(m.hit, `${scheme}: the point at the count's centre`).toBe('count')
    }
  }, 60_000)

  it('a tap on the count goes to the comments under the card', async () => {
    h = await openCardFile()
    const went: Element[] = []
    Element.prototype.scrollIntoView = vi.fn(function (this: Element) {
      went.push(this)
    })
    await act(async () => h!.host.querySelector<HTMLButtonElement>('.card-view .comments-count')!.click())
    const section = h.host.querySelector('.card-view .page-comments')!
    expect(went).toEqual([section])
    // Under the card (and its strip, YAZ-5508).
    expect(h.host.querySelector('.card-view__card')!.compareDocumentPosition(section) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })
})
