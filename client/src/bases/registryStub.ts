import type { RegistryApi, RegistryResponse } from '@shared/types'

/**
 * In-memory `RegistryApi` (5E, GRO-2217) implementing the GRO-2120 contract (§2–§3) until
 * GRO-2201 delivers the real `.yaseendocs/types.json` bridge: `get` on an untouched root
 * resolves `{ types: {}, properties: {} }` — empty, never an error, and never creates state
 * (lazy-creation is the bridge's rule too); the first mutation creates the per-root store
 * (a `{type}` scope creates the type entry on demand), bumps `version` and fires every
 * `onChange` listener with a fresh snapshot. Pure client memory: no storage location exists
 * besides this module, so the swap to the bridge is the ONE import in `useRegistry.ts`.
 */

const stores = new Map<string, RegistryResponse>()
const listeners = new Set<(registry: RegistryResponse) => void>()

const empty = (root: string): RegistryResponse => ({ root, version: 0, types: {}, properties: {} })

function store(root: string): RegistryResponse {
  let s = stores.get(root)
  if (s === undefined) {
    s = empty(root)
    stores.set(root, s)
  }
  return s
}

function changed(s: RegistryResponse): void {
  s.version++
  const snapshot = structuredClone(s)
  for (const listener of listeners) listener(snapshot)
}

export const registryStub: RegistryApi = {
  get: (root) => Promise.resolve(structuredClone(stores.get(root) ?? empty(root))),
  setType: (root, name, def) => {
    const s = store(root)
    const prev = s.types[name] ?? { properties: {} }
    s.types[name] = { ...prev, ...def, properties: def.properties ?? prev.properties }
    changed(s)
    return Promise.resolve()
  },
  removeType: (root, name) => {
    const s = store(root)
    delete s.types[name]
    changed(s)
    return Promise.resolve()
  },
  setProperty: (root, scope, name, def) => {
    const s = store(root)
    if (scope === 'vault') s.properties[name] = def
    else (s.types[scope.type] ??= { properties: {} }).properties[name] = def
    changed(s)
    return Promise.resolve()
  },
  removeProperty: (root, scope, name) => {
    const s = store(root)
    if (scope === 'vault') delete s.properties[name]
    else delete s.types[scope.type]?.properties[name]
    changed(s)
    return Promise.resolve()
  },
  onChange: (listener) => {
    listeners.add(listener)
    return () => {
      listeners.delete(listener)
    }
  },
}

/** Tests only: drop every stored registry and every listener. */
export function resetRegistryStub(): void {
  stores.clear()
  listeners.clear()
}
