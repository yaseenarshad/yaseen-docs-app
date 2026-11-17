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
/** The tree of the empty box (not the results' tree). */
const empty = (x: Harness) => x.host.querySelector('.tree:not(.search__found)')
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
    await h.click('Back')
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
    const rows = [...h.host.querySelectorAll('.search__found .tree__row')].map((r) => `${r.querySelector('.file-icon')?.getAttribute('data-kind')}|${r.querySelector('.tree__label')?.textContent}|${r.querySelector('.row__side')?.textContent ?? ''}`)
    expect(rows).toEqual(['markdown|Spanish words|', 'folder|cards|', 'card|Capital of Spain|DEMO-40'])
    await typeQuery(h, 'la bib')
    expect([...h.host.querySelectorAll('.search__found .file-icon')].map((i) => i.getAttribute('data-kind'))).toEqual(['markdown', 'card'])
    expect(h.host.querySelector('.search')?.textContent).not.toMatch(/\bpage\b|\bdoc\b/)
  })
})

describe('the ✕ clears the box and leaves the search (YAZ-5439)', () => {
  it('a tap clears the text, the keyboard goes away, the tree shows again; Escape does the same', async () => {
    h = await openSearch()
    expect(h.button('Clear search')).toBeNull()
    box(h).focus()
    await typeQuery(h, 'spa')
    expect(h.host.querySelector('.search__found')).not.toBeNull()
    expect(empty(h)).toBeNull()
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

describe('the results stand in the tree, as on the Mac (YAZ-5447)', () => {
  const FOUND = { ...FILES, 'git/deep/.folder.md': '---\ntitle: Deep dives\nid: DEMO-90\n---\n', 'git/deep/Merge.md': '---\ntitle: Merge\n---\n\nText.\n' }
  async function openFound(): Promise<Harness> {
    const phone = await newPhone()
    await seedReaderVault(phone.store, phone.tokens, FOUND)
    const x = await mount({ phone })
    await x.click('Search')
    await waitFor(x, () => x.host.querySelector('.tree') !== null)
    return x
  }
  /** Each row of the results' tree: depth, icon, name; `~` for a row that is no match (dim). */
  const found = (x: Harness) =>
    [...x.host.querySelectorAll<HTMLElement>('.search__found .tree__row')].map(
      (r) =>
        `${r.classList.contains('tree__row--context') ? '~' : ''}${r.style.getPropertyValue('--tree-depth')}:${r.querySelector('.file-icon')?.getAttribute('data-kind')}${r.querySelector('.file-icon--open') ? '-open' : ''}:${r.querySelector('.tree__label')?.textContent}`,
    )
  /** The marked parts of each row. */
  const marks = (x: Harness) => [...x.host.querySelectorAll('.search__found mark.tree__mark')].map((m) => m.textContent)

  it('a file deep in folders shows with all its parents, open at their depth; every other row is hidden', async () => {
    h = await openFound()
    await typeQuery(h, 'rebase')
    expect(found(h)).toEqual(['~0:folder-open:git', '~1:folder-open:Deep dives', '2:markdown:Rebase'])
    expect(h.host.querySelectorAll('.search__found [role="treeitem"][aria-expanded="true"]')).toHaveLength(2)
    // Nothing that does not match and leads to no match: no Merge, no Git cheat sheet, no other folder or page.
    expect(h.host.querySelector('.search')?.textContent).not.toMatch(/Merge|Git cheat sheet|Café|Trip plan|cards/)
  })

  it('the typed text is marked in each match, as the Mac marks it; a parent is dim and unmarked', async () => {
    h = await openFound()
    await typeQuery(h, 'spa')
    expect(marks(h)).toEqual(['Spa', 'Spa'])
    expect(found(h)).toEqual(['0:markdown:Spanish words', '~0:folder-open:cards', '1:card:Capital of Spain'])
    // Each typed word where it starts a word (the Mac's `matchRanges`).
    await typeQuery(h, 'words span')
    expect(marks(h)).toEqual(['Span', 'words'])
    // A row found by its ID reads `ID — name`, the ID marked.
    await typeQuery(h, 'DEMO-3')
    expect(h.host.querySelector('.search__found .tree__row:not(.tree__row--context) .tree__label')?.textContent).toBe('DEMO-3 — Trip plan')
    expect(marks(h)[0]).toBe('3')
  })

  it("a folder's name (its own title) matches: it shows closed with its parents; a tap looks inside", async () => {
    h = await openFound()
    await typeQuery(h, 'deep di')
    expect(found(h)).toEqual(['~0:folder-open:git', '1:folder:Deep dives'])
    expect(marks(h)).toEqual(['Deep di'])
    await h.click(/^Deep dives, folder/)
    expect(found(h)).toEqual(['~0:folder-open:git', '1:folder-open:Deep dives', '~2:markdown:Merge', '~2:markdown:Rebase'])
    // By its ID too.
    await typeQuery(h, 'DEMO-90')
    expect(found(h)).toEqual(['~0:folder-open:git', '1:folder:DEMO-90 — Deep dives'])
  })

  it('no results: "No matches", as the Mac says it, and no tree', async () => {
    h = await openFound()
    await typeQuery(h, 'zebra')
    expect(h.host.querySelector('.search__found')).toBeNull()
    expect(empty(h)).toBeNull()
    expect(h.host.querySelector('.search .muted')?.textContent).toBe('No matches')
  })

  it('a tap opens a match; folds tapped in a search are its own; clearing the box gives back the tree as it was', async () => {
    h = await openFound()
    await h.click(/^git, folder/)
    expect(tree(h).slice(0, 3)).toEqual(['0:folder:cards', '0:folder-open:git', '1:folder:Deep dives'])
    await typeQuery(h, 'rebase')
    // A tap closes a folder of the search; the empty box's tree is not changed by it.
    await h.click(/^git, folder/)
    expect(found(h)).toEqual(['~0:folder:git'])
    await h.click('Clear search')
    await waitFor(h, () => empty(h!) !== null)
    expect(tree(h).slice(0, 4)).toEqual(['0:folder:cards', '0:folder-open:git', '1:folder:Deep dives', '1:markdown:Git cheat sheet'])
    // A new search starts with its own folds again, and a tap on a match opens it.
    await typeQuery(h, 'rebase')
    expect(found(h)).toEqual(['~0:folder-open:git', '~1:folder-open:Deep dives', '2:markdown:Rebase'])
    await h.click(/^Rebase, doc/)
    await waitFor(h, () => h!.host.querySelector('.reader__body')?.textContent?.includes('Text.') === true)
    await h.click('Back')
    await waitFor(h, () => h!.host.querySelector('.search__found') !== null)
    expect(found(h)).toEqual(['~0:folder-open:git', '~1:folder-open:Deep dives', '2:markdown:Rebase'])
  })
})
