import { useEffect, useState } from 'react'
import type { VaultStore } from '../store'

/**
 * YAZ-5297: the time of the last sync, kept on the phone (phone-only state of the vault). The engine knows only the
 * passes of this run, so after a cold open with no signal the sheet still says when the phone last synced.
 */
export const LAST_SYNC_STATE = 'lastSync'

/** The newest of the stored time, the engine's last pass and the list's last send; a newer time is stored. */
export function useLastSync(store: VaultStore, vault: string | null, pass: number | null | undefined, sent: number | null | undefined): number | null {
  const [stored, setStored] = useState<{ vault: string | null; at: number | null }>({ vault: null, at: null })
  useEffect(() => {
    let live = true
    if (vault === null) return
    void store
      .getState<number>(vault, LAST_SYNC_STATE)
      .then((at) => live && setStored({ vault, at: typeof at === 'number' ? at : null }))
      .catch(() => undefined)
    return () => {
      live = false
    }
  }, [store, vault])
  const known = stored.vault === vault ? stored.at : null
  const newest = Math.max(known ?? -1, pass ?? -1, sent ?? -1)
  const at = newest < 0 ? null : newest
  useEffect(() => {
    if (vault === null || at === null || stored.vault !== vault || at === known) return
    setStored({ vault, at })
    void store.setState(vault, LAST_SYNC_STATE, at).catch(() => undefined)
  }, [store, vault, at, known, stored.vault])
  return at
}
