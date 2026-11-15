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
