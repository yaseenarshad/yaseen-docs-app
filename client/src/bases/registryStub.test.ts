/**
 * In-memory `RegistryApi` stub (5E, GRO-2217; contract GRO-2120 comment 73479ea3 §3/§6):
 * `get` on an untouched root resolves empty — never an error — and never creates state;
 * mutations are targeted (a `{type}` scope creates the type entry on demand) and fire every
 * `onChange` listener with a fresh snapshot. `version` is the constant 1, matching the real
 * `.yaseendocs/types.json` bridge this stub stands in for (GRO-2201 swap; GRO-2204 alignment).
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { registryStub, resetRegistryStub } from './registryStub'

afterEach(() => resetRegistryStub())

describe('get', () => {
  it('an untouched root resolves { types: {}, properties: {} } — empty, not an error (§3)', async () => {
    await expect(registryStub.get('/vault')).resolves.toEqual({ root: '/vault', version: 1, types: {}, properties: {} })
  })

  it('roots are independent', async () => {
    await registryStub.setProperty('/a', 'vault', 'x', { kind: 'text' })
    expect((await registryStub.get('/b')).properties).toEqual({})
    expect((await registryStub.get('/a')).properties.x).toEqual({ kind: 'text' })
  })

  it('returns a snapshot: mutating the result never corrupts the store', async () => {
    await registryStub.setProperty('/vault', 'vault', 'x', { kind: 'text' })
    const res = await registryStub.get('/vault')
    res.properties.x.kind = 'number'
    expect((await registryStub.get('/vault')).properties.x.kind).toBe('text')
  })
})

describe('setProperty', () => {
  it("scope 'vault' stores the def under properties; version stays the bridge's constant 1", async () => {
    await registryStub.setProperty('/vault', 'vault', 'owner', { kind: 'link', target: 'person' })
    const res = await registryStub.get('/vault')
    expect(res.properties.owner).toEqual({ kind: 'link', target: 'person' })
    expect(res.version).toBe(1)
  })

  it('a { type } scope creates the type entry on demand (§4)', async () => {
    await registryStub.setProperty('/vault', { type: 'kpi' }, 'owner', { kind: 'multi-link', target: 'person' })
    expect((await registryStub.get('/vault')).types.kpi).toEqual({
      properties: { owner: { kind: 'multi-link', target: 'person' } },
    })
  })

  it('a second write to the same key replaces the def', async () => {
    await registryStub.setProperty('/vault', 'vault', 'x', { kind: 'link', target: 'a' })
    await registryStub.setProperty('/vault', 'vault', 'x', { kind: 'multi-link', target: 'b' })
    const res = await registryStub.get('/vault')
    expect(res.properties.x).toEqual({ kind: 'multi-link', target: 'b' })
    expect(res.version).toBe(1)
  })
})

describe('removeProperty / setType / removeType', () => {
  it('removeProperty deletes from the named scope only', async () => {
    await registryStub.setProperty('/vault', 'vault', 'x', { kind: 'text' })
    await registryStub.setProperty('/vault', { type: 'kpi' }, 'x', { kind: 'number' })
    await registryStub.removeProperty('/vault', 'vault', 'x')
    const res = await registryStub.get('/vault')
    expect(res.properties.x).toBeUndefined()
    expect(res.types.kpi.properties.x).toEqual({ kind: 'number' })
  })

  it('setType merges the partial def; removeType deletes the entry', async () => {
    await registryStub.setProperty('/vault', { type: 'kpi' }, 'x', { kind: 'text' })
    await registryStub.setType('/vault', 'kpi', { displayName: 'KPI' })
    expect((await registryStub.get('/vault')).types.kpi).toEqual({ displayName: 'KPI', properties: { x: { kind: 'text' } } })
    await registryStub.removeType('/vault', 'kpi')
    expect((await registryStub.get('/vault')).types).toEqual({})
  })
})

describe('onChange', () => {
  it('fires each listener with the new snapshot after every mutation', async () => {
    const seen = vi.fn()
    registryStub.onChange(seen)
    await registryStub.setProperty('/vault', 'vault', 'x', { kind: 'text' })
    expect(seen).toHaveBeenCalledTimes(1)
    expect(seen.mock.calls[0][0]).toEqual({ root: '/vault', version: 1, types: {}, properties: { x: { kind: 'text' } } })
  })

  it('the returned unsubscribe stops delivery', async () => {
    const seen = vi.fn()
    const unsubscribe = registryStub.onChange(seen)
    unsubscribe()
    await registryStub.setProperty('/vault', 'vault', 'x', { kind: 'text' })
    expect(seen).not.toHaveBeenCalled()
  })
})
