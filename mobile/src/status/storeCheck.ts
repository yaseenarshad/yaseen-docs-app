import { useEffect, useState } from 'react'
import type { VaultStore } from '../store'
import { LAST_SYNC_STATE } from './lastSync'

/**
 * YAZ-5302: "Checking…" must end. The dot waits until the answer list has read its stored answers (YAZ-5297). If the
 * phone's store never answers (IndexedDB blocked, a full phone, a version change held by another tab), that never
 * happens. So after `checkMs` the dot asks the store itself, with a limit of `probeMs`:
 *  - no answer, or an error: `store` (red "Phone can't save", the app's own store-failure words);
 *  - an answer: `list` (the store works; the sync could not start: grey "Can't sync now").
 * It asks again each `checkMs` while the list is not there, so a store that comes back clears it.
 */
export const DOT_TIMES = { checkMs: 4_000, probeMs: 2_000 }

export type Stuck = 'store' | 'list' | null

export function useStuck(store: VaultStore, vault: string | null, loaded: boolean): Stuck {
  const [stuck, setStuck] = useState<{ vault: string | null; why: Stuck }>({ vault: null, why: null })
  useEffect(() => {
    if (vault === null || loaded) {
      setStuck({ vault, why: null })
      return
    }
    let live = true
    let timer: ReturnType<typeof setTimeout> | null = null
    const probe = async (): Promise<Stuck> => {
      let limit: ReturnType<typeof setTimeout> | null = null
      try {
        const answer = await Promise.race([
          store.getState(vault, LAST_SYNC_STATE).then(() => 'list' as const),
          new Promise<'store'>((resolve) => (limit = setTimeout(() => resolve('store'), DOT_TIMES.probeMs))),
        ])
        return answer
      } catch {
        return 'store'
      } finally {
        if (limit !== null) clearTimeout(limit)
      }
    }
    const check = () => {
      timer = setTimeout(() => {
        void probe().then((why) => {
          if (!live) return
          setStuck({ vault, why })
          check()
        })
      }, DOT_TIMES.checkMs)
    }
    check()
    return () => {
      live = false
      if (timer !== null) clearTimeout(timer)
    }
  }, [store, vault, loaded])
  return stuck.vault === vault && !loaded ? stuck.why : null
}
