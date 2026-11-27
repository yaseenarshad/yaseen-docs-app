/**
 * `useVaultScope` read-only guards for Settings › IDs bulk writes (YAZ-5989): enabling/relettering IDs (`ids.set`),
 * `ids.reletter`, and `ids.backfill` ask `allowFileAction(root)` in a read-only vault. Turning IDs off (`ids.set(false)`),
 * `ids.check()`, and `ids.state()` stay free.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import type { IdsState } from '@shared/types'

vi.mock('../api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../api')>()),
  api: {
    ids: {
      set: vi.fn(async () => ({})),
      check: vi.fn(async () => 'No duplicates.'),
      state: vi.fn(async (): Promise<IdsState> => ({ letters: 'YAZ', pages: 3, stale: 0, old: 1, unfinished: false })),
      reletter: vi.fn(async ( _root: string, letters: string): Promise<IdsState> => ({ letters, pages: 3, stale: 0, old: 0, unfinished: false })),
      backfill: vi.fn(async (): Promise<IdsState> => ({ letters: 'YAZ', pages: 3, stale: 0, old: 0, unfinished: false })),
    },
    backfillCreated: vi.fn(async () => ({ written: 2, skipped: 1 })),
    vaultConfig: {
      read: vi.fn(async () => null),
      write: vi.fn(async () => ({})),
      onChange: vi.fn(() => () => undefined),
    },
    watch: vi.fn(() => () => undefined),
    coldDiff: vi.fn(async () => ({ renamed: [], deleted: [] })),
    github: {
      status: vi.fn(async () => null),
      onStatus: vi.fn(() => () => undefined),
      setEnabled: vi.fn(async () => undefined),
    },
    properties: {
      get: vi.fn(async () => null),
      onChange: vi.fn(() => () => undefined),
    },
    app: {
      vaultName: vi.fn(async () => 'Vault'),
    },
  },
}))

import { api } from '../api'
import { useVaultScope, type VaultScope } from './useVaultScope'

;(globalThis as unknown as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true

let root: Root | null = null
let scope!: VaultScope
const notify = vi.fn()

function Probe({ vault, allowFileAction, transientReadOnly = false }: { vault: string; allowFileAction: (r: string) => Promise<boolean>; transientReadOnly?: boolean }) {
  scope = useVaultScope(vault, notify, allowFileAction, transientReadOnly)
  return null
}

beforeEach(() => {
  vi.clearAllMocks()
  root = createRoot(document.createElement('div'))
})

afterEach(() => {
  act(() => root?.unmount())
  root = null
})

describe('useVaultScope IDs read-only guards (YAZ-5989)', () => {
  const mountScope = async (allowFileAction: (r: string) => Promise<boolean>) => {
    act(() => root?.render(<Probe vault="/v" allowFileAction={allowFileAction} />))
    await act(async () => {
      scope.onSnapshot([], [], false, undefined, false)
    })
  }

  it('gates ids.set(true, letters), ids.reletter, and ids.backfill with allowFileAction; Cancel writes nothing and shows no error toast', async () => {
    const allow = vi.fn(async () => false)
    await mountScope(allow)
    expect(scope.ids).toBeDefined()

    expect(await scope.ids!.set(true, 'DOC')).toBe(false)
    expect(api.ids.set).not.toHaveBeenCalled()
    expect(notify).not.toHaveBeenCalled()

    expect(await scope.ids!.reletter('DOC')).toBeNull()
    expect(api.ids.reletter).not.toHaveBeenCalled()

    expect(await scope.ids!.backfill()).toBeNull()
    expect(api.ids.backfill).not.toHaveBeenCalled()

    expect(await scope.ids!.backfillCreated()).toBeNull()
    expect(api.backfillCreated).not.toHaveBeenCalled()
    expect(allow).toHaveBeenCalledTimes(4)
    expect(allow).toHaveBeenNthCalledWith(1, '/v')
    expect(allow).toHaveBeenNthCalledWith(2, '/v')
    expect(allow).toHaveBeenNthCalledWith(3, '/v')
    expect(allow).toHaveBeenNthCalledWith(4, '/v')

    // Read-only checks and turning IDs off stay free.
    allow.mockClear()
    expect(await scope.ids!.set(false)).toBe(true)
    expect(api.ids.set).toHaveBeenCalledExactlyOnceWith('/v', false, undefined)
    expect(await scope.ids!.check()).toBe('No duplicates.')
    expect(await scope.ids!.state()).toMatchObject({ letters: 'YAZ' })
    expect(allow).not.toHaveBeenCalled()
  })

  it('allows ids.set(true, letters), ids.reletter, and ids.backfill once allowFileAction resolves true', async () => {
    const allow = vi.fn(async () => true)
    await mountScope(allow)

    expect(await scope.ids!.set(true, 'DOC')).toBe(true)
    expect(api.ids.set).toHaveBeenCalledExactlyOnceWith('/v', true, 'DOC')

    expect(await scope.ids!.reletter('NEW')).toMatchObject({ letters: 'NEW' })
    expect(api.ids.reletter).toHaveBeenCalledExactlyOnceWith('/v', 'NEW')

    expect(await scope.ids!.backfill()).toMatchObject({ old: 0 })
    expect(api.ids.backfill).toHaveBeenCalledExactlyOnceWith('/v')

    expect(await scope.ids!.backfillCreated()).toEqual({ written: 2, skipped: 1 })
    expect(api.backfillCreated).toHaveBeenCalledExactlyOnceWith('/v')
  })
})

describe('useVaultScope read-only vault settings writes (YAZ-6593 D1)', () => {
  it('writes vault settings to settings.json when read-only.json is on, while transient --read-only windows stay disk-free', async () => {
    vi.mocked(api.vaultConfig.read).mockImplementation(async (_r, name) => (name === 'read-only.json' ? { on: true } : null))
    await act(async () => {
      root?.render(<Probe vault="/ro-vault" allowFileAction={async () => false} transientReadOnly={false} />)
    })
    expect(scope.readOnlyVault.locked).toBe(true)

    await act(async () => {
      await scope.vaultSettings.setOverrides({ contentWidth: 'full' })
    })
    expect(api.vaultConfig.write).toHaveBeenCalledWith(
      '/ro-vault',
      'settings.json',
      expect.objectContaining({ contentWidth: 'full' }),
      expect.arrayContaining(['contentWidth']),
    )

    // Transient CLI --read-only window stays completely disk-free
    vi.mocked(api.vaultConfig.write).mockClear()
    await act(async () => {
      root?.render(<Probe vault="/cli-ro" allowFileAction={async () => false} transientReadOnly={true} />)
    })
    expect(scope.readOnlyVault.locked).toBe(true)
    await act(async () => {
      await scope.vaultSettings.setOverrides({ contentWidth: 'narrow' })
    })
    expect(api.vaultConfig.write).not.toHaveBeenCalled()
    expect(scope.vaultSettings.overrides.contentWidth).toBe('narrow')
  })
})
