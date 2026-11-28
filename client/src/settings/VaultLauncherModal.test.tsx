/**
 * VaultLauncherModal tests (YAZ-6682 D5 + D3 copy + D6 appId):
 * Start View controls (Sidebar tab, Favorites/Focus/Files folder picker, Hide everything else),
 * Workspace App Start View support, appId edit vs create contract, and "app" UI copy.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, type ReactNode } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { defaultAppState, type FocusFolder, type TreeResponse, type VaultLauncherStatus } from '@shared/types'
import { VaultLauncherModal } from './VaultLauncherModal'

;(globalThis as unknown as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true

const FAKE_PNG_DATA_URL = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=='
const ROOT = '/Users/yasin/Notes'

let reactRoot: Root | null = null
let host: HTMLElement | null = null

const mockCreate = vi.fn()
const mockCreateWorkspace = vi.fn()
const mockFavoriteFoldersGet = vi.fn()
const mockFavoritesGet = vi.fn()
const mockFocusFoldersGet = vi.fn()
const mockFocusGet = vi.fn()
const mockTree = vi.fn()
const mockStateGet = vi.fn()

const fakeCtx = {
  clearRect: vi.fn(),
  save: vi.fn(),
  restore: vi.fn(),
  beginPath: vi.fn(),
  moveTo: vi.fn(),
  lineTo: vi.fn(),
  quadraticCurveTo: vi.fn(),
  closePath: vi.fn(),
  clip: vi.fn(),
  fillRect: vi.fn(),
  fillText: vi.fn(),
  drawImage: vi.fn(),
  createLinearGradient: vi.fn(() => ({ addColorStop: vi.fn() })),
  fillStyle: '',
  font: '',
  textAlign: 'center',
  textBaseline: 'middle',
  globalCompositeOperation: 'source-over',
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(fakeCtx as unknown as CanvasRenderingContext2D)
  vi.spyOn(HTMLCanvasElement.prototype, 'toDataURL').mockReturnValue(FAKE_PNG_DATA_URL)

  mockFavoriteFoldersGet.mockResolvedValue([])
  mockFavoritesGet.mockResolvedValue([])
  mockFocusFoldersGet.mockResolvedValue([])
  mockFocusGet.mockResolvedValue([])
  mockTree.mockResolvedValue({ root: ROOT, tree: [], generatedAt: 1 } satisfies TreeResponse)
  mockStateGet.mockResolvedValue(defaultAppState())

  ;(window as unknown as { yaseenDocs: Record<string, unknown> }).yaseenDocs = {
    vaultLauncher: {
      create: mockCreate,
      createWorkspace: mockCreateWorkspace,
    },
    favoriteFolders: { get: mockFavoriteFoldersGet },
    favorites: { get: mockFavoritesGet },
    focusFolders: { get: mockFocusFoldersGet },
    focus: { get: mockFocusGet },
    tree: mockTree,
    state: { get: mockStateGet },
  }
})

afterEach(() => {
  if (reactRoot !== null) {
    act(() => reactRoot!.unmount())
    reactRoot = null
  }
  host?.remove()
  host = null
  vi.restoreAllMocks()
})

async function render(node: ReactNode): Promise<HTMLElement> {
  host = document.createElement('div')
  document.body.appendChild(host)
  reactRoot = createRoot(host)
  await act(async () => {
    reactRoot!.render(node)
  })
  return host
}

function buttonByText(rootEl: HTMLElement, text: string): HTMLButtonElement | undefined {
  return [...rootEl.querySelectorAll<HTMLButtonElement>('button')].find((b) => b.textContent?.trim() === text)
}

function savedStatus(name = 'Notes'): VaultLauncherStatus {
  return {
    supported: true,
    exists: true,
    iconDataUrl: FAKE_PNG_DATA_URL,
    launcher: {
      id: 'default',
      name,
      appPath: `/Applications/${name}.app`,
      iconPath: `/tmp/${name}.png`,
      target: 'normal',
    },
  }
}

describe('VaultLauncherModal — Start View, appId & "app" copy (YAZ-6682)', () => {
  it('uses "app" copy across create, edit, recreate, and workspace modes with zero user-visible "launcher" text', async () => {
    const el1 = await render(<VaultLauncherModal root={ROOT} defaultName="Notes" onSaved={vi.fn()} onClose={vi.fn()} />)
    expect(el1.querySelector('#vault-launcher-modal-title')?.textContent).toBe('Make a vault app')
    expect(el1.querySelector('[aria-label="App preview"]')).not.toBeNull()
    expect(buttonByText(el1, 'Create app')).toBeDefined()
    expect(el1.textContent?.toLowerCase()).not.toContain('launcher')
    await act(async () => buttonByText(el1, 'Image')?.click())
    expect(el1.querySelector('input[aria-label="Choose app image"]')).not.toBeNull()
    act(() => reactRoot!.unmount())
    reactRoot = null
    host?.remove()

    const initial = savedStatus('Notes').launcher!
    const el2 = await render(<VaultLauncherModal root={ROOT} defaultName="Notes" initial={initial} onSaved={vi.fn()} onClose={vi.fn()} />)
    expect(el2.querySelector('#vault-launcher-modal-title')?.textContent).toBe('Edit vault app')
    expect(buttonByText(el2, 'Save app')).toBeDefined()
    expect(el2.textContent?.toLowerCase()).not.toContain('launcher')
    act(() => reactRoot!.unmount())
    reactRoot = null
    host?.remove()

    const el3 = await render(<VaultLauncherModal root={ROOT} defaultName="Notes" initial={initial} recreating onSaved={vi.fn()} onClose={vi.fn()} />)
    expect(el3.querySelector('#vault-launcher-modal-title')?.textContent).toBe('Recreate vault app')
    expect(buttonByText(el3, 'Recreate app')).toBeDefined()
    act(() => reactRoot!.unmount())
    reactRoot = null
    host?.remove()

    const el4 = await render(<VaultLauncherModal workspaceId="ws-1" defaultName="Suite" onSaved={vi.fn()} onClose={vi.fn()} />)
    expect(el4.querySelector('#vault-launcher-modal-title')?.textContent).toBe('Create workspace app')
    expect(buttonByText(el4, 'Create app')).toBeDefined()
    expect(el4.textContent?.toLowerCase()).not.toContain('launcher')
    act(() => reactRoot!.unmount())
    reactRoot = null
    host?.remove()

    const el5 = await render(<VaultLauncherModal workspaceId="ws-1" defaultName="Suite" initial={initial} onSaved={vi.fn()} onClose={vi.fn()} />)
    expect(el5.querySelector('#vault-launcher-modal-title')?.textContent).toBe('Edit workspace app')
    expect(buttonByText(el5, 'Save app')).toBeDefined()
    act(() => reactRoot!.unmount())
    reactRoot = null
    host?.remove()

    const el6 = await render(<VaultLauncherModal workspaceId="ws-1" defaultName="Suite" initial={initial} recreating onSaved={vi.fn()} onClose={vi.fn()} />)
    expect(el6.querySelector('#vault-launcher-modal-title')?.textContent).toBe('Recreate workspace app')
    expect(buttonByText(el6, 'Recreate app')).toBeDefined()
  })

  it('loads Favorites collection + disk folders, defaults Hide everything else to On, updates preview, and submits sidebarStart', async () => {
    const folders: FocusFolder[] = [
      { id: 'col-eng', name: 'Engineering', created: 1, at: 10, items: [] },
      { id: 'col-del', name: 'Deleted', created: 2, at: 20, items: [], deleted: true },
    ]
    mockFavoriteFoldersGet.mockResolvedValue(folders)
    mockFavoritesGet.mockResolvedValue([`${ROOT}/Clients`, `${ROOT}/readme.md`])
    mockTree.mockResolvedValue({
      root: ROOT,
      generatedAt: 1,
      tree: [
        { type: 'dir', name: 'Clients', path: `${ROOT}/Clients`, children: [] },
        { type: 'file', name: 'readme.md', path: `${ROOT}/readme.md`, size: 10, mtime: 1, kind: 'markdown' },
      ],
    } satisfies TreeResponse)
    mockCreate.mockResolvedValue(savedStatus('Notes'))

    const el = await render(<VaultLauncherModal root={ROOT} defaultName="Notes" onSaved={vi.fn()} onClose={vi.fn()} />)
    // Lazy: does not query folders while Sidebar tab is Default.
    expect(mockFavoriteFoldersGet).not.toHaveBeenCalled()
    expect(el.querySelector('select[aria-label="Favorites folder"]')).toBeNull()

    await act(async () => buttonByText(el, 'Favorites')?.click())
    await act(async () => {})

    expect(mockFavoriteFoldersGet).toHaveBeenCalledWith(ROOT, 'vault')
    expect(mockFavoritesGet).toHaveBeenCalledWith(ROOT, 'vault')

    const select = el.querySelector<HTMLSelectElement>('select[aria-label="Favorites folder"]')!
    expect(select).not.toBeNull()
    const optionTexts = [...select.querySelectorAll('option')].map((o) => o.textContent)
    expect(optionTexts).toEqual(['None (show all)', 'Engineering', 'Clients'])
    // Hide everything else is hidden until a folder is picked.
    expect(el.querySelector('[aria-label="Hide everything else"]')).toBeNull()

    await act(async () => {
      select.value = 'collection:col-eng'
      select.dispatchEvent(new Event('change', { bubbles: true }))
    })

    // Hide everything else appears and defaults to On.
    const onlyGroup = el.querySelector<HTMLElement>('[aria-label="Hide everything else"]')!
    expect(onlyGroup).not.toBeNull()
    expect(buttonByText(onlyGroup, 'On')?.getAttribute('aria-pressed')).toBe('true')
    expect(el.querySelector('.vault-launcher-modal__alfred-sub')?.textContent).toBe('Favorites · Engineering (only)')

    await act(async () => buttonByText(el, 'Create app')?.click())
    expect(mockCreate).toHaveBeenCalledWith({
      root: ROOT,
      name: 'Notes',
      pngBase64: FAKE_PNG_DATA_URL.replace(/^data:image\/png;base64,/, ''),
      target: 'normal',
      badge: { kind: 'letters', value: 'NO', color: '#007AFF' },
      sidebarStart: {
        tab: 'favorites',
        folderKind: 'collection',
        folderId: 'col-eng',
        folderName: 'Engineering',
        onlyFolder: true,
      },
    })
  })

  it('loads Files vault folders and allows toggling Hide everything else Off', async () => {
    mockTree.mockResolvedValue({
      root: ROOT,
      generatedAt: 1,
      tree: [
        {
          type: 'dir',
          name: 'Clients',
          path: `${ROOT}/Clients`,
          children: [
            { type: 'dir', name: 'Acme', path: `${ROOT}/Clients/Acme`, children: [] },
          ],
        },
      ],
    } satisfies TreeResponse)
    mockCreate.mockResolvedValue(savedStatus('Notes'))

    const el = await render(<VaultLauncherModal root={ROOT} defaultName="Notes" onSaved={vi.fn()} onClose={vi.fn()} />)
    await act(async () => buttonByText(el, 'Files')?.click())
    await act(async () => {})

    const select = el.querySelector<HTMLSelectElement>('select[aria-label="Folder in vault"]')!
    expect([...select.querySelectorAll('option')].map((o) => o.textContent)).toEqual([
      'None (show all)',
      'Clients',
      'Clients/Acme',
    ])

    await act(async () => {
      select.value = 'disk:Clients/Acme'
      select.dispatchEvent(new Event('change', { bubbles: true }))
    })
    expect(el.querySelector('.vault-launcher-modal__alfred-sub')?.textContent).toBe('Files · Clients/Acme (only)')

    const onlyGroup = el.querySelector<HTMLElement>('[aria-label="Hide everything else"]')!
    await act(async () => buttonByText(onlyGroup, 'Off')?.click())
    expect(el.querySelector('.vault-launcher-modal__alfred-sub')?.textContent).toBe('Files · Clients/Acme')

    await act(async () => buttonByText(el, 'Create app')?.click())
    expect(mockCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        sidebarStart: {
          tab: 'files',
          folderKind: 'disk',
          folderPath: 'Clients/Acme',
          onlyFolder: false,
        },
      }),
    )
  })

  it('supports Start View for Workspace Apps using workspace scope and sends sidebarStart in createWorkspace', async () => {
    const wsState = defaultAppState()
    wsState.vaultSets = [{ id: 'ws-1', name: 'Work Suite', roots: ['/v/a', '/v/b'], lastUsed: 1 }]
    mockStateGet.mockResolvedValue(wsState)
    mockFocusFoldersGet.mockImplementation(async (r: string) =>
      r === '/v/a' ? [{ id: 'ws-f1', name: 'Sprint', created: 1, at: 5, items: [] }] : [],
    )
    mockCreateWorkspace.mockResolvedValue(savedStatus('Work Suite'))

    const el = await render(
      <VaultLauncherModal workspaceId="ws-1" defaultName="Work Suite" onSaved={vi.fn()} onClose={vi.fn()} />,
    )
    expect(el.querySelector('[aria-label="Open on"]')).toBeNull()

    await act(async () => buttonByText(el, 'Focus')?.click())
    await act(async () => {})

    expect(mockFocusFoldersGet).toHaveBeenCalledWith('/v/a', 'workspace')
    expect(mockFocusFoldersGet).toHaveBeenCalledWith('/v/b', 'workspace')

    const select = el.querySelector<HTMLSelectElement>('select[aria-label="Focus folder"]')!
    await act(async () => {
      select.value = 'collection:ws-f1'
      select.dispatchEvent(new Event('change', { bubbles: true }))
    })
    expect(el.querySelector('.vault-launcher-modal__alfred-sub')?.textContent).toBe('Focus · Sprint (only)')

    await act(async () => buttonByText(el, 'Create app')?.click())
    expect(mockCreateWorkspace).toHaveBeenCalledWith({
      workspaceId: 'ws-1',
      name: 'Work Suite',
      pngBase64: FAKE_PNG_DATA_URL.replace(/^data:image\/png;base64,/, ''),
      badge: { kind: 'letters', value: 'WS', color: '#007AFF' },
      sidebarStart: {
        tab: 'focus',
        folderKind: 'collection',
        folderId: 'ws-f1',
        folderName: 'Sprint',
        onlyFolder: true,
      },
    })
  })

  it('passes appId on edit (explicit appId or initial.id), prefills sidebarStart, preserves missing saved folder, and omits appId on create', async () => {
    mockCreate.mockResolvedValue(savedStatus('Work'))

    // 1. Create new app (no appId, initial=null) -> omits appId
    const elNew = await render(
      <VaultLauncherModal root={ROOT} defaultName="Work" initial={null} onSaved={vi.fn()} onClose={vi.fn()} />,
    )
    await act(async () => buttonByText(elNew, 'Create app')?.click())
    const createCall = mockCreate.mock.calls[0]?.[0] as Record<string, unknown>
    expect('appId' in createCall).toBe(false)
    act(() => reactRoot!.unmount())
    reactRoot = null
    host?.remove()

    // 2. Edit via initial.id (no explicit appId prop) + saved sidebarStart whose folder isn't in fetched list
    mockCreate.mockClear()
    const elEditViaInitial = await render(
      <VaultLauncherModal
        root={ROOT}
        defaultName="Work"
        initial={{
          id: 'a1b2c3d4',
          name: 'Work Focus',
          appPath: '/Applications/Work Focus.app',
          iconPath: '/tmp/wf.png',
          target: 'normal',
          sidebarStart: { tab: 'files', folderKind: 'disk', folderPath: 'Archived/Old', onlyFolder: false },
        }}
        onSaved={vi.fn()}
        onClose={vi.fn()}
      />,
    )
    await act(async () => {})
    const select = elEditViaInitial.querySelector<HTMLSelectElement>('select[aria-label="Folder in vault"]')!
    expect(select.value).toBe('disk:Archived/Old')
    const onlyGroup = elEditViaInitial.querySelector<HTMLElement>('[aria-label="Hide everything else"]')!
    expect(buttonByText(onlyGroup, 'Off')?.getAttribute('aria-pressed')).toBe('true')
    expect(elEditViaInitial.querySelector('.vault-launcher-modal__alfred-sub')?.textContent).toBe('Files · Archived/Old')

    await act(async () => buttonByText(elEditViaInitial, 'Save app')?.click())
    expect(mockCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        root: ROOT,
        appId: 'a1b2c3d4',
        name: 'Work Focus',
        sidebarStart: { tab: 'files', folderKind: 'disk', folderPath: 'Archived/Old', onlyFolder: false },
      }),
    )
    act(() => reactRoot!.unmount())
    reactRoot = null
    host?.remove()

    // 3. Explicit appId prop takes precedence
    mockCreate.mockClear()
    const elExplicit = await render(
      <VaultLauncherModal
        root={ROOT}
        appId="deadbeef"
        defaultName="Work"
        initial={{
          id: 'default',
          name: 'Work',
          appPath: '/Applications/Work.app',
          iconPath: '/tmp/w.png',
        }}
        onSaved={vi.fn()}
        onClose={vi.fn()}
      />,
    )
    await act(async () => buttonByText(elExplicit, 'Save app')?.click())
    expect(mockCreate).toHaveBeenCalledWith(expect.objectContaining({ appId: 'deadbeef' }))
  })
})
