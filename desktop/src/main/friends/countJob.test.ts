/**
 * YAZ-5250 (4E5b): the Mac's card count runs OFF the main thread. Main only packs the cards (one JSON text) and waits;
 * a worker thread counts. A made-up vault of 5,000 pages and 20,000 cards (about 100,000 answers over 90 days).
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { build } from 'esbuild'
import { friendStats, type FriendVault } from '@shared/friendStats'
import { DEFAULT_REVIEW_SETTINGS } from '@shared/reviews'
import { budgetMs, median } from '../../../../client/src/test-perf'
import { writeFile } from 'node:fs/promises'
import { COUNT_LIMIT_MS, countOffThread, countPayload, countTextOffThread } from './countJob'

const TZ = process.env.TZ
beforeAll(() => void (process.env.TZ = 'America/New_York'))
afterAll(() => void (process.env.TZ = TZ))

const NOW = Date.parse('2026-11-14T15:00:00Z')
let seed = 7
const rnd = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648
const RATINGS = ['again', 'hard', 'good', 'easy'] as const
/** 5,000 pages of 4 cards, each with 0 to 10 answers in the last 90 days, and words that must not leave (title, path). */
const VAULT = {
  pages: Array.from({ length: 5000 }, (_, p) => ({
    path: `/Users/me/Vault/Secret page ${p}.md`,
    title: `Secret page ${p}`,
    cards: Array.from({ length: 4 }, (_, c) => ({
      id: `C-${p}-${c}`,
      title: `Secret card text ${p}-${c}`,
      off: c === 3 && p % 50 === 0,
      next: false,
      reviews: Array.from({ length: Math.floor(rnd() * 11) }, () => ({ at: new Date(NOW - Math.floor(rnd() * 90 * 86_400_000)).toISOString().slice(0, 16) + 'Z', rating: RATINGS[Math.floor(rnd() * 4)], seconds: 5 })),
    })),
  })),
  settings: DEFAULT_REVIEW_SETTINGS,
} as unknown as FriendVault

/** The longest the event loop went without running a 5 ms interval while `work` ran (as `storageJob.test.ts`). */
async function longestStall(work: () => Promise<unknown>): Promise<number> {
  let last = performance.now()
  let longest = 0
  const tick = setInterval(() => {
    const now = performance.now()
    longest = Math.max(longest, now - last)
    last = now
  }, 5)
  try {
    await work()
  } finally {
    clearInterval(tick)
  }
  return Math.max(longest, performance.now() - last)
}

let worker: string
beforeAll(async () => {
  worker = path.join(await mkdtemp(path.join(tmpdir(), 'yd-count-worker-')), 'countWorker.cjs')
  await build({
    entryPoints: [fileURLToPath(new URL('./countWorker.ts', import.meta.url))],
    outfile: worker,
    bundle: true,
    platform: 'node',
    format: 'cjs',
    alias: { '@shared': fileURLToPath(new URL('../../../../shared', import.meta.url)) },
    logLevel: 'silent',
  })
}, 60_000)

describe('the count off the main thread (YAZ-5250)', () => {
  it('the worker counts exactly what the count on main counts', async () => {
    expect(await countOffThread(worker, [VAULT], NOW)).toEqual(friendStats([VAULT], NOW))
  }, 60_000)

  it('the pack holds the cards only: no title, no path, no card text', () => {
    const text = countPayload([VAULT])
    for (const secret of ['Secret', '/Users/', '.md']) expect(text).not.toContain(secret)
  })

  it('the count of 20,000 cards holds the main thread less than 50 ms at a time', async () => {
    const stalls: number[] = []
    for (let i = 0; i < 3; i++) stalls.push(await longestStall(() => countOffThread(worker, [VAULT], NOW)))
    console.info(`the longest block on main, 3 runs: ${stalls.map((s) => s.toFixed(0)).join(', ')} ms`)
    expect(median(stalls)).toBeLessThan(budgetMs(50))
  }, 60_000)

  it('a worker that does not answer in time is ended, and the count fails (YAZ-5278)', async () => {
    expect(COUNT_LIMIT_MS).toBe(60_000)
    const stuck = path.join(path.dirname(worker), 'stuck.cjs')
    await writeFile(stuck, 'setInterval(() => {}, 1000)\n')
    const started = performance.now()
    await expect(countTextOffThread(stuck, '[]', NOW, 300)).rejects.toThrow(/did not answer/)
    expect(performance.now() - started).toBeLessThan(5_000)
  })
})
