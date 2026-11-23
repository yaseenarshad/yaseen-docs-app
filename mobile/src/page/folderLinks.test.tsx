// @vitest-environment jsdom
import { act } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { folderResolver as macFolderResolver } from '@client/links/folderLinks'
import type { IndexRecord } from '@shared/types'
import { FOLDER_FILES } from '../dev/folderVault'
import { seedReaderVault } from '../dev/readerVault'
import { closeAll, sheetStack } from '../explore/sheets'
import { forgetFolderTabs } from '../folders/FolderBody'
import { forgetSearch } from '../search/searchState'
import { mount, newPhone, type Harness } from '../screens/testing'
import { folderResolver } from './folderLink'

/**
 * YAZ-5550: a `[[link]]` that names a folder, and no page, opens that folder's page, as the Mac's link resolver reads it
 * (`client/src/links/folderLinks.ts`: a page first, then the folder by its ID, path, title, name). Inside a page it
 * follows the first-open rule (YAZ-5472 Q4): an Explore panel when the vault says explore, else full screen. A page of
 * the same name wins. Made-up vault.
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
  forgetFolderTabs()
  document.body.replaceChildren()
})

const LINKS = '---\ntitle: Folder links\n---\n\nSee [[Projects]], [[DEMO-90|the projects]], [[projects/trips]], [[Trips]] and [[Nowhere]].\n'
const EXPLORE = { '.yaseendocs/link-click.json': '{"click":"explore"}' }

async function waitFor(x: Harness, done: () => boolean, ms = 3000): Promise<void> {
  const until = Date.now() + ms
  while (!done()) {
    if (Date.now() > until) throw new Error(`Timed out. Screen: ${x.text()} | Sheets: ${sheetStack().length}`)
    await act(async () => void (await new Promise((r) => setTimeout(r, 10))))
  }
}
/** The app on the folder vault, the page of links open full screen from Search. */
async function openLinks(extra: Record<string, string> = {}): Promise<Harness> {
  const phone = await newPhone()
  await seedReaderVault(phone.store, phone.tokens, { ...FOLDER_FILES, 'Folder links.md': LINKS, ...extra })
  const x = await mount({ phone })
  await x.click('Search')
  await waitFor(x, () => x.host.querySelector('.tree') !== null)
  await x.settle()
  await x.click(/^Folder links/)
  await waitFor(x, () => x.host.querySelectorAll('.reader__body a').length >= 5)
  await x.settle()
  return x
}
const link = (where: ParentNode, words: string) => [...where.querySelectorAll<HTMLElement>('.reader__body a')].find((a) => a.textContent?.trim() === words)!
const tap = async (el: HTMLElement) => act(async () => el.click())

describe('a link to a folder opens its folder page (YAZ-5550)', () => {
  it('the folder by its name, its ID, its path and a name deeper down; a missing name stays missing', async () => {
    h = await openLinks()
    const shown = ['Projects', 'the projects', 'projects/trips', 'Trips', 'Nowhere'].map((w) => {
      const a = link(h!.host, w)
      return [w, a.dataset.open ?? null, a.dataset.path ?? null]
    })
    expect(shown).toEqual([
      ['Projects', 'folder', 'Projects'],
      ['the projects', 'folder', 'Projects'],
      ['projects/trips', 'folder', 'Projects/Trips'],
      ['Trips', 'folder', 'Projects/Trips'],
      ['Nowhere', null, null],
    ])
    expect(link(h.host, 'Projects').classList.contains('wikilink--unresolved')).toBe(false)
    expect(link(h.host, 'Nowhere').classList.contains('wikilink--unresolved')).toBe(true)
  })

  it('"open" (no link-click file): a tap opens the folder page full screen; Back comes back to the page', async () => {
    h = await openLinks()
    await tap(link(h.host, 'Projects'))
    await waitFor(h, () => h!.host.querySelector('.folder-page .reader__title')?.textContent === 'Projects')
    expect(sheetStack()).toEqual([])
    expect(h.host.querySelector('.folder-page__text')?.textContent).toContain('Every project of the year')
    await h.click('Back')
    await waitFor(h, () => h!.host.querySelector('.topbar__title')?.textContent === 'Folder links')
  })

  it('"explore": a tap inside the page opens the folder page in a panel; a folder link in that panel opens another panel', async () => {
    h = await openLinks({ ...EXPLORE, 'Projects/Garden shed.md': (FOLDER_FILES['Projects/Garden shed.md'] as string).replace('Build the shed before winter.', 'Build the shed before winter. See [[Trips]].') })
    await tap(link(h.host, 'Trips'))
    await waitFor(h, () => sheetStack().length === 1)
    expect(sheetStack()[0]!.route).toEqual({ kind: 'folder', path: 'Projects/Trips' })
    await waitFor(h, () => document.querySelector('.explore-sheet .folder-page .reader__title')?.textContent === 'Trips')
    // The full page stays under the panel.
    expect(h.host.querySelector('.topbar__title')?.textContent).toBe('Folder links')
    await act(async () => closeAll())
    // A page in a panel: its folder link opens another panel on top.
    await tap(link(h.host, 'Projects'))
    await waitFor(h, () => document.querySelector('.explore-sheet .folder-table td[data-name]') !== null)
    const shed = [...document.querySelectorAll<HTMLElement>('.explore-sheet .folder-table td[data-name]')].find((td) => td.textContent === 'Garden shed')!
    await tap(shed)
    await waitFor(h, () => sheetStack().length === 2 && [...document.querySelectorAll('.explore-sheet .reader__body a')].some((a) => a.textContent === 'Trips'))
    const inPanel = [...document.querySelectorAll<HTMLElement>('.explore-sheet .reader__body a')].find((a) => a.textContent === 'Trips')!
    await tap(inPanel)
    await waitFor(h, () => sheetStack().length === 3)
    expect(sheetStack()[2]!.route).toEqual({ kind: 'folder', path: 'Projects/Trips' })
  })

  it('a page of the same name wins over the folder (the Mac\'s rule: no link that opened a page means anything new)', async () => {
    h = await openLinks({ 'Projects.md': '---\ntitle: Projects\n---\n\nThe page called Projects.\n' })
    expect([link(h.host, 'Projects').dataset.open, link(h.host, 'Projects').dataset.path]).toEqual(['page', 'Projects.md'])
    // By its ID the folder is still the folder's.
    expect([link(h.host, 'the projects').dataset.open, link(h.host, 'the projects').dataset.path]).toEqual(['folder', 'Projects'])
  })
})

describe("the phone's folder resolver gives the Mac's answers (YAZ-5550)", () => {
  const folder = (dir: string, title: string, id?: string): IndexRecord => ({ path: `${dir}/.folder.md`, name: '.folder.md', basename: '.folder', title, folder: dir, ext: 'md', size: 0, ctime: 0, mtime: 0, properties: {}, aliases: [], tags: [], links: [], embeds: [], ...(id !== undefined && { id }) }) as unknown as IndexRecord
  const dirs = ['Projects', 'Projects/Trips', 'Projects/Old', 'Archive', 'Archive/Trips', 'Archive/2025', 'Work', 'Work/Clients', 'Work/Clients/Acme']
  const folders = [folder('Projects', 'Projects', 'DEMO-90'), folder('Projects/Trips', 'Journeys', 'DEMO-96'), folder('Archive/2025', 'Last year'), folder('Work/Clients', 'Customers', 'demo-12'), folder('Work/Clients/Acme', 'Acme Ltd')]
  const targets = ['Projects', 'projects', '[[Projects]]', 'Projects|Shown words', 'Projects#Part', 'DEMO-90', 'demo-90', 'DEMO-96', 'DEMO-12', 'Trips', 'Journeys', 'Projects/Trips', 'projects/journeys', 'Archive/Trips', '2025', 'Last year', 'Archive/Last year', 'Customers', 'Work/Customers/Acme Ltd', 'Acme', 'Acme Ltd', '/Work/', 'Nowhere', '', 'DEMO-99']
  it.each(targets)('%s', (target) => {
    const mac = macFolderResolver('', dirs, folders, { letters: ['DEMO'] })
    const phone = folderResolver(dirs, folders, ['DEMO'])
    expect(phone(target)).toBe(mac(target))
  })
})
