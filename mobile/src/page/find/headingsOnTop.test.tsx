// @vitest-environment jsdom
import { act } from 'react'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { READER_FILES, seedReaderVault } from '../../dev/readerVault'
import { forgetSearch } from '../../search/searchState'
import { mount, newPhone, type Harness } from '../../screens/testing'
import { declared, loadAppCss, onTopProblems } from '../../screens/onTop.testing'

/**
 * YAZ-5497 (bug): on the iPhone, ⋯ › Headings showed only the sheet's "Headings" and ✕, faded, cut off behind the page
 * arrows (YAZ-5449) and the tab bar; the list did not show. The sheet was drawn inside the page's scroll box
 * (`.screen--reader`), whose soft fade at the bottom is a `mask-image`: a masked element is a stacking context and
 * clips what it holds, a `position: fixed` child too. So the sheet was masked to the scroll box (its bottom, the
 * arrows' and the tab bar's place, cut off; its top faded) and its `z-index: 30` counted only inside the box.
 *
 * jsdom draws nothing: these tests read the app's own stylesheets (`screens/onTop.testing.ts`). The headless check
 * (`publish/proveLayout.ts`, `page-headings*` at 375×667 and 390×844) measures it in Chrome. Made-up data only.
 */
const page = (props: string, body: string) => `---\n${props}---\n\n${body}\n`
const FILES: Record<string, string | Uint8Array> = {
  ...READER_FILES,
  'Fruit.md': page('title: Fruit\n', ['# Fruit', 'Apples.', '## Pears', 'Pears.', '### Small pears', 'Tiny.'].join('\n\n')),
  'Plain.md': page('title: Plain\n', 'No headings at all.'),
  'Trip notes.md': page('title: Trip notes\nstatus: Planning\ntags: [spain, trains]\n', 'The notes.'),
  'Long.md': page('title: Long\n', Array.from({ length: 80 }, (_, i) => `## Part ${i + 1}\n\nA line.`).join('\n\n')),
}
/** Search alone (Review off): the tab bar is not drawn (YAZ-5476). */
const SEARCH_ALONE = { ...FILES, '.yaseendocs/review.json': '{"enabled": false}' }

let h: Harness | null = null
beforeAll(loadAppCss)
beforeEach(() => {
  URL.createObjectURL = vi.fn(() => 'blob:phone/1')
  URL.revokeObjectURL = vi.fn()
  window.matchMedia = ((q: string) => ({ matches: false, media: q, addEventListener() {}, removeEventListener() {} })) as unknown as typeof matchMedia
  HTMLElement.prototype.animate = function () {
    return {} as Animation
  } as unknown as typeof HTMLElement.prototype.animate
})
afterEach(() => {
  h?.unmount()
  h = null
  forgetSearch()
})

async function waitFor(x: Harness, done: () => boolean, ms = 5000): Promise<void> {
  const until = Date.now() + ms
  while (!done()) {
    if (Date.now() > until) throw new Error(`Timed out. Screen: ${x.text().slice(0, 300)}`)
    await act(async () => void (await new Promise((r) => setTimeout(r, 10))))
  }
}
async function open(files: Record<string, string | Uint8Array>, row: RegExp, ready: string, tabs: 'review' | 'files' = 'review', query = ''): Promise<Harness> {
  const phone = await newPhone()
  await seedReaderVault(phone.store, phone.tokens, files)
  const x = await mount({ phone, ...(tabs === 'files' && { vaultTabs: 'files' as const }) })
  if (x.button('Search') !== null) await x.click('Search')
  if (query !== '') {
    await waitFor(x, () => x.host.querySelector('input[type="search"]') !== null)
    const box = x.host.querySelector<HTMLInputElement>('input[type="search"]')!
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(box, query)
      box.dispatchEvent(new Event('input', { bubbles: true }))
    })
  }
  await waitFor(x, () => x.button(row) !== null)
  await x.click(row)
  await waitFor(x, () => x.host.querySelector(ready) !== null)
  return x
}
async function openHeadings(x: Harness): Promise<HTMLElement> {
  await x.click('Page tools')
  await x.click(/Headings/)
  await waitFor(x, () => x.host.querySelector('.headings-sheet__panel') !== null)
  return x.host.querySelector<HTMLElement>('.headings-sheet')!
}

/** The sheet is whole and on top: nothing clips it, holds it or paints over it; its list scrolls; the home bar's room. */
function expectWholeOnTop(sheet: HTMLElement): void {
  expect(onTopProblems(sheet)).toEqual([])
  expect(declared(sheet, 'inset')).toMatch(/^0(px)?$/)
  const panel = sheet.querySelector('.headings-sheet__panel')!
  expect(declared(panel, 'max-height')).not.toBe('')
  expect(declared(panel, 'padding-bottom')).toContain('safe-area-inset-bottom')
  const list = sheet.querySelector('.headings-sheet__list')
  if (list !== null) {
    // A long list scrolls inside the sheet: a flex child needs `min-height: 0` to be shorter than its rows.
    expect(declared(list, 'overflow-y')).toBe('auto')
    expect(declared(list, 'min-height')).toMatch(/^0(px)?$/)
  }
}

describe('YAZ-5497: the Headings sheet is fully on screen, above the arrow bar and the tab bar, with its list visible', () => {
  it('a page with the arrows and the tab bar', async () => {
    h = await open(FILES, /^Fruit, page/, '.reader__body h1')
    expect(h.host.querySelector('.page-arrows')).not.toBeNull()
    expect(h.host.querySelector('.tabbar')).not.toBeNull()
    const sheet = await openHeadings(h)
    expectWholeOnTop(sheet)
    expect([...sheet.querySelectorAll('.headings-sheet__row')].map((r) => r.textContent)).toEqual(['Fruit', 'Pears', 'Small pears'])
  })

  it('a page with fewer than 2 headings: its words show, whole and on top', async () => {
    h = await open(FILES, /^Plain, page/, '.reader__body p')
    const sheet = await openHeadings(h)
    expectWholeOnTop(sheet)
    expect(sheet.querySelector('.headings-sheet__none')?.textContent).toBe('This page has no headings to list.')
  })

  it('a long list (80 rows) scrolls inside the sheet', async () => {
    h = await open(FILES, /^Long, page/, '.reader__body h2')
    const sheet = await openHeadings(h)
    expectWholeOnTop(sheet)
    expect(sheet.querySelectorAll('.headings-sheet__row')).toHaveLength(80)
  })

  it('a vault with Search alone (no tab bar): whole and on top of the arrows', async () => {
    h = await open(SEARCH_ALONE, /^Fruit, page/, '.reader__body h1', 'files')
    expect(h.host.querySelector('.tabbar')).toBeNull()
    expect(h.host.querySelector('.page-arrows')).not.toBeNull()
    expectWholeOnTop(await openHeadings(h))
  })

  // A card view's top bar ⋯ holds Find in card, no Headings (its card actions are on the card's own ⋯, YAZ-5527): no card case here.
  it('the check itself: the reader\'s scroll box clips and shuts in what it holds (the cause)', async () => {
    h = await open(FILES, /^Fruit, page/, '.reader__body h1')
    const inBox = document.createElement('div')
    inBox.className = 'headings-sheet'
    h.host.querySelector('.reader')!.append(inBox)
    expect(onTopProblems(inBox)).toEqual(['main.screen.screen--reader (mask-image: linear-gradient(to bottom, #000 calc(100% - 28px), transparent))'])
    inBox.remove()
  })
})
