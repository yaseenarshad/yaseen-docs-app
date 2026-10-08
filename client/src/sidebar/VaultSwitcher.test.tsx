/**
 * The vault switcher (YAZ-1767): the sidebar header's trigger + panel. Pins the locked decisions —
 * D3 the current vault is a row (`aria-current`), D4 "Open folder…" last, D5 dead folders stay in
 * an open panel, D6 the one-line trigger, D7 the filter/keyboard model (ranking, default
 * highlight skipping the current vault, clamp, Enter, Esc, focus never leaving the input), D8 the
 * ⌘O request. Every CLICK goes through the mocked `window.yaseenDocs.window.openRecent` — the one
 * back-end door (D1). The right-click menu (YAZ-1798) is pinned below: its "Open in this
 * window" is the only in-place open, through the `onOpenHere` prop. Display names, their inline
 * field and the one-line rows' ⓘ path tooltip (YAZ-1974) are pinned last. Every test runs over the
 * REAL `storage` on a fake bridge — `storage.listVaults()` is the panel's one read (YAZ-2556 D2), so
 * the recents are seeded into that cache — and a name set in one test never leaks into the next. The
 * two groups, the key badges and the close on the window's blur (YAZ-2555 D1, D4, A1, A4, A6) are
 * pinned the same way: the open windows and the numbers are seeded into that cache. With no window
 * seeded — every older test — the whole list is the "Not open" group, in MRU order as before.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { StrictMode, act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { MAX_VAULT_SETS, defaultAppState, defaultFolderState, defaultRightPanelIdentity, type AppState, type RecentRoots, type VaultSet } from '@shared/types'
import { storage } from '../lib/storage'
import { GROUP_OPEN_TEXT, GROUP_NOT_OPEN_TEXT, GROUP_SETS_TEXT, MISSING_TEXT, NO_MATCH_TEXT, OPEN_FOLDER_TEXT, OPEN_HERE_TEXT, SAVE_SET_TEXT, SETS_MISSING_TEXT, VaultSwitcher, defaultHighlight, rankVaultRows } from './VaultSwitcher'

;(globalThis as unknown as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true

const ROOT = '/v/Notes'
const NOW = 1_700_000_000_000
/** MRU order: the current vault first (it always is — the renderer bumps it on open), then three others; two share the basename "Notes". */
const RECENTS: RecentRoots = [
  { path: ROOT, lastOpened: NOW - 60_000 },
  { path: '/w/Notes', lastOpened: NOW - 2 * 3_600_000 },
  { path: '/v/Archive', lastOpened: NOW - 86_400_000 },
  { path: '/v/Notes Archive', lastOpened: NOW - 3 * 86_400_000 },
]

let openRecent: ReturnType<typeof vi.fn>
let setFolder: ReturnType<typeof vi.fn>
/** Main's `state.onChange` broadcast into this window — another window's write landing here. */
let broadcast: (state: AppState) => void
/** Counts the panel's reads of the list: `storage.listVaults`, called through. */
let listSpy: ReturnType<typeof vi.spyOn>
let root: Root | null = null
let container: HTMLElement | null = null

/** The cache a test starts from — the four recents, no window, no name, no number — with `over` on top. */
const seeded = (over: Partial<AppState> = {}): AppState => ({ ...defaultAppState(), recents: RECENTS, ...over })

/** Seeds the storage cache with display names (YAZ-1974 D3), path → name. */
const withNames = (names: Record<string, string>): AppState =>
  seeded({ folders: Object.fromEntries(Object.entries(names).map(([path, name]) => [path, { ...defaultFolderState(), name }])) })

beforeEach(async () => {
  vi.useFakeTimers({ now: NOW, toFake: ['Date'] })
  openRecent = vi.fn(async () => true)
  setFolder = vi.fn(async () => undefined)
  const state = {
    get: async () => seeded(),
    setFolder,
    removeRecent: async () => undefined,
    onChange: (listener: (s: AppState) => void) => {
      broadcast = listener
      return () => undefined
    },
  }
  Object.defineProperty(window, 'yaseenDocs', { value: { window: { openRecent, identity: async () => ({}) }, state }, configurable: true, writable: true })
  await storage.init()
  listSpy = vi.spyOn(storage, 'listVaults')
})

afterEach(() => {
  act(() => root?.unmount())
  root = null
  container?.remove()
  container = null
  listSpy.mockRestore()
  delete (window as unknown as Record<string, unknown>).yaseenDocs
  vi.useRealTimers()
})

type Props = Parameters<typeof VaultSwitcher>[0]

function render(over: Partial<Props> = {}) {
  const props: Props = {
    roots: [ROOT],
    onPickFolder: vi.fn(),
    pickDisabled: false,
    openRequest: 0,
    onOpenHere: vi.fn(async () => true),
    onAddHere: vi.fn(async () => true),
    onReveal: vi.fn(),
    onOpenVsCode: vi.fn(),
    onNotice: vi.fn(),
    ...over,
  }
  const draw = (next: Partial<Props>) => {
    Object.assign(props, next)
    act(() =>
      root?.render(
        <StrictMode>
          {/* The real header is the anchor (D5): the trigger's parent rect is what the panel spans. */}
          <div className="sidebar__header">
            <VaultSwitcher {...props} />
          </div>
        </StrictMode>,
      ),
    )
  }
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  draw({})
  return { props, rerender: draw, el: container }
}

const trigger = (el: HTMLElement) => el.querySelector<HTMLButtonElement>('.sidebar__root')!
const panel = (el: HTMLElement) => el.querySelector<HTMLElement>('.ctx-menu--panel')
const filter = (el: HTMLElement) => el.querySelector<HTMLInputElement>('.vault-switcher__filter')!
const rows = (el: HTMLElement) => [...el.querySelectorAll<HTMLButtonElement>('.vault-switcher__rows .vault-switcher__row')]
const openFolderRow = (el: HTMLElement) => el.querySelector<HTMLButtonElement>('.vault-switcher__open')!
const activeRow = (el: HTMLElement) => el.querySelector<HTMLButtonElement>('.vault-switcher__row--active')
const names = (el: HTMLElement) => rows(el).map((r) => r.querySelector('.vault-switcher__name')?.textContent)
/** Each row's key badge (YAZ-2555 D4), or null where the vault has no number. */
const badges = (el: HTMLElement) => rows(el).map((r) => r.querySelector('.vault-switcher__key')?.textContent ?? null)
const tooltip = () => document.querySelector<HTMLElement>('[role="tooltip"]')
const hoverInfo = (row: HTMLElement) => act(() => void row.querySelector('.vault-switcher__info')!.dispatchEvent(new MouseEvent('mouseover', { bubbles: true })))
const leaveInfo = (row: HTMLElement) => act(() => void row.querySelector('.vault-switcher__info')!.dispatchEvent(new MouseEvent('mouseout', { bubbles: true, relatedTarget: row })))
/** A row's full path, read the only way the panel shows it: its ⓘ tooltip (YAZ-1974 D2). */
const pathOf = (row: HTMLElement) => {
  hoverInfo(row)
  const path = tooltip()?.textContent
  leaveInfo(row)
  return path
}

/** The list as it reads, top to bottom: a group label as "# Open", a row as its name, badge and time — the parts it has. */
const listing = (el: HTMLElement) =>
  [...el.querySelector('.vault-switcher__rows')!.children].map((line) =>
    line.classList.contains('vault-switcher__label')
      ? `# ${line.textContent}`
      : ['.vault-switcher__name', '.vault-switcher__key', '.vault-switcher__when'].map((part) => line.querySelector(part)?.textContent ?? '').filter((text) => text !== '').join(' · '),
  )

const openPanel = (el: HTMLElement) => act(() => trigger(el).click())
const key = (el: HTMLElement, k: string) => act(() => void filter(el).dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true })))
/** Types into an input the way React sees it: the native value setter, then an `input` event. */
const fill = async (input: HTMLInputElement, value: string) => {
  const set = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set
  await act(async () => {
    set?.call(input, value)
    input.dispatchEvent(new Event('input', { bubbles: true }))
  })
}
const type = (el: HTMLElement, value: string) => fill(filter(el), value)
/** The vault right-click menu (YAZ-1798). */
const vaultMenu = () => document.querySelector<HTMLElement>('.ctx-overlay .ctx-menu')
const menuLabels = () => [...(vaultMenu()?.querySelectorAll('.ctx-menu__item') ?? [])].map((b) => b.textContent)
const menuItem = (label: string) => [...(vaultMenu()?.querySelectorAll<HTMLButtonElement>('.ctx-menu__item') ?? [])].find((b) => b.textContent === label)!
/** Dispatches a right-click and reports whether the native menu was swallowed (G1). */
const rightClick = (target: HTMLElement) => {
  const e = new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 40, clientY: 50 })
  act(() => void target.dispatchEvent(e))
  return e.defaultPrevented
}
const pick = (label: string) => act(() => menuItem(label).click())
/** Settles the `openRecent` promise chain inside act. */
const settle = () => act(async () => {})

describe('VaultSwitcher: the trigger (D6)', () => {
  it('is one line — the bold basename and a chevron, no "change" — with the full path as its tooltip', () => {
    const { el } = render()
    const t = trigger(el)
    expect(t.querySelector('.sidebar__root-name')?.textContent).toBe('Notes')
    expect(t.querySelector('.sidebar__root-hint svg')?.getAttribute('style') ?? '').not.toContain('rotate')
    expect(t.querySelector('.sidebar__root-hint')?.getAttribute('aria-hidden')).toBe('true')
    expect(t.textContent).not.toContain('change')
    expect(t.title).toBe(ROOT)
    expect(t.getAttribute('aria-haspopup')).toBe('menu')
    expect(t.getAttribute('aria-expanded')).toBe('false')
    expect(t.disabled).toBe(false)
  })

  it('click opens the panel (chevron flips, aria-expanded), a second click closes it', () => {
    const { el } = render()
    openPanel(el)
    expect(panel(el)).not.toBeNull()
    expect(trigger(el).getAttribute('aria-expanded')).toBe('true')
    expect(trigger(el).querySelector('.sidebar__root-hint svg')?.getAttribute('style')).toContain('rotate(180deg)')
    // The surface closes on ANY window mousedown; the trigger swallows its own so the click that
    // follows toggles closed instead of close-then-reopen.
    act(() => void trigger(el).dispatchEvent(new MouseEvent('mousedown', { bubbles: true })))
    expect(panel(el)).not.toBeNull()
    openPanel(el)
    expect(panel(el)).toBeNull()
    expect(trigger(el).getAttribute('aria-expanded')).toBe('false')
  })

  it('a mousedown anywhere else closes the panel', () => {
    const { el } = render()
    openPanel(el)
    act(() => void window.dispatchEvent(new MouseEvent('mousedown')))
    expect(panel(el)).toBeNull()
  })

  it('the panel hangs off the header rect (D5): a ctx-menu with the panel class, at least the header width (YAZ-1974 D7: it grows to fit a long name)', () => {
    const { el } = render()
    const header = el.querySelector<HTMLElement>('.sidebar__header')!
    header.getBoundingClientRect = () => ({ left: 0, top: 0, right: 260, bottom: 41, width: 260, height: 41, x: 0, y: 0, toJSON: () => ({}) })
    openPanel(el)
    const p = panel(el)!
    expect(p.classList.contains('ctx-menu')).toBe(true)
    expect(p.getAttribute('role')).toBe('menu')
    expect(p.style.minWidth).toBe('260px')
    expect(p.style.width).toBe('')
  })
})

describe('VaultSwitcher: the rows (D3/D4/D5)', () => {
  it('lists every recent vault in MRU order — the current vault included and marked aria-current — with name and relative time; Open folder… is the last row', () => {
    const { el } = render()
    openPanel(el)
    expect(names(el)).toEqual(['Notes', 'Notes', 'Archive', 'Notes Archive'])
    const [current, other] = rows(el)
    expect(current.getAttribute('aria-current')).toBe('true')
    expect(other.getAttribute('aria-current')).toBeNull()
    expect(current.querySelector('.vault-switcher__when')?.textContent).toBe('1 minute ago')
    expect(other.querySelector('.vault-switcher__when')?.textContent).toBe('2 hours ago')
    // Open folder… is outside the rows list, after it, and reads as the last menu item.
    const items = [...panel(el)!.querySelectorAll('[role="menuitem"]')]
    expect(items.at(-1)?.textContent).toBe(OPEN_FOLDER_TEXT)
    expect(items).toHaveLength(5)
  })

  it('rows are read fresh from storage on EVERY open', () => {
    const { el } = render()
    openPanel(el)
    expect(names(el)).toHaveLength(4)
    openPanel(el)
    act(() => broadcast(seeded({ recents: RECENTS.slice(0, 2) })))
    openPanel(el)
    expect(names(el)).toEqual(['Notes', 'Notes'])
    expect(listSpy).toHaveBeenCalledTimes(2)
  })

  it('clicking a row — the current vault too (one rule for every row) — opens it through window.openRecent and closes the panel', async () => {
    const { el } = render()
    openPanel(el)
    act(() => rows(el)[0].click())
    await settle()
    expect(openRecent).toHaveBeenCalledExactlyOnceWith(ROOT)
    expect(panel(el)).toBeNull()
  })

  it('a dead folder (openRecent → false): the row is disabled, its time slot says Folder not found, the panel STAYS open and the filter keeps focus', async () => {
    openRecent.mockResolvedValueOnce(false)
    const { el } = render()
    openPanel(el)
    act(() => rows(el)[2].click())
    await settle()
    expect(openRecent).toHaveBeenCalledWith('/v/Archive')
    expect(panel(el)).not.toBeNull()
    const dead = rows(el)[2]
    expect(dead.disabled).toBe(true)
    expect(dead.querySelector('.vault-switcher__when')?.textContent).toBe(MISSING_TEXT)
    expect(dead.querySelector('.vault-switcher__when')?.classList.contains('vault-switcher__when--missing')).toBe(true)
    expect(document.activeElement).toBe(filter(el))
    // A dead row cannot be activated again by keyboard either: the highlight (still on the default,
    // row 1) walks onto it, Enter is a no-op, and the panel is still open.
    key(el, 'ArrowDown')
    expect(activeRow(el)).toBe(dead)
    key(el, 'Enter')
    await settle()
    expect(openRecent).toHaveBeenCalledTimes(1)
    expect(panel(el)).not.toBeNull()
  })

  it('Open folder… runs onPickFolder and closes the panel; disabled while pickDisabled', () => {
    const { el, props, rerender } = render()
    openPanel(el)
    act(() => openFolderRow(el).click())
    expect(props.onPickFolder).toHaveBeenCalledTimes(1)
    expect(panel(el)).toBeNull()
    expect(openRecent).not.toHaveBeenCalled()

    rerender({ pickDisabled: true })
    openPanel(el)
    expect(openFolderRow(el).disabled).toBe(true)
    act(() => openFolderRow(el).click())
    expect(props.onPickFolder).toHaveBeenCalledTimes(1)
    expect(panel(el)).not.toBeNull()
  })
})

describe('VaultSwitcher: filter + keyboard (D7)', () => {
  it('the filter is first, autofocused on open, with the placeholder and label', () => {
    const { el } = render()
    openPanel(el)
    const input = filter(el)
    expect(panel(el)!.querySelector('input, button')).toBe(input)
    expect(document.activeElement).toBe(input)
    expect(input.placeholder).toBe('Switch vault…')
    expect(input.getAttribute('aria-label')).toBe('Switch vault')
    expect(input.value).toBe('')
  })

  it('the query resets on every open', async () => {
    const { el } = render()
    openPanel(el)
    await type(el, 'arch')
    expect(filter(el).value).toBe('arch')
    openPanel(el)
    openPanel(el)
    expect(filter(el).value).toBe('')
  })

  it('ranks like the [[ picker over basenames: exact, then prefix, then substring; an empty query is MRU order', async () => {
    const { el } = render()
    openPanel(el)
    await type(el, 'notes')
    expect(names(el)).toEqual(['Notes', 'Notes', 'Notes Archive'])
    await type(el, 'arch')
    expect(names(el)).toEqual(['Archive', 'Notes Archive'])
    await type(el, '')
    expect(names(el)).toEqual(['Notes', 'Notes', 'Archive', 'Notes Archive'])
  })

  it('with an empty query the highlight starts on the first row that is NOT the current vault (⌘O ⏎ = last-used other vault)', () => {
    const { el } = render()
    openPanel(el)
    expect(activeRow(el)).toBe(rows(el)[1])
    expect(pathOf(activeRow(el)!)).toBe('/w/Notes')
  })

  it('when every row is the current vault the highlight starts on the first row', () => {
    act(() => broadcast(seeded({ recents: [RECENTS[0]] })))
    const { el } = render()
    openPanel(el)
    expect(activeRow(el)).toBe(rows(el)[0])
  })

  it('a typed query moves the highlight to the top match', async () => {
    const { el } = render()
    openPanel(el)
    await type(el, 'arch')
    expect(activeRow(el)).toBe(rows(el)[0])
    expect(pathOf(activeRow(el)!)).toBe('/v/Archive')
  })

  it('no match: a muted "No matching vaults" line above Open folder…, which is always visible and takes the highlight', async () => {
    const { el } = render()
    openPanel(el)
    await type(el, 'zzz')
    expect(rows(el)).toHaveLength(0)
    const empty = panel(el)!.querySelector('.vault-switcher__empty')
    expect(empty?.textContent).toBe(NO_MATCH_TEXT)
    expect((empty!.compareDocumentPosition(openFolderRow(el)) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0).toBe(true)
    expect(openFolderRow(el).classList.contains('vault-switcher__row--active')).toBe(true)
  })

  it('↑/↓ move the highlight and CLAMP at both ends — never wrap', () => {
    const { el } = render()
    openPanel(el)
    key(el, 'ArrowUp')
    expect(activeRow(el)).toBe(rows(el)[0])
    key(el, 'ArrowUp')
    expect(activeRow(el)).toBe(rows(el)[0])
    for (let i = 0; i < 4; i++) key(el, 'ArrowDown')
    expect(activeRow(el)).toBe(openFolderRow(el))
    key(el, 'ArrowDown')
    expect(activeRow(el)).toBe(openFolderRow(el))
    key(el, 'ArrowUp')
    expect(activeRow(el)).toBe(rows(el)[3])
    // Arrow keys never leave the input.
    expect(document.activeElement).toBe(filter(el))
  })

  it('hover moves the highlight too', () => {
    const { el } = render()
    openPanel(el)
    act(() => rows(el)[3].dispatchEvent(new MouseEvent('mouseover', { bubbles: true })))
    expect(activeRow(el)).toBe(rows(el)[3])
    act(() => openFolderRow(el).dispatchEvent(new MouseEvent('mouseover', { bubbles: true })))
    expect(activeRow(el)).toBe(openFolderRow(el))
  })

  it('Enter opens the highlighted row through window.openRecent (the default: the last-used OTHER vault) and closes the panel', async () => {
    const { el } = render()
    openPanel(el)
    key(el, 'Enter')
    await settle()
    expect(openRecent).toHaveBeenCalledExactlyOnceWith('/w/Notes')
    expect(panel(el)).toBeNull()
  })

  it('Enter after typing opens the top match', async () => {
    const { el } = render()
    openPanel(el)
    await type(el, 'notes arch')
    key(el, 'Enter')
    await settle()
    expect(openRecent).toHaveBeenCalledExactlyOnceWith('/v/Notes Archive')
  })

  it('⇧⏎ / ⇧-click open the vault IN this window (YAZ-1974 D8): onOpenHere, never openRecent; on the current vault they are a plain ⏎', async () => {
    const { el, props } = render()
    openPanel(el)
    act(() => void filter(el).dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', shiftKey: true, bubbles: true, cancelable: true })))
    await settle()
    expect(props.onOpenHere).toHaveBeenCalledExactlyOnceWith('/w/Notes')
    expect(openRecent).not.toHaveBeenCalled()
    expect(panel(el)).toBeNull()

    openPanel(el)
    act(() => void rows(el)[2].dispatchEvent(new MouseEvent('click', { shiftKey: true, bubbles: true })))
    await settle()
    expect(props.onOpenHere).toHaveBeenLastCalledWith('/v/Archive')
    expect(openRecent).not.toHaveBeenCalled()

    openPanel(el)
    act(() => void rows(el)[0].dispatchEvent(new MouseEvent('click', { shiftKey: true, bubbles: true })))
    await settle()
    expect(openRecent).toHaveBeenCalledExactlyOnceWith(ROOT)
    expect(props.onOpenHere).toHaveBeenCalledTimes(2)
  })

  it('holding ⇧ says so on the highlighted row (YAZ-1974 D9): "Open here" in its time slot, never on the current vault; released, the time is back', () => {
    const { el } = render()
    openPanel(el)
    const shift = (type: 'keydown' | 'keyup', shiftKey: boolean) => act(() => void window.dispatchEvent(new KeyboardEvent(type, { key: 'Shift', shiftKey })))
    const when = (row: HTMLElement) => row.querySelector('.vault-switcher__when')?.textContent
    shift('keydown', true)
    expect(when(activeRow(el)!)).toBe(OPEN_HERE_TEXT)
    expect(rows(el).filter((r) => when(r) === OPEN_HERE_TEXT)).toHaveLength(1)
    key(el, 'ArrowUp')
    expect(activeRow(el)).toBe(rows(el)[0])
    expect(when(rows(el)[0])).toBe('1 minute ago')
    shift('keyup', false)
    key(el, 'ArrowDown')
    expect(when(activeRow(el)!)).not.toBe(OPEN_HERE_TEXT)
  })

  it('Enter on Open folder… runs the picker; not while pickDisabled', () => {
    const { el, props, rerender } = render()
    openPanel(el)
    for (let i = 0; i < 5; i++) key(el, 'ArrowDown')
    key(el, 'Enter')
    expect(props.onPickFolder).toHaveBeenCalledTimes(1)
    expect(openRecent).not.toHaveBeenCalled()
    expect(panel(el)).toBeNull()

    rerender({ pickDisabled: true })
    openPanel(el)
    for (let i = 0; i < 5; i++) key(el, 'ArrowDown')
    key(el, 'Enter')
    expect(props.onPickFolder).toHaveBeenCalledTimes(1)
    expect(panel(el)).not.toBeNull()
  })

  it('Esc closes the panel on the first press (the menu convention, not the search bar\'s two-press rule)', async () => {
    const { el } = render()
    openPanel(el)
    await type(el, 'arch')
    key(el, 'Escape')
    expect(panel(el)).toBeNull()
  })

  it('clicking a row never steals focus from the filter (mousedown is swallowed)', () => {
    const { el } = render()
    openPanel(el)
    const ev = new MouseEvent('mousedown', { bubbles: true, cancelable: true })
    rows(el)[1].dispatchEvent(ev)
    expect(ev.defaultPrevented).toBe(true)
    expect(document.activeElement).toBe(filter(el))
  })
})

describe('VaultSwitcher: ⌘O (D8)', () => {
  it('each new openRequest value TOGGLES: opens with the filter focused, a second one closes, a third reopens with the query reset; 0 requests nothing', async () => {
    const { el, rerender } = render()
    expect(panel(el)).toBeNull()
    rerender({ openRequest: 1 })
    expect(panel(el)).not.toBeNull()
    expect(document.activeElement).toBe(filter(el))
    await type(el, 'arch')
    // Still open: a second ⌘O closes it (the ⌘K rule) — no re-read of the rows.
    rerender({ openRequest: 2 })
    expect(panel(el)).toBeNull()
    expect(listSpy).toHaveBeenCalledTimes(1)
    // A third opens afresh: rows re-read, query cleared, filter focused.
    rerender({ openRequest: 3 })
    expect(panel(el)).not.toBeNull()
    expect(filter(el).value).toBe('')
    expect(document.activeElement).toBe(filter(el))
    expect(listSpy).toHaveBeenCalledTimes(2)
  })

  it('a request already consumed does not reopen after Esc; the next one does', () => {
    const { el, rerender } = render({ openRequest: 3 })
    expect(panel(el)).not.toBeNull()
    key(el, 'Escape')
    expect(panel(el)).toBeNull()
    rerender({ openRequest: 3 })
    expect(panel(el)).toBeNull()
    rerender({ openRequest: 4 })
    expect(panel(el)).not.toBeNull()
  })
})

describe('VaultSwitcher: pure helpers', () => {
  const rowsOf = (...paths: string[]) => paths.map((path, i) => ({ name: path.slice(path.lastIndexOf('/') + 1), folder: path.slice(path.lastIndexOf('/') + 1), path, lastUsed: i, open: false, key: null }))

  it('rankVaultRows: empty query keeps MRU order, otherwise exact > prefix > substring, uncapped', () => {
    const list = rowsOf('/a/Notes', '/b/Old Notes', '/c/Notes Archive', '/d/Other', '/e/n1', '/f/n2', '/g/n3', '/h/n4', '/i/n5', '/j/n6')
    expect(rankVaultRows(list, '  ').map((r) => r.path)).toEqual(list.map((r) => r.path))
    expect(rankVaultRows(list, 'notes').map((r) => r.path)).toEqual(['/a/Notes', '/c/Notes Archive', '/b/Old Notes'])
    // The [[ picker caps at 8; the switcher shows every match.
    expect(rankVaultRows(list, 'n')).toHaveLength(9)
  })

  it('rankVaultRows matches the display name AND the folder name, one row per vault at its best rank (YAZ-1974 D6)', () => {
    const [wiki, notes, lead] = rowsOf('/v/business-wiki-MASTER', '/v/Notes', '/v/leadnurtureai')
    const list = [{ ...wiki, name: 'Business Wiki' }, { ...notes, name: 'Wiki Notes' }, lead]
    expect(rankVaultRows(list, 'busi').map((r) => r.path)).toEqual(['/v/business-wiki-MASTER']) // display-name prefix (and folder prefix: still once)
    expect(rankVaultRows(list, 'wiki-MASTER').map((r) => r.path)).toEqual(['/v/business-wiki-MASTER']) // folder-name match
    // "wiki": Wiki Notes is a prefix match, Business Wiki a substring on both names — once, after it.
    expect(rankVaultRows(list, 'wiki').map((r) => r.path)).toEqual(['/v/Notes', '/v/business-wiki-MASTER'])
    expect(rankVaultRows(list, 'notes').map((r) => r.path)).toEqual(['/v/Notes']) // the folder name still finds a renamed vault
    expect(rankVaultRows(list, 'lead').map((r) => r.path)).toEqual(['/v/leadnurtureai']) // un-renamed: as before
  })

  it('defaultHighlight: skips the current root on an empty query, 0 otherwise (which is Open folder… when nothing matches)', () => {
    const list = rowsOf('/v/cur', '/v/a', '/v/b')
    expect(defaultHighlight(list, '', ['/v/cur'])).toBe(1)
    expect(defaultHighlight(list, '', ['/v/none'])).toBe(0)
    expect(defaultHighlight(rowsOf('/v/cur'), '', ['/v/cur'])).toBe(0)
    expect(defaultHighlight([], '', ['/v/cur'])).toBe(0)
    expect(defaultHighlight(list, 'a', ['/v/cur'])).toBe(0)
    expect(defaultHighlight([], 'zzz', ['/v/cur'])).toBe(0)
  })
})

describe('VaultSwitcher: the right-click menu (YAZ-1798)', () => {
  const OTHER = RECENTS[2].path // '/v/Archive'
  const otherRow = (el: HTMLElement) => rows(el)[2]

  it('the trigger opens the CURRENT vault\'s menu (no Open in this window, no Remove) and leaves the panel closed; the native menu is swallowed', () => {
    const { el } = render()
    expect(rightClick(trigger(el))).toBe(true)
    expect(menuLabels()).toEqual(['Set display name', 'Set shortcut', 'Copy vault name', 'Copy path', 'Reveal in Finder', 'Open in VS Code'])
    expect(panel(el)).toBeNull()
  })

  it('the current vault\'s own row gets the same six; another row gets all nine — and the highlight never moves', () => {
    const { el } = render()
    openPanel(el)
    const before = activeRow(el)
    rightClick(rows(el)[0])
    expect(menuLabels()).toEqual(['Set display name', 'Set shortcut', 'Copy vault name', 'Copy path', 'Reveal in Finder', 'Open in VS Code'])
    act(() => void window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' })))
    rightClick(otherRow(el))
    expect(menuLabels()).toEqual(['Add to this window', 'Open in this window', 'Set display name', 'Set shortcut', 'Copy vault name', 'Copy path', 'Reveal in Finder', 'Open in VS Code', 'Remove from recent vaults'])
    expect(activeRow(el)).toBe(before)
  })

  it('Reveal in Finder / Open in VS Code hand the row\'s path to the Sidebar\'s verbs; the menu closes', () => {
    const { el, props } = render()
    openPanel(el)
    rightClick(otherRow(el))
    pick('Reveal in Finder')
    expect(props.onReveal).toHaveBeenCalledWith(OTHER)
    expect(vaultMenu()).toBeNull()
    // Nothing here about the panel: in the app both verbs move focus to another app, and the window's
    // blur closes it (YAZ-2555 A4). jsdom has no real focus, so the panel is still up for the second verb.
    rightClick(otherRow(el))
    pick('Open in VS Code')
    expect(props.onOpenVsCode).toHaveBeenCalledWith(OTHER)
  })

  it('Copy vault name writes the folder name of an un-renamed vault and confirms through onNotice', async () => {
    const writeText = vi.fn(async () => undefined)
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true })
    const { el, props } = render()
    openPanel(el)
    rightClick(otherRow(el))
    pick('Copy vault name')
    await settle()
    expect(writeText).toHaveBeenCalledWith('Archive')
    expect(props.onNotice).toHaveBeenCalledWith('Copied vault name')
  })

  it('Remove from recent vaults forgets the MRU entry and drops the row at once; the panel stays with the filter focused', () => {
    const remove = vi.spyOn(storage, 'removeRecentRoot').mockImplementation(() => undefined)
    const { el } = render()
    openPanel(el)
    rightClick(otherRow(el))
    pick('Remove from recent vaults')
    expect(remove).toHaveBeenCalledWith(OTHER)
    expect(setFolder).not.toHaveBeenCalled() // it has no number to clear (YAZ-2555 A2)
    expect(rows(el).map(pathOf)).not.toContain(OTHER)
    expect(panel(el)).not.toBeNull()
    expect(document.activeElement).toBe(filter(el))
    remove.mockRestore()
  })

  it('Open in this window goes through onOpenHere (never openRecent) and closes the panel on success', async () => {
    const { el, props } = render()
    openPanel(el)
    rightClick(otherRow(el))
    pick('Open in this window')
    await settle()
    expect(props.onOpenHere).toHaveBeenCalledWith(OTHER)
    expect(openRecent).not.toHaveBeenCalled()
    expect(panel(el)).toBeNull()
  })

  it('Open in this window on a folder that is gone (false) greys the row like a click does; the panel stays — and the dead row then gets no menu', async () => {
    const { el } = render({ onOpenHere: vi.fn(async () => false) })
    openPanel(el)
    rightClick(otherRow(el))
    pick('Open in this window')
    await settle()
    expect(otherRow(el).disabled).toBe(true)
    expect(otherRow(el).querySelector('.vault-switcher__when')?.textContent).toBe(MISSING_TEXT)
    expect(panel(el)).not.toBeNull()
    expect(rightClick(otherRow(el))).toBe(true)
    expect(vaultMenu()).toBeNull()
  })

  it('layers (D4): Esc closes only the menu, the next Esc the panel; ↑/↓/⏎ never reach the panel while the menu stands', () => {
    const { el } = render()
    openPanel(el)
    const before = activeRow(el)
    rightClick(otherRow(el))
    key(el, 'ArrowDown')
    key(el, 'Enter')
    expect(activeRow(el)).toBe(before)
    expect(openRecent).not.toHaveBeenCalled()
    key(el, 'Escape')
    expect(vaultMenu()).toBeNull()
    expect(panel(el)).not.toBeNull()
    key(el, 'Escape')
    expect(panel(el)).toBeNull()
  })

  it('layers (D4): a click outside the menu closes only the menu', () => {
    const { el } = render()
    openPanel(el)
    rightClick(otherRow(el))
    act(() => void document.querySelector('.ctx-overlay')!.dispatchEvent(new MouseEvent('mousedown', { bubbles: true })))
    expect(vaultMenu()).toBeNull()
    expect(panel(el)).not.toBeNull()
  })
})

describe('VaultSwitcher: display names (YAZ-1974 D4/D5)', () => {
  const OTHER = RECENTS[2].path // '/v/Archive'
  const otherRow = (el: HTMLElement) => rows(el)[2]
  const field = (el: HTMLElement) => el.querySelector<HTMLInputElement>('.vault-switcher__rename')
  const fieldKey = (el: HTMLElement, k: string) => act(() => void field(el)!.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true })))
  /** Right-click → Set display name on `target`, then type `value` into the field it opens. */
  const rename = async (el: HTMLElement, target: HTMLElement, value: string) => {
    rightClick(target)
    pick('Set display name')
    await fill(field(el)!, value)
  }

  it('the trigger and the rows show display names; the trigger keeps the full path as its tooltip', () => {
    act(() => broadcast(withNames({ [ROOT]: 'Docs Vault', [OTHER]: '🚀 Launch' })))
    const { el } = render()
    expect(trigger(el).querySelector('.sidebar__root-name')?.textContent).toBe('Docs Vault')
    expect(trigger(el).title).toBe(ROOT)
    openPanel(el)
    expect(names(el)).toEqual(['Docs Vault', 'Notes', '🚀 Launch', 'Notes Archive'])
  })

  it('a rename landing from another window updates the header live (S12)', () => {
    const { el } = render()
    act(() => broadcast(withNames({ [ROOT]: 'Docs Vault' })))
    expect(trigger(el).querySelector('.sidebar__root-name')?.textContent).toBe('Docs Vault')
  })

  it('the filter finds a renamed row by its display name and by its folder name, once', async () => {
    act(() => broadcast(withNames({ [OTHER]: 'Old Stuff' })))
    const { el } = render()
    openPanel(el)
    await type(el, 'old')
    expect(names(el)).toEqual(['Old Stuff'])
    await type(el, 'archive')
    expect(names(el)).toEqual(['Old Stuff', 'Notes Archive'])
  })

  it('Set display name on a row: a focused field, name selected, folder name as placeholder — ⏎ saves, the row shows it, the panel stays with the filter focused', async () => {
    const { el } = render()
    openPanel(el)
    rightClick(otherRow(el))
    pick('Set display name')
    const input = field(el)!
    expect(otherRow(el).tagName).toBe('DIV') // no input inside a <button>
    expect(document.activeElement).toBe(input)
    expect([input.value, input.placeholder, input.selectionStart, input.selectionEnd]).toEqual(['Archive', 'Archive', 0, 'Archive'.length])
    await fill(input, '  Old Stuff ')
    fieldKey(el, 'Enter')
    expect(field(el)).toBeNull()
    expect(names(el)[2]).toBe('Old Stuff')
    expect(setFolder).toHaveBeenLastCalledWith(OTHER, { name: 'Old Stuff' })
    expect(panel(el)).not.toBeNull()
    expect(document.activeElement).toBe(filter(el))
    rightClick(otherRow(el))
    expect(menuLabels()).toContain('Reset to folder name')
  })

  it('blur saves', async () => {
    const { el } = render()
    openPanel(el)
    await rename(el, otherRow(el), 'Old Stuff')
    act(() => filter(el).focus())
    expect(field(el)).toBeNull()
    expect(names(el)[2]).toBe('Old Stuff')
    expect(panel(el)).not.toBeNull()
  })

  it('Esc throws the edit away and closes ONLY the field (the layer rule); the next Esc closes the panel', async () => {
    const { el } = render()
    openPanel(el)
    await rename(el, otherRow(el), 'Old Stuff')
    fieldKey(el, 'Escape')
    expect(field(el)).toBeNull()
    expect(names(el)[2]).toBe('Archive')
    expect(setFolder).not.toHaveBeenCalled()
    expect(panel(el)).not.toBeNull()
    expect(document.activeElement).toBe(filter(el))
    key(el, 'Escape')
    expect(panel(el)).toBeNull()
  })

  it('a click-away outside the panel saves and keeps the panel', async () => {
    const { el } = render()
    openPanel(el)
    await rename(el, otherRow(el), 'Old Stuff')
    act(() => void window.dispatchEvent(new MouseEvent('mousedown')))
    expect(panel(el)).not.toBeNull()
    act(() => field(el)!.blur()) // the browser's own focus change on that mousedown
    expect(names(el)[2]).toBe('Old Stuff')
  })

  it('the first click on another row only ends the rename (saved) — it never opens that vault; the next click does', async () => {
    const { el } = render()
    openPanel(el)
    await rename(el, otherRow(el), 'Old Stuff')
    const target = rows(el)[1]
    act(() => {
      target.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }))
      target.click()
    })
    await settle()
    expect(field(el)).toBeNull()
    expect(names(el)[2]).toBe('Old Stuff')
    expect(openRecent).not.toHaveBeenCalled()
    expect(panel(el)).not.toBeNull()
    act(() => {
      rows(el)[1].dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }))
      rows(el)[1].click()
    })
    await settle()
    expect(openRecent).toHaveBeenCalledExactlyOnceWith('/w/Notes')
  })

  it('an empty field, or the folder name itself, is no custom name: back to the folder name, no Reset item', async () => {
    act(() => broadcast(withNames({ [OTHER]: 'Old Stuff' })))
    const { el } = render()
    openPanel(el)
    await rename(el, otherRow(el), '   ')
    fieldKey(el, 'Enter')
    expect(names(el)[2]).toBe('Archive')
    expect(setFolder).toHaveBeenLastCalledWith(OTHER, { name: null })
    rightClick(otherRow(el))
    expect(menuLabels()).not.toContain('Reset to folder name')
    pick('Set display name')
    await fill(field(el)!, 'Archive ')
    fieldKey(el, 'Enter')
    expect(storage.vaultName(OTHER)).toBe('Archive')
  })

  it('Reset to folder name drops the display name', () => {
    act(() => broadcast(withNames({ [OTHER]: 'Old Stuff' })))
    const { el } = render()
    openPanel(el)
    rightClick(otherRow(el))
    pick('Reset to folder name')
    expect(names(el)[2]).toBe('Archive')
    expect(setFolder).toHaveBeenLastCalledWith(OTHER, { name: null })
    expect(document.activeElement).toBe(filter(el))
  })

  it('Set display name on the header renames the CURRENT vault in the header, the panel closed', async () => {
    const { el } = render()
    await rename(el, trigger(el), 'Docs Vault')
    expect(trigger(el).tagName).toBe('DIV')
    fieldKey(el, 'Enter')
    expect(trigger(el).tagName).toBe('BUTTON')
    expect(trigger(el).querySelector('.sidebar__root-name')?.textContent).toBe('Docs Vault')
    expect(setFolder).toHaveBeenLastCalledWith(ROOT, { name: 'Docs Vault' })
    expect(panel(el)).toBeNull()
  })
})

describe('VaultSwitcher: a vault\'s number (YAZ-2555 D2)', () => {
  const OTHER = RECENTS[2].path // '/v/Archive'
  const otherRow = (el: HTMLElement) => rows(el)[2]
  /** The current vault is "Docs" and has ⌘2. */
  const docsHasTwo = (): AppState => seeded({ folders: { [ROOT]: { ...defaultFolderState(), name: 'Docs', key: 2 } } })
  /** Right-click → Set shortcut on `target`: the flyout's lines as "label hint". */
  const openKeys = (target: HTMLElement) => {
    rightClick(target)
    pick('Set shortcut')
    return [...document.querySelectorAll<HTMLButtonElement>('.ctx-menu__sub .ctx-menu__item')].map((b) => `${b.textContent} ${b.dataset.hint ?? ''}`.trim())
  }

  it('Set shortcut on a row: the flyout names each number\'s vault; a number another vault has moves here at once — the open panel\'s badges with it (S14) — and No shortcut clears it (S13, S15, S17)', () => {
    act(() => broadcast(docsHasTwo()))
    const { el } = render()
    openPanel(el)
    expect(badges(el)).toEqual(['⌘2', null, null, null])
    expect(openKeys(otherRow(el))).toEqual(['⌘1 free', '⌘2 Docs', '⌘3 free', '⌘4 free', '⌘5 free', '⌘6 free', '⌘7 free', '⌘8 free', '⌘9 free'])
    pick('⌘2')
    expect(setFolder).toHaveBeenLastCalledWith(OTHER, { key: 2 })
    expect([storage.vaultKey(OTHER), storage.vaultKey(ROOT)]).toEqual([2, null])
    expect(badges(el)).toEqual([null, null, '⌘2', null]) // the row that lost the number redraws too
    expect(vaultMenu()).toBeNull()
    expect(panel(el)).not.toBeNull()
    expect(document.activeElement).toBe(filter(el))
    expect(openKeys(otherRow(el))).toEqual(['⌘1 free', '⌘2 ✓ Archive', '⌘3 free', '⌘4 free', '⌘5 free', '⌘6 free', '⌘7 free', '⌘8 free', '⌘9 free', 'No shortcut'])
    pick('No shortcut')
    expect(setFolder).toHaveBeenLastCalledWith(OTHER, { key: null })
    expect(storage.vaultKey(OTHER)).toBeNull()
    expect(badges(el)).toEqual([null, null, null, null])
  })

  it('Set shortcut on the header gives the CURRENT vault its number, the panel closed (S16: its old number is free again)', () => {
    act(() => broadcast(docsHasTwo()))
    const { el } = render()
    expect(openKeys(trigger(el))).toContain('⌘2 ✓ Docs')
    pick('⌘5')
    expect(setFolder).toHaveBeenLastCalledWith(ROOT, { key: 5 })
    expect(panel(el)).toBeNull()
    expect(openKeys(trigger(el)).slice(0, 5)).toEqual(['⌘1 free', '⌘2 free', '⌘3 free', '⌘4 free', '⌘5 ✓ Docs'])
  })

  it('Remove from recent vaults also clears the vault\'s number (A2, S19)', () => {
    act(() => broadcast(seeded({ folders: { [OTHER]: { ...defaultFolderState(), key: 3 } } })))
    const remove = vi.spyOn(storage, 'removeRecentRoot').mockImplementation(() => undefined)
    const { el } = render()
    openPanel(el)
    rightClick(otherRow(el))
    pick('Remove from recent vaults')
    expect(remove).toHaveBeenCalledWith(OTHER)
    expect(setFolder).toHaveBeenLastCalledWith(OTHER, { key: null })
    expect(storage.vaultKey(OTHER)).toBeNull()
    remove.mockRestore()
  })
})

describe('VaultSwitcher: the open group, the key badges, the window\'s blur (YAZ-2555 D1, D4, A1, A4, A6)', () => {
  const ARCHIVE = RECENTS[2].path
  const NOTES_ARCHIVE = RECENTS[3].path
  /** Seeds the cache, beside the four recents: one window per `open` root (null = a Welcome window), and each vault's number. */
  const seed = (open: (string | null)[], keys: Record<string, number> = {}) =>
    act(() =>
      broadcast(
        seeded({
          windows: open.map((root, i) => ({ id: `w${i}`, root, roots: root === null ? [] : [root], file: null, tabs: [], rightPanel: defaultRightPanelIdentity(), sidebarCollapsed: false, sidebarLens: 'files', focusList: [], bounds: { x: 0, y: 0, width: 800, height: 600 } })),
          folders: Object.fromEntries(Object.entries(keys).map(([path, key]) => [path, { ...defaultFolderState(), key }])),
        }),
      ),
    )

  it('open vaults first under "Open", the rest under "Not open" — recents, then open or numbered vaults that fell out of them, with no time — and a ⌘<n> badge on every numbered row (S1, S3–S6, S8, S9, S18)', async () => {
    // Archive is open in two windows and Loose (trailing slash, not a recent) in one; a Welcome window is no vault.
    // Two and Seven have a number but no window and no place in the recents.
    seed([ROOT, null, ARCHIVE, ARCHIVE, '/x/Loose/'], { [ARCHIVE]: 3, '/w/Notes': 1, '/x/Seven': 7, '/x/Two': 2 })
    const { el } = render()
    openPanel(el)
    expect(listing(el)).toEqual([
      `# ${GROUP_OPEN_TEXT}`,
      'Notes · 1 minute ago',
      'Archive · ⌘3 · yesterday',
      'Loose',
      `# ${GROUP_NOT_OPEN_TEXT}`,
      'Notes · ⌘1 · 2 hours ago',
      'Notes Archive · 3 days ago',
      'Two · ⌘2',
      'Seven · ⌘7',
    ])
    // The badge is a <kbd> between the name and the ⓘ; a row with no time keeps its (empty) time slot.
    expect([...rows(el)[1].children].map((part) => `${part.tagName}.${part.className}`)).toEqual(['SPAN.vault-switcher__name', 'KBD.vault-switcher__key', 'SPAN.vault-switcher__info', 'SPAN.vault-switcher__when'])
    expect(rows(el)[2].querySelector('.vault-switcher__when')?.textContent).toBe('')
    // The labels are not rows: no menuitem role, never highlighted — ↓ walks the seven rows, then Open folder….
    const labels = [...el.querySelectorAll('.vault-switcher__label')]
    expect(labels.map((label) => label.getAttribute('role'))).toEqual([null, null])
    expect(activeRow(el)).toBe(rows(el)[1]) // S3: the open vault used before this one
    for (let i = 0; i < 5; i++) key(el, 'ArrowDown')
    expect(activeRow(el)).toBe(rows(el)[6])
    key(el, 'ArrowDown')
    expect(activeRow(el)).toBe(openFolderRow(el))
    expect(el.querySelectorAll('.vault-switcher__row--active')).toHaveLength(1)
    expect(rows(el).map(pathOf)).toEqual([ROOT, ARCHIVE, '/x/Loose', '/w/Notes', NOTES_ARCHIVE, '/x/Two', '/x/Seven']) // one row per vault, the slash off
    // ⌘O ⏎ (S3–S5): one call to the one door, whatever the vault's windows are doing.
    openPanel(el)
    openPanel(el)
    key(el, 'Enter')
    await settle()
    expect(openRecent).toHaveBeenCalledExactlyOnceWith(ARCHIVE)
  })

  it('with only this window\'s vault open, "Open" is its one row and the highlight starts on the first "Not open" row (S2)', () => {
    seed([ROOT])
    const { el } = render()
    openPanel(el)
    expect(listing(el)).toEqual([`# ${GROUP_OPEN_TEXT}`, 'Notes · 1 minute ago', `# ${GROUP_NOT_OPEN_TEXT}`, 'Notes · 2 hours ago', 'Archive · yesterday', 'Notes Archive · 3 days ago'])
    expect(rows(el)[0].getAttribute('aria-current')).toBe('true')
    expect(activeRow(el)).toBe(rows(el)[1])
    expect(pathOf(activeRow(el)!)).toBe('/w/Notes')
  })

  it('a filter ranks the matches as before, THEN puts them in the two groups, badges kept; a group with no match shows no label (S7, A6)', async () => {
    seed([ROOT, NOTES_ARCHIVE], { [NOTES_ARCHIVE]: 4 })
    const { el } = render()
    openPanel(el)
    // "notes": both exact matches outrank the prefix match, but Notes Archive is open, so it stands above the Notes that is not.
    await type(el, 'notes')
    expect(listing(el)).toEqual([`# ${GROUP_OPEN_TEXT}`, 'Notes · 1 minute ago', 'Notes Archive · ⌘4 · 3 days ago', `# ${GROUP_NOT_OPEN_TEXT}`, 'Notes · 2 hours ago'])
    await type(el, 'arch')
    expect(listing(el)).toEqual([`# ${GROUP_OPEN_TEXT}`, 'Notes Archive · ⌘4 · 3 days ago', `# ${GROUP_NOT_OPEN_TEXT}`, 'Archive · yesterday'])
    expect(activeRow(el)).toBe(rows(el)[0])
    await type(el, 'archive')
    await type(el, 'w') // no vault name has a "w": nothing matches
    expect(el.querySelectorAll('.vault-switcher__label')).toHaveLength(0)
    expect(panel(el)!.querySelector('.vault-switcher__empty')?.textContent).toBe(NO_MATCH_TEXT)
    // Only a vault that is not open matches: its group alone, with its label.
    act(() => broadcast(withNames({ [ARCHIVE]: 'Old Stuff' })))
    openPanel(el)
    openPanel(el)
    await type(el, 'old')
    expect(listing(el)).toEqual([`# ${GROUP_NOT_OPEN_TEXT}`, 'Old Stuff · yesterday'])
    key(el, 'Enter')
    await settle()
    expect(openRecent).toHaveBeenCalledExactlyOnceWith(ARCHIVE)
  })

  it('a row that is listed only for its number, and loses it, stays until the panel closes; the next open does not list it (A1, ruled on YAZ-2560)', () => {
    seed([ROOT], { '/x/Two': 2 })
    const { el } = render()
    openPanel(el)
    expect(listing(el).slice(-2)).toEqual(['Notes Archive · 3 days ago', 'Two · ⌘2'])
    rightClick(rows(el)[4])
    pick('Set shortcut')
    pick('No shortcut')
    expect(storage.vaultKey('/x/Two')).toBeNull()
    expect(listing(el).slice(-2)).toEqual(['Notes Archive · 3 days ago', 'Two']) // the badge goes at once, the row does not
    openPanel(el)
    openPanel(el)
    expect(listing(el)).toEqual([`# ${GROUP_OPEN_TEXT}`, 'Notes · 1 minute ago', `# ${GROUP_NOT_OPEN_TEXT}`, 'Notes · 2 hours ago', 'Archive · yesterday', 'Notes Archive · 3 days ago'])
  })

  it('"Remove from recent vaults" on a vault that has a window: the row goes at once, and the next open lists it under "Open" with no time and no number (A1, A2, ruled on YAZ-2560)', () => {
    seed([ROOT, ARCHIVE], { [ARCHIVE]: 3 })
    const { el } = render()
    openPanel(el)
    expect(listing(el)).toEqual([`# ${GROUP_OPEN_TEXT}`, 'Notes · 1 minute ago', 'Archive · ⌘3 · yesterday', `# ${GROUP_NOT_OPEN_TEXT}`, 'Notes · 2 hours ago', 'Notes Archive · 3 days ago'])
    rightClick(rows(el)[1])
    pick('Remove from recent vaults')
    expect(listing(el)).toEqual([`# ${GROUP_OPEN_TEXT}`, 'Notes · 1 minute ago', `# ${GROUP_NOT_OPEN_TEXT}`, 'Notes · 2 hours ago', 'Notes Archive · 3 days ago'])
    openPanel(el)
    openPanel(el)
    expect(listing(el)).toEqual([`# ${GROUP_OPEN_TEXT}`, 'Notes · 1 minute ago', 'Archive', `# ${GROUP_NOT_OPEN_TEXT}`, 'Notes · 2 hours ago', 'Notes Archive · 3 days ago'])
  })

  it('the panel closes when its window loses focus — a row\'s menu with it, the ⇧ cue dropped — and a rename under way is saved by its own blur first (S10, A4)', async () => {
    seed([ROOT])
    const { el } = render()
    openPanel(el)
    act(() => void window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Shift', shiftKey: true })))
    expect(activeRow(el)?.querySelector('.vault-switcher__when')?.textContent).toBe(OPEN_HERE_TEXT)
    act(() => void window.dispatchEvent(new Event('blur')))
    expect(panel(el)).toBeNull()
    openPanel(el)
    expect(panel(el)!.textContent).not.toContain(OPEN_HERE_TEXT)

    rightClick(rows(el)[2])
    expect(vaultMenu()).not.toBeNull()
    act(() => void window.dispatchEvent(new Event('blur')))
    expect([panel(el), vaultMenu()]).toEqual([null, null])

    // The browser blurs the focused field before the window: the name is saved, then the panel goes.
    openPanel(el)
    rightClick(rows(el)[2])
    pick('Set display name')
    const field = el.querySelector<HTMLInputElement>('.vault-switcher__rename')!
    await fill(field, 'Old Stuff')
    act(() => {
      field.blur()
      window.dispatchEvent(new Event('blur'))
    })
    expect(panel(el)).toBeNull()
    expect(storage.vaultName(ARCHIVE)).toBe('Old Stuff')
    // The header's menu is no part of the panel: it stays.
    rightClick(trigger(el))
    act(() => void window.dispatchEvent(new Event('blur')))
    expect(vaultMenu()).not.toBeNull()
  })
})

describe('VaultSwitcher: one-line rows and the ⓘ path tooltip (YAZ-1974 D2)', () => {
  const LONG = '/Users/yasin/Documents/GitHub/content-skills/content-app-planning-with-a-very-long-folder-name'

  it('each row is ONE line — a name, an ⓘ and a time — and no path anywhere in the panel', () => {
    const { el } = render()
    openPanel(el)
    for (const row of rows(el)) {
      expect(row.querySelectorAll('.vault-switcher__name')).toHaveLength(1)
      expect(row.querySelectorAll('.vault-switcher__info svg')).toHaveLength(1)
      expect(row.querySelectorAll('.vault-switcher__when')).toHaveLength(1)
      expect(row.children).toHaveLength(3)
    }
    expect(panel(el)!.textContent).not.toContain('/')
    expect(tooltip()).toBeNull()
  })

  it('hovering the ⓘ draws the WHOLE path in a tooltip portalled to <body>, breakable after every slash; leaving clears it', () => {
    act(() => broadcast(seeded({ recents: [RECENTS[0], { path: LONG, lastOpened: NOW }] })))
    const { el } = render()
    openPanel(el)
    hoverInfo(rows(el)[1])
    const tip = tooltip()!
    expect(tip.parentElement).toBe(document.body)
    expect(tip.textContent).toBe(LONG)
    expect(tip.querySelectorAll('wbr')).toHaveLength(LONG.split('/').length)
    leaveInfo(rows(el)[1])
    expect(tooltip()).toBeNull()
  })

  it('the two "Notes" vaults tell apart by their tooltips; a dead row still shows its path', async () => {
    openRecent.mockResolvedValueOnce(false)
    const { el } = render()
    openPanel(el)
    expect([pathOf(rows(el)[0]), pathOf(rows(el)[1])]).toEqual([ROOT, '/w/Notes'])
    act(() => rows(el)[1].click())
    await settle()
    expect(rows(el)[1].disabled).toBe(true)
    expect(pathOf(rows(el)[1])).toBe('/w/Notes')
  })

  it('the ⓘ is part of its row: a click opens the vault, a right-click is the row\'s menu', async () => {
    const { el } = render()
    openPanel(el)
    const info = rows(el)[2].querySelector<HTMLElement>('.vault-switcher__info')!
    expect(rightClick(info)).toBe(true)
    expect(menuLabels()).toContain('Remove from recent vaults')
    act(() => void window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' })))
    act(() => info.click())
    await settle()
    expect(openRecent).toHaveBeenCalledExactlyOnceWith('/v/Archive')
  })

  it('closing the panel takes the tooltip with it', () => {
    const { el } = render()
    openPanel(el)
    hoverInfo(rows(el)[1])
    key(el, 'Escape')
    expect(tooltip()).toBeNull()
  })
})

/**
 * A window with two or more vaults (YAZ-2602 S15, S8). The header names the vaults — two names,
 * then a count — and opens the same list; "is current" is "is in this window". A vault that is not
 * in the window can be added to it from its row's menu.
 */
describe('VaultSwitcher: several vaults in one window (YAZ-2602 S15, S8)', () => {
  const ARCHIVE = '/v/Archive'
  const headerName = (el: HTMLElement) => trigger(el).querySelector('.sidebar__root-name')?.textContent
  const currentPaths = (el: HTMLElement) => rows(el).filter((r) => r.getAttribute('aria-current') === 'true').map(pathOf)
  /** The row of `path`, found by its ⓘ tooltip: two vaults share the name "Notes". */
  const rowOf = (el: HTMLElement, path: string) => rows(el).find((r) => pathOf(r) === path)!

  it('the header joins the vault names with " + ": two names, then "+ N more"; one vault reads as before (S15)', () => {
    const { el, rerender } = render()
    expect(headerName(el)).toBe('Notes')
    rerender({ roots: [ROOT, ARCHIVE] })
    expect(headerName(el)).toBe('Notes + Archive')
    expect(trigger(el).title).toBe(`${ROOT}\n${ARCHIVE}`)
    rerender({ roots: [ROOT, ARCHIVE, '/w/Notes'] })
    expect(headerName(el)).toBe('Notes + Archive + 1 more')
    rerender({ roots: [ROOT, ARCHIVE, '/w/Notes', '/v/Notes Archive'] })
    expect(headerName(el)).toBe('Notes + Archive + 2 more')
  })

  it('the header uses each vault\'s display name, and follows a rename made in another window', () => {
    const { el } = render({ roots: [ROOT, ARCHIVE] })
    act(() => broadcast(withNames({ [ARCHIVE]: 'Old notes' })))
    expect(headerName(el)).toBe('Notes + Old notes')
  })

  it('a click opens the same list: each vault of this window is marked current, and the highlight starts on the first vault that is not in it', () => {
    const { el } = render({ roots: [ROOT, '/w/Notes'] })
    openPanel(el)
    expect(panel(el)).not.toBeNull()
    // Read first: a hover moves the highlight, and a row's path is read by hovering its ⓘ.
    const highlighted = activeRow(el)!
    expect(currentPaths(el)).toEqual([ROOT, '/w/Notes'])
    expect(pathOf(highlighted)).toBe(ARCHIVE)
  })

  it('with two or more vaults a right-click on the header shows one item, "Save as workspace…" — never one vault\'s menu — and the native one is swallowed', () => {
    const { el } = render({ roots: [ROOT, ARCHIVE] })
    expect(rightClick(trigger(el))).toBe(true)
    expect(menuLabels()).toEqual(['Save as workspace…'])
    expect(panel(el)).toBeNull()
  })

  it('a row\'s menu: a vault that is not in this window leads with "Add to this window", then "Open in this window"; a vault that is in it has neither, and no Remove (S8)', () => {
    const { el } = render({ roots: [ROOT, '/w/Notes'], onAddHere: vi.fn(async () => true) })
    openPanel(el)
    rightClick(rowOf(el, ARCHIVE))
    expect(menuLabels()).toEqual(['Add to this window', 'Open in this window', 'Set display name', 'Set shortcut', 'Copy vault name', 'Copy path', 'Reveal in Finder', 'Open in VS Code', 'Remove from recent vaults'])
    act(() => void window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' })))
    for (const inWindow of [ROOT, '/w/Notes']) {
      rightClick(rowOf(el, inWindow))
      expect(menuLabels()).toEqual(['Set display name', 'Set shortcut', 'Copy vault name', 'Copy path', 'Reveal in Finder', 'Open in VS Code'])
      act(() => void window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' })))
    }
  })

  it('"Add to this window" asks App through onAddHere — never openRecent, never onOpenHere — and closes the panel once the vault is added (S8)', async () => {
    const { el, props } = render({ onAddHere: vi.fn(async () => true) })
    openPanel(el)
    rightClick(rowOf(el, ARCHIVE))
    pick('Add to this window')
    await settle()
    expect(props.onAddHere).toHaveBeenCalledExactlyOnceWith(ARCHIVE)
    expect(openRecent).not.toHaveBeenCalled()
    expect(props.onOpenHere).not.toHaveBeenCalled()
    expect(panel(el)).toBeNull()
  })

  it('a refused add leaves the panel up: App has said why', async () => {
    const { el } = render({ onAddHere: vi.fn(async () => false) })
    openPanel(el)
    rightClick(rowOf(el, ARCHIVE))
    pick('Add to this window')
    await settle()
    expect(panel(el)).not.toBeNull()
    expect(rowOf(el, ARCHIVE).disabled).toBe(false)
  })

  it('⇧⏎ on a vault of this window that is not the first is a plain open, as on the first: you are there', async () => {
    const { el, props } = render({ roots: [ROOT, '/w/Notes'] })
    openPanel(el)
    const second = rowOf(el, '/w/Notes')
    act(() => void second.dispatchEvent(new MouseEvent('click', { bubbles: true, shiftKey: true })))
    await settle()
    expect(props.onOpenHere).not.toHaveBeenCalled()
    expect(openRecent).toHaveBeenCalledExactlyOnceWith('/w/Notes')
  })
})

/**
 * Workspaces (YAZ-2602 D8): saved sets of vaults. The list shows them first, under "Workspaces";
 * a row opens through `window.openSet`, and its menu renames or removes it. A window with two or
 * more vaults saves its own from the header — "Save as workspace…" — and the header shows a
 * workspace's name while the window's vaults are exactly that workspace. The four doors are mocked
 * on the fake bridge; the saved workspaces are seeded into the cache, as main's broadcast lands them.
 */
describe('VaultSwitcher: workspaces (YAZ-2602 D8, S15, S63 to S70)', () => {
  const ARCHIVE = '/v/Archive'
  const WORK: VaultSet = { id: 'set-work', name: 'Work', roots: [ARCHIVE, '/w/Notes'], lastUsed: NOW - 3_600_000 }
  const READING: VaultSet = { id: 'set-reading', name: 'Reading', roots: [ROOT, ARCHIVE, '/v/Notes Archive'], lastUsed: NOW - 86_400_000 }
  /** The list with no workspace, and no window seeded: the four recents under "Not open" — as every older test reads it. */
  const VAULTS = [`# ${GROUP_NOT_OPEN_TEXT}`, 'Notes · 1 minute ago', 'Notes · 2 hours ago', 'Archive · yesterday', 'Notes Archive · 3 days ago']
  const seedSets = (...vaultSets: VaultSet[]) => act(() => broadcast(seeded({ vaultSets })))
  const headerName = (el: HTMLElement) => trigger(el).querySelector('.sidebar__root-name')?.textContent
  const when = (row: HTMLElement) => row.querySelector('.vault-switcher__when')
  const field = (el: HTMLElement) => el.querySelector<HTMLInputElement>('.vault-switcher__rename')
  const fieldKey = (el: HTMLElement, k: string) => act(() => void field(el)!.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true })))
  /** Right-click the header → "Save as workspace…"; with `name`, type it into the field that opens. */
  const saveAs = async (el: HTMLElement, name?: string) => {
    rightClick(trigger(el))
    pick(SAVE_SET_TEXT)
    if (name !== undefined) await fill(field(el)!, name)
  }

  /** ↑ to the first row — the first workspace — from wherever the highlight starts: ↑ clamps at the top. */
  const toFirstRow = (el: HTMLElement) => {
    for (let i = 0; i < 8; i++) key(el, 'ArrowUp')
  }

  let openSet: ReturnType<typeof vi.fn>
  let saveSet: ReturnType<typeof vi.fn>
  let renameSet: ReturnType<typeof vi.fn>
  let removeSet: ReturnType<typeof vi.fn>
  beforeEach(() => {
    openSet = vi.fn(async () => ({ opened: true, missing: [] }))
    saveSet = vi.fn(async () => true)
    renameSet = vi.fn(async () => true)
    removeSet = vi.fn(async () => undefined)
    Object.assign((window as unknown as { yaseenDocs: { window: object } }).yaseenDocs.window, { openSet, saveSet, renameSet, removeSet })
  })

  it('"Workspaces" stands first — a label, not a row — with one row per saved workspace, last used first: its name and "N vaults"; then the vault groups as before. The highlight still starts on the first vault that is not in this window; ↑ reaches the workspace rows, and they take hover (S64)', () => {
    const { el } = render()
    openPanel(el)
    expect(listing(el)).toEqual(VAULTS) // no saved workspace: the list of today, no label
    openPanel(el)
    seedSets(WORK, READING)
    openPanel(el)
    expect(listing(el)).toEqual([`# ${GROUP_SETS_TEXT}`, 'Work · 2 vaults', 'Reading · 3 vaults', ...VAULTS])
    expect(el.querySelector('.vault-switcher__label')?.getAttribute('role')).toBeNull()
    // A workspace row is a name and its count: no ⌘ number, no ⓘ — it is not one folder.
    expect([...rows(el)[0].children].map((part) => `${part.tagName}.${part.className}`)).toEqual(['SPAN.vault-switcher__name', 'SPAN.vault-switcher__when'])
    expect(rows(el)[0].getAttribute('role')).toBe('menuitem')
    // The start is where it was before workspaces (YAZ-2555): the last used vault that is not this window's.
    expect(activeRow(el)).toBe(rows(el)[3])
    expect(pathOf(activeRow(el)!)).toBe('/w/Notes')
    key(el, 'ArrowUp') // pathOf hovered the row: the highlight is still on it
    key(el, 'ArrowUp')
    expect(activeRow(el)).toBe(rows(el)[1])
    key(el, 'ArrowUp')
    key(el, 'ArrowUp')
    expect(activeRow(el)).toBe(rows(el)[0])
    key(el, 'ArrowDown')
    expect(activeRow(el)).toBe(rows(el)[1])
    for (let i = 0; i < 4; i++) key(el, 'ArrowDown')
    expect(activeRow(el)).toBe(rows(el)[5])
    key(el, 'ArrowDown')
    key(el, 'ArrowDown')
    expect(activeRow(el)).toBe(openFolderRow(el))
    act(() => void rows(el)[1].dispatchEvent(new MouseEvent('mouseover', { bubbles: true })))
    expect(activeRow(el)).toBe(rows(el)[1])
    expect(el.querySelectorAll('.vault-switcher__row--active')).toHaveLength(1)
  })

  it('the filter matches a workspace by its name, ranked like a vault; a group with no match shows no label (S64)', async () => {
    seedSets({ ...READING, id: 'set-homework', name: 'Homework' }, WORK, { ...READING, id: 'set-plan', name: 'Notes plan' })
    const { el } = render()
    openPanel(el)
    await type(el, 'work') // exact, then substring — whatever was used last
    expect(listing(el)).toEqual([`# ${GROUP_SETS_TEXT}`, 'Work · 2 vaults', 'Homework · 3 vaults'])
    expect(el.querySelector('.vault-switcher__empty')).toBeNull()
    expect(activeRow(el)).toBe(rows(el)[0])
    await type(el, 'notes') // a workspace and vaults: the workspaces still stand first
    expect(listing(el)).toEqual([`# ${GROUP_SETS_TEXT}`, 'Notes plan · 3 vaults', `# ${GROUP_NOT_OPEN_TEXT}`, 'Notes · 1 minute ago', 'Notes · 2 hours ago', 'Notes Archive · 3 days ago'])
    expect(activeRow(el)).toBe(rows(el)[0])
    await type(el, 'arch') // vaults only
    expect(listing(el)).toEqual([`# ${GROUP_NOT_OPEN_TEXT}`, 'Archive · yesterday', 'Notes Archive · 3 days ago'])
    await type(el, 'zzz')
    expect(el.querySelectorAll('.vault-switcher__label')).toHaveLength(0)
    expect(el.querySelector('.vault-switcher__empty')?.textContent).toBe(NO_MATCH_TEXT)
    expect(activeRow(el)).toBe(openFolderRow(el))
    await type(el, 'homew')
    key(el, 'Enter')
    await settle()
    expect(openSet).toHaveBeenCalledExactlyOnceWith('set-homework')
  })

  it('⌘O ⏎ with a saved workspace still goes to the last used OTHER vault, through window.openRecent — a workspace never takes that key over (YAZ-2555)', async () => {
    seedSets(WORK, READING)
    const { el, rerender } = render()
    rerender({ openRequest: 1 })
    expect(listing(el).slice(0, 3)).toEqual([`# ${GROUP_SETS_TEXT}`, 'Work · 2 vaults', 'Reading · 3 vaults'])
    key(el, 'Enter')
    await settle()
    expect(openRecent).toHaveBeenCalledExactlyOnceWith('/w/Notes')
    expect(openSet).not.toHaveBeenCalled()
    expect(panel(el)).toBeNull()
  })

  it('the workspace that this window shows is marked like the current vault; with an empty query the highlight never starts on a workspace row — with no vault outside this window it is the first vault row, as before workspaces', () => {
    seedSets(WORK, READING)
    // Work's vaults in the other order, one with a trailing slash: still exactly that workspace.
    const { el, rerender } = render({ roots: ['/w/Notes', `${ARCHIVE}/`] })
    openPanel(el)
    expect(rows(el).slice(0, 2).map((r) => r.getAttribute('aria-current'))).toEqual(['true', null])
    expect(activeRow(el)).toBe(rows(el)[2])
    expect(pathOf(activeRow(el)!)).toBe(ROOT)
    openPanel(el)
    rerender({ roots: RECENTS.map((r) => r.path) }) // every listed vault is in this window
    openPanel(el)
    expect(activeRow(el)).toBe(rows(el)[2])
    expect(pathOf(activeRow(el)!)).toBe(ROOT)
  })

  it('⏎ or a click opens the workspace through window.openSet — never openRecent — and closes the panel; ⇧ has no "open here" for a workspace: no cue, and ⇧⏎ / ⇧-click are a plain open (S65)', async () => {
    seedSets(WORK, READING)
    const { el, props } = render()
    openPanel(el)
    toFirstRow(el)
    key(el, 'Enter')
    await settle()
    expect(openSet).toHaveBeenCalledExactlyOnceWith('set-work')
    expect(panel(el)).toBeNull()

    openPanel(el)
    toFirstRow(el)
    act(() => void window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Shift', shiftKey: true })))
    expect(when(activeRow(el)!)?.textContent).toBe('2 vaults')
    act(() => void filter(el).dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', shiftKey: true, bubbles: true, cancelable: true })))
    await settle()
    expect(openSet).toHaveBeenCalledTimes(2)
    expect(panel(el)).toBeNull()

    openPanel(el)
    act(() => void rows(el)[1].dispatchEvent(new MouseEvent('click', { shiftKey: true, bubbles: true })))
    await settle()
    expect(openSet).toHaveBeenLastCalledWith('set-reading')
    expect(panel(el)).toBeNull()
    expect(props.onOpenHere).not.toHaveBeenCalled()
    expect(openRecent).not.toHaveBeenCalled()
    expect(props.onNotice).not.toHaveBeenCalled()
  })

  it('a folder of the workspace is gone: it opens without it and a notice names it. Every folder gone: nothing opens, the row says "Folders not found" like a dead vault row, and the panel stays (S66)', async () => {
    act(() => broadcast(seeded({ vaultSets: [WORK, READING], folders: { '/w/Notes': { ...defaultFolderState(), name: 'Field notes' } } })))
    const { el, props } = render()
    openSet.mockResolvedValueOnce({ opened: true, missing: [ARCHIVE, '/w/Notes'] })
    openPanel(el)
    toFirstRow(el)
    key(el, 'Enter')
    await settle()
    expect(panel(el)).toBeNull()
    expect(props.onNotice).toHaveBeenCalledExactlyOnceWith('Not found: Archive, Field notes')

    openSet.mockResolvedValueOnce({ opened: false, missing: WORK.roots })
    openPanel(el)
    act(() => rows(el)[0].click())
    await settle()
    expect(rows(el)[0].disabled).toBe(true)
    expect(when(rows(el)[0])?.textContent).toBe(SETS_MISSING_TEXT)
    expect(when(rows(el)[0])?.className).toContain('vault-switcher__when--missing')
    expect(listing(el)[2]).toBe('Reading · 3 vaults') // the other rows are as they were
    expect(panel(el)).not.toBeNull()
    expect(document.activeElement).toBe(filter(el))
    expect(props.onNotice).toHaveBeenCalledTimes(1)
    // The dead row opens nothing more; the workspace is still saved, so its menu still stands.
    toFirstRow(el)
    key(el, 'Enter')
    await settle()
    expect(openSet).toHaveBeenCalledTimes(2)
    rightClick(rows(el)[0])
    expect(menuLabels()).toEqual(['Rename', 'Remove from workspaces'])
    // The next open asks again: the folders can come back (a drive that was not mounted).
    act(() => void window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' })))
    openPanel(el)
    openPanel(el)
    expect(rows(el)[0].disabled).toBe(false)
    // A door that fails reads as "nothing opened".
    openSet.mockRejectedValueOnce(new Error('ipc down'))
    const logged = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    toFirstRow(el)
    key(el, 'Enter')
    await settle()
    expect(rows(el)[0].disabled).toBe(true)
    expect(logged).toHaveBeenCalled()
    logged.mockRestore()
  })

  it('a workspace row\'s menu is "Rename" and "Remove from workspaces". Rename is the display name\'s inline field: ⏎ or blur saves through window.renameSet, Esc or an empty field cancels, a refused name says so and changes nothing. Remove forgets the workspace at once (S67)', async () => {
    seedSets(WORK, READING)
    const { el, props } = render()
    openPanel(el)
    const before = activeRow(el)
    expect(rightClick(rows(el)[1])).toBe(true)
    expect(menuLabels()).toEqual(['Rename', 'Remove from workspaces'])
    expect(activeRow(el)).toBe(before)
    pick('Rename')
    const input = field(el)!
    expect(rows(el)[1].tagName).toBe('DIV') // no input inside a <button>
    expect(document.activeElement).toBe(input)
    expect([input.value, input.selectionStart, input.selectionEnd]).toEqual(['Reading', 0, 'Reading'.length])
    expect(when(rows(el)[1])?.textContent).toBe('3 vaults')
    await fill(input, '  Books ')
    fieldKey(el, 'Enter')
    await settle()
    expect(renameSet).toHaveBeenCalledExactlyOnceWith('set-reading', 'Books')
    expect(listing(el).slice(0, 3)).toEqual([`# ${GROUP_SETS_TEXT}`, 'Work · 2 vaults', 'Books · 3 vaults'])
    expect(panel(el)).not.toBeNull()
    expect(document.activeElement).toBe(filter(el))

    // A click on another row only ends the rename — its blur saves — and opens nothing. A name that another workspace has is refused, and the old name stays.
    renameSet.mockResolvedValueOnce(false)
    rightClick(rows(el)[1])
    pick('Rename')
    await fill(field(el)!, 'Work')
    act(() => {
      rows(el)[0].dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }))
      rows(el)[0].click()
    })
    await settle()
    expect(field(el)).toBeNull()
    expect(openSet).not.toHaveBeenCalled()
    expect(renameSet).toHaveBeenLastCalledWith('set-reading', 'Work')
    expect(props.onNotice).toHaveBeenCalledExactlyOnceWith("Can't rename: a workspace has that name")
    expect(names(el).slice(0, 2)).toEqual(['Work', 'Books'])

    // Esc throws the edit away and closes only the field; an empty field is no name.
    rightClick(rows(el)[1])
    pick('Rename')
    await fill(field(el)!, 'Other')
    fieldKey(el, 'Escape')
    expect(field(el)).toBeNull()
    expect(panel(el)).not.toBeNull()
    rightClick(rows(el)[1])
    pick('Rename')
    await fill(field(el)!, '   ')
    fieldKey(el, 'Enter')
    await settle()
    expect(renameSet).toHaveBeenCalledTimes(2)
    expect(names(el).slice(0, 2)).toEqual(['Work', 'Books'])

    rightClick(rows(el)[1])
    pick('Remove from workspaces')
    expect(removeSet).toHaveBeenCalledExactlyOnceWith('set-reading')
    expect(listing(el)).toEqual([`# ${GROUP_SETS_TEXT}`, 'Work · 2 vaults', ...VAULTS])
    expect(panel(el)).not.toBeNull()
    expect(document.activeElement).toBe(filter(el))
    rightClick(rows(el)[0])
    pick('Remove from workspaces')
    expect(listing(el)).toEqual(VAULTS) // the label goes with its last row
    expect(props.onNotice).toHaveBeenCalledTimes(1)
  })

  it('the workspace menu is the top layer like the vault menu: ↑/↓/⏎ do not reach the panel, Esc closes it alone, and it goes with the panel when the window loses focus', () => {
    seedSets(WORK, READING)
    const { el } = render()
    openPanel(el)
    const before = activeRow(el)
    rightClick(rows(el)[1])
    key(el, 'ArrowDown')
    key(el, 'Enter')
    expect(activeRow(el)).toBe(before)
    expect(openSet).not.toHaveBeenCalled()
    expect(openRecent).not.toHaveBeenCalled()
    key(el, 'Escape')
    expect([vaultMenu(), panel(el) === null]).toEqual([null, false])
    rightClick(rows(el)[1])
    act(() => void window.dispatchEvent(new Event('blur')))
    expect([panel(el), vaultMenu()]).toEqual([null, null])
  })

  it('"Save as workspace…": the header\'s name becomes a field that holds every vault name joined with " + "; ⏎ saves this window\'s vaults through window.saveSet and says so; Esc or an empty name cancels (S63)', async () => {
    act(() => broadcast(withNames({ [ARCHIVE]: 'Old notes' })))
    const { el, props } = render({ roots: [ROOT, ARCHIVE, '/w/Notes'] })
    expect(headerName(el)).toBe('Notes + Old notes + 1 more')
    expect(rightClick(trigger(el))).toBe(true)
    expect(menuLabels()).toEqual([SAVE_SET_TEXT])
    expect(SAVE_SET_TEXT).toBe('Save as workspace…')
    pick(SAVE_SET_TEXT)
    const input = field(el)!
    expect(trigger(el).tagName).toBe('DIV')
    expect(document.activeElement).toBe(input)
    const all = 'Notes + Old notes + Notes' // the full list, never "+ 1 more"
    expect([input.value, input.selectionStart, input.selectionEnd]).toEqual([all, 0, all.length])
    fieldKey(el, 'Enter') // the name is right as it stands
    await settle()
    expect(saveSet).toHaveBeenCalledExactlyOnceWith(all)
    expect(props.onNotice).toHaveBeenCalledExactlyOnceWith(`Saved workspace "${all}"`)
    expect(trigger(el).tagName).toBe('BUTTON')
    expect(panel(el)).toBeNull()

    await saveAs(el, '  Work ')
    fieldKey(el, 'Enter')
    await settle()
    expect(saveSet).toHaveBeenLastCalledWith('Work')
    expect(props.onNotice).toHaveBeenLastCalledWith('Saved workspace "Work"')

    await saveAs(el, 'Never mind')
    fieldKey(el, 'Escape')
    expect(trigger(el).tagName).toBe('BUTTON')
    await saveAs(el, '   ')
    fieldKey(el, 'Enter')
    expect(trigger(el).tagName).toBe('BUTTON')
    // A click-away with the name untouched saves nothing: only ⏎ takes the name as it stands.
    await saveAs(el)
    act(() => field(el)!.blur())
    await settle()
    expect(trigger(el).tagName).toBe('BUTTON')
    expect(saveSet).toHaveBeenCalledTimes(2)
    expect(props.onNotice).toHaveBeenCalledTimes(2)
  })

  it(`workspace ${MAX_VAULT_SETS + 1} is refused before main is asked — "Remove a workspace first" — but a name that exists still saves, because it replaces; any other refusal says "Can't save the workspace" (S68, S69, R12)`, async () => {
    const full = Array.from({ length: MAX_VAULT_SETS }, (_, i): VaultSet => ({ id: `set-${i}`, name: `Set ${i}`, roots: ['/x/a', `/x/b${i}`], lastUsed: NOW - i }))
    seedSets(...full)
    const { el, props } = render({ roots: [ROOT, ARCHIVE] })
    await saveAs(el, 'One more')
    fieldKey(el, 'Enter')
    await settle()
    expect(saveSet).not.toHaveBeenCalled()
    expect(props.onNotice).toHaveBeenCalledExactlyOnceWith('Remove a workspace first')

    await saveAs(el, ' Set 7 ')
    fieldKey(el, 'Enter')
    await settle()
    expect(saveSet).toHaveBeenCalledExactlyOnceWith('Set 7')
    expect(props.onNotice).toHaveBeenLastCalledWith('Saved workspace "Set 7"')

    seedSets(...full.slice(1)) // room again: main's own "no" is the other refusal
    saveSet.mockResolvedValueOnce(false)
    await saveAs(el, 'One more')
    fieldKey(el, 'Enter')
    await settle()
    expect(saveSet).toHaveBeenLastCalledWith('One more')
    expect(props.onNotice).toHaveBeenLastCalledWith("Can't save the workspace")
  })

  it('a window with one vault has no "Save as workspace…": the header\'s right-click is the vault menu, as before (S70)', () => {
    seedSets(WORK, READING)
    const { el } = render()
    rightClick(trigger(el))
    expect(menuLabels()).toEqual(['Set display name', 'Set shortcut', 'Copy vault name', 'Copy path', 'Reveal in Finder', 'Open in VS Code'])
  })

  it('a window with one vault reads no saved workspace for its header, on a render or on a change of the cache: one vault is never a workspace (S70)', () => {
    const { el, rerender } = render()
    const read = vi.spyOn(storage, 'getVaultSets')
    seedSets(WORK, READING)
    rerender({})
    expect(headerName(el)).toBe('Notes')
    expect(read).not.toHaveBeenCalled()
    read.mockRestore()
  })

  it('the header shows the workspace\'s name while the window\'s vaults are exactly a saved workspace — the first one that matches — and follows a save, a rename and a remove in the cache, and a vault added or removed (S15)', async () => {
    const { el, rerender } = render({ roots: [ROOT, ARCHIVE] })
    expect(headerName(el)).toBe('Notes + Archive')
    const pair: VaultSet = { id: 'set-pair', name: 'Pair', roots: [`${ARCHIVE}/`, ROOT], lastUsed: NOW }
    seedSets(WORK, pair) // saved, here or in any window: the order and a trailing slash do not count
    expect(headerName(el)).toBe('Pair')
    expect(trigger(el).title).toBe(`${ROOT}\n${ARCHIVE}`)
    seedSets(WORK, { ...pair, name: 'Duo' })
    expect(headerName(el)).toBe('Duo')
    seedSets({ ...pair, id: 'set-first', name: 'First' }, { ...pair, name: 'Duo' })
    expect(headerName(el)).toBe('First')
    // "Save as workspace…" still starts from the vault names: a new name is a new workspace.
    await saveAs(el)
    expect(field(el)!.value).toBe('Notes + Archive')
    fieldKey(el, 'Escape')

    seedSets(WORK, { ...pair, name: 'Duo' })
    rerender({ roots: [ROOT, ARCHIVE, '/w/Notes'] }) // one vault more is not that workspace
    expect(headerName(el)).toBe('Notes + Archive + 1 more')
    rerender({ roots: [ARCHIVE, '/w/Notes'] })
    expect(headerName(el)).toBe('Work')
    seedSets()
    expect(headerName(el)).toBe('Archive + Notes')
    seedSets(WORK)
    rerender({ roots: [ARCHIVE] }) // one vault is never a workspace
    expect(headerName(el)).toBe('Archive')
  })
})
