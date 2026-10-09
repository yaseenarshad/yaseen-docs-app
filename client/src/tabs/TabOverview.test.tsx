/**
 * The tab board (YAZ-2648 D5–D8): every open tab as a page on its folder's island; the first lines
 * of the notes in ONE bridge call; the keyboard, which stays in the filter box; stacks when the
 * board does not fit; and the menus. `api` is mocked so the calls are observable. The pure rules
 * — islands, the stack rule, the arrows' geometry — are `board.test.ts`'s.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import type { FileHead } from '@shared/types'
import { TabOverview, ZOOM_MS, type TabOverviewProps } from './TabOverview'
import { boardHighlight } from './boardHighlight'
import { _resetTabHeads } from './useTabHeads'

vi.mock('../api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../api')>()),
  api: { tree: vi.fn(), readHeads: vi.fn(), shell: { reveal: vi.fn().mockResolvedValue({}), openVsCode: vi.fn().mockResolvedValue({}) } },
}))
import { api } from '../api'
const readHeads = vi.mocked(api.readHeads)

;(globalThis as unknown as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true

let root: Root | null = null
let container: HTMLElement | null = null

const TABS = ['/v/a.md', '/v/Projects/plan.md', '/v/Projects/report.pdf', '/w/x.md', '/v/Projects/Alpha', '/v/Projects/Alpha/2026-10-08.md']
const HEADS: Record<string, string> = {
  '/v/a.md': '# Heading\n\n- [ ] a **task** with [[k3m9|a link]]\n---\n',
  '/w/x.md': 'Plain first line\n',
  // A daily note headed with its own date: the page says the date once.
  '/v/Projects/Alpha/2026-10-08.md': '# 2026-10-08\nStandup at ten\n',
}

async function mount(over: Partial<TabOverviewProps> = {}) {
  const props: TabOverviewProps = { roots: ['/v', '/w'], vaultNames: ['Notes', 'Work'], tabs: TABS, active: '/v/a.md', preview: '/w/x.md', titles: new Map(), onOpen: vi.fn(), onCloseTabs: vi.fn(), onDismiss: vi.fn(), onMoveToRight: vi.fn(), onShowInSidebar: vi.fn(), ...over }
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  await act(async () => root?.render(<TabOverview {...props} />))
  return { el: container, props, again: (next: Partial<TabOverviewProps>) => act(async () => root?.render(<TabOverview {...props} {...next} />)) }
}

const texts = (el: ParentNode, selector: string) => [...el.querySelectorAll(selector)].map((node) => node.textContent)
const current = (el: HTMLElement) => el.querySelector('.taboverview__page--current .taboverview__title')?.textContent
const filter = (el: HTMLElement) => el.querySelector<HTMLInputElement>('.taboverview__filter')!
const page = (el: HTMLElement, path: string) => [...el.querySelectorAll<HTMLElement>('[data-path]')].find((node) => node.dataset.path === path)
const island = (el: HTMLElement, label: string) => el.querySelector<HTMLElement>(`[role="group"][aria-label="${label}"]`)!
const key = (el: HTMLElement, k: string) => act(() => void filter(el).dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true })))
/** A key pressed in the filter box; answers whether the board took it (so the box does not type it). */
const taken = (el: HTMLElement, k: string): boolean => {
  const event = new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true })
  act(() => void filter(el).dispatchEvent(event))
  return event.defaultPrevented
}
const shiftClick = (target: Element | null | undefined) => act(() => void target?.dispatchEvent(new MouseEvent('click', { bubbles: true, shiftKey: true })))
const peek = (el: HTMLElement) => el.querySelector('.taboverview__peek--on .taboverview__title')?.textContent ?? null
const rightClick = (target: Element | null | undefined) => act(() => void target?.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true })))
const menuItems = (el: HTMLElement) => texts(el, '.ctx-menu [role="menuitem"]')
const menuItem = (el: HTMLElement, label: string) => [...el.querySelectorAll<HTMLButtonElement>('.ctx-menu [role="menuitem"]')].find((item) => item.textContent === label)
const type = (el: HTMLElement, value: string) =>
  act(() => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set?.call(filter(el), value)
    filter(el).dispatchEvent(new Event('input', { bubbles: true }))
  })

/** jsdom lays nothing out: give the board's scroller a box, so the stack rule has an area to fit. */
function boardArea(width: number, height: number): () => void {
  const was = [Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'clientWidth'), Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'clientHeight')]
  Object.defineProperty(HTMLElement.prototype, 'clientWidth', { configurable: true, get: () => width })
  Object.defineProperty(HTMLElement.prototype, 'clientHeight', { configurable: true, get: () => height })
  return () => {
    for (const [i, name] of (['clientWidth', 'clientHeight'] as const).entries()) {
      const descriptor = was[i]
      if (descriptor === undefined) delete (HTMLElement.prototype as unknown as Record<string, unknown>)[name]
      else Object.defineProperty(HTMLElement.prototype, name, descriptor)
    }
  }
}

beforeEach(() => {
  _resetTabHeads()
  // A note that could not be read (plan.md) answers null and fails nothing.
  readHeads.mockImplementation(async (paths) => paths.map((path): FileHead | null => (HEADS[path] === undefined ? null : { path, mtime: 1, text: HEADS[path] })))
})

afterEach(() => {
  act(() => root?.unmount())
  root = null
  container?.remove()
  container = null
  vi.clearAllMocks()
  vi.useRealTimers()
})

describe('TabOverview', () => {
  it('a page per tab on the island of its folder, under its vault (D7); the notes read in ONE call (D6): plain first lines on a note, a title alone on anything else', async () => {
    const { el, again } = await mount()
    // Only the notes are asked for, all at once; a folder tab and a PDF have no lines.
    expect(readHeads.mock.calls).toEqual([[['/v/a.md', '/v/Projects/plan.md', '/w/x.md', '/v/Projects/Alpha/2026-10-08.md']]])
    expect(texts(el, '.taboverview__vault-name')).toEqual(['Notes', 'Work'])
    // One island per folder that directly holds a page: the whole path in the vault, then the count. The top level is named by its vault.
    expect(texts(el, '.taboverview__island-head').map((head) => head?.replace('✕', '').trim())).toEqual(['Notes1', 'Projects3', 'Projects / Alpha1', 'Work1'])
    expect(texts(island(el, 'Projects'), '.taboverview__title')).toEqual(['plan', 'report.pdf', 'Alpha'])
    expect(texts(el, '.taboverview__title')).toEqual(['a', 'plan', 'report.pdf', 'Alpha', '2026-10-08', 'x'])
    // The first line that only repeats the title is not said twice.
    expect(texts(el, '.taboverview__lines')).toEqual(['Heading\na task with a link', 'Standup at ten', 'Plain first line'])
    // The active tab's page is marked, the preview tab's title is italic by its class, and the filter box has the keys.
    expect(texts(el, '[aria-current="page"] .taboverview__title')).toEqual(['a'])
    expect(texts(el, '.taboverview__page--preview .taboverview__title')).toEqual(['x'])
    expect(document.activeElement).toBe(filter(el))
    // With no area measured (jsdom) nothing is a stack.
    expect(el.querySelector('.taboverview__stack')).toBeNull()

    // A tab that joins while the board stands asks for itself alone; one that leaves asks nothing.
    await again({ tabs: [...TABS.slice(1), '/w/new.md'] })
    expect(readHeads.mock.calls.slice(1)).toEqual([[['/w/new.md']]])

    // One vault: its name is not said above the islands, and still names its top level.
    await again({ roots: ['/v'], vaultNames: ['Notes'], tabs: ['/v/a.md', '/v/Projects/plan.md'] })
    expect(texts(el, '.taboverview__vault-name')).toEqual([])
    expect(texts(el, '.taboverview__island-leaf')).toEqual(['Notes', 'Projects'])
  })

  it('the keyboard stays in the filter box: typing narrows by title and path, the arrows move the highlight, Enter opens it, Esc goes back; a page ✕ and an island ✕ close tabs and open nothing', async () => {
    const { el, props } = await mount()
    // The highlight starts on the active tab's page.
    expect(current(el)).toBe('a')
    key(el, 'ArrowRight')
    expect(current(el)).toBe('plan')
    key(el, 'ArrowLeft')
    key(el, 'ArrowLeft') // an edge is the end
    expect(current(el)).toBe('a')

    // The folder is part of the path, so it matches the pages under it; the highlight starts on the first.
    type(el, 'proj ALPHA')
    expect(texts(el, '.taboverview__title')).toEqual(['Alpha', '2026-10-08'])
    type(el, 'Projects')
    expect(texts(el, '.taboverview__title')).toEqual(['plan', 'report.pdf', 'Alpha', '2026-10-08'])
    expect(current(el)).toBe('plan')
    key(el, 'ArrowDown') // no layout in jsdom: the pages are one line
    expect(current(el)).toBe('report.pdf')
    key(el, 'Enter')
    expect(props.onOpen).toHaveBeenCalledExactlyOnceWith('/v/Projects/report.pdf')

    act(() => el.querySelector<HTMLButtonElement>('[aria-label="Close plan"]')?.click())
    expect(props.onCloseTabs).toHaveBeenLastCalledWith(['/v/Projects/plan.md'])
    // D: the ✕ on an island's label row closes every tab of that island, in the strip's order.
    act(() => island(el, 'Projects').querySelector<HTMLButtonElement>('.taboverview__island-close')?.click())
    expect(props.onCloseTabs).toHaveBeenLastCalledWith(['/v/Projects/plan.md', '/v/Projects/report.pdf', '/v/Projects/Alpha'])
    expect(props.onOpen).toHaveBeenCalledTimes(1)

    type(el, 'nothing like this')
    expect(el.querySelector('.taboverview__msg')?.textContent).toBe('No open tab matches.')
    key(el, 'Enter')
    expect(props.onOpen).toHaveBeenCalledTimes(1)
    key(el, 'Escape')
    expect(props.onDismiss).toHaveBeenCalledTimes(1)
  })

  it('stacks only when the board does not fit (C): the biggest island becomes a pile, a click spreads it for good, an arrow onto it spreads it, and text in the filter spreads every one', async () => {
    // Room for one line of islands, and too narrow for the three side by side: Projects must give way.
    // It has FOUR pages here, the fewest that can be a pile (`BOARD.stackMin`).
    const tabs = [...TABS.filter((path) => !path.startsWith('/w/')), '/v/Projects/zeta.md']
    const restore = boardArea(600, 300)
    try {
      const { el, props } = await mount({ roots: ['/v'], vaultNames: ['Notes'], tabs, preview: null })
      const stacks = () => [...el.querySelectorAll<HTMLElement>('.taboverview__stack')].map((stack) => stack.dataset.stack)
      expect(stacks()).toEqual(['/v/Projects'])
      // The pile shows its count on the label and one page's face; its pages are not on the board.
      expect(island(el, 'Projects').querySelector('.taboverview__island-count')?.textContent).toBe('4')
      expect(texts(el, '[data-path] .taboverview__title')).toEqual(['a', '2026-10-08'])
      // → from the active page walks onto the pile: it spreads, and the highlight is its first page.
      key(el, 'ArrowRight')
      expect(stacks()).toEqual([])
      expect(current(el)).toBe('plan')
      expect(props.onOpen).not.toHaveBeenCalled()
    } finally {
      restore()
    }
    act(() => root?.unmount())
    container?.remove()

    const restoreTwo = boardArea(600, 300)
    try {
      const { el } = await mount({ roots: ['/v'], vaultNames: ['Notes'], tabs, preview: null })
      const stacks = () => el.querySelectorAll('.taboverview__stack').length
      expect(stacks()).toBe(1)
      type(el, 'a')
      expect(stacks()).toBe(0)
      type(el, '')
      expect(stacks()).toBe(1)
      // A click spreads it, and it stays spread: the board scrolls rather than pile it again.
      act(() => el.querySelector<HTMLButtonElement>('.taboverview__stack')?.click())
      expect(stacks()).toBe(0)
      expect(texts(island(el, 'Projects'), '.taboverview__title')).toEqual(['plan', 'report.pdf', 'Alpha', 'zeta'])
    } finally {
      restoreTwo()
    }
  })

  it('right-click (E): a page opens the tab strip\'s own menu, an island its folder\'s — Show in sidebar, Copy path, Close N tabs — and a menu\'s Esc is not the board\'s', async () => {
    const { el, props } = await mount({ reviewState: (path) => (path === '/v/a.md' ? false : null), onSetReview: vi.fn() })
    rightClick(page(el, '/v/a.md'))
    // `TabMenu`, the one the strip's tabs open: the same items in the same order.
    expect(menuItems(el)).toEqual(['Move to right panel', 'Show in sidebar', 'Copy path', 'Turn review on', 'Reveal in Finder', 'Open in VS Code'])
    key(el, 'Escape')
    expect(el.querySelector('.ctx-menu')).toBeNull()
    expect(props.onDismiss).not.toHaveBeenCalled()
    rightClick(page(el, '/v/a.md'))
    act(() => menuItem(el, 'Move to right panel')?.click())
    expect(props.onMoveToRight).toHaveBeenCalledExactlyOnceWith('/v/a.md')
    expect(el.querySelector('.ctx-menu')).toBeNull()

    rightClick(island(el, 'Projects').querySelector('.taboverview__island-head'))
    expect(menuItems(el)).toEqual(['Show in sidebar', 'Copy path', 'Close 3 tabs'])
    act(() => menuItem(el, 'Show in sidebar')?.click())
    expect(props.onShowInSidebar).toHaveBeenLastCalledWith('/v/Projects')
    rightClick(island(el, 'Projects').querySelector('.taboverview__island-head'))
    act(() => menuItem(el, 'Close 3 tabs')?.click())
    expect(props.onCloseTabs).toHaveBeenLastCalledWith(['/v/Projects/plan.md', '/v/Projects/report.pdf', '/v/Projects/Alpha'])

    // A vault's top level: with two or more vaults its row in the sidebar is the vault's; with one there is no such row, and no item.
    rightClick(island(el, 'Work').querySelector('.taboverview__island-head'))
    expect(menuItems(el)).toEqual(['Show in sidebar', 'Copy path', 'Close 1 tab'])
    act(() => menuItem(el, 'Show in sidebar')?.click())
    expect(props.onShowInSidebar).toHaveBeenLastCalledWith('/w')
    act(() => root?.unmount())
    container?.remove()
    const one = await mount({ roots: ['/v'], vaultNames: ['Notes'], tabs: ['/v/a.md'] })
    rightClick(island(one.el, 'Notes').querySelector('.taboverview__island-head'))
    expect(menuItems(one.el)).toEqual(['Copy path', 'Close 1 tab'])
  })

  it('pick many: shift-click picks and never opens; the bar closes the picked tabs, or the others, and drops the pick; Esc drops the pick before it leaves the board; a plain click still opens', async () => {
    const { el, props, again } = await mount()
    const bar = () => el.querySelector('.taboverview__pick')
    expect(bar()).toBeNull()
    shiftClick(page(el, '/v/a.md'))
    shiftClick(page(el, '/v/Projects/plan.md'))
    shiftClick(page(el, '/w/x.md'))
    shiftClick(page(el, '/w/x.md')) // a second shift-click takes it out again
    expect(props.onOpen).not.toHaveBeenCalled()
    expect(texts(el, '.taboverview__page--picked .taboverview__title')).toEqual(['a', 'plan'])
    expect(texts(el, '.taboverview__pick > *')).toEqual(['2 picked', 'Close them', 'Close the others', 'Clear'])

    // On a picked page, with two or more picked, the menu is the pick's and leads with the plural pair; on any other page it is the tab's.
    rightClick(page(el, '/v/a.md'))
    expect(menuItems(el)).toEqual(['Close 2 tabs', 'Close the others'])
    act(() => menuItem(el, 'Close the others')?.click())
    expect(props.onCloseTabs).toHaveBeenLastCalledWith(['/v/Projects/report.pdf', '/w/x.md', '/v/Projects/Alpha', '/v/Projects/Alpha/2026-10-08.md'])
    expect(bar()).toBeNull()
    rightClick(page(el, '/w/x.md'))
    expect(menuItems(el)[0]).toBe('Move to right panel')
    key(el, 'Escape') // the menu's

    shiftClick(page(el, '/v/a.md'))
    shiftClick(page(el, '/w/x.md'))
    // A picked page that is closed elsewhere leaves the pick.
    await again({ tabs: TABS.filter((path) => path !== '/w/x.md') })
    expect(texts(el, '.taboverview__pick-count')).toEqual(['1 picked'])
    shiftClick(page(el, '/v/Projects/plan.md'))
    act(() => [...el.querySelectorAll<HTMLButtonElement>('.taboverview__pick button')].find((button) => button.textContent === 'Close them')?.click())
    expect(props.onCloseTabs).toHaveBeenLastCalledWith(['/v/a.md', '/v/Projects/plan.md'])
    expect(bar()).toBeNull()

    // Esc: the pick first, the board second.
    shiftClick(page(el, '/v/a.md'))
    key(el, 'Escape')
    expect(bar()).toBeNull()
    expect(props.onDismiss).not.toHaveBeenCalled()
    key(el, 'Escape')
    expect(props.onDismiss).toHaveBeenCalledTimes(1)

    shiftClick(page(el, '/v/a.md'))
    act(() => page(el, '/v/Projects/plan.md')?.click())
    expect(props.onOpen).toHaveBeenCalledExactlyOnceWith('/v/Projects/plan.md')
  })

  it('peek: Space held shows the highlighted page big and lets go of it on release — it opens nothing; while a query is being typed Space is a space, until the highlight is moved', async () => {
    const { el, props } = await mount()
    expect(peek(el)).toBeNull()
    // An empty box: Space is the board's, and peeks at the highlight (the active page to begin with).
    expect(taken(el, ' ')).toBe(true)
    expect(peek(el)).toBe('a')
    expect(el.querySelector('.taboverview__peek--on .taboverview__lines')?.textContent).toBe('Heading\na task with a link')
    // The arrows move the highlight under the peek.
    key(el, 'ArrowRight')
    expect(peek(el)).toBe('plan')
    act(() => void window.dispatchEvent(new KeyboardEvent('keyup', { key: ' ' })))
    expect(peek(el)).toBeNull()

    // A query being typed: Space belongs to the box.
    type(el, 'proj')
    expect(taken(el, ' ')).toBe(false)
    expect(peek(el)).toBeNull()
    // The highlight moved by an arrow, or by the pointer onto another page: Space peeks again.
    key(el, 'ArrowRight')
    expect(taken(el, ' ')).toBe(true)
    expect(peek(el)).toBe('report.pdf')
    act(() => void window.dispatchEvent(new Event('blur')))
    expect(peek(el)).toBeNull()
    type(el, 'proje')
    expect(taken(el, ' ')).toBe(false)
    act(() => void page(el, '/v/Projects/Alpha')?.dispatchEvent(new MouseEvent('mousemove', { bubbles: true })))
    expect(taken(el, ' ')).toBe(true)
    expect(peek(el)).toBe('Alpha')

    expect(props.onOpen).not.toHaveBeenCalled()
    expect(props.onDismiss).not.toHaveBeenCalled()
  })

  it('drag to the side: a dragged page carries the strip\'s own payload, the board\'s right edge shows while it is dragged, and a drop there moves the tab to the right panel', async () => {
    const { el, props, again } = await mount()
    const strip = () => el.querySelector<HTMLElement>('.taboverview__drop')!
    const data = { types: [] as string[], store: {} as Record<string, string>, effectAllowed: '', dropEffect: '', setData(type: string, value: string) { this.types.push(type); this.store[type] = value }, getData(type: string) { return this.store[type] ?? '' } }
    const drag = (target: Element | null | undefined, name: string) => {
      const event = new Event(name, { bubbles: true, cancelable: true })
      Object.defineProperty(event, 'dataTransfer', { value: data })
      act(() => void target?.dispatchEvent(event))
      return event
    }
    expect(strip().className).not.toContain('taboverview__drop--on')
    drag(page(el, '/v/Projects/plan.md'), 'dragstart')
    expect(JSON.parse(data.store['application/x-yaseen-workspace-page'])).toEqual({ path: '/v/Projects/plan.md', owner: 'main' })
    expect(strip().className).toContain('taboverview__drop--on')
    expect(strip().textContent).toBe('Drop here to open it beside your page')
    expect(drag(strip(), 'dragover').defaultPrevented).toBe(true)
    drag(strip(), 'drop')
    expect(props.onMoveToRight).toHaveBeenCalledExactlyOnceWith('/v/Projects/plan.md')
    expect(strip().className).not.toContain('taboverview__drop--on')
    expect(props.onOpen).not.toHaveBeenCalled()

    // Dropped on the right panel itself the page leaves the tabs with no dragend here: the strip goes all the same.
    drag(page(el, '/v/a.md'), 'dragstart')
    expect(strip().className).toContain('taboverview__drop--on')
    await again({ tabs: TABS.filter((path) => path !== '/v/a.md'), active: null })
    expect(strip().className).not.toContain('taboverview__drop--on')
  })

  it('leaving (B): the board zooms out by its own data attribute, and says it left when the zoom is over', async () => {
    vi.useFakeTimers()
    const onLeft = vi.fn()
    const { el, again } = await mount({ onLeft })
    const board = el.querySelector<HTMLElement>('.taboverview')!
    expect(board.dataset.zoom).toBe('in')
    await again({ onLeft, leaving: true })
    expect(board.dataset.zoom).toBe('out')
    expect(onLeft).not.toHaveBeenCalled()
    act(() => void vi.advanceTimersByTime(ZOOM_MS))
    expect(onLeft).toHaveBeenCalledTimes(1)
  })
  it('tells the strip which page it highlights (YAZ-2648): the pointer and the arrows move it, and a board that goes lets go', async () => {
    const { el } = await mount()
    expect(boardHighlight()).toBe('/v/a.md')
    act(() => void page(el, '/v/Projects/Alpha')?.dispatchEvent(new MouseEvent('mousemove', { bubbles: true })))
    expect(boardHighlight()).toBe('/v/Projects/Alpha')
    act(() => root?.unmount())
    expect(boardHighlight()).toBeNull()
  })
})
