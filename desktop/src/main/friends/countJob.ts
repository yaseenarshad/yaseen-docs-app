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

/** Pages packed in one go by `countPayloadSliced`: about 2 ms of main's time for cards with many answers. */
const PAGES_AT_ONCE = 500

/**
 * The SAME text as `countPayload` (byte for byte), built in slices with a turn of the event loop between them
 * (YAZ-5252: the main thread's longest block). One `JSON.stringify` of 20,000 cards held main for about 15 ms.
 */
export async function countPayloadSliced(vaults: readonly FriendVault[], turn: () => Promise<void>): Promise<string> {
  const out: string[] = []
  for (const v of vaults) {
    const pages = v.pages.filter((p) => p.cards !== undefined && p.cards.length > 0)
    const parts: string[] = []
    for (let i = 0; i < pages.length; i += PAGES_AT_ONCE) {
      const chunk = JSON.stringify(pages.slice(i, i + PAGES_AT_ONCE).map((p) => ({ cards: p.cards!.map((c) => ({ id: c.id, off: c.off, reviews: c.reviews })) })))
      parts.push(chunk.slice(1, -1))
      await turn()
    }
    const settings = v.settings === undefined ? '' : `"settings":${JSON.stringify(v.settings)},`
    out.push(`{${settings}"pages":[${parts.join(',')}]}`)
  }
  return `[${out.join(',')}]`
}

export interface CountJob {
  text: string
  now: number
  /** YAZ-5251: the person's home time zone (`FriendsIndex.zone`); null: this Mac's own zone. */
  zone?: string | null
  /**
   * YAZ-5252: the closed vaults that count, in the SAME worker, with their change keys. The worker scans each one
   * (`scanVault.ts`) unless its own cache holds the pack of the same key. Main never holds a closed vault's pack.
   */
  closed?: { root: string; key: string }[]
  /** YAZ-5390: the scan's own cache folder (`<userData>/friends-scan`), and the app's index cache folder. */
  scanDir?: string
  indexDir?: string
}

/** Why a closed vault was skipped: a link inside it (or a path that leaves it), or a read that failed. */
export type ClosedVaultWhy = 'symlink' | 'unreadable'

/**
 * What the worker answers. `stats` null: a closed vault could not be read (`failed`), so no count (a count without a
 * vault that counts is not sent). `scanned`: the closed vaults it walked; `read`: the files it read (tests).
 */
export interface CountAnswer {
  stats: Omit<FriendStats, 'login' | 'name' | 'avatar'> | null
  failed: { root: string; why: ClosedVaultWhy }[]
  scanned: string[]
  read: number
  /** The closed vaults' scans in the worker: wall time, and the worker thread's own CPU time (ms; tests and logs). */
  scanMs: number
  scanCpuMs: number
  /** The whole job's CPU time on the worker thread (the scans and the count; ms). */
  cpuMs: number
}

/**
 * YAZ-5388: one closed vault that cannot be read never stops the others: the worker scans each one and answers. The
 * count then fails with this, naming each vault it skipped and why; Settings says "could not be read".
 */
export class ClosedVaultsUnreadable extends Error {
  constructor(readonly vaults: { root: string; why: ClosedVaultWhy }[]) {
    super(`${vaults.length === 1 ? '1 closed vault' : `${vaults.length} closed vaults`} could not be read (${[...new Set(vaults.map((v) => v.why))].join(', ')})`)
  }
}

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
  const answer = await countJobOffThread(workerFile, { text, now, zone }, limitMs)
  if (answer.stats === null) throw new ClosedVaultsUnreadable(answer.failed)
  return answer.stats
}

export interface CounterOptions {
  /** YAZ-5390: the scan's own cache (`<userData>/friends-scan`). None: each count reads every closed vault whole. */
  scanDir?: string
  /** The app's index cache (`<userData>/index-cache`), read for a vault that was open once. */
  indexDir?: string
  limitMs?: number
}

/**
 * The app's count (YAZ-5250, YAZ-5252): the open vaults' pack, and the closed vaults that count. A closed vault is
 * scanned in the worker only when its change key moved since the last scan; the worker keeps the pack in its own cache
 * on disk (`scanDir`), so main never holds it, never clones it, and it lasts after a restart. A closed vault that
 * cannot be read: `ClosedVaultsUnreadable`. `scanned()` names the vaults that the last count scanned, `read()` the
 * files it read, `timing()` the time of the scans in the worker (tests).
 */
export function makeCounter(workerFile: string, opts: CounterOptions = {}) {
  let last: string[] = []
  let files = 0
  let timing = { scanMs: 0, scanCpuMs: 0, cpuMs: 0 }
  const count = async (text: string, now: number, closed: readonly { root: string; key: string }[] = [], zone: string | null = null) => {
    const job: CountJob = { text, now, zone, closed: closed.map((c) => ({ root: c.root, key: c.key })), scanDir: opts.scanDir, indexDir: opts.indexDir }
    const answer = await countJobOffThread(workerFile, job, opts.limitMs ?? COUNT_LIMIT_MS)
    last = answer.scanned
    files = answer.read
    timing = { scanMs: answer.scanMs, scanCpuMs: answer.scanCpuMs, cpuMs: answer.cpuMs }
    if (answer.stats === null) throw new ClosedVaultsUnreadable(answer.failed)
    return answer.stats
  }
  return Object.assign(count, { scanned: () => last, read: () => files, timing: () => timing })
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
