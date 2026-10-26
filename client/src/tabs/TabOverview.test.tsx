/**
 * The tab board (YAZ-2648 D5–D8, the canvas of YAZ-3343): every open tab as a card on its folder's group;
 * the first lines of the notes in ONE bridge call; the keyboard, which stays in the filter box; the camera,
 * which renders nothing; a card's drag and drop, in a frame of another window too; "Show all windows"; and
 * the menus. `api` is mocked so the calls are observable, and `storage`'s canvas is a small fake that
 * applies a patch by the shared rule. The pure rules — groups, the layout, the drop rule, the arrows'
 * geometry — are `board.test.ts`'s.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, Profiler } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { applyTabCanvasPatch, type FileHead, type TabCanvasState, type WindowEntry } from '@shared/types'
import { storage } from '../lib/storage'
import { BOARD, withoutTitle } from './board'
import { TabOverview as IdTabOverview, SETTLE_MS, TOOLBAR_INSET, ZOOM_MS, type TabOverviewProps as IdTabOverviewProps } from './TabOverview'
import { boardHighlight } from './boardHighlight'
import { _resetTabHeads, plainLines } from './useTabHeads'
import { HOVER_PREVIEW_DWELL_MS } from '../sidebar/HoverPreviewHost'

vi.mock('../api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../api')>()),
  api: {
    tree: vi.fn(),
    readHeads: vi.fn(),
    shell: { reveal: vi.fn().mockResolvedValue({}), openVsCode: vi.fn().mockResolvedValue({}) },
    window: { focusTab: vi.fn().mockResolvedValue(undefined), closeTabs: vi.fn().mockResolvedValue(undefined), moveTab: vi.fn().mockResolvedValue(undefined), popOutTab: vi.fn().mockResolvedValue(undefined), highlightTab: vi.fn().mockResolvedValue(undefined), tabAction: vi.fn().mockResolvedValue(undefined), showWindow: vi.fn().mockResolvedValue(undefined), hiddenWindows: vi.fn().mockResolvedValue([]), minimizedWindows: vi.fn().mockResolvedValue([]), onMinimizedWindows: vi.fn((l: (ids: string[]) => void) => ((globalThis as unknown as { tellMinimized: (ids: string[]) => void }).tellMinimized = l, () => undefined)), onHiddenWindows: vi.fn((l: (ids: string[]) => void) => ((globalThis as unknown as { tellHidden: (ids: string[]) => void }).tellHidden = l, () => undefined)) },
    boardHead: vi.fn().mockResolvedValue({ mtime: 1 }),
  },
}))
// The sidebar's preview panels (demo feedback: one preview look): stand-ins that say which file they show.
vi.mock('../sidebar/NotePreview', () => ({ default: ({ name }: { name: string }) => <div className="note-preview" aria-label={`Preview of ${name}`} /> }))
vi.mock('../sidebar/BoardPreview', () => ({ default: ({ node }: { node: { path: string } }) => <div className="board-preview" aria-label={`Preview of ${node.path}`} /> }))
import { api } from '../api'
const readHeads = vi.mocked(api.readHeads)

/** The canvas as `storage` holds it (YAZ-3343 D1), for these tests: a patch lands at once, by the shared rule. */
let canvas: TabCanvasState = { allWindows: false, snap: false, cards: [], frames: [] }
let others: WindowEntry[] = []
const names = new Map<string, string>()
const other = (id: string, roots: string[], strip: { path: string; name?: string; active?: true }[]): WindowEntry =>
  ({ id, roots, root: roots[0], file: strip.find((t) => t.active)?.path ?? strip[0]?.path ?? null, tabs: [...new Set(strip.map((t) => t.path))], tabStrip: strip, ...(names.has(id) ? { name: names.get(id) } : {}) }) as unknown as WindowEntry
/** The cache's readers: its own writes wake them, as `storage`'s do. */
const readers = new Set<() => void>()
const wake = () => readers.forEach((l) => l())
function fakeStorage(): void {
  vi.spyOn(storage, 'subscribe').mockImplementation((l) => (readers.add(l), () => void readers.delete(l)))
  vi.spyOn(storage, 'getTabCanvas').mockImplementation(() => canvas)
  vi.spyOn(storage, 'setTabCanvas').mockImplementation((patch) => {
    const next = applyTabCanvasPatch(canvas, patch, new Set(['me', ...others.map((w) => w.id)]))
    if (next === canvas) return
    canvas = next
    wake()
  })
  vi.spyOn(storage, 'getOtherWindows').mockImplementation(() => others)
  vi.spyOn(storage, 'windowName').mockImplementation((id = 'me') => names.get(id))
  vi.spyOn(storage, 'setWindowName').mockImplementation((id, name) => {
    if (name === null) names.delete(id)
    else names.set(id, name)
    wake()
  })
}

;(globalThis as unknown as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true

/** These tests name each page by its path: with no copies, a tab's id here is its path (YAZ-2940 D1). */
type TabOverviewProps = Omit<IdTabOverviewProps, 'tabs'> & { tabs: readonly string[] }
function TabOverview({ tabs, ...props }: TabOverviewProps) {
  return <IdTabOverview tabs={tabs.map((path) => ({ id: path, path }))} {...props} />
}

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
  const props: TabOverviewProps = { roots: ['/v', '/w'], vaultNames: ['Notes', 'Work'], tabs: TABS, active: '/v/a.md', preview: '/w/x.md', titles: new Map(), windowId: 'me', onOpen: vi.fn(), onCloseTabs: vi.fn(), onDismiss: vi.fn(), onMoveToRight: vi.fn(), onShowInSidebar: vi.fn(), onDropToWindow: vi.fn(), onMoveTab: vi.fn(), onMoveToNewWindowQuietly: vi.fn(), ...over }
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  /** Every commit of the board's tree (YAZ-3343 D4): a pan, a zoom and a drag must make none. */
  const commits = { n: 0 }
  const draw = (p: TabOverviewProps) => (
    <Profiler id="board" onRender={() => void commits.n++}>
      <TabOverview {...p} />
    </Profiler>
  )
  await act(async () => root?.render(draw(props)))
  return { el: container, props, commits, again: (next: Partial<TabOverviewProps>) => act(async () => root?.render(draw({ ...props, ...next }))) }
}

const texts = (el: ParentNode, selector: string) => [...el.querySelectorAll(selector)].map((node) => node.textContent)
const current = (el: HTMLElement) => el.querySelector('.taboverview__page--current .taboverview__title')?.textContent
const filter = (el: HTMLElement) => el.querySelector<HTMLInputElement>('.taboverview__filter')!
const page = (el: HTMLElement, path: string) => [...el.querySelectorAll<HTMLElement>('[data-tab]')].find((node) => node.dataset.tab === path)
const island = (el: HTMLElement, label: string) => el.querySelector<HTMLElement>(`[role="group"][aria-label="${label}"]`)!
const key = (el: HTMLElement, k: string) => act(() => void filter(el).dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true })))
/** A key pressed in the filter box; answers whether the board took it (so the box does not type it). */
const taken = (el: HTMLElement, k: string): boolean => {
  const event = new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true })
  act(() => void filter(el).dispatchEvent(event))
  return event.defaultPrevented
}
const shiftClick = (target: Element | null | undefined) => act(() => void target?.dispatchEvent(new MouseEvent('click', { bubbles: true, shiftKey: true })))
/** The preview panel on show (Space, or a rest of the pointer): which file it says, or null. */
const peek = (_el?: HTMLElement) => document.querySelector('.note-preview, .board-preview')?.getAttribute('aria-label')?.replace('Preview of ', '') ?? null
const settled = () => act(async () => {})
const SCOPE = () => ({ root: '/v', wikilinks: {} as never, textVars: {} })
const rightClick = (target: Element | null | undefined) => act(() => void target?.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true })))
const menuItems = (el: HTMLElement) => texts(el, '.ctx-menu [role="menuitem"]')
const menuItem = (el: HTMLElement, label: string) => [...el.querySelectorAll<HTMLButtonElement>('.ctx-menu [role="menuitem"]')].find((item) => item.textContent === label)
const type = (el: HTMLElement, value: string) =>
  act(() => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set?.call(filter(el), value)
    filter(el).dispatchEvent(new Event('input', { bubbles: true }))
  })

/** A pointer event (D7, D12): jsdom's PointerEvent where it has one, else a mouse event that says its pointer. */
function pointer(target: EventTarget | null | undefined, type: string, x: number, y: number, extra: Record<string, unknown> = {}): void {
  const init = { bubbles: true, cancelable: true, clientX: x, clientY: y, button: 0, pointerId: 1, ...extra }
  const event = typeof PointerEvent === 'function' ? new PointerEvent(type, init) : Object.assign(new MouseEvent(type, init), { pointerId: 1 })
  act(() => void target?.dispatchEvent(event))
}
const world = (el: HTMLElement) => el.querySelector<HTMLElement>('.taboverview__world')!
/** A card's place in the world: inside its group's box in the folder layout, straight on the world in a window frame. */
const placeOf = (card: HTMLElement): number[] => {
  const group = card.closest<HTMLElement>('[role="group"]')
  return [Number.parseFloat(card.style.left) + (group === null ? 0 : Number.parseFloat(group.style.left)), Number.parseFloat(card.style.top) + (group === null ? 0 : Number.parseFloat(group.style.top))]
}
const body = (el: HTMLElement) => el.querySelector<HTMLElement>('.taboverview__body')!
const frame = (el: HTMLElement, win: string) => el.querySelector<HTMLElement>(`.taboverview__frame[data-win="${win}"]`)!
/** Drag a card from its corner to the client point (x, y), as the pointer does: down, moves past the slop, up. */
function dragTo(card: Element | null | undefined, x: number, y: number): void {
  pointer(card, 'pointerdown', 0, 0)
  pointer(window, 'pointermove', 2, 1)
  pointer(window, 'pointermove', x / 2, y / 2)
  pointer(window, 'pointermove', x, y)
  pointer(window, 'pointerup', x, y)
}

/** jsdom lays nothing out: give the board's viewport a box, so the camera has a screen to fit. */
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
  canvas = { allWindows: false, snap: false, cards: [], frames: [] }
  others = []
  readers.clear()
  names.clear()
  fakeStorage()
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
  it('YAZ-2648 S33 to S35, S53, S54, S57, S58: a page per tab on the island of its folder, under its vault; the notes read in ONE call: plain first lines on a note, a title alone on anything else', async () => {
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

    // A tab that joins while the board stands asks for itself alone; one that leaves asks nothing.
    await again({ tabs: [...TABS.slice(1), '/w/new.md'] })
    expect(readHeads.mock.calls.slice(1)).toEqual([[['/w/new.md']]])

    // One vault: its name is not said above the islands, and still names its top level.
    await again({ roots: ['/v'], vaultNames: ['Notes'], tabs: ['/v/a.md', '/v/Projects/plan.md'] })
    expect(texts(el, '.taboverview__vault-name')).toEqual([])
    expect(texts(el, '.taboverview__island-leaf')).toEqual(['Notes', 'Projects'])
  })

  it('YAZ-3044 A37: a drawing or diagram page names its kind under its title, and is never asked for lines', async () => {
    const { el } = await mount({ roots: ['/v'], vaultNames: ['Notes'], tabs: ['/v/a.md', '/v/Flow.excalidraw', '/v/Map.drawio'] })
    expect(readHeads.mock.calls).toEqual([[['/v/a.md']]])
    expect(texts(el, '.taboverview__lines')).toEqual(['Heading\na task with a link', 'Excalidraw drawing', 'draw.io diagram'])
  })

  it('YAZ-2648 S40, S41, S43: the keyboard stays in the filter box: typing narrows by title and path, the arrows move the highlight, Enter opens it, Esc goes back; a page ✕ and an island ✕ close tabs and open nothing', async () => {
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

    // Two clicks (demo feedback): the first arms a red "Close", the second closes.
    act(() => el.querySelector<HTMLButtonElement>('[aria-label="Close plan"]')?.click())
    expect([el.querySelector('[aria-label="Close plan"]')?.textContent, vi.mocked(props.onCloseTabs).mock.calls.length]).toEqual(['Close', 0])
    act(() => el.querySelector<HTMLButtonElement>('[aria-label="Close plan"]')?.click())
    expect(props.onCloseTabs).toHaveBeenLastCalledWith(['/v/Projects/plan.md'])
    // The ✕ on an island's label row closes every tab of that island, in the strip's order, in ONE call — two clicks too.
    act(() => island(el, 'Projects').querySelector<HTMLButtonElement>('.taboverview__island-close')?.click())
    expect(island(el, 'Projects').querySelector('.taboverview__island-close')?.textContent).toBe('Close 3')
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

  it('YAZ-3343 S1 to S4, D4, D7, D24: the camera — on open it FITS the board with room round it; the buttons zoom about the middle within 0.2 to 2; "Fit all tabs" fits the same; a pan, a pinch and ⌘-scroll render nothing', async () => {
    vi.useFakeTimers()
    const restore = boardArea(1000, 600)
    try {
      const { el, commits, again } = await mount()
      const camOf = () => (/translate\(([-\d.e]+)px, ([-\d.e]+)px\) scale\(([\d.e]+)\)/.exec(world(el).style.transform) ?? []).slice(1).map(Number)
      const [x0, y0, z0] = camOf()
      // These two vaults are taller than 600 px: the fit zooms out, never under 25%, and keeps every card on screen.
      expect(z0).toBeLessThan(1)
      expect(z0).toBeGreaterThanOrEqual(0.25)
      for (const card of el.querySelectorAll<HTMLElement>('.taboverview__page')) {
        const [cx, cy] = placeOf(card)
        expect(x0 + cx * z0).toBeGreaterThanOrEqual(0)
        expect(y0 + cy * z0).toBeGreaterThanOrEqual(0)
        expect(x0 + (cx + BOARD.pageW) * z0).toBeLessThanOrEqual(1000)
        // The toolbar has the bottom row: no card under it at the fit.
        expect(y0 + (cy + BOARD.pageH) * z0).toBeLessThanOrEqual(600 - TOOLBAR_INSET)
      }
      // ONE toolbar bottom left (demo feedback): the switch, Tidy up, then the camera's controls.
      expect([...el.querySelectorAll('.taboverview__zoom button, .taboverview__zoom [role="switch"]')].map((b) => b.getAttribute('aria-label') ?? b.textContent)).toEqual(['Show all windows', 'Tidy up', 'Zoom out', 'Reset zoom', 'Zoom in', 'Fit all tabs', 'Snap to grid'])
      expect(el.querySelector('.taboverview__top [role="switch"]')).toBeNull()
      const cards = el.querySelectorAll('.taboverview__page').length
      commits.n = 0

      // A two-finger scroll pans; a drag on empty canvas pans; a pinch (ctrl) and ⌘-scroll zoom about the pointer.
      act(() => void body(el).dispatchEvent(new WheelEvent('wheel', { deltaX: 30, deltaY: 40, bubbles: true, cancelable: true })))
      expect(camOf()).toEqual([x0 - 30, y0 - 40, z0])
      pointer(body(el), 'pointerdown', 500, 300)
      for (let i = 1; i <= 10; i++) pointer(window, 'pointermove', 500 + i * 10, 300 + i * 5)
      pointer(window, 'pointerup', 600, 350)
      expect(camOf()).toEqual([x0 - 30 + 100, y0 - 40 + 50, z0])
      act(() => void body(el).dispatchEvent(new WheelEvent('wheel', { deltaY: -50, ctrlKey: true, clientX: 0, clientY: 0, bubbles: true, cancelable: true })))
      act(() => void body(el).dispatchEvent(new WheelEvent('wheel', { deltaY: 50, metaKey: true, clientX: 0, clientY: 0, bubbles: true, cancelable: true })))
      expect(camOf()[2]).toBeCloseTo(z0)
      act(() => void vi.advanceTimersByTime(SETTLE_MS * 2))
      // Not one render of the board — so not one of a card — for all of it.
      expect(commits.n).toBe(0)
      expect(el.querySelectorAll('.taboverview__page').length).toBe(cards)

      const zoomOf = () => Number(/scale\(([\d.]+)\)/.exec(world(el).style.transform)?.[1])
      const zoomIn = el.querySelector<HTMLButtonElement>('[aria-label="Zoom in"]')!
      for (let i = 0; i < 6; i++) act(() => zoomIn.click())
      expect(zoomOf()).toBe(BOARD.maxZoom)
      // The pill says the zoom, written by the camera; its percent goes back to 100%.
      const percent = el.querySelector<HTMLButtonElement>('[aria-label="Reset zoom"]')!
      expect(percent.textContent).toBe('200%')
      act(() => percent.click())
      expect([zoomOf(), percent.textContent]).toEqual([1, '100%'])
      for (let i = 0; i < 20; i++) act(() => el.querySelector<HTMLButtonElement>('[aria-label="Zoom out"]')!.click())
      expect(zoomOf()).toBe(BOARD.minZoom)
      // Fit: the same fit as the open.
      act(() => el.querySelector<HTMLButtonElement>('[aria-label="Fit all tabs"]')!.click())
      expect(zoomOf()).toBeCloseTo(z0)
      expect(commits.n).toBe(0)
      await again({ roots: ['/v'], vaultNames: ['Notes'], tabs: ['/v/a.md'] })
      act(() => el.querySelector<HTMLButtonElement>('[aria-label="Fit all tabs"]')!.click())
      expect(zoomOf()).toBe(1)
    } finally {
      restore()
    }
  })

  it('YAZ-3343 S13, S19, D12: a drag moves the card — it follows the pointer by its own transform with no render, and the drop is ONE render and ONE stored place; a press with no move is a click', async () => {
    // One group, so a drop anywhere keeps it clear of the others (the no-overlap rule has its own tests).
    const { el, props, commits } = await mount({ roots: ['/v', '/w'], vaultNames: ['Notes', 'Work'], tabs: ['/v/a.md', '/v/b.md'] })
    const card = page(el, '/v/a.md')!
    // Two vaults: Notes' name row, then its group's label row and padding.
    const home = { left: BOARD.islandPad, top: BOARD.islandPad + BOARD.labelH }
    expect([card.style.left, card.style.top]).toEqual([`${home.left}px`, `${home.top}px`])
    commits.n = 0
    pointer(card, 'pointerdown', 0, 0)
    pointer(window, 'pointermove', 2, 2)
    expect(card.dataset.lifted).toBeUndefined() // inside the slop: still a press
    pointer(window, 'pointermove', 60, 20)
    pointer(window, 'pointermove', 100, 50)
    expect(card.dataset.lifted).toBe('')
    expect(card.style.transform).toBe('translate(100px, 50px)')
    expect(commits.n).toBe(0)
    pointer(window, 'pointerup', 100, 50)
    expect(commits.n).toBe(1)
    expect(storage.setTabCanvas).toHaveBeenCalledExactlyOnceWith({ set: [{ win: 'me', path: '/v/a.md', copy: 0, by: 'folder', x: home.left + 100, y: BOARD.vaultH + home.top + 50 }] })
    expect(card.style.transform).toBe('')
    expect(card.dataset.lifted).toBeUndefined()
    // The card stands where it was dropped; its group takes it in (the group's box starts where its card is, less the padding and the label).
    const group = island(el, 'Notes')
    expect([Number.parseFloat(group.style.left) + Number.parseFloat(card.style.left), Number.parseFloat(group.style.top) + Number.parseFloat(card.style.top)]).toEqual([home.left + 100, BOARD.vaultH + home.top + 50])
    // The click that follows a drop opens nothing; a press with no move is a click.
    act(() => card.click())
    expect(props.onOpen).not.toHaveBeenCalled()
    await act(async () => new Promise((done) => setTimeout(done, 0)))
    pointer(card, 'pointerdown', 0, 0)
    pointer(window, 'pointerup', 0, 0)
    act(() => card.click())
    expect(props.onOpen).toHaveBeenCalledExactlyOnceWith('/v/a.md')
    // No drop area, no HTML5 drag: the right panel is the menu's ("Move to ▸ Right panel").
    expect(el.querySelector('.taboverview__drop')).toBeNull()
    expect(card.getAttribute('draggable')).toBeNull()
  })

  it('YAZ-3343 S14, S15, S25, D26, "Snap to grid" (the cards only): a drop goes to the nearest FREE cell of its frame\'s own grid; a frame drags FREELY, and a card dropped in it after still lines up with its neighbours; the toggle stores it; off, the drop stays free', async () => {
    canvas = { allWindows: true, snap: true, cards: [], frames: [] }
    others = [other('w2', ['/w'], [{ path: '/w/y.md', active: true }, { path: '/w/z.md' }])]
    const { el } = await mount()
    const toggle = el.querySelector<HTMLButtonElement>('[aria-label="Snap to grid"]')!
    expect(toggle.getAttribute('aria-pressed')).toBe('true')
    const a = page(el, '/v/a.md')!
    const [ax, ay] = placeOf(a)
    // Dropped onto its neighbour's cell (plan.md is the next slot), a little off: the nearest FREE cell instead.
    dragTo(a, BOARD.pageW + BOARD.pageGap + 20, 15)
    const put = vi.mocked(storage.setTabCanvas).mock.calls[0][0].set![0]
    expect([Math.abs((put.x - BOARD.framePad) % (BOARD.pageW + BOARD.pageGap)), Math.abs((put.y - BOARD.frameLabelH - BOARD.framePad) % (BOARD.pageH + BOARD.pageGap))]).toEqual([0, 0])
    expect([put.x, put.y]).not.toEqual(placeOf(page(el, '/v/Projects/plan.md')!))
    expect([put.x, put.y]).not.toEqual([ax, ay])
    // A frame drags freely — by a non-cell amount, with Snap on.
    vi.mocked(storage.setTabCanvas).mockClear()
    const y = page(el, 'w2\n/w/y.md\n0')!
    const [yx, yy] = placeOf(y)
    pointer(frame(el, 'w2').querySelector('.taboverview__frame-label'), 'pointerdown', 0, 0)
    pointer(window, 'pointermove', 100, 30)
    pointer(window, 'pointermove', 137, 59)
    pointer(window, 'pointerup', 137, 59)
    expect(vi.mocked(storage.setTabCanvas).mock.calls[0][0].set![0]).toMatchObject({ x: yx + 137, y: yy + 59 })
    // Then a card dropped in it, a little off: on the frame's own grid — in line with its neighbour, in a free cell.
    const z = page(el, 'w2\n/w/z.md\n0')!
    dragTo(z, 25, BOARD.pageH + BOARD.pageGap - 20)
    const [ny, nz] = [placeOf(page(el, 'w2\n/w/y.md\n0')!), placeOf(page(el, 'w2\n/w/z.md\n0')!)]
    expect([Math.abs((nz[0] - ny[0]) % (BOARD.pageW + BOARD.pageGap)), Math.abs((nz[1] - ny[1]) % (BOARD.pageH + BOARD.pageGap))]).toEqual([0, 0])
    expect(nz).not.toEqual(ny)
    // Off: one write of the switch, and a drop stays where it was let go.
    act(() => toggle.click())
    expect(storage.setTabCanvas).toHaveBeenLastCalledWith({ snap: false })
    expect(toggle.getAttribute('aria-pressed')).toBe('false')
    const x = page(el, '/w/x.md')!
    const [xx, xy] = placeOf(x)
    dragTo(x, 37, 23)
    expect(vi.mocked(storage.setTabCanvas).mock.calls.at(-1)![0].set![0]).toMatchObject({ x: xx + 37, y: xy + 23 })
  })

  it('YAZ-3343 S41, D26: with Snap on, a card dropped on ANOTHER window\'s card arrives in the nearest FREE cell of THAT frame\'s grid, as the next copy of its path there', async () => {
    canvas = { allWindows: true, snap: true, cards: [], frames: [] }
    others = [other('w2', ['/w'], [{ path: '/w/y.md', active: true }, { path: '/w/x.md' }])]
    const onDropToWindow = vi.fn()
    const { el } = await mount({ onDropToWindow })
    const y = page(el, 'w2\n/w/y.md\n0')!
    const [yx, yy] = placeOf(y)
    const x = page(el, '/w/x.md')!
    const [xx, xy] = placeOf(x)
    // Grabbed in its middle, let go right on y's card (a few px off): the pointer is inside w2's frame.
    const grab = { x: BOARD.padX + xx + 50, y: BOARD.padTop + xy + 30 }
    pointer(x, 'pointerdown', grab.x, grab.y)
    pointer(window, 'pointermove', grab.x + 10, grab.y + 10)
    const end = { x: grab.x + (yx - xx) + 6, y: grab.y + (yy - xy) + 4 }
    pointer(window, 'pointermove', end.x, end.y)
    pointer(window, 'pointerup', end.x, end.y)
    expect(onDropToWindow).toHaveBeenCalledExactlyOnceWith('w2', '/w/x.md', '/w/x.md')
    // The arrival is the write's last card (w2 was frozen first).
    const put = vi.mocked(storage.setTabCanvas).mock.calls[0][0].set!.at(-1)!
    // The next copy of x there (w2 has one x already), on w2's own grid, in no cell its cards hold.
    expect(put).toMatchObject({ win: 'w2', path: '/w/x.md', copy: 1, by: 'window' })
    const cell = (p: number[]) => `${Math.round((p[0] - yx) / (BOARD.pageW + BOARD.pageGap))},${Math.round((p[1] - yy) / (BOARD.pageH + BOARD.pageGap))}`
    expect([Math.abs((put.x - yx) % (BOARD.pageW + BOARD.pageGap)), Math.abs((put.y - yy) % (BOARD.pageH + BOARD.pageGap))]).toEqual([0, 0])
    const held = [placeOf(y), placeOf(page(el, 'w2\n/w/x.md\n0')!)].map(cell)
    expect(held).not.toContain(cell([put.x, put.y]))
  })

  it('YAZ-3343 S38, D37: "Move to new window" on a card is QUIET from the board — this window\'s by its quiet door, another\'s by asking that window; the new window\'s frame stands right of its source\'s', async () => {
    canvas = { allWindows: true, snap: false, cards: [], frames: [] }
    others = [other('w2', ['/w'], [{ path: '/w/y.md', active: true }, { path: '/w/z.md' }])]
    const onMoveToNewWindowQuietly = vi.fn()
    const { el, again } = await mount({ onMoveToNewWindowQuietly })
    rightClick(page(el, '/v/a.md'))
    act(() => menuItem(el, 'Move to new window')?.click())
    expect(onMoveToNewWindowQuietly).toHaveBeenCalledExactlyOnceWith('/v/a.md', '/v/a.md')
    rightClick(page(el, 'w2\n/w/z.md\n0'))
    act(() => menuItem(el, 'Move to new window')?.click())
    expect(api.window.popOutTab).toHaveBeenCalledExactlyOnceWith('w2', { path: '/w/z.md', copy: 0 })
    // The new window shows up in the state with the tab: its frame stands right of w2's.
    others = [other('w2', ['/w'], [{ path: '/w/y.md', active: true }]), other('w5', ['/w'], [{ path: '/w/z.md', active: true }])]
    await again({})
    await again({})
    const w2 = frame(el, 'w2')
    const right = Number.parseFloat(w2.style.left) + Number.parseFloat(w2.style.width) + BOARD.frameGap
    expect([frame(el, 'w5').style.left, frame(el, 'w5').style.top]).toEqual([`${right}px`, w2.style.top])
  })

  it('YAZ-3343 S28, S54, D23: a window the board made stays HIDDEN — its frame says so, and "Show window" in its menu shows it', async () => {
    canvas = { allWindows: true, snap: false, cards: [], frames: [] }
    others = [other('w2', ['/w'], [{ path: '/w/y.md', active: true }])]
    const { el } = await mount()
    // Main's push: w2 is one of the board's hidden windows.
    const tell = (globalThis as unknown as { tellHidden: (ids: string[]) => void }).tellHidden
    act(() => tell(['w2']))
    expect(frame(el, 'w2').querySelector('.taboverview__frame-hidden')?.textContent).toBe('Hidden')
    expect(frame(el, 'me').querySelector('.taboverview__frame-hidden')).toBeNull()
    act(() => void frame(el, 'w2').dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true })))
    expect(menuItems(el)[0]).toBe('Show window')
    act(() => menuItem(el, 'Show window')?.click())
    expect(api.window.showWindow).toHaveBeenCalledExactlyOnceWith('w2')
    act(() => void frame(el, 'me').dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true })))
    expect(menuItems(el)).not.toContain('Show window')
    act(() => tell([]))
  })

  it('YAZ-3343 S12, S29, D33: the highlight on ANOTHER window\'s card lights that tab there — once per change, and put out when it leaves; every window\'s active card wears the active look', async () => {
    canvas = { allWindows: true, snap: false, cards: [], frames: [] }
    others = [other('w2', ['/w'], [{ path: '/w/y.md' }, { path: '/w/z.md', active: true }])]
    const { el } = await mount()
    expect([...el.querySelectorAll<HTMLElement>('.taboverview__page--active')].map((c) => c.dataset.tab)).toEqual(['/v/a.md', 'w2\n/w/z.md\n0'])
    const hover = (id: string) => act(() => void page(el, id)!.dispatchEvent(new MouseEvent('mousemove', { bubbles: true })))
    hover('w2\n/w/y.md\n0')
    hover('w2\n/w/y.md\n0')
    expect(vi.mocked(api.window.highlightTab).mock.calls).toEqual([['w2', { path: '/w/y.md', copy: 0 }]])
    hover('w2\n/w/z.md\n0')
    expect(api.window.highlightTab).toHaveBeenLastCalledWith('w2', { path: '/w/z.md', copy: 0 })
    hover('/v/a.md')
    expect(api.window.highlightTab).toHaveBeenLastCalledWith('w2', null)
    expect(api.window.highlightTab).toHaveBeenCalledTimes(3)
    hover('w2\n/w/y.md\n0')
    act(() => root?.unmount())
    root = null
    expect(api.window.highlightTab).toHaveBeenLastCalledWith('w2', null)
  })

  it('YAZ-3343 S18, S26, D28, no overlap: a FRAME dropped on another takes the nearest free spot (the other stays); a CARD whose frame would grow into another goes to the nearest spot that keeps it clear', async () => {
    canvas = { allWindows: true, snap: false, cards: [], frames: [] }
    others = [other('w2', ['/w'], [{ path: '/w/y.md', active: true }])]
    const { el } = await mount({ roots: ['/v'], vaultNames: ['Notes'], tabs: ['/v/a.md', '/v/b.md'] })
    const boxOf = (win: string) => {
      const f = frame(el, win)
      return { x: Number.parseFloat(f.style.left), y: Number.parseFloat(f.style.top) - BOARD.frameLabelH, w: Number.parseFloat(f.style.width), h: Number.parseFloat(f.style.height) + BOARD.frameLabelH }
    }
    const apart = (a: ReturnType<typeof boxOf>, b: ReturnType<typeof boxOf>) => a.x + a.w + BOARD.apart <= b.x || b.x + b.w + BOARD.apart <= a.x || a.y + a.h + BOARD.apart <= b.y || b.y + b.h + BOARD.apart <= a.y
    const me0 = boxOf('me')
    const w20 = boxOf('w2')
    // A card of mine let go in the gap right next to w2: my frame would reach it, so the card stops short.
    const a = page(el, '/v/a.md')!
    const [ax] = placeOf(a)
    dragTo(a, w20.x - ax - 10, 0)
    expect(apart(boxOf('me'), boxOf('w2'))).toBe(true)
    expect(boxOf('w2')).toEqual(w20)
    // w2's frame dropped right on mine: it gives way, mine stays.
    const meNow = boxOf('me')
    const label = frame(el, 'w2').querySelector('.taboverview__frame-label')
    pointer(label, 'pointerdown', 0, 0)
    pointer(window, 'pointermove', -100, 0)
    pointer(window, 'pointermove', me0.x - w20.x + 30, 20)
    pointer(window, 'pointerup', me0.x - w20.x + 30, 20)
    expect(boxOf('me')).toEqual(meNow)
    expect(apart(boxOf('me'), boxOf('w2'))).toBe(true)
  })

  it('YAZ-3343 S27, D16: an EMPTY frame drags freely and its place is stored; the first card that arrives takes its first cell there', async () => {
    canvas = { allWindows: true, snap: false, cards: [], frames: [] }
    others = [other('w2', ['/w'], [{ path: '/w/y.md', active: true }]), other('w3', ['/w'], [])]
    const moveTo = vi.fn().mockResolvedValue(undefined)
    ;(api.window as unknown as Record<string, unknown>).moveTo = moveTo
    const { el, again } = await mount()
    const at = () => [Number.parseFloat(frame(el, 'w3').style.left), Number.parseFloat(frame(el, 'w3').style.top)]
    const [x0, y0] = at()
    pointer(frame(el, 'w3').querySelector('.taboverview__frame-label'), 'pointerdown', 0, 0)
    pointer(window, 'pointermove', 300, 400)
    pointer(window, 'pointermove', 600, 900)
    pointer(window, 'pointerup', 600, 900)
    expect(storage.setTabCanvas).toHaveBeenCalledExactlyOnceWith({ setFrames: [{ win: 'w3', x: x0 + 600, y: y0 - BOARD.frameLabelH + 900 }] })
    expect(at()).toEqual([x0 + 600, y0 + 900])
    // It stays there through a new board.
    act(() => root?.unmount())
    container?.remove()
    const second = await mount()
    expect([Number.parseFloat(frame(second.el, 'w3').style.left), Number.parseFloat(frame(second.el, 'w3').style.top)]).toEqual([x0 + 600, y0 + 900])
    // A tab arrives there: its card stands in the frame's first cell.
    others = [others[0], other('w3', ['/w'], [{ path: '/w/q.md', active: true }])]
    await second.again({})
    expect(placeOf(page(second.el, 'w3\n/w/q.md\n0')!)).toEqual([x0 + 600 + BOARD.framePad, y0 + 900 + BOARD.framePad])
    void again
    void moveTo
  })

  it('YAZ-3343 S35 to S37, S43, D31: another window\'s card menu asks THAT window for its tab actions (duplicate, name, sidebar); "Move to ▸" lists the other windows that show its vault, rings their frame on hover, and moves the tab quietly into the nearest free cell', async () => {
    canvas = { allWindows: true, snap: true, cards: [], frames: [] }
    others = [other('w2', ['/w'], [{ path: '/w/y.md', active: true }]), other('w3', ['/w'], [{ path: '/w/q.md', active: true }])]
    const onHighlightWindow = vi.fn()
    const onMoveTab = vi.fn()
    const { el } = await mount({ onHighlightWindow, onMoveTab })
    const card = page(el, 'w2\n/w/y.md\n0')!
    rightClick(card)
    act(() => menuItem(el, 'Duplicate tab')?.click())
    expect(api.window.tabAction).toHaveBeenLastCalledWith('w2', { path: '/w/y.md', copy: 0 }, { kind: 'duplicate' })
    rightClick(card)
    act(() => menuItem(el, 'Show in sidebar')?.click())
    expect(api.window.tabAction).toHaveBeenLastCalledWith('w2', { path: '/w/y.md', copy: 0 }, { kind: 'show-in-sidebar' })
    // "Set display name": the field on the card; ⏎ asks w2.
    rightClick(card)
    act(() => menuItem(el, 'Set display name')?.click())
    const input = card.querySelector<HTMLInputElement>('.taboverview__rename')!
    act(() => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set?.call(input, 'Roadmap')
      input.dispatchEvent(new Event('input', { bubbles: true }))
    })
    act(() => void input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })))
    expect(api.window.tabAction).toHaveBeenLastCalledWith('w2', { path: '/w/y.md', copy: 0 }, { kind: 'set-name', name: 'Roadmap' })
    // Move to ▸: this window and w3 show /w; not w2 itself.
    rightClick(card)
    act(() => menuItem(el, 'Move to')?.click())
    const rows = [...el.querySelectorAll<HTMLElement>('.ctx-menu__sub [role="menuitem"]')]
    expect(rows.map((r) => r.textContent)).toEqual(['a + 5 more tabs', 'q'])
    act(() => void rows[1].dispatchEvent(new MouseEvent('mouseover', { bubbles: true })))
    act(() => void rows[1].dispatchEvent(new FocusEvent('focus', { bubbles: true })))
    expect(frame(el, 'w3').className).toContain('taboverview__frame--ringed')
    expect(onHighlightWindow).toHaveBeenLastCalledWith('w3')
    act(() => rows[1].click())
    expect(onMoveTab).toHaveBeenCalledExactlyOnceWith('w2', 'w3', { path: '/w/y.md', copy: 0 })
    const put = vi.mocked(storage.setTabCanvas).mock.calls.at(-1)![0].set!.at(-1)!
    expect(put).toMatchObject({ win: 'w3', path: '/w/y.md', copy: 0, by: 'window' })
    expect([put.x, put.y]).not.toEqual(placeOf(page(el, 'w3\n/w/q.md\n0')!))
    expect(frame(el, 'w3').className).not.toContain('taboverview__frame--ringed')
  })

  it('YAZ-3343 S36, S51, D30: a card that APPEARS in a frame whose cards were placed is placed too — a copy right of its source; any other new tab in the first gap; a full frame gets a new row', async () => {
    const C = { w: BOARD.pageW + BOARD.pageGap, h: BOARD.pageH + BOARD.pageGap }
    // w2's three cards placed in a row with a hole in the middle: y at cell 0, z at cell 2.
    const o = { x: 1000, y: 100 }
    canvas = { allWindows: true, snap: true, cards: [{ win: 'w2', path: '/w/y.md', copy: 0, by: 'window', x: o.x, y: o.y }, { win: 'w2', path: '/w/z.md', copy: 0, by: 'window', x: o.x + 2 * C.w, y: o.y }], frames: [] }
    others = [other('w2', ['/w'], [{ path: '/w/y.md', active: true }, { path: '/w/z.md' }])]
    const { el, again } = await mount()
    // A new tab there (a search pick, a move…): the first gap, between y and z.
    others = [other('w2', ['/w'], [{ path: '/w/y.md', active: true }, { path: '/w/z.md' }, { path: '/w/n.md' }])]
    await again({})
    expect(storage.setTabCanvas).toHaveBeenLastCalledWith({ set: [{ win: 'w2', path: '/w/n.md', copy: 0, by: 'window', x: o.x + C.w, y: o.y }] })
    await again({})
    // The row is full now: the next one starts a new row at its foot.
    others = [other('w2', ['/w'], [{ path: '/w/y.md', active: true }, { path: '/w/z.md' }, { path: '/w/n.md' }, { path: '/w/m.md' }])]
    await again({})
    expect(storage.setTabCanvas).toHaveBeenLastCalledWith({ set: [{ win: 'w2', path: '/w/m.md', copy: 0, by: 'window', x: o.x, y: o.y + C.h }] })
    // "Duplicate tab" on z: its copy lands right of z.
    rightClick(page(el, 'w2\n/w/z.md\n0'))
    act(() => menuItem(el, 'Duplicate tab')?.click())
    others = [other('w2', ['/w'], [{ path: '/w/y.md', active: true }, { path: '/w/z.md' }, { path: '/w/n.md' }, { path: '/w/m.md' }, { path: '/w/z.md' }])]
    await again({})
    expect(storage.setTabCanvas).toHaveBeenLastCalledWith({ set: [{ win: 'w2', path: '/w/z.md', copy: 1, by: 'window', x: o.x + 3 * C.w, y: o.y }] })
    // Two new tabs at once: each in a cell of its own (S14), in reading order.
    others = [other('w2', ['/w'], [{ path: '/w/y.md', active: true }, { path: '/w/z.md' }, { path: '/w/n.md' }, { path: '/w/m.md' }, { path: '/w/z.md' }, { path: '/w/p.md' }, { path: '/w/q.md' }])]
    await again({})
    expect(storage.setTabCanvas).toHaveBeenLastCalledWith({ set: [{ win: 'w2', path: '/w/p.md', copy: 0, by: 'window', x: o.x + C.w, y: o.y + C.h }, { win: 'w2', path: '/w/q.md', copy: 0, by: 'window', x: o.x + 2 * C.w, y: o.y + C.h }] })
  })

  it('YAZ-3343 S51: a card the filter hid and brings back is no new card — typing and clearing the filter stores nothing', async () => {
    canvas = { allWindows: true, snap: true, cards: [], frames: [] }
    others = [other('w2', ['/w'], [{ path: '/w/y.md', active: true }, { path: '/w/z.md' }])]
    const { el } = await mount()
    type(el, 'y')
    type(el, '')
    expect(storage.setTabCanvas).not.toHaveBeenCalled()
  })

  it('YAZ-3343 S29, D33: the pointer over ANOTHER window\'s frame (or one of its cards) makes that window glow — once per change; its own frame, empty canvas, a drag and the board going put it out', async () => {
    canvas = { allWindows: true, snap: false, cards: [], frames: [] }
    others = [other('w2', ['/w'], [{ path: '/w/y.md', active: true }])]
    const onHighlightWindow = vi.fn()
    const { el } = await mount({ onHighlightWindow })
    const over = (target: Element | null | undefined) => act(() => void target?.dispatchEvent(new MouseEvent('mousemove', { bubbles: true })))
    over(frame(el, 'w2'))
    over(page(el, 'w2\n/w/y.md\n0'))
    expect(onHighlightWindow.mock.calls).toEqual([['w2']])
    over(frame(el, 'me'))
    expect(onHighlightWindow).toHaveBeenLastCalledWith(null)
    over(page(el, 'w2\n/w/y.md\n0'))
    over(body(el))
    expect(onHighlightWindow.mock.calls).toEqual([['w2'], [null], ['w2'], [null]])
    over(frame(el, 'w2'))
    act(() => root?.unmount())
    root = null
    expect(onHighlightWindow).toHaveBeenLastCalledWith(null)
  })

  it('YAZ-3343 S41, D28: a card dropped into a frame with NO placed cards — the frame is frozen where it stands, and the card lands INSIDE it (its first free cell, or a new row), never at the drop point', async () => {
    const C = { w: BOARD.pageW + BOARD.pageGap, h: BOARD.pageH + BOARD.pageGap }
    canvas = { allWindows: true, snap: true, cards: [], frames: [] }
    others = [other('w2', ['/w'], [{ path: '/w/a1.md', active: true }, { path: '/w/a2.md' }, { path: '/w/a3.md' }])]
    const onDropToWindow = vi.fn()
    const { el } = await mount({ onDropToWindow })
    const theirs = ['w2\n/w/a1.md\n0', 'w2\n/w/a2.md\n0', 'w2\n/w/a3.md\n0'].map((id) => placeOf(page(el, id)!))
    const box = frame(el, 'w2')
    const x = page(el, '/w/x.md')!
    const [xx, xy] = placeOf(x)
    // Grabbed in its middle, let go deep in w2's frame, far below its cards.
    const grab = { x: BOARD.padX + xx + 50, y: BOARD.padTop + xy + 30 }
    const end = { x: BOARD.padX + Number.parseFloat(box.style.left) + 30, y: BOARD.padTop + Number.parseFloat(box.style.top) + Number.parseFloat(box.style.height) - 5 }
    pointer(x, 'pointerdown', grab.x, grab.y)
    pointer(window, 'pointermove', grab.x + 10, grab.y + 10)
    pointer(window, 'pointermove', end.x, end.y)
    pointer(window, 'pointerup', end.x, end.y)
    expect(onDropToWindow).toHaveBeenCalledExactlyOnceWith('w2', '/w/x.md', '/w/x.md')
    // ONE write: w2's three cards where they stand, and the arrival under them (the row is full: a new row).
    expect(storage.setTabCanvas).toHaveBeenCalledExactlyOnceWith({
      set: [
        ...['/w/a1.md', '/w/a2.md', '/w/a3.md'].map((path, i) => ({ win: 'w2', path, copy: 0, by: 'window', x: theirs[i][0], y: theirs[i][1] })),
        { win: 'w2', path: '/w/x.md', copy: 0, by: 'window', x: theirs[0][0], y: theirs[0][1] + C.h },
      ],
    })
  })

  it('YAZ-3343 S56, D28: frames that overlap when the board opens are repaired ONCE — the later one moves clear and is stored; a second open writes nothing', async () => {
    // From the demo's state: one card of w2 stored deep inside this window's frame, so w2's box covers it.
    const deep = { x: BOARD.framePad + 230, y: BOARD.frameLabelH + BOARD.framePad }
    canvas = { allWindows: true, snap: false, cards: [{ win: 'w2', path: '/w/y.md', copy: 0, by: 'window', x: deep.x, y: deep.y }], frames: [] }
    others = [other('w2', ['/w'], [{ path: '/w/y.md', active: true }, { path: '/w/z.md' }])]
    const { el } = await mount()
    expect(storage.setTabCanvas).toHaveBeenCalledTimes(1)
    const boxOf = (win: string) => {
      const f = frame(el, win)
      return { x: Number.parseFloat(f.style.left), y: Number.parseFloat(f.style.top) - BOARD.frameLabelH, w: Number.parseFloat(f.style.width), h: Number.parseFloat(f.style.height) + BOARD.frameLabelH }
    }
    const [a, b] = [boxOf('me'), boxOf('w2')]
    expect(a.x + a.w <= b.x || b.x + b.w <= a.x || a.y + a.h <= b.y || b.y + b.h <= a.y).toBe(true)
    act(() => root?.unmount())
    container?.remove()
    vi.mocked(storage.setTabCanvas).mockClear()
    await mount()
    expect(storage.setTabCanvas).not.toHaveBeenCalled()
  })

  it('YAZ-3343 S24, S32, D32, D34: a double click on a frame\'s EMPTY AREA goes to that window (its active tab; an empty one shows; this window\'s leaves the board onto its tab) — on its LABEL it renames; the label says its vault, and "Minimized" when it is', async () => {
    canvas = { allWindows: true, snap: false, cards: [], frames: [] }
    others = [other('w2', ['/w'], [{ path: '/w/y.md' }, { path: '/w/z.md', active: true }]), other('w3', ['/w'], [])]
    const { el, props } = await mount()
    const dbl = (target: Element | null | undefined) => act(() => void target?.dispatchEvent(new MouseEvent('dblclick', { bubbles: true })))
    dbl(frame(el, 'w2'))
    expect(api.window.focusTab).toHaveBeenCalledExactlyOnceWith('w2', { path: '/w/z.md', copy: 0 })
    expect(props.onDismiss).not.toHaveBeenCalled()
    dbl(frame(el, 'w3'))
    expect(api.window.showWindow).toHaveBeenCalledExactlyOnceWith('w3')
    dbl(frame(el, 'me'))
    expect(props.onOpen).toHaveBeenCalledExactlyOnceWith('/v/a.md')
    // The label row renames — and goes nowhere.
    dbl(frame(el, 'w2').querySelector('.taboverview__frame-vault'))
    expect(frame(el, 'w2').querySelector('.taboverview__frame-label input')).not.toBeNull()
    expect([vi.mocked(api.window.focusTab).mock.calls.length, vi.mocked(api.window.showWindow).mock.calls.length]).toEqual([1, 1])
    act(() => void frame(el, 'w2').querySelector('.taboverview__frame-label input')!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })))
    // Its vault, muted; an empty frame's chip says it instead.
    expect(frame(el, 'w2').querySelector('.taboverview__frame-vault')?.textContent).toBe('· w')
    expect(frame(el, 'w3').querySelector('.taboverview__frame-vault')).toBeNull()
    expect(frame(el, 'me').querySelector('.taboverview__frame-vault')?.textContent).toBe('· v +1')
    const tell = (globalThis as unknown as { tellMinimized: (ids: string[]) => void }).tellMinimized
    act(() => tell(['w2']))
    expect(frame(el, 'w2').textContent).toContain('Minimized')
    act(() => tell([]))
    expect(frame(el, 'w2').textContent).not.toContain('Minimized')
  })

  it('YAZ-3343 S1, S33, D27: the open fits — a tiny board stays at 100%; and an armed Close goes back to ✕ when the pointer leaves its card', async () => {
    const restore = boardArea(1000, 600)
    try {
      const { el, props } = await mount({ roots: ['/v'], vaultNames: ['Notes'], tabs: ['/v/a.md'] })
      expect(world(el).style.transform).toMatch(/scale\(1\)$/)
      const close = () => page(el, '/v/a.md')!.querySelector<HTMLButtonElement>('.taboverview__close')!
      act(() => close().click())
      expect(close().textContent).toBe('Close')
      act(() => void page(el, '/v/a.md')!.dispatchEvent(new MouseEvent('mouseout', { bubbles: true, relatedTarget: document.body })))
      expect(close().textContent).toBe('✕')
      act(() => close().click())
      key(el, 'Escape')
      expect(close().textContent).toBe('✕')
      expect(props.onDismiss).not.toHaveBeenCalled()
      expect(props.onCloseTabs).not.toHaveBeenCalled()
    } finally {
      restore()
    }
  })

  it('YAZ-3343 S20, D9: "Tidy up" forgets every moved card the layout shows, and they stand in their groups again', async () => {
    canvas = { allWindows: false, snap: false, cards: [{ win: 'me', path: '/v/a.md', copy: 0, by: 'folder', x: 800, y: 900 }], frames: [] }
    const { el } = await mount()
    const tidy = [...el.querySelectorAll<HTMLButtonElement>('button')].find((b) => b.textContent === 'Tidy up')!
    expect(tidy.disabled).toBe(false)
    act(() => tidy.click())
    expect(storage.setTabCanvas).toHaveBeenCalledExactlyOnceWith({ forget: [{ win: 'me', path: '/v/a.md', copy: 0, by: 'folder' }] })
    expect(page(el, '/v/a.md')!.style.left).toBe(`${BOARD.islandPad}px`)
    expect(tidy.disabled).toBe(true)
  })

  it('YAZ-3343 S8, D11: a display name has "Page: <page>" under it, and each copy of a path says which it is; the tooltip stays', async () => {
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
    const tabs = [{ id: 't1', path: '/v/a.md', name: 'Outline' }, { id: 't2', path: '/v/b.md' }, { id: 't3', path: '/v/a.md' }]
    await act(async () => root?.render(<IdTabOverview roots={['/v']} vaultNames={['Notes']} tabs={tabs} active="t1" preview={null} titles={new Map([['/v/a.md', 'Plan']])} windowId="me" onOpen={vi.fn()} onCloseTabs={vi.fn()} onDismiss={vi.fn()} onDropToWindow={vi.fn()} onMoveTab={vi.fn()} onMoveToNewWindowQuietly={vi.fn()} />))
    const el = container
    const face = (id: string) => [page(el, id)?.querySelector('.taboverview__title')?.textContent, page(el, id)?.querySelector('.taboverview__pagename')?.textContent ?? null, page(el, id)?.querySelector('.taboverview__copy')?.textContent ?? null]
    expect(face('t1')).toEqual(['Outline', 'Page: Plan', '1 of 2'])
    expect(face('t2')).toEqual(['b', null, null])
    expect(face('t3')).toEqual(['Plan', null, '2 of 2'])
    expect(page(el, 't1')!.title).toBe('Plan\n/v/a.md')
  })

  it('YAZ-3343 S21, S31, S33, S39, D2, D3, D8, D10: "Show all windows" — a switch, stored; one frame per window, this one first; another window\'s cards go to it, close there, and have their own three-item menu; Kill all hands App the other windows\' tabs', async () => {
    names.set('w2', 'Research')
    others = [other('w2', ['/w'], [{ path: '/w/y.md' }, { path: '/w/z.md', active: true }, { path: '/w/y.md', name: 'Second' }]), other('w3', ['/v'], [])]
    const onKillAll = vi.fn()
    const { el, props, again } = await mount({ onKillAll })
    const toggle = el.querySelector<HTMLInputElement>('[role="switch"]')!
    expect([toggle.closest('label')?.textContent, toggle.getAttribute('aria-checked'), el.querySelectorAll('.taboverview__frame').length]).toEqual(['Show all windows', 'false', 0])
    // Off: this window's cards only.
    expect(el.querySelector('[data-win="w2"]')).toBeNull()
    act(() => toggle.click())
    expect(storage.setTabCanvas).toHaveBeenCalledWith({ allWindows: true })
    expect(toggle.getAttribute('aria-checked')).toBe('true')
    // This window first, then the others in the state's order; a named window by its name, an empty one too.
    expect(texts(el, '.taboverview__frame-name')).toEqual(['a + 5 more tabs', 'Research', 'Empty window'])
    // Its cards: names, copies, its active tab marked; its first lines read with this window's, in ONE call per new path.
    const theirs = [...el.querySelectorAll<HTMLElement>('.taboverview__page[data-win="w2"]')]
    expect(theirs.map((c) => [c.querySelector('.taboverview__title')?.textContent, c.querySelector('.taboverview__copy')?.textContent ?? null, c.getAttribute('aria-current')])).toEqual([
      ['y', '1 of 2', null],
      ['z', null, 'page'],
      ['Second', '2 of 2', null],
    ])
    expect(readHeads.mock.calls.at(-1)).toEqual([['/w/y.md', '/w/z.md']])

    // A click goes to it in its window — and this board stays open (demo feedback); its ✕ closes it there.
    act(() => theirs[1].click())
    expect(api.window.focusTab).toHaveBeenCalledExactlyOnceWith('w2', { path: '/w/z.md', copy: 0 })
    expect(props.onDismiss).not.toHaveBeenCalled()
    expect(props.onOpen).not.toHaveBeenCalled()
    act(() => theirs[2].querySelector<HTMLButtonElement>('.taboverview__close')!.click())
    act(() => theirs[2].querySelector<HTMLButtonElement>('.taboverview__close')!.click())
    expect(api.window.closeTabs).toHaveBeenCalledExactlyOnceWith('w2', [{ path: '/w/y.md', copy: 1 }])
    expect(props.onCloseTabs).not.toHaveBeenCalled()
    rightClick(theirs[0])
    // ONE menu for every card (demo feedback): "Go to tab", the strip's own items, "Close tab".
    expect(menuItems(el)).toEqual(['Go to tab', 'Move to new window', 'Duplicate tab', 'Move to', 'Show in sidebar', 'Copy path', 'Set display name', 'Reveal in Finder', 'Open in VS Code', 'Close tab'])
    act(() => menuItem(el, 'Close tab')?.click())
    expect(api.window.closeTabs).toHaveBeenLastCalledWith('w2', [{ path: '/w/y.md', copy: 0 }])

    // A pick across windows closes per window.
    shiftClick(page(el, '/v/a.md'))
    shiftClick(theirs[1])
    for (const label of ['Close them', 'Click again to close 2 tabs']) act(() => [...el.querySelectorAll<HTMLButtonElement>('.taboverview__pick button')].find((b) => (b.getAttribute('aria-label') ?? b.textContent) === label)?.click())
    expect(props.onCloseTabs).toHaveBeenLastCalledWith(['/v/a.md'])
    expect(api.window.closeTabs).toHaveBeenLastCalledWith('w2', [{ path: '/w/z.md', copy: 0 }])

    // Kill all: this window's tabs are App's own; the other windows' go with it, by window.
    act(() => el.querySelector<HTMLButtonElement>('.taboverview__kill')?.click())
    expect(onKillAll).toHaveBeenCalledExactlyOnceWith([{ win: 'w2', refs: [{ path: '/w/y.md', copy: 0 }, { path: '/w/z.md', copy: 0 }, { path: '/w/y.md', copy: 1 }] }])

    // Off again: back to this window's own groups.
    act(() => toggle.click())
    expect(el.querySelectorAll('.taboverview__frame').length).toBe(0)
    await again({})
    expect(el.querySelector('[data-win="w2"]')).toBeNull()
  })

  it('YAZ-3343 S40, S42, D13: a card dropped in another window\'s frame moves there — this window\'s by App\'s door, another\'s by main — and its place there is stored; a window with no vault of the page refuses it, and the card slides back', async () => {
    canvas = { allWindows: true, snap: false, cards: [], frames: [] }
    others = [other('w2', ['/w'], [{ path: '/w/y.md', active: true }])]
    const onDropToWindow = vi.fn()
    const onMoveTab = vi.fn()
    const onNotice = vi.fn()
    const { el } = await mount({ onDropToWindow, onMoveTab, onNotice })
    /** The client point inside a frame: the camera stands at the padding, zoom 1. */
    const inside = (win: string) => ({ x: BOARD.padX + Number.parseFloat(frame(el, win).style.left) + 30, y: BOARD.padTop + Number.parseFloat(frame(el, win).style.top) + 30 })

    // a.md is of /v, which w2 does not show: refused, with its frame's name, and the card slides back.
    let to = inside('w2')
    const a = page(el, '/v/a.md')!
    dragTo(a, to.x, to.y)
    expect(onNotice).toHaveBeenCalledExactlyOnceWith("Can't move here — that window doesn't have this tab's vault.")
    expect([a.style.transform, a.dataset.sliding]).toEqual(['', ''])
    expect(onDropToWindow).not.toHaveBeenCalled()
    expect(storage.setTabCanvas).not.toHaveBeenCalled()

    // x.md is of /w: it goes to w2, and arrives as the next copy of its path there, where it was dropped.
    const x = page(el, '/w/x.md')!
    const [fromX, fromY] = placeOf(x)
    const from = { left: fromX, top: fromY }
    dragTo(x, to.x, to.y)
    // The drop's own door, the quiet one (demo feedback): "Move to ▸" is the menu's.
    expect(onDropToWindow).toHaveBeenCalledExactlyOnceWith('w2', '/w/x.md', '/w/x.md')
    // It ARRIVES inside w2's frame (demo bug: never at the raw drop point): w2's card frozen, the arrival in a new row under it.
    const [wy] = [placeOf(page(el, 'w2\n/w/y.md\n0')!)]
    expect(storage.setTabCanvas).toHaveBeenCalledExactlyOnceWith({ set: [{ win: 'w2', path: '/w/y.md', copy: 0, by: 'window', x: wy[0], y: wy[1] }, { win: 'w2', path: '/w/x.md', copy: 0, by: 'window', x: wy[0], y: wy[1] + BOARD.pageH + BOARD.pageGap }] })
    void from
    // It is held where it was dropped until its tab leaves.
    expect(x.style.transform).toBe('')

    // w2's card dropped in this window's frame: main moves it, from w2 to here.
    to = inside('me')
    dragTo(page(el, 'w2\n/w/y.md\n0'), to.x, to.y)
    expect(onMoveTab).toHaveBeenCalledExactlyOnceWith('w2', 'me', { path: '/w/y.md', copy: 0 })
  })

  it('YAZ-3343 S25, D16: a WINDOW FRAME drags as one — frame, groups and cards follow by transform with no render; the drop stores every card of it moved by the same delta, in ONE write and ONE render; a press with no move moves nothing', async () => {
    canvas = { allWindows: true, snap: false, cards: [], frames: [] }
    others = [other('w2', ['/w'], [{ path: '/w/y.md', active: true }, { path: '/w/z.md' }])]
    const { el, commits } = await mount()
    const ids = ['w2\n/w/y.md\n0', 'w2\n/w/z.md\n0']
    const placeAt = (id: string) => placeOf(page(el, id)!)
    const before = ids.map(placeAt)
    const label = frame(el, 'w2').querySelector('.taboverview__frame-label')
    // A press with no move is no drag: nothing is stored, and a double click still names the window.
    pointer(label, 'pointerdown', 0, 0)
    pointer(window, 'pointerup', 0, 0)
    expect(storage.setTabCanvas).not.toHaveBeenCalled()
    commits.n = 0
    pointer(label, 'pointerdown', 0, 0)
    pointer(window, 'pointermove', 50, 20)
    pointer(window, 'pointermove', 120, 45)
    // The frame holds its cards directly: the frame and each of its cards follow.
    expect([frame(el, 'w2').style.transform, ...ids.map((id) => page(el, id)!.style.transform)]).toEqual(['translate(120px, 45px)', 'translate(120px, 45px)', 'translate(120px, 45px)'])
    // This window's frame stays put.
    expect(frame(el, 'me').style.transform).toBe('')
    expect(commits.n).toBe(0)
    pointer(window, 'pointerup', 120, 45)
    expect(commits.n).toBe(1)
    expect(storage.setTabCanvas).toHaveBeenCalledExactlyOnceWith({ set: ids.map((id, i) => ({ win: 'w2', path: id.split('\n')[1], copy: 0, by: 'window', x: before[i][0] + 120, y: before[i][1] + 45 })), setFrames: [expect.objectContaining({ win: 'w2' })] })
    expect(ids.map(placeAt)).toEqual(before.map(([x, y]) => [x + 120, y + 45]))
    expect([frame(el, 'w2').style.transform, frame(el, 'w2').dataset.lifted]).toEqual(['', undefined])
    // No tab moved: a frame's drop is never a card's (D13).
    expect(api.window.moveTab).not.toHaveBeenCalled()
  })

  it('YAZ-3343 S21, S22, D17: a window frame has no folder boxes — its cards in folder order, each with its folder in grey (the vault first where the window has two or more); the folder layout keeps its groups; empty canvas still pans', async () => {
    canvas = { allWindows: true, snap: false, cards: [], frames: [] }
    others = [other('w2', ['/w'], [{ path: '/w/Docs/z.md', active: true }, { path: '/w/y.md' }])]
    const { el } = await mount()
    expect(el.querySelectorAll('.taboverview__island, .taboverview__vault-name').length).toBe(0)
    const faces = (win: string) => [...el.querySelectorAll<HTMLElement>(`.taboverview__page[data-win="${win}"]`)].map((c) => [c.querySelector('.taboverview__title')?.textContent, c.querySelector('.taboverview__folder')?.textContent])
    // This window has two vaults: the vault's name leads; its top level is the vault's name alone.
    expect(faces('me')).toEqual([
      ['a', 'Notes'],
      ['plan', 'Notes / Projects'],
      ['report.pdf', 'Notes / Projects'],
      ['Alpha', 'Notes / Projects'],
      ['2026-10-08', 'Notes / Projects / Alpha'],
      ['x', 'Work'],
    ])
    // One vault: the folder alone, in folder order (the top level first), whatever the strip's order.
    expect(faces('w2')).toEqual([['y', 'w'], ['z', 'Docs']])
    // Cards of a frame stand in rows of four.
    const tops = [...el.querySelectorAll<HTMLElement>('.taboverview__page[data-win="me"]')].map((c) => c.style.top)
    expect(new Set(tops.slice(0, 4)).size).toBe(1)
    expect(tops[4]).not.toBe(tops[0])
    // A press on empty canvas, outside every frame, pans.
    const was = world(el).style.transform
    pointer(body(el), 'pointerdown', 0, 0)
    pointer(window, 'pointermove', 30, 0)
    pointer(window, 'pointerup', 30, 0)
    expect(world(el).style.transform).not.toBe(was)
    // Off: the folder layout's groups are back, and its cards say no folder (their group does).
    act(() => el.querySelector<HTMLInputElement>('[role="switch"]')!.click())
    expect(el.querySelectorAll('.taboverview__island').length).toBe(4)
    expect(el.querySelector('.taboverview__folder')).toBeNull()
  })

  it('YAZ-3343 S17, S44, D25: ⌘-click picks as Shift does; dragging a picked card carries every picked card, of any window, by the same delta — no render while it moves, ONE write and ONE render on the drop, and no tab changes window', async () => {
    canvas = { allWindows: true, snap: false, cards: [], frames: [] }
    others = [other('w2', ['/w', '/v'], [{ path: '/w/y.md', active: true }])]
    const onDropToWindow = vi.fn()
    const onMoveTab = vi.fn()
    const { el, props, commits } = await mount({ onDropToWindow, onMoveTab })
    const ids = ['/v/a.md', 'w2\n/w/y.md\n0']
    const placeAt = (id: string) => placeOf(page(el, id)!)
    const before = ids.map(placeAt)
    for (const id of ids) act(() => void page(el, id)!.dispatchEvent(new MouseEvent('click', { bubbles: true, metaKey: true })))
    expect(props.onOpen).not.toHaveBeenCalled()
    expect(api.window.focusTab).not.toHaveBeenCalled()
    expect(el.querySelector('.taboverview__pick-count')?.textContent).toBe('2 picked')
    commits.n = 0
    // Dropped inside w2's frame: still only a move on the canvas.
    const target = { x: BOARD.padX + Number.parseFloat(frame(el, 'w2').style.left) + 20, y: BOARD.padTop + Number.parseFloat(frame(el, 'w2').style.top) + 20 }
    pointer(page(el, ids[0]), 'pointerdown', 0, 0)
    pointer(window, 'pointermove', target.x / 2, target.y / 2)
    pointer(window, 'pointermove', target.x, target.y)
    expect(ids.map((id) => page(el, id)!.style.transform)).toEqual(ids.map(() => `translate(${target.x}px, ${target.y}px)`))
    expect(commits.n).toBe(0)
    pointer(window, 'pointerup', target.x, target.y)
    expect(commits.n).toBe(1)
    expect(storage.setTabCanvas).toHaveBeenCalledExactlyOnceWith({ set: [{ win: 'me', path: '/v/a.md', copy: 0, by: 'window', x: before[0][0] + target.x, y: before[0][1] + target.y }, { win: 'w2', path: '/w/y.md', copy: 0, by: 'window', x: before[1][0] + target.x, y: before[1][1] + target.y }] })
    expect([onDropToWindow, onMoveTab].map((door) => vi.mocked(door).mock.calls.length)).toEqual([0, 0])
    expect(ids.map(placeAt)).toEqual(before.map(([x, y]) => [x + target.x, y + target.y]))
  })

  it('YAZ-3343 S46, S52, S53, S55, D21: a right-click anywhere on a frame opens its menu — "Tidy up this window" lines its cards up and the FRAME STAYS; "Close all tabs" / "Close window" ask App; a group\'s background opens the group\'s menu, whose tidy keeps the group; empty canvas: only "New window", never the text-edit menu', async () => {
    canvas = { allWindows: true, snap: false, cards: [{ win: 'w2', path: '/w/y.md', copy: 0, by: 'window', x: 1500, y: 900 }, { win: 'w2', path: '/w/z.md', copy: 0, by: 'window', x: 2400, y: 1300 }, { win: 'me', path: '/v/a.md', copy: 0, by: 'window', x: 900, y: 900 }], frames: [] }
    others = [other('w2', ['/w'], [{ path: '/w/y.md', active: true }, { path: '/w/z.md' }])]
    const onCloseWindow = vi.fn()
    const { el, again } = await mount({ onCloseWindow })
    const ctx = (target: Element | null | undefined) => {
      const event = new MouseEvent('contextmenu', { bubbles: true, cancelable: true })
      act(() => void target?.dispatchEvent(event))
      return event.defaultPrevented
    }
    const box = (win: string) => ['left', 'top'].map((k) => Number.parseFloat(frame(el, win).style[k as 'left' | 'top']))
    const [fx, fy] = box('w2')
    // The frame's empty background, not its label.
    expect(ctx(frame(el, 'w2'))).toBe(true)
    expect(menuItems(el)).toEqual(['Open tabs here…', 'Tidy up this window', 'Name window', 'Close all tabs', 'Close window'])
    act(() => menuItem(el, 'Tidy up this window')?.click())
    // ONE write that STORES w2's cards in a row from the frame's own top-left: the frame does not move.
    const inside = { x: fx + BOARD.framePad, y: fy + BOARD.framePad }
    expect(storage.setTabCanvas).toHaveBeenCalledExactlyOnceWith({ set: [{ win: 'w2', path: '/w/y.md', copy: 0, by: 'window', x: inside.x, y: inside.y }, { win: 'w2', path: '/w/z.md', copy: 0, by: 'window', x: inside.x + BOARD.pageW + BOARD.pageGap, y: inside.y }], setFrames: [{ win: 'w2', x: fx, y: fy - BOARD.frameLabelH }] })
    expect(box('w2')).toEqual([fx, fy])
    // This window's card is untouched.
    expect(canvas.cards.find((c) => c.win === 'me')).toMatchObject({ x: 900, y: 900 })
    // The closes take two clicks IN the menu (demo feedback): the first turns the item red and keeps the menu open.
    ctx(frame(el, 'w2'))
    act(() => menuItem(el, 'Close all tabs')?.click())
    expect(onCloseWindow).not.toHaveBeenCalled()
    const armed = menuItem(el, 'Click again to close 2 tabs')!
    expect(armed.className).toContain('taboverview__armed')
    // Under the pointer it is still the armed one (red at once, the menu's hover does not win).
    act(() => void armed.dispatchEvent(new MouseEvent('mouseover', { bubbles: true })))
    expect(menuItem(el, 'Click again to close 2 tabs')!.className).toContain('taboverview__armed')
    // Another item under the pointer puts it back.
    act(() => void armed.dispatchEvent(new MouseEvent('mouseout', { bubbles: true, relatedTarget: menuItem(el, 'Name window')! })))
    expect(menuItem(el, 'Close all tabs')).toBeDefined()
    act(() => menuItem(el, 'Close all tabs')?.click())
    act(() => menuItem(el, 'Click again to close 2 tabs')?.click())
    expect(onCloseWindow).toHaveBeenLastCalledWith({ win: 'w2', mine: false, refs: [{ path: '/w/y.md', copy: 0 }, { path: '/w/z.md', copy: 0 }], whole: false })
    expect(el.querySelector('.ctx-menu')).toBeNull()
    ctx(frame(el, 'me'))
    act(() => menuItem(el, 'Close window')?.click())
    act(() => menuItem(el, 'Click again to close')?.click())
    expect(onCloseWindow).toHaveBeenLastCalledWith(expect.objectContaining({ win: 'me', mine: true, whole: true }))
    // Empty canvas: default prevented — and with no "New window" door, no menu.
    expect(ctx(body(el))).toBe(true)
    expect(el.querySelector('.ctx-menu')).toBeNull()
    // The folder layout: a group's background opens the group's menu; its tidy lines its cards up where the group is.
    canvas = { allWindows: false, snap: false, cards: [{ win: 'me', path: '/v/Projects/plan.md', copy: 0, by: 'folder', x: 700, y: 700 }], frames: [] }
    await again({})
    const g = island(el, 'Projects')
    const [gx, gy] = [Number.parseFloat(g.style.left), Number.parseFloat(g.style.top)]
    expect(ctx(g)).toBe(true)
    expect(menuItems(el)).toContain('Tidy up this group')
    act(() => menuItem(el, 'Tidy up this group')?.click())
    // The tidy's write (a group it now reaches gives way after it, D28).
    const set = vi.mocked(storage.setTabCanvas).mock.calls.map(([patch]) => patch.set ?? []).find((cards) => cards.some((c) => c.path === '/v/Projects/report.pdf'))!
    expect(set.map((c) => [c.path, c.x, c.y])).toEqual(['/v/Projects/plan.md', '/v/Projects/report.pdf', '/v/Projects/Alpha'].map((path, i) => [path, gx + BOARD.islandPad + i * (BOARD.pageW + BOARD.pageGap), gy + BOARD.islandPad + BOARD.labelH]))
    expect([Number.parseFloat(island(el, 'Projects').style.left), Number.parseFloat(island(el, 'Projects').style.top)]).toEqual([gx, gy])
    // The filter keeps its own text menu.
    expect(ctx(filter(el))).toBe(false)
  })

  it('YAZ-3343 S46, S47, S49, S50, D22: "New window" — a right-click on empty canvas (never a double click) opens one behind, its frame at that point, and "Open tabs here…" opens for it; a pick adds a BACKGROUND tab (this window by its door, another by a quiet move); a vault it does not show is refused', async () => {
    canvas = { allWindows: true, snap: false, cards: [], frames: [] }
    others = [other('w2', ['/w'], [{ path: '/w/y.md', active: true }])]
    const onNewWindow = vi.fn(async () => 'w3')
    const onOpenTabHere = vi.fn()
    const onNotice = vi.fn()
    const moveTo = vi.fn().mockResolvedValue(undefined)
    ;(api.window as unknown as Record<string, unknown>).moveTo = moveTo
    // The search reads each target vault's index and tree itself (a vault this window may not show).
    const rec = (path: string, title: string) => ({ path, name: `${title}.md`, basename: title, title, folder: '', ext: 'md', size: 1, ctime: 1, mtime: 1, aliases: [], links: [], tags: [] })
    const index = vi.fn(async (root: string) => ({ root, records: root === '/w' ? [rec('/w/quarterly.md', 'Quarterly')] : [rec('/v/quiet.md', 'Quiet')], folders: [], generatedAt: 1, ids: false }))
    ;(api as unknown as Record<string, unknown>).index = index
    vi.mocked(api.tree).mockImplementation(async (root: string) => ({ root, tree: [], generatedAt: 1 }) as never)
    const { el, again } = await mount({ onNewWindow, onOpenTabHere, onNotice })
    const ctx = new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 2000, clientY: 900 })
    act(() => void body(el).dispatchEvent(ctx))
    expect(menuItems(el)).toEqual(['New window'])
    await act(async () => menuItem(el, 'New window')?.click())
    expect(onNewWindow).toHaveBeenCalledTimes(1)
    // The new window arrives through the state: its EMPTY frame stands at the click point, with its vault chip.
    others = [...others, other('w3', ['/v', '/w'], [])]
    act(() => void storage.setWindowName('w0', null))
    await again({})
    expect([frame(el, 'w3').style.left, frame(el, 'w3').style.top]).toEqual([`${2000 - BOARD.padX}px`, `${900 - BOARD.padTop + BOARD.frameLabelH}px`])
    expect(frame(el, 'w3').querySelector('.taboverview__vault-chip')?.textContent).toBe('v +1 ▾')
    expect(frame(el, 'w2').querySelector('.taboverview__vault-chip')).toBeNull()
    // The search is open for it; a pick quietly moves the path there; a path in no vault of it is refused.
    const search = el.querySelector('.taboverview__search')!
    expect(search.getAttribute('aria-label')).toBe('Open tabs in Empty window')
    const input = search.querySelector<HTMLInputElement>('input')!
    expect(document.activeElement).toBe(input)
    const typeIn = (value: string) =>
      act(async () => {
        Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set?.call(input, value)
        input.dispatchEvent(new Event('input', { bubbles: true }))
      })
    await typeIn('qu')
    await settled()
    // The TARGET window's vaults: both of w3's (it was opened on this window's two).
    expect(texts(search, '.search-results__label')).toEqual(expect.arrayContaining([expect.stringContaining('Quarterly'), expect.stringContaining('Quiet')]))
    act(() => [...search.querySelectorAll<HTMLElement>('[role="option"]')].find((row) => row.textContent?.includes('Quarterly'))!.click())
    expect(moveTo).toHaveBeenCalledExactlyOnceWith('w3', '/w/quarterly.md', { background: true })
    // Its card is kept in the frame's grid where it was placed.
    expect(storage.setTabCanvas).toHaveBeenLastCalledWith({ set: [{ win: 'w3', path: '/w/quarterly.md', copy: 0, by: 'window', x: 2000 - BOARD.padX + BOARD.framePad, y: 900 - BOARD.padTop + BOARD.frameLabelH + BOARD.framePad }] })
    // The panel stays for more; Esc closes it.
    expect(el.querySelector('.taboverview__search')).not.toBeNull()
    act(() => void input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })))
    expect(el.querySelector('.taboverview__search')).toBeNull()
    // "Open tabs here…" for THIS window: its own door; a vault it does not show is refused.
    act(() => void frame(el, 'me').dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true })))
    act(() => menuItem(el, 'Open tabs here…')?.click())
    const mine = el.querySelector('.taboverview__search')!
    const input2 = mine.querySelector<HTMLInputElement>('input')!
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set?.call(input2, 'qui')
      input2.dispatchEvent(new Event('input', { bubbles: true }))
    })
    await settled()
    act(() => [...mine.querySelectorAll<HTMLElement>('[role="option"]')].find((row) => row.textContent?.includes('Quiet'))!.click())
    expect(onOpenTabHere).toHaveBeenCalledExactlyOnceWith('/v/quiet.md')
    act(() => void input2.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })))
    // w2 shows only /w: a pick of /v is refused there, with its name.
    act(() => void frame(el, 'w2').dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true })))
    act(() => menuItem(el, 'Open tabs here…')?.click())
    expect(el.querySelector('.taboverview__search')?.getAttribute('aria-label')).toBe('Open tabs in y')
    act(() => void el.querySelector<HTMLInputElement>('.taboverview__search input')!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })))
    // A double click on empty canvas does nothing (demo feedback: too easy): the menu is the one way.
    act(() => void body(el).dispatchEvent(new MouseEvent('dblclick', { bubbles: true, clientX: 10, clientY: 10 })))
    await settled()
    expect(onNewWindow).toHaveBeenCalledTimes(1)
    void onNotice
  })

  it('YAZ-3343 S48, D22: an EMPTY frame\'s vault chip lists the recent vaults, and a pick asks main to switch that window', async () => {
    canvas = { allWindows: true, snap: false, cards: [], frames: [] }
    others = [other('w3', ['/v'], [])]
    vi.spyOn(storage, 'getRecentRoots').mockReturnValue([{ path: '/x/Research', lastOpened: 2 }, { path: '/v', lastOpened: 1 }])
    const setRoots = vi.fn().mockResolvedValue(undefined)
    ;(api.window as unknown as Record<string, unknown>).setRoots = setRoots
    const { el } = await mount()
    const chip = frame(el, 'w3').querySelector<HTMLButtonElement>('.taboverview__vault-chip')!
    expect(frame(el, 'me').querySelector('.taboverview__vault-chip')).toBeNull() // this window has tabs
    act(() => chip.click())
    expect(menuItems(el)).toEqual(['Research', 'v'])
    act(() => menuItem(el, 'Research')?.click())
    expect(setRoots).toHaveBeenCalledExactlyOnceWith('w3', ['/x/Research'])
  })

  it('YAZ-3343 S24, D14: a frame\'s label names its window — a double click or "Name window" opens the field, ⏎ stores it; "Reset name" goes back to the automatic label', async () => {
    canvas = { allWindows: true, snap: false, cards: [], frames: [] }
    others = [other('w2', ['/w'], [{ path: '/w/y.md', active: true }])]
    const { el } = await mount()
    const label = () => frame(el, 'w2').querySelector<HTMLElement>('.taboverview__frame-label')!
    act(() => void label().dispatchEvent(new MouseEvent('dblclick', { bubbles: true })))
    const input = label().querySelector<HTMLInputElement>('input')!
    expect(document.activeElement).toBe(input)
    act(() => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set?.call(input, 'Research')
      input.dispatchEvent(new Event('input', { bubbles: true }))
    })
    act(() => void input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })))
    expect(storage.setWindowName).toHaveBeenCalledExactlyOnceWith('w2', 'Research')
    expect(document.activeElement).toBe(filter(el))
    // The state broadcast brings the name to every window's board.
    others = [other('w2', ['/w'], [{ path: '/w/y.md', active: true }])]
    act(() => storage.setWindowName('w2', 'Research'))
    await act(async () => {})
    rightClick(label())
    expect(menuItems(el)).toEqual(['Open tabs here…', 'Tidy up this window', 'Name window', 'Reset name'])
    act(() => menuItem(el, 'Reset name')?.click())
    expect(storage.setWindowName).toHaveBeenLastCalledWith('w2', null)
    rightClick(frame(el, 'me').querySelector('.taboverview__frame-label'))
    expect(menuItems(el)).toEqual(['Open tabs here…', 'Tidy up this window', 'Name window'])
  })

  it('YAZ-2648 S45, R29: right-click: a page opens the tab strip\'s own menu, an island its folder\'s — Show in sidebar, Copy path, Close N tabs — and a menu\'s Esc is not the board\'s', async () => {
    const { el, props } = await mount({ reviewState: (path) => (path === '/v/a.md' ? false : null), onSetReview: vi.fn() })
    rightClick(page(el, '/v/a.md'))
    // `TabMenu`, the one the strip's tabs open: the same items in the same order.
    expect(menuItems(el)).toEqual(['Go to tab', 'Move to new window', 'Move to', 'Show in sidebar', 'Copy path', 'Turn review on', 'Reveal in Finder', 'Open in VS Code', 'Close tab'])
    key(el, 'Escape')
    expect(el.querySelector('.ctx-menu')).toBeNull()
    expect(props.onDismiss).not.toHaveBeenCalled()
    rightClick(page(el, '/v/a.md'))
    act(() => menuItem(el, 'Move to')?.click())
    act(() => menuItem(el, 'Right panel')?.click())
    expect(props.onMoveToRight).toHaveBeenCalledExactlyOnceWith('/v/a.md')
    expect(el.querySelector('.ctx-menu')).toBeNull()

    rightClick(island(el, 'Projects').querySelector('.taboverview__island-head'))
    expect(menuItems(el)).toEqual(['Show in sidebar', 'Copy path', 'Tidy up this group', 'Close 3 tabs'])
    act(() => menuItem(el, 'Show in sidebar')?.click())
    expect(props.onShowInSidebar).toHaveBeenLastCalledWith('/v/Projects')
    rightClick(island(el, 'Projects').querySelector('.taboverview__island-head'))
    act(() => menuItem(el, 'Close 3 tabs')?.click())
    expect(props.onCloseTabs).toHaveBeenLastCalledWith(['/v/Projects/plan.md', '/v/Projects/report.pdf', '/v/Projects/Alpha'])

    // A vault's top level: with two or more vaults its row in the sidebar is the vault's; with one there is no such row, and no item.
    rightClick(island(el, 'Work').querySelector('.taboverview__island-head'))
    expect(menuItems(el)).toEqual(['Show in sidebar', 'Copy path', 'Tidy up this group', 'Close 1 tab'])
    act(() => menuItem(el, 'Show in sidebar')?.click())
    expect(props.onShowInSidebar).toHaveBeenLastCalledWith('/w')
    act(() => root?.unmount())
    container?.remove()
    const one = await mount({ roots: ['/v'], vaultNames: ['Notes'], tabs: ['/v/a.md'] })
    rightClick(island(one.el, 'Notes').querySelector('.taboverview__island-head'))
    expect(menuItems(one.el)).toEqual(['Copy path', 'Tidy up this group', 'Close 1 tab'])
  })

  it('YAZ-2940 D5, S5: a page\'s menu has "Duplicate tab" right after "Move to new window"; a click copies that tab by id and leaves the board open', async () => {
    const { el, props } = await mount({ onDuplicate: vi.fn() })
    rightClick(page(el, '/v/Projects/plan.md'))
    expect(menuItems(el).slice(0, 4)).toEqual(['Go to tab', 'Move to new window', 'Duplicate tab', 'Move to'])
    act(() => menuItem(el, 'Duplicate tab')?.click())
    expect(props.onDuplicate).toHaveBeenCalledExactlyOnceWith('/v/Projects/plan.md')
    expect(el.querySelector('.ctx-menu')).toBeNull()
    expect(props.onDismiss).not.toHaveBeenCalled()
    expect(props.onOpen).not.toHaveBeenCalled()
  })

  it('YAZ-3091 D3, S17: a page\'s "Move to ▸" lists the windows asked for ITS page, a line, then "Right panel"; a window row moves that tab by id and leaves the board open', async () => {
    const onMoveTargets = vi.fn((path: string) => (path.startsWith('/w/') ? [] : [{ id: 'w2', label: 'Notes — plan · 3 tabs' }]))
    const { el, props } = await mount({ onMoveTargets })
    rightClick(page(el, '/v/Projects/plan.md'))
    expect(onMoveTargets).toHaveBeenLastCalledWith('/v/Projects/plan.md')
    act(() => menuItem(el, 'Move to')?.click())
    expect([...el.querySelectorAll('.ctx-menu__sub [role="group"]')].map((g) => g.textContent)).toEqual(['Notes — plan · 3 tabs', 'Right panel'])
    act(() => menuItem(el, 'Notes — plan · 3 tabs')?.click())
    // Quiet from the board (D20): the drop's door.
    expect(props.onDropToWindow).toHaveBeenCalledExactlyOnceWith('w2', '/v/Projects/plan.md', '/v/Projects/plan.md')
    expect(el.querySelector('.ctx-menu')).toBeNull()
    expect(props.onDismiss).not.toHaveBeenCalled()
    // A page of a vault no other window shows: only "Right panel" (S1, S3).
    rightClick(page(el, '/w/x.md'))
    act(() => menuItem(el, 'Move to')?.click())
    expect([...el.querySelectorAll('.ctx-menu__sub [role="group"]')].map((g) => g.textContent)).toEqual(['Right panel'])
  })

  it('YAZ-2648 S65 to S69: pick many: shift-click picks and never opens; the bar closes the picked tabs, or the others, and drops the pick; Esc drops the pick before it leaves the board; a plain click still opens', async () => {
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
    expect(menuItems(el).slice(0, 3)).toEqual(['Go to tab', 'Move to new window', 'Move to'])
    key(el, 'Escape') // the menu's

    shiftClick(page(el, '/v/a.md'))
    shiftClick(page(el, '/w/x.md'))
    // A picked page that is closed elsewhere leaves the pick.
    await again({ tabs: TABS.filter((path) => path !== '/w/x.md') })
    expect(texts(el, '.taboverview__pick-count')).toEqual(['1 picked'])
    shiftClick(page(el, '/v/Projects/plan.md'))
    // Two clicks (D27): the first arms it.
    act(() => [...el.querySelectorAll<HTMLButtonElement>('.taboverview__pick button')].find((button) => button.textContent === 'Close them')?.click())
    act(() => [...el.querySelectorAll<HTMLButtonElement>('.taboverview__pick button')].find((button) => button.getAttribute('aria-label') === 'Click again to close 2 tabs')?.click())
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

  it('YAZ-3343 S33, D27, D10, YAZ-3374: the pick bar\'s closes take two clicks — the first turns the button red, in place, with "Click again to close N" above it; a move off it, Esc or a click elsewhere puts it back; with all windows, "Close the others" says the windows too', async () => {
    canvas = { allWindows: true, snap: false, cards: [], frames: [] }
    others = [other('w2', ['/w'], [{ path: '/w/y.md', active: true }, { path: '/w/z.md' }])]
    const { el, props } = await mount()
    // A button by its name: an armed close is named by what its next click does.
    const button = (label: string) => [...el.querySelectorAll<HTMLButtonElement>('.taboverview__pick button')].find((b) => (b.getAttribute('aria-label') ?? b.textContent) === label)
    act(() => void page(el, '/v/a.md')!.dispatchEvent(new MouseEvent('click', { bubbles: true, metaKey: true })))
    /** What each button of the bar shows as its own label: what sets its width in the bar. */
    const labels = () => [...el.querySelectorAll<HTMLButtonElement>('.taboverview__pick button')].map((b) => b.querySelector('.taboverview__pick-label')?.textContent ?? b.textContent)
    const before = labels()
    // The others: this window's five other tabs and w2's two.
    act(() => button('Close the others')!.click())
    // YAZ-3374: the close arms IN PLACE — every button keeps its own label, so none moves, and "Clear" stays under the
    // pointer; what the next click does stands in a hint above the armed button.
    expect(labels()).toEqual(before)
    expect(el.querySelector('.taboverview__pick-hint')?.textContent).toBe('Click again to close 7 tabs in 2 windows')
    expect([vi.mocked(props.onCloseTabs).mock.calls.length, vi.mocked(api.window.closeTabs).mock.calls.length]).toEqual([0, 0])
    const armed = button('Click again to close 7 tabs in 2 windows')!
    expect(armed.className).toContain('taboverview__armed')
    // The pointer off it puts it back.
    act(() => void armed.dispatchEvent(new MouseEvent('mouseout', { bubbles: true, relatedTarget: body(el) })))
    expect(button('Close the others')).toBeDefined()
    // Esc puts it back, and keeps the pick.
    act(() => button('Close the others')!.click())
    key(el, 'Escape')
    expect([button('Close the others') !== undefined, el.querySelector('.taboverview__pick-count')?.textContent]).toEqual([true, '1 picked'])
    // A press elsewhere puts it back.
    act(() => button('Close the others')!.click())
    act(() => void body(el).dispatchEvent(new MouseEvent('mousedown', { bubbles: true })))
    expect(button('Close the others')).toBeDefined()
    // "Close them": two clicks, then the picked tab closes and the pick goes.
    act(() => button('Close them')!.click())
    expect(props.onCloseTabs).not.toHaveBeenCalled()
    act(() => button('Click again to close 1 tab')!.click())
    expect(props.onCloseTabs).toHaveBeenCalledExactlyOnceWith(['/v/a.md'])
    expect(el.querySelector('.taboverview__pick')).toBeNull()
  })

  it('YAZ-3343 S3, D24: the toolbar keeps the keys with the filter box — after a click on the switch or a button, typing still filters', async () => {
    const { el } = await mount()
    const toggle = el.querySelector<HTMLInputElement>('[role="switch"]')!
    // A click on the switch's label focuses its box in a browser; the board takes the focus back.
    toggle.focus()
    act(() => void toggle.closest('label')!.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, detail: 1 })))
    expect(document.activeElement).toBe(filter(el))
    const fit = el.querySelector<HTMLButtonElement>('.taboverview__zoom-fit')!
    fit.focus()
    act(() => void fit.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, detail: 1 })))
    expect(document.activeElement).toBe(filter(el))
  })

  it('YAZ-2648 S62, S63, R36; YAZ-3343 S10, D18: Space held opens the sidebar\'s preview panel for the highlight and closes on release — it opens nothing; it follows the arrows; while a query is being typed Space is a space, until the highlight is moved; a PDF has no panel', async () => {
    const { el, props } = await mount({ previewScope: SCOPE })
    expect(peek(el)).toBeNull()
    // An empty box: Space is the board's, and previews the highlight (the active card to begin with) — the setting is off here.
    expect(taken(el, ' ')).toBe(true)
    await settled()
    expect(peek(el)).toBe('a')
    expect(el.querySelector('.taboverview__peek')).toBeNull() // the old peek is gone: one preview look
    key(el, 'ArrowRight')
    await settled()
    expect(peek(el)).toBe('plan')
    act(() => void window.dispatchEvent(new KeyboardEvent('keyup', { key: ' ' })))
    expect(peek(el)).toBeNull()

    // A query being typed: Space belongs to the box.
    type(el, 'proj')
    expect(taken(el, ' ')).toBe(false)
    expect(peek(el)).toBeNull()
    // The highlight moved by an arrow: Space previews again — a PDF has no panel, as in the sidebar.
    key(el, 'ArrowRight')
    expect(taken(el, ' ')).toBe(true)
    await settled()
    expect(peek(el)).toBeNull()
    act(() => void window.dispatchEvent(new Event('blur')))
    type(el, 'proje')
    expect(taken(el, ' ')).toBe(false)
    act(() => void page(el, '/v/Projects/Alpha/2026-10-08.md')?.dispatchEvent(new MouseEvent('mousemove', { bubbles: true })))
    expect(taken(el, ' ')).toBe(true)
    await settled()
    expect(peek(el)).toBe('2026-10-08')

    expect(props.onOpen).not.toHaveBeenCalled()
    expect(props.onDismiss).not.toHaveBeenCalled()
  })

  it('YAZ-3343 S10, S11, D18: with Preview on hover, resting on a card for the dwell opens its panel beside it (a note, a board); another card switches it; leaving, a drag start or a pan closes it; the hover renders no card', async () => {
    vi.useFakeTimers()
    const { el } = await mount({ previewScope: SCOPE, hoverPreview: true, tabs: [...TABS, '/v/Map.drawio'], active: '/v/a.md' })
    const rest = async (path: string) => {
      act(() => void page(el, path)?.dispatchEvent(new MouseEvent('mousemove', { bubbles: true })))
      await act(async () => void vi.advanceTimersByTime(HOVER_PREVIEW_DWELL_MS))
      await act(async () => void (await Promise.resolve()))
    }
    act(() => void page(el, '/v/a.md')?.dispatchEvent(new MouseEvent('mousemove', { bubbles: true })))
    await act(async () => void vi.advanceTimersByTime(HOVER_PREVIEW_DWELL_MS - 1))
    expect(peek(el)).toBeNull() // not before the dwell
    // The board reads its canvas on each of its renders: the count stands still while only the panel renders.
    const boardRenders = () => vi.mocked(storage.getTabCanvas).mock.calls.length
    const before = boardRenders()
    await act(async () => void vi.advanceTimersByTime(1))
    await settled()
    expect(peek(el)).toBe('a')
    expect(boardRenders()).toBe(before)
    await rest('/v/Map.drawio')
    await settled()
    expect(peek(el)).toBe('/v/Map.drawio')
    act(() => void page(el, '/v/Map.drawio')?.dispatchEvent(new MouseEvent('mouseout', { bubbles: true, relatedTarget: document.body })))
    expect(peek(el)).toBeNull()
    // A drag start closes it, and so does a pan.
    await rest('/w/x.md')
    await settled()
    expect(peek(el)).toBe('x')
    pointer(page(el, '/w/x.md'), 'pointerdown', 0, 0)
    expect(peek(el)).toBeNull()
    pointer(window, 'pointerup', 0, 0)
    await rest('/w/x.md')
    await settled()
    expect(peek(el)).toBe('x')
    pointer(body(el), 'pointerdown', 0, 0)
    expect(peek(el)).toBeNull()
    pointer(window, 'pointerup', 0, 0)
  })

  it('YAZ-3343 S10, D18: with Preview on hover OFF a rest opens nothing — but Space still does', async () => {
    vi.useFakeTimers()
    const { el } = await mount({ previewScope: SCOPE, hoverPreview: false })
    act(() => void page(el, '/w/x.md')?.dispatchEvent(new MouseEvent('mousemove', { bubbles: true })))
    await act(async () => void vi.advanceTimersByTime(HOVER_PREVIEW_DWELL_MS * 3))
    await settled()
    expect(peek(el)).toBeNull()
    expect(taken(el, ' ')).toBe(true)
    await settled()
    expect(peek(el)).toBe('x')
  })

  it('YAZ-2648 S32, S42: leaving: the board zooms out by its own data attribute, and says it left when the zoom is over', async () => {
    vi.useFakeTimers()
    const onLeft = vi.fn()
    const { el, again } = await mount({ onLeft })
    const board = el.querySelector<HTMLElement>('.taboverview')!
    expect(board.dataset.zoom).toBe('in')
    // The zoom's time goes to the element the page layers stand in too, so the two halves take the same time (YAZ-2657 A19).
    expect(el.style.getPropertyValue('--tab-zoom-ms')).toBe(`${ZOOM_MS}ms`)
    await again({ onLeft, leaving: true })
    expect(board.dataset.zoom).toBe('out')
    expect(onLeft).not.toHaveBeenCalled()
    act(() => void vi.advanceTimersByTime(ZOOM_MS))
    expect(onLeft).toHaveBeenCalledTimes(1)
    act(() => root?.unmount())
    expect(el.style.getPropertyValue('--tab-zoom-ms')).toBe('')
  })

  it('YAZ-2648 S55, S59, S61: an empty note shows its title alone, and the title is the index\'s; a second open shows the text it holds before the call answers and takes new text for a new mtime; a call that fails takes no text away', async () => {
    const tabs = ['/v/a-k3m9.md', '/v/empty.md', '/v/only-frontmatter.md']
    const over = { roots: ['/v'], vaultNames: ['Notes'], tabs, active: '/v/a-k3m9.md', preview: null, titles: new Map([['/v/a-k3m9.md', 'Alpha, as titled']]) }
    const heads = (text: string, mtime: number) => tabs.map((path): FileHead => ({ path, mtime, text: path === tabs[0] ? text : '' }))
    const leave = () => {
      act(() => root?.unmount())
      container?.remove()
    }
    readHeads.mockResolvedValueOnce(heads('first text\n', 1))
    let board = await mount(over)
    // S61: the page is named by its title, not by its file name. S55: no text, no lines — a title alone.
    expect(texts(board.el, '.taboverview__title')).toEqual(['Alpha, as titled', 'empty', 'only-frontmatter'])
    expect(texts(board.el, '.taboverview__lines')).toEqual(['first text'])
    leave()

    // S59: the second open asks again, and shows what it holds while main has not answered.
    let answer: (value: (FileHead | null)[]) => void = () => undefined
    readHeads.mockImplementationOnce(() => new Promise((resolve) => (answer = resolve)))
    board = await mount(over)
    expect(readHeads).toHaveBeenCalledTimes(2)
    expect(texts(board.el, '.taboverview__lines')).toEqual(['first text'])
    await act(async () => answer(heads('second text\n', 2)))
    expect(texts(board.el, '.taboverview__lines')).toEqual(['second text'])
    leave()

    // A call that fails whole (A7): the pages keep the text the session holds.
    readHeads.mockRejectedValueOnce(new Error('main is busy'))
    board = await mount(over)
    expect(texts(board.el, '.taboverview__lines')).toEqual(['second text'])
    // …and a page the session holds nothing for is on its title, and is asked for again the next time.
    leave()
    readHeads.mockRejectedValueOnce(new Error('main is busy'))
    board = await mount({ ...over, tabs: [...tabs, '/v/new.md'] })
    expect(texts(board.el, '.taboverview__lines')).toEqual(['second text'])
    await board.again({ ...over, tabs: [...tabs, '/v/new.md'] })
    expect(readHeads).toHaveBeenCalledTimes(4)
  })

  it('a reader hears the highlight (YAZ-2657 A20): the filter box is a combobox over the listbox of pages and names the highlighted one', async () => {
    const { el } = await mount()
    const list = el.querySelector('[role="listbox"]')!
    expect([filter(el).getAttribute('role'), filter(el).getAttribute('aria-expanded'), filter(el).getAttribute('aria-controls')]).toEqual(['combobox', 'true', list.id])
    const named = () => el.querySelector(`#${CSS.escape(filter(el).getAttribute('aria-activedescendant') ?? '')}`)
    expect(named()).toBe(page(el, '/v/a.md'))
    expect(named()?.getAttribute('aria-selected')).toBe('true')
    key(el, 'ArrowRight')
    expect(named()).toBe(page(el, '/v/Projects/plan.md'))
    // Every page has an id of its own.
    const ids = [...el.querySelectorAll('[role="option"]')].map((option) => option.id)
    expect(new Set(ids).size).toBe(TABS.length)
  })

  it('"Kill all tabs" (YAZ-2739 S1 to S3, S21): a button on the board while a tab is open, under filter text too; it asks App and closes nothing itself; with no tab, or with no door, there is no button', async () => {
    const onKillAll = vi.fn()
    const { el, props, again } = await mount({ onKillAll })
    const kill = () => el.querySelector<HTMLButtonElement>('.taboverview__kill')
    expect(kill()?.textContent).toBe('Kill all tabs')

    // Text in the filter hides pages, and the button is the same one: it is about every tab (D4).
    type(el, 'plan')
    expect(texts(el, '.taboverview__title').length).toBeLessThan(TABS.length)
    act(() => kill()?.click())
    expect(onKillAll).toHaveBeenCalledTimes(1)
    expect(props.onCloseTabs).not.toHaveBeenCalled()

    await again({ tabs: [] })
    expect(kill()).toBeNull()
    await again({ onKillAll: undefined })
    expect(kill()).toBeNull()
  })

  it('a menu of the strip that is open has the keys (YAZ-2739 S8): the grid button\'s menu leaves the focus in the filter box, and its Esc is not the board\'s', async () => {
    const { el, props } = await mount()
    const stripMenu = document.createElement('div')
    stripMenu.className = 'ctx-menu'
    document.body.appendChild(stripMenu)
    key(el, 'Escape')
    key(el, 'Enter')
    expect([props.onDismiss, props.onOpen].map((door) => vi.mocked(door).mock.calls.length)).toEqual([0, 0])
    stripMenu.remove()
    key(el, 'Escape')
    expect(props.onDismiss).toHaveBeenCalledTimes(1)
  })

  it('YAZ-2648 R45: tells the strip which page it highlights: the pointer and the arrows move it, and a board that goes lets go', async () => {
    const { el } = await mount()
    expect(boardHighlight()).toBe('/v/a.md')
    act(() => void page(el, '/v/Projects/Alpha')?.dispatchEvent(new MouseEvent('mousemove', { bubbles: true })))
    expect(boardHighlight()).toBe('/v/Projects/Alpha')
    act(() => root?.unmount())
    expect(boardHighlight()).toBeNull()
  })
})

describe('plainLines (S54)', () => {
  it('takes Markdown\'s marks off, and no text with them: emphasis of one mark, a code fence with a language, "<" and ">" in plain text, a table row', () => {
    expect(plainLines('An *italic* and _also_ word')).toBe('An italic and also word')
    expect(plainLines('```ts\nconst a = 1\n```\n~~~\ntilde\n~~~')).toBe('const a = 1\ntilde')
    expect(plainLines('a < b and c > d, <b>bold</b> and a <br/> break')).toBe('a < b and c > d, bold and a break')
    expect(plainLines('| Name | Role |\n| --- | :-: |\n| Ana | Lead |')).toBe('Name | Role\nAna | Lead')
    // What is no mark stays: a name with underscores, a sum.
    expect(plainLines('snake_case_name is 2 * 3 * 4')).toBe('snake_case_name is 2 * 3 * 4')
  })

  it('reads a character reference by number as its character (YAZ-2751): the space the editor writes at the start of a heading is no text, so the heading is the title again; a reference that names a "<" makes no tag; what is no reference stays', () => {
    // The editor saves "#  Welcome" as "# &#x20;Welcome": the page shows the title once, and no "&#x20;".
    expect(plainLines('# &#x20;Welcome\n\nSome text')).toBe('Welcome\nSome text')
    expect(withoutTitle(plainLines('# &#x20;Welcome\n\nSome text'), 'Welcome')).toBe('Some text')
    expect(plainLines('ends with a space&#32;\ncaf&#xE9; &#128512;')).toBe('ends with a space\ncafé 😀')
    // Decoded last: a "<" that came from a reference is text, never the start of a tag.
    expect(plainLines('a &#x3C;b> c')).toBe('a <b> c')
    expect(plainLines('R&D costs &# 12; and &#xZZ; and &#0;')).toBe('R&D costs &# 12; and &#xZZ; and &#0;')
  })
})

describe('TabOverview display name (YAZ-2949 D4, D5)', () => {
  afterEach(() => {
    act(() => root?.unmount())
    root = null
    container?.remove()
    container = null
  })

  it('YAZ-2949 S2, S3, S12: "Set display name" puts a field on the page; a click and keys in it stay there; ⏎ saves; a named page shows its name, with the page name in its tooltip', async () => {
    const onSetName = vi.fn()
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
    const tabs = [{ id: 't1', path: '/v/a.md', name: 'Outline' }, { id: 't2', path: '/w/x.md' }]
    const onOpen = vi.fn()
    await act(async () => root?.render(<IdTabOverview roots={['/v', '/w']} vaultNames={['Notes', 'Work']} tabs={tabs} active="t1" preview={null} titles={new Map([['/v/a.md', 'Plan']])} windowId="me" onOpen={onOpen} onCloseTabs={vi.fn()} onDismiss={vi.fn()} onSetName={onSetName} onDropToWindow={vi.fn()} onMoveTab={vi.fn()} onMoveToNewWindowQuietly={vi.fn()} />))
    const el = container
    const card = page(el, 't1')!
    expect(card.querySelector('.taboverview__title')?.textContent).toBe('Outline')
    expect(card.title).toBe('Plan\n/v/a.md')
    expect(page(el, 't2')!.title).toBe('/w/x.md')
    rightClick(page(el, 't2'))
    expect(menuItem(el, 'Reset to page name')).toBeUndefined()
    act(() => menuItem(el, 'Set display name')?.click())
    const input = el.querySelector<HTMLInputElement>('.taboverview__rename')!
    expect(document.activeElement).toBe(input)
    // A press on the field is the field's: it starts no drag of the card.
    expect(page(el, 't2')!.getAttribute('draggable')).toBeNull()
    act(() => void input.dispatchEvent(new MouseEvent('click', { bubbles: true })))
    expect(onOpen).not.toHaveBeenCalled()
    const typed = new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true, cancelable: true })
    act(() => void input.dispatchEvent(typed))
    expect(typed.defaultPrevented).toBe(false) // the board did not take the key
    act(() => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set?.call(input, 'Inbox')
      input.dispatchEvent(new Event('input', { bubbles: true }))
    })
    act(() => void input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })))
    expect(onSetName).toHaveBeenCalledExactlyOnceWith('t2', 'Inbox')
    expect(el.querySelector('.taboverview__rename')).toBeNull()
    rightClick(page(el, 't1'))
    act(() => menuItem(el, 'Reset to page name')?.click())
    expect(onSetName).toHaveBeenLastCalledWith('t1', null)
  })

  it('Esc in the field cancels and gives the keys back to the board: the next Esc closes the board; a right-click in the field opens no menu', async () => {
    const onDismiss = vi.fn()
    const onSetName = vi.fn()
    const { el } = await mount({ onDismiss, onSetName })
    rightClick(page(el, '/v/a.md'))
    act(() => menuItem(el, 'Set display name')?.click())
    const input = el.querySelector<HTMLInputElement>('.taboverview__rename')!
    rightClick(input)
    expect(el.querySelector('.ctx-menu')).toBeNull()
    act(() => void input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })))
    expect(el.querySelector('.taboverview__rename')).toBeNull()
    expect(onSetName).not.toHaveBeenCalled()
    expect(onDismiss).not.toHaveBeenCalled()
    expect(document.activeElement).toBe(filter(el))
    key(el, 'Escape')
    expect(onDismiss).toHaveBeenCalledTimes(1)
  })
})
