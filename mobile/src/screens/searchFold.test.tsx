// @vitest-environment jsdom
import { act } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { READER_FILES, seedReaderVault } from '../dev/readerVault'
import { forgetListFolds } from '../search/ListTree'
import { forgetLists } from '../search/lists'
import { forgetSearch } from '../search/searchState'
import { forgetIdsForms } from '../search/showIds'
import { mount, newPhone, type Harness } from './testing'

/**
 * YAZ-5474: Collapse all / Expand all for Search's tree, the Mac's fold button (`SidebarTabs.tsx`, YAZ-862), inside the
 * box at its right end, where the ✕ shows while there is text. Any folder open → "Collapse all folders" (the Mac's
 * chevrons up), which closes each; all closed → "Expand all folders" (chevrons down), which opens each, to any depth.
 * The same on the Favorites and Focus lists (their folder copies; the tab's own folders keep their folds, as on the
 * Mac). Recent has no folders, and no button. Made-up vault.
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
  forgetLists()
  forgetListFolds()
  forgetIdsForms()
})

async function waitFor(x: Harness, done: () => boolean, ms = 3000): Promise<void> {
  const until = Date.now() + ms
  while (!done()) {
    if (Date.now() > until) throw new Error(`Timed out. Screen: ${x.text()}`)
    await act(async () => void (await new Promise((r) => setTimeout(r, 10))))
  }
}
const FILES = { ...READER_FILES, 'git/deep/Rebase.md': '---\ntitle: Rebase\n---\n\nText.\n' }
async function openSearch(extra: Record<string, string> = {}): Promise<Harness> {
  const phone = await newPhone()
  await seedReaderVault(phone.store, phone.tokens, { ...FILES, ...extra })
  const x = await mount({ phone })
  await x.click('Search')
  await waitFor(x, () => x.host.querySelector('.tree') !== null && x.host.querySelector('.search__fold') !== null)
  return x
}
/** Each row: indent depth, icon kind, name. */
const tree = (x: Harness) =>
  [...x.host.querySelectorAll<HTMLElement>('.tree .tree__row')].map((r) => `${r.style.getPropertyValue('--tree-depth')}:${r.querySelector('.file-icon')?.getAttribute('data-kind')}${r.querySelector('.file-icon--open') ? '-open' : ''}:${r.querySelector('.tree__label')?.textContent}`)
/** The button at the right end of the box, if one shows. */
const fold = (x: Harness) => x.host.querySelector<HTMLButtonElement>('.search__field .search__fold')
/** Its glyph: the Mac's chevrons up (collapse) or down (expand). */
const glyph = (x: Harness) => (fold(x)?.querySelector('path')?.getAttribute('d')?.startsWith('M4.5 7') ? 'up' : 'down')
const box = (x: Harness) => x.host.querySelector<HTMLInputElement>('input[type="search"]')!
async function typeQuery(x: Harness, value: string): Promise<void> {
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(box(x), value)
    box(x).dispatchEvent(new Event('input', { bubbles: true }))
  })
  await x.settle()
  await act(async () => void (await new Promise((r) => setTimeout(r, 30))))
}
const MAC = 'aaaaaaaaaaaa'

describe('Collapse all / Expand all in the search box (YAZ-5474)', () => {
  it('all closed: "Expand all folders" opens every folder to any depth; then "Collapse all folders" closes each', async () => {
    h = await openSearch()
    expect(tree(h)).toEqual(['0:folder:cards', '0:folder:git', '0:markdown:Café notes', '0:markdown:Spanish words', '0:markdown:Trip plan'])
    expect(fold(h)?.getAttribute('aria-label')).toBe('Expand all folders')
    expect(glyph(h)).toBe('down')
    // Quiet: inside the box, in the ✕'s place; no ✕ with an empty box.
    expect(h.host.querySelector('.search__field .search__clear.search__fold')).not.toBeNull()
    expect(h.button('Clear search')).toBeNull()
    await h.click('Expand all folders')
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
    expect(fold(h)?.getAttribute('aria-label')).toBe('Collapse all folders')
    expect(glyph(h)).toBe('up')
    await h.click('Collapse all folders')
    expect(tree(h)).toEqual(['0:folder:cards', '0:folder:git', '0:markdown:Café notes', '0:markdown:Spanish words', '0:markdown:Trip plan'])
    expect(fold(h)?.getAttribute('aria-label')).toBe('Expand all folders')
  })

  it('one folder opened by hand turns the icon to Collapse all, as on the Mac (partly open collapses); the folds stay while the app runs', async () => {
    h = await openSearch()
    await h.click(/^git, folder/)
    await h.click(/^deep, folder/)
    expect(fold(h)?.getAttribute('aria-label')).toBe('Collapse all folders')
    expect(glyph(h)).toBe('up')
    // A tap closes the nested folder too: open again, git shows deep closed.
    await h.click('Collapse all folders')
    await h.click(/^git, folder/)
    expect(tree(h)).toEqual(['0:folder:cards', '0:folder-open:git', '1:folder:deep', '1:markdown:Git cheat sheet', '0:markdown:Café notes', '0:markdown:Spanish words', '0:markdown:Trip plan'])
    // A page opened over Search and closed: the folds are as they were.
    await h.click(/^Git cheat sheet/)
    await waitFor(h, () => h!.host.querySelector('.reader__title') !== null)
    await h.click(/Back/)
    await waitFor(h, () => fold(h!) !== null)
    expect(tree(h)[1]).toBe('0:folder-open:git')
    expect(fold(h)?.getAttribute('aria-label')).toBe('Collapse all folders')
  })

  it('while typing, the ✕ shows in its place; the box emptied gives back the button and the tree as it was', async () => {
    h = await openSearch()
    await h.click('Expand all folders')
    await typeQuery(h, 'trip')
    await waitFor(h, () => h!.host.querySelector('.search__found') !== null)
    expect(fold(h)).toBeNull()
    expect(h.button('Clear search')).not.toBeNull()
    await h.click('Clear search')
    await waitFor(h, () => fold(h!) !== null)
    expect(h.button('Clear search')).toBeNull()
    expect(fold(h)?.getAttribute('aria-label')).toBe('Collapse all folders')
    expect(tree(h)[0]).toBe('0:folder-open:cards')
  })

  it('Favorites: it folds the folder favorites (each copy), not the whole tree', async () => {
    h = await openSearch({ '.yaseendocs/favorites.json': JSON.stringify({ version: 1, favorites: ['git', 'Café notes.md'] }) })
    await h.click('Favorites')
    await waitFor(h, () => h!.host.querySelector('[aria-label="Favorites"][role="tree"]') !== null)
    expect(tree(h)).toEqual(['0:folder:git', '0:markdown:Café notes'])
    expect(fold(h)?.getAttribute('aria-label')).toBe('Expand all folders')
    await h.click('Expand all folders')
    expect(tree(h)).toEqual(['0:folder-open:git', '1:folder-open:deep', '2:markdown:Rebase', '1:markdown:Git cheat sheet', '0:markdown:Café notes'])
    await h.click('Collapse all folders')
    expect(tree(h)).toEqual(['0:folder:git', '0:markdown:Café notes'])
    // The whole tree's folds were not touched.
    await h.click('Favorites')
    await waitFor(h, () => tree(h!)[0] === '0:folder:cards')
    expect(tree(h)).not.toContain('0:folder-open:git')
  })

  it("Focus: it folds the folders inside the tab's own folders and the top rows; the tab's folders keep their folds", async () => {
    h = await openSearch({
      [`.yaseendocs/focus.${MAC}.json`]: JSON.stringify({ version: 1, at: '2026-11-01T10:00:00Z', focus: ['git'] }),
      [`.yaseendocs/focus-folders.${MAC}.json`]: JSON.stringify({ version: 1, at: '2026-11-01T00:00:00Z', self: 'vault', folders: [{ id: 'f1', name: 'Study', created: 1, at: 1, items: [{ vault: 'vault', path: 'cards' }] }] }),
    })
    await h.click('Focus')
    await waitFor(h, () => h!.host.querySelector('[aria-label="Focus"][role="tree"]') !== null)
    expect(tree(h)).toEqual(['0:group:Study', '1:folder:cards', '0:folder:git'])
    expect(fold(h)?.getAttribute('aria-label')).toBe('Expand all folders')
    await h.click('Expand all folders')
    expect(tree(h)).toEqual(['0:group:Study', '1:folder-open:cards', '2:card:Capital of Spain', '2:card:Two cards in one', '0:folder-open:git', '1:folder-open:deep', '2:markdown:Rebase', '1:markdown:Git cheat sheet'])
    await h.click('Collapse all folders')
    // The Study folder of the tab stays open: the Mac folds it apart from the button.
    expect(tree(h)).toEqual(['0:group:Study', '1:folder:cards', '0:folder:git'])
  })

  it('no folder to fold: no button (Recent; a Favorites list of pages only)', async () => {
    h = await openSearch({ '.yaseendocs/favorites.json': JSON.stringify({ version: 1, favorites: ['Café notes.md'] }) })
    await h.click('Favorites')
    await waitFor(h, () => tree(h!).join() === '0:markdown:Café notes')
    expect(fold(h)).toBeNull()
    await h.click('Favorites')
    await waitFor(h, () => fold(h!) !== null)
    await h.click('Recent')
    await waitFor(h, () => h!.text().includes('Nothing opened on this phone yet.'))
    expect(fold(h)).toBeNull()
  })
})
