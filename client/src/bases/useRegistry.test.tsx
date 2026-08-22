/**
 * `useRegistry` (5E, GRO-2217; contract GRO-2120 comment 73479ea3 §2): one `registry.get(root)`
 * fetch per root, live-replaced through `onChange` (same-root events only). Public surface is
 * exactly `{ status, registry, error }` — it must not change when GRO-2201 swaps the in-memory
 * stub for the real bridge. Sourced from the real stub here; the failure path spies on `get`.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { registryStub, resetRegistryStub } from './registryStub'
import { useRegistry, type RegistryState } from './useRegistry'

;(globalThis as unknown as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true

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

/** Lets the stub's promises resolve and React commit. */
async function flush(): Promise<void> {
  await act(async () => {})
}

afterEach(() => {
  act(() => root?.unmount())
  root = null
  container?.remove()
  container = null
  resetRegistryStub()
  vi.restoreAllMocks()
})

describe('useRegistry', () => {
  it('is pending on mount, then ready with the (empty) registry — an untouched root is not an error', async () => {
    mount()
    expect(state.status).toBe('pending')
    expect(state.registry).toBeNull()
    await flush()
    expect(state.status).toBe('ready')
    expect(state.registry).toEqual({ root: '/vault', version: 0, types: {}, properties: {} })
    expect(state.error).toBeNull()
  })

  it('a mutation on the stub live-replaces the registry through onChange', async () => {
    mount()
    await flush()
    await act(async () => {
      await registryStub.setProperty('/vault', { type: 'kpi' }, 'owner', { kind: 'link', target: 'person' })
    })
    expect(state.registry?.types.kpi.properties.owner).toEqual({ kind: 'link', target: 'person' })
    expect(state.registry?.version).toBe(1)
  })

  it("changes to another root's registry are ignored", async () => {
    mount('/vault')
    await flush()
    await act(async () => {
      await registryStub.setProperty('/other', 'vault', 'x', { kind: 'text' })
    })
    expect(state.registry?.version).toBe(0)
    expect(state.registry?.properties).toEqual({})
  })

  it('a failed fetch becomes status error with the message', async () => {
    vi.spyOn(registryStub, 'get').mockRejectedValueOnce(new Error('bridge gone'))
    mount()
    await flush()
    expect(state.status).toBe('error')
    expect(state.error).toBe('bridge gone')
    expect(state.registry).toBeNull()
  })

  it('a root change resets to pending and fetches the new root', async () => {
    mount('/vault')
    await flush()
    await act(async () => {
      await registryStub.setProperty('/other', 'vault', 'x', { kind: 'text' })
    })
    rerender('/other')
    expect(state.status).toBe('pending')
    await flush()
    expect(state.status).toBe('ready')
    expect(state.registry?.root).toBe('/other')
    expect(state.registry?.properties.x).toEqual({ kind: 'text' })
  })
})
