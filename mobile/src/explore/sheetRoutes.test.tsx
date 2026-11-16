// @vitest-environment jsdom
import { act } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DRAWING_FILES } from '../dev/drawingVault'
import { FOLDER_FILES } from '../dev/folderVault'
import { READER_FILES, seedReaderVault } from '../dev/readerVault'
import { forgetFolderTabs } from '../folders/FolderBody'
import { forgetSearch } from '../search/searchState'
import { mount, newPhone, type Harness } from '../screens/testing'
import { closeAll, openSheet, sheetStack, type SheetRoute } from './sheets'

/**
 * YAZ-5531: a folder's page in an Explore sheet draws what the full-screen folder page draws (the same `FolderBody`): its
 * text, its view tabs, the table, the board, the cards and the calendar. A row opens a page in a sheet on top; Back and
 * a drag down close as usual. And every route a sheet can get (page, card, card file, drawing, folder) draws something.
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

const EXPLORE = '.yaseendocs/link-click.json'
const FILES = { ...READER_FILES, ...DRAWING_FILES, ...FOLDER_FILES, [EXPLORE]: '{"click":"explore"}' }

const sheets = () => [...document.querySelectorAll<HTMLElement>('.explore-sheet')]
const topSheet = () => sheets().at(-1) ?? null
const sheetsText = () => sheets().map((s) => s.textContent?.replace(/\s+/g, ' ')).join(' || ')

async function waitFor(x: Harness, done: () => boolean, ms = 3000): Promise<void> {
  const until = Date.now() + ms
  while (!done()) {
    if (Date.now() > until) throw new Error(`Timed out. Screen: ${x.text()} | Sheets: ${sheetsText()}`)
    await act(async () => void (await new Promise((r) => setTimeout(r, 10))))
  }
}

async function openSearch(files: Record<string, string | Uint8Array> = FILES): Promise<Harness> {
  const phone = await newPhone()
  await seedReaderVault(phone.store, phone.tokens, files)
  const x = await mount({ phone })
  await x.click('Search')
  await waitFor(x, () => x.host.querySelector('.tree') !== null)
  await x.settle()
  return x
}

function touch(el: Element, type: string, x: number, y: number, t: number): void {
  const e = new Event(type, { bubbles: true, cancelable: true })
  Object.defineProperty(e, 'touches', { value: type === 'touchend' ? [] : [{ clientX: x, clientY: y }] })
  Object.defineProperty(e, 'timeStamp', { value: t })
  el.dispatchEvent(e)
}

const tabNames = (sheet: Element) => [...sheet.querySelectorAll('.folder-tabs__tab')].map((t) => t.textContent)
const tab = (sheet: Element, name: string) => [...sheet.querySelectorAll<HTMLElement>('.folder-tabs__tab')].find((t) => t.textContent === name)!

describe('a folder page in an Explore sheet (YAZ-5531)', () => {
  it('explorePanel_folderRoute_drawsFolderPageAndViews', async () => {
    h = await openSearch()
    // YAZ-5472 Q4: the hold's "Open folder page" in Search's tree is a tab screen's first open, so a full page
    // (`holdFolder.test.tsx`). A folder link inside a page is what makes a folder sheet: the vault says "explore".
    await act(async () => openSheet({ kind: 'folder', path: 'Projects' }))
    await waitFor(h, () => sheets().length === 1)
    expect(sheetStack().map((s) => s.route)).toEqual([{ kind: 'folder', path: 'Projects' }])
    // Search stays under it; the page is in the sheet, not full screen.
    expect(h.host.querySelector('.tree')).not.toBeNull()
    const sheet = topSheet()!
    await waitFor(h, () => sheet.querySelector('.folder-page .folder-view') !== null && (sheet.querySelector('.folder-page__text')?.textContent ?? '').includes('Every project'))

    // THE SAME page as full screen: the title, its text, its tabs (the saved default open), Other files.
    expect(sheet.querySelector('.folder-page .reader__title')?.textContent).toBe('Projects')
    expect(sheet.querySelector('.folder-page__text')?.textContent).toContain('one page each')
    expect(tabNames(sheet)).toEqual(['Table', 'By status', 'Board', 'Cards', 'Calendar'])
    expect(tab(sheet, 'Table').getAttribute('aria-selected')).toBe('true')
    expect(sheet.querySelector('.folder-other')).not.toBeNull()

    // The table, each view after it.
    const table = sheet.querySelector('.folder-table table')!
    expect(table.textContent).toContain('Garden shed')
    expect(table.textContent).toContain('Bike repair')
    await act(async () => tab(sheet, 'Board').click())
    await waitFor(h, () => sheet.querySelector('.folder-board') !== null)
    expect(sheet.querySelectorAll('.folder-board .folder-card').length).toBe(5)
    await act(async () => tab(sheet, 'Cards').click())
    await waitFor(h, () => sheet.querySelector('.folder-view[data-type="cards"], .folder-view[data-type="list"]') !== null)
    expect(sheet.querySelectorAll('.folder-card').length).toBe(5)
    await act(async () => tab(sheet, 'Calendar').click())
    await waitFor(h, () => sheet.querySelectorAll('.folder-agenda__day').length > 0 || sheet.querySelector('.folder-view[data-type="calendar"]') !== null)
    expect(sheet.querySelector('.folder-view[data-type="calendar"]')?.textContent ?? '').not.toBe('')

    // A row opens its page through the one door: a sheet ON TOP of the folder's.
    await act(async () => tab(sheet, 'Cards').click())
    await waitFor(h, () => sheet.querySelectorAll('.folder-card').length === 5)
    const shed = [...sheet.querySelectorAll<HTMLElement>('.folder-card')].find((c) => c.textContent?.includes('Garden shed'))!
    await act(async () => shed.click())
    await waitFor(h, () => sheets().length === 2)
    expect(sheetStack().map((s) => s.route)).toEqual([{ kind: 'folder', path: 'Projects' }, { kind: 'page', path: 'Projects/Garden shed.md' }])
    await waitFor(h, () => (topSheet()?.querySelector('.reader__body')?.textContent ?? '').includes('Build the shed'))

    // Back (Escape, the app's Back) closes the page's sheet; the folder's stays, its view as it was.
    await act(async () => void document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' })))
    await waitFor(h, () => sheets().length === 1)
    expect(topSheet()!.querySelector('.folder-page')).not.toBeNull()
    expect(tab(topSheet()!, 'Cards').getAttribute('aria-selected')).toBe('true')

    // A drag down from its top closes the folder's sheet too.
    const body = topSheet()!.querySelector('.explore-sheet__body')!
    touch(body, 'touchstart', 100, 100, 1000)
    for (let i = 1; i <= 30; i++) touch(body, 'touchmove', 100, 100 + i * 15, 1000 + i * 16)
    await act(async () => void touch(body, 'touchend', 100, 550, 1500))
    await waitFor(h, () => sheets().length === 0)
    expect(h.host.querySelector('.tree')).not.toBeNull()
  })

  it('a folder with no .folder.md and a nested folder draw their pages in a sheet too', async () => {
    h = await openSearch()
    await act(async () => openSheet({ kind: 'folder', path: 'git' }))
    await waitFor(h, () => topSheet()?.querySelector('.folder-page .folder-view') !== null)
    expect(tabNames(topSheet()!)).toEqual(['Table', 'Board'])
    await act(async () => openSheet({ kind: 'folder', path: 'Projects/Trips' }))
    await waitFor(h, () => sheets().length === 2 && topSheet()?.querySelector('.folder-page .folder-view') !== null)
    expect(topSheet()!.querySelector('.folder-page .reader__title')?.textContent).toBe('Trips')
    expect(topSheet()!.querySelector('.folder-view')?.textContent).toContain('Lisbon weekend')
  })
})

describe('every route a sheet can get draws something (YAZ-5531)', () => {
  const ROUTES: [string, SheetRoute, (sheet: Element) => boolean][] = [
    ['page', { kind: 'page', path: 'Trip plan.md' }, (s) => (s.querySelector('.reader__body')?.textContent ?? '').includes('Madrid, May 3')],
    ['card in a page', { kind: 'card', path: 'Spanish words.md', id: 'DEMO-12' }, (s) => (s.querySelector('.card-view__card')?.textContent ?? '').includes('the library')],
    ['card file', { kind: 'card', path: 'cards/capital-of-spain-demo-40.md', id: 'DEMO-40' }, (s) => (s.querySelector('.card-view__card')?.textContent ?? '').includes('Manzanares')],
    ['drawing', { kind: 'drawing', path: 'garden.excalidraw' }, (s) => s.querySelector('.explore-drawing .reader__title')?.textContent === 'garden' && (s.querySelector('.explore-drawing .reader__body')?.childElementCount ?? 0) > 0],
    ['folder', { kind: 'folder', path: 'Projects' }, (s) => s.querySelector('.folder-page .folder-table table') !== null],
  ]
  for (const [name, route, drew] of ROUTES)
    it(`a ${name}`, async () => {
      h = await openSearch()
      await act(async () => openSheet(route))
      await waitFor(h, () => sheets().length === 1)
      await waitFor(h, () => drew(topSheet()!))
      expect(topSheet()!.querySelector('.explore-sheet__body')!.textContent?.trim()).not.toBe('')
    })
})
