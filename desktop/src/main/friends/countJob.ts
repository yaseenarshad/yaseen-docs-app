import { Worker } from 'node:worker_threads'
import type { FriendStats, FriendVault } from '@shared/friendStats'

/**
 * The Mac's card count OFF the main thread (YAZ-5250): `friendStats` of 20,000 cards takes most of a second of CPU, and
 * the main process serves every window. Main only packs what the count reads (each card's ID, its archive mark and its
 * answers; the review settings) into ONE JSON text, about 15 ms for 20,000 cards, and waits. A worker thread
 * (`countWorker.ts`) parses it, counts with the SAME `friendStats`, and answers. One short thread per count, as the
 * storage jobs (`storageJob.ts`). The pack holds no title, no path and no card text.
 */


/** The text main hands the worker: only what `friendStats` reads. */
export function countPayload(vaults: readonly FriendVault[]): string {
  return JSON.stringify(
    vaults.map((v) => ({
      settings: v.settings,
      pages: v.pages.flatMap((p) => (p.cards === undefined || p.cards.length === 0 ? [] : [{ cards: p.cards.map((c) => ({ id: c.id, off: c.off, reviews: c.reviews })) }])),
    })),
  )
}

export interface CountJob {
  text: string
  now: number
}

/** The count on a fresh worker thread. `workerFile` is the built `countWorker.ts` (`?modulePath` in `friends/index.ts`). */
export function countOffThread(workerFile: string, vaults: readonly FriendVault[], now: number): Promise<Omit<FriendStats, 'login' | 'name' | 'avatar'>> {
  return countTextOffThread(workerFile, countPayload(vaults), now)
}

/** The same, for cards already packed (`countPayload`): the Mac's sender packs once, for its hash and for the count. */
export function countTextOffThread(workerFile: string, text: string, now: number): Promise<Omit<FriendStats, 'login' | 'name' | 'avatar'>> {
  const job: CountJob = { text, now }
  return new Promise((resolve, reject) => {
    const worker = new Worker(workerFile, { workerData: job })
    worker.once('message', resolve)
    worker.once('error', reject)
    worker.once('exit', (code) => reject(new Error(`count worker exited with code ${code} before answering`)))
  })
}
