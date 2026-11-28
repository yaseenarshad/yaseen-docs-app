/**
 * Cross-window launcher icon sync hook (YAZ-6448 Decision 4).
 * Verifies initial icon fetch, refresh on `vaultLauncher.onChanged`, and cleanup on unmount.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import type { VaultAppSummary } from '@shared/types'
import { useVaultLauncherIcons } from './useVaultLauncherIcons'

;(globalThis as unknown as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true

const ICON_A = 'data:image/png;base64,AAA'
const ICON_B = 'data:image/png;base64,BBB'
const WS_ICON_1 = 'data:image/png;base64,WS1'
const WS_ICON_2 = 'data:image/png;base64,WS2'
const APPS_1: Record<string, VaultAppSummary[]> = { '/vaults/a': [{ id: 'default', name: 'Vault A' }] }
const APPS_2: Record<string, VaultAppSummary[]> = {
  '/vaults/a': [
    { id: 'default', name: 'Vault A' },
    { id: 'a1b2c3d4', name: 'Vault A Favorites', sidebarStart: { tab: 'favorites', onlyFolder: true } },
  ],
}

let reactRoot: Root | null = null
let host: HTMLElement | null = null

let mockIcons: ReturnType<typeof vi.fn<() => Promise<Record<string, string>>>>
let mockWorkspaceIcons: ReturnType<typeof vi.fn<() => Promise<Record<string, string>>>>
let mockVaultApps: ReturnType<typeof vi.fn<() => Promise<Record<string, VaultAppSummary[]>>>>
let mockOnChanged: ReturnType<typeof vi.fn<(listener: () => void) => () => void>>
let unsubscribe: ReturnType<typeof vi.fn<() => void>>
let changeListeners: Set<() => void>

function Harness({ onValue }: { onValue: (val: ReturnType<typeof useVaultLauncherIcons>) => void }) {
  const val = useVaultLauncherIcons()
  onValue(val)
  return null
}

beforeEach(() => {
  changeListeners = new Set()
  unsubscribe = vi.fn()
  mockIcons = vi.fn(async () => ({ '/vaults/a': ICON_A }))
  mockWorkspaceIcons = vi.fn(async () => ({ 'ws-1': WS_ICON_1 }))
  mockVaultApps = vi.fn(async () => APPS_1)
  mockOnChanged = vi.fn((listener: () => void) => {
    changeListeners.add(listener)
    return () => {
      changeListeners.delete(listener)
      unsubscribe()
    }
  })

  ;(window as unknown as { yaseenDocs: Record<string, unknown> }).yaseenDocs = {
    vaultLauncher: {
      icons: mockIcons,
      workspaceIcons: mockWorkspaceIcons,
      vaultApps: mockVaultApps,
      onChanged: mockOnChanged,
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

describe('useVaultLauncherIcons', () => {
  it('fetches icons and vaultApps on mount, re-fetches on onChanged, and unsubscribes on unmount', async () => {
    let latest: ReturnType<typeof useVaultLauncherIcons> | null = null
    host = document.createElement('div')
    document.body.appendChild(host)
    reactRoot = createRoot(host)

    await act(async () => {
      reactRoot?.render(<Harness onValue={(v) => { latest = v }} />)
    })

    expect(mockIcons).toHaveBeenCalledTimes(1)
    expect(mockWorkspaceIcons).toHaveBeenCalledTimes(1)
    expect(mockVaultApps).toHaveBeenCalledTimes(1)
    expect(mockOnChanged).toHaveBeenCalledTimes(1)
    expect(latest!.launcherIcons).toEqual({ '/vaults/a': ICON_A })
    expect(latest!.workspaceIcons).toEqual({ 'ws-1': WS_ICON_1 })
    expect(latest!.vaultApps).toEqual(APPS_1)

    // Simulate another window creating/editing/removing an app.
    mockIcons.mockResolvedValueOnce({ '/vaults/a': ICON_A, '/vaults/b': ICON_B })
    mockWorkspaceIcons.mockResolvedValueOnce({ 'ws-1': WS_ICON_2 })
    mockVaultApps.mockResolvedValueOnce(APPS_2)

    await act(async () => {
      for (const listener of [...changeListeners]) listener()
    })

    expect(mockIcons).toHaveBeenCalledTimes(2)
    expect(mockWorkspaceIcons).toHaveBeenCalledTimes(2)
    expect(mockVaultApps).toHaveBeenCalledTimes(2)
    expect(latest!.launcherIcons).toEqual({ '/vaults/a': ICON_A, '/vaults/b': ICON_B })
    expect(latest!.workspaceIcons).toEqual({ 'ws-1': WS_ICON_2 })
    expect(latest!.vaultApps).toEqual(APPS_2)

    // Unmount cleans up the IPC listener.
    expect(unsubscribe).not.toHaveBeenCalled()
    act(() => {
      reactRoot?.unmount()
      reactRoot = null
    })
    expect(unsubscribe).toHaveBeenCalledTimes(1)
    expect(changeListeners.size).toBe(0)
  })

  it('works without throwing when onChanged and vaultApps are absent on the bridge', async () => {
    ;(window as unknown as { yaseenDocs: Record<string, unknown> }).yaseenDocs = {
      vaultLauncher: {
        icons: mockIcons,
        workspaceIcons: mockWorkspaceIcons,
      },
    }

    let latest: ReturnType<typeof useVaultLauncherIcons> | null = null
    host = document.createElement('div')
    document.body.appendChild(host)
    reactRoot = createRoot(host)

    await act(async () => {
      reactRoot?.render(<Harness onValue={(v) => { latest = v }} />)
    })

    expect(mockIcons).toHaveBeenCalledTimes(1)
    expect(mockWorkspaceIcons).toHaveBeenCalledTimes(1)
    expect(latest!.launcherIcons).toEqual({ '/vaults/a': ICON_A })
    expect(latest!.workspaceIcons).toEqual({ 'ws-1': WS_ICON_1 })
    expect(latest!.vaultApps).toEqual({})
  })
})
