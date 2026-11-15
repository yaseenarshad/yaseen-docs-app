// @vitest-environment jsdom
import { act } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { READER_FILES, READER_ID, seedReaderVault } from '../dev/readerVault'
import { forgetSearch } from '../search/searchState'
import { readRecent } from '../search/recent'
import { mount, newPhone, type Harness } from '../screens/testing'
import { closeAll, closeTop, MAX_MOUNTED, openSheet, sheetStack } from './sheets'

/**
 * YAZ-5472, Explore on the phone, in the whole app on a made-up vault (`readerVault.ts`): a file opens in a sheet over
 * where you are when the vault says "explore"; a link in a sheet opens another on top; a tap on the dim, Escape, a drag
 * down and the left-edge Back close the top one; the screen under them never moves; past `MAX_MOUNTED` sheets the
 * oldest are unmounted and come back at their scroll place.
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
  Object.defineProperty(navigator, 'standalone', { value: undefined, configurable: true })
})

const EXPLORE = { ...READER_FILES, '.yaseendocs/link-click.json': '{"click":"explore"}' }

async function waitFor(x: Harness, done: () => boolean, ms = 3000): Promise<void> {
  const until = Date.now() + ms
  while (!done()) {
    if (Date.now() > until) throw new Error(`Timed out. Screen: ${x.text()} | Sheets: ${sheetsText()}`)
    await act(async () => void (await new Promise((r) => setTimeout(r, 10))))
  }
}

const sheets = () => [...document.querySelectorAll<HTMLElement>('.explore-sheet')]
const topSheet = () => sheets().at(-1) ?? null
const sheetsText = () => sheets().map((s) => s.textContent?.replace(/\s+/g, ' ')).join(' || ')
const inTop = (name: string | RegExp) =>
  [...(topSheet()?.querySelectorAll<HTMLElement>('button, a, [data-open]') ?? [])].find((b) => {
    const said = (b.getAttribute('aria-label') ?? b.textContent ?? '').replace(/\s+/g, ' ').trim()
    return typeof name === 'string' ? said === name : name.test(said)
  }) ?? null
const tap = async (el: HTMLElement | null) => {
  if (el === null) throw new Error(`Nothing to tap. Sheets: ${sheetsText()}`)
  await act(async () => el.click())
}

async function openSearch(files: Record<string, string | Uint8Array> = EXPLORE): Promise<Harness> {
  const phone = await newPhone()
  await seedReaderVault(phone.store, phone.tokens, files)
  const x = await mount({ phone })
  await x.click('Search')
  await waitFor(x, () => x.host.querySelector('.tree') !== null)
  // The vault's choice is read when the vault opens.
  await x.settle()
  return x
}

/** The top sheet's text is drawn. */
const drawn = (x: Harness, words: string) => waitFor(x, () => (topSheet()?.querySelector('.reader__body, .card-view__card')?.textContent ?? '').includes(words))

function touch(el: Element, type: string, x: number, y: number, t: number): Event {
  const e = new Event(type, { bubbles: true, cancelable: true })
  Object.defineProperty(e, 'touches', { value: type === 'touchend' ? [] : [{ clientX: x, clientY: y }] })
  Object.defineProperty(e, 'timeStamp', { value: t })
  el.dispatchEvent(e)
  return e
}

describe('Explore on the phone (YAZ-5472)', () => {
  it('"explore": a Search row opens a FULL PAGE (Q4); a link in it opens a sheet over it; a link in that one another on top; each closes back to where it was', async () => {
    h = await openSearch()
    // YAZ-5472 Q4: a tab screen's first open is always a full page.
    await h.click(/^Spanish words/)
    await waitFor(h, () => h!.host.querySelector('.topbar__title')?.textContent === 'Spanish words' && h!.host.querySelector('.reader__body a, .reader__body [data-open]') !== null)
    expect(sheets()).toEqual([])
    const page = h.host.querySelector('.reader__body')
    const link = [...h.host.querySelectorAll<HTMLElement>('.reader__body a, .reader__body [data-open]')].find((a) => a.textContent?.trim() === 'Trip plan')!
    await tap(link)
    await waitFor(h, () => sheets().length === 1)
    await drawn(h, 'Madrid, May 3 to 10')
    // The page is still there, the same element: nothing under the sheet was replaced.
    expect(h.host.querySelector('.reader__body')).toBe(page)
    expect(h.host.querySelector('.topbar__title')?.textContent).toBe('Spanish words')
    // The head (the page's name: it has no folder), ⋯, and the foot.
    expect(topSheet()?.querySelector('.explore-sheet__where')?.textContent).toBe('Trip plan')
    await waitFor(h, () => /Backlinks? · \d+ References?/.test(topSheet()?.querySelector('.explore-sheet__foot')?.textContent ?? ''))
    // "Spanish words" links to "Trip plan"; "Trip plan" links back to it.
    expect(topSheet()?.querySelector('.explore-sheet__foot')?.textContent).toBe('1 Backlink · 1 Reference')

    // A link in the sheet: another sheet on top; the one under steps back.
    await tap(inTop(/^Spanish words$/))
    await waitFor(h, () => sheets().length === 2)
    await drawn(h, 'Words for a trip')
    expect(sheets()[0].classList.contains('explore-sheet--under')).toBe(true)
    expect(topSheet()?.querySelector('[role="dialog"]')?.getAttribute('aria-label')).toBe('Spanish words')

    // A tap on the dim above it closes the top sheet; Escape the next.
    await tap(document.querySelector<HTMLElement>('.explore-dim--top'))
    await waitFor(h, () => sheets().length === 1)
    expect(sheets()[0].classList.contains('explore-sheet--under')).toBe(false)
    await act(async () => void document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' })))
    await waitFor(h, () => sheets().length === 0)
    expect(h.host.querySelector('.reader__body')).toBe(page)
  })

  it('closing returns to the exact scroll place: the page under the sheets is never remounted', async () => {
    // The vault opens files full screen; a link of the reader (`openLink`, after the merge) still opens a sheet over it.
    h = await openSearch(READER_FILES)
    await h.click(/^Spanish words/)
    await waitFor(h, () => h!.host.querySelector('.reader__body h1') !== null)
    const screen = h.host.querySelector<HTMLElement>('.screen')!
    const body = h.host.querySelector('.reader__body')
    screen.scrollTop = 431
    await act(async () => openSheet({ kind: 'page', path: 'Trip plan.md' }))
    await waitFor(h, () => sheets().length === 1)
    await drawn(h, 'Madrid')
    await act(async () => openSheet({ kind: 'card', path: 'cards/capital-of-spain-demo-40.md', id: 'DEMO-40' }))
    await drawn(h, 'On the Manzanares river')
    await act(async () => closeTop())
    await act(async () => closeTop())
    await waitFor(h, () => sheets().length === 0)
    expect(h.host.querySelector('.screen')).toBe(screen)
    expect(h.host.querySelector('.reader__body')).toBe(body)
    expect(screen.scrollTop).toBe(431)
  })

  it('with no link-click file (the Mac’s default, "open"), a row opens full screen, as before (and as with "explore": Q4)', async () => {
    h = await openSearch(READER_FILES)
    await h.click(/^Trip plan/)
    await waitFor(h, () => h!.host.querySelector('.topbar__title')?.textContent === 'Trip plan')
    expect(sheets()).toEqual([])
  })

  it('a drag down from the body at its top closes the sheet; a scroll does not', async () => {
    h = await openSearch()
    await act(async () => openSheet({ kind: 'page', path: 'Trip plan.md' }))
    await waitFor(h, () => sheets().length === 1)
    await drawn(h, 'Madrid')
    const body = topSheet()!.querySelector('.explore-sheet__body')!
    // Up: the body's own scroll; nothing is claimed, the sheet stays.
    touch(body, 'touchstart', 100, 400, 0)
    for (let i = 1; i <= 10; i++) expect(touch(body, 'touchmove', 100, 400 - i * 10, i * 16).defaultPrevented).toBe(false)
    await act(async () => void touch(body, 'touchend', 100, 300, 200))
    expect(sheets().length).toBe(1)
    // Down at the top, far: closed.
    touch(body, 'touchstart', 100, 100, 1000)
    for (let i = 1; i <= 30; i++) touch(body, 'touchmove', 100, 100 + i * 15, 1000 + i * 16)
    await act(async () => void touch(body, 'touchend', 100, 550, 1500))
    await waitFor(h, () => sheets().length === 0)
  })

  it('the left-edge Back closes the top sheet (the Home Screen app)', async () => {
    Object.defineProperty(navigator, 'standalone', { value: true, configurable: true })
    h = await openSearch()
    await act(async () => openSheet({ kind: 'page', path: 'Trip plan.md' }))
    await act(async () => openSheet({ kind: 'page', path: 'Spanish words.md' }))
    await waitFor(h, () => sheets().length === 2)
    const box = topSheet()!.querySelector('.explore-sheet__box')!
    touch(box, 'touchstart', 5, 300, 0)
    for (let i = 1; i <= 20; i++) touch(box, 'touchmove', 5 + i * 25, 300, i * 16)
    await act(async () => void touch(box, 'touchend', 505, 300, 400))
    await waitFor(h, () => sheets().length === 1)
    expect(topSheet()?.querySelector('[role="dialog"]')?.getAttribute('aria-label')).toBe('Trip plan')
  })

  it('"Open full page" closes the sheets and opens the page full screen; Back returns to Search', async () => {
    h = await openSearch()
    await act(async () => openSheet({ kind: 'page', path: 'Trip plan.md' }))
    await waitFor(h, () => sheets().length === 1)
    await tap(inTop('More'))
    await tap(inTop('Open full page'))
    await waitFor(h, () => h!.host.querySelector('.topbar__title')?.textContent === 'Trip plan')
    expect(sheets()).toEqual([])
    await h.click('Back')
    await waitFor(h, () => h!.host.querySelector('.tree') !== null)
  })

  it('a sheet opened goes to this phone’s Recent', async () => {
    h = await openSearch()
    await act(async () => openSheet({ kind: 'card', path: 'cards/capital-of-spain-demo-40.md', id: 'DEMO-40' }))
    await waitFor(h, () => sheets().length === 1)
    let recent: Awaited<ReturnType<typeof readRecent>> = []
    for (let i = 0; i < 50 && recent.length === 0; i++) {
      await h.settle()
      recent = await readRecent(h.store, READER_ID)
    }
    expect(recent[0]).toMatchObject({ path: 'cards/capital-of-spain-demo-40.md' })
  })

  it(`keeps ${MAX_MOUNTED} sheets drawn; an older one comes back at its scroll place`, async () => {
    h = await openSearch()
    const route = (i: number) => (i % 2 === 0 ? { kind: 'page' as const, path: 'Spanish words.md' } : { kind: 'page' as const, path: 'Trip plan.md' })
    await act(async () => openSheet(route(0)))
    await waitFor(h, () => sheets().length === 1)
    await drawn(h, 'Words for a trip')
    const first = topSheet()!.querySelector<HTMLElement>('.explore-sheet__body')!
    first.scrollTop = 250
    for (let i = 1; i < MAX_MOUNTED + 2; i++) await act(async () => openSheet(route(i)))
    await waitFor(h, () => sheetStack().length === MAX_MOUNTED + 2)
    expect(sheets().length).toBe(MAX_MOUNTED)
    // The two oldest are not drawn; their place is kept.
    expect(sheetStack()[0].scroll).toBe(250)
    await act(async () => closeTop())
    await act(async () => closeTop())
    await waitFor(h, () => sheets().length === MAX_MOUNTED)
    expect(sheetStack().length).toBe(MAX_MOUNTED)
    // The first sheet is drawn again, at its place, once its text is in.
    const back = sheets()[0].querySelector<HTMLElement>('.explore-sheet__body')!
    expect(back).not.toBe(first)
    await waitFor(h, () => (back.querySelector('.reader__body')?.textContent ?? '').includes('Words for a trip'))
    await waitFor(h, () => back.scrollTop === 250)
  })
})
