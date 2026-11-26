import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { VAULT_SETTINGS_DOC_KEYS, VAULT_SETTINGS_FILE } from '@shared/vaultSettings'
import { BridgeRequestError } from '../api'

type ChangeListener = (change: { root: string; name: string }) => void
let listeners: ChangeListener[] = []

vi.mock('../api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../api')>()
  return {
    ...actual,
    api: {
      ...actual.api,
      vaultConfig: {
        read: vi.fn(async () => null),
        write: vi.fn(async () => ({})),
        onChange: vi.fn((fn: ChangeListener) => {
          listeners.push(fn)
          return () => {
            listeners = listeners.filter((l) => l !== fn)
          }
        }),
      },
    },
  }
})

import { api } from '../api'
import { useVaultSettings, type VaultSettingsState } from './useVaultSettings'

;(globalThis as unknown as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true

const read = vi.mocked(api.vaultConfig.read)
const write = vi.mocked(api.vaultConfig.write)

let root: Root | null = null
let state!: VaultSettingsState

function Probe({ vault, readOnly = false }: { vault: string | null; readOnly?: boolean }) {
  state = useVaultSettings(vault, readOnly)
  return null
}

beforeEach(() => {
  vi.clearAllMocks()
  listeners = []
  read.mockResolvedValue(null)
  write.mockResolvedValue({} as never)
  root = createRoot(document.createElement('div'))
})

afterEach(() => {
  act(() => root?.unmount())
  root = null
})

describe('useVaultSettings (YAZ-6546, YAZ-6555)', () => {
  it('issues zero IPC calls when root is null', async () => {
    await act(async () => {
      root?.render(<Probe vault={null} />)
    })
    expect(read).not.toHaveBeenCalled()
    expect(state.doc).toBeNull()
    expect(state.overrides).toEqual({})
    expect(state.ready).toBe(false)
  })

  it('reads settings.json ONCE per vault and exposes sparse overrides', async () => {
    read.mockResolvedValue({
      version: 1,
      contentWidth: 'full',
      tabWidth: 'wide',
      review: { enabled: false },
      futureKey: 'keep-me',
    })
    await act(async () => {
      root?.render(<Probe vault="/v" />)
    })
    expect(read).toHaveBeenCalledTimes(1)
    expect(read).toHaveBeenCalledWith('/v', VAULT_SETTINGS_FILE)
    expect(state.ready).toBe(true)
    expect(state.overrides).toEqual({ contentWidth: 'full', tabWidth: 'wide' })
    expect(state.doc?.review).toEqual({ enabled: false })
  })

  it('setOverrides sparse-patches settings.json while preserving legacy sections and unknown keys', async () => {
    read.mockResolvedValue({
      version: 1,
      contentWidth: 'full',
      review: { enabled: true },
      unknownKey: 42,
    })
    await act(async () => {
      root?.render(<Probe vault="/v" />)
    })

    await act(async () => {
      await state.setOverrides({ tabWidth: 'compact' }, ['contentWidth'])
    })
    expect(write).toHaveBeenCalledTimes(1)
    expect(write).toHaveBeenCalledWith(
      '/v',
      VAULT_SETTINGS_FILE,
      { version: 1, tabWidth: 'compact', review: { enabled: true }, unknownKey: 42 },
      VAULT_SETTINGS_DOC_KEYS,
    )
    expect(state.overrides).toEqual({ tabWidth: 'compact' })
  })

  it('setSection writes and clears consolidated legacy sections in settings.json', async () => {
    read.mockResolvedValue({ version: 1, contentWidth: 'medium' })
    await act(async () => {
      root?.render(<Probe vault="/v" />)
    })

    await act(async () => {
      await state.setSection('linkClick', { click: 'open' })
    })
    expect(write).toHaveBeenLastCalledWith(
      '/v',
      VAULT_SETTINGS_FILE,
      { version: 1, contentWidth: 'medium', linkClick: { click: 'open' } },
      VAULT_SETTINGS_DOC_KEYS,
    )

    await act(async () => {
      await state.setSection('linkClick', undefined)
    })
    expect(write).toHaveBeenLastCalledWith(
      '/v',
      VAULT_SETTINGS_FILE,
      { version: 1, contentWidth: 'medium' },
      VAULT_SETTINGS_DOC_KEYS,
    )
  })

  it('resetAll clears all 36 override keys while preserving legacy sections', async () => {
    read.mockResolvedValue({
      version: 1,
      contentWidth: 'full',
      sidebarRowHeight: 24,
      bulletThreading: true,
      review: { enabled: true },
      textFormatting: { version: 1, text: 18 },
    })
    await act(async () => {
      root?.render(<Probe vault="/v" />)
    })

    await act(async () => {
      await state.resetAll()
    })
    expect(write).toHaveBeenLastCalledWith(
      '/v',
      VAULT_SETTINGS_FILE,
      { version: 1, review: { enabled: true }, textFormatting: { version: 1, text: 18 } },
      VAULT_SETTINGS_DOC_KEYS,
    )
    expect(state.overrides).toEqual({})
    expect(state.doc?.review).toEqual({ enabled: true })
  })

  it('holds overrides in memory when readOnly is true and never writes to disk', async () => {
    read.mockResolvedValue({ version: 1, contentWidth: 'medium' })
    await act(async () => {
      root?.render(<Probe vault="/v" readOnly />)
    })

    await act(async () => {
      await state.setOverrides({ tabWidth: 'wide', sidebarRowHeight: 24 })
    })
    expect(write).not.toHaveBeenCalled()
    expect(state.overrides).toEqual({ contentWidth: 'medium', tabWidth: 'wide', sidebarRowHeight: 24 })

    await act(async () => {
      await state.resetAll()
    })
    expect(write).not.toHaveBeenCalled()
    expect(state.overrides).toEqual({ contentWidth: 'medium' })
  })

  it('reloads on external settings.json onChange and ignores other files/roots', async () => {
    read.mockResolvedValueOnce({ version: 1, contentWidth: 'narrow' })
    await act(async () => {
      root?.render(<Probe vault="/v" />)
    })
    expect(state.overrides).toEqual({ contentWidth: 'narrow' })

    read.mockResolvedValueOnce({ version: 1, contentWidth: 'full' })
    await act(async () => {
      listeners.forEach((l) => l({ root: '/other', name: VAULT_SETTINGS_FILE }))
      listeners.forEach((l) => l({ root: '/v', name: 'icons.json' }))
    })
    expect(read).toHaveBeenCalledTimes(1)

    await act(async () => {
      listeners.forEach((l) => l({ root: '/v', name: VAULT_SETTINGS_FILE }))
    })
    expect(read).toHaveBeenCalledTimes(2)
    expect(state.overrides).toEqual({ contentWidth: 'full' })
  })

  it('marks malformed on INVALID_CONFIG and refuses writes', async () => {
    read.mockRejectedValueOnce(new BridgeRequestError('INVALID_CONFIG', 'bad json'))
    await act(async () => {
      root?.render(<Probe vault="/v" />)
    })
    expect(state.malformed).toBe(true)
    expect(state.ready).toBe(true)

    await act(async () => {
      await state.setOverrides({ contentWidth: 'full' })
      await state.setSection('review', { enabled: false })
      await state.resetAll()
    })
    expect(write).not.toHaveBeenCalled()
  })

  it('recovers by re-reading settings.json if write fails', async () => {
    read.mockResolvedValueOnce({ version: 1, contentWidth: 'narrow' })
    await act(async () => {
      root?.render(<Probe vault="/v" />)
    })
    write.mockRejectedValueOnce(new Error('EACCES'))
    read.mockResolvedValueOnce({ version: 1, contentWidth: 'narrow' })

    await act(async () => {
      await state.setOverrides({ contentWidth: 'full' })
    })
    expect(read).toHaveBeenCalledTimes(2)
    expect(state.overrides).toEqual({ contentWidth: 'narrow' })
  })
})
