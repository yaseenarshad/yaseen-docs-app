// @vitest-environment jsdom
import { act } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { READER_FILES, seedReaderVault } from '../dev/readerVault'
import { DRAWING_FILES } from '../dev/drawingVault'
import { FOLDER_FILES } from '../dev/folderVault'
import { closeAll } from '../explore/sheets'
import { forgetFolderTabs } from '../folders/FolderBody'
import { openFolder } from '../folders/folderTesting'
import { forgetSearch } from './searchState'
import { forgetLists } from './lists'
import { mount, newPhone, type Harness } from '../screens/testing'

/** YAZ-5533: draw.io's viewer runs in a frame, which jsdom does not load: its answer is made up here. */
vi.mock('../drawing/diagram/drawDiagram', async () => ({
  ...(await vi.importActual<typeof import('../drawing/diagram/figure')>('../drawing/diagram/figure')),
  DiagramUnavailable: class extends Error {},
  drawDiagram: async () => ({ svg: '<svg xmlns="http://www.w3.org/2000/svg" width="300" height="120"></svg>', width: 300, height: 120, pages: [{ id: 'd', name: 'Page-1' }], page: 'd', missing: [] }),
}))

/**
 * YAZ-5551: the Mac's icons in each place the phone draws a file's icon. The Mac's icon set, file icon style and folder
 * icons are app settings (`store.ts`, the settings folder), not in the vault, so the phone draws the Mac's defaults
 * (Material, "Colour", "Plain"): a drawing Material's `excalidraw`, a diagram its `drawio` (inline, `styles.css`), a draw.io
 * picture its `svg`, a page the grey page glyph, a folder Material's default folder; the vault's own pick or rule first.
 * One test per place. Made-up vault only.
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

async function waitFor(x: Harness, done: () => boolean, ms = 3000): Promise<void> {
  const until = Date.now() + ms
  while (!done()) {
    if (Date.now() > until) throw new Error(`Timed out. Screen: ${x.text()}`)
    await act(async () => void (await new Promise((r) => setTimeout(r, 10))))
  }
}
async function openSearch(files: Record<string, string | Uint8Array>): Promise<Harness> {
  const phone = await newPhone()
  await seedReaderVault(phone.store, phone.tokens, files)
  const x = await mount({ phone })
  await x.click('Search')
  await waitFor(x, () => x.host.querySelector('.tree') !== null)
  return x
}
const FILES = { ...READER_FILES, ...DRAWING_FILES }
/** `name [data-kind or the img's src]` of each row of the tree labelled `label`. */
const icons = (x: Harness, label: string) =>
  [...x.host.querySelectorAll(`[role="tree"][aria-label="${label}"] .tree__row`)].map((r) => {
    const icon = r.querySelector('.file-icon')
    return `${r.querySelector('.tree__label')?.textContent} [${icon?.tagName === 'IMG' ? icon.getAttribute('src') : icon?.getAttribute('data-kind')}]`
  })

describe('the Mac’s icons in each place (YAZ-5551)', () => {
  it('Recent: a drawing it holds is Material’s excalidraw', async () => {
    h = await openSearch(FILES)
    await h.click('garden, drawing')
    await waitFor(h, () => h!.host.querySelector('.topbar__title')?.textContent === 'garden')
    await h.click('Back')
    await waitFor(h, () => h!.host.querySelector('.tree') !== null)
    await h.click('Recent')
    await waitFor(h, () => h!.button('garden, drawing') !== null)
    const icon = h.button('garden, drawing')!.querySelector('.file-icon')
    expect(icon?.tagName).toBe('SPAN')
    expect(icon?.getAttribute('data-kind')).toBe('drawing')
  })

  it('Favorites: a drawing, a diagram, a draw.io picture and a page, as the Mac; a pick still wins', async () => {
    const favorites = ['garden.excalidraw', 'old plan.drawio', 'flow.drawio.svg', 'Trip plan.md', 'broken.excalidraw']
    h = await openSearch({ ...FILES, '.yaseendocs/favorites.json': JSON.stringify({ version: 1, favorites }), '.yaseendocs/icons.json': JSON.stringify({ version: 2, paths: { 'broken.excalidraw': 'lua' } }) })
    await h.click('Favorites')
    await waitFor(h, () => icons(h!, 'Favorites').some((r) => r.includes('/material-icons/svg.svg')) && icons(h!, 'Favorites').some((r) => r.includes('lua')))
    expect(icons(h, 'Favorites')).toEqual(expect.arrayContaining(['garden [drawing]', 'old plan [diagram]', 'flow.drawio [/material-icons/svg.svg]', 'Trip plan [markdown]', 'broken [/material-icons/lua.svg]']))
  })

  it('Focus: the focus list’s drawing and diagram are Material’s icons', async () => {
    const focus = { version: 1, at: '2026-11-02T10:00:00Z', focus: ['garden.excalidraw', 'old plan.drawio'] }
    h = await openSearch({ ...FILES, '.yaseendocs/focus.aaaaaaaaaaaa.json': JSON.stringify(focus) })
    await h.click('Focus')
    await waitFor(h, () => icons(h!, 'Focus').length === 2)
    expect(icons(h, 'Focus')).toEqual(['garden [drawing]', 'old plan [diagram]'])
  })

  it('the top bar: a page’s kind is the Mac’s page glyph (a drawing’s screen has no kind icon)', async () => {
    h = await openSearch(FILES)
    await h.click('Trip plan, page')
    await waitFor(h, () => h!.host.querySelector('.topbar__kind') !== null)
    expect(h.host.querySelector('.topbar__kind')?.getAttribute('data-kind')).toBe('markdown')
    await h.click('Back')
    await waitFor(h, () => h!.host.querySelector('.tree') !== null)
    await h.click('garden, drawing')
    await waitFor(h, () => h!.host.querySelector('.topbar__title')?.textContent === 'garden')
    expect(h.host.querySelector('.topbar__kind')).toBeNull()
  })

  it('a folder page’s Other files: a drawing, a diagram and a draw.io picture are the Mac’s icons; a PDF the plain sheet', async () => {
    h = await openFolder('Projects', {
      ...FOLDER_FILES,
      'Projects/Shed sketch.excalidraw': DRAWING_FILES['garden.excalidraw'],
      'Projects/Wiring.drawio': DRAWING_FILES['old plan.drawio'],
      'Projects/Flow.drawio.svg': DRAWING_FILES['flow.drawio.svg'],
    })
    const rows = () =>
      [...h!.host.querySelectorAll('.folder-other__row')].map((r) => {
        const icon = r.querySelector('.file-icon')
        return `${r.querySelector('.folder-other__name')?.textContent} [${icon?.tagName === 'IMG' ? icon.getAttribute('src') : icon?.getAttribute('data-kind')}]`
      })
    await waitFor(h, () => rows().some((r) => r.includes('/material-icons/svg.svg')))
    expect(rows()).toEqual(expect.arrayContaining(['Shed sketch.excalidraw [drawing]', 'Wiring.drawio [diagram]', 'Flow.drawio.svg [/material-icons/svg.svg]', 'Budget sheet.pdf [file]']))
  })
})
