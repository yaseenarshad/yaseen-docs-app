import { useEffect, useRef, useState } from 'react'
import type { RegistryResponse } from '@shared/types'
import { api } from '../api'

export type RegistryStatus = 'pending' | 'ready' | 'error'

export interface RegistryState {
  status: RegistryStatus
  /**
   * null until the first fetch resolves (and after a failed one). A corrupt types.json is NOT a
   * fetch error: status stays 'ready' with `registry.error` set — consumers degrade to no-registry
   * behavior (inference-only typing) and surface the string where index errors already show.
   */
  registry: RegistryResponse | null
  /** Fetch failure message; null unless `status` is 'error'. */
  error: string | null
}

/**
 * The type & property registry behind relation columns (Bible A, GRO-2201), mirroring `useIndex`:
 * one `api.registry.get(root)` per root, live-replaced by every `registry:changed` broadcast for
 * that root — an in-app mutation from any window, or an external edit picked up by the dotfolder
 * watcher. No debounce needed: the broadcast already carries the whole fresh registry.
 */
export function useRegistry(root: string): RegistryState {
  const [status, setStatus] = useState<RegistryStatus>('pending')
  const [registry, setRegistry] = useState<RegistryResponse | null>(null)
  const [error, setError] = useState<string | null>(null)
  // Bumped on unmount/root change AND on every broadcast: only a still-fresh fetch may commit.
  const generation = useRef(0)

  useEffect(() => {
    const gen = ++generation.current
    setStatus('pending')
    setRegistry(null)
    setError(null)
    api.registry.get(root).then(
      (res) => {
        if (gen !== generation.current) return
        setRegistry(res)
        setStatus('ready')
        setError(null)
      },
      (err: unknown) => {
        if (gen !== generation.current) return
        setStatus('error')
        setError(err instanceof Error ? err.message : String(err))
      },
    )
    const unsubscribe = api.registry.onChange((reg) => {
      if (reg.root !== root) return
      generation.current++ // a broadcast is always fresher than any in-flight get
      setRegistry(reg)
      setStatus('ready')
      setError(null)
    })
    return () => {
      generation.current++
      unsubscribe()
    }
  }, [root])

  return { status, registry, error }
}
