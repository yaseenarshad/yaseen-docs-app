import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, Profiler } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { MAX_VAULT_NAME, defaultAppState, defaultFolderState, defaultRightPanelIdentity, type AppState, type Session, type WindowIdentity } from '@shared/types'
import { storage } from '../lib/storage'
import { NO_SESSIONS_HELP, RENAME_CLICK_GAP_MS, SessionList } from './SessionList'

const WORK: Session = { id: 's1', name: 'Work', tabs: [{ path: '/v/a.md', name: 'Plan' }, { path: '/w/b.md', active: true }, { path: '/w/b.md' }], roots: ['/v', '/w'], lastUsed: 20 }
const SOLO: Session = { id: 's2', name: 'Solo', tabs: [{ path: '/v/c.md' }], roots: ['/v'], lastUsed: 10 }

/** The bridge the cache and the five doors need: a pushed state goes through `emit`, as `state:changed` does. */
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
    window: {
      identity: vi.fn(async (): Promise<WindowIdentity> => ({ id: 'w1', root: '/v', roots: ['/v', '/w'], file: null, tabs: [], rightPanel: defaultRightPanelIdentity(), sidebarCollapsed: false, sidebarLens: 'sessions' })),
      setIdentity: vi.fn(async () => undefined),
      renameSession: vi.fn(async (_id: string, _name: string) => true),
      setSessionTabs: vi.fn(async () => true),
      removeSession: vi.fn(async () => undefined),
    },
  }
  Object.defineProperty(window, 'yaseenDocs', { value: bridge, configurable: true, writable: true })
  return { bridge, emit: (next: AppState) => act(() => listener?.(next)) }
}

let root: Root | null = null
let el: HTMLElement
let b: ReturnType<typeof installBridge>
const props = { titles: new Map([['/w/b.md', 'Bee page']]), onOpenFile: vi.fn(), onRestore: vi.fn(), onSave: vi.fn(), onUpdate: vi.fn(), renameRequest: null as string | null, onRenameConsumed: vi.fn() }
let renders = 0

async function mount(sessions: Session[], extra: Partial<Parameters<typeof SessionList>[0]> = {}) {
  b = installBridge({ ...defaultAppState(), sessions, folders: { '/w': { ...defaultFolderState(), name: 'Work vault' } } })
  await storage.init()
  el = document.createElement('div')
  document.body.appendChild(el)
  root = createRoot(el)
  renders = 0
  act(() => root?.render(<Profiler id="list" onRender={() => void renders++}><SessionList {...props} {...extra} /></Profiler>))
}

/** Two quick clicks on a row's name: what a rename asks for (RENAME_CLICK_GAP_MS). */
const renameClicks = (row: Element) => {
  const label = row.querySelector('.tree__label') as Element
  act(() => void label.dispatchEvent(new MouseEvent('click', { bubbles: true, detail: 1 })))
  act(() => void label.dispatchEvent(new MouseEvent('click', { bubbles: true, detail: 2 })))
}
const rows = () => [...el.querySelectorAll<HTMLButtonElement>('[aria-label="Sessions"] > li > .tree__row')]
const tabRows = () => [...el.querySelectorAll<HTMLButtonElement>('[aria-label="Sessions"] > li > ul .tree__row')]
const text = (b: Element) => [...b.children].map((c) => c.textContent)
const field = () => el.querySelector<HTMLInputElement>('input[aria-label="Session name"]')
const key = (target: Element | null, k: string) => act(() => void target?.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true })))
const fill = (input: HTMLInputElement, value: string) =>
  act(() => {
    Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set?.call(input, value)
    input.dispatchEvent(new Event('input', { bubbles: true }))
  })
const rightClick = (target: Element) => act(() => void target.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 5, clientY: 5 })))
const items = () => [...document.querySelectorAll<HTMLButtonElement>('.ctx-menu [role="menuitem"]')]
const groups = () => [...document.querySelectorAll('.ctx-menu [role="group"]')].map((g) => [...g.querySelectorAll('[role="menuitem"]')].map((i) => i.textContent))
const choose = (label: string) => act(() => items().find((i) => i.textContent === label)?.click())

beforeEach(() => vi.clearAllMocks())
afterEach(() => {
  act(() => root?.unmount())
  root = null
  el.remove()
  document.body.innerHTML = ''
  delete (window as unknown as Record<string, unknown>).yaseenDocs
})

describe('SessionList (YAZ-3147 D6)', () => {
  it('S37: with no session, the bar says "No sessions", one help line shows, and "Save open tabs" asks App', async () => {
    await mount([])
    expect(el.querySelector('.sidebar__focus-bar')?.textContent).toBe('No sessionsSave open tabs')
    expect(el.querySelector('.sidebar__msg')?.textContent).toBe(NO_SESSIONS_HELP)
    expect(el.querySelector('.tree')).toBeNull()
    act(() => el.querySelector<HTMLButtonElement>('.sidebar__focus-bar button')?.click())
    expect(props.onSave).toHaveBeenCalledOnce()
  })

  it('rows in main\'s order with the tab count; a click unfolds and folds; a tab row shows its display name, else its page name, and its vault; a click opens it as a sidebar click does (S33)', async () => {
    await mount([WORK, SOLO])
    expect(el.querySelector('.sidebar__focus-bar span')?.textContent).toBe('2 sessions')
    expect(rows().map(text)).toEqual([['', 'Work', '3 tabs'], ['', 'Solo', '1 tab']])
    expect(tabRows()).toEqual([])
    act(() => rows()[0].click())
    expect(rows()[0].querySelector('.tree__chevron--open')).not.toBeNull()
    expect(rows()[0].getAttribute('aria-expanded')).toBe('true')
    expect(tabRows().map(text)).toEqual([['Plan', 'v'], ['Bee page', 'Work vault'], ['Bee page', 'Work vault']])
    act(() => tabRows()[1].click())
    expect(props.onOpenFile).toHaveBeenCalledExactlyOnceWith('/w/b.md')
    act(() => rows()[0].click())
    expect(tabRows()).toEqual([])
  })

  it('YAZ-3511 D19, edge case 68: the list reports its fold, and the expand-all button opens and closes every row', async () => {
    const onFold = vi.fn()
    await mount([WORK, SOLO], { onFold })
    expect(onFold.mock.lastCall?.[0]).toMatchObject({ open: false, any: true })
    act(() => onFold.mock.lastCall?.[0].setAll(true))
    expect(rows().map((r) => r.getAttribute('aria-expanded'))).toEqual(['true', 'true'])
    expect(onFold.mock.lastCall?.[0]).toMatchObject({ open: true })
    act(() => onFold.mock.lastCall?.[0].setAll(false))
    expect(rows().map((r) => r.getAttribute('aria-expanded'))).toEqual(['false', 'false'])
  })

  it('a rename needs two clicks on the NAME within RENAME_CLICK_GAP_MS: slower clicks, or clicks on the arrow or the count, only fold and unfold', async () => {
    await mount([WORK, SOLO])
    const now = vi.spyOn(performance, 'now')
    const clickAt = (target: Element, at: number, detail: number) => {
      now.mockReturnValue(at)
      act(() => void target.dispatchEvent(new MouseEvent('click', { bubbles: true, detail })))
    }
    const label = () => rows()[1].querySelector('.tree__label') as Element
    clickAt(label(), 1000, 1)
    clickAt(label(), 1000 + RENAME_CLICK_GAP_MS + 50, 2) // the Mac still calls it a double-click
    expect(field()).toBeNull()
    clickAt(rows()[1].querySelector('.tree__count') as Element, 3000, 1)
    clickAt(rows()[1].querySelector('.tree__count') as Element, 3100, 2)
    expect(field()).toBeNull()
    clickAt(label(), 5000, 1)
    clickAt(label(), 5000 + RENAME_CLICK_GAP_MS, 2)
    expect(field()?.value).toBe('Solo')
    now.mockRestore()
  })

  it('S12–S15: a double-click opens the name field with the name selected; Return saves through main; Esc keeps the name; a blank name is refused; the field takes 80 characters', async () => {
    await mount([WORK, SOLO])
    renameClicks(rows()[1])
    const input = field()
    expect(input?.value).toBe('Solo')
    expect(document.activeElement).toBe(input)
    expect([input?.selectionStart, input?.selectionEnd]).toEqual([0, 4])
    expect(input?.maxLength).toBe(MAX_VAULT_NAME)
    fill(input as HTMLInputElement, '  Deep work  ')
    key(input, 'Enter')
    expect(b.bridge.window.renameSession).toHaveBeenCalledExactlyOnceWith('s2', 'Deep work')
    expect(field()).toBeNull()

    renameClicks(rows()[1])
    fill(field() as HTMLInputElement, 'Changed')
    key(field(), 'Escape')
    expect(field()).toBeNull()
    renameClicks(rows()[1])
    fill(field() as HTMLInputElement, '   ')
    key(field(), 'Enter')
    expect(b.bridge.window.renameSession).toHaveBeenCalledOnce()
    expect(rows()[1].textContent).toContain('Solo')
  })

  it('the session menu (D6): Restore, Update, Rename, then Delete in its own group; each does its work', async () => {
    await mount([WORK, SOLO])
    rightClick(rows()[0])
    expect(groups()).toEqual([['Restore session', 'Update with open tabs', 'Rename'], ['Delete session']])
    choose('Restore session')
    expect(props.onRestore).toHaveBeenCalledExactlyOnceWith('s1')
    expect(items()).toEqual([])
    rightClick(rows()[0])
    choose('Update with open tabs')
    expect(props.onUpdate).toHaveBeenCalledExactlyOnceWith('s1')
    rightClick(rows()[1])
    choose('Rename') // S14: the same field as a double-click
    expect(field()?.value).toBe('Solo')
  })

  it('S32: "Delete session" asks with a sheet; Cancel keeps it, Delete removes it through main', async () => {
    await mount([WORK, SOLO])
    rightClick(rows()[0])
    // The menu and the sheet are on the page, not in the list (YAZ-3389 D12): the list zooms, they never do.
    expect([document.querySelector('.ctx-menu')?.isConnected, el.querySelector('.ctx-menu')]).toEqual([true, null])
    choose('Delete session')
    const sheet = () => document.querySelector('[role="dialog"]')
    expect([sheet()?.isConnected, el.querySelector('[role="dialog"]')]).toEqual([true, null])
    expect(sheet()?.querySelector('.confirm__text')?.textContent).toBe('Delete "Work"?Your files and open tabs do not change.')
    act(() => [...document.querySelectorAll<HTMLButtonElement>('.confirm button')].find((x) => x.textContent === 'Cancel')?.click())
    expect(sheet()).toBeNull()
    expect(b.bridge.window.removeSession).not.toHaveBeenCalled()
    rightClick(rows()[0])
    choose('Delete session')
    act(() => [...document.querySelectorAll<HTMLButtonElement>('.confirm button')].find((x) => x.textContent === 'Delete')?.click())
    expect(sheet()).toBeNull()
    expect(b.bridge.window.removeSession).toHaveBeenCalledExactlyOnceWith('s1')
  })

  it('S30, S31: "Remove from session" on a tab row sends the tabs that stay — a copy by its place; main\'s broadcast redraws the list, and only a change of the sessions does (S36)', async () => {
    await mount([WORK])
    act(() => rows()[0].click())
    rightClick(tabRows()[2])
    expect(groups()).toEqual([['Remove from session']])
    choose('Remove from session')
    expect(b.bridge.window.setSessionTabs).toHaveBeenCalledExactlyOnceWith('s1', WORK.tabs.slice(0, 2))

    const before = renders
    b.emit({ ...defaultAppState(), sessions: structuredClone(storage.getSessions()), recents: [{ path: '/v', lastOpened: 9 }] }) // a new copy, as main sends
    expect(renders).toBe(before) // another change of the app state: no render
    b.emit({ ...defaultAppState(), sessions: [{ ...WORK, tabs: [] }] })
    expect(renders).toBe(before + 1)
    expect(rows().map(text)).toEqual([['', 'Work', '0 tabs']]) // S31: the session stays
    expect(tabRows()).toEqual([])
  })

  it('S1, S11: a save asks for the new row\'s name field — it opens once the row is in the list, with "New session" selected; Esc keeps the name', async () => {
    const onRenameConsumed = vi.fn()
    await mount([SOLO], { renameRequest: 's9', onRenameConsumed })
    expect(field()).toBeNull() // main's broadcast has not come yet
    expect(onRenameConsumed).not.toHaveBeenCalled()
    b.emit({ ...defaultAppState(), sessions: [{ id: 's9', name: 'New session', tabs: [{ path: '/v/a.md' }], roots: ['/v'], lastUsed: 30 }, SOLO] })
    const input = field()
    expect(input?.value).toBe('New session')
    expect([input?.selectionStart, input?.selectionEnd]).toEqual([0, 11])
    expect(onRenameConsumed).toHaveBeenCalledOnce()
    key(input, 'Escape')
    expect(field()).toBeNull()
    expect(b.bridge.window.renameSession).not.toHaveBeenCalled()
    expect(rows()[0].textContent).toContain('New session')
  })
})
