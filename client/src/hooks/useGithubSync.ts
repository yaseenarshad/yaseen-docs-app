import { useCallback, useEffect, useRef, useState } from 'react'
import type { AddToAutoSyncResult, AutoSyncStatus, GithubSyncStatus } from '@shared/types'
import { api } from '../api'

/** Shared per-root AutoSync cache so SyncIndicator reflects GitHub AutoSync without prop drilling (YAZ-6190 Extra #3). */
const autoSyncCache = new Map<string, AutoSyncStatus>()
const autoSyncListeners = new Set<() => void>()

function publishAutoSync(root: string, next: AutoSyncStatus): void {
  const prev = autoSyncCache.get(root)
  if (prev !== undefined && prev.installed === next.installed && prev.vaultSynced === next.vaultSynced && prev.supportsDeepLink === next.supportsDeepLink) return
  autoSyncCache.set(root, next)
  for (const listener of autoSyncListeners) listener()
}

export function getCachedAutoSync(root: string): AutoSyncStatus | null {
  return autoSyncCache.get(root) ?? null
}

export function subscribeAutoSync(listener: () => void): () => void {
  autoSyncListeners.add(listener)
  return () => autoSyncListeners.delete(listener)
}

export interface GithubSyncState {
  /** null until the first fetch resolves; a vault with sync off is `state: 'off'`, never null. */
  status: GithubSyncStatus | null
  /** Read-only detection of the separate GitHub AutoSync Mac app for this vault (YAZ-6190, D3/Extra #8). */
  autoSync?: AutoSyncStatus | null
  /** Fire-and-forget manual pass (the chip's click); the status push updates the UI. */
  syncNow: () => void
  /** The per-vault switch (D4); same fire-and-forget posture as `syncNow`. */
  setEnabled: (enabled: boolean) => void
  /** Re-checks GitHub AutoSync config.json for this vault. */
  refreshAutoSync?: () => void
  /** 1-click add this vault to GitHub AutoSync via deep link (or open app on older builds). */
  addToAutoSync?: () => Promise<AddToAutoSyncResult>
  /** Opens GitHub AutoSync.app if installed. */
  openAutoSync?: () => void
}

/**
 * `root` is nullable for the same reason `useProperties`' is — App owns ONE of these and hooks
 * cannot be conditional, so a window with no vault open must make no bridge call at all. A null
 * root has a null status and inert actions.
 */
export function useGithubSync(root: string | null): GithubSyncState {
  const [status, setStatus] = useState<GithubSyncStatus | null>(null)
  const [autoSync, setAutoSync] = useState<AutoSyncStatus | null>(null)
  // Bumped on unmount/root change AND on every broadcast: only a still-fresh call may commit.
  const generation = useRef(0)

  const fetchAutoSync = useCallback((target: string, isCurrent: () => boolean) => {
    if (typeof api.github.autoSyncStatus !== 'function') return
    api.github.autoSyncStatus(target).then(
      (res) => {
        publishAutoSync(target, res)
        if (isCurrent()) setAutoSync(res)
      },
      () => undefined,
    )
  }, [])

  useEffect(() => {
    const gen = ++generation.current
    setStatus(null)
    setAutoSync(null)
    if (root === null) return
    let active = true
    const isCurrent = () => active
    api.github.status(root).then(
      (res) => {
        if (gen !== generation.current) return
        setStatus(res)
      },
      () => {
        // Keep the last status (none, on a first fetch): the engine broadcasts its own
        // attention states, so a failed read is not something to invent a state for.
      },
    )
    fetchAutoSync(root, isCurrent)
    // Extra #8: re-check GitHub AutoSync when the window regains focus so 1-click adds reflect automatically.
    const onFocus = () => fetchAutoSync(root, isCurrent)
    window.addEventListener('focus', onFocus)
    const unsubscribe = api.github.onStatus((res) => {
      if (res.root !== root) return
      generation.current++ // a broadcast is always fresher than any in-flight call
      setStatus(res)
    })
    return () => {
      active = false
      generation.current++
      window.removeEventListener('focus', onFocus)
      unsubscribe()
    }
  }, [root, fetchAutoSync])

  // The resolved status of a mutation commits too, guarded the same way. The broadcast usually
  // beats it; both land on the same object, so whichever arrives second is a no-op re-render.
  const commit = useCallback((gen: number, res: GithubSyncStatus) => {
    if (gen !== generation.current) return
    setStatus(res)
  }, [])

  const syncNow = useCallback(() => {
    if (root === null) return
    const gen = generation.current
    api.github.syncNow(root).then(
      (res) => commit(gen, res),
      () => undefined,
    )
  }, [root, commit])

  const setEnabled = useCallback(
    (enabled: boolean) => {
      if (root === null) return
      const gen = generation.current
      api.github.setEnabled(root, enabled).then(
        (res) => commit(gen, res),
        () => undefined,
      )
    },
    [root, commit],
  )

  const refreshAutoSync = useCallback(() => {
    if (root === null) return
    fetchAutoSync(root, () => true)
  }, [root, fetchAutoSync])

  const addToAutoSync = useCallback(async (): Promise<AddToAutoSyncResult> => {
    if (root === null || typeof api.github.addToAutoSync !== 'function') return { ok: false, method: 'not-installed' }
    const res = await api.github.addToAutoSync(root)
    setTimeout(() => fetchAutoSync(root, () => true), 600)
    return res
  }, [root, fetchAutoSync])

  const openAutoSync = useCallback(() => {
    if (typeof api.github.openAutoSync !== 'function') return
    void api.github.openAutoSync().catch(() => undefined)
  }, [])

  return { status, autoSync, syncNow, setEnabled, refreshAutoSync, addToAutoSync, openAutoSync }
}
