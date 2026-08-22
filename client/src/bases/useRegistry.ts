import { useEffect, useRef, useState } from 'react'
import type { RegistryApi, RegistryResponse } from '@shared/types'
import { api } from '../api'

/**
 * The vault's type registry (5E GRO-2217 ↔ Bible A GRO-2201; contract locked on GRO-2120
 * comment 73479ea3): one `registry.get(root)` fetch per root, live-replaced through `onChange`
 * (same-root events only), mirroring `useIndex`. Components consume this hook — and mutate
 * through the `registry` object below — never the storage directly, so both sides re-render
 * identically wherever the change came from.
 */

/**
 * The swap point (contract §6), now SWAPPED (GRO-2201): the real `.yaseendocs/types.json`
 * bridge (`window.yaseenDocs.registry`, `ApiRequestError`-wrapped via `api`) replaced 5E's
 * in-memory stub. Tests fake the bridge by installing `registryStub` as
 * `window.yaseenDocs.registry` — the stub implements this same interface.
 */
export const registry: RegistryApi = api.registry

export type RegistryStatus = 'pending' | 'ready' | 'error'

export interface RegistryState {
  status: RegistryStatus
  /**
   * null until the first fetch resolves (and after a failed one). An untouched vault is
   * `{types:{}, properties:{}}` — never an error. A corrupt types.json is NOT a fetch error
   * either: status stays 'ready' with `registry.error` set — consumers degrade to no-registry
   * behavior (inference-only typing) and surface the string where index errors already show.
   */
  registry: RegistryResponse | null
  /** Fetch failure message; null unless `status` is 'error'. */
  error: string | null
}

export function useRegistry(root: string): RegistryState {
  const [status, setStatus] = useState<RegistryStatus>('pending')
  const [response, setResponse] = useState<RegistryResponse | null>(null)
  const [error, setError] = useState<string | null>(null)
  // Bumped on unmount/root change AND on every broadcast: only a still-fresh fetch may commit.
  const generation = useRef(0)

  useEffect(() => {
    const gen = ++generation.current
    setStatus('pending')
    setResponse(null)
    setError(null)
    registry.get(root).then(
      (res) => {
        if (gen !== generation.current) return
        setResponse(res)
        setStatus('ready')
        setError(null)
      },
      (err: unknown) => {
        if (gen !== generation.current) return
        setStatus('error')
        setError(err instanceof Error ? err.message : String(err))
      },
    )
    const unsubscribe = registry.onChange((res) => {
      if (res.root !== root) return
      generation.current++ // a broadcast is always fresher than any in-flight get
      setResponse(res)
      setStatus('ready')
      setError(null)
    })
    return () => {
      generation.current++
      unsubscribe()
    }
  }, [root])

  return { status, registry: response, error }
}
