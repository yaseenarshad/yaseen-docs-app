/**
 * The new tab page (YAZ-2663 D3, D4): three columns off the open history, the favorites and the
 * Files tree. The bridge is the jsdom stub pattern (App.test.tsx), so the real storage, tree feed
 * and api modules run against it. The rules of the third column are `suggestFavorites.test.ts`'s.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act } from 'react'
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

async function mount(fixture: Fixture, over: Partial<StartPageProps> = {}) {
  const b = installBridge(fixture)
  await storage.init()
  const roots = Object.keys(fixture.trees)
  const props: StartPageProps = { roots, titles: new Map(), onOpen: vi.fn(), onOpenBackground: vi.fn(), onShowFolder: vi.fn(), onNotice: vi.fn(), ...over }
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  await act(async () => root?.render(<StartPage {...props} />))
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
    await act(async () => root?.render(<StartPage roots={[v]} titles={new Map()} onOpen={vi.fn()} onOpenBackground={vi.fn()} onShowFolder={vi.fn()} onNotice={vi.fn()} />))
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
    // S22: a folder is never opened as a page from here, with ⌘ or without.
    await click(row(el, `${v}/Projects`))
    await click(row(el, `${v}/Projects`), { metaKey: true })
    expect(vi.mocked(props.onShowFolder).mock.calls).toEqual([[`${v}/Projects`], [`${v}/Projects`]])
    // As its row of the Favorites tab does (YAZ-1577 D2): no tab for a file the app cannot show.
    await click(row(el, `${v}/data.zip`))
    expect(bridge.shell.openDefault.mock.calls).toEqual([[{ path: `${v}/data.zip` }]])
    expect([vi.mocked(props.onOpen).mock.calls.length, vi.mocked(props.onOpenBackground).mock.calls.length]).toEqual([1, 1])
    bridge.shell.openDefault.mockRejectedValueOnce({ code: 'IO_ERROR', message: 'no app for .zip' })
    await click(row(el, `${v}/data.zip`))
    expect(vi.mocked(props.onNotice).mock.calls).toEqual([[`Can't open "data.zip": no app for .zip`, 'error']])
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

  it('S23: in a narrow page area the columns stand one below the other', () => {
    // The page measures ITSELF, not the window: the sidebar and the right panel make it narrow too.
    expect(startCss).toMatch(/\.start\s*\{[^}]*container-type:\s*inline-size;/s)
    expect(startCss).toMatch(/\.start__columns\s*\{[^}]*grid-template-columns:\s*repeat\(3,\s*minmax\(0,\s*1fr\)\);/s)
    expect(startCss).toMatch(/@container\s*\(max-width:\s*\d+px\)\s*\{\s*\.start__columns\s*\{[^}]*grid-template-columns:\s*minmax\(0,\s*1fr\);/s)
  })
})
