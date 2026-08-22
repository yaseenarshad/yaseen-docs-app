import { useEffect, useRef, useState } from 'react'
import type { RegistryApi, RegistryResponse } from '@shared/types'
import { registryStub } from './registryStub'

/**
 * The vault's type registry (5E, GRO-2217; contract locked on GRO-2120 comment 73479ea3):
 * one `registry.get(root)` fetch per root, live-replaced through `onChange` (same-root
 * events only), mirroring `useIndex`. Components consume this hook — and mutate through
 * the `registry` object below — never the storage directly, so both sides re-render
 * identically when GRO-2201 swaps the source.
 */

/**
 * THE swap point (contract §6): today the in-memory stub, ONE line for GRO-2201 to repoint
 * at the real `.yaseendocs/types.json` bridge (`window.yaseenDocs.registry` via `api`).
 * Neither this hook's public surface nor any consumer changes with the swap.
 */
export const registry: RegistryApi = registryStub

export type RegistryStatus = 'pending' | 'ready' | 'error'

export interface RegistryState {
  status: RegistryStatus
  /** null until the first fetch resolves (and after a failed one). An untouched vault is `{types:{}, properties:{}}` — never an error. */
  registry: RegistryResponse | null
  /** Fetch failure message; null unless `status` is 'error'. */
  error: string | null
}

export function useRegistry(root: string): RegistryState {
  const [status, setStatus] = useState<RegistryStatus>('pending')
  const [response, setResponse] = useState<RegistryResponse | null>(null)
  const [error, setError] = useState<string | null>(null)
  // Bumped on unmount/root change: only the current subscription may commit.
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
      if (gen !== generation.current || res.root !== root) return
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
