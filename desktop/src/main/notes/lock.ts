/**
 * One maker at a time for `key` on this Mac, across the app and the command (YAZ-4269 D2): a file made with `wx` in
 * the app data folder, never in the vault, so no sync carries it. It goes when the work ends. A holder that died
 * leaves a file older than `STALE_MS`, which the next maker takes over. At most one file for each note being made.
 */
import { createHash } from 'node:crypto'
import { mkdir, open, rm, stat } from 'node:fs/promises'
import path from 'node:path'
import { appDataDir } from '../vaultIndex/mint'

export const LOCK_DIR = 'locks'
const STALE_MS = 30_000
const WAIT_MS = 50
const GIVE_UP_MS = 10_000

export async function onlyOne<T>(key: string, work: () => Promise<T>): Promise<T> {
  const dir = path.join(appDataDir(), LOCK_DIR)
  const file = path.join(dir, `${createHash('sha1').update(key).digest('hex')}.lock`)
  await mkdir(dir, { recursive: true })
  for (const start = Date.now(); ; ) {
    try {
      await (await open(file, 'wx')).close()
      break
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'EEXIST') throw err
      const held = await stat(file).catch(() => null)
      if (held !== null && Date.now() - held.mtimeMs > STALE_MS) await rm(file, { force: true })
      else if (Date.now() - start > GIVE_UP_MS) throw new Error('another maker of this note did not finish — run this again')
      else await new Promise((resolve) => setTimeout(resolve, WAIT_MS))
    }
  }
  try {
    return await work()
  } finally {
    await rm(file, { force: true })
  }
}
