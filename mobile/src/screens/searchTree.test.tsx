// @vitest-environment jsdom
import { act } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { READER_FILES, seedReaderVault } from '../dev/readerVault'
import { forgetSearch } from '../search/searchState'
import { mount, newPhone, type Harness } from './testing'

/**
 * YAZ-5438: Search shows the Mac's sidebar tree while its box is empty (folders, pages, card files, the Mac's icons and
 * order; folders open and close to any depth and stay so while the app runs); a result row has the same icons in place
 * of the word "page". YAZ-5439: the ✕ (and Escape) clears the box and leaves the search.
 */
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
const FILES = { ...READER_FILES, 'git/deep/Rebase.md': '---\ntitle: Rebase\n---\n\nText.\n', '.yaseendocs/unit-word.json': '{"unit": "doc"}' }
async function openSearch(): Promise<Harness> {
  const phone = await newPhone()
  await seedReaderVault(phone.store, phone.tokens, FILES)
  const x = await mount({ phone })
  await x.click('Search')
  await waitFor(x, () => x.host.querySelector('.tree') !== null)
  return x
}
/** Each tree row: indent depth, icon kind, name. */
const tree = (x: Harness) =>
  [...x.host.querySelectorAll<HTMLElement>('.tree .tree__row')].map((r) => `${r.style.getPropertyValue('--tree-depth')}:${r.querySelector('.file-icon')?.getAttribute('data-kind')}${r.querySelector('.file-icon--open') ? '-open' : ''}:${r.querySelector('.tree__label')?.textContent}`)
const box = (x: Harness) => x.host.querySelector<HTMLInputElement>('input[type="search"]')!
async function typeQuery(x: Harness, value: string): Promise<void> {
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(box(x), value)
    box(x).dispatchEvent(new Event('input', { bubbles: true }))
  })
  await x.settle()
  await act(async () => void (await new Promise((r) => setTimeout(r, 30))))
}

describe('Search shows the Mac sidebar tree (YAZ-5438)', () => {
  it('folders first, the Mac icons, the vault word; folders open and close to any depth; the state stays while the app runs', async () => {
    h = await openSearch()
    expect(h.host.querySelector('h2.section')?.textContent).toBe('Docs')
    expect(tree(h)).toEqual(['0:folder:cards', '0:folder:git', '0:markdown:Café notes', '0:markdown:Spanish words', '0:markdown:Trip plan'])
    // No row says the word "page".
    expect(h.host.querySelector('.search')?.textContent).not.toMatch(/\bpage\b/)
    await h.click(/^git, folder/)
    await h.click(/^deep, folder/)
    await h.click(/^cards, folder/)
    expect(tree(h)).toEqual([
      '0:folder-open:cards',
      '1:card:Capital of Spain',
      '1:card:Two cards in one',
      '0:folder-open:git',
      '1:folder-open:deep',
      '2:markdown:Rebase',
      '1:markdown:Git cheat sheet',
      '0:markdown:Café notes',
      '0:markdown:Spanish words',
      '0:markdown:Trip plan',
    ])
    expect(h.host.querySelector('[role="treeitem"][aria-expanded="true"]')).not.toBeNull()
    expect(h.button(/^Rebase, doc$/)).not.toBeNull()
    await h.click(/^git, folder/)
    expect(tree(h)).not.toContain('2:markdown:Rebase')
    // A page opens in the reader; Back shows the tree as it was left (open folders kept).
    await h.click(/^Capital of Spain, card/)
    await waitFor(h, () => h!.host.querySelector('.card-view') !== null)
    expect(h.host.querySelector('.topbar__title')?.textContent).toBe('Capital of Spain')
    await h.click('‹ Back')
    await waitFor(h, () => h!.host.querySelector('.tree') !== null)
    expect(tree(h).slice(0, 4)).toEqual(['0:folder-open:cards', '1:card:Capital of Spain', '1:card:Two cards in one', '0:folder:git'])
    await h.click(/^git, folder/)
    expect(tree(h)).toContain('2:markdown:Rebase')
    await h.click(/^Rebase, doc/)
    await waitFor(h, () => h!.host.querySelector('.reader__body')?.textContent?.includes('Text.') === true)
  })

  it('a result row has the icon (a page, a card file, a card in a page) in place of the word "page"', async () => {
    h = await openSearch()
    await typeQuery(h, 'spa')
    const rows = [...h.host.querySelectorAll('.search__rows .row')].map((r) => `${r.querySelector('.file-icon')?.getAttribute('data-kind')}|${r.querySelector('.row__main')?.textContent}|${r.querySelector('.row__side')?.textContent ?? ''}`)
    expect(rows).toEqual(['markdown|Spanish words|', 'markdown|Español — Spanish words|', 'card|Capital of Spain|DEMO-40'])
    await typeQuery(h, 'la bib')
    expect(h.host.querySelector('.search__rows .file-icon')?.getAttribute('data-kind')).toBe('card')
    expect(h.host.querySelector('.search')?.textContent).not.toMatch(/\bpage\b|\bdoc\b/)
  })
})

describe('the ✕ clears the box and leaves the search (YAZ-5439)', () => {
  it('a tap clears the text, the keyboard goes away, the tree shows again; Escape does the same', async () => {
    h = await openSearch()
    expect(h.button('Clear search')).toBeNull()
    box(h).focus()
    await typeQuery(h, 'spa')
    expect(h.host.querySelector('.tree')).toBeNull()
    expect(document.activeElement).toBe(box(h))
    await h.click('Clear search')
    expect(box(h).value).toBe('')
    expect(document.activeElement).not.toBe(box(h))
    await waitFor(h, () => h!.host.querySelector('.tree') !== null)
    expect(h.button('Clear search')).toBeNull()
    box(h).focus()
    await typeQuery(h, 'trip')
    await act(async () => void box(h!).dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })))
    await h.settle()
    expect(box(h).value).toBe('')
    expect(document.activeElement).not.toBe(box(h))
    await waitFor(h, () => h!.host.querySelector('.tree') !== null)
  })
})
