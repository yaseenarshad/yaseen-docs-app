/**
 * The new tab page (YAZ-2663 D3, D4): three columns off the open history, the favorites and the
 * Files tree. The bridge is the jsdom stub pattern (App.test.tsx), so the real storage, tree feed
 * and api modules run against it. The rules of the third column are `suggestFavorites.test.ts`'s.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, useState, type ReactNode } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { defaultAppState, defaultFolderState, defaultRightPanelIdentity, type AppState, type OpenStat, type TreeNode, type WindowIdentity } from '@shared/types'
import { storage } from '../lib/storage'
import { START_ROWS, StartPage, type StartPageProps } from './StartPage'
import startCss from './startPage.css?inline'

;(globalThis as unknown as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true

const NOW = 1_800_000_000_000
const HOUR = 3_600_000

let root: Root | null = null
let container: HTMLElement | null = null
/** A fresh vault per test: the tree feed keeps the newest tree of each root for the life of the module. */
let seq = 0
const vault = (name = 'v') => `/${name}${++seq}`

const file = (path: string, kind: 'markdown' | 'pdf' | null = 'markdown'): TreeNode => ({ type: 'file', name: path.slice(path.lastIndexOf('/') + 1), path, size: 1, mtime: 1, kind })
const dir = (path: string, children: TreeNode[] = []): TreeNode => ({ type: 'dir', name: path.slice(path.lastIndexOf('/') + 1), path, children })
const used = (score: number, ago = 0): OpenStat => ({ score, last: NOW - ago })

interface Fixture {
  /** Each vault's tree, by its root: the keys are the vaults of the window, in its order. */
  trees: Record<string, TreeNode[]>
  opens?: Record<string, Record<string, OpenStat>>
  favorites?: Record<string, string[]>
  favoritesOrder?: string[]
}

function installBridge({ trees, opens = {}, favorites = {}, favoritesOrder = [] }: Fixture) {
  const stateChanged = new Set<(next: AppState) => void>()
  const favoritesChanged = new Set<(change: { root: string }) => void>()
  const roots = Object.keys(trees)
  // The first two vaults have a name of their own: what the app calls them, and what a row's tag says (S20).
  const state: AppState = { ...defaultAppState(), favoritesOrder, folders: Object.fromEntries(roots.map((vaultRoot, at) => [vaultRoot, { ...defaultFolderState(), opens: opens[vaultRoot] ?? {}, name: ['Notes', 'Work'][at] ?? null }])) }
  const bridge = {
    tree: vi.fn(async (vaultRoot: string) => ({ root: vaultRoot, tree: trees[vaultRoot] ?? [], generatedAt: 1 })),
    favorites: {
      get: vi.fn(async (vaultRoot: string): Promise<string[]> => favorites[vaultRoot] ?? []),
      onChanged: vi.fn((listener: (change: { root: string }) => void) => {
        favoritesChanged.add(listener)
        return () => favoritesChanged.delete(listener)
      }),
    },
    shell: { openDefault: vi.fn(async ({ path }: { path: string }) => ({ path })) },
    state: {
      get: vi.fn(async () => state),
      onChange: vi.fn((listener: (next: AppState) => void) => {
        stateChanged.add(listener)
        return () => stateChanged.delete(listener)
      }),
    },
    window: { identity: vi.fn(async (): Promise<WindowIdentity> => ({ id: 'w1', root: roots[0], roots, file: null, tabs: [], rightPanel: defaultRightPanelIdentity(), sidebarCollapsed: false, sidebarLens: 'files', focusList: [] })) },
  }
  Object.defineProperty(window, 'yaseenDocs', { value: bridge, configurable: true, writable: true })
  return {
    bridge,
    state,
    trees,
    favorites,
    favoritesChanged,
    emitState: (next: AppState) => act(async () => stateChanged.forEach((listener) => listener(next))),
    emitFavorites: (vaultRoot: string) => act(async () => favoritesChanged.forEach((listener) => listener({ root: vaultRoot }))),
  }
}

/** The doors of App, each a spy; `focusRef` is the box that the page fills with its way in (S33). */
const doors = (roots: readonly string[]): StartPageProps => ({ roots, titles: new Map(), onOpen: vi.fn(), onOpenBackground: vi.fn(), onShowInFiles: vi.fn(), onRowMenu: vi.fn(), onBackToSearch: vi.fn(), focusRef: { current: null }, onNotice: vi.fn() })

/** `Page` is what draws the page: the page itself, or a part that holds state for it, as App does. */
async function mount(fixture: Fixture, over: Partial<StartPageProps> = {}, Page: (props: StartPageProps) => ReactNode = StartPage) {
  const b = installBridge(fixture)
  await storage.init()
  const props: StartPageProps = { ...doors(Object.keys(fixture.trees)), ...over }
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  await act(async () => root?.render(<Page {...props} />))
  return { ...b, el: container, props }
}

type Col = 'recent' | 'favorites' | 'suggested'
const column = (el: HTMLElement, col: Col) => el.querySelector<HTMLElement>(`.start__column[data-col="${col}"]`)!
const rowsOf = (el: HTMLElement, col: Col) => [...column(el, col).querySelectorAll<HTMLButtonElement>('button.start__row')]
const paths = (el: HTMLElement, col: Col) => rowsOf(el, col).map((row) => row.dataset.path)
const part = (row: HTMLElement, name: string) => row.querySelector(`.${name}`)?.textContent ?? null
const emptyLine = (el: HTMLElement, col: Col) => column(el, col).querySelector('.start__empty')?.textContent ?? null
const row = (el: HTMLElement, path: string) => [...el.querySelectorAll<HTMLButtonElement>('button.start__row')].find((button) => button.dataset.path === path)!
const click = (target: Element, init: MouseEventInit = {}) => act(async () => void target.dispatchEvent(new MouseEvent('click', { bubbles: true, ...init })))
/** One key on the row that has the keyboard focus; the event says whether the page took the key from the browser. */
const press = (key: string, init: KeyboardEventInit = {}) => {
  const event = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...init })
  act(() => void document.activeElement?.dispatchEvent(event))
  return event
}
/** Where the keyboard focus is: the column and the row number of a row of the page, or null. */
const at = () => {
  const on = document.activeElement
  return on instanceof HTMLElement && on.matches('button.start__row') ? `${on.dataset.col} ${on.dataset.row}` : null
}
const cell = (el: HTMLElement, col: Col, n: number) => rowsOf(el, col)[n]

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(NOW)
})

afterEach(() => {
  act(() => root?.unmount())
  root = null
  container?.remove()
  container = null
  vi.clearAllMocks()
  vi.useRealTimers()
})

describe('StartPage', () => {
  it('S11, S12, S24: three columns; "Recent" shows the 8 pages last on show, the newest first, from every vault, each with its name, its folder and how long ago; the old line is gone', async () => {
    const v = vault()
    const w = vault('w')
    const notes = Array.from({ length: 7 }, (_, at) => `${v}/n${at}.md`)
    const { el } = await mount(
      {
        trees: { [v]: [dir(`${v}/Projects`, [dir(`${v}/Projects/Alpha`, [file(`${v}/Projects/Alpha/plan.md`)])]), ...notes.map((path) => file(path))], [w]: [file(`${w}/x.md`), file(`${w}/report.pdf`, 'pdf')] },
        opens: {
          [v]: { [`${v}/Projects/Alpha/plan.md`]: used(1, 2 * HOUR), ...Object.fromEntries(notes.map((path, at) => [path, used(1, (at + 3) * HOUR)])) },
          [w]: { [`${w}/x.md`]: used(1, 30_000), [`${w}/report.pdf`]: used(1, 26 * HOUR) },
        },
      },
      { titles: new Map([[`${v}/Projects/Alpha/plan.md`, 'The plan']]) },
    )
    expect([...el.querySelectorAll('.start__column')].map((col) => [(col as HTMLElement).dataset.col, col.querySelector('h2')?.textContent])).toEqual([
      ['recent', 'Recent'],
      ['favorites', 'Favorites'],
      ['suggested', 'Used a lot, not a favorite yet'],
    ])
    // 10 pages in the record of two vaults: the 8 newest, and the two oldest (n6, report.pdf) are not here.
    expect(START_ROWS).toBe(8)
    expect(paths(el, 'recent')).toEqual([`${w}/x.md`, `${v}/Projects/Alpha/plan.md`, ...notes.slice(0, 6)])
    const [x, plan, n0] = rowsOf(el, 'recent')
    // The name is the page's title; a page at the top of its vault names no folder.
    expect([part(plan, 'start__name'), part(plan, 'start__where'), part(plan, 'start__when')]).toEqual(['The plan', 'Projects / Alpha', '2 hours ago'])
    expect([part(x, 'start__name'), part(x, 'start__where'), part(x, 'start__when')]).toEqual(['x', null, 'just now'])
    expect(part(n0, 'start__when')).toBe('3 hours ago')
    // Each row is a button that says its column and its place in it (the arrow keys of YAZ-2674 read them).
    expect(rowsOf(el, 'recent').map((button) => [button.type, button.dataset.col, button.dataset.row])).toEqual(Array.from({ length: 8 }, (_, at) => ['button', 'recent', String(at)]))
    // S24
    expect(el.textContent).not.toContain('Select a file from the sidebar.')
    expect(el.querySelector('.editor-msg')).toBeNull()
  })

  it('S13, S20: "Favorites" shows the first 8 in the order of the Favorites tab, files and folders; with two vaults each row names its vault', async () => {
    const v = vault()
    const w = vault('w')
    const mine = [`${v}/Projects`, ...Array.from({ length: 6 }, (_, at) => `${v}/f${at}.md`)]
    const { el } = await mount({
      trees: { [v]: [dir(`${v}/Projects`), ...mine.slice(1).map((path) => file(path))], [w]: [file(`${w}/x.md`), file(`${w}/y.md`)] },
      // `not-here.md` is a favorite this machine has no file for: it draws no row and takes no place.
      favorites: { [v]: [mine[0], `${v}/not-here.md`, ...mine.slice(1)], [w]: [`${w}/x.md`, `${w}/y.md`] },
      // The order across the vaults (YAZ-2631 D1): the other vault's first favorite leads.
      favoritesOrder: [`${w}/x.md`, mine[0]],
    })
    expect(paths(el, 'favorites')).toEqual([`${w}/x.md`, ...mine])
    expect(paths(el, 'favorites')).toHaveLength(8) // 9 favorites have a file: `y.md` is the ninth
    const [x, projects] = rowsOf(el, 'favorites')
    expect([part(x, 'start__name'), part(x, 'tree__vault'), x.dataset.kind]).toEqual(['x', 'Work', 'file'])
    expect([part(projects, 'start__name'), part(projects, 'tree__vault'), projects.dataset.kind]).toEqual(['Projects', 'Notes', 'dir'])
    // A favorites row says no time.
    expect(part(x, 'start__when')).toBeNull()
  })

  it('S20: with one vault no row names it', async () => {
    const v = vault()
    const { el } = await mount({ trees: { [v]: [file(`${v}/a.md`)] }, opens: { [v]: { [`${v}/a.md`]: used(4) } }, favorites: { [v]: [`${v}/a.md`] } })
    expect(el.querySelectorAll('button.start__row')).toHaveLength(2)
    expect(el.querySelector('.tree__vault')).toBeNull()
  })

  it('S14 to S17: the third column shows the pages and folders that are used a lot and are no favorite, the highest score first', async () => {
    const v = vault()
    const inProjects = ['a', 'b', 'c'].map((name) => `${v}/Projects/${name}.md`)
    const { el } = await mount({
      trees: { [v]: [dir(`${v}/Projects`, inProjects.map((path) => file(path))), file(`${v}/often.md`), file(`${v}/seldom.md`), file(`${v}/fav.md`)] },
      opens: { [v]: { [inProjects[0]]: used(4), [inProjects[1]]: used(1), [inProjects[2]]: used(1), [`${v}/often.md`]: used(5), [`${v}/seldom.md`]: used(2), [`${v}/fav.md`]: used(9) } },
      favorites: { [v]: [`${v}/fav.md`] },
    })
    // Projects stands for its three pages (6); `seldom` is under 3; `fav` is a favorite.
    expect(rowsOf(el, 'suggested').map((button) => [button.dataset.path, button.dataset.kind, part(button, 'start__name')])).toEqual([
      [`${v}/Projects`, 'dir', 'Projects'],
      [`${v}/often.md`, 'file', 'often'],
    ])
    expect(emptyLine(el, 'suggested')).toBeNull()
  })

  it('S18, R1: a page that is gone from the disk gives no row and no error; the page asks for ONE tree of each vault when it shows, and none for a row', async () => {
    const v = vault()
    const errors = vi.spyOn(console, 'error')
    const { el, bridge, trees } = await mount({
      trees: { [v]: [file(`${v}/here.md`), file(`${v}/leaving.md`)] },
      opens: { [v]: { [`${v}/here.md`]: used(4, HOUR), [`${v}/gone.md`]: used(9), [`${v}/leaving.md`]: used(5, 2 * HOUR) } },
      favorites: { [v]: [`${v}/gone-favorite.md`] },
    })
    expect(bridge.tree.mock.calls).toEqual([[v]])
    expect(paths(el, 'recent')).toEqual([`${v}/here.md`, `${v}/leaving.md`])
    expect(paths(el, 'suggested')).toEqual([`${v}/leaving.md`, `${v}/here.md`])
    expect(paths(el, 'favorites')).toEqual([])
    // A newer tree lands on the window's one feed, whoever asked for it: the row of a page that left goes.
    trees[v] = [file(`${v}/here.md`)]
    const { fetchTree } = await import('../lib/treeFeed')
    await act(async () => void (await fetchTree(v)))
    expect(paths(el, 'recent')).toEqual([`${v}/here.md`])
    expect(paths(el, 'suggested')).toEqual([`${v}/here.md`])
    expect(errors).not.toHaveBeenCalled()
  })

  it('S19: an empty column shows its one grey line, and only after its tree and its favorites answered', async () => {
    const v = vault()
    let land: (tree: { root: string; tree: TreeNode[]; generatedAt: number }) => void = () => undefined
    let list: (favorites: string[]) => void = () => undefined
    const b = installBridge({ trees: { [v]: [] } })
    b.bridge.tree.mockImplementation(() => new Promise((resolve) => (land = resolve)))
    b.bridge.favorites.get.mockImplementation(() => new Promise((resolve) => (list = resolve)))
    await storage.init()
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
    const el = container
    await act(async () => root?.render(<StartPage {...doors([v])} />))
    // Nothing answered yet: three headings, and no line that says "empty" of a list nobody has read.
    expect(el.querySelectorAll('.start__column h2')).toHaveLength(3)
    expect(el.querySelector('.start__empty')).toBeNull()
    await act(async () => land({ root: v, tree: [], generatedAt: 1 }))
    expect([emptyLine(el, 'recent'), emptyLine(el, 'favorites'), emptyLine(el, 'suggested')]).toEqual(['Pages you open show here.', null, null])
    await act(async () => list([]))
    expect([emptyLine(el, 'recent'), emptyLine(el, 'favorites'), emptyLine(el, 'suggested')]).toEqual(['Pages you open show here.', 'No favorites yet. Right-click a file or folder → Add to favorites.', 'Nothing to suggest now.'])
    expect(el.querySelector('button.start__row')).toBeNull()
  })

  it('S21, S22: a click on a file opens it, ⌘-click opens it in the background; a click on a folder shows it in Files; a file with no viewer in the app opens in its default app', async () => {
    const v = vault()
    const { el, props, bridge } = await mount({
      trees: { [v]: [dir(`${v}/Projects`), file(`${v}/a.md`), file(`${v}/data.zip`, null)] },
      opens: { [v]: { [`${v}/a.md`]: used(1) } },
      favorites: { [v]: [`${v}/Projects`, `${v}/data.zip`] },
    })
    await click(row(el, `${v}/a.md`))
    expect([vi.mocked(props.onOpen).mock.calls, vi.mocked(props.onOpenBackground).mock.calls]).toEqual([[[`${v}/a.md`]], []])
    await click(row(el, `${v}/a.md`), { metaKey: true })
    expect([vi.mocked(props.onOpen).mock.calls, vi.mocked(props.onOpenBackground).mock.calls]).toEqual([[[`${v}/a.md`]], [[`${v}/a.md`]]])
    // S22: a click on a folder shows it in Files. ⌘-click opens its page in a background tab, the rule of a search row (D7; YAZ-2662 S3).
    await click(row(el, `${v}/Projects`))
    await click(row(el, `${v}/Projects`), { metaKey: true })
    expect(vi.mocked(props.onShowInFiles).mock.calls).toEqual([[`${v}/Projects`]])
    expect(vi.mocked(props.onOpenBackground).mock.calls).toEqual([[`${v}/a.md`], [`${v}/Projects`]])
    // As its row of the Favorites tab does (YAZ-1577 D2): no tab for a file the app cannot show.
    await click(row(el, `${v}/data.zip`))
    expect(bridge.shell.openDefault.mock.calls).toEqual([[{ path: `${v}/data.zip` }]])
    expect([vi.mocked(props.onOpen).mock.calls.length, vi.mocked(props.onOpenBackground).mock.calls.length]).toEqual([1, 2]) // the folder page of the ⌘-click above is the second
    bridge.shell.openDefault.mockRejectedValueOnce({ code: 'IO_ERROR', message: 'no app for .zip' })
    await click(row(el, `${v}/data.zip`))
    expect(vi.mocked(props.onNotice).mock.calls).toEqual([[`Can't open "data.zip": no app for .zip`, 'error']])
  })

  it('S27, S32: a right-click on a row asks for the row menu of the sidebar with the path and the mouse point; the page draws no menu of its own and opens nothing', async () => {
    const v = vault()
    const { el, props } = await mount({ trees: { [v]: [dir(`${v}/Projects`), file(`${v}/a.md`)] }, opens: { [v]: { [`${v}/a.md`]: used(1) } }, favorites: { [v]: [`${v}/Projects`] } })
    const rightClick = (target: Element, clientX: number, clientY: number) => {
      const event = new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX, clientY })
      act(() => void target.dispatchEvent(event))
      return event
    }
    // The browser's own menu does not show over the row.
    expect(rightClick(row(el, `${v}/a.md`), 412, 96).defaultPrevented).toBe(true)
    rightClick(row(el, `${v}/Projects`), 640, 120)
    expect(vi.mocked(props.onRowMenu).mock.calls).toEqual([
      [`${v}/a.md`, 412, 96],
      [`${v}/Projects`, 640, 120],
    ])
    expect(el.querySelector('.ctx-menu, [role="menu"]')).toBeNull()
    expect([vi.mocked(props.onOpen).mock.calls.length, vi.mocked(props.onShowInFiles).mock.calls.length]).toEqual([0, 0])
  })

  it('S28, S29: "Add to favorites" puts the row in "Favorites" at once and takes it out of the third column; "Remove from favorites" takes it out of "Favorites"', async () => {
    const v = vault()
    const { el, favorites, emitFavorites } = await mount({ trees: { [v]: [file(`${v}/a.md`), file(`${v}/b.md`)] }, opens: { [v]: { [`${v}/a.md`]: used(5, HOUR), [`${v}/b.md`]: used(4, 2 * HOUR) } }, favorites: { [v]: [`${v}/b.md`] } })
    expect([paths(el, 'recent'), paths(el, 'favorites'), paths(el, 'suggested')]).toEqual([[`${v}/a.md`, `${v}/b.md`], [`${v}/b.md`], [`${v}/a.md`]])
    // The menu item writes the list of the vault, and main says `favorites:changed` (the sidebar's `toggleFavorite`).
    favorites[v] = [`${v}/b.md`, `${v}/a.md`]
    await emitFavorites(v)
    expect([paths(el, 'recent'), paths(el, 'favorites'), paths(el, 'suggested')]).toEqual([[`${v}/a.md`, `${v}/b.md`], [`${v}/b.md`, `${v}/a.md`], []])
    favorites[v] = [`${v}/a.md`]
    await emitFavorites(v)
    expect([paths(el, 'favorites'), paths(el, 'suggested')]).toEqual([[`${v}/a.md`], [`${v}/b.md`]])
  })

  it('R1: the favorites of each vault are read ONE time when the page shows, and again on `favorites.onChanged` for a vault of the window; the record follows the app state; nothing listens after the page goes', async () => {
    const v = vault()
    const w = vault('w')
    const { el, bridge, state, favorites, favoritesChanged, emitState, emitFavorites } = await mount({
      trees: { [v]: [file(`${v}/a.md`), file(`${v}/b.md`)], [w]: [file(`${w}/x.md`)] },
      opens: { [v]: { [`${v}/a.md`]: used(5, HOUR), [`${v}/b.md`]: used(1, 2 * HOUR) } },
    })
    expect(bridge.favorites.get.mock.calls).toEqual([[v], [w]])
    expect(paths(el, 'suggested')).toEqual([`${v}/a.md`])
    // "Add to favorites" in any window (S28 of YAZ-2673): the row shows in "Favorites" and leaves the third column.
    favorites[v] = [`${v}/a.md`]
    await emitFavorites('/another-window')
    expect(bridge.favorites.get).toHaveBeenCalledTimes(2)
    await emitFavorites(v)
    expect(bridge.favorites.get.mock.calls).toEqual([[v], [w], [v]])
    expect([paths(el, 'favorites'), paths(el, 'suggested')]).toEqual([[`${v}/a.md`], []])
    // A use that the main process added (a page came on show in any window) is on the page at once.
    await emitState({ ...state, folders: { ...state.folders, [w]: { ...defaultFolderState(), opens: { [`${w}/x.md`]: used(1) } } } })
    expect(paths(el, 'recent')).toEqual([`${w}/x.md`, `${v}/a.md`, `${v}/b.md`])
    expect(bridge.favorites.get).toHaveBeenCalledTimes(3)
    expect(bridge.tree.mock.calls).toEqual([[v], [w]])

    act(() => root?.unmount())
    root = null
    expect(favoritesChanged.size).toBe(0)
    const listens = vi.spyOn(storage, 'getOpens')
    await emitState(state)
    expect(listens).not.toHaveBeenCalled()
  })

  /** "Recent" has three rows, "Favorites" none, and the third column two: `a` and `b` are used a lot. */
  const keysFixture = (v: string): Fixture => ({
    trees: { [v]: [file(`${v}/a.md`), file(`${v}/b.md`), file(`${v}/c.md`)] },
    opens: { [v]: { [`${v}/a.md`]: used(5, HOUR), [`${v}/b.md`]: used(4, 2 * HOUR), [`${v}/c.md`]: used(1, 3 * HOUR) } },
  })

  it('S33: the way in. The door that the page hands App puts the keyboard focus on the first row of the first column that has rows; with no row it says no; it is gone with the page', async () => {
    const v = vault()
    const { el, props } = await mount({ trees: { [v]: [dir(`${v}/Projects`), file(`${v}/f.md`)] }, favorites: { [v]: [`${v}/Projects`, `${v}/f.md`] } })
    expect(paths(el, 'recent')).toEqual([])
    let taken = false
    act(() => void (taken = props.focusRef.current?.() ?? false))
    expect([taken, at()]).toEqual([true, 'favorites 0'])
    act(() => root?.unmount())
    expect(props.focusRef.current).toBeNull()
    container?.remove()

    const empty = await mount({ trees: { [vault()]: [] } })
    expect([empty.props.focusRef.current?.(), at()]).toEqual([false, null])
  })

  it('S35: ↑ and ↓ walk the rows of one column and stop at both ends', async () => {
    const v = vault()
    const { el } = await mount(keysFixture(v))
    act(() => cell(el, 'recent', 0).focus())
    expect(press('ArrowUp').defaultPrevented).toBe(true) // the page does not scroll under the key
    expect(at()).toBe('recent 0')
    const walk = ['ArrowDown', 'ArrowDown', 'ArrowDown', 'ArrowUp'].map((key) => (press(key), at()))
    expect(walk).toEqual(['recent 1', 'recent 2', 'recent 2', 'recent 1'])
  })

  it('S36, S37: → and ← go to the next column that has rows, at the same row number or at its last row; → on the last column does nothing; ← on the first column, and Esc, put the caret in the search bar', async () => {
    const v = vault()
    const { el, props } = await mount(keysFixture(v))
    expect([paths(el, 'recent').length, paths(el, 'favorites').length, paths(el, 'suggested').length]).toEqual([3, 0, 2])
    act(() => cell(el, 'recent', 2).focus())
    // "Favorites" has no row: the key goes over it. The third column has two rows: its last one.
    const walk = ['ArrowRight', 'ArrowRight', 'ArrowLeft', 'ArrowUp', 'ArrowRight'].map((key) => (press(key), at()))
    expect(walk).toEqual(['suggested 1', 'suggested 1', 'recent 1', 'recent 0', 'suggested 0'])
    expect(props.onBackToSearch).not.toHaveBeenCalled()
    press('ArrowLeft')
    expect(at()).toBe('recent 0')
    press('ArrowLeft')
    expect(props.onBackToSearch).toHaveBeenCalledTimes(1)
    const esc = press('Escape')
    expect([vi.mocked(props.onBackToSearch).mock.calls.length, esc.defaultPrevented]).toEqual([2, true])
    // A key with ⌘, Ctrl or Alt is not the page's: a shortcut of the window stays one.
    const chord = press('ArrowDown', { metaKey: true, altKey: true })
    expect([chord.defaultPrevented, at()]).toEqual([false, 'recent 0'])
  })

  it('S38: Enter on a file opens it, ⌘Enter opens it in a background tab, and Shift+Enter shows the row in Files; Enter on a folder shows it in Files; ⌘ is read before Shift', async () => {
    const v = vault()
    const { el, props, bridge } = await mount({
      trees: { [v]: [dir(`${v}/Projects`), file(`${v}/a.md`), file(`${v}/data.zip`, null)] },
      opens: { [v]: { [`${v}/a.md`]: used(1) } },
      favorites: { [v]: [`${v}/Projects`, `${v}/data.zip`] },
    })
    const calls = () => [props.onOpen, props.onOpenBackground, props.onShowInFiles].map((door) => vi.mocked(door).mock.calls.flat())
    act(() => row(el, `${v}/a.md`).focus())
    // The key is the page's: the button's own click, which Enter also makes in the browser, does not open the row a second time.
    expect(press('Enter').defaultPrevented).toBe(true)
    expect(calls()).toEqual([[`${v}/a.md`], [], []])
    press('Enter', { metaKey: true })
    press('Enter', { metaKey: true, shiftKey: true })
    expect(calls()).toEqual([[`${v}/a.md`], [`${v}/a.md`, `${v}/a.md`], []])
    press('Enter', { shiftKey: true })
    expect(calls()).toEqual([[`${v}/a.md`], [`${v}/a.md`, `${v}/a.md`], [`${v}/a.md`]])
    // A folder is never opened as a page from here (S22): Enter, and Shift+Enter, show it in Files.
    act(() => row(el, `${v}/Projects`).focus())
    press('Enter')
    press('Enter', { shiftKey: true })
    expect(calls()).toEqual([[`${v}/a.md`], [`${v}/a.md`, `${v}/a.md`], [`${v}/a.md`, `${v}/Projects`, `${v}/Projects`]])
    // A file that the app cannot show: Enter opens it in its default app, and Shift+Enter shows it in Files (YAZ-2662 S8).
    act(() => row(el, `${v}/data.zip`).focus())
    press('Enter')
    press('Enter', { shiftKey: true })
    await act(async () => undefined)
    expect(bridge.shell.openDefault.mock.calls).toEqual([[{ path: `${v}/data.zip` }]])
    expect(calls()).toEqual([[`${v}/a.md`], [`${v}/a.md`, `${v}/a.md`], [`${v}/a.md`, `${v}/Projects`, `${v}/Projects`, `${v}/data.zip`]])
  })

  it('S39: Space on a file shows the preview panel on it; the panel follows the keyboard focus 120 ms after its last move, and shows nothing on a folder at once; Space again closes it; Esc with a panel on show closes the panel only; a row that opens, and the page that goes, close it', async () => {
    // This test alone waits on a timer: the clock of `beforeEach` fakes the date only.
    vi.useRealTimers()
    vi.useFakeTimers({ toFake: ['Date', 'setTimeout', 'clearTimeout'] })
    vi.setSystemTime(NOW)
    const v = vault()
    /** What App's door was told, in order. App holds the path, and hands it back. */
    const told: (string | null)[] = []
    let close: () => void = () => undefined
    const WithPanel = (props: StartPageProps) => {
      const [path, setPath] = useState<string | null>(null)
      close = () => setPath(null)
      return <StartPage {...props} previewPath={path} onPreview={(next) => (told.push(next), setPath(next))} />
    }
    const { el, props } = await mount(
      { trees: { [v]: [dir(`${v}/Projects`), file(`${v}/a.md`), file(`${v}/b.md`), file(`${v}/c.md`)] }, opens: { [v]: { [`${v}/a.md`]: used(1, HOUR), [`${v}/b.md`]: used(1, 2 * HOUR), [`${v}/c.md`]: used(1, 3 * HOUR) } }, favorites: { [v]: [`${v}/Projects`] } },
      {},
      WithPanel,
    )
    const wait = (ms: number) => act(() => void vi.advanceTimersByTime(ms))
    act(() => cell(el, 'recent', 0).focus())
    // With the preview off a move tells the panel nothing.
    press('ArrowDown')
    press('ArrowUp')
    wait(500)
    expect(told).toEqual([])
    expect(press(' ').defaultPrevented).toBe(true)
    expect(told).toEqual([`${v}/a.md`])
    // Two moves: the panel reads no file on the way, and shows the last one 120 ms after the last move.
    press('ArrowDown')
    wait(100)
    press('ArrowDown')
    wait(119)
    expect(told).toEqual([`${v}/a.md`])
    wait(1)
    expect([told, at()]).toEqual([[`${v}/a.md`, `${v}/c.md`], 'recent 2'])
    // → to a folder row: no panel is drawn, at once. Space there does nothing (S40). Back on a file the panel shows again.
    press('ArrowRight')
    expect([told.at(-1), at()]).toEqual([null, 'favorites 0'])
    press(' ')
    wait(500)
    expect(told).toHaveLength(3)
    press('ArrowLeft')
    wait(120)
    expect([told.at(-1), at()]).toEqual([`${v}/a.md`, 'recent 0'])
    // Esc with the panel on show closes the panel only; the next Esc goes back to the search bar.
    press('Escape')
    expect([told.at(-1), vi.mocked(props.onBackToSearch).mock.calls.length, at()]).toEqual([null, 0, 'recent 0'])
    press('Escape')
    expect(props.onBackToSearch).toHaveBeenCalledTimes(1)
    // Space shows, and Space again closes. A move after that tells the panel nothing.
    press(' ')
    press(' ')
    press('ArrowDown')
    wait(500)
    expect(told.slice(-2)).toEqual([`${v}/a.md`, null])
    // The ✕ of the panel is App's, and it closes the panel while a move waits: the page reads that
    // the panel is gone. The move that waits, and a later move, do not show it again.
    press(' ')
    const shown = told.length
    press('ArrowDown')
    act(() => close())
    wait(500)
    press('ArrowUp')
    wait(500)
    expect([told.length - shown, told.at(-1), at()]).toEqual([0, `${v}/b.md`, 'recent 1'])
    // ⌘Enter does its own work and closes the panel (YAZ-2662 S36); the page stays.
    press(' ')
    press('Enter', { metaKey: true })
    expect([told.at(-1), vi.mocked(props.onOpenBackground).mock.calls]).toEqual([null, [[`${v}/b.md`]]])
    // The page goes with the preview on: the panel goes too, and a move that waits shows nothing later.
    press(' ')
    press('ArrowDown')
    act(() => root?.unmount())
    root = null
    wait(500)
    expect(told.at(-1)).toBeNull()
  })

  it('S39, S40: with no door to a preview panel Space on a file does nothing, and the button is not clicked; Space on a folder does nothing', async () => {
    const v = vault()
    const { el, props } = await mount({ trees: { [v]: [dir(`${v}/Projects`), file(`${v}/a.md`)] }, opens: { [v]: { [`${v}/a.md`]: used(1) } }, favorites: { [v]: [`${v}/Projects`] } })
    for (const path of [`${v}/a.md`, `${v}/Projects`]) {
      act(() => row(el, path).focus())
      expect([path, press(' ').defaultPrevented]).toEqual([path, true])
    }
    expect([props.onOpen, props.onShowInFiles, props.onBackToSearch].map((door) => vi.mocked(door).mock.calls.length)).toEqual([0, 0, 0])
  })

  it('S41: a letter typed on a row asks for the caret in the search bar and leaves the key to the browser, which types it there; a key with ⌘, Ctrl or Alt is no letter', async () => {
    const v = vault()
    const { el, props } = await mount(keysFixture(v))
    act(() => cell(el, 'recent', 0).focus())
    for (const init of [{ metaKey: true }, { ctrlKey: true }, { altKey: true }]) press('a', init)
    press('Tab')
    press('Shift', { shiftKey: true })
    expect(props.onBackToSearch).not.toHaveBeenCalled()
    const typed = [press('a'), press('P', { shiftKey: true }), press('3')]
    expect(props.onBackToSearch).toHaveBeenCalledTimes(3)
    // Not taken from the browser: the text input of this key goes to what has the focus by then.
    expect(typed.map((event) => event.defaultPrevented)).toEqual([false, false, false])
  })

  it('the page goes while the keyboard is on one of its rows (Enter opened a page that a tab holds already): the caret goes into the page on show, not to nothing', async () => {
    const v = vault()
    const { el } = await mount(keysFixture(v))
    // An editor stand-in: layoutless jsdom always answers `offsetParent: null`, so it declares its own.
    const instance = document.createElement('div')
    instance.className = 'editor-instance'
    instance.innerHTML = '<div class="ProseMirror" tabindex="-1"></div>'
    const doc = instance.firstElementChild as HTMLElement
    Object.defineProperty(doc, 'offsetParent', { get: () => document.body })
    document.body.appendChild(instance)
    try {
      act(() => cell(el, 'recent', 0).focus())
      await act(async () => root?.unmount())
      root = null
      expect(document.activeElement).toBe(doc)
    } finally {
      instance.remove()
    }
  })

  it('S23: in a narrow page area the columns stand one below the other', () => {
    // The page measures ITSELF, not the window: the sidebar and the right panel make it narrow too.
    expect(startCss).toMatch(/\.start\s*\{[^}]*container-type:\s*inline-size;/s)
    expect(startCss).toMatch(/\.start__columns\s*\{[^}]*grid-template-columns:\s*repeat\(3,\s*minmax\(0,\s*1fr\)\);/s)
    expect(startCss).toMatch(/@container\s*\(max-width:\s*\d+px\)\s*\{\s*\.start__columns\s*\{[^}]*grid-template-columns:\s*minmax\(0,\s*1fr\);/s)
  })
})
