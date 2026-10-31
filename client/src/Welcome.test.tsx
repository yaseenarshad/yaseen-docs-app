/**
 * Welcome screen (C2, GRO-2164): the app name, recents as one-click rows (display name, path,
 * relative last-opened), the empty state, and the "Folder not found" note on a row whose
 * folder vanished on disk — the rows are snapshotted at mount, so that row stays visible
 * after its MRU entry is dropped.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { defaultAppState, defaultFolderState, type RecentRoots, type VaultSet } from '@shared/types'
import { storage } from './lib/storage'
import { relativeLastOpened, Welcome } from './Welcome'

;(globalThis as unknown as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true

const HOUR = 3_600_000
const DAY = 24 * HOUR

let root: Root | null = null
let container: HTMLElement | null = null

type WelcomeProps = Parameters<typeof Welcome>[0]

function mount(over: Partial<WelcomeProps> = {}): { el: HTMLElement; props: WelcomeProps } {
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  const props: WelcomeProps = { recents: [], sets: [], onOpenRecent: vi.fn(async () => true), onOpenSet: vi.fn(async () => true), onPickFolder: vi.fn(), picking: false, ...over }
  act(() => root?.render(<Welcome {...props} />))
  return { el: container, props }
}

const rows = (el: HTMLElement) => [...el.querySelectorAll<HTMLButtonElement>('.welcome__recent')]

afterEach(() => {
  act(() => root?.unmount())
  root = null
  container?.remove()
  container = null
})

describe('relativeLastOpened', () => {
  it('formats the largest whole unit, "just now" under a minute', () => {
    const now = 10 * 365 * DAY
    expect(relativeLastOpened(now - 30_000, now)).toBe('just now')
    expect(relativeLastOpened(now - 5 * 60_000, now)).toBe('5 minutes ago')
    expect(relativeLastOpened(now - 3 * HOUR, now)).toBe('3 hours ago')
    expect(relativeLastOpened(now - DAY, now)).toBe('yesterday')
    expect(relativeLastOpened(now - 2 * DAY, now)).toBe('2 days ago')
    expect(relativeLastOpened(now - 8 * DAY, now)).toBe('last week')
    expect(relativeLastOpened(now - 40 * DAY, now)).toBe('last month')
    expect(relativeLastOpened(now - 800 * DAY, now)).toBe('2 years ago')
  })
})

describe('Welcome', () => {
  it('renders the app name, one row per recent in MRU order and the Open folder… button', () => {
    const recents: RecentRoots = [
      { path: '/vaults/notes', lastOpened: Date.now() - 2 * HOUR },
      { path: '/vaults/work', lastOpened: Date.now() - DAY },
    ]
    const { el } = mount({ recents })
    expect(el.querySelector('.welcome__title')?.textContent?.trim()).toBe('Yaseen Docs')
    const r = rows(el)
    expect(r.map((b) => b.querySelector('.welcome__recent-name')?.textContent)).toEqual(['notes', 'work'])
    expect(r.map((b) => b.querySelector('.welcome__recent-path')?.textContent)).toEqual(['/vaults/notes', '/vaults/work'])
    expect(r[0]?.querySelector('.welcome__recent-when')?.textContent).toBe('2 hours ago')
    expect(r[1]?.querySelector('.welcome__recent-when')?.textContent).toBe('yesterday')
    expect(el.querySelector<HTMLButtonElement>('.btn--primary')?.textContent).toBe('Open folder…')
    expect(el.querySelector('.welcome__empty')).toBeNull()
  })

  it('shows at most 10 rows (MAX_RECENT_ROOTS)', () => {
    const recents: RecentRoots = Array.from({ length: 12 }, (_, i) => ({ path: `/v${i}`, lastOpened: 100 - i }))
    const { el } = mount({ recents })
    expect(rows(el)).toHaveLength(10)
    expect(rows(el)[0]?.querySelector('.welcome__recent-path')?.textContent).toBe('/v0')
  })

  it('shows the empty state when there are no recents', () => {
    const { el } = mount()
    expect(el.querySelector('.welcome__empty')?.textContent).toBe('No recent folders yet.')
    expect(el.querySelector('.welcome__recents')).toBeNull()
    expect(el.querySelector('.btn--primary')).not.toBeNull()
  })

  it('clicking a row opens that recent; the Open folder… button runs the pick flow', () => {
    const { el, props } = mount({ recents: [{ path: '/vaults/notes', lastOpened: Date.now() }] })
    act(() => rows(el)[0]?.click())
    expect(props.onOpenRecent).toHaveBeenCalledWith('/vaults/notes')
    act(() => el.querySelector<HTMLButtonElement>('.btn--primary')?.click())
    expect(props.onPickFolder).toHaveBeenCalledTimes(1)
  })

  it('a recent whose folder is gone keeps its row, marked "Folder not found" and disabled', async () => {
    const onOpenRecent = vi.fn(async () => false)
    const { el } = mount({ recents: [{ path: '/vaults/gone', lastOpened: Date.now() }], onOpenRecent })
    await act(async () => rows(el)[0]?.click())
    const row = rows(el)[0]
    expect(row?.disabled).toBe(true)
    expect(row?.querySelector('.welcome__recent-when')?.textContent).toBe('Folder not found')
    expect(row?.querySelector('.welcome__recent-name')?.textContent).toBe('gone')
  })

  it('a renamed vault shows its display name; its path line stays the folder path (YAZ-1974 D4)', async () => {
    const state = { ...defaultAppState(), folders: { '/vaults/business-wiki-MASTER': { ...defaultFolderState(), name: '🚀 Business Wiki' } } }
    Object.defineProperty(window, 'yaseenDocs', { value: { state: { get: async () => state, onChange: () => () => undefined }, window: { identity: async () => ({}) } }, configurable: true, writable: true })
    await storage.init()
    const { el } = mount({ recents: [{ path: '/vaults/business-wiki-MASTER', lastOpened: Date.now() }, { path: '/vaults/work', lastOpened: Date.now() }] })
    expect(rows(el).map((b) => b.querySelector('.welcome__recent-name')?.textContent)).toEqual(['🚀 Business Wiki', 'work'])
    expect(rows(el)[0]?.querySelector('.welcome__recent-path')?.textContent).toBe('/vaults/business-wiki-MASTER')
    delete (window as unknown as Record<string, unknown>).yaseenDocs
  })

  it('saved workspaces stand first under "Workspaces": name, last used, vault names; then a line and "Folders" (YAZ-3886 D2, D3)', () => {
    const sets: VaultSet[] = [
      { id: 's1', name: 'Work', roots: ['/vaults/notes', '/vaults/work'], lastUsed: Date.now() - 2 * HOUR },
      { id: 's2', name: 'Never used', roots: ['/a', '/b', '/c'], lastUsed: 0 },
    ]
    const { el } = mount({ sets, recents: [{ path: '/vaults/notes', lastOpened: Date.now() - DAY }] })
    expect([...el.querySelectorAll('.welcome__label')].map((l) => [l.textContent, l.classList.contains('welcome__label--rule')])).toEqual([['Workspaces', false], ['Folders', true]])
    const r = rows(el)
    expect(r.map((b) => b.querySelector('.welcome__recent-name')?.textContent)).toEqual(['Work', 'Never used', 'notes'])
    expect(r.map((b) => b.querySelector('.welcome__recent-when')?.textContent)).toEqual(['2 hours ago', '', 'yesterday'])
    expect(r.map((b) => b.querySelector('.welcome__recent-path')?.textContent)).toEqual(['notes + work', 'a + b + c', '/vaults/notes'])
  })

  it('with no saved workspace the page is as before: no label, no line (YAZ-3886 D4)', () => {
    const { el } = mount({ recents: [{ path: '/vaults/notes', lastOpened: Date.now() }] })
    expect(el.querySelector('.welcome__label')).toBeNull()
    expect(rows(el)).toHaveLength(1)
  })

  it('a workspace with no recent folder keeps "Folders" above the empty note', () => {
    const { el } = mount({ sets: [{ id: 's1', name: 'Work', roots: ['/a', '/b'], lastUsed: 0 }] })
    expect(el.querySelector('.welcome__label--rule')?.nextElementSibling?.textContent).toBe('No recent folders yet.')
  })

  it('a click opens the workspace by its id; with no folder left the row greys with "Folders not found" (YAZ-3886 D1)', async () => {
    const onOpenSet = vi.fn(async () => false)
    const { el, props } = mount({ sets: [{ id: 's1', name: 'Work', roots: ['/a', '/b'], lastUsed: Date.now() }], onOpenSet })
    await act(async () => rows(el)[0]?.click())
    expect(onOpenSet).toHaveBeenCalledExactlyOnceWith('s1')
    expect(props.onOpenRecent).not.toHaveBeenCalled()
    expect(rows(el)[0]?.disabled).toBe(true)
    expect(rows(el)[0]?.querySelector('.welcome__recent-when')?.textContent).toBe('Folders not found')
  })

  it('a folder\'s path under the home folder reads "~/…" once main answers; any other path stays in full (YAZ-3886 P2)', async () => {
    Object.defineProperty(window, 'yaseenDocs', { value: { app: { home: async () => '/Users/me' } }, configurable: true, writable: true })
    const recents: RecentRoots = ['/Users/me/Documents/notes', '/Users/meg/work', '/Volumes/disk/me'].map((path) => ({ path, lastOpened: Date.now() }))
    const { el } = mount({ recents })
    const paths = () => rows(el).map((b) => b.querySelector('.welcome__recent-path')?.textContent)
    expect(paths()).toEqual(['/Users/me/Documents/notes', '/Users/meg/work', '/Volumes/disk/me'])
    await act(async () => undefined)
    expect(paths()).toEqual(['~/Documents/notes', '/Users/meg/work', '/Volumes/disk/me'])
    delete (window as unknown as Record<string, unknown>).yaseenDocs
  })

  it('the app\'s icon stands in the title, left of the name (YAZ-3886 P1)', () => {
    const { el } = mount()
    const title = el.querySelector('.welcome__title')
    expect(title?.firstElementChild?.matches('img.welcome__icon')).toBe(true)
    expect(title?.textContent?.trim()).toBe('Yaseen Docs')
  })

  it('disables the Open folder… button while the dialog is open', () => {
    const { el } = mount({ picking: true })
    expect(el.querySelector<HTMLButtonElement>('.btn--primary')?.disabled).toBe(true)
  })
})
