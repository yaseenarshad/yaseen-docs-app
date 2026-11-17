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
    // The head (the page's name: it has no folder) and ⋯; no foot (YAZ-5535): "Linked mentions" ends the page.
    expect(topSheet()?.querySelector('.explore-sheet__where')?.textContent).toBe('Trip plan')
    expect(topSheet()?.querySelector('.explore-sheet__foot')).toBeNull()
    // "Spanish words" links to "Trip plan".
    await waitFor(h, () => topSheet()?.querySelector('.linked-mentions__header')?.textContent === 'Linked mentions (1)')

    // A link in the sheet: another sheet on top; the one under stays where it is (YAZ-5540), marked as under.
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

  // YAZ-5540: the sheet under a new one, and the page under the first, stay STILL on an open and on a close: only the
  // top sheet slides. The one under keeps its place (its style never changes); the new one sits a step lower, so the
  // top edge of the one under shows above it.
  it('a sheet opened over another leaves the one under it, and the page under them, exactly where they were', async () => {
    h = await openSearch(READER_FILES)
    await h.click(/^Spanish words/)
    await waitFor(h, () => h!.host.querySelector('.reader__body h1') !== null)
    const screen = h.host.querySelector<HTMLElement>('.screen')!
    const pageStyle = () => [screen.getAttribute('style'), screen.className, document.getElementById('root')?.getAttribute('style') ?? null, document.body.getAttribute('style')].join('|')
    const pageBefore = pageStyle()
    await act(async () => openSheet({ kind: 'page', path: 'Trip plan.md' }))
    await waitFor(h, () => sheets().length === 1)
    await drawn(h, 'Madrid')
    const lower = sheets()[0]
    const style = lower.getAttribute('style')
    expect(pageStyle()).toBe(pageBefore)

    await act(async () => openSheet({ kind: 'card', path: 'cards/capital-of-spain-demo-40.md', id: 'DEMO-40' }))
    await drawn(h, 'On the Manzanares river')
    expect(sheets()[0]).toBe(lower)
    expect(lower.getAttribute('style')).toBe(style)
    expect(lower.style.transform).toBe('')
    expect(lower.style.transition).toBe('')
    expect(pageStyle()).toBe(pageBefore)
    // Seen behind: the new sheet sits one step lower than the one under it.
    const step = (el: HTMLElement) => Number(el.style.getPropertyValue('--sheet-step'))
    expect(step(sheets()[1])).toBe(step(lower) + 1)

    await act(async () => closeTop())
    await waitFor(h, () => sheets().length === 1)
    expect(sheets()[0]).toBe(lower)
    expect(lower.getAttribute('style')).toBe(style)
    expect(pageStyle()).toBe(pageBefore)
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

describe('YAZ-5535: no sticky foot; "Linked mentions" at the end of a panel\'s page, as on the full page', () => {
  const fans = Object.fromEntries(Array.from({ length: 45 }, (_, i) => [`many/Fan ${String(i).padStart(2, '0')}.md`, `---\ntitle: Fan ${String(i).padStart(2, '0')}\n---\n\nBack to [[Trip plan]].\n`]))

  it('panel_linkedMentions_collapsedOpensClosesAndRowsOpenPanels: in the page\'s scroll, never sticky; a row opens a panel on top', async () => {
    h = await openSearch()
    // YAZ-5472 Q4: a Search row opens a full page; a link (here its door) opens the panel.
    await act(async () => openSheet({ kind: 'page', path: 'Trip plan.md' }))
    await waitFor(h, () => sheets().length === 1)
    await drawn(h, 'Madrid, May 3 to 10')
    // No foot of any kind under the body.
    expect(topSheet()?.querySelector('.explore-sheet__foot')).toBeNull()
    expect(topSheet()?.querySelector('.explore-sheet__box')?.lastElementChild?.classList.contains('explore-sheet__body')).toBe(true)
    await waitFor(h, () => topSheet()?.querySelector('.linked-mentions') !== null)
    const section = topSheet()!.querySelector<HTMLElement>('.linked-mentions')!
    // In the page's own column, after its text: it scrolls with the page; not sticky, not fixed.
    expect(section.closest('.explore-sheet__body .reader')).not.toBeNull()
    expect(section.previousElementSibling?.classList.contains('reader__body')).toBe(true)
    expect(['sticky', 'fixed']).not.toContain(getComputedStyle(section).position)
    // Collapsed, with its count.
    const header = section.querySelector<HTMLButtonElement>('.linked-mentions__header')!
    expect(header.textContent).toBe('Linked mentions (1)')
    expect(header.getAttribute('aria-expanded')).toBe('false')
    expect(section.querySelector('.linked-mentions__list')).toBeNull()
    // A tap drops it open in place; another closes it.
    await tap(header)
    expect(header.getAttribute('aria-expanded')).toBe('true')
    await waitFor(h, () => section.querySelectorAll('.linked-mentions__line').length === 1)
    expect([...section.querySelectorAll('.linked-mentions__page')].map((b) => b.textContent)).toEqual(['Spanish words'])
    await tap(header)
    expect(section.querySelector('.linked-mentions__list')).toBeNull()
    // Open again; a row opens through the link door: another panel on top.
    await tap(header)
    await waitFor(h, () => section.querySelector('.linked-mentions__page') !== null)
    await tap(section.querySelector<HTMLElement>('.linked-mentions__page'))
    await waitFor(h, () => sheets().length === 2)
    await drawn(h, 'Words for a trip')
    expect(topSheet()?.querySelector('[role="dialog"]')?.getAttribute('aria-label')).toBe('Spanish words')
    // A line opens the page too.
    await act(async () => closeTop())
    await waitFor(h, () => sheets().length === 1)
    await waitFor(h, () => topSheet()?.querySelector('.linked-mentions__line') !== null)
    await tap(topSheet()!.querySelector<HTMLElement>('.linked-mentions__line'))
    await waitFor(h, () => sheets().length === 2)
    expect(topSheet()?.querySelector('[role="dialog"]')?.getAttribute('aria-label')).toBe('Spanish words')
  })

  it('panel_linkedMentions_pages: 46 linking pages draw 20, then "Show all 46"; closed and opened, 20 again', async () => {
    h = await openSearch({ ...EXPLORE, ...fans })
    // YAZ-5472 Q4: a Search row opens a full page; a link (here its door) opens the panel.
    await act(async () => openSheet({ kind: 'page', path: 'Trip plan.md' }))
    await waitFor(h, () => sheets().length === 1)
    await drawn(h, 'Madrid, May 3 to 10')
    await waitFor(h, () => topSheet()?.querySelector('.linked-mentions__header')?.textContent === 'Linked mentions (46)')
    const header = topSheet()!.querySelector<HTMLButtonElement>('.linked-mentions__header')!
    const entries = () => topSheet()!.querySelectorAll('.linked-mentions__entry').length
    const more = () => topSheet()!.querySelector<HTMLButtonElement>('.linked-mentions__more')
    await tap(header)
    expect(entries()).toBe(20)
    expect(more()?.textContent).toBe('Show all 46')
    await tap(more())
    expect(entries()).toBe(46)
    expect(more()).toBeNull()
    await tap(header)
    await tap(header)
    expect(entries()).toBe(20)
  })

  it('panel_card_noFoot: a card in a panel has no foot either', async () => {
    h = await openSearch()
    await act(async () => openSheet({ kind: 'card', path: 'cards/capital-of-spain-demo-40.md', id: 'DEMO-40' }))
    await waitFor(h, () => sheets().length === 1)
    expect(topSheet()?.querySelector('.explore-sheet__foot')).toBeNull()
  })
})
