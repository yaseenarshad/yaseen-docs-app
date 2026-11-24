/**
 * Settings › General › Vault app › All launchers (YAZ-6448 Decision 6):
 * empty state, vault/workspace/missing/orphan rendering, actions, onChanged sync,
 * Edit/Recreate modal integration, error handling, and SettingsDialog availability.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, type ReactNode } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { DEFAULT_SETTINGS, type LauncherListItem, type VaultLauncherStatus } from '@shared/types'
import { AllLaunchersList } from './AllLaunchersList'
import { SettingsDialog } from './SettingsDialog'

;(globalThis as unknown as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true

const FAKE_PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=='

let reactRoot: Root | null = null
let host: HTMLElement | null = null

const mockListAll = vi.fn<() => Promise<LauncherListItem[]>>()
const mockRemoveOrphan = vi.fn<(appPath: string) => Promise<void>>()
const mockStatus = vi.fn<(root: string) => Promise<VaultLauncherStatus>>()
const mockCreate = vi.fn()
const mockRemove = vi.fn<(root: string) => Promise<void>>()
const mockReveal = vi.fn<(root: string) => Promise<void>>()
const mockTest = vi.fn<(root: string) => Promise<void>>()
const mockWorkspaceStatus = vi.fn<(workspaceId: string) => Promise<VaultLauncherStatus>>()
const mockCreateWorkspace = vi.fn()
const mockRemoveWorkspace = vi.fn<(workspaceId: string) => Promise<void>>()
const mockRevealWorkspace = vi.fn<(workspaceId: string) => Promise<void>>()
const mockTestWorkspace = vi.fn<(workspaceId: string) => Promise<void>>()
const mockShellReveal = vi.fn<(req: { path: string }) => Promise<{ path: string }>>()
let unsubscribe = vi.fn()
let changeListeners = new Set<() => void>()
const mockOnChanged = vi.fn<(listener: () => void) => () => void>()

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
  changeListeners = new Set()
  unsubscribe = vi.fn()
  mockOnChanged.mockImplementation((listener) => {
    changeListeners.add(listener)
    return () => {
      changeListeners.delete(listener)
      unsubscribe()
    }
  })

  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(fakeCtx as unknown as CanvasRenderingContext2D)
  vi.spyOn(HTMLCanvasElement.prototype, 'toDataURL').mockReturnValue(FAKE_PNG)

  ;(window as unknown as { yaseenDocs: Record<string, unknown> }).yaseenDocs = {
    vaultLauncher: {
      listAll: mockListAll,
      removeOrphan: mockRemoveOrphan,
      status: mockStatus,
      create: mockCreate,
      remove: mockRemove,
      reveal: mockReveal,
      test: mockTest,
      workspaceStatus: mockWorkspaceStatus,
      createWorkspace: mockCreateWorkspace,
      removeWorkspace: mockRemoveWorkspace,
      revealWorkspace: mockRevealWorkspace,
      testWorkspace: mockTestWorkspace,
      onChanged: mockOnChanged,
    },
    shell: {
      reveal: mockShellReveal,
    },
    app: {
      home: vi.fn(async () => '/Users/yasin'),
    },
    state: {
      systemHotkeys: vi.fn(async () => []),
      settingsFolder: vi.fn(async () => ({ folder: null, missing: false })),
    },
  }
})

afterEach(() => {
  act(() => reactRoot?.unmount())
  host?.remove()
  reactRoot = null
  host = null
  vi.restoreAllMocks()
})

async function render(node: ReactNode): Promise<HTMLElement> {
  host = document.createElement('div')
  document.body.appendChild(host)
  reactRoot = createRoot(host)
  await act(async () => {
    reactRoot?.render(node)
  })
  return host
}

function buttonIn(el: Element, text: string): HTMLButtonElement | undefined {
  return [...el.querySelectorAll('button')].find((b) => b.textContent?.trim() === text)
}

const VAULT_ITEM: LauncherListItem = {
  kind: 'vault',
  id: '/Users/yasin/Notes',
  name: 'Daily Note Vault',
  appPath: '/Applications/Daily Note Vault.app',
  exists: true,
  iconDataUrl: FAKE_PNG,
  targetName: 'Notes',
  target: 'today',
}

const WORKSPACE_ITEM: LauncherListItem = {
  kind: 'workspace',
  id: 'ws-all',
  name: 'All Folders',
  appPath: '/Applications/All Folders.app',
  exists: true,
  iconDataUrl: FAKE_PNG,
  targetName: 'All Folders',
}

const MISSING_ITEM: LauncherListItem = {
  kind: 'vault',
  id: '/Users/yasin/Archive',
  name: 'Archive Vault',
  appPath: '/Applications/Archive Vault.app',
  exists: false,
  iconDataUrl: null,
  targetName: 'Archive',
  target: 'inbox',
}

const ORPHAN_ITEM: LauncherListItem = {
  kind: 'orphan',
  id: '/Applications/Work Demo.app',
  name: 'Work Demo',
  appPath: '/Applications/Work Demo.app',
  exists: true,
  iconDataUrl: null,
  targetName: '/Users/yasin/WorkDemo',
  vaultPath: '/Users/yasin/WorkDemo',
}

describe('AllLaunchersList', () => {
  it('renders clean empty state when no launchers exist', async () => {
    mockListAll.mockResolvedValue([])
    const el = await render(<AllLaunchersList />)
    expect(mockListAll).toHaveBeenCalledTimes(1)
    expect(el.textContent).toContain('No launchers created yet.')
    expect(el.querySelector('.all-launchers__list')).toBeNull()
  })

  it('renders vault, workspace, missing-in-Finder, and orphan items with badges and paths', async () => {
    mockListAll.mockResolvedValue([VAULT_ITEM, WORKSPACE_ITEM, MISSING_ITEM, ORPHAN_ITEM])
    const el = await render(<AllLaunchersList />)

    const rows = [...el.querySelectorAll('.all-launchers__item')]
    expect(rows).toHaveLength(4)

    // Registered vault with Today badge and icon
    expect(rows[0].textContent).toContain('Daily Note Vault.app')
    expect(rows[0].querySelector('.all-launchers__badge--vault')?.textContent).toBe('Vault')
    expect(rows[0].querySelector('.all-launchers__badge--target')?.textContent).toBe('Today')
    expect(rows[0].textContent).toContain('/Applications/Daily Note Vault.app')
    expect(rows[0].textContent).toContain('Notes · /Users/yasin/Notes')
    expect(rows[0].querySelector<HTMLImageElement>('.all-launchers__icon')?.src).toBe(FAKE_PNG)
    expect(buttonIn(rows[0], 'Edit…')).toBeDefined()
    expect(buttonIn(rows[0], 'Reveal')).toBeDefined()
    expect(buttonIn(rows[0], 'Test')).toBeDefined()
    expect(buttonIn(rows[0], 'Remove')).toBeDefined()

    // Registered workspace
    expect(rows[1].textContent).toContain('All Folders.app')
    expect(rows[1].querySelector('.all-launchers__badge--workspace')?.textContent).toBe('Workspace')
    expect(rows[1].textContent).toContain('/Applications/All Folders.app')
    expect(buttonIn(rows[1], 'Edit…')).toBeDefined()
    expect(buttonIn(rows[1], 'Reveal')).toBeDefined()
    expect(buttonIn(rows[1], 'Test')).toBeDefined()
    expect(buttonIn(rows[1], 'Remove')).toBeDefined()

    // Missing in Finder vault with Cards Inbox badge and fallback glyph
    expect(rows[2].textContent).toContain('Archive Vault.app')
    expect(rows[2].querySelector('.all-launchers__badge--vault')?.textContent).toBe('Vault')
    expect(rows[2].querySelector('.all-launchers__badge--target')?.textContent).toBe('Cards Inbox')
    expect(rows[2].querySelector('.all-launchers__missing-note')?.textContent).toBe('Missing in Finder')
    expect(rows[2].querySelector('.all-launchers__icon-fallback')).not.toBeNull()
    expect(buttonIn(rows[2], 'Recreate')).toBeDefined()
    expect(buttonIn(rows[2], 'Clear')).toBeDefined()
    expect(buttonIn(rows[2], 'Test')).toBeUndefined()

    // Orphaned .app bundle
    expect(rows[3].textContent).toContain('Work Demo.app')
    expect(rows[3].querySelector('.all-launchers__badge--orphan')?.textContent).toBe('Orphaned')
    expect(rows[3].querySelector('.all-launchers__icon-fallback--orphan')).not.toBeNull()
    expect(rows[3].textContent).toContain('/Applications/Work Demo.app')
    expect(rows[3].textContent).toContain('/Users/yasin/WorkDemo')
    expect(buttonIn(rows[3], 'Reveal')).toBeDefined()
    expect(buttonIn(rows[3], 'Remove')).toBeDefined()
    expect(buttonIn(rows[3], 'Edit…')).toBeUndefined()
    expect(buttonIn(rows[3], 'Test')).toBeUndefined()
  })

  it('reveals and removes an orphan via shell.reveal and removeOrphan and refreshes', async () => {
    const onChanged = vi.fn()
    mockListAll.mockResolvedValueOnce([ORPHAN_ITEM]).mockResolvedValueOnce([])
    mockShellReveal.mockResolvedValue({ path: ORPHAN_ITEM.appPath })
    mockRemoveOrphan.mockResolvedValue(undefined)

    const el = await render(<AllLaunchersList onChanged={onChanged} />)
    const row = el.querySelector('.all-launchers__item')!

    await act(async () => buttonIn(row, 'Reveal')?.click())
    expect(mockShellReveal).toHaveBeenCalledWith({ path: ORPHAN_ITEM.appPath })

    await act(async () => buttonIn(row, 'Remove')?.click())
    expect(mockRemoveOrphan).toHaveBeenCalledWith(ORPHAN_ITEM.appPath)
    expect(mockListAll).toHaveBeenCalledTimes(2)
    expect(onChanged).toHaveBeenCalledTimes(1)
    expect(el.textContent).toContain('No launchers created yet.')
  })

  it('wires Reveal, Test, Remove, and Clear for vault and workspace launchers', async () => {
    const onChanged = vi.fn()
    mockListAll
      .mockResolvedValueOnce([VAULT_ITEM, WORKSPACE_ITEM, MISSING_ITEM])
      .mockResolvedValueOnce([WORKSPACE_ITEM, MISSING_ITEM])
      .mockResolvedValueOnce([MISSING_ITEM])
      .mockResolvedValueOnce([])
    mockReveal.mockResolvedValue(undefined)
    mockTest.mockResolvedValue(undefined)
    mockRemove.mockResolvedValue(undefined)
    mockRevealWorkspace.mockResolvedValue(undefined)
    mockTestWorkspace.mockResolvedValue(undefined)
    mockRemoveWorkspace.mockResolvedValue(undefined)

    const el = await render(<AllLaunchersList onChanged={onChanged} />)
    let rows = [...el.querySelectorAll('.all-launchers__item')]

    await act(async () => buttonIn(rows[0], 'Reveal')?.click())
    expect(mockReveal).toHaveBeenCalledWith(VAULT_ITEM.id)

    await act(async () => buttonIn(rows[0], 'Test')?.click())
    expect(mockTest).toHaveBeenCalledWith(VAULT_ITEM.id)

    await act(async () => buttonIn(rows[1], 'Reveal')?.click())
    expect(mockRevealWorkspace).toHaveBeenCalledWith(WORKSPACE_ITEM.id)

    await act(async () => buttonIn(rows[1], 'Test')?.click())
    expect(mockTestWorkspace).toHaveBeenCalledWith(WORKSPACE_ITEM.id)

    // Remove vault launcher
    await act(async () => buttonIn(rows[0], 'Remove')?.click())
    expect(mockRemove).toHaveBeenCalledWith(VAULT_ITEM.id)
    expect(onChanged).toHaveBeenCalledTimes(1)

    // Remove workspace launcher
    rows = [...el.querySelectorAll('.all-launchers__item')]
    await act(async () => buttonIn(rows[0], 'Remove')?.click())
    expect(mockRemoveWorkspace).toHaveBeenCalledWith(WORKSPACE_ITEM.id)
    expect(onChanged).toHaveBeenCalledTimes(2)

    // Clear missing vault launcher
    rows = [...el.querySelectorAll('.all-launchers__item')]
    await act(async () => buttonIn(rows[0], 'Clear')?.click())
    expect(mockRemove).toHaveBeenCalledWith(MISSING_ITEM.id)
    expect(onChanged).toHaveBeenCalledTimes(3)
    expect(el.textContent).toContain('No launchers created yet.')
  })

  it('refreshes automatically when vaultLauncher.onChanged fires and unsubscribes on unmount', async () => {
    mockListAll.mockResolvedValueOnce([]).mockResolvedValueOnce([VAULT_ITEM])

    const el = await render(<AllLaunchersList />)
    expect(mockOnChanged).toHaveBeenCalledTimes(1)
    expect(el.textContent).toContain('No launchers created yet.')

    await act(async () => {
      for (const listener of [...changeListeners]) listener()
    })

    expect(mockListAll).toHaveBeenCalledTimes(2)
    expect(el.textContent).toContain('Daily Note Vault.app')

    expect(unsubscribe).not.toHaveBeenCalled()
    act(() => {
      reactRoot?.unmount()
      reactRoot = null
    })
    expect(unsubscribe).toHaveBeenCalledTimes(1)
    expect(changeListeners.size).toBe(0)
  })

  it('opens VaultLauncherModal prefilled on Edit… and Recreate', async () => {
    mockListAll.mockResolvedValue([VAULT_ITEM, WORKSPACE_ITEM, MISSING_ITEM])
    mockStatus
      .mockResolvedValueOnce({
        supported: true,
        exists: true,
        iconDataUrl: FAKE_PNG,
        launcher: {
          name: 'Daily Note Vault',
          appPath: '/Applications/Daily Note Vault.app',
          iconPath: '/tmp/daily.png',
          target: 'today',
          badge: { kind: 'emoji', value: '📅', color: '#007AFF' },
        },
      })
      .mockResolvedValueOnce({
        supported: true,
        exists: false,
        iconDataUrl: null,
        launcher: {
          name: 'Archive Vault',
          appPath: '/Applications/Archive Vault.app',
          iconPath: '/tmp/archive.png',
          target: 'inbox',
          badge: { kind: 'letters', value: 'AV', color: '#34C759' },
        },
      })
    mockWorkspaceStatus.mockResolvedValueOnce({
      supported: true,
      exists: true,
      iconDataUrl: FAKE_PNG,
      launcher: {
        name: 'All Folders',
        appPath: '/Applications/All Folders.app',
        iconPath: '/tmp/all.png',
        target: 'normal',
        badge: { kind: 'letters', value: 'AF', color: '#5856D6' },
      },
    })

    const el = await render(<AllLaunchersList />)
    const rows = [...el.querySelectorAll('.all-launchers__item')]

    // Preload the lazy modal module so React.lazy resolves cleanly inside act().
    await import('./VaultLauncherModal')

    await act(async () => {
      buttonIn(rows[0], 'Edit…')?.click()
    })
    await act(async () => {
      await Promise.resolve()
    })

    expect(mockStatus).toHaveBeenCalledWith(VAULT_ITEM.id)
    expect(el.querySelector('#vault-launcher-modal-title')?.textContent).toBe('Edit vault launcher')
    expect(el.querySelector<HTMLInputElement>('input[aria-label="App name"]')?.value).toBe('Daily Note Vault')

    // Close edit modal
    await act(async () => el.querySelector<HTMLButtonElement>('.vault-launcher-modal__close')?.click())
    expect(el.querySelector('.vault-launcher-modal')).toBeNull()

    // Open Edit modal for workspace item
    await act(async () => {
      buttonIn(rows[1], 'Edit…')?.click()
    })
    await act(async () => {
      await Promise.resolve()
    })
    expect(mockWorkspaceStatus).toHaveBeenCalledWith(WORKSPACE_ITEM.id)
    expect(el.querySelector('#vault-launcher-modal-title')?.textContent).toBe('Edit workspace launcher')

    await act(async () => el.querySelector<HTMLButtonElement>('.vault-launcher-modal__close')?.click())
    expect(el.querySelector('.vault-launcher-modal')).toBeNull()

    // Open Recreate modal for missing item
    await act(async () => {
      buttonIn(rows[2], 'Recreate')?.click()
    })
    await act(async () => {
      await Promise.resolve()
    })
    expect(mockStatus).toHaveBeenCalledWith(MISSING_ITEM.id)
    expect(el.querySelector('#vault-launcher-modal-title')?.textContent).toBe('Recreate vault launcher')
  })

  it('shows inline role="alert" error and disables buttons while busy', async () => {
    mockListAll.mockResolvedValue([ORPHAN_ITEM])
    let rejectRemove!: (err: Error) => void
    mockRemoveOrphan.mockImplementation(
      () =>
        new Promise<void>((_, reject) => {
          rejectRemove = reject
        }),
    )

    const el = await render(<AllLaunchersList />)
    const row = el.querySelector('.all-launchers__item')!
    const removeBtn = buttonIn(row, 'Remove')!
    const revealBtn = buttonIn(row, 'Reveal')!

    act(() => {
      removeBtn.click()
    })
    expect(removeBtn.disabled).toBe(true)
    expect(revealBtn.disabled).toBe(true)

    await act(async () => {
      rejectRemove(new Error('Refusing to remove third-party app'))
    })

    expect(removeBtn.disabled).toBe(false)
    expect(el.querySelector('[role="alert"]')?.textContent).toContain('Refusing to remove third-party app')
  })

  it('appears in SettingsDialog › General › Vault app on macOS and stays hidden on non-macOS', async () => {
    mockListAll.mockResolvedValue([ORPHAN_ITEM])
    const origPlatform = Object.getOwnPropertyDescriptor(Navigator.prototype, 'platform')
    Object.defineProperty(navigator, 'platform', { value: 'MacIntel', configurable: true })

    try {
      const macEl = await render(
        <SettingsDialog
          ctx={{ settings: DEFAULT_SETTINGS, onChange: vi.fn() }}
          onClose={vi.fn()}
        />,
      )
      await act(async () => {
        await Promise.resolve()
      })
      expect(macEl.textContent).toContain('All launchers')
      expect(macEl.textContent).toContain('Work Demo.app')

      // Switch to non-macOS and re-render
      act(() => reactRoot?.unmount())
      host?.remove()
      Object.defineProperty(navigator, 'platform', { value: 'Win32', configurable: true })

      const winEl = await render(
        <SettingsDialog
          ctx={{ settings: DEFAULT_SETTINGS, onChange: vi.fn() }}
          onClose={vi.fn()}
        />,
      )
      expect(winEl.textContent).not.toContain('All launchers')
    } finally {
      if (origPlatform) Object.defineProperty(Navigator.prototype, 'platform', origPlatform)
    }
  })
})
