import { friendStatsSliced, type FriendStats } from '@shared/friendStats'
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
}

export type Counted = Omit<FriendStats, 'login' | 'name' | 'avatar'>

export interface OwnNumbers {
  /** The count for these vaults (`owner/name`, lower case), or null when the phone does not hold all of them. */
  counted(repos: readonly string[], now: number): Promise<Counted | null>
  /** The data changed: the next read counts again. */
  invalidate(): void
  /** Counts again after each sync change of the engine (3B). Returns the stop. */
  follow(engine: HeldEngine): () => void
}

const pad = (n: number) => String(n).padStart(2, '0')
const localDay = (t: number) => {
  const d = new Date(t)
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

export function createOwnNumbers(store: VaultStore, options: { slicer?: () => () => Promise<void>; onCount?: () => void } = {}): OwnNumbers {
  let generation = 0
  let engine: HeldEngine | null = null
  const held = (vault: string) => (engine !== null && engine.state?.().vault === vault ? engine.index?.() ?? null : null)
  let kept: { key: string; value: Promise<Counted | null> } | null = null
  const own: OwnNumbers = {
    counted(repos, now) {
      const key = `${generation}|${localDay(now)}|${[...new Set(repos.map((r) => r.toLowerCase()))].sort().join(',')}`
      if (kept !== null && kept.key === key) return kept.value
      const value = (async () => {
        const vaults = await countedVaults(store, repos, held)
        if (vaults === null) return null
        options.onCount?.()
        return friendStatsSliced(vaults, now, (options.slicer ?? (() => uiSlicer()))())
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
      const stop = e.subscribe((event) => {
        if (event.type === 'changed') own.invalidate()
      })
      return () => {
        stop()
        if (engine === e) engine = null
      }
    },
  }
  return own
}
