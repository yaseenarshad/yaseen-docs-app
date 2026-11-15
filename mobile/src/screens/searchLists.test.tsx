// @vitest-environment jsdom
import { act } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { READER_FILES, READER_ID, seedReaderVault, writeVaultFiles } from '../dev/readerVault'
import { forgetListFolds } from '../search/ListTree'
import { forgetLists } from '../search/lists'
import { forgetSearch } from '../search/searchState'
import { forgetIdsForms } from '../search/showIds'
import { MAX_RECENT, RECENT_STATE, readRecent, remember } from '../search/recent'
import { mount, newPhone, type Harness } from './testing'

/**
 * YAZ-5452: Search's list filters. Favorites shows the vault's own `favorites.json`, as the Mac's Favorites tab: the
 * Mac's order, the tree's icons, a folder that opens in place, a path that is gone hidden; a missing or corrupt file is
 * a plain line; typed text finds only inside the list, in the folder tree; a sync's new file shows at once.
 * YAZ-5453: Focus, the newest valid `focus.<mac id>.json`, and the folders of the Focus and Favorites tabs.
 * YAZ-5454: the trees follow the vault's "Show IDs in the files list" (`show-ids.json`).
 * YAZ-5457: Recent, the pages and cards opened on this phone, kept for each vault in the phone's storage. Made-up vault.
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
const favs = (list: unknown) => ({ '.yaseendocs/favorites.json': typeof list === 'string' ? list : JSON.stringify({ version: 1, favorites: list }) })
async function openSearch(extra: Record<string, string> = {}): Promise<Harness> {
  const phone = await newPhone()
  await seedReaderVault(phone.store, phone.tokens, { ...READER_FILES, ...extra })
  const x = await mount({ phone })
  await x.click('Search')
  await waitFor(x, () => x.host.querySelector('.tree') !== null && x.host.querySelector('.search__chip') !== null)
  return x
}
/** Each row: indent depth, icon kind, name. */
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
const chip = (x: Harness, name: string) => [...x.host.querySelectorAll<HTMLButtonElement>('.search__chip')].find((b) => b.textContent === name)!

describe('the Favorites filter (YAZ-5452)', () => {
  it('a chip beside All types; on, only the favorites in the Mac order, with the tree icons; off again, the whole tree', async () => {
    h = await openSearch(favs(['Trip plan.md', 'cards/capital-of-spain-demo-40.md', 'Spanish words.md']))
    expect([...h.host.querySelectorAll('.search__bar button')].map((b) => b.textContent)).toEqual(['All types ▾', 'Favorites', 'Focus', 'Recent'])
    expect(chip(h, 'Favorites').getAttribute('aria-pressed')).toBe('false')
    await h.click('Favorites')
    await waitFor(h, () => h!.host.querySelector('[aria-label="Favorites"][role="tree"]') !== null)
    expect(chip(h, 'Favorites').getAttribute('aria-pressed')).toBe('true')
    expect(h.host.querySelector('h2.section')?.textContent).toBe('Favorites')
    // The stored order, never the tree's (which would put Spanish words before Trip plan).
    expect(tree(h)).toEqual(['0:markdown:Trip plan', '0:card:Capital of Spain', '0:markdown:Spanish words'])
    await h.click('Favorites')
    await waitFor(h, () => tree(h!)[0] === '0:folder:cards')
  })

  it('a folder favorite opens in place like a folder of the tree, its rows in the tree order; a file listed beside it shows in both places', async () => {
    h = await openSearch({ ...favs(['git', 'git/deep/Rebase.md', 'Café notes.md']), 'git/deep/Rebase.md': '---\ntitle: Rebase\n---\n\nText.\n' })
    await h.click('Favorites')
    await waitFor(h, () => tree(h!).length === 3)
    expect(tree(h)).toEqual(['0:folder:git', '0:markdown:Rebase', '0:markdown:Café notes'])
    await h.click(/^git, folder/)
    await h.click(/^deep, folder/)
    expect(tree(h)).toEqual(['0:folder-open:git', '1:folder-open:deep', '2:markdown:Rebase', '1:markdown:Git cheat sheet', '0:markdown:Rebase', '0:markdown:Café notes'])
    // A page of the folder opens read only.
    await h.click(/^Git cheat sheet/)
    await waitFor(h, () => h!.host.querySelector('.reader__title')?.textContent === 'Git cheat sheet')
  })

  it('a path that is gone, unsafe or hidden has no row; the filter is kept while a page is open over Search', async () => {
    h = await openSearch(favs(['Gone.md', '../outside.md', '/abs.md', 'Trip plan.md', '.yaseendocs/review.json']))
    await h.click('Favorites')
    await waitFor(h, () => tree(h!).length > 0)
    expect(tree(h)).toEqual(['0:markdown:Trip plan'])
    await h.click(/^Trip plan/)
    await waitFor(h, () => h!.host.querySelector('.reader__title') !== null)
    await h.click('Back')
    await waitFor(h, () => h!.host.querySelector('[aria-label="Favorites"][role="tree"]') !== null)
    expect(tree(h)).toEqual(['0:markdown:Trip plan'])
  })

  it.each([
    ['missing', {}],
    ['corrupt JSON', favs('{ not json')],
    ['a wrong shape', favs('{"version": 2, "favorites": ["Trip plan.md"]}')],
    ['an empty list', favs([])],
  ])('a %s file: the plain line, and the phone writes nothing', async (_, files) => {
    h = await openSearch(files)
    const before = await h.store.read(READER_ID, '.yaseendocs/favorites.json')
    await h.click('Favorites')
    await waitFor(h, () => h!.text().includes('No favorites in this vault yet. Add them on the Mac.'))
    expect(h.host.querySelector('.tree')).toBeNull()
    expect(await h.store.read(READER_ID, '.yaseendocs/favorites.json')).toEqual(before)
  })

  it('typed text finds only inside the favorites, in the folder tree; Cards lists only the cards of the favorites', async () => {
    h = await openSearch(favs(['git', 'Café notes.md']))
    await h.click('Favorites')
    await typeQuery(h, 'git')
    await waitFor(h, () => h!.host.querySelector('.search__found') !== null)
    const found = () => [...h!.host.querySelectorAll('.search__found .tree__label')].map((l) => l.textContent)
    expect(found()).toEqual(['git', 'Git cheat sheet', 'git pull'])
    // "trip" finds Trip plan, which is no favorite.
    await typeQuery(h, 'trip')
    await waitFor(h, () => h!.text().includes('No matches with these filters.'))
    await typeQuery(h, 'caf')
    await waitFor(h, () => found().join() === 'Café notes')
    // Off: the whole vault again.
    await h.click('Favorites')
    await typeQuery(h, 'trip')
    await waitFor(h, () => found().includes('Trip plan'))
    await h.click('Favorites')
    await typeQuery(h, '')
    await h.click(/All types/)
    await h.click('Cards')
    // YAZ-5534: Favorites + Cards: the cards of the favorites, in the folder tree, their parents open.
    await waitFor(h, () => h!.host.querySelector('.search__found') !== null)
    expect(tree(h)).toEqual(['0:folder-open:git', '1:markdown:Git cheat sheet', '2:card:git pull'])
    expect([...h.host.querySelectorAll('.search__found .tree__row:not(.tree__row--context) .tree__label')].map((r) => r.textContent)).toEqual(['git pull'])
  })

  it('a sync that brings a new favorites.json changes the list at once', async () => {
    h = await openSearch(favs(['Trip plan.md']))
    await h.click('Favorites')
    await waitFor(h, () => tree(h!).join() === '0:markdown:Trip plan')
    const index = await writeVaultFiles(h.store, { ...READER_FILES, ...favs(['Café notes.md', 'Trip plan.md']) }, {}, 'c2')
    await h.syncEmit({ type: 'changed', vault: READER_ID, settings: ['.yaseendocs/favorites.json'], diff: { added: [], changed: ['.yaseendocs/favorites.json'], removed: [], renamed: [] }, index })
    await waitFor(h, () => tree(h!).join() === '0:markdown:Café notes,0:markdown:Trip plan')
  })
})

const MAC_A = 'aaaaaaaaaaaa'
const MAC_B = 'bbbbbbbbbbbb'
const focus = (mac: string, at: string, list: string[]) => ({ [`.yaseendocs/focus.${mac}.json`]: JSON.stringify({ version: 1, at, focus: list }) })
const folder = (id: string, name: string, items: [string, string][], more: Record<string, unknown> = {}) => ({ id, name, created: 1, at: 1, items: items.map(([vault, path]) => ({ vault, path })), ...more })

describe('the Focus filter (YAZ-5453)', () => {
  it('the newest valid focus file of any Mac is the list, never a workspace file; its folders stand above it, the Mac order', async () => {
    h = await openSearch({
      // Mac B wrote last: its file is the list. Mac A's is older; a bad file and a workspace file are passed over.
      ...focus(MAC_A, '2026-11-01T10:00:00Z', ['Café notes.md']),
      ...focus(MAC_B, '2026-11-02T10:00:00Z', ['Trip plan.md', 'git']),
      '.yaseendocs/focus.cccccccccccc.json': '{"version": 1, "at": "not a time", "focus": ["Spanish words.md"]}',
      [`.yaseendocs/focus-workspace.${MAC_A}.json`]: JSON.stringify({ version: 1, at: '2026-12-01T00:00:00Z', focus: ['Spanish words.md'] }),
      [`.yaseendocs/focus-folders.${MAC_A}.json`]: JSON.stringify({
        version: 1,
        at: '2026-11-01T00:00:00Z',
        self: 'vault',
        folders: [
          folder('f2', 'Trip', [['vault', 'Spanish words.md'], ['other-vault', 'Elsewhere.md']], { created: 2 }),
          folder('f1', 'Study', [['vault', 'cards']], { pos: 0 }),
          folder('f3', 'Old', [['vault', 'Café notes.md']], { deleted: true }),
        ],
      }),
    })
    await h.click('Focus')
    await waitFor(h, () => h!.host.querySelector('[aria-label="Focus"][role="tree"]') !== null)
    expect(h.host.querySelector('h2.section')?.textContent).toBe('Focus')
    // The dragged folder (pos 0) first, then by when made; the deleted one gone; another vault's item (a ghost) not shown.
    expect(tree(h)).toEqual(['0:group:Study', '1:folder:cards', '0:group:Trip', '1:markdown:Spanish words', '0:markdown:Trip plan', '0:folder:git'])
    // A folder of the tab folds shut and open; a folder in it opens in place.
    await h.click(/^Trip, focus folder/)
    expect(tree(h)).not.toContain('1:markdown:Spanish words')
    await h.click(/^cards, folder/)
    expect(tree(h).slice(0, 4)).toEqual(['0:group:Study', '1:folder-open:cards', '2:card:Capital of Spain', '2:card:Two cards in one'])
  })

  it('typed text finds inside the focus items and its folders only; no focus file: the plain line', async () => {
    h = await openSearch({ ...focus(MAC_A, '2026-11-01T10:00:00Z', ['git']) })
    await h.click('Focus')
    await typeQuery(h, 'trip')
    await waitFor(h, () => h!.text().includes('No matches with these filters.'))
    await typeQuery(h, 'pull')
    await waitFor(h, () => [...h!.host.querySelectorAll('.search__found .tree__label')].map((l) => l.textContent).join() === 'git,Git cheat sheet,git pull')
    h.unmount()
    forgetSearch()
    forgetLists()
    h = await openSearch()
    await h.click('Focus')
    await waitFor(h, () => h!.text().includes('Nothing in focus in this vault yet. Add it on the Mac.'))
  })

  it('a sync that brings a newer focus file from another Mac changes the list', async () => {
    h = await openSearch(focus(MAC_A, '2026-11-01T10:00:00Z', ['Trip plan.md']))
    await h.click('Focus')
    await waitFor(h, () => tree(h!).join() === '0:markdown:Trip plan')
    const files = { ...READER_FILES, ...focus(MAC_A, '2026-11-01T10:00:00Z', ['Trip plan.md']), ...focus(MAC_B, '2026-11-03T10:00:00Z', ['Café notes.md']) }
    const index = await writeVaultFiles(h.store, files, {}, 'c2')
    await h.syncEmit({ type: 'changed', vault: READER_ID, settings: [], diff: { added: [`.yaseendocs/focus.${MAC_B}.json`], changed: [], removed: [], renamed: [] }, index })
    await waitFor(h, () => tree(h!).join() === '0:markdown:Café notes')
  })

  it('Favorites shows the Favorites tab folders too (favorite-folders), above its top rows', async () => {
    h = await openSearch({
      ...favs(['Trip plan.md']),
      [`.yaseendocs/favorite-folders.${MAC_A}.json`]: JSON.stringify({ version: 1, at: '2026-11-01T00:00:00Z', self: 'vault', folders: [folder('g1', 'Reading', [['vault', 'Café notes.md']])] }),
    })
    await h.click('Favorites')
    await waitFor(h, () => tree(h!).length === 3)
    expect(tree(h)).toEqual(['0:group:Reading', '1:markdown:Café notes', '0:markdown:Trip plan'])
    await typeQuery(h, 'caf')
    await waitFor(h, () => [...h!.host.querySelectorAll('.search__found .tree__label')].map((l) => l.textContent).join() === 'Café notes')
  })
})

/** Each row's name and the ID at its right end. */
const withIds = (x: Harness) => [...x.host.querySelectorAll<HTMLElement>('.tree .tree__row')].map((r) => `${r.querySelector('.tree__label')?.textContent}${r.querySelector('.tree__id') ? ` ${r.querySelector('.tree__id')?.textContent}` : ''}`)
const showIds = (files: unknown) => ({ '.yaseendocs/show-ids.json': JSON.stringify({ search: 'always', title: true, files }) })

describe('Show IDs in the files list (YAZ-5454)', () => {
  it('no file, or Off: no ID on any row', async () => {
    h = await openSearch()
    expect(h.host.querySelector('.tree__id')).toBeNull()
    h.unmount()
    forgetSearch()
    h = await openSearch(showIds('off'))
    await act(async () => void (await new Promise((r) => setTimeout(r, 30))))
    expect(h.host.querySelector('.tree__id')).toBeNull()
  })

  it('Number: each page row ends with its ID number, folders none; Full: the whole ID; Favorites and Focus rows too', async () => {
    h = await openSearch({ ...showIds('number'), ...favs(['Trip plan.md', 'git']) })
    await waitFor(h, () => h!.host.querySelector('.tree__id') !== null)
    expect(withIds(h)).toEqual(['cards', 'git', 'Café notes #4', 'Spanish words #1', 'Trip plan #3'])
    await h.click('Favorites')
    await waitFor(h, () => withIds(h!)[0] === 'Trip plan #3')
    await h.click(/^git, folder/)
    expect(withIds(h)).toEqual(['Trip plan #3', 'git', 'Git cheat sheet #2'])
    h.unmount()
    forgetSearch()
    forgetLists()
    h = await openSearch(showIds('full'))
    await waitFor(h, () => h!.host.querySelector('.tree__id') !== null)
    expect(withIds(h)).toContain('Spanish words DEMO-1')
  })

  it('a sync that brings a new show-ids.json changes the rows at once', async () => {
    h = await openSearch()
    expect(h.host.querySelector('.tree__id')).toBeNull()
    const index = await writeVaultFiles(h.store, { ...READER_FILES, ...showIds('number') }, {}, 'c2')
    await h.syncEmit({ type: 'changed', vault: READER_ID, settings: ['.yaseendocs/show-ids.json'], diff: { added: ['.yaseendocs/show-ids.json'], changed: [], removed: [], renamed: [] }, index })
    await waitFor(h, () => withIds(h!).includes('Trip plan #3'))
  })
})

describe('the Recent filter (YAZ-5457)', () => {
  const open = async (x: Harness, name: RegExp) => {
    await x.click(name)
    await waitFor(x, () => x.host.querySelector('.reader__title, .card-view__card') !== null)
    await act(async () => void (await new Promise((r) => setTimeout(r, 30))))
    await x.click('Back')
    await waitFor(x, () => x.host.querySelector('.search') !== null)
  }

  it('each page and card opened on the phone, newest first, once each; kept in the phone storage for the vault', async () => {
    h = await openSearch()
    await h.click('Recent')
    await waitFor(h, () => h!.text().includes('Nothing opened on this phone yet.'))
    await h.click('Recent')
    await open(h, /^Trip plan/)
    await open(h, /^Café notes/)
    await h.click(/^cards, folder/)
    await open(h, /^Capital of Spain/)
    await open(h, /^Trip plan/)
    // A card in a page, from a search row.
    await typeQuery(h, 'la bib')
    await waitFor(h, () => h!.host.querySelector('.search__found') !== null)
    await open(h, /^la biblioteca/)
    await typeQuery(h, '')
    await h.click('Recent')
    await waitFor(h, () => h!.host.querySelector('[aria-label="Recent"][role="tree"]') !== null)
    expect(tree(h)).toEqual(['0:card:la biblioteca', '0:markdown:Trip plan', '0:card:Capital of Spain', '0:markdown:Café notes'])
    const stored = await h.store.getState<{ path: string; id?: string }[]>(READER_ID, RECENT_STATE)
    expect(stored?.map((e) => `${e.path}${e.id ? ` ${e.id}` : ''}`)).toEqual(['Spanish words.md DEMO-12', 'Trip plan.md', 'cards/capital-of-spain-demo-40.md DEMO-40', 'Café notes.md'])
    // A tap opens it again.
    await h.click(/^la biblioteca, card/)
    await waitFor(h, () => h!.host.querySelector('.card-view__card') !== null)
  })

  it('typed text finds only inside Recent; a page gone from the vault has no row', async () => {
    h = await openSearch()
    await remember(h.store, READER_ID, { kind: 'page', path: 'Gone.md' }, 1)
    await remember(h.store, READER_ID, { kind: 'page', path: 'git/Git cheat sheet.md' }, 2)
    await h.click('Recent')
    await waitFor(h, () => tree(h!).length > 0)
    expect(tree(h)).toEqual(['0:markdown:Git cheat sheet'])
    await typeQuery(h, 'trip')
    await waitFor(h, () => h!.text().includes('No matches with these filters.'))
    await typeQuery(h, 'cheat')
    await waitFor(h, () => [...h!.host.querySelectorAll('.search__found .tree__label')].map((l) => l.textContent).join() === 'git,Git cheat sheet')
  })

  it(`keeps ${MAX_RECENT} at most; only pages and cards; each vault its own list`, async () => {
    const phone = await newPhone()
    await seedReaderVault(phone.store, phone.tokens)
    // Opened one right after the other: the writes queue, none is lost.
    await Promise.all(Array.from({ length: MAX_RECENT + 5 }, (_, i) => remember(phone.store, READER_ID, { kind: 'page', path: `p${i}.md` }, i)))
    await remember(phone.store, READER_ID, { kind: 'settings' })
    await remember(phone.store, null, { kind: 'page', path: 'x.md' })
    const list = await readRecent(phone.store, READER_ID)
    expect(list).toHaveLength(MAX_RECENT)
    expect(list[0].path).toBe(`p${MAX_RECENT + 4}.md`)
    expect(list.some((e) => e.path === 'x.md')).toBe(false)
    expect(await readRecent(phone.store, 'yaseen/second@main')).toEqual([])
  })
})
