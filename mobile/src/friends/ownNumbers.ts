import { dayIn, friendStatsSliced, type FriendStats } from '@shared/friendStats'
import type { VaultStore } from '../store'
import type { PhoneIndex } from '../sync/phoneIndex'
import type { SyncEvent } from '../sync/engine'
import { uiSlicer } from '../sync/yieldToUi'
import { countedVaults } from './friendsApi'

/**
 * MY OWN NUMBERS, counted once and kept (YAZ-5255). 2C's count runs over every card of each vault that counts: 94 ms
 * for 1,000 cards and 1.8 s for 20,000 on a Mac. So it runs:
 * - once for each change of the data: the vaults that count, a sync pass that changed the open vault (3B's `changed`
 *   event; the phone's index changes only in a pass), and a new local day (the due cards of a day);
 * - in steps (`friendStatsSliced` with 3B's `uiSlicer`), so no step holds the UI thread near 50 ms.
 * The Friends tab (my own row) and the sender (4E1, the numbers gist) read the SAME kept count. Two reads at the same
 * time share one count.
 */
/** What the count takes from 3B's engine: its events, and the open vault's index that it holds (no store read). */
export interface HeldEngine {
  subscribe(listener: (event: SyncEvent) => void): () => void
  index?(): PhoneIndex | null
  state?(): { vault: string | null }
  /** Resolves when no pass runs, also the pass of a vault that WAS open (3B lets it run to its end, and it tells nobody). */
  idle?(): Promise<void>
}

export type Counted = Omit<FriendStats, 'login' | 'name' | 'avatar'>

export interface OwnNumbers {
  /**
   * The count for these vaults (`owner/name`, lower case), or null when the phone does not hold all of them. `zone`
   * (YAZ-5251): the home time zone of the days; none is the phone's own zone.
   */
  counted(repos: readonly string[], now: number, zone?: string | null): Promise<Counted | null>
  /** The data changed: the next read counts again. */
  invalidate(): void
  /** Counts again after each sync change of the engine (3B). Returns the stop. */
  follow(engine: HeldEngine): () => void
}


export function createOwnNumbers(store: VaultStore, options: { slicer?: () => () => Promise<void>; onCount?: () => void } = {}): OwnNumbers {
  let generation = 0
  let engine: HeldEngine | null = null
  /**
   * The engine's index is used only while it is known to be the stored one. After a vault switch it is not: the pass of
   * the vault that was open can still write that vault's stored index (YAZ-5295). It is trusted again at the first
   * `changed` event after that pass ended; until then the count reads the store.
   */
  let trustHeld = true
  let settled = true
  const held = (vault: string) => (trustHeld && engine !== null && engine.state?.().vault === vault ? engine.index?.() ?? null : null)
  let kept: { key: string; value: Promise<Counted | null> } | null = null
  const own: OwnNumbers = {
    counted(repos, now, zone) {
      // YAZ-5295: every input of the count is in the key: the vaults that count, the open vault and the version of its
      // index (the engine's), the local day AND the zone (a zone change moves the day borders on the same date), and
      // the generation (YAZ-5251: the home zone and its day are in the key too) (each data change of any vault that counts: a `changed` event, a vault switch, and the end of
      // the pass of a vault that was open before).
      const open = engine?.state?.().vault ?? null
      const version = open === null ? '' : engine?.index?.()?.commit ?? ''
      const key = [
        generation,
        dayIn(now, zone),
        zone ?? '',
        new Date(now).getTimezoneOffset(),
        open,
        version,
        [...new Set(repos.map((r) => r.toLowerCase()))].sort().join(','),
      ].join('|')
      if (kept !== null && kept.key === key) return kept.value
      const value = (async () => {
        const vaults = await countedVaults(store, repos, held)
        if (vaults === null) return null
        options.onCount?.()
        return friendStatsSliced(vaults, now, (options.slicer ?? (() => uiSlicer()))(), zone)
      })()
      kept = { key, value }
      // A failed count is not kept: the next read tries again.
      value.catch(() => {
        if (kept?.value === value) kept = null
      })
      return value
    },
    invalidate() {
      generation++
      kept = null
    },
    follow(e) {
      engine = e
      let lastOpen = e.state?.().vault ?? null
      const stop = e.subscribe((event) => {
        if (event.type === 'changed') {
          if (settled) trustHeld = true
          own.invalidate()
        } else if (event.type === 'state' && event.state.vault !== lastOpen) {
          // A vault switch: the pass of the vault that was open runs on and writes its index with no event. Count again
          // now, and again when that pass has ended (YAZ-5295).
          lastOpen = event.state.vault
          trustHeld = false
          settled = false
          own.invalidate()
          void (e.idle?.() ?? Promise.resolve()).then(() => {
            if (engine !== e) return
            settled = true
            own.invalidate()
          })
        }
      })
      return () => {
        stop()
        if (engine === e) engine = null
      }
    },
  }
  return own
}
