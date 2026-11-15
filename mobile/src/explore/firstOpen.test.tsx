// @vitest-environment jsdom
import { act } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { FOLDER_FILES } from '../dev/folderVault'
import { READER_FILES, READER_ID, seedReaderVault } from '../dev/readerVault'
import { forgetFolderTabs } from '../folders/FolderBody'
import { HOLD_MS } from '../search/holdFolder'
import { forgetLists } from '../search/lists'
import { remember } from '../search/recent'
import { forgetSearch } from '../search/searchState'
import { mount, newPhone, type Harness } from '../screens/testing'
import { closeAll, sheetStack } from './sheets'

/**
 * YAZ-5472 Q4, "the first open is a full page" (Yaseen's rule), in the whole app on made-up vaults:
 *  - the FIRST open from a tab screen (Search's tree and results, Favorites, Focus, Recent, the Today button, a held
 *    folder's "Open folder page") is ALWAYS a full page, even when the vault says "explore"; Back goes to the tab screen;
 *  - a link or a row tapped INSIDE that page (a link, a folder page's rows) opens an Explore panel when the vault says
 *    explore; a link in the panel opens another; Back closes the panel;
 *  - with "open" (no link-click file), everything opens full screen.
 * Review's "Open page" and "Open card" are in `review/tab.test.tsx`.
 */
let h: Harness | null = null
beforeEach(() => {
  URL.createObjectURL = vi.fn(() => 'blob:phone/1')
  URL.revokeObjectURL = vi.fn()
})
afterEach(async () => {
  await act(async () => closeAll())
  h?.unmount()
  h = null
  forgetSearch()
  forgetLists()
  forgetFolderTabs()
  document.body.replaceChildren()
})

const EXPLORE_FILE = { '.yaseendocs/link-click.json': '{"click":"explore"}' }
const EXPLORE = { ...READER_FILES, ...EXPLORE_FILE }
const DAILY = { '.yaseendocs/daily-pages.json': JSON.stringify({ enabled: true, folder: 'Daily', format: 'YYYY-MM-DD', dayFolder: false }), 'Daily/2026-11-13.md': '# Today words\n\nSee [[Trip plan]].\n' }
const MAC = 'aaaaaaaaaaaa'
const FOCUS = { [`.yaseendocs/focus.${MAC}.json`]: JSON.stringify({ version: 1, at: '2026-11-02T10:00:00Z', focus: ['Trip plan.md'] }) }
const FAVORITES = { '.yaseendocs/favorites.json': JSON.stringify({ version: 1, favorites: ['Trip plan.md'] }) }

async function waitFor(x: Harness, done: () => boolean, ms = 3000): Promise<void> {
  const until = Date.now() + ms
  while (!done()) {
    if (Date.now() > until) throw new Error(`Timed out. Screen: ${x.text()} | Sheets: ${sheetStack().length}`)
    await act(async () => void (await new Promise((r) => setTimeout(r, 10))))
  }
}
async function openSearch(files: Record<string, string | Uint8Array>, before?: (phone: Awaited<ReturnType<typeof newPhone>>) => Promise<void>): Promise<Harness> {
  const phone = await newPhone()
  await seedReaderVault(phone.store, phone.tokens, files)
  await before?.(phone)
  const x = await mount({ phone })
  await x.click('Search')
  await waitFor(x, () => x.host.querySelector('.tree') !== null)
  // The vault's choice is read when the vault opens.
  await x.settle()
  return x
}

const sheets = () => [...document.querySelectorAll<HTMLElement>('.explore-sheet')]
const title = (x: Harness) => x.host.querySelector('.topbar__title')?.textContent ?? ''
const onTabs = (x: Harness) => x.button('Back') === null && x.host.querySelector('[role="tab"]') !== null
/** A link (`[[name]]`) in `where`: the full page's reader, or the top panel's. */
const linkIn = (where: ParentNode | null | undefined, name: RegExp) =>
  [...(where?.querySelectorAll<HTMLElement>('.reader__body a, .reader__body [data-open]') ?? [])].find((a) => name.test(a.textContent?.trim() ?? '')) ?? null
async function tap(el: HTMLElement | null | undefined): Promise<void> {
  if (el === null || el === undefined) throw new Error('Nothing to tap')
  await act(async () => el.click())
}
/** The full page named `name` is open, with no panel over it. */
async function fullPage(x: Harness, name: string): Promise<void> {
  await waitFor(x, () => title(x) === name && x.host.querySelector('.reader__body, .card-view__card, .folder-page, .page-drawing, .page-media--board, [data-vault-drawing]') !== null)
  await x.settle()
  expect(sheetStack()).toEqual([])
  expect(sheets()).toEqual([])
}
async function holdOpen(x: Harness, folder: string): Promise<void> {
  const row = [...x.host.querySelectorAll<HTMLElement>('.tree__row')].find((r) => r.querySelector('.tree__label')?.textContent === folder)!
  await act(async () => void row.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true, button: 0 })))
  await act(async () => void (await new Promise((r) => setTimeout(r, HOLD_MS + 30))))
  await act(async () => [...document.querySelectorAll<HTMLButtonElement>('.hold-menu__item')].find((b) => b.textContent === 'Open folder page')!.click())
}

describe('YAZ-5472 Q4: each tab-screen opener, with explore on, opens a FULL PAGE and no panel', () => {
  it('Search’s tree', async () => {
    h = await openSearch(EXPLORE)
    await h.click(/^Trip plan/)
    await fullPage(h, 'Trip plan')
  })

  it('Search’s results', async () => {
    h = await openSearch(EXPLORE)
    const box = h.host.querySelector<HTMLInputElement>('input[type="search"]')!
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(box, 'Trip')
      box.dispatchEvent(new Event('input', { bubbles: true }))
    })
    await waitFor(h, () => h!.host.querySelector('[role="tree"][aria-label="Results"]') !== null)
    await tap([...h.host.querySelectorAll<HTMLElement>('[aria-label="Results"] button')].find((b) => /Trip plan/.test(b.textContent ?? '')))
    await fullPage(h, 'Trip plan')
  })

  for (const [list, files] of [['Favorites', FAVORITES], ['Focus', FOCUS]] as const)
    it(list, async () => {
      h = await openSearch({ ...EXPLORE, ...files })
      await h.click(list)
      await waitFor(h, () => h!.host.querySelector(`[role="tree"][aria-label="${list}"]`) !== null)
      await tap([...h.host.querySelectorAll<HTMLElement>(`[role="tree"][aria-label="${list}"] button`)].find((b) => /^Trip plan/.test(b.textContent?.trim() ?? '')))
      await fullPage(h, 'Trip plan')
    })

  it('Recent', async () => {
    h = await openSearch(EXPLORE, (phone) => remember(phone.store, READER_ID, { kind: 'page', path: 'Trip plan.md' }, 1))
    await h.click('Recent')
    await waitFor(h, () => h!.host.querySelector('[role="tree"][aria-label="Recent"]') !== null)
    await tap([...h.host.querySelectorAll<HTMLElement>('[role="tree"][aria-label="Recent"] button')].find((b) => /^Trip plan/.test(b.textContent?.trim() ?? '')))
    await fullPage(h, 'Trip plan')
  })

  it('the Today button', async () => {
    h = await openSearch({ ...EXPLORE, ...DAILY })
    await waitFor(h, () => h!.host.querySelector('.tabbar__today') !== null)
    await tap(h.host.querySelector<HTMLElement>('.tabbar__today'))
    await waitFor(h, () => h!.text().includes('Today words'))
    await h.settle()
    expect(sheetStack()).toEqual([])
    expect(h.button('Back')).not.toBeNull()
  })

  it('a held folder’s Open folder page', async () => {
    h = await openSearch({ ...FOLDER_FILES, ...EXPLORE_FILE })
    await holdOpen(h, 'Projects')
    await waitFor(h, () => h!.host.querySelector('.folder-page') !== null)
    await h.settle()
    expect(sheetStack()).toEqual([])
    expect(h.host.querySelector('.explore-sheet .folder-page')).toBeNull()
  })
})

describe('YAZ-5472 Q4: inside that page, links and rows open Explore panels', () => {
  it('a link in the full page opens a panel; a link in the panel opens another; Back closes each, then the page, to Search', async () => {
    h = await openSearch(EXPLORE)
    await h.click(/^Spanish words/)
    await fullPage(h, 'Spanish words')
    await waitFor(h, () => linkIn(h!.host, /^Trip plan$/) !== null)
    await tap(linkIn(h.host, /^Trip plan$/))
    await waitFor(h, () => sheets().length === 1 && linkIn(sheets().at(-1), /^Spanish words$/) !== null)
    expect(sheetStack().map((s) => s.route)).toEqual([{ kind: 'page', path: 'Trip plan.md' }])
    // The full page stays under the panel.
    expect(title(h)).toBe('Spanish words')
    await tap(linkIn(sheets().at(-1), /^Spanish words$/))
    await waitFor(h, () => sheets().length === 2)
    expect(sheetStack().map((s) => s.route.path)).toEqual(['Trip plan.md', 'Spanish words.md'])
    // Back (Escape, the app's own close of the top overlay) closes a panel at a time; then ← closes the page.
    await act(async () => void document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' })))
    await waitFor(h, () => sheetStack().length === 1)
    await act(async () => void document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' })))
    await waitFor(h, () => sheetStack().length === 0)
    expect(title(h)).toBe('Spanish words')
    await h.click('Back')
    await waitFor(h, () => onTabs(h!) && h!.host.querySelector('.tree') !== null)
  })

  it('the Today page’s link opens a panel', async () => {
    h = await openSearch({ ...EXPLORE, ...DAILY })
    await waitFor(h, () => h!.host.querySelector('.tabbar__today') !== null)
    await tap(h.host.querySelector<HTMLElement>('.tabbar__today'))
    await waitFor(h, () => linkIn(h!.host, /^Trip plan$/) !== null)
    await tap(linkIn(h.host, /^Trip plan$/))
    await waitFor(h, () => sheets().length === 1)
    expect(sheetStack().map((s) => s.route)).toEqual([{ kind: 'page', path: 'Trip plan.md' }])
  })

  it('a folder page’s rows open panels: a table row, a subfolder row, a card, an Other file', async () => {
    const files = { ...FOLDER_FILES, ...EXPLORE_FILE, 'Projects/.folder.md': (FOLDER_FILES['Projects/.folder.md'] as string).replace('      name: Table\n', '      name: Table\n      subfolders: rows\n') }
    h = await openSearch(files)
    await holdOpen(h, 'Projects')
    await waitFor(h, () => h!.host.querySelector('.folder-table tbody tr') !== null)
    await h.settle()
    expect(sheetStack()).toEqual([])
    // A page's row (FolderTable).
    const pageRow = [...h.host.querySelectorAll<HTMLElement>('.folder-table tbody tr:not([data-folder])')].find((tr) => /Garden shed/.test(tr.textContent ?? ''))!
    await tap(pageRow.querySelector('td'))
    await waitFor(h, () => sheetStack().length === 1)
    expect(sheetStack()[0].route).toEqual({ kind: 'page', path: 'Projects/Garden shed.md' })
    await act(async () => closeAll())
    // The subfolder's row: its folder page, in a panel.
    await tap(h.host.querySelector<HTMLElement>('.folder-table tr[data-folder] td'))
    await waitFor(h, () => sheetStack().length === 1)
    expect(sheetStack()[0].route).toEqual({ kind: 'folder', path: 'Projects/Trips' })
    await act(async () => closeAll())
    // An Other file (FolderBody).
    await tap([...h.host.querySelectorAll<HTMLElement>('.folder-other button')].find((b) => /Old plan/.test(b.textContent ?? '')))
    await waitFor(h, () => sheetStack().length === 1)
    expect(sheetStack()[0].route).toEqual({ kind: 'page', path: 'Projects/Old plan.md' })
    await act(async () => closeAll())
    // The Cards view (FolderCards).
    await tap([...h.host.querySelectorAll<HTMLElement>('.folder-tabs__tab')].find((t) => t.textContent === 'Cards'))
    await waitFor(h, () => h!.host.querySelector('.folder-card') !== null)
    await tap(h.host.querySelector<HTMLElement>('.folder-card'))
    await waitFor(h, () => sheetStack().length === 1)
    expect(sheetStack()[0].route.kind).toBe('page')
    // The folder page stays under, full screen.
    expect(h.host.querySelector('.folder-page')).not.toBeNull()
  })
})

describe('YAZ-5472 Q4: with "open" (no link-click file), everything opens full screen', () => {
  it('a Search row, a link in the page, a folder page and its row', async () => {
    h = await openSearch(FOLDER_FILES)
    await h.click(/^Spanish words/)
    await fullPage(h, 'Spanish words')
    await waitFor(h, () => linkIn(h!.host, /^Trip plan$/) !== null)
    await tap(linkIn(h.host, /^Trip plan$/))
    await fullPage(h, 'Trip plan')
    // Back: one page at a time, to Search.
    await h.click('Back')
    await fullPage(h, 'Spanish words')
    await h.click('Back')
    await waitFor(h, () => onTabs(h!) && h!.host.querySelector('.tree') !== null)
    await holdOpen(h, 'Projects')
    await waitFor(h, () => h!.host.querySelector('.folder-table tbody tr') !== null)
    expect(sheetStack()).toEqual([])
    await tap(h.host.querySelector<HTMLElement>('.folder-table tbody tr td'))
    await waitFor(h, () => h!.host.querySelector('.folder-page') === null && h!.host.querySelector('.reader__body') !== null)
    expect(sheetStack()).toEqual([])
  })
})
