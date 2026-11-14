import { afterEach, describe, expect, it } from 'vitest'
import { friendStats, type FriendVault } from '@shared/friendStats'
import { DEFAULT_REVIEW_SETTINGS } from '@shared/reviews'
import type { CardRecord } from '@shared/cardLine'
import type { IndexRecord } from '@shared/types'
import { memoryBackend, openVaultStore, saveVaultList, vaultId, type PhoneVault, type VaultStore } from '../store'
import type { SyncEvent } from '../sync/engine'
import { INDEX_STATE, type PhoneIndex } from '../sync/phoneIndex'
import { createOwnNumbers } from './ownNumbers'

/**
 * YAZ-5295: after EACH step of a random order (an answer, Undo, a sync pass, a vault switch while the old pass still
 * runs, the end of that old pass, midnight, a change of time zone), my kept row equals a fresh `friendStats` over the
 * stored indexes of the vaults that count. The fake engine follows 3B's `engine.ts`: `open` loads the stored index
 * (`changed`); a pass writes the index, and tells (`changed`) only when its vault is still the open one; the pass of
 * the vault that WAS open runs to its end and tells nobody; one pass runs at a time; `idle()` waits for it.
 */
const ZONE = process.env.TZ
afterEach(() => {
  process.env.TZ = ZONE
})

const pad = (n: number) => String(n).padStart(2, '0')
const at = (t: number) => {
  const d = new Date(t)
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}T${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}Z`
}

/** A tiny random source with a seed, so a failing order can be run again. */
function rng(seed: number) {
  let s = seed >>> 0
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0
    return s / 2 ** 32
  }
}

function fakeEngine(store: VaultStore) {
  const listeners = new Set<(e: SyncEvent) => void>()
  let open: string | null = null
  let index: PhoneIndex | null = null
  let generation = 0
  const passes = new Set<Promise<void>>()
  const emit = (e: SyncEvent) => listeners.forEach((l) => l(e))
  return {
    subscribe: (l: (e: SyncEvent) => void) => (listeners.add(l), () => void listeners.delete(l)),
    index: () => index,
    state: () => ({ vault: open }),
    idle: async () => {
      while (passes.size > 0) await Promise.all([...passes])
    },
    async open(vault: string) {
      generation++
      open = vault
      emit({ type: 'state', state: { status: 'synced', vault, problem: null, retryAt: null, progress: null, ready: true } } as SyncEvent)
      index = (await store.getState<PhoneIndex>(vault, INDEX_STATE)) ?? null
      emit({ type: 'changed', vault, settings: [], diff: null } as unknown as SyncEvent)
    },
    /** A pass of the open vault that adds `cards` answered cards; it ends when `release` is called. */
    pass(add: (index: PhoneIndex) => PhoneIndex) {
      const vault = open!
      const mine = generation
      let release!: () => void
      const run = new Promise<void>((r) => (release = r)).then(async () => {
        const next = add((await store.getState<PhoneIndex>(vault, INDEX_STATE))!)
        await store.setState(vault, INDEX_STATE, next)
        if (mine === generation && open === vault) {
          index = next
          emit({ type: 'changed', vault, settings: [], diff: null } as unknown as SyncEvent)
        }
      })
      passes.add(run)
      void run.finally(() => passes.delete(run))
      return { release: () => release(), done: run }
    },
  }
}

const addAnswered =
  (now: number, n: number) =>
  (index: PhoneIndex): PhoneIndex => {
    const cards: CardRecord[] = Array.from({ length: n }, (_, i) => ({
      id: `N-${index.commit}-${i}`,
      off: false,
      next: false,
      reviews: [{ at: at(now - 60_000), rating: 'good' }],
    }))
    return { commit: `${index.commit}+`, records: { ...index.records, [`p${index.commit}.md`]: { cards } as unknown as IndexRecord } }
  }

describe('my kept row equals a fresh count after each step (YAZ-5295)', () => {
  it('random orders of answer, Undo, sync, vault switch, the old pass ending, midnight and a zone change', async () => {
    const ZONES = ['Asia/Karachi', 'America/Denver', 'Pacific/Auckland', 'UTC']
    let failures = 0
    for (let seed = 1; seed <= 100; seed++) {
      const random = rng(seed)
      process.env.TZ = 'Asia/Karachi'
      let now = Date.UTC(2026, 10, 13, 10)
      const store = await openVaultStore(memoryBackend(), { now: () => now })
      const vaults: PhoneVault[] = [
        { repo: 'demo/a', branch: 'main', addedAt: 1 },
        { repo: 'demo/b', branch: 'main', addedAt: 2 },
      ]
      await saveVaultList(store, { vaults, open: vaultId(vaults[0]) })
      for (const v of vaults) await store.setState(vaultId(v), INDEX_STATE, addAnswered(now, 2)({ commit: v.repo, records: {} }))
      const engine = fakeEngine(store)
      const own = createOwnNumbers(store, { slicer: () => async () => undefined })
      own.follow(engine)
      await engine.open(vaultId(vaults[0]))
      const repos = ['demo/a', 'demo/b']
      const running: { release: () => void; done: Promise<void> }[] = []
      const log: string[] = []
      for (let step = 0; step < 25; step++) {
        const pick = Math.floor(random() * 7)
        if (pick === 0 || pick === 1) {
          // An answer or an Undo on the phone: it waits in the answer list; the stored index does not change.
          log.push(pick === 0 ? 'answer' : 'undo')
        } else if (pick === 2 && running.length === 0) {
          // 3B runs one pass at a time.
          log.push('sync')
          running.push(engine.pass(addAnswered(now, 1 + Math.floor(random() * 3))))
        } else if (pick === 3) {
          log.push('switch')
          const other = engine.state().vault === vaultId(vaults[0]) ? vaults[1] : vaults[0]
          await engine.open(vaultId(other))
        } else if (pick === 4 && running.length > 0) {
          log.push('pass ends')
          const p = running.shift()!
          p.release()
          await p.done
        } else if (pick === 5) {
          log.push('midnight')
          now += 24 * 3600_000
        } else {
          const zone = ZONES[Math.floor(random() * ZONES.length)]
          log.push(`zone ${zone}`)
          process.env.TZ = zone
        }
        // The next read (the tab reads each minute): what the step started has settled.
        await new Promise((r) => setTimeout(r, 0))
        const kept = await own.counted(repos, now)
        const fresh: FriendVault[] = []
        for (const v of vaults)
          fresh.push({ pages: Object.values((await store.getState<PhoneIndex>(vaultId(v), INDEX_STATE))!.records), settings: DEFAULT_REVIEW_SETTINGS })
        const want = { ...friendStats(fresh, now), at: '' }
        if (JSON.stringify({ ...kept, at: '' }) !== JSON.stringify(want)) {
          failures++
          console.info(`[property] seed ${seed} differs after: ${log.join(', ')}`)
          break
        }
      }
      for (const p of running) p.release()
      await engine.idle()
    }
    expect(failures).toBe(0)
  }, 60_000)
})
