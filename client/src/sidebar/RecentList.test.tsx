import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, Profiler } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { defaultAppState, defaultFolderState, defaultRightPanelIdentity, type AppState, type TreeNode, type TreeResponse, type WindowIdentity } from '@shared/types'
import { storage } from '../lib/storage'
import { RecentList } from './RecentList'
import { MAX_RECENTS, timeOf } from './recents'
import { rowIcon } from './rowIcons'

const note = (path: string): TreeNode => ({ type: 'file', name: path.slice(path.lastIndexOf('/') + 1), path, size: 1, mtime: 1, kind: 'markdown' })
const tree = (root: string, paths: string[]): TreeResponse => ({ root, tree: paths.map(note), generatedAt: 1 })
const at = (y: number, m: number, d: number, h = 12, min = 0) => new Date(y, m - 1, d, h, min).getTime()
const NOW = at(2026, 10, 23, 15)
const stateWith = (edits: Record<string, Record<string, number>>): AppState => ({ ...defaultAppState(), folders: Object.fromEntries(Object.entries(edits).map(([root, log]) => [root, { ...defaultFolderState(), edits: log }])) })

/** The bridge the cache needs: a pushed state goes through `emit`, as `state:changed` does. */
function installBridge(app: AppState) {
  let listener: ((s: AppState) => void) | null = null
  const bridge = {
    state: {
      get: vi.fn(async () => app),
      onChange: vi.fn((l: (s: AppState) => void) => {
        listener = l
        return () => undefined
      }),
    },
    window: { identity: vi.fn(async (): Promise<WindowIdentity> => ({ id: 'w1', root: '/v', roots: ['/v', '/w'], file: null, tabs: [], rightPanel: defaultRightPanelIdentity(), sidebarCollapsed: false, sidebarLens: 'recents' })) },
  }
  Object.defineProperty(window, 'yaseenDocs', { value: bridge, configurable: true, writable: true })
  return { emit: (next: AppState) => act(() => listener?.(next)) }
}

let root: Root | null = null
let el: HTMLElement
let b: ReturnType<typeof installBridge>
let renders = 0
const TREES = new Map([
  ['/v', tree('/v', ['/v/a.md', '/v/b.md', '/v/c.md'])],
  ['/w', tree('/w', ['/w/d.md'])],
])
const ROOTS = ['/v', '/w']
const props = { trees: TREES, roots: ROOTS, titles: new Map([['/v/a.md', 'Alpha page']]), activeFile: null as string | null, onOpenFile: vi.fn(), onKeepFile: vi.fn(), onOpenFileBackground: vi.fn(), onMenu: vi.fn() }

async function mount(app: AppState, extra: Partial<Parameters<typeof RecentList>[0]> = {}) {
  b = installBridge(app)
  await storage.init()
  el = document.createElement('div')
  document.body.appendChild(el)
  root = createRoot(el)
  renders = 0
  act(() => root?.render(<Profiler id="list" onRender={() => void renders++}><RecentList {...props} {...extra} /></Profiler>))
}

const days = () => [...el.querySelectorAll<HTMLButtonElement>('.recents__day')]
const dayLabels = () => days().map((d) => d.textContent)
const rows = () => [...el.querySelectorAll<HTMLButtonElement>('[aria-label="Recents"] li > ul .tree__row')]
const text = (row: Element) => [...row.children].map((c) => c.textContent)
const msg = () => el.querySelector('.sidebar__msg')?.textContent ?? null
const fire = (target: Element, type: string, init: MouseEventInit = {}) => {
  const e = new MouseEvent(type, { bubbles: true, cancelable: true, ...init })
  act(() => void target.dispatchEvent(e))
  return e
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] })
  vi.setSystemTime(NOW)
})
afterEach(() => {
  act(() => root?.unmount())
  root = null
  el.remove()
  vi.useRealTimers()
  delete (window as unknown as Record<string, unknown>).yaseenDocs
})

describe('RecentList (YAZ-3235 D3 to D7)', () => {
  it('S22: with no logged file the tab says "Files you edit show here."; a tree still on its way says "Loading…"', async () => {
    await mount(stateWith({}))
    expect([msg(), el.querySelector('.tree')]).toEqual(['Files you edit show here.', null])
    act(() => root?.render(<RecentList {...props} trees={new Map([['/v', TREES.get('/v')!]])} />))
    expect(msg()).toBe('Loading…')
  })

  it('S14, S18: one list for both vaults, newest first, under its day; a row shows the page name and the time, the path is the tooltip, and the open file lights', async () => {
    await mount(stateWith({ '/v': { '/v/a.md': at(2026, 10, 23, 9, 5), '/v/b.md': at(2026, 10, 22, 18) }, '/w': { '/w/d.md': at(2026, 10, 23, 14, 42) } }), { activeFile: '/v/a.md' })
    expect(dayLabels()).toEqual(['Today', 'Yesterday'])
    expect(rows().map(text)).toEqual([
      ['d', timeOf(at(2026, 10, 23, 14, 42))],
      ['Alpha page', timeOf(at(2026, 10, 23, 9, 5))],
      ['b', timeOf(at(2026, 10, 22, 18))],
    ])
    expect(rows().map((r) => r.title)).toEqual(['/w/d.md', '/v/a.md', '/v/b.md'])
    expect(rows().map((r) => r.classList.contains('tree__row--active'))).toEqual([false, true, false])
    expect(msg()).toBeNull()
  })

  it("each row shows its Files row's icon first in its label (YAZ-3440 D11)", async () => {
    await mount(stateWith({ '/v': { '/v/a.md': at(2026, 10, 23, 9, 5) } }))
    const icon = rows()[0].querySelector<HTMLElement>('.tree__label > .file-icon:first-child')!
    expect(icon.dataset.icon).toBe(rowIcon(undefined, '/v/a.md', 'a.md', 'file').id)
    expect(icon.dataset.kind).toBe('markdown')
    expect(rows()[0].querySelector('.tree__label')?.textContent).toBe('Alpha page')
  })

  it('S17: a click on a day heading folds it, and a second click opens it; all days start open', async () => {
    await mount(stateWith({ '/v': { '/v/a.md': at(2026, 10, 23, 9), '/v/b.md': at(2026, 10, 22, 18) } }))
    expect(days().map((d) => [d.getAttribute('aria-expanded'), d.querySelector('.tree__chevron--open') !== null])).toEqual([['true', true], ['true', true]])
    act(() => days()[0].click())
    expect(days()[0].getAttribute('aria-expanded')).toBe('false')
    expect(days()[0].querySelector('.tree__chevron--open')).toBeNull()
    expect(rows().map((r) => r.title)).toEqual(['/v/b.md'])
    act(() => days()[0].click())
    expect(rows().map((r) => r.title)).toEqual(['/v/a.md', '/v/b.md'])
  })

  it('YAZ-3511 D19, edge case 68: the list reports its fold, and the expand-all button closes and opens every day', async () => {
    const onFold = vi.fn()
    await mount(stateWith({ '/v': { '/v/a.md': at(2026, 10, 23, 9), '/v/b.md': at(2026, 10, 22, 18) } }), { onFold })
    expect(onFold.mock.lastCall?.[0]).toMatchObject({ open: true, any: true })
    act(() => onFold.mock.lastCall?.[0].setAll(false))
    expect(days().map((d) => d.getAttribute('aria-expanded'))).toEqual(['false', 'false'])
    expect(rows()).toEqual([])
    act(() => onFold.mock.lastCall?.[0].setAll(true))
    expect(rows().map((r) => r.title)).toEqual(['/v/a.md', '/v/b.md'])
  })

  it('S19, S20: a click previews, a ⌘-click opens a background tab, a double-click keeps the tab; a right-click hands the path and the event to the menu', async () => {
    await mount(stateWith({ '/v': { '/v/a.md': at(2026, 10, 23, 9) } }))
    const [row] = rows()
    fire(row, 'click', { detail: 1 })
    expect(props.onOpenFile).toHaveBeenCalledExactlyOnceWith('/v/a.md')
    fire(row, 'click', { metaKey: true, detail: 1 })
    expect(props.onOpenFileBackground).toHaveBeenCalledExactlyOnceWith('/v/a.md')
    expect(props.onOpenFile).toHaveBeenCalledTimes(1)
    fire(row, 'dblclick', { detail: 2 })
    expect(props.onKeepFile).toHaveBeenCalledExactlyOnceWith('/v/a.md')
    fire(row, 'dblclick', { metaKey: true, detail: 2 })
    expect(props.onKeepFile).toHaveBeenCalledTimes(1)
    const menu = fire(row, 'contextmenu', { clientX: 40, clientY: 50 })
    expect(props.onMenu).toHaveBeenCalledOnce()
    expect(vi.mocked(props.onMenu).mock.calls[0][0]).toBe('/v/a.md')
    expect(vi.mocked(props.onMenu).mock.calls[0][1].nativeEvent).toBe(menu)
  })

  it(`S21: past ${MAX_RECENTS} logged files the ${MAX_RECENTS} newest show, then the line "Showing the ${MAX_RECENTS} newest files."`, async () => {
    const paths = Array.from({ length: 230 }, (_, i) => `/v/n${i}.md`)
    await mount(stateWith({ '/v': Object.fromEntries(paths.map((p, i) => [p, NOW - i * 1000])) }), { trees: new Map([['/v', tree('/v', paths)]]), roots: ['/v'] })
    expect(rows()).toHaveLength(MAX_RECENTS)
    expect(msg()).toBe(`Showing the ${MAX_RECENTS} newest files.`)
  })

  it('S16: at midnight "Today" becomes "Yesterday" with no save and no click; the timer goes with the list', async () => {
    vi.setSystemTime(at(2026, 10, 23, 23, 58))
    await mount(stateWith({ '/v': { '/v/a.md': at(2026, 10, 23, 23, 57) } }))
    expect(dayLabels()).toEqual(['Today'])
    act(() => vi.advanceTimersByTime(60_000))
    expect(dayLabels()).toEqual(['Today'])
    act(() => vi.advanceTimersByTime(2 * 60_000))
    expect(dayLabels()).toEqual(['Yesterday'])
    expect(vi.getTimerCount()).toBe(1) // the timer to the next midnight
    act(() => root?.unmount())
    root = null
    expect(vi.getTimerCount()).toBe(0)
  })

  it('a broadcast with the same save logs does not draw the list again; a new save does', async () => {
    const logs = { '/v': { '/v/a.md': at(2026, 10, 23, 9) }, '/w': { '/w/d.md': at(2026, 10, 23, 10) } }
    await mount(stateWith(logs))
    const drawn = renders
    // Each broadcast is a new copy of the whole state: a tab click, a fold, a save in another vault's other field.
    b.emit({ ...stateWith(structuredClone(logs)), sidebarWidth: 300 })
    b.emit(stateWith(structuredClone(logs)))
    expect(renders).toBe(drawn)
    b.emit(stateWith({ ...logs, '/v': { ...logs['/v'], '/v/c.md': at(2026, 10, 23, 14) } }))
    expect(renders).toBe(drawn + 1)
    expect(rows().map((r) => r.title)).toEqual(['/v/c.md', '/w/d.md', '/v/a.md'])
  })
})
