/**
 * The window tab strip (Tabs I2/I3, GRO-2234/2235): tablist semantics per the ViewTabs
 * pattern, extension-stripped labels with full-path tooltips, the close
 * affordances (✕, middle-click) vs activation, drag-to-reorder with the gap at the drop place,
 * and the active tab scrolled into view on activation. Plus the right-click Copy path menu
 * (YAZ-922) and the ◀ ▶ history buttons (YAZ-721).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { NAV_HOLD_MS, TabBar as IdTabBar, type TabBarProps as IdTabBarProps } from './TabBar'
import tabsCss from './tabs.css?inline'
import { WORKSPACE_PAGE_MIME } from '../workspace/pageDrag'
import { setBoardHighlight } from './boardHighlight'
import { holdOverStrip, releaseOverStrip } from './stripDrop'
import { IconsContext } from '../sidebar/FileIcon'
import { buildRowIcons, rowIcon } from '../sidebar/rowIcons'

// The OS-action items call the bridge (YAZ-963): stub the verbs, keep BridgeRequestError real.
vi.mock('../api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../api')>()),
  api: { tree: vi.fn(), shell: { reveal: vi.fn().mockResolvedValue({}), openVsCode: vi.fn().mockResolvedValue({}) } },
}))
import { api, BridgeRequestError } from '../api'
import { fetchTree } from '../lib/treeFeed'
const reveal = vi.mocked(api.shell.reveal)
const openVsCode = vi.mocked(api.shell.openVsCode)

;(globalThis as unknown as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true

/** These tests name each tab by its path: with no copies, a tab's id here is its path (YAZ-2940 D1). The window is w1 unless a test says otherwise (YAZ-3637). */
type TabBarProps = Omit<IdTabBarProps, 'tabs' | 'windowId'> & { tabs: readonly string[]; windowId?: string }
function TabBar({ tabs, windowId = 'w1', ...props }: TabBarProps) {
  return <IdTabBar windowId={windowId} tabs={tabs.map((path) => ({ id: path, path }))} {...props} />
}

let root: Root | null = null
let container: HTMLElement | null = null

function mount(props: Omit<TabBarProps, 'roots' | 'titles'> & Partial<Pick<TabBarProps, 'roots' | 'titles'>>) {
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  act(() => root?.render(<TabBar roots={['/v']} titles={new Map()} {...props} />))
  return container
}

afterEach(() => {
  act(() => root?.unmount())
  root = null
  container?.remove()
  container = null
})

/** The history props (YAZ-721) the tab tests don't exercise: nowhere to go, nothing wired. */
const noNav = { canBack: false, canForward: false, onBack: vi.fn(), onForward: vi.fn() }

/**
 * jsdom has no layout, and a drag reads its slot from where the layout puts each tab (YAZ-3808 6A). `layTabsOut` puts
 * tab i of a strip at 100·i, 100 px wide; `xOn` gives a client x `dx` from the middle of a tab — negative is its left
 * half, the rest its right — and leaves any other target's x as it is.
 */
const OFFSET_LEFT = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'offsetLeft')!
const OFFSET_WIDTH = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'offsetWidth')!
const tabIndex = (el: Element): number => (el instanceof HTMLElement && el.dataset.tab !== undefined ? [...el.parentElement!.querySelectorAll('[data-tab]')].indexOf(el) : -1)
const layTabsOut = () => {
  Object.defineProperty(HTMLElement.prototype, 'offsetLeft', { configurable: true, get: function (this: HTMLElement) { return Math.max(0, tabIndex(this)) * 100 } })
  Object.defineProperty(HTMLElement.prototype, 'offsetWidth', { configurable: true, get: function (this: HTMLElement) { return tabIndex(this) === -1 ? 0 : 100 } })
}
const putLayoutBack = () => {
  Object.defineProperty(HTMLElement.prototype, 'offsetLeft', OFFSET_LEFT)
  Object.defineProperty(HTMLElement.prototype, 'offsetWidth', OFFSET_WIDTH)
}
const xOn = (target: Element, dx: number): number => (tabIndex(target) === -1 ? dx : tabIndex(target) * 100 + 50 + dx)

describe('TabBar', () => {
  const noop = { onActivate: vi.fn(), onClose: vi.fn(), onMove: vi.fn() }

  it('"Kill all tabs" (YAZ-2739 S4 to S9): a right-click on the grid button opens a menu of ONE danger item, which asks App; a plain click opens no menu; Esc closes it and asks nothing; with no tab the item is disabled; with no door there is no menu', () => {
    const onKillAll = vi.fn()
    const onToggleOverview = vi.fn()
    const base = { active: '/v/a.md', onToggleOverview, ...noop, ...noNav }
    const el = mount({ tabs: ['/v/a.md', '/v/b.md'], onKillAll, ...base })
    const grid = () => el.querySelector<HTMLButtonElement>('[aria-label="Show all open tabs"]')!
    const items = () => [...el.querySelectorAll<HTMLButtonElement>('.ctx-menu [role="menuitem"]')]
    const rightClick = (): boolean => {
      const event = new MouseEvent('contextmenu', { bubbles: true, cancelable: true })
      act(() => void grid().dispatchEvent(event))
      return event.defaultPrevented
    }

    act(() => grid().click())
    expect(onToggleOverview).toHaveBeenCalledTimes(1)
    expect(items()).toEqual([])

    expect(rightClick()).toBe(true)
    expect(items().map((item) => [item.textContent, item.className, item.disabled])).toEqual([['Kill all tabs', 'ctx-menu__item ctx-menu__item--danger', false]])
    act(() => void window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' })))
    expect(items()).toEqual([])
    expect(onKillAll).not.toHaveBeenCalled()

    // Neither the right press on the button nor the press on the item takes the keyboard focus: under
    // the board it stays in the filter box, so a sheet that is cancelled gives the keys back to the board.
    const press = (target: Element, button: number): boolean => {
      const event = new MouseEvent('mousedown', { bubbles: true, cancelable: true, button })
      act(() => void target.dispatchEvent(event))
      return event.defaultPrevented
    }
    expect([press(grid(), 0), press(grid(), 2)]).toEqual([false, true])
    rightClick()
    expect(press(items()[0], 0)).toBe(true)
    act(() => items()[0].click())
    expect(onKillAll).toHaveBeenCalledTimes(1)
    expect(items()).toEqual([])
    expect(onToggleOverview).toHaveBeenCalledTimes(1) // the menu is no click on the button

    // No tab: the item says so, and asks nothing.
    act(() => root?.render(<TabBar roots={['/v']} titles={new Map()} tabs={[]} onKillAll={onKillAll} {...base} active={null} />))
    rightClick()
    expect(items().map((item) => [item.className, item.disabled])).toEqual([['ctx-menu__item', true]])
    act(() => items()[0].click())
    expect(onKillAll).toHaveBeenCalledTimes(1)
    act(() => void window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' })))

    // No door: the button has no menu of its own.
    act(() => root?.render(<TabBar roots={['/v']} titles={new Map()} tabs={['/v/a.md']} {...base} />))
    expect(rightClick()).toBe(false)
    expect(items()).toEqual([])
  })

  it('the grid menu\'s saves (YAZ-3147 D5, S2–S4): "Save tabs as session" and "Save and close all tabs", a line, then "Kill all tabs"; each asks App; with no tab all three are grey and ask nothing', () => {
    const onKillAll = vi.fn()
    const onSaveSession = vi.fn()
    const base = { active: '/v/a.md', onToggleOverview: vi.fn(), onKillAll, onSaveSession, ...noop, ...noNav }
    const el = mount({ tabs: ['/v/a.md'], ...base })
    const grid = () => el.querySelector<HTMLButtonElement>('[aria-label="Show all open tabs"]')!
    const items = () => [...el.querySelectorAll<HTMLButtonElement>('.ctx-menu [role="menuitem"]')]
    const groups = () => [...el.querySelectorAll('.ctx-menu [role="group"]')].map((g) => [...g.querySelectorAll('[role="menuitem"]')].map((i) => i.textContent))
    const rightClick = () => act(() => void grid().dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true })))

    rightClick()
    expect(groups()).toEqual([['Save tabs as session', 'Save and close all tabs'], ['Kill all tabs']])
    expect(items().map((item) => [item.className, item.disabled])).toEqual([['ctx-menu__item', false], ['ctx-menu__item', false], ['ctx-menu__item ctx-menu__item--danger', false]])
    act(() => items()[0].click())
    expect(onSaveSession).toHaveBeenLastCalledWith(false)
    expect(items()).toEqual([])
    rightClick()
    act(() => items()[1].click())
    expect(onSaveSession).toHaveBeenLastCalledWith(true)
    expect(onSaveSession).toHaveBeenCalledTimes(2)
    expect(onKillAll).not.toHaveBeenCalled()

    act(() => root?.render(<TabBar roots={['/v']} titles={new Map()} tabs={[]} {...base} active={null} />))
    rightClick()
    expect(items().map((item) => item.disabled)).toEqual([true, true, true])
    for (const item of items()) act(() => item.click())
    expect(onSaveSession).toHaveBeenCalledTimes(2)
    expect(onKillAll).not.toHaveBeenCalled()
  })

  it('renders a labelled tablist: one role=tab per path, extension-stripped label, full path as tooltip', () => {
    const el = mount({ tabs: ['/v/Note.md', '/v/sub/Plan.markdown'], active: '/v/Note.md', ...noop, ...noNav })
    expect(el.querySelector('.tabbar')?.getAttribute('role')).toBe('tablist')
    expect(el.querySelector('.tabbar')?.getAttribute('aria-label')).toBe('Open files')
    const tabsEls = [...el.querySelectorAll<HTMLButtonElement>('[role="tab"]')]
    expect(tabsEls.map((t) => t.textContent)).toEqual(['Note', 'Plan'])
    expect(tabsEls.map((t) => t.title)).toEqual(['/v/Note.md', '/v/sub/Plan.markdown'])
  })

  it('the preview tab wears the preview class and a double click on a tab asks to keep it (YAZ-2648 D1, D2); the grid button after ▶ toggles the overview and is pressed while it shows (D8)', () => {
    const onKeep = vi.fn()
    const onToggleOverview = vi.fn()
    const el = mount({ tabs: ['/v/a.md', '/v/b.md'], active: '/v/a.md', preview: '/v/b.md', onKeep, onToggleOverview, overviewOpen: true, ...noop, ...noNav })
    expect([...el.querySelectorAll('.tabbar__tab--preview [role="tab"]')].map((t) => t.textContent)).toEqual(['b'])
    act(() => void el.querySelectorAll('[role="tab"]')[1].dispatchEvent(new MouseEvent('dblclick', { bubbles: true })))
    expect(onKeep).toHaveBeenCalledExactlyOnceWith('/v/b.md')

    const nav = [...el.querySelectorAll<HTMLButtonElement>('.tabbar-nav__btn')]
    expect(nav.map((b) => b.getAttribute('aria-label'))).toEqual(['Back', 'Forward', 'Show all open tabs'])
    expect([nav[2].title, nav[2].getAttribute('aria-pressed')]).toEqual(['Show all open tabs (⌘⇧M)', 'true'])
    act(() => nav[2].click())
    expect(onToggleOverview).toHaveBeenCalledTimes(1)
  })

  it('the blank tab (YAZ-2655 D10) is the last tab, named "New tab", and the active one while it shows: its ✕ and a middle click close it, it does not drag and has no menu; the "+" stands after the tabs, outside the scroller (S87)', () => {
    const onNewTab = vi.fn()
    const onCloseBlank = vi.fn()
    const onClose = vi.fn()
    const el = mount({ tabs: ['/v/a.md', '/v/b.md'], active: '/v/a.md', blank: true, onNewTab, onCloseBlank, ...noop, onClose, ...noNav })
    const tabs = [...el.querySelectorAll<HTMLButtonElement>('.tabbar [role="tab"]')]
    expect(tabs.map((t) => [t.textContent, t.getAttribute('aria-selected')])).toEqual([['a', 'false'], ['b', 'false'], ['New tab', 'true']])
    const blank = tabs[2].closest<HTMLElement>('.tabbar__tab')!
    expect(blank.className).toContain('tabbar__tab--active')
    expect(blank.draggable).toBe(false)
    act(() => blank.querySelector<HTMLButtonElement>('[aria-label="Close New tab"]')?.click())
    act(() => void tabs[2].dispatchEvent(new MouseEvent('auxclick', { bubbles: true, button: 1 })))
    expect(onCloseBlank).toHaveBeenCalledTimes(2)
    expect(onClose).not.toHaveBeenCalled()
    act(() => void blank.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true })))
    expect(el.querySelector('.ctx-menu')).toBeNull()

    const plus = el.querySelector<HTMLButtonElement>('button[aria-label="New tab"]')!
    expect(plus.title).toBe('New tab (⌘T)')
    // After the tabs, and no child of the scroller: it stays on show when the strip scrolls.
    expect(plus.closest('.tabbar')).toBeNull()
    expect(el.querySelector('.tabbar')?.compareDocumentPosition(plus)).toBe(Node.DOCUMENT_POSITION_FOLLOWING)
    act(() => plus.click())
    expect(onNewTab).toHaveBeenCalledTimes(1)
  })

  it('the tooltips name the keys as they are NOW (YAZ-3410 item 3): a changed key, and no key at all', () => {
    const base = { tabs: ['/v/a.md'], active: '/v/a.md', onNewTab: vi.fn(), onToggleOverview: vi.fn(), ...noop, ...noNav }
    const titles = (el: HTMLElement) => [el.querySelector<HTMLButtonElement>('button[aria-label="New tab"]')?.title, el.querySelector<HTMLButtonElement>('[aria-label="Show all open tabs"]')?.title]
    expect(titles(mount({ ...base, hotkeys: { newTab: 'CmdOrCtrl+Alt+T', tabOverview: null } }))).toEqual(['New tab (⌥⌘T)', 'Show all open tabs'])
  })

  it('E: a tab is labelled with its title, a folder tab with its folder\'s; one the index does not hold keeps its file name (YAZ-2420 D14)', () => {
    const titles = new Map([['/v/up-001-abdul-k3m9x2pq7abc.md', 'UP-001 - Abdul'], ['/v/upwork', 'Upwork 2026']])
    const el = mount({ tabs: ['/v/up-001-abdul-k3m9x2pq7abc.md', '/v/upwork', '/v/scan.pdf'], active: '/v/scan.pdf', titles, ...noop, ...noNav })
    expect([...el.querySelectorAll('[role="tab"]')].map((t) => t.textContent)).toEqual(['UP-001 - Abdul', 'Upwork 2026', 'scan.pdf'])
    expect(el.querySelector('[aria-label="Close UP-001 - Abdul"]')).not.toBeNull()
  })

  it('a FOLDER tab is labelled with the folder name, dots and all (YAZ-2290 D3)', () => {
    const el = mount({ tabs: ['/v/v1.2', '/v/Projects'], active: '/v/v1.2', ...noop, ...noNav })
    expect([...el.querySelectorAll('[role="tab"]')].map((t) => t.textContent)).toEqual(['v1.2', 'Projects'])
  })

  it('a folder named like a file keeps its whole name once the Files tree says it is a folder (YAZ-2290)', async () => {
    const el = mount({ roots: ['/named'], tabs: ['/named/Notes.md', '/named/Plan.md'], active: '/named/Notes.md', ...noop, ...noNav })
    const labels = () => [...el.querySelectorAll('[role="tab"]')].map((t) => t.textContent)
    expect(labels()).toEqual(['Notes', 'Plan']) // no tree yet: nothing says it is a folder
    vi.mocked(api.tree).mockResolvedValueOnce({ root: '/named', tree: [{ type: 'dir', name: 'Notes.md', path: '/named/Notes.md', children: [] }], generatedAt: 1 })
    await act(async () => void (await fetchTree('/named')))
    expect(labels()).toEqual(['Notes.md', 'Plan'])
    expect(el.querySelector('[aria-label="Close Notes.md"]')).not.toBeNull()
  })

  it("each tab shows its file's tree icon before its name: a folder page the folder's, a display name its file's, a file outside the vaults Material's (YAZ-3440 D11)", async () => {
    const icons = buildRowIcons({ '/v': { paths: { '/v/mine.md': 'lua', '/out/b.md': 'lua' } } }, ['/v'], [], true)
    container = document.body.appendChild(document.createElement('div'))
    root = createRoot(container)
    vi.mocked(api.tree).mockResolvedValueOnce({ root: '/v', tree: [{ type: 'dir', name: 'src', path: '/v/src', children: [] }], generatedAt: 1 })
    const tabs = [{ id: 'a', path: '/v/a.ts' }, { id: 'm', path: '/v/mine.md', name: 'My page' }, { id: 's', path: '/v/src' }, { id: 'o', path: '/out/b.md' }]
    act(() => root?.render(<IconsContext.Provider value={{ rowIcons: icons, roots: ['/v'] }}><IdTabBar roots={['/v']} titles={new Map()} windowId="w1" tabs={tabs} active="a" {...noop} {...noNav} /></IconsContext.Provider>))
    await act(async () => void (await fetchTree('/v')))
    const icon = (id: string) => container!.querySelector<HTMLElement>(`[data-tab="${id}"] .tabbar__label > .file-icon:first-child`)!
    // The same id the tree row of that path shows.
    expect(icon('a').dataset.icon).toBe(rowIcon(icons, '/v/a.ts', 'a.ts', 'file').id)
    expect(icon('m').dataset.icon).toBe('lua')
    expect(icon('m').hasAttribute('data-icon-custom')).toBe(true)
    expect(container!.querySelector('[data-tab="m"] .tabbar__label')?.textContent).toBe('My page')
    expect(icon('s').className).toBe('file-icon file-icon--dir')
    expect(icon('s').dataset.icon).toBe('folder-src')
    expect(icon('o').dataset.icon).toBe('markdown')
    expect(icon('o').hasAttribute('data-icon-custom')).toBe(false)
  })

  it("a board tab holds its extension after its name, for File icons Off to show (YAZ-3536 D4); a display name, a folder page and a note hold none", async () => {
    container = document.body.appendChild(document.createElement('div'))
    root = createRoot(container)
    vi.mocked(api.tree).mockResolvedValueOnce({ root: '/v', tree: [{ type: 'dir', name: 'Plan.drawio', path: '/v/Plan.drawio', children: [] }], generatedAt: 1 })
    const tabs = [{ id: 'f', path: '/v/Flow.drawio' }, { id: 'n', path: '/v/Map.excalidraw', name: 'Roadmap' }, { id: 'd', path: '/v/Plan.drawio' }, { id: 'a', path: '/v/a.md' }]
    act(() => root?.render(<IdTabBar roots={['/v']} titles={new Map()} windowId="w1" tabs={tabs} active="f" {...noop} {...noNav} />))
    await act(async () => void (await fetchTree('/v')))
    const ending = (id: string) => container!.querySelector(`[data-tab="${id}"] .tabbar__label .name-ending`)
    expect(ending('f')?.textContent).toBe('.drawio')
    expect(container!.querySelector('[data-tab="f"] .tabbar__label')?.textContent).toBe('Flow.drawio') // hidden by app.css unless File icons Off
    expect([ending('n'), ending('d'), ending('a')]).toEqual([null, null, null])
  })

  it('marks only the active tab: aria-selected + the active modifier', () => {
    const el = mount({ tabs: ['/v/a.md', '/v/b.md'], active: '/v/b.md', ...noop, ...noNav })
    expect([...el.querySelectorAll('[role="tab"]')].map((t) => t.getAttribute('aria-selected'))).toEqual(['false', 'true'])
    expect([...el.querySelectorAll('.tabbar__tab')].map((t) => t.classList.contains('tabbar__tab--active'))).toEqual([false, true])
  })

  it('clicking a tab activates it; the ✕ (labelled per file) closes it without activating', () => {
    const onActivate = vi.fn()
    const onClose = vi.fn()
    const el = mount({ tabs: ['/v/a.md', '/v/b.md'], active: '/v/a.md', onActivate, onClose, onMove: vi.fn(), ...noNav })
    act(() => el.querySelectorAll<HTMLButtonElement>('[role="tab"]')[1]?.click())
    expect(onActivate).toHaveBeenCalledWith('/v/b.md')
    act(() => el.querySelector<HTMLButtonElement>('[aria-label="Close b"]')?.click())
    expect(onClose).toHaveBeenCalledWith('/v/b.md')
    expect(onActivate).toHaveBeenCalledTimes(1)
  })

  it('middle-click closes a tab (the browser-tab convention); other aux buttons do nothing', () => {
    const onClose = vi.fn()
    const el = mount({ tabs: ['/v/a.md'], active: '/v/a.md', onActivate: vi.fn(), onClose, onMove: vi.fn(), ...noNav })
    const tab = el.querySelector<HTMLButtonElement>('[role="tab"]')
    act(() => void tab?.dispatchEvent(new MouseEvent('auxclick', { button: 1, bubbles: true })))
    expect(onClose).toHaveBeenCalledWith('/v/a.md')
    act(() => void tab?.dispatchEvent(new MouseEvent('auxclick', { button: 2, bubbles: true })))
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('renders an empty strip with no tabs (rule 2: the strip shows whenever a folder is open)', () => {
    const el = mount({ tabs: [], active: null, ...noop, ...noNav })
    expect(el.querySelector('.tabbar')).not.toBeNull()
    expect(el.querySelectorAll('[role="tab"]')).toHaveLength(0)
  })
})

describe('TabBar drag-to-reorder (I3, GRO-2235)', () => {
  const TABS = ['/v/a.md', '/v/b.md', '/v/c.md']
  const tabAt = (el: HTMLElement, i: number) => [...el.querySelectorAll<HTMLElement>('.tabbar__tab')][i]
  beforeEach(layTabsOut)
  afterEach(putLayoutBack)
  /**
   * Drag events bubble like the real thing; jsdom has no DragEvent, the handlers guard
   * `dataTransfer` (the groupDrag idiom). On a tab, the sign of clientX is the half:
   * negative = before the tab, else after (`xOn`).
   */
  const fire = (target: Element, type: string, clientX = 0) =>
    act(() => void target.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true, clientX: xOn(target, clientX) })))
  /** The frame after a drag starts, when the grabbed tab leaves the strip (YAZ-3808 6A). */
  const nextFrame = () => act(() => new Promise<void>((done) => requestAnimationFrame(() => done())))

  it('dropping past a tab\'s midpoint calls onMove with the final index; the grab class and the gap classes mark the drag', async () => {
    const onMove = vi.fn()
    const el = mount({ tabs: TABS, active: '/v/a.md', onActivate: vi.fn(), onClose: vi.fn(), onMove, ...noNav })
    fire(tabAt(el, 0), 'dragstart')
    // The Mac takes the tab's picture first: the tab leaves the strip one frame later (YAZ-3808 6A).
    expect(tabAt(el, 0).classList.contains('tabbar__tab--dragging')).toBe(false)
    await nextFrame()
    expect(tabAt(el, 0).classList.contains('tabbar__tab--dragging')).toBe(true)
    fire(tabAt(el, 2), 'dragover', 5) // right half of c → the end slot: the tabs part after the last one (--gap-after)
    expect(tabAt(el, 2).classList.contains('tabbar__tab--gap-after')).toBe(true)
    fire(tabAt(el, 2), 'drop', 5)
    expect(onMove).toHaveBeenCalledWith(0, 2) // a lands last
    expect(el.querySelector('.tabbar__tab--dragging')).toBeNull() // drag state cleared
  })

  it('dropping on a tab\'s left half inserts BEFORE it: the tabs part there (--gap-before on that tab)', () => {
    const onMove = vi.fn()
    const el = mount({ tabs: TABS, active: '/v/a.md', onActivate: vi.fn(), onClose: vi.fn(), onMove, ...noNav })
    fire(tabAt(el, 0), 'dragstart')
    fire(tabAt(el, 2), 'dragover', -5)
    expect(tabAt(el, 2).classList.contains('tabbar__tab--gap-before')).toBe(true)
    fire(tabAt(el, 2), 'drop', -5)
    expect(onMove).toHaveBeenCalledWith(0, 1) // before c, after the grab point shifted one left
  })

  it('S89: the gap opens only where a drop would move the tab — not on either side of the grabbed tab — and the strip\'s tail after the "+" is the end slot too', () => {
    const onMove = vi.fn()
    const el = mount({ tabs: TABS, active: '/v/a.md', onActivate: vi.fn(), onClose: vi.fn(), onMove, onNewTab: vi.fn(), ...noNav })
    const gaps = () => [...el.querySelectorAll('.tabbar__tab--gap-before, .tabbar__tab--gap-after')].map((tab) => tab.textContent?.replace('✕', ''))
    fire(tabAt(el, 1), 'dragstart')
    fire(tabAt(el, 1), 'dragover', -5) // before itself
    expect(gaps()).toEqual([])
    fire(tabAt(el, 1), 'dragover', 5) // after itself
    expect(gaps()).toEqual([])
    fire(tabAt(el, 0), 'dragover', -5)
    expect(gaps()).toEqual(['a'])
    // The tail: the row's room after the "+", which a drag can drop on as on the strip's own end.
    const tail = el.querySelector<HTMLElement>('.tabbar-tail')!
    expect(tail.previousElementSibling?.getAttribute('aria-label')).toBe('New tab')
    fire(tail, 'dragover')
    expect(gaps()).toEqual(['c'])
    fire(tail, 'drop')
    expect(onMove).toHaveBeenCalledExactlyOnceWith(1, 2) // b lands last: the same order the rule always gave
    expect(gaps()).toEqual([])
  })

  it('dropping back on the grabbed slot is a no-op; dragend clears an abandoned drag', () => {
    const onMove = vi.fn()
    const el = mount({ tabs: TABS, active: '/v/a.md', onActivate: vi.fn(), onClose: vi.fn(), onMove, ...noNav })
    fire(tabAt(el, 1), 'dragstart')
    fire(tabAt(el, 1), 'drop', -5) // before itself = its own slot
    expect(onMove).not.toHaveBeenCalled()
    fire(tabAt(el, 1), 'dragstart')
    fire(tabAt(el, 1), 'dragend')
    expect(el.querySelector('.tabbar__tab--dragging')).toBeNull()
  })

  it('writes the private main-owner payload instead of exposing a text/plain path — with this window, the copy and the vault\'s index, so another window can take it (YAZ-3637 D1)', () => {
    const data = {
      types: [] as string[],
      effectAllowed: 'none',
      setData: vi.fn(),
      getData: vi.fn(() => ''),
    } as unknown as DataTransfer
    const el = mount({ roots: ['/u', '/v'], tabs: TABS, active: '/v/a.md', onActivate: vi.fn(), onClose: vi.fn(), onMove: vi.fn(), ...noNav })
    const event = new MouseEvent('dragstart', { bubbles: true, cancelable: true })
    Object.defineProperty(event, 'dataTransfer', { value: data })
    act(() => void tabAt(el, 0).dispatchEvent(event))
    expect(data.setData).toHaveBeenCalledTimes(2)
    expect(data.setData).toHaveBeenCalledWith(
      WORKSPACE_PAGE_MIME,
      JSON.stringify({ path: '/v/a.md', owner: 'main', from: 'w1', copy: 0 }),
    )
    expect(data.setData).toHaveBeenCalledWith('application/x-yaseen-from-w1.1', '1')
    expect(data.effectAllowed).toBe('move')
  })

  it('a second tab of one page drags as copy 1 (YAZ-3637 D1: the ref another window sends back)', () => {
    const data = { types: [] as string[], effectAllowed: 'none', setData: vi.fn(), getData: vi.fn(() => '') } as unknown as DataTransfer
    const el = mount({ tabs: ['/v/a.md', '/v/b.md', '/v/a.md'], active: '/v/a.md', onActivate: vi.fn(), onClose: vi.fn(), onMove: vi.fn(), ...noNav })
    const event = new MouseEvent('dragstart', { bubbles: true, cancelable: true })
    Object.defineProperty(event, 'dataTransfer', { value: data })
    act(() => void tabAt(el, 2).dispatchEvent(event))
    expect(data.setData).toHaveBeenCalledWith(WORKSPACE_PAGE_MIME, JSON.stringify({ path: '/v/a.md', owner: 'main', from: 'w1', copy: 1 }))
  })

  it('accepts one validated right-owner drop at a before/end insertion slot and ignores foreign data', () => {
    const onDropPage = vi.fn()
    const el = mount({ tabs: TABS, active: '/v/a.md', onActivate: vi.fn(), onClose: vi.fn(), onMove: vi.fn(), onDropPage, ...noNav })
    const fireData = (target: Element, type: string, data: DataTransfer, clientX = 0): MouseEvent => {
      const event = new MouseEvent(type, { bubbles: true, cancelable: true, clientX: xOn(target, clientX) })
      Object.defineProperty(event, 'dataTransfer', { value: data })
      act(() => void target.dispatchEvent(event))
      return event
    }
    const data = {
      types: [WORKSPACE_PAGE_MIME],
      effectAllowed: 'move',
      dropEffect: 'none',
      getData: vi.fn(() => JSON.stringify({ path: '/v/right.md', owner: 'right', from: 'w1', copy: 0 })),
      setData: vi.fn(),
    } as unknown as DataTransfer
    expect(fireData(tabAt(el, 1), 'dragover', data, -5).defaultPrevented).toBe(true)
    expect(tabAt(el, 1).classList.contains('tabbar__tab--gap-before')).toBe(true)
    fireData(tabAt(el, 1), 'drop', data, -5)
    expect(onDropPage).toHaveBeenCalledExactlyOnceWith({ path: '/v/right.md', owner: 'right', from: 'w1', copy: 0 }, 1)

    fireData(tabAt(el, 2), 'dragover', data, 5)
    expect(tabAt(el, 2).classList.contains('tabbar__tab--gap-after')).toBe(true)
    act(() => void window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })))
    expect(el.querySelector('.tabbar__tab--gap-after')).toBeNull()
    expect(onDropPage).toHaveBeenCalledTimes(1)

    const foreign = { ...data, types: ['text/plain'] } as unknown as DataTransfer
    expect(fireData(el.querySelector('.tabbar')!, 'dragover', foreign).defaultPrevented).toBe(false)
    fireData(el.querySelector('.tabbar')!, 'drop', foreign)
    expect(onDropPage).toHaveBeenCalledTimes(1)
  })
})

describe('TabBar: a tab of ANOTHER window (YAZ-3637 D1, D4, D6)', () => {
  const TABS = ['/v/a.md', '/v/b.md', '/v/c.md']
  const tabAt = (el: HTMLElement, i: number) => [...el.querySelectorAll<HTMLElement>('.tabbar__tab')][i]
  beforeEach(layTabsOut)
  afterEach(putLayoutBack)
  const fireData = (target: Element, type: string, data: DataTransfer, clientX = 0): MouseEvent => {
    const event = new MouseEvent(type, { bubbles: true, cancelable: true, clientX: xOn(target, clientX) })
    Object.defineProperty(event, 'dataTransfer', { value: data })
    act(() => void target.dispatchEvent(event))
    return event
  }
  /** Another window's drag as Chromium shows it: the type names while it passes over (the data unreadable), the data on the drop. */
  const foreign = (readable: boolean) => ({
    types: [WORKSPACE_PAGE_MIME, 'application/x-yaseen-from-w2.0'],
    effectAllowed: 'move',
    dropEffect: 'none',
    getData: vi.fn(() => (readable ? JSON.stringify({ path: '/w/x.md', owner: 'main', from: 'w2', copy: 1 }) : '')),
    setData: vi.fn(),
  } as unknown as DataTransfer)
  const base = { tabs: TABS, active: '/v/a.md', onActivate: vi.fn(), onClose: vi.fn(), onMove: vi.fn(), onDropPage: vi.fn(), ...noNav }

  it('D4, D6: the line shows only when takesDrag says this window takes the drag; the drop hands the window, the ref and the slot to onDropFromWindow, never to onDropPage', () => {
    const onDropFromWindow = vi.fn()
    const takesDrag = vi.fn((data: DataTransfer) => data.types.includes('application/x-yaseen-from-w2.0'))
    const el = mount({ ...base, takesDrag, onDropFromWindow })
    expect(fireData(tabAt(el, 1), 'dragover', foreign(false), -5).defaultPrevented).toBe(true)
    expect(takesDrag).toHaveBeenCalled()
    expect(tabAt(el, 1).classList.contains('tabbar__tab--gap-before')).toBe(true)
    fireData(tabAt(el, 1), 'drop', foreign(true), -5)
    expect(onDropFromWindow).toHaveBeenCalledExactlyOnceWith('w2', { path: '/w/x.md', copy: 1 }, 1)
    expect(base.onDropPage).not.toHaveBeenCalled()
    expect(el.querySelector('.tabbar__tab--gap-before')).toBeNull()
    // A drag this window does not take: no line, the drop is not taken, nothing happens.
    const other = { ...foreign(false), types: [WORKSPACE_PAGE_MIME, 'application/x-yaseen-from-w2.1'] } as unknown as DataTransfer
    expect(fireData(tabAt(el, 2), 'dragover', other, 5).defaultPrevented).toBe(false)
    expect(el.querySelector('.tabbar__tab--gap-after')).toBeNull()
    fireData(tabAt(el, 2), 'drop', { ...other, getData: foreign(true).getData } as unknown as DataTransfer, 5)
    expect(onDropFromWindow).toHaveBeenCalledTimes(1)
    // The end slot, by the tail after the "+".
    const tail = el.querySelector<HTMLElement>('.tabbar-tail')!
    expect(fireData(tail, 'dragover', foreign(false)).defaultPrevented).toBe(true)
    fireData(tail, 'drop', foreign(true))
    expect(onDropFromWindow).toHaveBeenLastCalledWith('w2', { path: '/w/x.md', copy: 1 }, 3)
  })

  it('YAZ-3808 D5: another window\'s drag held at the strip\'s end scrolls it; Esc stops the scroll and puts the line out', () => {
    const frames: FrameRequestCallback[] = []
    vi.stubGlobal('requestAnimationFrame', (f: FrameRequestCallback) => frames.push(f))
    vi.stubGlobal('cancelAnimationFrame', () => void frames.splice(0))
    const el = mount({ ...base, takesDrag: () => true, onDropFromWindow: vi.fn() })
    const strip = el.querySelector<HTMLElement>('.tabbar')!
    strip.getBoundingClientRect = () => ({ left: 100, right: 400, top: 0, bottom: 40, width: 300, height: 40 }) as DOMRect
    fireData(tabAt(el, 2), 'dragover', foreign(false), 395)
    expect(frames).toHaveLength(1)
    expect(el.querySelector('.tabbar__tab--gap-after, .tabbar__tab--gap-before')).not.toBeNull()
    act(() => void window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' })))
    expect(frames).toHaveLength(0)
    expect(el.querySelector('.tabbar__tab--gap-after, .tabbar__tab--gap-before')).toBeNull()
    vi.unstubAllGlobals()
  })

  it('D4: the line goes out when another window\'s drag leaves the row, and on a drop elsewhere that never bubbles', () => {
    const el = mount({ ...base, takesDrag: () => true, onDropFromWindow: vi.fn() })
    const row = el.querySelector<HTMLElement>('.tabbar-row')!
    fireData(tabAt(el, 1), 'dragover', foreign(false), -5)
    expect(el.querySelector('.tabbar__tab--gap-before')).not.toBeNull()
    act(() => void row.dispatchEvent(new MouseEvent('dragleave', { bubbles: true, relatedTarget: document.body })))
    expect(el.querySelector('.tabbar__tab--gap-before')).toBeNull()
    // A drop on the page below, stopped on its way down (App's catch): the window hears it in the capture phase.
    fireData(tabAt(el, 1), 'dragover', foreign(false), -5)
    expect(el.querySelector('.tabbar__tab--gap-before')).not.toBeNull()
    const below = document.createElement('div')
    document.body.appendChild(below)
    below.addEventListener('drop', (e) => e.stopPropagation(), { capture: true })
    act(() => void below.dispatchEvent(new Event('drop', { bubbles: true })))
    expect(el.querySelector('.tabbar__tab--gap-before')).toBeNull()
    below.remove()
  })

  it('with no door (no onDropFromWindow) another window\'s drag is ignored, as foreign data is', () => {
    const el = mount({ ...base, takesDrag: () => true })
    expect(fireData(tabAt(el, 1), 'dragover', foreign(false), -5).defaultPrevented).toBe(false)
    fireData(tabAt(el, 1), 'drop', foreign(true), -5)
    expect(base.onDropPage).not.toHaveBeenCalled()
  })

  it('D1, D3: a drag that ends with no surface taking it (dropEffect none) tears the tab off at the screen point; a reorder, and a drop something took, never do', () => {
    const onTearOff = vi.fn()
    const onMove = vi.fn()
    const el = mount({ ...base, onMove, onTearOff })
    const end = (dropEffect: string, screenX: number, screenY: number) => {
      const event = new MouseEvent('dragend', { bubbles: true, cancelable: true, screenX, screenY })
      Object.defineProperty(event, 'dataTransfer', { value: { dropEffect, types: [] } })
      act(() => void tabAt(el, 0).dispatchEvent(event))
    }
    fireData(tabAt(el, 0), 'dragstart', foreign(true))
    end('none', 640, 480)
    expect(onTearOff).toHaveBeenCalledExactlyOnceWith('/v/a.md', '/v/a.md', { x: 640, y: 480 })
    expect(el.querySelector('.tabbar__tab--dragging')).toBeNull()
    // A reorder in the strip: the drop took it.
    fireData(tabAt(el, 0), 'dragstart', foreign(true))
    fireData(tabAt(el, 2), 'drop', foreign(true), 5)
    expect(onMove).toHaveBeenCalledWith(0, 2)
    end('move', 10, 10)
    expect(onTearOff).toHaveBeenCalledTimes(1)
  })
})

describe('TabBar slide and room (YAZ-2656 D12)', () => {
  const props = { onActivate: vi.fn(), onClose: vi.fn(), onMove: vi.fn(), ...noNav }
  const render = (next: Partial<TabBarProps> & Pick<TabBarProps, 'tabs' | 'active'>) => act(() => root?.render(<TabBar roots={['/v']} titles={new Map()} {...props} {...next} />))
  const sliding = (el: HTMLElement, cls: string) => [...el.querySelectorAll(`.tabbar__tab--${cls}`)].map((tab) => tab.textContent?.replace('✕', ''))
  /** Motion is allowed (jsdom has no matchMedia, and there nothing slides shut). */
  const allowMotion = () => Object.defineProperty(window, 'matchMedia', { configurable: true, value: () => ({ matches: false }) })
  afterEach(() => {
    delete (window as unknown as Record<string, unknown>).matchMedia
    vi.useRealTimers()
  })

  it('S88: a tab that joins the strip slides open — not the tabs the strip starts with, and not a page that takes a tab\'s place; the blank tab slides open, and the page that fills it does not', () => {
    const el = mount({ tabs: ['/v/a.md', '/v/b.md'], active: '/v/a.md', ...props })
    expect(sliding(el, 'in')).toEqual([])
    // The preview tab shows another page: same count, a new element, no slide.
    render({ tabs: ['/v/a.md', '/v/c.md'], active: '/v/c.md' })
    expect(sliding(el, 'in')).toEqual([])
    render({ tabs: ['/v/a.md', '/v/c.md', '/v/d.md'], active: '/v/d.md' })
    expect(sliding(el, 'in')).toEqual(['d'])
    // It keeps the class while it stands, so a render in the middle of the slide does not cut it.
    render({ tabs: ['/v/a.md', '/v/c.md', '/v/d.md'], active: '/v/a.md' })
    expect(sliding(el, 'in')).toEqual(['d'])
    render({ tabs: ['/v/a.md', '/v/c.md', '/v/d.md'], active: '/v/a.md', blank: true })
    expect(sliding(el, 'in')).toEqual(['d', 'New tab'])
    render({ tabs: ['/v/a.md', '/v/c.md', '/v/d.md', '/v/e.md'], active: '/v/e.md', blank: false })
    expect(sliding(el, 'in')).toEqual(['d'])
    // A tab that closes, or one that moves, builds no other tab again (YAZ-2657 A3): a later tab
    // stays the SAME element, so its slide does not play a second time and it keeps hover and focus.
    const tabOf = (name: string) => [...el.querySelectorAll('.tabbar__tab')].find((tab) => tab.textContent?.replace('✕', '') === name)
    const [d, e] = [tabOf('d'), tabOf('e')]
    render({ tabs: ['/v/a.md', '/v/d.md', '/v/e.md'], active: '/v/e.md', blank: false })
    expect([tabOf('d') === d, tabOf('e') === e]).toEqual([true, true])
    render({ tabs: ['/v/e.md', '/v/a.md', '/v/d.md'], active: '/v/e.md', blank: false })
    expect([tabOf('d') === d, tabOf('e') === e]).toEqual([true, true])
  })

  it('YAZ-3808 6C: the slide-open class goes when the slide ends, so a tab that moves later does not play it again (a flash)', () => {
    const el = mount({ tabs: ['/v/a.md', '/v/b.md'], active: '/v/a.md', ...props })
    render({ tabs: ['/v/a.md', '/v/b.md', '/v/c.md'], active: '/v/c.md' })
    expect(sliding(el, 'in')).toEqual(['c'])
    const c = [...el.querySelectorAll('[data-tab]')].find((tab) => tab.textContent?.startsWith('c'))!
    // jsdom has no AnimationEvent, so React listens for the prefixed name there. An animation inside the tab is not its slide.
    act(() => void c.querySelector('.tabbar__close')!.dispatchEvent(new Event('webkitAnimationEnd', { bubbles: true })))
    expect(sliding(el, 'in')).toEqual(['c'])
    act(() => void c.dispatchEvent(new Event('webkitAnimationEnd', { bubbles: true })))
    expect(sliding(el, 'in')).toEqual([])
    // It moves to the front: put back in the strip, it has no slide to play.
    render({ tabs: ['/v/c.md', '/v/a.md', '/v/b.md'], active: '/v/c.md' })
    expect(sliding(el, 'in')).toEqual([])
  })

  it('S88: a closed tab slides shut where it stood — a ghost that is no tab, gone after the slide; with no motion asked for there is none', () => {
    vi.useFakeTimers()
    const el = mount({ tabs: ['/v/a.md', '/v/b.md', '/v/c.md'], active: '/v/a.md', ...props })
    render({ tabs: ['/v/a.md', '/v/c.md'], active: '/v/a.md' })
    expect(sliding(el, 'out')).toEqual([]) // no matchMedia: nothing slides

    allowMotion()
    render({ tabs: ['/v/c.md'], active: '/v/c.md' })
    expect([...el.querySelectorAll('.tabbar__tab')].map((tab) => tab.textContent?.replace('✕', ''))).toEqual(['a', 'c'])
    expect(sliding(el, 'out')).toEqual(['a'])
    // The ghost is nothing to act on: no tab role, no ✕, hidden from a reader.
    expect([...el.querySelectorAll('[role="tab"]')].map((tab) => tab.textContent)).toEqual(['c'])
    expect(el.querySelector('.tabbar__tab--out')?.getAttribute('aria-hidden')).toBe('true')
    expect(el.querySelector('.tabbar__tab--out button')).toBeNull()
    // The ghost goes when the slide ends: the time the row hands the stylesheet is the timer's own (YAZ-2657 A19).
    const ms = parseInt(el.querySelector<HTMLElement>('.tabbar-row')!.style.getPropertyValue('--tab-slide-ms'), 10)
    act(() => void vi.advanceTimersByTime(ms - 1))
    expect(sliding(el, 'out')).toEqual(['a'])
    act(() => void vi.advanceTimersByTime(1))
    expect(sliding(el, 'out')).toEqual([])
    // A page that takes a tab's place closes nothing.
    render({ tabs: ['/v/d.md'], active: '/v/d.md' })
    expect(sliding(el, 'out')).toEqual([])
  })

  it('S93: with the right panel closed the row keeps room at its end for the "Show right panel" button', () => {
    const el = mount({ tabs: ['/v/a.md'], active: '/v/a.md', reserveEnd: true, ...props })
    expect(el.querySelector('.tabbar-row')?.className).toContain('tabbar-row--end')
    render({ tabs: ['/v/a.md'], active: '/v/a.md', reserveEnd: false })
    expect(el.querySelector('.tabbar-row')?.className).not.toContain('tabbar-row--end')
  })
})

describe('TabBar keeps the active tab in view (I3 overflow polish)', () => {
  it('activation scrolls the ACTIVE tab into view when scrollIntoView exists (jsdom lacks it: the ?. guard is every other test here)', () => {
    const spy = vi.fn()
    ;(HTMLElement.prototype as unknown as Record<string, unknown>).scrollIntoView = spy
    try {
      mount({ tabs: ['/v/a.md', '/v/b.md'], active: '/v/a.md', onActivate: vi.fn(), onClose: vi.fn(), onMove: vi.fn(), ...noNav })
      act(() => root?.render(<TabBar roots={['/v']} titles={new Map()} tabs={['/v/a.md', '/v/b.md']} active="/v/b.md" onActivate={vi.fn()} onClose={vi.fn()} onMove={vi.fn()} {...noNav} />))
      const activeTab = spy.mock.contexts.at(-1) as HTMLElement
      expect(activeTab.classList.contains('tabbar__tab--active')).toBe(true)
      expect(activeTab.querySelector('[role="tab"]')?.textContent).toBe('b')
    } finally {
      delete (HTMLElement.prototype as unknown as Record<string, unknown>).scrollIntoView
    }
  })
})

describe('TabBar right-click menu (YAZ-922)', () => {
  const TABS = ['/vault/Note.md', '/vault/sub/Deep Note.md']
  const props = { tabs: TABS, active: '/vault/Note.md', onActivate: vi.fn(), onClose: vi.fn(), onMove: vi.fn(), ...noNav }

  /** jsdom has no clipboard; the menu's only job is to hand the path to it, so spy on writeText. */
  let writeText: ReturnType<typeof vi.fn>
  const hadClipboard = 'clipboard' in navigator

  beforeEach(() => {
    writeText = vi.fn(() => Promise.resolve())
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true, writable: true })
  })

  afterEach(() => {
    if (!hadClipboard) delete (navigator as unknown as Record<string, unknown>).clipboard
  })

  const tabAt = (el: HTMLElement, i: number) => [...el.querySelectorAll<HTMLElement>('.tabbar__tab')][i]

  /** Right-click a tab; returns the event so the caller can check it was swallowed. */
  const rightClick = (target: Element, clientX = 0, clientY = 0): MouseEvent => {
    const e = new MouseEvent('contextmenu', { bubbles: true, cancelable: true, button: 2, clientX, clientY })
    act(() => void target.dispatchEvent(e))
    return e
  }

  const menuOf = (el: HTMLElement) => el.querySelector<HTMLElement>('.ctx-menu')
  const items = (el: HTMLElement) => [...el.querySelectorAll<HTMLButtonElement>('.ctx-menu [role="menuitem"]')]

  it('right-clicking a tab opens a role=menu at the pointer with Show in sidebar, Copy path, and the OS actions', () => {
    const el = mount(props)
    expect(menuOf(el)).toBeNull() // nothing until asked for
    const e = rightClick(tabAt(el, 0), 120, 42)
    expect(e.defaultPrevented).toBe(true) // the OS menu never shows
    const menu = menuOf(el)
    expect(menu?.getAttribute('role')).toBe('menu')
    expect(menu?.style.left).toBe('120px')
    expect(menu?.style.top).toBe('42px')
    expect(items(el).map((b) => b.textContent)).toEqual(['Show in sidebar', 'Copy path', 'Reveal in Finder', 'Open in VS Code'])
  })

  it('Show in sidebar targets the right-clicked inactive tab, closes the menu, and never activates it', () => {
    const onActivate = vi.fn()
    const onShowInSidebar = vi.fn()
    const el = mount({ ...props, onActivate, onShowInSidebar })
    rightClick(tabAt(el, 1))
    act(() => items(el)[0]?.click())
    expect(onShowInSidebar).toHaveBeenCalledExactlyOnceWith('/vault/sub/Deep Note.md')
    expect(onActivate).not.toHaveBeenCalled()
    expect(menuOf(el)).toBeNull()
  })

  it('"Move to ▸ Right panel" transfers the exact tab and closes the menu (YAZ-3091 D3, S18)', () => {
    const onMoveToRight = vi.fn()
    const el = mount({ ...props, onMoveToRight })
    rightClick(tabAt(el, 1))
    act(() => items(el).find((item) => item.textContent === 'Move to')?.click())
    const move = items(el).find((item) => item.textContent === 'Right panel')
    act(() => move?.click())
    expect(onMoveToRight).toHaveBeenCalledExactlyOnceWith('/vault/sub/Deep Note.md')
    expect(menuOf(el)).toBeNull()
  })

  it('clamps the menu inside the viewport when the pointer is near its right and bottom edges', () => {
    const rect = vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function (this: Element) {
      const width = this.classList.contains('ctx-menu') ? 160 : 0
      const height = this.classList.contains('ctx-menu') ? 180 : 0
      return { width, height, left: 0, top: 0, right: width, bottom: height, x: 0, y: 0, toJSON: () => ({}) } as DOMRect
    })
    try {
      const el = mount(props)
      rightClick(tabAt(el, 0), 1000, 700)
      expect(menuOf(el)?.style.left).toBe('864px')
      expect(menuOf(el)?.style.top).toBe('588px')
    } finally {
      rect.mockRestore()
    }
  })

  it('Copy path writes the tab\'s ABSOLUTE path — not the label — and closes the menu', () => {
    const el = mount(props)
    rightClick(tabAt(el, 1))
    act(() => items(el)[1]?.click())
    expect(writeText).toHaveBeenCalledWith('/vault/sub/Deep Note.md')
    expect(menuOf(el)).toBeNull()
  })

  it('"Copy path" is a tab\'s one copy item, a note\'s and a folder\'s: nothing else is named Copy — no "Copy ID" (YAZ-2420 D22, D31)', async () => {
    vi.mocked(api.tree).mockResolvedValueOnce({ root: '/one', tree: [{ type: 'dir', name: 'Projects', path: '/one/Projects', children: [] }], generatedAt: 1 })
    await fetchTree('/one')
    const el = mount({ ...props, roots: ['/one'], tabs: ['/one/Note.md', '/one/Projects'] })
    for (const i of [0, 1]) {
      rightClick(tabAt(el, i))
      expect(items(el).map((b) => b.textContent).filter((label) => label?.startsWith('Copy'))).toEqual(['Copy path'])
    }
  })

  it.each([
    [true, 'Turn review off'],
    [false, 'Turn review on'],
  ])('a note whose review state is %s gets "%s" under Copy path, and it asks for the opposite (YAZ-2322)', (state, label) => {
    const reviewState = vi.fn(() => state)
    const onSetReview = vi.fn()
    const el = mount({ ...props, reviewState, onSetReview })
    rightClick(tabAt(el, 1))
    expect(reviewState).toHaveBeenCalledExactlyOnceWith('/vault/sub/Deep Note.md')
    expect(items(el).map((b) => b.textContent)).toEqual(['Show in sidebar', 'Copy path', label, 'Reveal in Finder', 'Open in VS Code'])
    act(() => items(el)[2]?.click())
    expect(onSetReview).toHaveBeenCalledExactlyOnceWith('/vault/sub/Deep Note.md', !state)
    expect(menuOf(el)).toBeNull()
  })

  it('YAZ-3264 D2, S14: the tab\'s list state is read when the menu opens; "Add to focus" and "Remove from favorites" toggle THAT path with it', () => {
    const listState = vi.fn(() => ({ focus: false, favorite: true }))
    const [onToggleFocus, onToggleFavorite] = [vi.fn(), vi.fn()]
    const el = mount({ ...props, listState, onToggleFocus, onToggleFavorite })
    rightClick(tabAt(el, 1))
    expect(listState).toHaveBeenCalledExactlyOnceWith('/vault/sub/Deep Note.md')
    expect(items(el).map((b) => b.textContent)).toEqual(['Show in sidebar', 'Add to focus', 'Copy path', 'Remove from favorites', 'Reveal in Finder', 'Open in VS Code'])
    act(() => items(el)[1]?.click())
    expect(onToggleFocus).toHaveBeenCalledExactlyOnceWith(['/vault/sub/Deep Note.md'], false)
    expect(menuOf(el)).toBeNull()
    rightClick(tabAt(el, 1))
    act(() => items(el)[3]?.click())
    expect(onToggleFavorite).toHaveBeenCalledExactlyOnceWith(['/vault/sub/Deep Note.md'], true)
  })

  it('a tab with no review state — a folder, a PDF, a note the index has not seen, any note with upkeep off — gets no review item', () => {
    const el = mount({ ...props, reviewState: () => null, onSetReview: vi.fn() })
    rightClick(tabAt(el, 0))
    expect(items(el).map((b) => b.textContent)).toEqual(['Show in sidebar', 'Copy path', 'Reveal in Finder', 'Open in VS Code'])
  })

  it('the menu retargets: right-clicking another tab copies THAT tab\'s path', () => {
    const el = mount(props)
    rightClick(tabAt(el, 0))
    rightClick(tabAt(el, 1))
    act(() => items(el)[1]?.click())
    expect(writeText).toHaveBeenCalledTimes(1)
    expect(writeText).toHaveBeenCalledWith('/vault/sub/Deep Note.md')
  })

  it('Escape anywhere in the window dismisses the menu', () => {
    const el = mount(props)
    rightClick(tabAt(el, 0))
    act(() => void window.dispatchEvent(new KeyboardEvent('keydown', { key: 'a', bubbles: true })))
    expect(menuOf(el)).not.toBeNull() // other keys are none of its business
    act(() => void window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })))
    expect(menuOf(el)).toBeNull()
  })

  it('a press OUTSIDE dismisses the menu: it lands on the overlay that covers the window (the sidebar\'s `ContextMenu`, YAZ-2949 D6)', () => {
    const el = mount(props)
    rightClick(tabAt(el, 0))
    act(() => void el.querySelector('.ctx-overlay')?.dispatchEvent(new MouseEvent('mousedown', { bubbles: true })))
    expect(menuOf(el)).toBeNull()
  })

  it('a press INSIDE the menu keeps it open (the item stops propagation, so the click can land)', () => {
    const el = mount(props)
    rightClick(tabAt(el, 0))
    act(() => void items(el)[1]?.dispatchEvent(new MouseEvent('mousedown', { bubbles: true })))
    expect(menuOf(el)).not.toBeNull()
    // …and the press that survived is followed by the click that actually copies.
    act(() => items(el)[1]?.click())
    expect(writeText).toHaveBeenCalledWith('/vault/Note.md')
  })

  it('closing the menu unhooks its window listeners (no stray dismissals after the fact)', () => {
    const el = mount(props)
    const add = vi.spyOn(window, 'addEventListener')
    const remove = vi.spyOn(window, 'removeEventListener')
    try {
      rightClick(tabAt(el, 0))
      expect(add.mock.calls.map((c) => c[0])).toEqual(['keydown'])
      act(() => void window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })))
      expect(menuOf(el)).toBeNull()
      expect(remove.mock.calls.map((c) => c[0])).toEqual(['keydown'])
    } finally {
      add.mockRestore()
      remove.mockRestore()
    }
  })
})

describe('TabBar history buttons (YAZ-721; the keys since YAZ-3647 D7)', () => {
  const btn = (el: HTMLElement, label: string) => el.querySelector<HTMLButtonElement>(`.tabbar-nav__btn[aria-label="${label}"]`)
  const tabs = { tabs: ['/v/a.md'], active: '/v/a.md', onActivate: vi.fn(), onClose: vi.fn(), onMove: vi.fn() }

  it('renders ◀ ▶ left of the tablist, each labelled and tooltipped with its key (YAZ-3647 D7)', () => {
    const el = mount({ ...tabs, ...noNav })
    const labels = [...el.querySelectorAll<HTMLButtonElement>('.tabbar-nav__btn')]
    expect(labels.map((b) => b.getAttribute('aria-label'))).toEqual(['Back', 'Forward'])
    expect(labels.map((b) => b.title)).toEqual(['Back (⌥⌘←)', 'Forward (⌥⌘→)'])
    // Outside .tabbar, so the strip's own drop guards (e.target !== e.currentTarget) are untouched.
    expect(el.querySelector('.tabbar .tabbar-nav__btn')).toBeNull()
  })

  it('with the sidebar collapsed (YAZ-1759), Show sidebar leads the row as a peer of ◀ ▶ and reopens on click', () => {
    const onShowSidebar = vi.fn()
    const el = mount({ ...tabs, ...noNav, onShowSidebar })
    const labels = [...el.querySelectorAll<HTMLButtonElement>('.tabbar-nav__btn')]
    expect(labels.map((b) => b.getAttribute('aria-label'))).toEqual(['Show sidebar', 'Back', 'Forward'])
    expect(labels[0]?.title).toBe('Show sidebar')
    expect(el.querySelector('.tabbar-nav')?.firstElementChild).toBe(labels[0])
    act(() => btn(el, 'Show sidebar')?.click())
    expect(onShowSidebar).toHaveBeenCalledTimes(1)
    // A flex child of the nav row, not a floater over it — and still outside .tabbar (same guard as above).
    expect(el.querySelector('.tabbar .tabbar-nav__btn')).toBeNull()
  })

  it('each button is disabled exactly when its side of the stack has nowhere to go', () => {
    const el = mount({ ...tabs, canBack: true, canForward: false, onBack: vi.fn(), onForward: vi.fn() })
    expect(btn(el, 'Back')?.disabled).toBe(false)
    expect(btn(el, 'Forward')?.disabled).toBe(true)
  })

  it('clicking an enabled button steps that way', () => {
    const onBack = vi.fn()
    const onForward = vi.fn()
    const el = mount({ ...tabs, canBack: true, canForward: true, onBack, onForward })
    act(() => btn(el, 'Back')?.click())
    act(() => btn(el, 'Forward')?.click())
    expect(onBack).toHaveBeenCalledTimes(1)
    expect(onForward).toHaveBeenCalledTimes(1)
  })

  describe('the menus of ‹ and › (YAZ-3647 E3)', () => {
    const titles = new Map([['/v/trip.md', 'Trip plan'], ['/v/groceries.md', 'Groceries']])
    // Each row carries its step's id, not its place in the list (YAZ-3678 F4): a close can move the places while the menu is open.
    const backSteps = [{ id: 41, path: '/v/trip.md', zoom: 'k1:0' }, { id: 17, path: '/v/groceries.md', zoom: null }, { id: 9, path: '/v/trip.md', zoom: 'k9:0' }]
    const zoomLabels = new Map([['k1:0', 'Day 1: Lisbon']])
    const rows = () => [...document.querySelectorAll<HTMLButtonElement>('.ctx-menu .ctx-menu__item')]
    const press = (el: HTMLElement, type: string, init: MouseEventInit = {}) => act(() => void el.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true, ...init })))

    it('a right-click on ‹ lists the steps behind, the nearest first: the page, and " › bullet" when its text is known; a row goes straight to its step, by id (YAZ-3678 F4)', () => {
      const onBack = vi.fn()
      const onGoToStep = vi.fn()
      const el = mount({ ...tabs, titles, canBack: true, canForward: false, onBack, onForward: vi.fn(), backSteps, onGoToStep, zoomLabels })
      press(btn(el, 'Back')!, 'contextmenu', { clientX: 10, clientY: 20 })
      expect(rows().map((r) => r.textContent)).toEqual(['Trip plan › Day 1: Lisbon', 'Groceries', 'Trip plan'])
      act(() => rows()[1].click())
      expect(onGoToStep).toHaveBeenCalledExactlyOnceWith(17)
      expect([rows().length, onBack.mock.calls.length]).toEqual([0, 0])
    })

    it('a press held NAV_HOLD_MS opens the menu, and the click that ends it takes no step; a short press is a plain Back', () => {
      vi.useFakeTimers()
      try {
        const onBack = vi.fn()
        const el = mount({ ...tabs, titles, canBack: true, canForward: false, onBack, onForward: vi.fn(), backSteps, onGoToStep: vi.fn(), zoomLabels })
        const back = btn(el, 'Back')!
        press(back, 'mousedown')
        act(() => void vi.advanceTimersByTime(NAV_HOLD_MS - 1))
        press(back, 'mouseup')
        act(() => back.click())
        expect([rows().length, onBack.mock.calls.length]).toEqual([0, 1])
        press(back, 'mousedown')
        act(() => void vi.advanceTimersByTime(NAV_HOLD_MS))
        expect(rows()).toHaveLength(3)
        press(back, 'mouseup')
        act(() => back.click())
        expect(onBack).toHaveBeenCalledTimes(1)
      } finally {
        vi.useRealTimers()
      }
    })

    it('› lists the steps ahead; with no steps that way, a right-click opens nothing', () => {
      const el = mount({ ...tabs, titles, canBack: true, canForward: true, onBack: vi.fn(), onForward: vi.fn(), backSteps: [], forwardSteps: [{ id: 4, path: '/v/groceries.md', zoom: null }], onGoToStep: vi.fn(), zoomLabels })
      press(btn(el, 'Back')!, 'contextmenu')
      expect(rows()).toHaveLength(0)
      press(btn(el, 'Forward')!, 'contextmenu')
      expect(rows().map((r) => r.textContent)).toEqual(['Groceries'])
    })
  })
})

describe('a zoomed tab\'s tooltip (YAZ-3647 E4)', () => {
  it('names the bullet after the page; the label stays the page name (YAZ-3646 D12); a bullet whose text is not known shows the path alone', () => {
    container = document.body.appendChild(document.createElement('div'))
    root = createRoot(container)
    const tabs = [{ id: 'z', path: '/v/trip.md', zoom: 'k1:0' }, { id: 'u', path: '/v/trip.md', zoom: 'k2:0' }, { id: 'p', path: '/v/trip.md' }, { id: 'n', path: '/v/trip.md', name: 'Lisbon', zoom: 'k1:0' }]
    act(() => root?.render(<IdTabBar roots={['/v']} titles={new Map([['/v/trip.md', 'Trip plan']])} windowId="w1" tabs={tabs} active="z" zoomLabels={new Map([['k1:0', 'Day 1: Lisbon']])} onActivate={vi.fn()} onClose={vi.fn()} onMove={vi.fn()} {...noNav} />))
    const tab = (id: string) => container!.querySelector<HTMLButtonElement>(`[data-tab="${id}"] [role="tab"]`)!
    expect(['z', 'u', 'p', 'n'].map((id) => tab(id).title)).toEqual(['Trip plan › Day 1: Lisbon\n/v/trip.md', '/v/trip.md', '/v/trip.md', 'Trip plan › Day 1: Lisbon\n/v/trip.md'])
    expect(['z', 'n'].map((id) => tab(id).textContent)).toEqual(['Trip plan', 'Lisbon'])
  })
})

/**
 * The OS actions on the tab (YAZ-963): the tab IS the file, so it offers Reveal in Finder and
 * Open in VS Code beside Copy path — same absolute-path target, same close-on-click, and a
 * NOT_FOUND surfacing through `onNotice` exactly as the sidebar's reveal does.
 */
describe('tab menu OS actions (YAZ-963)', () => {
  let root2: Root | null = null
  let host: HTMLElement | null = null
  afterEach(() => {
    act(() => root2?.unmount())
    host?.remove()
    root2 = null
    host = null
    reveal.mockClear()
    openVsCode.mockClear()
  })
  const mountWith = (extra: Partial<TabBarProps> = {}): HTMLElement => {
    host = document.createElement('div')
    document.body.appendChild(host)
    root2 = createRoot(host)
    const base: TabBarProps = {
      roots: ['/vault'],
      titles: new Map(),
      tabs: ['/vault/A.md', '/vault/sub/Deep Note.md'],
      active: '/vault/A.md',
      onActivate: vi.fn(),
      onClose: vi.fn(),
      onMove: vi.fn(),
      canBack: false,
      canForward: false,
      onBack: vi.fn(),
      onForward: vi.fn(),
      ...extra,
    }
    act(() => root2?.render(<TabBar {...base} />))
    return host
  }
  const tabAt = (el: HTMLElement, i: number) => [...el.querySelectorAll<HTMLElement>('.tabbar__tab')][i]
  const rightClick = (target: Element): void => {
    act(() => void target.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, button: 2 })))
  }
  const itemNamed = (el: HTMLElement, label: string) => [...el.querySelectorAll<HTMLButtonElement>('.ctx-menu [role="menuitem"]')].find((b) => b.textContent === label)
  const menuOf = (el: HTMLElement) => el.querySelector<HTMLElement>('.ctx-menu')

  it('Reveal in Finder calls the bridge with the tab\'s absolute path and closes the menu', () => {
    const el = mountWith()
    rightClick(tabAt(el, 1))
    act(() => itemNamed(el, 'Reveal in Finder')?.click())
    expect(reveal).toHaveBeenCalledExactlyOnceWith({ path: '/vault/sub/Deep Note.md' })
    expect(menuOf(el)).toBeNull()
  })

  it('Open in VS Code calls the bridge with the tab\'s absolute path and closes the menu', () => {
    const el = mountWith()
    rightClick(tabAt(el, 0))
    act(() => itemNamed(el, 'Open in VS Code')?.click())
    expect(openVsCode).toHaveBeenCalledExactlyOnceWith({ path: '/vault/A.md' })
    expect(menuOf(el)).toBeNull()
  })

  it('a stale tab surfaces through onNotice instead of a silently dead item', async () => {
    reveal.mockRejectedValueOnce(new BridgeRequestError('NOT_FOUND', 'gone'))
    const onNotice = vi.fn()
    const el = mountWith({ onNotice })
    rightClick(tabAt(el, 0))
    act(() => itemNamed(el, 'Reveal in Finder')?.click())
    await act(async () => {
      await Promise.resolve()
    })
    expect(onNotice).toHaveBeenCalledTimes(1)
    expect(String(onNotice.mock.calls[0][0])).toMatch(/no longer there|Can't reveal/i)
  })

  it('E: the stale-tab notice names the note by its title (YAZ-2420 D14)', async () => {
    reveal.mockRejectedValueOnce(new BridgeRequestError('NOT_FOUND', 'gone'))
    const onNotice = vi.fn()
    const el = mountWith({ onNotice, titles: new Map([['/vault/A.md', 'UP-001 - Abdul']]) })
    rightClick(tabAt(el, 0))
    act(() => itemNamed(el, 'Reveal in Finder')?.click())
    await act(async () => {
      await Promise.resolve()
    })
    expect(onNotice).toHaveBeenCalledExactlyOnceWith('Can\'t reveal "UP-001 - Abdul" — it is no longer there')
  })
})

describe('the tab of the page the board highlights (YAZ-2648)', () => {
  afterEach(() => setBoardHighlight(null))

  it('wears the lit look while the board points at its page, the active tab too, and loses it when the board lets go', () => {
    const el = mount({ tabs: ['/v/a.md', '/v/b.md', '/v/c.md'], active: '/v/a.md', onActivate: vi.fn(), onClose: vi.fn(), onMove: vi.fn(), canBack: false, canForward: false, onBack: vi.fn(), onForward: vi.fn() })
    const lit = () => [...el.querySelectorAll('.tabbar__tab--lit [role="tab"]')].map((tab) => tab.getAttribute('title'))
    expect(lit()).toEqual([])
    act(() => setBoardHighlight('/v/b.md'))
    expect(lit()).toEqual(['/v/b.md'])
    act(() => setBoardHighlight('/v/a.md'))
    expect(lit()).toEqual(['/v/a.md'])
    act(() => setBoardHighlight(null))
    expect(lit()).toEqual([])
  })
})

/**
 * The widths of the tabs (YAZ-2689) are CSS alone, and jsdom lays nothing out: the rules are read
 * as written. What they do on a screen — S1 to S9 of the issue — is the hand scenario W14.
 */
describe('the widths of the tabs (YAZ-2689)', () => {
  /** The declarations of the ONE rule whose selector is exactly `selector`. */
  const rule = (selector: string) => new RegExp(`(?:^|\\})\\s*${selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*\\{([^}]*)\\}`, 'm').exec(tabsCss.replace(/\/\*[\s\S]*?\*\//g, ''))?.[1] ?? ''

  it('YAZ-3808 6F: while the tabs part, a tab under the pointer does not light up — the tabs slide under it, and each one blinked', () => {
    expect(rule('.tabbar--parting .tabbar__tab:not(.tabbar__tab--active):not(.tabbar__tab--lit):hover::before')).toMatch(/background:\s*var\(--tab-fill\);/)
    expect(rule('.tabbar--parting .tabbar__tab:not(.tabbar__tab--active):hover .tabbar__close')).toMatch(/visibility:\s*hidden;/)
  })

  it('D1, D2: a tab is as wide as its name, from 72px to 200px, and it can shrink — with no flex basis and no container query, which make the strip cut a tab while the row has room', () => {
    const tab = rule('.tabbar__tab')
    expect(tab).toMatch(/flex:\s*0 1 auto;/)
    expect(tab).toMatch(/min-width:\s*72px;/)
    expect(tab).toMatch(/max-width:\s*200px;/)
    expect(tab).not.toMatch(/(?:^|[;\s])width:|container-type/)
  })

  it('D3: the active tab never shrinks', () => {
    expect(rule('.tabbar__tab--active')).toMatch(/flex-shrink:\s*0;/)
  })

  it('D4: the ✕ stands over the end of the tab and takes no width; the name keeps room for it and for its fade', () => {
    expect(rule('.tabbar__close')).toMatch(/position:\s*absolute;/)
    expect(rule('.tabbar__close')).not.toMatch(/margin-right|flex:/)
    expect(rule('.tabbar__label')).toMatch(/padding-right:\s*18px;/)
  })

  it('S9: a tab slides open and shut on the most that it can be wide, since its width is its name\'s', () => {
    expect(tabsCss).toMatch(/@keyframes tab-in\s*\{\s*from\s*\{[^}]*max-width:\s*0;/)
    expect(tabsCss.replace(/\/\*[\s\S]*?\*\//g, '')).not.toMatch(/flex-basis/)
  })
})

describe('TabBar copies (YAZ-2940 D1): two tabs of one file', () => {
  it('shows each copy as its own tab, marks only the active copy, and names the tab by id for ✕, a click and the menu — the file by path', () => {
    const onActivate = vi.fn()
    const onClose = vi.fn()
    const onMoveToNewWindow = vi.fn()
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
    const tabs = [{ id: 't1', path: '/v/a.md' }, { id: 't2', path: '/v/b.md' }, { id: 't3', path: '/v/a.md' }]
    act(() => root?.render(<IdTabBar roots={['/v']} titles={new Map()} windowId="w1" tabs={tabs} active="t3" onActivate={onActivate} onClose={onClose} onMove={vi.fn()} onMoveToNewWindow={onMoveToNewWindow} {...noNav} />))
    const el = container
    expect([...el.querySelectorAll<HTMLElement>('.tabbar__tab')].map((tab) => tab.dataset.tab)).toEqual(['t1', 't2', 't3'])
    expect([...el.querySelectorAll('[role="tab"]')].map((tab) => [tab.textContent, tab.getAttribute('aria-selected')])).toEqual([['a', 'false'], ['b', 'false'], ['a', 'true']])
    act(() => el.querySelector<HTMLButtonElement>('[data-tab="t1"] [role="tab"]')?.click())
    expect(onActivate).toHaveBeenCalledWith('t1')
    act(() => el.querySelector<HTMLButtonElement>('[data-tab="t3"] .tabbar__close')?.click())
    expect(onClose).toHaveBeenCalledWith('t3')
    act(() => void el.querySelector('[data-tab="t3"]')?.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true })))
    act(() => [...el.querySelectorAll<HTMLButtonElement>('.ctx-menu [role="menuitem"]')].find((item) => item.textContent === 'Move to new window')?.click())
    expect(onMoveToNewWindow).toHaveBeenCalledWith('/v/a.md', 't3')
  })

  it('D5: the menu has "Duplicate tab" right after "Move to new window"; a click copies THAT tab, by id, and closes the menu', () => {
    const onDuplicate = vi.fn()
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
    const tabs = [{ id: 't1', path: '/v/a.md' }, { id: 't2', path: '/v/a.md' }]
    act(() => root?.render(<IdTabBar roots={['/v']} titles={new Map()} windowId="w1" tabs={tabs} active="t1" onActivate={vi.fn()} onClose={vi.fn()} onMove={vi.fn()} onMoveToNewWindow={vi.fn()} onMoveToRight={vi.fn()} onDuplicate={onDuplicate} {...noNav} />))
    const el = container
    act(() => void el.querySelector('[data-tab="t2"]')?.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true })))
    const items = () => [...el.querySelectorAll<HTMLButtonElement>('.ctx-menu [role="menuitem"]')]
    expect(items().map((item) => item.textContent).slice(0, 3)).toEqual(['Move to new window', 'Duplicate tab', 'Move to'])
    act(() => items()[1].click())
    expect(onDuplicate).toHaveBeenCalledExactlyOnceWith('t2')
    expect(el.querySelector('.ctx-menu')).toBeNull()
  })

  it('YAZ-3091 D2, D3, S7: the menu asks for the windows of the right-clicked tab\'s page when it opens; a window row moves THAT tab, by id', () => {
    const onMoveTargets = vi.fn((path: string) => [{ id: 'w2', label: `Work — ${path} · 1 tab` }])
    const onMoveToWindow = vi.fn()
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
    const tabs = [{ id: 't1', path: '/v/a.md' }, { id: 't2', path: '/v/b.md' }]
    act(() => root?.render(<IdTabBar roots={['/v']} titles={new Map()} windowId="w1" tabs={tabs} active="t1" onActivate={vi.fn()} onClose={vi.fn()} onMove={vi.fn()} onMoveToRight={vi.fn()} onMoveTargets={onMoveTargets} onMoveToWindow={onMoveToWindow} {...noNav} />))
    const el = container
    expect(onMoveTargets).not.toHaveBeenCalled() // read when a menu opens, never before
    act(() => void el.querySelector('[data-tab="t2"]')?.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true })))
    expect(onMoveTargets).toHaveBeenLastCalledWith('/v/b.md')
    const items = () => [...el.querySelectorAll<HTMLButtonElement>('.ctx-menu [role="menuitem"]')]
    act(() => items().find((item) => item.textContent === 'Move to')?.click())
    expect([...el.querySelectorAll('.ctx-menu__sub [role="group"]')].map((g) => g.textContent)).toEqual(['Work — /v/b.md · 1 tab', 'Right panel'])
    act(() => items().find((item) => item.textContent === 'Work — /v/b.md · 1 tab')?.click())
    expect(onMoveToWindow).toHaveBeenCalledExactlyOnceWith('w2', '/v/b.md', 't2')
    expect(el.querySelector('.ctx-menu')).toBeNull()
  })
})

describe('TabBar display name (YAZ-2949 D4, D5)', () => {
  const A = '/v/a.md'
  const base: IdTabBarProps = { roots: ['/v'], titles: new Map([[A, 'Plan']]), windowId: 'w1', tabs: [{ id: 't1', path: A }, { id: 't2', path: A, name: 'Outline' }], active: 't1', onActivate: vi.fn(), onClose: vi.fn(), onMove: vi.fn(), ...noNav }
  function mountIds(props: Partial<IdTabBarProps> = {}) {
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
    act(() => root?.render(<IdTabBar {...base} {...props} />))
    return container
  }
  const tabs = (el: HTMLElement) => [...el.querySelectorAll<HTMLElement>('.tabbar__tab')]
  const field = (el: HTMLElement) => el.querySelector<HTMLInputElement>('.tabbar__rename')
  const openField = (el: HTMLElement, i: number) => {
    act(() => void tabs(el)[i].dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true })))
    act(() => [...el.querySelectorAll<HTMLButtonElement>('.ctx-menu [role="menuitem"]')].find((b) => b.textContent === 'Set display name')?.click())
  }
  const type = (input: HTMLInputElement, text: string) => {
    act(() => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set?.call(input, text)
      input.dispatchEvent(new Event('input', { bubbles: true }))
    })
  }
  const key = (input: HTMLInputElement, k: string) => act(() => void input.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true })))

  it('S11, S14: a named tab shows its name; the tooltip gives the page name, then the path; the ✕ names the tab by its display name', () => {
    const el = mountIds()
    expect(tabs(el).map((t) => t.querySelector('.tabbar__label')?.textContent)).toEqual(['Plan', 'Outline'])
    expect(tabs(el).map((t) => t.querySelector<HTMLElement>('.tabbar__btn')?.title)).toEqual([A, `Plan\n${A}`])
    expect(tabs(el)[1].querySelector('.tabbar__close')?.getAttribute('aria-label')).toBe('Close Outline')
  })

  it('S1, S3, S9: "Set display name" turns the name into a field there, selected, the page name as placeholder; the tab does not drag; ⏎ saves', () => {
    const onSetName = vi.fn()
    const el = mountIds({ onSetName })
    openField(el, 0)
    const input = field(el)!
    expect(document.activeElement).toBe(input)
    expect([input.value, input.placeholder, input.selectionStart, input.selectionEnd]).toEqual(['Plan', 'Plan', 0, 4])
    expect(tabs(el)[0].classList.contains('tabbar__tab--renaming')).toBe(true)
    expect(tabs(el)[0].getAttribute('draggable')).toBe('false')
    type(input, '  Plan · outline ')
    key(input, 'Enter')
    expect(onSetName).toHaveBeenCalledExactlyOnceWith('t1', 'Plan · outline')
    expect(field(el)).toBeNull()
  })

  const dblclick = (el: HTMLElement, i: number) => act(() => void el.querySelectorAll('[role="tab"]')[i].dispatchEvent(new MouseEvent('dblclick', { bubbles: true })))

  it('YAZ-3059 S6, S8: a double click keeps the preview tab and opens its name field, the display name selected', () => {
    const onKeep = vi.fn()
    const onSetName = vi.fn()
    const el = mountIds({ onKeep, onSetName, preview: 't2' })
    dblclick(el, 1)
    expect(onKeep).toHaveBeenCalledExactlyOnceWith('t2')
    const input = field(el)!
    expect(document.activeElement).toBe(input)
    expect([input.value, input.placeholder, input.selectionStart, input.selectionEnd]).toEqual(['Outline', 'Plan', 0, 7])
    key(input, 'Enter')
    expect(onSetName).not.toHaveBeenCalled()
  })

  it('YAZ-3059 S15: with no onSetName, a double click only keeps the tab', () => {
    const onKeep = vi.fn()
    const el = mountIds({ onKeep })
    dblclick(el, 0)
    expect(onKeep).toHaveBeenCalledExactlyOnceWith('t1')
    expect(field(el)).toBeNull()
  })

  it('S3, S4, S10: Esc changes nothing; an empty field or the page name is no display name; a click away saves; "Reset to page name" clears it', () => {
    const onSetName = vi.fn()
    const el = mountIds({ onSetName })
    openField(el, 1)
    type(field(el)!, 'Other')
    key(field(el)!, 'Escape')
    expect(onSetName).not.toHaveBeenCalled()
    openField(el, 1)
    type(field(el)!, '   ')
    key(field(el)!, 'Enter')
    expect(onSetName).toHaveBeenLastCalledWith('t2', null)
    openField(el, 1)
    type(field(el)!, 'Plan')
    key(field(el)!, 'Enter')
    expect(onSetName).toHaveBeenLastCalledWith('t2', null)
    openField(el, 1)
    type(field(el)!, 'Draft')
    act(() => field(el)!.blur())
    expect(onSetName).toHaveBeenLastCalledWith('t2', 'Draft')
    act(() => void tabs(el)[1].dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true })))
    act(() => [...el.querySelectorAll<HTMLButtonElement>('.ctx-menu [role="menuitem"]')].find((b) => b.textContent === 'Reset to page name')?.click())
    expect(onSetName).toHaveBeenLastCalledWith('t2', null)
  })
})

describe('TabBar: the four tab changes (YAZ-3808)', () => {
  const TABS = ['/v/a.md', '/v/b.md', '/v/c.md']
  const props = { onActivate: vi.fn(), onClose: vi.fn(), ...noNav }
  const tabAt = (el: HTMLElement, i: number) => [...el.querySelectorAll<HTMLElement>('.tabbar__tab')][i]
  const gaps = (el: HTMLElement) => [...el.querySelectorAll('.tabbar__tab--gap-before, .tabbar__tab--gap-after')].map((tab) => `${tab.textContent?.replace('✕', '')}:${tab.classList.contains('tabbar__tab--gap-before') ? 'before' : 'after'}`)
  const fire = (target: Element, type: string, clientX = 0, clientY = 0) =>
    act(() => void target.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true, clientX, clientY })))
  /** A strip from x 100 to 400, scrolled so the first tab is half hidden: tab i stands at 50 + 100·i, 100 px wide. */
  const layOut = (el: HTMLElement) => {
    const strip = el.querySelector<HTMLElement>('.tabbar')!
    strip.getBoundingClientRect = () => ({ left: 100, right: 400, top: 0, bottom: 40, width: 300, height: 40 }) as DOMRect
    Object.defineProperties(strip, { scrollWidth: { configurable: true, value: 1000 }, clientWidth: { configurable: true, value: 300 } })
    // The row ends at x 600, where the right panel would start.
    strip.parentElement!.getBoundingClientRect = () => ({ left: 0, right: 600, top: 0, bottom: 40, width: 600, height: 40 }) as DOMRect
    el.querySelectorAll<HTMLElement>('[data-tab]').forEach((tab, i) => {
      Object.defineProperties(tab, { offsetLeft: { configurable: true, value: i * 100 - 50 }, offsetWidth: { configurable: true, value: 100 } })
      tab.getBoundingClientRect = () => ({ left: 50 + i * 100, width: 100, top: 0, bottom: 40 }) as DOMRect
    })
  }
  afterEach(() => {
    act(() => void releaseOverStrip())
    vi.unstubAllGlobals()
    delete (window as unknown as Record<string, unknown>).matchMedia
    putLayoutBack()
    vi.restoreAllMocks()
    delete (HTMLElement.prototype as unknown as Record<string, unknown>).animate
  })

  it('D1: a tab board card held over the strip draws the same line as a drag; the release answers its slot and puts the line out; unmounted, the strip takes no card', () => {
    const el = mount({ tabs: TABS, active: '/v/a.md', onMove: vi.fn(), ...props })
    layOut(el)
    act(() => holdOverStrip(140, 20)) // right half of b (b stands at 150 to 250; the strip starts at 100)
    expect(gaps(el)).toEqual(['b:before'])
    act(() => holdOverStrip(420, 20)) // past the strip's end, over the "+"
    expect(gaps(el)).toEqual(['c:after'])
    act(() => holdOverStrip(250, 99)) // below the strip
    expect(gaps(el)).toEqual([])
    // This window's own card: either side of its own tab moves nothing, so no line shows there (as for a tab drag).
    act(() => holdOverStrip(140, 20, '/v/b.md'))
    expect(gaps(el)).toEqual([])
    act(() => holdOverStrip(210, 20, '/v/b.md'))
    expect(gaps(el)).toEqual([])
    act(() => holdOverStrip(210, 20, '/v/a.md'))
    expect(gaps(el)).toEqual(['c:before'])
    act(() => holdOverStrip(210, 20))
    let slot: number | null = null
    act(() => void (slot = releaseOverStrip(210, 20)))
    expect(slot).toBe(2)
    expect(gaps(el)).toEqual([])
    act(() => root?.unmount())
    root = null
    expect(releaseOverStrip(210, 20)).toBeNull()
  })

  it('D5: a drag held at the strip\'s right end scrolls it frame by frame; the drop stops it', () => {
    const frames: FrameRequestCallback[] = []
    vi.stubGlobal('requestAnimationFrame', (f: FrameRequestCallback) => frames.push(f))
    vi.stubGlobal('cancelAnimationFrame', () => void frames.splice(0))
    const onMove = vi.fn()
    const el = mount({ tabs: TABS, active: '/v/a.md', onMove, ...props })
    layOut(el)
    const strip = el.querySelector<HTMLElement>('.tabbar')!
    fire(tabAt(el, 0), 'dragstart')
    act(() => frames.splice(0).forEach((f) => f(0))) // the tab leaves the strip (6A)
    fire(tabAt(el, 2), 'dragover', 395)
    expect(frames).toHaveLength(1)
    act(() => frames.splice(0).forEach((f) => f(0)))
    expect(strip.scrollLeft).toBeGreaterThan(0)
    fire(tabAt(el, 2), 'drop', 395)
    expect(frames).toHaveLength(0)
    expect(onMove).toHaveBeenCalledWith(0, 2)
  })

  it('D5: a drag held over the "+" scrolls the strip, and a drop there lands at the end, never a tear-off (YAZ-3984)', () => {
    const frames: FrameRequestCallback[] = []
    vi.stubGlobal('requestAnimationFrame', (f: FrameRequestCallback) => frames.push(f))
    vi.stubGlobal('cancelAnimationFrame', () => void frames.splice(0))
    const onMove = vi.fn()
    const onTearOff = vi.fn()
    const el = mount({ tabs: TABS, active: '/v/a.md', onMove, onTearOff, onNewTab: vi.fn(), ...props })
    layOut(el)
    const plus = el.querySelector<HTMLElement>('.tabbar__new')!
    fire(tabAt(el, 0), 'dragstart')
    act(() => frames.splice(0).forEach((f) => f(0))) // the tab leaves the strip (6A)
    const over = new MouseEvent('dragover', { bubbles: true, cancelable: true, clientX: 415, clientY: 20 })
    act(() => void plus.dispatchEvent(over))
    expect(over.defaultPrevented).toBe(true) // the "+" takes the drop
    expect(frames).toHaveLength(1) // and the strip scrolls
    expect(gaps(el)).toEqual(['c:after'])
    // On its icon too: the drag's target is the svg inside the button.
    act(() => void plus.querySelector('svg')?.dispatchEvent(new MouseEvent('dragover', { bubbles: true, cancelable: true, clientX: 415, clientY: 20 })))
    fire(plus, 'drop', 415, 20)
    expect(onMove).toHaveBeenCalledExactlyOnceWith(0, 2)
    expect(frames).toHaveLength(0)
    vi.unstubAllGlobals()
  })

  it('D5: a drop on ‹ › lands at the first tab on show — never off every surface (a tear-off)', () => {
    const onMove = vi.fn()
    const onTearOff = vi.fn()
    const el = mount({ tabs: TABS, active: '/v/a.md', onMove, onTearOff, ...props })
    layOut(el)
    const nav = el.querySelector<HTMLElement>('.tabbar-nav')!
    fire(tabAt(el, 2), 'dragstart')
    fire(nav, 'dragover', 60, 20)
    expect(gaps(el)).toEqual(['b:before']) // a is half hidden: b is the first tab on show
    fire(nav, 'drop', 60, 20)
    expect(onMove).toHaveBeenCalledExactlyOnceWith(2, 1)
    expect(onTearOff).not.toHaveBeenCalled()
  })

  it('D6: a reorder glides each tab that changed place from where it stood; a tab that opens, and "Reduce motion", glide nothing', () => {
    Object.defineProperty(window, 'matchMedia', { configurable: true, value: () => ({ matches: false }) })
    Object.defineProperty(HTMLElement.prototype, 'offsetLeft', {
      configurable: true,
      get(this: HTMLElement) {
        return this.dataset.tab === undefined ? 0 : [...this.parentElement!.querySelectorAll('[data-tab]')].indexOf(this) * 100
      },
    })
    // Where each tab is drawn: where the layout puts it, with no gap open.
    vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function (this: Element) {
      return { left: this instanceof HTMLElement && this.dataset.tab !== undefined ? this.offsetLeft : 0 } as DOMRect
    })
    const glides: Array<[string, string]> = []
    // jsdom has no Web Animations API.
    Object.defineProperty(HTMLElement.prototype, 'animate', {
      configurable: true,
      value(this: HTMLElement, keyframes: Keyframe[]) {
        glides.push([this.dataset.tab ?? '', String(keyframes[0].transform)])
        return {} as Animation
      },
    })
    const render = (tabs: string[]) => act(() => root?.render(<TabBar roots={['/v']} titles={new Map()} tabs={tabs} active="/v/a.md" onMove={vi.fn()} {...props} />))
    mount({ tabs: TABS, active: '/v/a.md', onMove: vi.fn(), ...props })
    render(['/v/c.md', '/v/a.md', '/v/b.md'])
    expect(glides).toEqual([
      ['/v/c.md', 'translateX(200px)'],
      ['/v/a.md', 'translateX(-100px)'],
      ['/v/b.md', 'translateX(-100px)'],
    ])
    // A new name moves tabs, but the order is the same: no glide.
    glides.length = 0
    act(() => root?.render(<IdTabBar roots={['/v']} titles={new Map()} windowId="w1" tabs={[{ id: '/v/c.md', path: '/v/c.md', name: 'A much longer name' }, { id: '/v/a.md', path: '/v/a.md' }, { id: '/v/b.md', path: '/v/b.md' }]} active="/v/a.md" onMove={vi.fn()} {...props} />))
    expect(glides).toEqual([])
    render(['/v/c.md', '/v/a.md', '/v/d.md', '/v/b.md'])
    expect(glides).toEqual([])
    render(['/v/c.md', '/v/d.md', '/v/b.md']) // a close slides the ghost shut; nothing glides
    expect(glides).toEqual([])
    render(['/v/c.md', '/v/a.md', '/v/d.md', '/v/b.md'])
    Object.defineProperty(window, 'matchMedia', { configurable: true, value: () => ({ matches: true }) })
    render(['/v/a.md', '/v/c.md', '/v/d.md', '/v/b.md'])
    expect(glides).toEqual([])
  })
})

describe('TabBar: the live gap (YAZ-3808 6A)', () => {
  const TABS = ['/v/a.md', '/v/b.md', '/v/c.md', '/v/d.md']
  const props = { onActivate: vi.fn(), onClose: vi.fn(), ...noNav }
  const tabAt = (el: HTMLElement, i: number) => [...el.querySelectorAll<HTMLElement>('[data-tab]')][i]
  /** Each tab's `transform`, by name: where the gap draws it, in px off its place. */
  const shifts = (el: HTMLElement) => [...el.querySelectorAll<HTMLElement>('[data-tab]')].map((tab) => `${tab.textContent?.replace('✕', '').replace('.md', '')}${tab.style.transform === '' ? '' : ` ${tab.style.transform}`}`)
  const fire = (target: Element, type: string, dx = 0, data?: unknown) => {
    const event = new MouseEvent(type, { bubbles: true, cancelable: true, clientX: xOn(target, dx), clientY: 20 })
    if (data !== undefined) Object.defineProperty(event, 'dataTransfer', { value: data })
    act(() => void target.dispatchEvent(event))
  }
  const nextFrame = () => act(() => new Promise<void>((done) => requestAnimationFrame(() => done())))
  beforeEach(layTabsOut)
  afterEach(() => {
    act(() => void releaseOverStrip())
    putLayoutBack()
    vi.restoreAllMocks()
    delete (window as unknown as Record<string, unknown>).matchMedia
    delete (HTMLElement.prototype as unknown as Record<string, unknown>).animate
  })

  it('a tab dragged right leaves its place, and only the tabs it passes slide back one room; the drop clears every shift', async () => {
    const onMove = vi.fn()
    const el = mount({ tabs: TABS, active: '/v/a.md', onMove, ...props })
    fire(tabAt(el, 0), 'dragstart')
    await nextFrame()
    expect(tabAt(el, 0).classList.contains('tabbar__tab--dragging')).toBe(true)
    expect(el.querySelector('.tabbar')!.classList.contains('tabbar--parting')).toBe(true)
    fire(tabAt(el, 1), 'dragover', 5) // right half of b: the gap is after b
    expect(shifts(el)).toEqual(['a', 'b translateX(-100px)', 'c', 'd'])
    fire(tabAt(el, 2), 'dragover', 5) // one tab on: one more tab slides
    expect(shifts(el)).toEqual(['a', 'b translateX(-100px)', 'c translateX(-100px)', 'd'])
    // Off the row the gap goes back to the tab's own place: a drop there lands in no slot. Back on, it follows again.
    act(() => void el.querySelector('.tabbar-row')!.dispatchEvent(new MouseEvent('dragleave', { bubbles: true, relatedTarget: document.body })))
    expect(shifts(el)).toEqual(['a', 'b', 'c', 'd'])
    expect(tabAt(el, 0).classList.contains('tabbar__tab--dragging')).toBe(true)
    fire(tabAt(el, 2), 'dragover', 5)
    expect(shifts(el)).toEqual(['a', 'b translateX(-100px)', 'c translateX(-100px)', 'd'])
    fire(tabAt(el, 2), 'drop', 5)
    expect(onMove).toHaveBeenCalledExactlyOnceWith(0, 2)
    expect(shifts(el)).toEqual(['a', 'b', 'c', 'd'])
    expect(el.querySelector('.tabbar--parting, .tabbar__tab--dragging')).toBeNull()
  })

  it('a tab dragged left: the tabs it passes slide right; on either side of its own place the gap stays where it was', async () => {
    const el = mount({ tabs: TABS, active: '/v/a.md', onMove: vi.fn(), ...props })
    fire(tabAt(el, 3), 'dragstart')
    await nextFrame()
    fire(tabAt(el, 1), 'dragover', -5)
    expect(shifts(el)).toEqual(['a', 'b translateX(100px)', 'c translateX(100px)', 'd'])
    fire(tabAt(el, 3), 'dragover', -5) // its own place: nothing moves
    expect(shifts(el)).toEqual(['a', 'b', 'c', 'd'])
    fire(tabAt(el, 3), 'dragend')
    expect(el.querySelector('.tabbar--parting, .tabbar__tab--dragging')).toBeNull()
  })

  it('the drop place is read from the layout, not from where the gap draws a tab: the gap does not flicker under a still pointer', async () => {
    const el = mount({ tabs: TABS, active: '/v/a.md', onMove: vi.fn(), ...props })
    fire(tabAt(el, 0), 'dragstart')
    await nextFrame()
    // At x 170: b's right half in the layout (b stands at 100 to 200). b slides to 0 to 100; the pointer is over
    // the gap now, and the slot stays.
    const strip = el.querySelector<HTMLElement>('.tabbar')!
    for (let i = 0; i < 3; i++) {
      act(() => void strip.dispatchEvent(new MouseEvent('dragover', { bubbles: true, cancelable: true, clientX: 170 })))
      expect(shifts(el)).toEqual(['a', 'b translateX(-100px)', 'c', 'd'])
    }
  })

  it('a tab from another window: the tabs after the slot slide into room opened at the strip\'s end; leaving the row closes it', () => {
    const data = { types: [WORKSPACE_PAGE_MIME, 'application/x-yaseen-from-w2.0'], effectAllowed: 'move', dropEffect: 'none', getData: () => '', setData: vi.fn() }
    const el = mount({ tabs: TABS, active: '/v/a.md', onMove: vi.fn(), takesDrag: () => true, onDropFromWindow: vi.fn(), ...props })
    fire(tabAt(el, 1), 'dragover', -5, data)
    expect(shifts(el)).toEqual(['a', 'b translateX(124px)', 'c translateX(124px)', 'd translateX(124px)'])
    expect(el.querySelector<HTMLElement>('.tabbar__room')?.style.width).toBe('124px')
    expect(el.querySelector('.tabbar__tab--dragging')).toBeNull() // no tab of this strip left it
    act(() => void el.querySelector('.tabbar-row')!.dispatchEvent(new MouseEvent('dragleave', { bubbles: true, relatedTarget: document.body })))
    expect(shifts(el)).toEqual(['a', 'b', 'c', 'd'])
    expect(el.querySelector('.tabbar__room')).toBeNull()
  })

  it('a tab board card: this window\'s own tab leaves the strip and the gap moves as for a drag; another window\'s card opens room', () => {
    const el = mount({ tabs: TABS, active: '/v/a.md', onMove: vi.fn(), ...props })
    const strip = el.querySelector<HTMLElement>('.tabbar')!
    strip.getBoundingClientRect = () => ({ left: 0, right: 400, top: 0, bottom: 40, width: 400, height: 40 }) as DOMRect
    act(() => holdOverStrip(250, 20, '/v/a.md')) // c's right half: the gap after c
    expect(tabAt(el, 0).classList.contains('tabbar__tab--dragging')).toBe(true)
    expect(shifts(el)).toEqual(['a', 'b translateX(-100px)', 'c translateX(-100px)', 'd'])
    act(() => holdOverStrip(250, 20))
    expect(tabAt(el, 0).classList.contains('tabbar__tab--dragging')).toBe(false)
    expect(shifts(el)).toEqual(['a', 'b', 'c', 'd translateX(124px)'])
    act(() => void releaseOverStrip(250, 20))
    expect(shifts(el)).toEqual(['a', 'b', 'c', 'd'])
    expect(el.querySelector('.tabbar__room, .tabbar--parting')).toBeNull()
  })

  it('6D: a card held over the strip shows its tab, with its name, where it will land; off the strip and after the release there is none', () => {
    const el = mount({ tabs: TABS, active: '/v/a.md', onMove: vi.fn(), ...props })
    const strip = el.querySelector<HTMLElement>('.tabbar')!
    strip.getBoundingClientRect = () => ({ left: 0, right: 400, top: 0, bottom: 40, width: 400, height: 40 }) as DOMRect
    const landing = () => {
      const tab = el.querySelector<HTMLElement>('.tabbar__tab--landing')
      return tab === null ? null : `${tab.textContent} ${tab.style.left} ${tab.style.width}`
    }
    // This window's a, after c: where a stands once the drop is done.
    let on = false
    act(() => void (on = holdOverStrip(250, 20, '/v/a.md', 'Alpha')))
    expect(on).toBe(true)
    expect(landing()).toBe('Alpha 200px 100px')
    expect(el.querySelector('.tabbar__tab--landing')?.hasAttribute('data-tab')).toBe(false) // never a slot of its own
    act(() => void holdOverStrip(60, 20, '/v/a.md', 'Alpha')) // either side of its own place: it stands there
    expect(landing()).toBe('Alpha 0px 100px')
    // Another window's card, before d: the room opened for it.
    act(() => void holdOverStrip(250, 20, undefined, 'Elsewhere'))
    expect(landing()).toBe('Elsewhere 300px 124px')
    act(() => void (on = holdOverStrip(250, 99, undefined, 'Elsewhere')))
    expect(on).toBe(false)
    expect(landing()).toBeNull()
    act(() => void holdOverStrip(250, 20, undefined, 'Elsewhere'))
    act(() => void releaseOverStrip(250, 20))
    expect(landing()).toBeNull()
  })

  it('a drop into the gap glides nothing: the strip already shows the new order, and the tab let go stood nowhere', async () => {
    Object.defineProperty(window, 'matchMedia', { configurable: true, value: () => ({ matches: false }) })
    // Where each tab is drawn: its place in the layout, moved by the gap.
    vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function (this: Element) {
      if (!(this instanceof HTMLElement) || this.dataset.tab === undefined) return { left: 0 } as DOMRect
      return { left: this.offsetLeft + (parseFloat(/-?[\d.]+/.exec(this.style.transform)?.[0] ?? '0') || 0) } as DOMRect
    })
    const glides: string[] = []
    Object.defineProperty(HTMLElement.prototype, 'animate', {
      configurable: true,
      value(this: HTMLElement) {
        glides.push(this.dataset.tab ?? '')
        return {} as Animation
      },
    })
    let tabs = TABS
    const onMove = vi.fn((from: number, to: number) => {
      const next = [...tabs]
      next.splice(to, 0, ...next.splice(from, 1))
      tabs = next
      act(() => root?.render(<TabBar roots={['/v']} titles={new Map()} tabs={tabs} active="/v/a.md" onMove={onMove} {...props} />))
    })
    const el = mount({ tabs, active: '/v/a.md', onMove, ...props })
    fire(tabAt(el, 0), 'dragstart')
    await nextFrame()
    fire(tabAt(el, 2), 'dragover', 5)
    fire(tabAt(el, 2), 'drop', 5)
    expect(tabs).toEqual(['/v/b.md', '/v/c.md', '/v/a.md', '/v/d.md'])
    expect(glides).toEqual([])
  })
})
