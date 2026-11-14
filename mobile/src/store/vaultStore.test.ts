/**
 * ONE suite for `VaultStore`, run on each backend (YAZ-5071 3A): the in-memory one the other units test with,
 * and IndexedDB (here `fake-indexeddb`, the browser's on the phone). A rule passes on both or it is not a rule.
 * Rows P2, P3, P5 and N7 are the October scenario table P.
 */
import { IDBFactory, IDBKeyRange } from 'fake-indexeddb'
import { describe, expect, it } from 'vitest'
import type { Backend } from './backend'
import { idbBackend } from './idbBackend'
import { memoryBackend, newMemoryDisk } from './memoryBackend'
import { limitedBackend } from './testing'
import { PHONE, STORE_FORMAT, StorageFullError, kindOnPhone, openVaultStore } from './vaultStore'

const A = 'yaseen/vault@main'
const B = 'friend/cards@main'

/** Each test gets a new "phone": `backend()` opens the same storage again, as the next app start does. */
type Phone = () => Backend
const backends: Record<string, () => Phone> = {
  memory: () => {
    const disk = newMemoryDisk()
    return () => memoryBackend(disk)
  },
  indexeddb: () => {
    const factory = new IDBFactory()
    return () => idbBackend({ factory, keyRange: IDBKeyRange })
  },
}

/** A fake clock: each call is one tick later. */
function clock(start = 1_000) {
  let t = start
  return () => t++
}

describe.each(Object.keys(backends))('VaultStore on %s', (name) => {
  const phone = () => backends[name]()

  it('reads, writes, lists and removes files by vault and path; each repo has its own files', async () => {
    const store = await openVaultStore(phone()(), { now: clock() })
    await store.write(A, 'Inbox/Card one.md', '# One')
    await store.write(A, 'pics/cat.png', new Uint8Array([1, 2, 3]))
    await store.write(B, 'Inbox/Card one.md', '# Theirs')

    expect((await store.read(A, 'Inbox/Card one.md'))?.content).toBe('# One')
    expect((await store.read(B, 'Inbox/Card one.md'))?.content).toBe('# Theirs')
    expect((await store.read(A, 'pics/cat.png'))?.content).toEqual(new Uint8Array([1, 2, 3]))
    expect(await store.read(A, 'missing.md')).toBeNull()
    expect((await store.list(A)).map((f) => [f.path, f.kind, f.size])).toEqual([
      ['Inbox/Card one.md', 'page', 5],
      ['pics/cat.png', 'media', 3],
    ])

    await store.remove(A, 'Inbox/Card one.md')
    expect(await store.read(A, 'Inbox/Card one.md')).toBeNull()
    expect((await store.list(A)).map((f) => f.path)).toEqual(['pics/cat.png'])
    expect((await store.list(B)).map((f) => f.path)).toEqual(['Inbox/Card one.md'])
  })

  it('counts a size in bytes, not in characters', async () => {
    const store = await openVaultStore(phone()(), { now: clock() })
    await store.write(A, 'a.md', 'é')
    expect((await store.list(A))[0].size).toBe(2)
  })

  it('keeps one checkpoint for each vault: the commit, its ETag and the map of path to blob SHA', async () => {
    const store = await openVaultStore(phone()(), { now: clock() })
    expect(await store.checkpoint(A)).toBeNull()
    const cp = { commit: 'c1', etag: 'W/"e1"', shas: { 'a.md': 's1', 'pics/cat.png': 's2' } }
    await store.setCheckpoint(A, cp)
    expect(await store.checkpoint(A)).toEqual(cp)
    expect(await store.checkpoint(B)).toBeNull()
  })

  it('keeps phone-only state for the phone and for each vault, and it lasts to the next app start', async () => {
    const open = phone()
    const store = await openVaultStore(open(), { now: clock() })
    await store.setState(PHONE, 'recents', ['a.md'])
    await store.setState(A, 'answers', [{ id: 'c1' }])
    store.close()

    const again = await openVaultStore(open(), { now: clock() })
    expect(await again.getState(PHONE, 'recents')).toEqual(['a.md'])
    expect(await again.getState(A, 'answers')).toEqual([{ id: 'c1' }])
    expect(await again.getState(B, 'answers')).toBeUndefined()
    await again.removeState(A, 'answers')
    expect(await again.getState(A, 'answers')).toBeUndefined()
  })

  it('a write is kept when its promise ends: a new connection reads it at once (the answer list rule)', async () => {
    const open = phone()
    const store = await openVaultStore(open(), { now: clock() })
    await store.setState(A, 'answers', [{ id: 'c1' }])
    const other = await openVaultStore(open(), { now: clock() })
    expect(await other.getState(A, 'answers')).toEqual([{ id: 'c1' }])
  })

  it('a value read back is a copy: a change to it does not change the stored value', async () => {
    const store = await openVaultStore(phone()(), { now: clock() })
    const list = [{ id: 'c1' }]
    await store.setState(A, 'answers', list)
    list.push({ id: 'c2' })
    const read = await store.getState<{ id: string }[]>(A, 'answers')
    read?.push({ id: 'c3' })
    expect(await store.getState(A, 'answers')).toEqual([{ id: 'c1' }])
  })

  describe('P2: storage is full while keeping media', () => {
    it('drops the media viewed longest ago, in any vault, and never a page, a card file or a settings file', async () => {
      const store = await openVaultStore(limitedBackend(phone()(), 100), { now: clock() })
      await store.write(A, 'old.png', new Uint8Array(30)) // viewed at 1000
      await store.write(B, 'older.mp3', new Uint8Array(30)) // viewed at 1001
      await store.write(A, '.yaseendocs/settings.json', '{}') // 2 bytes, settings
      await store.markViewed(A, 'old.png') // now viewed at 1003: B's sound is the oldest

      const result = await store.write(A, 'Card.md', 'x'.repeat(50))
      expect(result.dropped).toEqual([{ vault: B, path: 'older.mp3' }])
      expect(await store.read(B, 'older.mp3')).toBeNull()
      expect(await store.read(A, 'old.png')).not.toBeNull()
      expect((await store.read(A, 'Card.md'))?.content).toBe('x'.repeat(50))
    })

    it('stops with StorageFullError when only pages and settings are left; nothing kept is dropped', async () => {
      const store = await openVaultStore(limitedBackend(phone()(), 100), { now: clock() })
      await store.write(A, 'a.md', 'x'.repeat(40))
      await store.write(A, 'pic.png', new Uint8Array(20))
      await store.write(A, '.folder.md', 'y'.repeat(10))

      const error = await store.write(A, 'b.md', 'z'.repeat(60)).catch((e: unknown) => e)
      expect(error).toBeInstanceOf(StorageFullError)
      expect((error as StorageFullError).dropped).toEqual([{ vault: A, path: 'pic.png' }])
      expect((await store.list(A)).map((f) => f.path).sort()).toEqual(['.folder.md', 'a.md'])
    })

    it('a picture that cannot fit after every other picture is gone fails too, and does not drop itself', async () => {
      const store = await openVaultStore(limitedBackend(phone()(), 50), { now: clock() })
      await store.write(A, 'a.md', 'x'.repeat(40))
      await expect(store.write(A, 'big.png', new Uint8Array(20))).rejects.toBeInstanceOf(StorageFullError)
      expect(await store.read(A, 'a.md')).not.toBeNull()
    })

    it('an error that is not "storage full" is not a reason to drop anything', async () => {
      const inner = phone()()
      let fail = false
      const flaky: Backend = { ...inner, apply: (ops) => (fail ? Promise.reject(new DOMException('disk', 'UnknownError')) : inner.apply(ops)) }
      const store = await openVaultStore(flaky, { now: clock() })
      await store.write(A, 'pic.png', new Uint8Array(4))
      fail = true
      await expect(store.write(A, 'b.md', 'b')).rejects.toMatchObject({ name: 'UnknownError' })
      fail = false
      expect(await store.read(A, 'pic.png')).not.toBeNull()
    })
  })

  describe('P3: a new app version changed the storage format', () => {
    it('discards the local copy (files and checkpoints) and keeps the phone-only state, so unsent answers can still go', async () => {
      const open = phone()
      const v1 = await openVaultStore(open(), { format: 1, now: clock() })
      expect(v1.formatReset).toBe(false)
      await v1.write(A, 'a.md', 'old')
      await v1.setCheckpoint(A, { commit: 'c1', etag: null, shas: { 'a.md': 's' } })
      await v1.setState(A, 'answers', [{ id: 'c1' }])
      v1.close()

      const v2 = await openVaultStore(open(), { format: 2, now: clock() })
      expect(v2.formatReset).toBe(true)
      expect(await v2.list(A)).toEqual([])
      expect(await v2.checkpoint(A)).toBeNull()
      expect(await v2.getState(A, 'answers')).toEqual([{ id: 'c1' }])
      v2.close()

      const v2again = await openVaultStore(open(), { format: 2, now: clock() })
      expect(v2again.formatReset).toBe(false)
    })

    it('an app OLDER than the stored format discards the copy too: it cannot read it', async () => {
      const open = phone()
      const v3 = await openVaultStore(open(), { format: 3, now: clock() })
      await v3.write(A, 'a.md', 'new')
      v3.close()
      const v2 = await openVaultStore(open(), { format: 2, now: clock() })
      expect(v2.formatReset).toBe(true)
      expect(await v2.list(A)).toEqual([])
    })

    it('the app format is one number', () => {
      expect(Number.isInteger(STORE_FORMAT) && STORE_FORMAT >= 1).toBe(true)
    })
  })

  it('P5: "Reset local copy" removes the files and the checkpoint of one vault; its phone-only state and other vaults stay', async () => {
    const store = await openVaultStore(phone()(), { now: clock() })
    for (const v of [A, B]) {
      await store.write(v, 'a.md', v)
      await store.setCheckpoint(v, { commit: 'c', etag: null, shas: {} })
      await store.setState(v, 'answers', [{ id: v }])
    }
    await store.resetCopy(A)
    expect(await store.list(A)).toEqual([])
    expect(await store.checkpoint(A)).toBeNull()
    expect(await store.getState(A, 'answers')).toEqual([{ id: A }])
    expect((await store.read(B, 'a.md'))?.content).toBe(B)
    expect(await store.checkpoint(B)).not.toBeNull()
  })

  it('removing a vault removes its files, its checkpoint and its state; other vaults stay', async () => {
    const store = await openVaultStore(phone()(), { now: clock() })
    for (const v of [A, B]) {
      await store.write(v, 'a.md', v)
      await store.setCheckpoint(v, { commit: 'c', etag: null, shas: {} })
      await store.setState(v, 'answers', [{ id: v }])
    }
    await store.removeVault(A)
    expect(await store.list(A)).toEqual([])
    expect(await store.checkpoint(A)).toBeNull()
    expect(await store.getState(A, 'answers')).toBeUndefined()
    expect(await store.getState(B, 'answers')).toEqual([{ id: B }])
  })

  it('N7: "Sign out and erase this phone" removes every stored file, checkpoint and state, and the store still works', async () => {
    const open = phone()
    const store = await openVaultStore(open(), { now: clock() })
    await store.write(A, 'a.md', 'a')
    await store.write(B, 'b.png', new Uint8Array(1))
    await store.setCheckpoint(A, { commit: 'c', etag: null, shas: {} })
    await store.setState(PHONE, 'vaults', { vaults: [], open: null })
    await store.setState(A, 'answers', [1])
    await store.eraseAll()

    for (const v of [A, B]) {
      expect(await store.list(v)).toEqual([])
      expect(await store.checkpoint(v)).toBeNull()
    }
    expect(await store.getState(PHONE, 'vaults')).toBeUndefined()
    expect(await store.getState(A, 'answers')).toBeUndefined()
    store.close()
    // The next start is a first open, not a format change.
    const next = await openVaultStore(open(), { now: clock() })
    expect(next.formatReset).toBe(false)
    await next.write(A, 'a.md', 'again')
    expect((await next.read(A, 'a.md'))?.content).toBe('again')
  })
})

describe('kindOnPhone: what storage may drop', () => {
  it('a page and a card file (both .md) and the vault settings are kept; anything else is media', () => {
    expect(kindOnPhone('Inbox/Page.md')).toBe('page')
    expect(kindOnPhone('Cards/Capital of France.md')).toBe('page')
    expect(kindOnPhone('Inbox/.folder.md')).toBe('settings')
    expect(kindOnPhone('.yaseendocs/unit-word.json')).toBe('settings')
    expect(kindOnPhone('pics/cat.PNG')).toBe('media')
    expect(kindOnPhone('sounds/a.mp3')).toBe('media')
    expect(kindOnPhone('docs/file.pdf')).toBe('media')
  })
})
