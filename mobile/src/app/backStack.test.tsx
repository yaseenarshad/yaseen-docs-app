// @vitest-environment jsdom
import { act } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { READER_FILES, seedReaderVault } from '../dev/readerVault'
import { closeAll, openSheet, sheetStack } from '../explore/sheets'
import { forgetSearch } from '../search/searchState'
import { mount, newPhone, type Harness } from '../screens/testing'

/**
 * YAZ-5518: Back and the Explore sheets, in the whole app on a made-up vault. ONE stack of overlays (the sheets, the
 * panels, the menus, the full-screen views) sits over the screens: each overlay writes one history entry, so the
 * browser's Back (Safari's own swipe in a tab), the app's Back and the left-edge swipe close the top overlay first, one
 * at a time, and the screen under stays.
 */
let h: Harness | null = null
const restore: (() => void)[] = []
beforeEach(() => {
  URL.createObjectURL = vi.fn(() => 'blob:phone/1')
  URL.revokeObjectURL = vi.fn()
  Object.defineProperty(window, 'innerWidth', { value: 390, configurable: true })
  // A tab that just opened the app: its entry holds nothing of ours.
  history.replaceState(null, '')
})
afterEach(async () => {
  await act(async () => closeAll())
  h?.unmount()
  h = null
  forgetSearch()
  document.body.replaceChildren()
  Object.defineProperty(navigator, 'standalone', { value: undefined, configurable: true })
  for (const undo of restore.splice(0)) undo()
  // Our own steps back (the closes above) land before the next test.
  await new Promise((r) => setTimeout(r, 30))
})

const EXPLORE = { ...READER_FILES, '.yaseendocs/link-click.json': '{"click":"explore"}' }
const DAILY = { '.yaseendocs/daily-pages.json': JSON.stringify({ enabled: true, folder: 'Daily', format: 'YYYY-MM-DD', dayFolder: false }), 'Daily/2026-11-13.md': '# Today words\n' }
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

async function waitFor(x: Harness, done: () => boolean, ms = 4000): Promise<void> {
  const until = Date.now() + ms
  while (!done()) {
    if (Date.now() > until) throw new Error(`Timed out. Screen: ${x.text()} | Sheets: ${sheetStack().length}`)
    await act(async () => void (await sleep(10)))
  }
}
async function open(files: Record<string, string | Uint8Array>, standalone = false): Promise<Harness> {
  Object.defineProperty(navigator, 'standalone', { value: standalone, configurable: true })
  const phone = await newPhone()
  await seedReaderVault(phone.store, phone.tokens, files)
  const x = await mount({ phone })
  await x.settle()
  return x
}
async function toSearch(x: Harness): Promise<void> {
  await x.click('Search')
  await waitFor(x, () => x.host.querySelector('.tree') !== null)
  await x.settle()
}
/** The browser's Back, as Safari's own edge swipe in a tab. */
async function browserBack(): Promise<void> {
  await act(async () => {
    history.back()
    await sleep(60)
  })
}
const sheets = () => [...document.querySelectorAll<HTMLElement>('.explore-sheet')]
const title = (x: Harness) => x.host.querySelector('.topbar__title')?.textContent ?? ''
const onTabs = (x: Harness) => x.button('Back') === null && x.host.querySelector('[role="tab"]') !== null

let stamp = 0
function touch(el: Element, type: string, x: number, y = 300): void {
  const e = new Event(type, { bubbles: true, cancelable: true })
  stamp += 16
  Object.defineProperty(e, 'touches', { value: type === 'touchend' ? [] : [{ clientX: x, clientY: y }] })
  Object.defineProperty(e, 'timeStamp', { value: stamp })
  el.dispatchEvent(e)
}

describe('YAZ-5518 M2: in a Safari tab, Back with a sheet open closes the sheet, not the app', { timeout: 20_000 }, () => {
  it('safariBack_closesSheetOverSearch', async () => {
    h = await open(EXPLORE)
    await toSearch(h)
    const before = history.length
    await h.click(/^Trip plan/)
    await waitFor(h, () => sheets().length === 1)
    await act(async () => openSheet({ kind: 'page', path: 'Spanish words.md' }))
    await waitFor(h, () => sheets().length === 2)
    await act(async () => void (await sleep(20)))
    // One entry for each sheet.
    expect(history.length).toBe(before + 2)
    await browserBack()
    await waitFor(h, () => sheetStack().length === 1)
    await browserBack()
    await waitFor(h, () => sheetStack().length === 0)
    // Still in the app, on Search.
    expect(h.host.querySelector('.tree')).not.toBeNull()
    expect(onTabs(h)).toBe(true)
  })

  it('safariBack_closesSheetOverReview', async () => {
    h = await open(EXPLORE)
    await h.click('Review')
    await act(async () => openSheet({ kind: 'card', path: 'cards/capital-of-spain-demo-40.md', id: 'DEMO-40' }))
    await waitFor(h, () => sheets().length === 1)
    await act(async () => void (await sleep(20)))
    await browserBack()
    await waitFor(h, () => sheetStack().length === 0)
    expect(h.button('Review')?.getAttribute('aria-selected')).toBe('true')
  })

  it('safariBack_closesSheetOverToday', async () => {
    h = await open({ ...EXPLORE, ...DAILY })
    await toSearch(h)
    await waitFor(h, () => h!.host.querySelector('.tabbar__today') !== null)
    await act(async () => h!.host.querySelector<HTMLElement>('.tabbar__today')!.click())
    await waitFor(h, () => sheets().length === 1)
    await act(async () => void (await sleep(20)))
    await browserBack()
    await waitFor(h, () => sheetStack().length === 0)
    expect(h.host.querySelector('.tree')).not.toBeNull()
  })

  it('a sheet closed in the app (a tap on the dim) takes its entry with it: the next Back is the screen under', async () => {
    h = await open(EXPLORE)
    await toSearch(h)
    await h.click(/^Spanish words/)
    await waitFor(h, () => sheets().length === 1)
    await act(async () => void (await sleep(20)))
    const withSheet = history.length
    await act(async () => document.querySelector<HTMLElement>('.explore-dim--top')!.click())
    await waitFor(h, () => sheetStack().length === 0)
    await act(async () => void (await sleep(80)))
    // Its entry is behind us: a new screen replaces it, so no Back lands on a closed sheet.
    await h.click('Settings')
    await waitFor(h, () => h!.button('Back') !== null)
    expect(history.length).toBe(withSheet)
    await browserBack()
    await waitFor(h, () => onTabs(h!))
  })
})

describe('YAZ-5518 M3: the left-edge swipe closes a sheet from the very edge (the Home Screen app)', { timeout: 20_000 }, () => {
  it('sheet_edgeSwipeFromX2_closesSheet', async () => {
    h = await open(EXPLORE, true)
    await toSearch(h)
    await act(async () => openSheet({ kind: 'page', path: 'Trip plan.md' }))
    await waitFor(h, () => sheets().length === 1)
    // The sheet sits 8 px in: a finger at x = 2 lands on the dim beside it.
    const dim = document.querySelector('.explore-dim--top')!
    await act(async () => {
      touch(dim, 'touchstart', 2)
      for (let x = 17; x <= 302; x += 15) touch(dim, 'touchmove', x)
      touch(dim, 'touchend', 302)
    })
    await waitFor(h, () => sheetStack().length === 0)
    expect(h.host.querySelector('.tree')).not.toBeNull()
  })
})

describe('YAZ-5518 S1: Back closes only the top overlay of a page', { timeout: 30_000 }, () => {
  it('historyBack_closesOverlayFirst_tableFullPropertiesHeadingsFind', async () => {
    h = await open(READER_FILES)
    await toSearch(h)
    await h.click(/^Spanish words/)
    await waitFor(h, () => title(h!) === 'Spanish words' && h!.host.querySelector('.reader__body h1') !== null)
    await h.settle()
    const page = async () => {
      await act(async () => void (await sleep(20)))
      await browserBack()
      await h!.settle()
      expect(title(h!)).toBe('Spanish words')
      expect(h!.button('Back')).not.toBeNull()
    }

    // The ⋯ menu.
    await h.click('Page tools')
    await waitFor(h, () => h!.host.querySelector('[role="menu"]') !== null)
    await page()
    expect(h.host.querySelector('[role="menu"]')).toBeNull()

    // Find in page.
    await h.click('Page tools')
    await h.click(/Find in page/)
    await waitFor(h, () => h!.host.querySelector('.find-line') !== null)
    await page()
    expect(h.host.querySelector('.find-line')).toBeNull()

    // Headings.
    await h.click('Page tools')
    await h.click(/Headings/)
    await waitFor(h, () => document.querySelector('[role="dialog"][aria-label="Headings"]') !== null)
    await page()
    expect(document.querySelector('[role="dialog"][aria-label="Headings"]')).toBeNull()

    // The properties panel.
    await h.click('Properties')
    await waitFor(h, () => document.querySelector('[role="dialog"][aria-label="Properties"]') !== null)
    await page()
    expect(document.querySelector('[role="dialog"][aria-label="Properties"]')).toBeNull()

    // A table, full screen.
    await act(async () => h!.host.querySelector<HTMLElement>('[data-table-open]')!.click())
    await waitFor(h, () => document.querySelector('.table-view') !== null)
    await page()
    expect(document.querySelector('.table-view')).toBeNull()

    // Then the page itself.
    await browserBack()
    await waitFor(h, () => onTabs(h!))
  })

  it('the app\'s own Back (the edge swipe, ←) closes the top overlay first, then the page', async () => {
    h = await open(READER_FILES, true)
    await toSearch(h)
    await h.click(/^Spanish words/)
    await waitFor(h, () => title(h!) === 'Spanish words')
    const app = h.host.querySelector('.app')!
    const edge = async () =>
      act(async () => {
        // The finger comes down (a menu shuts on it), then moves right.
        app.dispatchEvent(new Event('pointerdown', { bubbles: true }))
        touch(app, 'touchstart', 5)
        for (let x = 20; x <= 305; x += 15) touch(app, 'touchmove', x)
        touch(app, 'touchend', 305)
        await sleep(260)
      })
    // The ⋯ menu: the touch that shuts it is its Back; the page stays.
    await h.click('Page tools')
    await waitFor(h, () => h!.host.querySelector('[role="menu"]') !== null)
    await edge()
    await act(async () => void (await sleep(80)))
    expect(h.host.querySelector('[role="menu"]')).toBeNull()
    expect(title(h)).toBe('Spanish words')
    await h.click('Properties')
    await waitFor(h, () => document.querySelector('[role="dialog"][aria-label="Properties"]') !== null)
    await edge()
    await waitFor(h, () => document.querySelector('[role="dialog"][aria-label="Properties"]') === null)
    await act(async () => void (await sleep(80)))
    expect(title(h)).toBe('Spanish words')
    // A table full screen is over the frame: the swipe from its edge closes it too.
    await act(async () => h!.host.querySelector<HTMLElement>('[data-table-open]')!.click())
    await waitFor(h, () => document.querySelector('.table-view') !== null)
    const view = document.querySelector('.table-view')!
    await act(async () => {
      touch(view, 'touchstart', 2)
      for (let x = 17; x <= 302; x += 15) touch(view, 'touchmove', x)
      touch(view, 'touchend', 302)
    })
    await waitFor(h, () => document.querySelector('.table-view') === null)
    await act(async () => void (await sleep(80)))
    expect(title(h)).toBe('Spanish words')
    await h.click('Back')
    await waitFor(h, () => onTabs(h!))
  })
})

describe('YAZ-5518 S7: a double tap opens one sheet', { timeout: 20_000 }, () => {
  it('doubleTap_opensOneSheet', async () => {
    h = await open(EXPLORE)
    await toSearch(h)
    const row = h.button(/^Trip plan/)!
    await act(async () => {
      row.click()
      await sleep(120)
      row.click()
    })
    await waitFor(h, () => sheets().length >= 1)
    await act(async () => void (await sleep(50)))
    expect(sheetStack().length).toBe(1)
    // A link in the sheet, tapped twice: one more sheet.
    await waitFor(h, () => [...(sheets().at(-1)?.querySelectorAll<HTMLElement>('a, [data-open]') ?? [])].some((a) => a.textContent?.trim() === 'Spanish words'))
    const link = [...sheets().at(-1)!.querySelectorAll<HTMLElement>('a, [data-open]')].find((a) => a.textContent?.trim() === 'Spanish words')!
    await act(async () => {
      link.click()
      await sleep(120)
      link.click()
    })
    await act(async () => void (await sleep(50)))
    expect(sheetStack().length).toBe(2)
  })
})

describe('YAZ-5518 S8: a link to a heading opens a sheet at that heading', { timeout: 20_000 }, () => {
  it('sheet_headingLink_scrollsToHeading', async () => {
    const parts = Array.from({ length: 40 }, (_, i) => `## Part ${i + 1}\n\nMade-up words of part ${i + 1}.`).join('\n\n')
    h = await open({ ...EXPLORE, 'Long notes.md': `---\ntitle: Long notes\n---\n${parts}\n` })
    await toSearch(h)
    // jsdom draws no layout: "Part 40" sits 4,418 px down a 20,000 px body, as the sweep measured.
    const rect = HTMLElement.prototype.getBoundingClientRect
    HTMLElement.prototype.getBoundingClientRect = function (this: HTMLElement) {
      const top = /^H[1-6]$/.test(this.tagName) && this.textContent?.trim() === 'Part 40' ? 4418 : 0
      return { top, bottom: top + 30, left: 0, right: 390, width: 390, height: 30, x: 0, y: top, toJSON: () => ({}) } as DOMRect
    }
    const sh = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'scrollHeight')
    const ch = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'clientHeight')
    Object.defineProperty(HTMLElement.prototype, 'scrollHeight', { configurable: true, get: () => 20_000 })
    Object.defineProperty(HTMLElement.prototype, 'clientHeight', { configurable: true, get: () => 700 })
    restore.push(() => {
      HTMLElement.prototype.getBoundingClientRect = rect
      if (sh) Object.defineProperty(HTMLElement.prototype, 'scrollHeight', sh)
      if (ch) Object.defineProperty(HTMLElement.prototype, 'clientHeight', ch)
    })
    await act(async () => openSheet({ kind: 'page', path: 'Long notes.md', heading: 'Part 40' }))
    await waitFor(h, () => (sheets().at(-1)?.querySelector('.reader__body')?.textContent ?? '').includes('Part 40'))
    const body = sheets().at(-1)!.querySelector<HTMLElement>('.explore-sheet__body')!
    await waitFor(h, () => body.scrollTop > 0)
    // The heading lands 24 px under the sheet's top, as full screen.
    expect(body.scrollTop).toBe(4418 - 24)
  })
})

describe('YAZ-5518 S9: Today tapped again is one entry', { timeout: 20_000 }, () => {
  it('todayTappedTwice_isOneHistoryEntry', async () => {
    h = await open({ ...READER_FILES, ...DAILY })
    await toSearch(h)
    await waitFor(h, () => h!.host.querySelector('.tabbar__today') !== null)
    for (let i = 0; i < 3; i++) {
      await act(async () => h!.host.querySelector<HTMLElement>('.tabbar__today')!.click())
      await waitFor(h, () => h!.text().includes('Today words'))
      await h.settle()
    }
    // One ← goes back to Search.
    await h.click('Back')
    await waitFor(h, () => onTabs(h!))
    expect(h.host.querySelector('.tree')).not.toBeNull()
  })
})
