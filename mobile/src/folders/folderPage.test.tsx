// @vitest-environment jsdom
import { act } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { FOLDER_FILES } from '../dev/folderVault'
import { seedReaderVault } from '../dev/readerVault'
import { closeAll } from '../explore/sheets'
import { forgetSearch } from '../search/searchState'
import { HOLD_MS } from '../search/holdFolder'
import { mount, newPhone, type Harness } from '../screens/testing'

/**
 * YAZ-5460, the folder page: its title and its own text (the `.folder.md`'s body, drawn by the reader), its view tabs as
 * the Mac lists them with the saved default open, and Other files (a PDF beside the pages, a page moved there).
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
  document.body.replaceChildren()
})

export async function waitFor(x: Harness, done: () => boolean, ms = 3000): Promise<void> {
  const until = Date.now() + ms
  while (!done()) {
    if (Date.now() > until) throw new Error(`Timed out. Screen: ${x.text()}`)
    await act(async () => void (await new Promise((r) => setTimeout(r, 10))))
  }
}

/** The app on the folder vault, the folder page of `folder` open full screen (held in Search's tree). */
export async function openFolder(folder = 'Projects', files: Record<string, string | Uint8Array> = FOLDER_FILES): Promise<Harness> {
  const phone = await newPhone()
  await seedReaderVault(phone.store, phone.tokens, files)
  const x = await mount({ phone })
  await x.click('Search')
  await waitFor(x, () => x.host.querySelector('.tree') !== null)
  await x.settle()
  const row = [...x.host.querySelectorAll<HTMLElement>('.tree__row')].find((r) => r.querySelector('.tree__label')?.textContent === folder)!
  await act(async () => void row.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true, button: 0 })))
  await act(async () => void (await new Promise((r) => setTimeout(r, HOLD_MS + 30))))
  await act(async () => [...document.querySelectorAll<HTMLButtonElement>('.hold-menu__item')].find((b) => b.textContent === 'Open folder page')!.click())
  await waitFor(x, () => x.host.querySelector('.folder-view') !== null)
  await x.settle()
  return x
}

const tabs = (x: Harness) => [...x.host.querySelectorAll<HTMLElement>('.folder-tabs__tab')].map((t) => `${t.textContent}${t.getAttribute('aria-selected') === 'true' ? ' *' : ''}`)

describe('the folder page (YAZ-5460)', () => {
  it('shows the title, the folder text, the view tabs with the default open, and Other files', async () => {
    h = await openFolder()
    await waitFor(h, () => (h!.host.querySelector('.folder-page__text')?.textContent ?? '').includes('Every project'))
    const page = h.host.querySelector('.folder-page')!
    expect(page.querySelector('.reader__title')?.textContent).toBe('Projects')
    // The text's own "# Projects" says the title again: it is not drawn twice.
    expect(page.querySelector('.folder-page__text h1')).toBeNull()
    expect(page.querySelector('.folder-page__text')?.textContent).toContain('one page each')
    // The Page tab is the text above: the other views, in the Mac's order, the saved default (Table) open.
    expect(tabs(h)).toEqual(['Table *', 'By status', 'Board', 'Cards', 'Calendar'])
    const other = [...page.querySelectorAll('.folder-other__row')].map((r) => r.textContent)
    expect(other).toEqual(['Budget sheet.pdfPDF', 'Old planPage'])
    await act(async () => [...h!.host.querySelectorAll<HTMLElement>('.folder-tabs__tab')][2].click())
    expect(tabs(h)).toEqual(['Table', 'By status', 'Board *', 'Cards', 'Calendar'])
    // A moved page opens from the tray.
    await act(async () => [...page.querySelectorAll<HTMLButtonElement>('.folder-other__row')][1].click())
    await h.waitText('Moved to Other files.')
  })

  it('a folder with no .folder.md: the Mac default views (Table, Board in a vault with IDs), no text', async () => {
    h = await openFolder('git')
    expect(h.host.querySelector<HTMLElement>('.folder-page__text')?.hidden).toBe(true)
    expect(tabs(h)).toEqual(['Table *', 'Board'])
    expect(h.host.querySelector('.folder-other')).toBeNull()
  })
})
