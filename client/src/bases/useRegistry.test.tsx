/**
 * `useRegistry` (5E GRO-2217 ↔ Bible A GRO-2201; contract GRO-2120 comment 73479ea3 §2): one
 * `registry.get(root)` fetch per root, live-replaced by `registry:changed` broadcasts for that
 * root. Public surface is exactly `{ status, registry, error }`. The bridge (`api.registry`, the
 * swapped source) is mocked; the onChange listeners are captured so tests can push broadcasts.
 * Stub-backed component integration lives in `view/RelationColumn.test.tsx`.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import type { RegistryResponse } from '@shared/types'
import { useRegistry, type RegistryState } from './useRegistry'

let listeners: Array<(reg: RegistryResponse) => void> = []
const offSpy = vi.fn()

vi.mock('../api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../api')>()),
  api: {
    registry: {
      get: vi.fn(),
      onChange: vi.fn((l: (reg: RegistryResponse) => void) => {
        listeners.push(l)
        return offSpy
      }),
    },
  },
}))

import { api } from '../api'

const getFn = vi.mocked(api.registry.get)

;(globalThis as unknown as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true

const response = (root: string, extra: Partial<RegistryResponse> = {}): RegistryResponse => ({ root, version: 1, types: {}, properties: {}, ...extra })

let root: Root | null = null
let container: HTMLElement | null = null
let state: RegistryState

function Probe({ vaultRoot }: { vaultRoot: string }) {
  state = useRegistry(vaultRoot)
  return null
}

function mount(vaultRoot = '/vault'): void {
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  act(() => root?.render(<Probe vaultRoot={vaultRoot} />))
}

function rerender(vaultRoot: string): void {
  act(() => root?.render(<Probe vaultRoot={vaultRoot} />))
}

/** Lets the mocked fetch promise resolve and React commit. */
async function flush(): Promise<void> {
  await act(async () => {
    await Promise.resolve()
  })
}

function broadcast(reg: RegistryResponse): void {
  act(() => listeners.forEach((l) => l(reg)))
}

beforeEach(() => {
  getFn.mockResolvedValue(response('/vault'))
})

afterEach(() => {
  act(() => root?.unmount())
  root = null
  container?.remove()
  container = null
  listeners = []
  vi.clearAllMocks()
})

describe('useRegistry', () => {
  it('is pending on mount, then ready with the fetched registry — an untouched vault is empty, never an error', async () => {
    mount()
    expect(state.status).toBe('pending')
    expect(state.registry).toBeNull()
    await flush()
    expect(getFn).toHaveBeenCalledWith('/vault')
    expect(state.status).toBe('ready')
    expect(state.registry).toEqual({ root: '/vault', version: 1, types: {}, properties: {} })
    expect(state.error).toBeNull()
  })

  it('a failed fetch becomes status error with the message; a corrupt registry is NOT a fetch error', async () => {
    getFn.mockRejectedValue(new Error('bridge gone'))
    mount()
    await flush()
    expect(state.status).toBe('error')
    expect(state.error).toBe('bridge gone')
    expect(state.registry).toBeNull()

    getFn.mockResolvedValue(response('/other', { error: 'types.json is not valid JSON: x' }))
    rerender('/other')
    await flush()
    expect(state.status).toBe('ready') // degraded, not failed: registry.error carries the string
    expect(state.registry?.error).toContain('not valid JSON')
  })

  it('a broadcast for this root replaces the registry live; other roots are ignored', async () => {
    mount()
    await flush()
    broadcast(response('/elsewhere', { types: { role: { properties: {} } } }))
    expect(state.registry?.types.role).toBeUndefined()
    broadcast(response('/vault', { types: { kpi: { properties: {} } } }))
    expect(state.status).toBe('ready')
    expect(state.registry?.types.kpi).toEqual({ properties: {} })
  })

  it('a broadcast landing before a slow initial get wins over it', async () => {
    let resolve!: (r: RegistryResponse) => void
    getFn.mockReturnValue(new Promise<RegistryResponse>((r) => (resolve = r)))
    mount()
    broadcast(response('/vault', { types: { kpi: { properties: {} } } }))
    expect(state.status).toBe('ready')
    resolve(response('/vault')) // the stale fetch must not overwrite the fresher broadcast
    await flush()
    expect(state.registry?.types.kpi).toEqual({ properties: {} })
  })

  it('a root change resets to pending and fetches the new root', async () => {
    mount('/vault')
    await flush()
    getFn.mockResolvedValue(response('/other', { properties: { related: { kind: 'multi-link' } } }))
    rerender('/other')
    expect(state.status).toBe('pending')
    expect(state.registry).toBeNull()
    await flush()
    expect(getFn).toHaveBeenLastCalledWith('/other')
    expect(state.registry?.properties.related).toEqual({ kind: 'multi-link' })
  })

  it('unmount unsubscribes from onChange', async () => {
    mount()
    await flush()
    act(() => root?.unmount())
    root = null
    expect(offSpy).toHaveBeenCalled()
  })
})
