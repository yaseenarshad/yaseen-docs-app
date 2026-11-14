import { describe, expect, it } from 'vitest'
import { friendStats, type FriendVault } from '@shared/friendStats'
import { DEFAULT_REVIEW_SETTINGS } from '@shared/reviews'
import type { CardRecord } from '@shared/cardLine'
import type { IndexRecord } from '@shared/types'
import { memoryBackend, openVaultStore, saveVaultList, vaultId, type PhoneVault } from '../store'
import type { SyncEvent } from '../sync/engine'
import { INDEX_STATE } from '../sync/phoneIndex'
import { uiSlicer } from '../sync/yieldToUi'
import { createOwnNumbers } from './ownNumbers'

/**
 * YAZ-5255: my own numbers are counted ONCE for each change of the vault's data (a sync pass that changed it, or a new
 * local day), in steps that give the UI thread back, and kept. The Friends tab and the sender (4E1) share that count.
 */
const NOW = new Date(2026, 10, 13, 12).getTime()
const pad = (n: number) => String(n).padStart(2, '0')
const at = (t: number) => {
  const d = new Date(t)
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}T${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}Z`
}
/** `pages` pages of `per` cards, each with `answers` answers spread over the last 365 days. */
function records(pages: number, per: number, answers: number): Record<string, IndexRecord> {
  const out: Record<string, IndexRecord> = {}
  let n = 0
  for (let p = 0; p < pages; p++) {
    const cards: CardRecord[] = []
    for (let c = 0; c < per; c++, n++) {
      const reviews = Array.from({ length: answers }, (_, i) => ({
        at: at(NOW - (365 - Math.floor((i * 365) / answers) - (n % 7)) * 86_400_000),
        rating: (i % 5 === 0 ? 'again' : 'good') as 'again' | 'good',
        seconds: 8,
      }))
      cards.push({ id: `CARD-${n}`, off: false, next: false, reviews })
    }
    out[`p${p}.md`] = { cards } as unknown as IndexRecord
  }
  return out
}
async function phone(index: Record<string, IndexRecord>) {
  const store = await openVaultStore(memoryBackend(), { now: () => NOW })
  const v: PhoneVault = { repo: 'demo/vault', branch: 'main', addedAt: 1 }
  await saveVaultList(store, { vaults: [v], open: vaultId(v) })
  await store.setState(vaultId(v), INDEX_STATE, { commit: 'c1', records: index })
  return { store, id: vaultId(v) }
}
function engine() {
  const listeners = new Set<(e: SyncEvent) => void>()
  return {
    subscribe: (l: (e: SyncEvent) => void) => (listeners.add(l), () => void listeners.delete(l)),
    emit: (e: SyncEvent) => listeners.forEach((l) => l(e)),
  }
}

describe('my own numbers (YAZ-5255)', () => {
  it('one count for each change: two reads count once; a sync change or a new day counts again', async () => {
    const { store, id } = await phone(records(10, 10, 3))
    let counts = 0
    const own = createOwnNumbers(store, { onCount: () => counts++ })
    const e = engine()
    own.follow(e)
    const a = await own.counted(['demo/vault'], NOW)
    const b = await own.counted(['demo/vault'], NOW + 60_000)
    expect(counts).toBe(1)
    expect(b).toBe(a)
    expect(a?.totals.cards).toBe(100)
    // Two reads at the same time share ONE count.
    e.emit({ type: 'changed', vault: id, settings: [], diff: null } as unknown as SyncEvent)
    await Promise.all([own.counted(['demo/vault'], NOW), own.counted(['demo/vault'], NOW)])
    expect(counts).toBe(2)
    await own.counted(['demo/vault'], NOW + 86_400_000)
    expect(counts).toBe(3)
    // A vault that is not on the phone: null, no count.
    expect(await own.counted(['other/vault'], NOW)).toBeNull()
  })

  it('20,000 cards with 10 answers each: no step holds the UI thread for 50 ms; the same numbers as friendStats', async () => {
    const index = records(5000, 4, 10)
    const { store } = await phone(index)
    // YAZ-5296: the work between two yields in CPU time of THIS thread (as 4C's search test): the load of the machine
    // does not count, and the limit stays 50 ms.
    const cpu = () => {
      const u = process.threadCpuUsage()
      return (u.user + u.system) / 1000
    }
    const work: number[] = []
    let last = cpu()
    const slice = uiSlicer(async () => {
      work.push(cpu() - last)
      await new Promise((r) => setTimeout(r, 0))
      last = cpu()
    })
    const own = createOwnNumbers(store, { slicer: () => slice })
    // The open vault: the engine holds its index, so the count reads nothing from the store.
    own.follow({ subscribe: () => () => undefined, index: () => ({ commit: 'c1', records: index }), state: () => ({ vault: 'demo/vault@main' }) })
    last = cpu()
    const counted = await own.counted(['demo/vault'], NOW)
    work.push(cpu() - last)
    const longest = Math.max(...work)
    console.info(`[perf] own numbers, 20,000 cards x 10 answers: ${work.length} slices, longest ${longest.toFixed(1)} ms CPU`)
    expect(work.length).toBeGreaterThan(10)
    expect(longest).toBeLessThan(50)
    const vaults: FriendVault[] = [{ pages: Object.values(index), settings: DEFAULT_REVIEW_SETTINGS }]
    expect({ ...counted, at: '' }).toEqual({ ...friendStats(vaults, NOW), at: '' })
  }, 60_000)
})
