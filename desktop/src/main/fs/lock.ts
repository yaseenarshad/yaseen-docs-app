/**
 * One maker at a time for `key` on this Mac, across the app and the command (YAZ-4269 D2): a file made with `wx` in
 * `<app data>/locks` (`LOCK_DIR`), never in the vault, so no sync carries it. It holds the maker's process id, and it
 * goes when the work ends. At most one file for each note, or each vault's ID count (`mint.ts`), being made.
 */
import { createHash } from 'node:crypto'
import { mkdir, open, readFile, rm, stat } from 'node:fs/promises'
import path from 'node:path'

export const LOCK_DIR = 'locks'
/** A lock file with no process id it can read (a maker killed between its create and its write) is a dead one's after this. */
const STALE_MS = 30_000
/** No maker holds a lock this long: an older file's id is a process that took a dead maker's number. */
const HELD_MAX_MS = 10 * 60_000
const WAIT_MS = 50
const GIVE_UP_MS = 10_000

/** True when the maker that holds the lock file is gone: its process has ended, or it left no id and the file is old. */
async function deadHolder(file: string): Promise<boolean> {
  const [text, held] = await Promise.all([readFile(file, 'utf8').catch(() => null), stat(file).catch(() => null)])
  if (held === null) return false // gone meanwhile: the next try takes it
  if (Date.now() - held.mtimeMs > HELD_MAX_MS) return true
  const pid = Number(text)
  if (!Number.isInteger(pid) || pid <= 0) return Date.now() - held.mtimeMs > STALE_MS
  try {
    process.kill(pid, 0)
    return false
  } catch (err) {
    // EPERM: a live process of another user; only "no such process" is a dead holder.
    return (err as NodeJS.ErrnoException).code === 'ESRCH'
  }
}

/**
 * `work`, while no other maker of this Mac holds `key`; `dir` is `<app data>/locks` of that Mac. A maker that was killed (Ctrl-C, a timeout) leaves its file:
 * the next one sees that its process is gone and takes over at once. A live holder is never taken over; after
 * `GIVE_UP_MS` the wait fails with a reason. (Two makers that both see one dead holder at the same moment can each
 * take over; the second `wx` of them still fails, so one of them waits again.)
 */
export async function onlyOne<T>(dir: string, key: string, work: () => Promise<T>): Promise<T> {
  const file = path.join(dir, `${createHash('sha1').update(key).digest('hex')}.lock`)
  await mkdir(dir, { recursive: true })
  for (const start = Date.now(); ; ) {
    try {
      const handle = await open(file, 'wx')
      await handle.writeFile(String(process.pid)).finally(() => handle.close())
      break
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'EEXIST') throw err
      if (await deadHolder(file)) await rm(file, { force: true })
      else if (Date.now() - start > GIVE_UP_MS) throw new Error('another maker of this note did not finish — try again')
      else await new Promise((resolve) => setTimeout(resolve, WAIT_MS))
    }
  }
  try {
    return await work()
  } finally {
    await rm(file, { force: true })
  }
}
