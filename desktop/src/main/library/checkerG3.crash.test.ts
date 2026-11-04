/**
 * CHECKER (YAZ-4364 round 1): the Library move copies a favorite's copy with `copyFile` straight onto its final name.
 * A copy cut off half way (a crash, a full disk, a power loss before the bytes reach the disk) leaves a short file at
 * the final name. This test makes `copyFile` stop half way, as a crash would, and shows what the app does next.
 */
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { createFavoriteCopies, favoriteCopyHash } from './favoriteCopies'

vi.mock('node:fs/promises', async (importOriginal) => {
  const real = await importOriginal<typeof import('node:fs/promises')>()
  return {
    ...real,
    // Half the bytes land, then the copy stops (ENOSPC here; a crash or a power loss leaves the same file).
    copyFile: vi.fn(async (src: string, dst: string) => {
      const bytes = await real.readFile(src)
      await real.writeFile(dst, bytes.subarray(0, Math.floor(bytes.length / 2)), { flag: 'wx' })
      throw Object.assign(new Error('ENOSPC: no space left on device'), { code: 'ENOSPC' })
    }),
  }
})

let dir: string
beforeEach(async () => {
  dir = await mkdtemp(path.join(tmpdir(), 'yd-checker-crash-'))
})
afterEach(async () => {
  await rm(dir, { recursive: true, force: true })
})

it('a favorite copy cut off during a Library move is not taken for a whole copy', async () => {
  const from = path.join(dir, 'old')
  const to = path.join(dir, 'new')
  const key = 'iconify:mdi:star'
  const name = `${favoriteCopyHash(key)}.svg`
  const whole = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><path d="M12 2l3 7h7l-6 4 2 7-6-4-6 4 2-7-6-4h7z"/></svg>'
  await mkdir(path.join(from, 'favorites'), { recursive: true })
  await writeFile(path.join(from, 'favorites', name), whole)
  const fav = { itemKey: key, provider: 'iconify' as const, providerId: 'mdi:star', kind: 'icon' as const, title: 'star', updatedAt: 1 }
  const copies = createFavoriteCopies(to, { favorites: async () => [fav], hasPixabayKey: async () => true, wait: async () => undefined })
  const copied = await copies.copyFrom(from)
  console.log('copied:', copied)
  const left = await readFile(path.join(to, 'favorites', name), 'utf8').catch(() => null)
  console.log('left at the final name:', JSON.stringify(left))
  console.log('status:', JSON.stringify(await copies.status()))
  const added = await copies.import({ provider: 'iconify', id: 'mdi:star' })
  console.log('an add from Favorites inserts:', added === null ? null : Buffer.from(added.dataURL.split(',')[1], 'base64').toString())
  // Expected: no short file at the final name (a tmp file and a rename), so the next move or backfill copies it again.
  expect(left === null || left === whole).toBe(true)
  await copies.close()
})
