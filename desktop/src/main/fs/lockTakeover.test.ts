/**
 * The one-maker lock when a maker died inside it (YAZ-4269 5C, found by the checker of YAZ-4291): makers that find one
 * dead maker's lock at the same moment must still work one at a time, and a lock that no maker holds this long is a
 * dead one's whatever its process id.
 */
import { afterEach, beforeEach, expect, it } from 'vitest'
import { mkdir, mkdtemp, readdir, realpath, rm, utimes, writeFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { onlyOne } from './lock'

let dir: string
beforeEach(async () => {
  dir = await realpath(await mkdtemp(path.join(tmpdir(), 'yaz-4269-lock-takeover-')))
})
afterEach(async () => {
  await rm(dir, { recursive: true, force: true })
})

/** A process id that no process has now. */
function deadPid(): number {
  for (let pid = 99_999; ; pid++) {
    try {
      process.kill(pid, 0)
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ESRCH') return pid
    }
  }
}

const lockOf = (locks: string, key: string) => path.join(locks, `${createHash('sha1').update(key).digest('hex')}.lock`)

it('makers that take over one dead maker\'s lock at one moment still work one at a time', async () => {
  const locks = path.join(dir, 'locks')
  await mkdir(locks)
  for (let round = 0; round < 40; round++) {
    const key = `ids\n/vault ${round}`
    await writeFile(lockOf(locks, key), String(deadPid()))
    let inside = 0
    let most = 0
    await Promise.all(
      Array.from({ length: 8 }, async (_, i) => {
        // Separate processes start a little apart: each maker starts up to 2 ms after the first.
        await new Promise((resolve) => setTimeout(resolve, (i * 7) % 3))
        return onlyOne(locks, key, async () => {
          most = Math.max(most, ++inside)
          await new Promise((resolve) => setTimeout(resolve, 20))
          inside--
        })
      }),
    )
    expect(most, `round ${round}`).toBe(1)
  }
  // Every lock and every guard is gone with its work.
  expect(await readdir(locks)).toEqual([])
})

it('a lock older than 10 minutes is a dead maker\'s even when its process id is a live process (a reused id)', async () => {
  const locks = path.join(dir, 'locks')
  await mkdir(locks)
  const lock = lockOf(locks, 'k')
  await writeFile(lock, String(process.pid))
  const old = new Date(Date.now() - 11 * 60_000)
  await utimes(lock, old, old)
  const start = Date.now()

  await expect(onlyOne(locks, 'k', async () => 'ran')).resolves.toBe('ran')
  expect(Date.now() - start).toBeLessThan(2_000)
})
