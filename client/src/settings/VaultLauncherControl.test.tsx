/**
 * Settings › General › Vault app (YAZ-5967, YAZ-6375):
 * VaultLauncherControl, VaultLauncherModal (Badge/Image/Material/target),
 * SettingsDialog integration, and VaultSwitcher / Welcome launcher icon display.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, type ReactNode } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { DEFAULT_SETTINGS, type VaultLauncherStatus } from '@shared/types'
import { VaultLauncherControl } from './VaultLauncherControl'
import { VaultLauncherModal, vaultInitials } from './VaultLauncherModal'
import { SettingsDialog } from './SettingsDialog'
import { VaultSwitcher } from '../sidebar/VaultSwitcher'
import { Welcome } from '../Welcome'
import { storage } from '../lib/storage'

;(globalThis as unknown as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true

const FAKE_PNG_DATA_URL = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=='
const ROOT = '/Users/yasin/Notes'

let reactRoot: Root | null = null
let host: HTMLElement | null = null

const mockStatus = vi.fn<(root: string) => Promise<VaultLauncherStatus>>()
const mockCreate = vi.fn()
const mockRemove = vi.fn()
const mockReveal = vi.fn()
const mockTest = vi.fn()
const mockIcons = vi.fn()
const mockWorkspaceStatus = vi.fn<(workspaceId: string) => Promise<VaultLauncherStatus>>()
const mockCreateWorkspace = vi.fn()
const mockRemoveWorkspace = vi.fn()
const mockRevealWorkspace = vi.fn()
const mockTestWorkspace = vi.fn()
const mockWorkspaceIcons = vi.fn()

// Stub canvas 2D context in jsdom so Badge/Image PNG export runs cleanly.
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
  ;(globalThis as unknown as Record<string, unknown>).createImageBitmap = vi.fn(async () => ({
    width: 100,
    height: 100,
    close: vi.fn(),
  }))
  // jsdom's Image never fires onload/onerror for relative URLs; trigger onload on src assignment.
  class FakeImage {
    crossOrigin = ''
    onload: (() => void) | null = null
    onerror: (() => void) | null = null
    set src(_value: string) {
      queueMicrotask(() => this.onload?.())
    }
  }
  vi.stubGlobal('Image', FakeImage)

  ;(window as unknown as { yaseenDocs: Record<string, unknown> }).yaseenDocs = {
    vaultLauncher: {
      status: mockStatus,
      create: mockCreate,
      remove: mockRemove,
      reveal: mockReveal,
      test: mockTest,
      icons: mockIcons,
      workspaceStatus: mockWorkspaceStatus,
      createWorkspace: mockCreateWorkspace,
      removeWorkspace: mockRemoveWorkspace,
      revealWorkspace: mockRevealWorkspace,
      testWorkspace: mockTestWorkspace,
      workspaceIcons: mockWorkspaceIcons,
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
  vi.unstubAllGlobals()
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

function setInput(input: HTMLInputElement, value: string): void {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set
  act(() => {
    setter?.call(input, value)
    input.dispatchEvent(new Event('input', { bubbles: true }))
  })
}

function buttonByText(el: HTMLElement, text: string): HTMLButtonElement | undefined {
  return [...el.querySelectorAll('button')].find((b) => b.textContent?.trim() === text)
}

describe('vaultInitials', () => {
  it('computes 1-2 character initials from vault names', () => {
    expect(vaultInitials('Business Wiki')).toBe('BW')
    expect(vaultInitials('Notes')).toBe('NO')
    expect(vaultInitials('my-personal_vault')).toBe('MP')
    expect(vaultInitials('   ')).toBe('YD')
  })
})

describe('VaultLauncherControl', () => {
  it('renders nothing when platform is unsupported (non-macOS)', async () => {
    mockStatus.mockResolvedValue({ supported: false, launcher: null, exists: false, iconDataUrl: null })
    const el = await render(<VaultLauncherControl root={ROOT} defaultName="Notes" />)
    expect(el.textContent).toBe('')
    expect(el.querySelector('.vault-launcher')).toBeNull()
  })

  it('shows "Make a launcher…" when supported and no launcher exists', async () => {
    mockStatus.mockResolvedValue({ supported: true, launcher: null, exists: false, iconDataUrl: null })
    const el = await render(<VaultLauncherControl root={ROOT} defaultName="Notes" />)
    expect(buttonByText(el, 'Make a launcher…')).toBeDefined()
  })

  it('shows active launcher details, target badge, and wires Reveal, Test, and Remove', async () => {
    const onChanged = vi.fn()
    mockStatus.mockResolvedValue({
      supported: true,
      exists: true,
      iconDataUrl: FAKE_PNG_DATA_URL,
      launcher: {
        name: 'My Notes',
        appPath: '/Applications/My Notes.app',
        iconPath: '/tmp/icon.png',
        target: 'inbox',
        badge: { kind: 'emoji', value: '🚀', color: '#007AFF' },
      },
    })
    mockReveal.mockResolvedValue(undefined)
    mockTest.mockResolvedValue(undefined)
    mockRemove.mockResolvedValue(undefined)

    const el = await render(<VaultLauncherControl root={ROOT} defaultName="Notes" onChanged={onChanged} />)

    expect(el.querySelector<HTMLImageElement>('.vault-launcher__icon')?.src).toBe(FAKE_PNG_DATA_URL)
    expect(el.textContent).toContain('My Notes.app')
    expect(el.textContent).toContain('/Applications/My Notes.app')
    expect(el.textContent).toContain('Opens on Cards Inbox')

    await act(async () => buttonByText(el, 'Reveal')?.click())
    expect(mockReveal).toHaveBeenCalledWith(ROOT)

    await act(async () => buttonByText(el, 'Test')?.click())
    expect(mockTest).toHaveBeenCalledWith(ROOT)

    await act(async () => buttonByText(el, 'Remove')?.click())
    expect(mockRemove).toHaveBeenCalledWith(ROOT)
    expect(onChanged).toHaveBeenCalledTimes(1)
    expect(buttonByText(el, 'Make a launcher…')).toBeDefined()
  })

  it('shows removed-in-Finder notice with Recreate and Clear buttons when app bundle is missing', async () => {
    const onChanged = vi.fn()
    mockStatus.mockResolvedValue({
      supported: true,
      exists: false,
      iconDataUrl: FAKE_PNG_DATA_URL,
      launcher: {
        name: 'Notes',
        appPath: '/Applications/Notes.app',
        iconPath: '/tmp/icon.png',
        target: 'today',
        badge: { kind: 'letters', value: 'NO', color: '#34C759' },
      },
    })
    mockRemove.mockResolvedValue(undefined)

    const el = await render(<VaultLauncherControl root={ROOT} defaultName="Notes" onChanged={onChanged} />)

    expect(el.textContent).toContain('Launcher was removed in Finder.')
    expect(buttonByText(el, 'Recreate')).toBeDefined()
    expect(buttonByText(el, 'Clear')).toBeDefined()

    await act(async () => buttonByText(el, 'Clear')?.click())
    expect(mockRemove).toHaveBeenCalledWith(ROOT)
    expect(onChanged).toHaveBeenCalledTimes(1)
    expect(buttonByText(el, 'Make a launcher…')).toBeDefined()
  })

  it('supports Workspace mode: calls workspaceStatus, revealWorkspace, testWorkspace, and removeWorkspace', async () => {
    const onChanged = vi.fn()
    mockWorkspaceStatus.mockResolvedValue({
      supported: true,
      exists: true,
      iconDataUrl: FAKE_PNG_DATA_URL,
      launcher: {
        name: 'Work Suite',
        appPath: '/Applications/Work Suite.app',
        iconPath: '/tmp/ws.png',
        target: 'normal',
        badge: { kind: 'emoji', value: '💼', color: '#007AFF' },
      },
    })
    mockRevealWorkspace.mockResolvedValue(undefined)
    mockTestWorkspace.mockResolvedValue(undefined)
    mockRemoveWorkspace.mockResolvedValue(undefined)

    const el = await render(<VaultLauncherControl workspaceId="ws-1" defaultName="Work Suite" onChanged={onChanged} />)
    expect(mockWorkspaceStatus).toHaveBeenCalledWith('ws-1')
    expect(el.textContent).toContain('Work Suite.app')

    await act(async () => buttonByText(el, 'Reveal')?.click())
    expect(mockRevealWorkspace).toHaveBeenCalledWith('ws-1')

    await act(async () => buttonByText(el, 'Test')?.click())
    expect(mockTestWorkspace).toHaveBeenCalledWith('ws-1')

    await act(async () => buttonByText(el, 'Remove')?.click())
    expect(mockRemoveWorkspace).toHaveBeenCalledWith('ws-1')
    expect(onChanged).toHaveBeenCalledTimes(1)
    expect(buttonByText(el, 'Make a launcher…')).toBeDefined()
  })

  it('renders clear "Vault: <name>" and "Workspace: <name>" target headings in empty, active, and missing states', async () => {
    // Empty vault
    mockStatus.mockResolvedValueOnce({ supported: true, launcher: null, exists: false, iconDataUrl: null })
    let el = await render(<VaultLauncherControl root={ROOT} defaultName="Daily Notes" />)
    expect(el.querySelector('.vault-launcher__target-title')?.textContent).toBe('Vault: Daily Notes')

    // Active vault
    act(() => reactRoot?.unmount())
    host?.remove()
    mockStatus.mockResolvedValueOnce({
      supported: true,
      exists: true,
      iconDataUrl: FAKE_PNG_DATA_URL,
      launcher: { name: 'Daily Notes', appPath: '/Applications/Daily Notes.app', iconPath: '/tmp/dn.png', target: 'today' },
    })
    el = await render(<VaultLauncherControl root={ROOT} defaultName="Daily Notes" />)
    expect(el.querySelector('.vault-launcher__target-title')?.textContent).toBe('Vault: Daily Notes')

    // Missing vault
    act(() => reactRoot?.unmount())
    host?.remove()
    mockStatus.mockResolvedValueOnce({
      supported: true,
      exists: false,
      iconDataUrl: null,
      launcher: { name: 'Daily Notes', appPath: '/Applications/Daily Notes.app', iconPath: '/tmp/dn.png', target: 'today' },
    })
    el = await render(<VaultLauncherControl root={ROOT} defaultName="Daily Notes" />)
    expect(el.querySelector('.vault-launcher__target-title')?.textContent).toBe('Vault: Daily Notes')

    // Empty workspace
    act(() => reactRoot?.unmount())
    host?.remove()
    mockWorkspaceStatus.mockResolvedValueOnce({ supported: true, launcher: null, exists: false, iconDataUrl: null })
    el = await render(<VaultLauncherControl workspaceId="ws-1" defaultName="All Folders" />)
    expect(el.querySelector('.vault-launcher__target-title')?.textContent).toBe('Workspace: All Folders')

    // Active workspace
    act(() => reactRoot?.unmount())
    host?.remove()
    mockWorkspaceStatus.mockResolvedValueOnce({
      supported: true,
      exists: true,
      iconDataUrl: FAKE_PNG_DATA_URL,
      launcher: { name: 'All Folders', appPath: '/Applications/All Folders.app', iconPath: '/tmp/af.png', target: 'normal' },
    })
    el = await render(<VaultLauncherControl workspaceId="ws-1" defaultName="All Folders" />)
    expect(el.querySelector('.vault-launcher__target-title')?.textContent).toBe('Workspace: All Folders')

    // Missing workspace
    act(() => reactRoot?.unmount())
    host?.remove()
    mockWorkspaceStatus.mockResolvedValueOnce({
      supported: true,
      exists: false,
      iconDataUrl: null,
      launcher: { name: 'All Folders', appPath: '/Applications/All Folders.app', iconPath: '/tmp/af.png', target: 'normal' },
    })
    el = await render(<VaultLauncherControl workspaceId="ws-1" defaultName="All Folders" />)
    expect(el.querySelector('.vault-launcher__target-title')?.textContent).toBe('Workspace: All Folders')
  })
})

describe('VaultLauncherModal', () => {
  it('supports Badge modes (Emoji, Letters, Icon), target selection, live preview, and saves via IPC', async () => {
    const savedStatus: VaultLauncherStatus = {
      supported: true,
      exists: true,
      iconDataUrl: FAKE_PNG_DATA_URL,
      launcher: {
        name: 'Work Vault',
        appPath: '/Applications/Work Vault.app',
        iconPath: '/tmp/work.png',
        target: 'today',
        badge: { kind: 'emoji', value: '🚀', color: '#5856D6' },
      },
    }
    mockCreate.mockResolvedValue(savedStatus)
    const onSaved = vi.fn()
    const onClose = vi.fn()

    const el = await render(
      <VaultLauncherModal root={ROOT} defaultName="Notes" onSaved={onSaved} onClose={onClose} />,
    )

    // Update name
    const nameInput = el.querySelector<HTMLInputElement>('input[aria-label="App name"]')!
    setInput(nameInput, 'Work Vault')
    expect(el.querySelector('.vault-launcher-modal__alfred-name')?.textContent).toBe('Work Vault.app')

    // Select Today's Daily Page target
    await act(async () => buttonByText(el, "Today's Daily Page")?.click())
    expect(el.querySelector('.vault-launcher-modal__alfred-sub')?.textContent).toBe("Opens Today's Daily Page")

    // Pick Indigo colour
    const indigoSwatch = el.querySelector<HTMLButtonElement>('button[aria-label="Indigo"]')!
    await act(async () => indigoSwatch.click())

    // Switch to Emoji mode and pick 🚀
    await act(async () => buttonByText(el, 'Emoji')?.click())
    await act(async () => buttonByText(el, '🚀')?.click())

    // Submit
    await act(async () => buttonByText(el, 'Create launcher')?.click())
    expect(mockCreate).toHaveBeenCalledWith({
      root: ROOT,
      name: 'Work Vault',
      pngBase64: FAKE_PNG_DATA_URL.replace(/^data:image\/png;base64,/, ''),
      target: 'today',
      badge: { kind: 'emoji', value: '🚀', color: '#5856D6' },
    })
    expect(onSaved).toHaveBeenCalledWith(savedStatus)
  })

  it('shows an error banner if launcher creation fails (e.g., collision with an existing Mac app)', async () => {
    mockCreate.mockRejectedValue(new Error('An app named "Safari.app" already exists in /Applications.'))
    const onSaved = vi.fn()
    const onClose = vi.fn()

    const el = await render(
      <VaultLauncherModal root={ROOT} defaultName="Safari" onSaved={onSaved} onClose={onClose} />,
    )

    await act(async () => buttonByText(el, 'Create launcher')?.click())
    expect(el.querySelector('.vault-launcher-modal__error-banner')?.textContent).toContain('Safari.app')
    expect(onSaved).not.toHaveBeenCalled()
  })

  it('supports Image tab upload and submits cropped PNG without badge metadata', async () => {
    const savedStatus: VaultLauncherStatus = {
      supported: true,
      exists: true,
      iconDataUrl: FAKE_PNG_DATA_URL,
      launcher: {
        name: 'Notes',
        appPath: '/Applications/Notes.app',
        iconPath: '/tmp/notes.png',
        target: 'normal',
      },
    }
    mockCreate.mockResolvedValue(savedStatus)
    const onSaved = vi.fn()

    const el = await render(
      <VaultLauncherModal root={ROOT} defaultName="Notes" onSaved={onSaved} onClose={vi.fn()} />,
    )

    await act(async () => buttonByText(el, 'Image')?.click())
    // Submit disabled until an image is chosen
    expect(buttonByText(el, 'Create launcher')?.disabled).toBe(true)

    const fileInput = el.querySelector<HTMLInputElement>('input[aria-label="Choose launcher image"]')!
    const file = new File([new Uint8Array([1, 2, 3])], 'icon.png', { type: 'image/png' })
    Object.defineProperty(fileInput, 'files', { value: [file], configurable: true })
    await act(async () => {
      fileInput.dispatchEvent(new Event('change', { bubbles: true }))
    })

    expect(buttonByText(el, 'Create launcher')?.disabled).toBe(false)
    await act(async () => buttonByText(el, 'Create launcher')?.click())
    expect(mockCreate).toHaveBeenCalledWith({
      root: ROOT,
      name: 'Notes',
      pngBase64: FAKE_PNG_DATA_URL.replace(/^data:image\/png;base64,/, ''),
      target: 'normal',
    })
    expect(onSaved).toHaveBeenCalledWith(savedStatus)
  })

  it('supports Badge Material icon mode and Escape closes the modal without propagating', async () => {
    const savedStatus: VaultLauncherStatus = {
      supported: true,
      exists: true,
      iconDataUrl: FAKE_PNG_DATA_URL,
      launcher: {
        name: 'Notes',
        appPath: '/Applications/Notes.app',
        iconPath: '/tmp/notes.png',
        target: 'normal',
        badge: { kind: 'material', value: 'folder-docs', color: '#007AFF' },
      },
    }
    mockCreate.mockResolvedValue(savedStatus)
    const onSaved = vi.fn()
    const onClose = vi.fn()

    const el = await render(
      <VaultLauncherModal root={ROOT} defaultName="Notes" onSaved={onSaved} onClose={onClose} />,
    )

    await act(async () => buttonByText(el, 'Icon')?.click())
    const searchInput = el.querySelector<HTMLInputElement>('input[aria-label="Search Material icons"]')!
    expect(searchInput).not.toBeNull()

    await act(async () => buttonByText(el, 'Create launcher')?.click())
    expect(mockCreate).toHaveBeenCalledWith({
      root: ROOT,
      name: 'Notes',
      pngBase64: FAKE_PNG_DATA_URL.replace(/^data:image\/png;base64,/, ''),
      target: 'normal',
      badge: { kind: 'material', value: 'folder-docs', color: '#007AFF' },
    })
    expect(onSaved).toHaveBeenCalledWith(savedStatus)

    const overlay = el.querySelector<HTMLElement>('.vault-launcher-overlay')!
    await act(async () => {
      overlay.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    })
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('supports Workspace mode: hides Open on row, uses workspace title/subtitle, and calls createWorkspace', async () => {
    const savedStatus: VaultLauncherStatus = {
      supported: true,
      exists: true,
      iconDataUrl: FAKE_PNG_DATA_URL,
      launcher: {
        name: 'Work Suite',
        appPath: '/Applications/Work Suite.app',
        iconPath: '/tmp/ws.png',
        target: 'normal',
        badge: { kind: 'letters', value: 'WS', color: '#007AFF' },
      },
    }
    mockCreateWorkspace.mockResolvedValue(savedStatus)
    const onSaved = vi.fn()

    const el = await render(
      <VaultLauncherModal workspaceId="ws-1" defaultName="Work Suite" onSaved={onSaved} onClose={vi.fn()} />,
    )

    expect(el.querySelector('#vault-launcher-modal-title')?.textContent).toBe('Create workspace launcher')
    expect(el.querySelector('[aria-label="Open on"]')).toBeNull()
    expect(el.querySelector('.vault-launcher-modal__alfred-sub')?.textContent).toBe('Opens all vaults in workspace')

    await act(async () => buttonByText(el, 'Create launcher')?.click())
    expect(mockCreateWorkspace).toHaveBeenCalledWith({
      workspaceId: 'ws-1',
      name: 'Work Suite',
      pngBase64: FAKE_PNG_DATA_URL.replace(/^data:image\/png;base64,/, ''),
      badge: { kind: 'letters', value: 'WS', color: '#007AFF' },
    })
    expect(mockCreate).not.toHaveBeenCalled()
    expect(onSaved).toHaveBeenCalledWith(savedStatus)
  })
})

describe('SettingsDialog › General › Vault app', () => {
  it('shows the Vault app group when vaultLauncher context is provided', async () => {
    mockStatus.mockResolvedValue({ supported: true, launcher: null, exists: false, iconDataUrl: null })
    const el = await render(
      <SettingsDialog
        ctx={{
          settings: DEFAULT_SETTINGS,
          onChange: vi.fn(),
          vaultLauncher: { root: ROOT, defaultName: 'Notes' },
        }}
        onClose={vi.fn()}
      />,
    )
    const titles = [...el.querySelectorAll('.settings-group__title')].map((h) => h.textContent)
    expect(titles).toContain('Vault app')
  })

  it('shows the Workspace launcher row when workspaceLauncher context is provided', async () => {
    mockStatus.mockResolvedValue({ supported: true, launcher: null, exists: false, iconDataUrl: null })
    mockWorkspaceStatus.mockResolvedValue({ supported: true, launcher: null, exists: false, iconDataUrl: null })
    const el = await render(
      <SettingsDialog
        ctx={{
          settings: DEFAULT_SETTINGS,
          onChange: vi.fn(),
          vaultLauncher: { root: ROOT, defaultName: 'Notes' },
          workspaceLauncher: { workspaceId: 'ws-1', defaultName: 'Work Suite' },
        }}
        onClose={vi.fn()}
      />,
    )
    expect(el.textContent).toContain('Workspace launcher')
    expect(mockWorkspaceStatus).toHaveBeenCalledWith('ws-1')
  })
})

describe('VaultSwitcher & Welcome launcher icons', () => {
  it('renders launcher icon in VaultSwitcher trigger and rows when vaultIcons has an entry', async () => {
    vi.spyOn(storage, 'vaultName').mockImplementation((p) => (p === ROOT ? 'Notes' : 'Work'))
    vi.spyOn(storage, 'listVaults').mockReturnValue([
      { path: ROOT, name: 'Notes', lastUsed: Date.now(), open: true, key: null },
      { path: '/Users/yasin/Work', name: 'Work', lastUsed: Date.now() - 1000, open: false, key: null },
    ])
    vi.spyOn(storage, 'getVaultSets').mockReturnValue([])

    const el = await render(
      <VaultSwitcher
        roots={[ROOT]}
        onPickFolder={vi.fn()}
        pickDisabled={false}
        openRequest={0}
        onOpenHere={vi.fn(async () => true)}
        onAddHere={vi.fn(async () => true)}
        onReveal={vi.fn()}
        onOpenVsCode={vi.fn()}
        onNotice={vi.fn()}
        hotkeys={{}}
        vaultIcons={{ [ROOT]: FAKE_PNG_DATA_URL }}
      />,
    )

    // Header trigger shows launcher icon
    const headerIcon = el.querySelector<HTMLImageElement>('.sidebar__root-icon')
    expect(headerIcon?.src).toBe(FAKE_PNG_DATA_URL)

    // Open dropdown panel and check rows
    await act(async () => el.querySelector<HTMLButtonElement>('.sidebar__root')?.click())
    const rowIcons = [...document.body.querySelectorAll<HTMLImageElement>('.vault-switcher__icon')]
    expect(rowIcons).toHaveLength(1)
    expect(rowIcons[0].src).toBe(FAKE_PNG_DATA_URL)
  })

  it('renders launcher icon in Welcome recent vaults list when vaultIcons has an entry', async () => {
    vi.spyOn(storage, 'vaultName').mockImplementation((p) => (p === ROOT ? 'Notes' : 'Work'))
    vi.spyOn(storage, 'getVaultSets').mockReturnValue([])

    const el = await render(
      <Welcome
        recents={[
          { path: ROOT, lastOpened: Date.now() },
          { path: '/Users/yasin/Work', lastOpened: Date.now() - 1000 },
        ]}
        sets={[]}
        vaultIcons={{ [ROOT]: FAKE_PNG_DATA_URL }}
        onOpenRecent={vi.fn(async () => true)}
        onOpenSet={vi.fn(async () => true)}
        onPickFolder={vi.fn()}
        picking={false}
        onNotice={vi.fn()}
      />,
    )

    const icons = [...el.querySelectorAll<HTMLImageElement>('.welcome__vault-icon')]
    expect(icons).toHaveLength(1)
    expect(icons[0].src).toBe(FAKE_PNG_DATA_URL)
  })
})
