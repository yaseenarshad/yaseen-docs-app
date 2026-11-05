/**
 * A FAVORITE COPY CUT OFF DURING A LIBRARY MOVE (YAZ-4379): a crash, a full disk, or a power loss before the bytes
 * reach the disk. The copy must land whole or not at all, so the next move copies it again, and an add never inserts
 * broken bytes. The checker wrote the first case in round 1 (YAZ-4364): `copyFile` that stops half way. The second
 * case stops the durable write itself half way. `node:fs/promises` is mocked for the whole file, so these cases live
 * apart from `favoriteCopies.test.ts`.
 */
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { createFavoriteCopies, favoriteCopyHash } from './favoriteCopies'

/** While `on`, a write of a new file lands half its bytes and then fails, as a full disk does. */
const cut = vi.hoisted(() => ({ on: false }))

vi.mock('node:fs/promises', async (importOriginal) => {
  const real = await importOriginal<typeof import('node:fs/promises')>()
  const enospc = () => Object.assign(new Error('ENOSPC: no space left on device'), { code: 'ENOSPC' })
  return {
    ...real,
    // Half the bytes land, then the copy stops (ENOSPC here; a crash or a power loss leaves the same file).
    copyFile: vi.fn(async (src: string, dst: string) => {
      const bytes = await real.readFile(src)
      await real.writeFile(dst, bytes.subarray(0, Math.floor(bytes.length / 2)), { flag: 'wx' })
      throw enospc()
    }),
    open: vi.fn(async (...args: Parameters<typeof real.open>) => {
      const fh = await real.open(...args)
      if (!cut.on) return fh
      return new Proxy(fh, {
        get(target, key) {
          if (key === 'writeFile') {
            return async (data: string | Uint8Array) => {
              const bytes = Buffer.from(data)
              await target.write(bytes.subarray(0, Math.floor(bytes.length / 2)))
              throw enospc()
            }
          }
          const value: unknown = Reflect.get(target, key)
          return typeof value === 'function' ? (value as (...a: unknown[]) => unknown).bind(target) : value
        },
      })
    }),
  }
})

const key = 'iconify:mdi:star'
const name = `${favoriteCopyHash(key)}.svg`
const whole = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><path d="M12 2l3 7h7l-6 4 2 7-6-4-6 4 2-7-6-4h7z"/></svg>'
const fav = { itemKey: key, provider: 'iconify' as const, providerId: 'mdi:star', kind: 'icon' as const, title: 'star', updatedAt: 1 }

let dir: string
let from: string
let to: string
beforeEach(async () => {
  dir = await mkdtemp(path.join(tmpdir(), 'yd-copy-crash-'))
  from = path.join(dir, 'old')
  to = path.join(dir, 'new')
  await mkdir(path.join(from, 'favorites'), { recursive: true })
  await writeFile(path.join(from, 'favorites', name), whole)
})
afterEach(async () => {
  cut.on = false
  await rm(dir, { recursive: true, force: true })
})

const copiesIn = (folder: string) => createFavoriteCopies(folder, { favorites: async () => [fav], hasPixabayKey: async () => true, wait: async () => undefined })

it('a favorite copy cut off during a Library move is not taken for a whole copy', async () => {
  const copies = copiesIn(to)
  await copies.copyFrom(from)
  const left = await readFile(path.join(to, 'favorites', name), 'utf8').catch(() => null)
  // Expected: no short file at the final name (a tmp file and a rename), so the next move or backfill copies it again.
  expect(left === null || left === whole).toBe(true)
  await copies.close()
})

it('a durable write cut off half way leaves no file, fails the move, and the next move copies the whole copy (YAZ-4379)', async () => {
  const copies = copiesIn(to)
  cut.on = true
  await expect(copies.copyFrom(from)).rejects.toMatchObject({ code: 'ENOSPC' })
  cut.on = false
  // Nothing at the final name, and no tmp file left behind.
  expect(await readdir(path.join(to, 'favorites'))).toEqual([])
  expect(await copies.status()).toMatchObject({ favorites: 1, saved: 0 })
  expect(await copies.import({ provider: 'iconify', id: 'mdi:star' })).toBeNull()
  // The next move copies it again, whole. The old folder's copy is untouched.
  expect(await copies.copyFrom(from)).toBe(1)
  expect(await readFile(path.join(to, 'favorites', name), 'utf8')).toBe(whole)
  expect(await readFile(path.join(from, 'favorites', name), 'utf8')).toBe(whole)
  const added = await copies.import({ provider: 'iconify', id: 'mdi:star' })
  expect(Buffer.from(added?.dataURL.split(',')[1] ?? '', 'base64').toString()).toBe(whole)
  await copies.close()
})
