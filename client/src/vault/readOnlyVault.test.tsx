/**
 * `useReadOnlyVault` (YAZ-4939): a vault's `.yaseendocs/read-only.json`, read once per root, re-read on that file's
 * change broadcast, Off with no file; the vault's file-actions allowance ("Allow for 15 minutes"). The bridge is mocked.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import type { VaultConfigChange } from '@shared/types'
import { DEFAULT_READ_ONLY_VAULT, FILE_ACTIONS_ALLOW_MS, READ_ONLY_VAULT_FILE, sanitizeReadOnlyVault, useReadOnlyVault, type ReadOnlyVaultState } from './readOnlyVault'

let listeners: Array<(c: VaultConfigChange) => void> = []

vi.mock('../api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../api')>()),
  api: {
    vaultConfig: {
      read: vi.fn(),
      write: vi.fn(),
      onChange: vi.fn((l: (c: VaultConfigChange) => void) => {
        listeners.push(l)
        return () => (listeners = listeners.filter((x) => x !== l))
      }),
    },
  },
}))

import { api } from '../api'

const read = vi.mocked(api.vaultConfig.read)
const write = vi.mocked(api.vaultConfig.write)

;(globalThis as unknown as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true

let root: Root | null = null
let state: ReadOnlyVaultState

function Probe({ vault }: { vault: string | null }) {
  state = useReadOnlyVault(vault)
  return null
}

async function mount(vault: string | null): Promise<void> {
  root = createRoot(document.createElement('div'))
  await act(async () => root?.render(<Probe vault={vault} />))
}

beforeEach(() => {
  listeners = []
  read.mockReset().mockResolvedValue(null)
  write.mockReset().mockResolvedValue(undefined)
})

afterEach(() => {
  act(() => root?.unmount())
  root = null
  vi.useRealTimers()
})

describe('useReadOnlyVault', () => {
  it('an old vault (no read-only.json) reads Off and nothing is written; no call at all with no vault open', async () => {
    await mount('/vault')
    expect(read).toHaveBeenCalledWith('/vault', READ_ONLY_VAULT_FILE)
    expect(state.settings).toEqual(DEFAULT_READ_ONLY_VAULT)
    expect(state.settings.on).toBe(false)
    expect(write).not.toHaveBeenCalled()
    act(() => root?.unmount())
    read.mockClear()
    await mount(null)
    expect(read).not.toHaveBeenCalled()
    expect(state.settings.on).toBe(false)
  })

  it('only `on: true` counts; anything else is Off', () => {
    expect(sanitizeReadOnlyVault({ on: true })).toEqual({ on: true })
    expect(sanitizeReadOnlyVault({ on: 'yes' })).toEqual({ on: false })
    expect(sanitizeReadOnlyVault({ on: 1 })).toEqual({ on: false })
    expect(sanitizeReadOnlyVault(null)).toEqual({ on: false })
    expect(sanitizeReadOnlyVault('on')).toEqual({ on: false })
  })

  it('the round trip: save shows On at once and writes only the settings file; a change broadcast re-reads this vault\'s file only', async () => {
    await mount('/vault')
    await act(async () => state.save({ on: true }))
    expect(state.settings).toEqual({ on: true })
    expect(write).toHaveBeenCalledWith('/vault', READ_ONLY_VAULT_FILE, { on: true })
    read.mockResolvedValue({ on: false })
    await act(async () => listeners.forEach((l) => l({ root: '/other', name: READ_ONLY_VAULT_FILE })))
    await act(async () => listeners.forEach((l) => l({ root: '/vault', name: 'link-click.json' })))
    expect(state.settings.on).toBe(true)
    await act(async () => listeners.forEach((l) => l({ root: '/vault', name: READ_ONLY_VAULT_FILE })))
    expect(state.settings.on).toBe(false)
  })

  it('a write the disk refused: the file is read again, and what it says shows', async () => {
    read.mockResolvedValue({ on: true })
    await mount('/vault')
    write.mockRejectedValue(new Error('EACCES'))
    read.mockResolvedValue({ on: true })
    await act(async () => state.save({ on: false }))
    expect(state.settings.on).toBe(true)
  })

  it('file actions: always allowed with the vault Off; with it On, only for 15 minutes after "Allow"', async () => {
    vi.useFakeTimers()
    await mount('/vault')
    expect(state.fileActionsAllowed()).toBe(true)
    await act(async () => state.save({ on: true }))
    expect(state.fileActionsAllowed()).toBe(false)
    act(() => state.allowFileActions())
    expect(state.fileActionsAllowed()).toBe(true)
    vi.advanceTimersByTime(FILE_ACTIONS_ALLOW_MS - 1)
    expect(state.fileActionsAllowed()).toBe(true)
    vi.advanceTimersByTime(1)
    expect(state.fileActionsAllowed()).toBe(false)
    // The allowance costs no timer: nothing is armed for it.
    expect(vi.getTimerCount()).toBe(0)
  })
})
