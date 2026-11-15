// @vitest-environment jsdom
import { act } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { READER_FILES, READER_ID, seedReaderVault } from '../dev/readerVault'
import { DRAWING_FILES } from '../dev/drawingVault'
import { boardKindOf, boardLabel } from '../drawing/boardFiles'
import { forgetSearch } from '../search/searchState'
import { forgetLists } from '../search/lists'
import { readRecent } from '../search/recent'
import { mount, newPhone, type Harness } from '../screens/testing'
import { closeAll } from './sheets'

/** YAZ-5533: draw.io's viewer runs in a frame, which jsdom does not load: its answer is made up here (the figure is real). */
vi.mock('../drawing/diagram/drawDiagram', async () => ({
  ...(await vi.importActual<typeof import('../drawing/diagram/figure')>('../drawing/diagram/figure')),
  DiagramUnavailable: class extends Error {},
  drawDiagram: async () => ({ svg: '<svg xmlns="http://www.w3.org/2000/svg" width="300" height="120"></svg>', width: 300, height: 120, pages: [{ id: 'd', name: 'Page-1' }], page: 'd', missing: [] }),
}))

/**
 * YAZ-5473, DRAWINGS FIRST CLASS: `.excalidraw`, `.drawio.svg` and `.drawio` files are in Search's tree with the Mac's
 * icons and in the Mac's order, typed search finds them by name, Favorites and Recent hold them, and they open on their
 * own (full screen, or in a sheet) with YAZ-5440's drawing code; YAZ-5533: a plain `.drawio` is drawn by draw.io's
 * viewer. Made-up vault only (`drawingVault.ts`).
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
  document.body.replaceChildren()
})

const FILES = { ...READER_FILES, ...DRAWING_FILES, 'plans/deep plan.excalidraw': DRAWING_FILES['garden.excalidraw'], '.yaseendocs/hidden.excalidraw': DRAWING_FILES['garden.excalidraw'] }

async function waitFor(x: Harness, done: () => boolean, ms = 3000): Promise<void> {
  const until = Date.now() + ms
  while (!done()) {
    if (Date.now() > until) throw new Error(`Timed out. Screen: ${x.text()}`)
    await act(async () => void (await new Promise((r) => setTimeout(r, 10))))
  }
}

async function openSearch(files: Record<string, string | Uint8Array> = FILES): Promise<Harness> {
  const phone = await newPhone()
  await seedReaderVault(phone.store, phone.tokens, files)
  const x = await mount({ phone })
  await x.click('Search')
  await waitFor(x, () => x.host.querySelector('.tree') !== null)
  return x
}

/** The tree's top level: each row's name and its icon kind. */
const rows = (x: Harness) => [...x.host.querySelectorAll('.tree .tree__row')].map((r) => `${r.querySelector('.tree__label')?.textContent} [${r.getAttribute('data-kind')}]`)

describe('drawings first class (YAZ-5473)', () => {
  it('names and kinds as the Mac: the file name less its board extension', () => {
    expect(boardKindOf('a/garden.excalidraw')).toBe('drawing')
    expect(boardKindOf('flow.drawio.svg')).toBe('diagram')
    expect(boardKindOf('old plan.drawio')).toBe('diagram')
    expect(boardKindOf('sun.png')).toBeNull()
    expect(boardLabel('garden.excalidraw')).toBe('garden')
    expect(boardLabel('old plan.drawio')).toBe('old plan')
    expect(boardLabel('flow.drawio.svg')).toBe('flow.drawio')
  })

  it('the tree lists the drawing files with the Mac’s icons, in the Mac’s order; a hidden one is not there', async () => {
    h = await openSearch()
    expect(rows(h)).toEqual([
      'cards [folder]',
      'git [folder]',
      'plans [folder]',
      'broken [drawing]',
      'Café notes [markdown]',
      'flow.drawio [diagram]',
      'garden [drawing]',
      'Garden plan [markdown]',
      'old plan [diagram]',
      'Spanish words [markdown]',
      'Trip plan [markdown]',
    ])
    expect(h.button('garden, drawing')).not.toBeNull()
    expect(h.button('old plan, diagram')).not.toBeNull()
    expect(h.text()).not.toContain('hidden')
  })

  it('typed search finds a drawing by its file name, in its folder', async () => {
    h = await openSearch()
    const box = h.host.querySelector<HTMLInputElement>('input[name="search"]')!
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(box, 'deep plan')
      box.dispatchEvent(new Event('input', { bubbles: true }))
    })
    await waitFor(h, () => h!.host.querySelector('.search__found') !== null)
    await waitFor(h, () => h!.button(/^deep plan, drawing$/) !== null)
  })

  it('a drawing opens on its own, full screen, with the drawing code; Back returns; Recent holds it', async () => {
    h = await openSearch()
    await h.click('garden, drawing')
    await waitFor(h, () => h!.host.querySelector('.topbar__title')?.textContent === 'garden')
    await waitFor(h, () => h!.host.querySelector('[data-vault-drawing="garden.excalidraw"], .page-drawing, .page-media--board') !== null)
    let recent: Awaited<ReturnType<typeof readRecent>> = []
    for (let i = 0; i < 50 && recent.length === 0; i++) {
      await h.settle()
      recent = await readRecent(h.store, READER_ID)
    }
    expect(recent[0]).toMatchObject({ path: 'garden.excalidraw' })
    await h.click('Back')
    await waitFor(h, () => h!.host.querySelector('.tree') !== null)
    // Recent lists it with its icon.
    await h.click('Recent')
    await waitFor(h, () => h!.button('garden, drawing') !== null)
  })

  it('YAZ-5533: a plain .drawio is drawn (draw.io\'s viewer), never "Open it on the Mac"; a .drawio.svg shows as a picture', async () => {
    h = await openSearch()
    await h.click('old plan, diagram')
    await waitFor(h, () => h!.host.querySelector('.reader__body .page-drawing--diagram img.page-drawing__img') !== null)
    expect(h.host.querySelector('.page-drawing__img')?.getAttribute('alt')).toBe('Diagram · old plan.drawio')
    expect(h.text()).not.toContain('Open it on the Mac')
    await h.click('Back')
    await waitFor(h, () => h!.host.querySelector('.tree') !== null)
    await h.click('flow.drawio, diagram')
    await waitFor(h, () => h!.host.querySelector('.reader__body .page-media, .reader__body img, .reader__body figure') !== null)
    expect(h.text()).not.toContain('Open it on the Mac')
  })

  it('"explore": a drawing from Search opens full screen (Q4); a link to a drawing in a page opens it in a sheet', async () => {
    h = await openSearch({ ...FILES, '.yaseendocs/link-click.json': '{"click":"explore"}', 'Links.md': '---\ntitle: Links\n---\n\nSee [[garden.excalidraw]].\n' })
    // YAZ-5472 Q4: a tab screen's first open is always a full page.
    await h.click('garden, drawing')
    await waitFor(h, () => h!.button('Back') !== null && h!.host.querySelector('[data-vault-drawing="garden.excalidraw"], .page-drawing, .page-media--board') !== null)
    expect(document.querySelectorAll('.explore-sheet')).toHaveLength(0)
    await h.click('Back')
    await h.click('Links, page')
    await waitFor(h, () => (h!.host.querySelector('.reader__body')?.textContent ?? '').includes('See'))
    expect(document.querySelectorAll('.explore-sheet')).toHaveLength(0)
    const link = [...h.host.querySelectorAll<HTMLElement>('.reader__body a, .reader__body [data-open]')].find((a) => /garden/.test(a.textContent ?? ''))!
    await act(async () => link.click())
    await waitFor(h, () => document.querySelectorAll('.explore-sheet').length === 1)
    const sheet = () => [...document.querySelectorAll('.explore-sheet')].at(-1)!
    await waitFor(h, () => sheet().querySelector('[data-vault-drawing="garden.excalidraw"], .page-drawing, .page-media--board') !== null)
    expect(sheet().querySelector('[role="dialog"]')?.getAttribute('aria-label')).toBe('garden')
    // YAZ-5535: no sticky foot under a drawing's sheet either.
    expect(sheet().querySelector('.explore-sheet__foot')).toBeNull()
    await act(async () => closeAll())
  })

  it('Favorites holds a drawing as the Mac lists it', async () => {
    h = await openSearch({ ...FILES, '.yaseendocs/favorites.json': JSON.stringify({ version: 1, favorites: ['garden.excalidraw', 'Trip plan.md'] }) })
    await h.click('Favorites')
    await waitFor(h, () => h!.host.querySelector('[role="tree"][aria-label="Favorites"]') !== null)
    expect(h.button('garden, drawing')).not.toBeNull()
    expect(h.button('Trip plan, page')).not.toBeNull()
  })
})
