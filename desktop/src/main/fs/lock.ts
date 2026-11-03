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
/** A take-over guard lives a few milliseconds; one this old is a maker's that died in that moment. */
const GUARD_MAX_MS = 5_000
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
 * Removes the lock `file` when its holder is dead, as ONE maker at a time (YAZ-4269 5C): the remover holds the guard
 * `<file>.takeover` (made with `wx`) and reads the lock again under it. Without the guard, two makers that both saw
 * the dead holder could each remove a file, and the later remove took away the live lock of a third maker that had
 * come in between. Under the guard the lock file cannot change hands: only a guard holder removes a dead one, and a
 * live one is never dead. A guard older than `GUARD_MAX_MS` is a maker's that died while it held it. True when this
 * maker removed the lock.
 */
async function takeOver(file: string): Promise<boolean> {
  const guard = `${file}.takeover`
  try {
    await (await open(guard, 'wx')).close()
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'EEXIST') throw err
    const held = await stat(guard).catch(() => null)
    if (held !== null && Date.now() - held.mtimeMs > GUARD_MAX_MS) await rm(guard, { force: true })
    return false // another maker removes it; the caller waits and tries again
  }
  try {
    if (!(await deadHolder(file))) return false
    await rm(file, { force: true })
    return true
  } finally {
    await rm(guard, { force: true })
  }
}

/**
 * `work`, while no other maker of this Mac holds `key`; `dir` is `<app data>/locks` of that Mac. A maker that was
 * killed (Ctrl-C, a timeout) leaves its file: the next one sees that its process is gone and takes over at once
 * (`takeOver`). A live holder is not taken over before `HELD_MAX_MS`; after `GIVE_UP_MS` the wait fails with a reason.
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
      if ((await deadHolder(file)) && (await takeOver(file))) continue
      if (Date.now() - start > GIVE_UP_MS) throw new Error('another maker on this Mac did not finish — try again')
      else await new Promise((resolve) => setTimeout(resolve, WAIT_MS))
    }
  }
  try {
    return await work()
  } finally {
    await rm(file, { force: true })
  }
}
