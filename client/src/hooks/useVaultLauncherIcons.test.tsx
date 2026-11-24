/**
 * Cross-window launcher icon sync hook (YAZ-6448 Decision 4).
 * Verifies initial icon fetch, refresh on `vaultLauncher.onChanged`, and cleanup on unmount.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { useVaultLauncherIcons } from './useVaultLauncherIcons'

;(globalThis as unknown as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true

const ICON_A = 'data:image/png;base64,AAA'
const ICON_B = 'data:image/png;base64,BBB'
const WS_ICON_1 = 'data:image/png;base64,WS1'
const WS_ICON_2 = 'data:image/png;base64,WS2'

let reactRoot: Root | null = null
let host: HTMLElement | null = null

let mockIcons: ReturnType<typeof vi.fn<() => Promise<Record<string, string>>>>
let mockWorkspaceIcons: ReturnType<typeof vi.fn<() => Promise<Record<string, string>>>>
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
  it('fetches icons on mount, re-fetches on onChanged, and unsubscribes on unmount', async () => {
    let latest: ReturnType<typeof useVaultLauncherIcons> | null = null
    host = document.createElement('div')
    document.body.appendChild(host)
    reactRoot = createRoot(host)

    await act(async () => {
      reactRoot?.render(<Harness onValue={(v) => { latest = v }} />)
    })

    expect(mockIcons).toHaveBeenCalledTimes(1)
    expect(mockWorkspaceIcons).toHaveBeenCalledTimes(1)
    expect(mockOnChanged).toHaveBeenCalledTimes(1)
    expect(latest!.launcherIcons).toEqual({ '/vaults/a': ICON_A })
    expect(latest!.workspaceIcons).toEqual({ 'ws-1': WS_ICON_1 })

    // Simulate another window creating/editing/removing a launcher.
    mockIcons.mockResolvedValueOnce({ '/vaults/a': ICON_A, '/vaults/b': ICON_B })
    mockWorkspaceIcons.mockResolvedValueOnce({ 'ws-1': WS_ICON_2 })

    await act(async () => {
      for (const listener of [...changeListeners]) listener()
    })

    expect(mockIcons).toHaveBeenCalledTimes(2)
    expect(mockWorkspaceIcons).toHaveBeenCalledTimes(2)
    expect(latest!.launcherIcons).toEqual({ '/vaults/a': ICON_A, '/vaults/b': ICON_B })
    expect(latest!.workspaceIcons).toEqual({ 'ws-1': WS_ICON_2 })

    // Unmount cleans up the IPC listener.
    expect(unsubscribe).not.toHaveBeenCalled()
    act(() => {
      reactRoot?.unmount()
      reactRoot = null
    })
    expect(unsubscribe).toHaveBeenCalledTimes(1)
    expect(changeListeners.size).toBe(0)
  })

  it('works without throwing when onChanged is absent on the bridge', async () => {
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
  })
})
