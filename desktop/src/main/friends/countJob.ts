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
  /** YAZ-5251: the person's home time zone (`FriendsIndex.zone`); null: this Mac's own zone. */
  zone?: string | null
  /**
   * YAZ-5252: the closed vaults that count, in the SAME worker. `text`: the packed cards of the last scan (its folder
   * did not change), or null: the worker scans the folder now (`scanVault.ts`) and sends the pack back.
   */
  closed?: { root: string; text: string | null }[]
}

/** What the worker answers: the count, and the packs of the closed vaults that it scanned (for the next count). */
export interface CountAnswer {
  stats: Omit<FriendStats, 'login' | 'name' | 'avatar'>
  scanned: { root: string; text: string }[]
}

/** One vault's pack (the object, not the list): what the worker keeps of a scan. */
export const vaultPack = (v: FriendVault): string => countPayload([v]).slice(1, -1)

/** The count on a fresh worker thread. `workerFile` is the built `countWorker.ts` (`?modulePath` in `friends/index.ts`). */
export function countOffThread(workerFile: string, vaults: readonly FriendVault[], now: number, zone: string | null = null): Promise<Omit<FriendStats, 'login' | 'name' | 'avatar'>> {
  return countTextOffThread(workerFile, countPayload(vaults), now, COUNT_LIMIT_MS, zone)
}

/**
 * The time limit of one count (YAZ-5278). `friendStats` is one finite pass (about 1 s for 20,000 cards), so a count
 * past this is broken: the worker is ended and the count fails. The next card change starts a new one.
 */
export const COUNT_LIMIT_MS = 60_000

/** The same, for cards already packed (`countPayload`): the Mac's sender packs once, for its hash and for the count. */
export async function countTextOffThread(workerFile: string, text: string, now: number, limitMs = COUNT_LIMIT_MS, zone: string | null = null): Promise<Omit<FriendStats, 'login' | 'name' | 'avatar'>> {
  return (await countJobOffThread(workerFile, { text, now, zone }, limitMs)).stats
}

/**
 * The app's count (YAZ-5250, YAZ-5252): the open vaults' pack, and the closed vaults that count. A closed vault is
 * scanned in the worker only when its change key moved since the last scan (the pack is kept here, in main's memory, as
 * one text). `scanned()` names the vaults that the last count scanned (tests).
 */
export function makeCounter(workerFile: string, limitMs = COUNT_LIMIT_MS) {
  const kept = new Map<string, { key: string; text: string }>()
  let last: string[] = []
  const count = async (text: string, now: number, closed: readonly { root: string; key: string }[] = [], zone: string | null = null) => {
    const job: CountJob = { text, now, zone, closed: closed.map((c) => ({ root: c.root, text: kept.get(c.root)?.key === c.key ? kept.get(c.root)!.text : null })) }
    const answer = await countJobOffThread(workerFile, job, limitMs)
    last = answer.scanned.map((x) => x.root)
    for (const x of answer.scanned) kept.set(x.root, { key: closed.find((c) => c.root === x.root)!.key, text: x.text })
    for (const root of [...kept.keys()]) if (!closed.some((c) => c.root === root)) kept.delete(root)
    return answer.stats
  }
  return Object.assign(count, { scanned: () => last })
}

function countJobOffThread(workerFile: string, job: CountJob, limitMs: number): Promise<CountAnswer> {
  return new Promise((resolve, reject) => {
    const worker = new Worker(workerFile, { workerData: job })
    const limit = setTimeout(() => {
      reject(new Error('the count worker did not answer in time'))
      void worker.terminate()
    }, limitMs)
    limit.unref?.()
    worker.once('message', (answer: CountAnswer) => {
      clearTimeout(limit)
      resolve(answer)
    })
    worker.once('error', (err) => {
      clearTimeout(limit)
      reject(err)
    })
    worker.once('exit', (code) => {
      clearTimeout(limit)
      reject(new Error(`count worker exited with code ${code} before answering`))
    })
  })
}
