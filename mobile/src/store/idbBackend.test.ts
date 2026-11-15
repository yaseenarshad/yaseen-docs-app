/** What only the IndexedDB backend has to do: open again after iOS drops the connection, and survive a newer schema. */
import { IDBFactory, IDBKeyRange, forceCloseDatabase } from 'fake-indexeddb'
import { describe, expect, it } from 'vitest'
import { StorageTimeoutError } from './backend'
import { idbBackend } from './idbBackend'
import { openVaultStore } from './vaultStore'

const A = 'yaseen/vault@main'

/** The factory, plus every connection it opened, so a test can break one as iOS 17.4–18.1 did (WebKit 273827, 277615). */
function watchedFactory() {
  const factory = new IDBFactory()
  const opened: IDBDatabase[] = []
  const open = factory.open.bind(factory)
  factory.open = (name: string, version?: number) => {
    const request = open(name, version)
    request.addEventListener('success', () => opened.push(request.result))
    return request
  }
  return { factory, opened }
}

describe('idbBackend: a lost connection opens again', () => {
  it('after the browser closes the connection (the close event), the next call opens a new one', async () => {
    const { factory, opened } = watchedFactory()
    const store = await openVaultStore(idbBackend({ factory, keyRange: IDBKeyRange }))
    await store.write(A, 'a.md', 'one')
    expect(opened).toHaveLength(1)

    // fake-indexeddb types the parameter as the IDBDatabase class, not an instance; the call takes an instance.
    forceCloseDatabase(opened[0] as unknown as typeof IDBDatabase)
    await store.write(A, 'b.md', 'two')
    expect((await store.read(A, 'a.md'))?.content).toBe('one')
    expect((await store.read(A, 'b.md'))?.content).toBe('two')
    expect(opened).toHaveLength(2)
  })

  it('a connection that went bad with no event: the call that finds it fails once inside, opens again and succeeds', async () => {
    const { factory, opened } = watchedFactory()
    const store = await openVaultStore(idbBackend({ factory, keyRange: IDBKeyRange }))
    await store.setState(A, 'answers', [1])
    opened[0].close() // no close event: the next transaction() throws InvalidStateError
    await store.setState(A, 'answers', [1, 2])
    expect(await store.getState(A, 'answers')).toEqual([1, 2])
    expect(opened).toHaveLength(2)
  })

  it('another tab that deletes the database is not blocked: this connection lets go and opens again later', async () => {
    const { factory } = watchedFactory()
    const store = await openVaultStore(idbBackend({ factory, keyRange: IDBKeyRange, name: 'phone' }))
    await store.write(A, 'a.md', 'one')
    await new Promise<void>((resolve, reject) => {
      const request = factory.deleteDatabase('phone')
      request.onsuccess = () => resolve()
      request.onerror = () => reject(request.error)
      request.onblocked = () => reject(new Error('blocked'))
    })
    expect(await store.read(A, 'a.md')).toBeNull()
    await store.write(A, 'a.md', 'two')
    expect((await store.read(A, 'a.md'))?.content).toBe('two')
  })
})

describe('idbBackend: a database from a newer app (its schema number is higher)', () => {
  it('is deleted and made again, so an older app still starts', async () => {
    const factory = new IDBFactory()
    await new Promise<void>((resolve) => {
      const request = factory.open('phone', 99)
      request.onupgradeneeded = () => request.result.createObjectStore('future')
      request.onsuccess = () => {
        request.result.close()
        resolve()
      }
    })
    const store = await openVaultStore(idbBackend({ factory, keyRange: IDBKeyRange, name: 'phone' }))
    expect(store.formatReset).toBe(false)
    await store.write(A, 'a.md', 'x')
    expect((await store.read(A, 'a.md'))?.content).toBe('x')
  })
})


/** A request or transaction that never fires an event: what iOS gives after a wake (WebKit's lost connection family). */
function silentTransaction() {
  const silent = () => new EventTarget()
  const tx = new EventTarget() as EventTarget & { objectStore: () => unknown; abort: () => void; aborted: boolean }
  tx.aborted = false
  tx.objectStore = () => ({ get: silent, getAll: silent, getAllKeys: silent, put: silent, delete: silent, clear: silent })
  tx.abort = () => void (tx.aborted = true)
  return tx
}

describe('idbBackend: a call with no answer (YAZ-5596 item 1)', () => {
  it('a read that never answers fails with StorageTimeoutError, and the next call opens a new connection and works', async () => {
    const { factory, opened } = watchedFactory()
    const backend = idbBackend({ factory, keyRange: IDBKeyRange, timeoutMs: 50 })
    const store = await openVaultStore(backend)
    await store.setState(A, 'answers', [1])
    const db = opened[0]
    const real = db.transaction.bind(db)
    db.transaction = (() => silentTransaction()) as unknown as typeof db.transaction
    await expect(store.getState(A, 'answers')).rejects.toBeInstanceOf(StorageTimeoutError)
    db.transaction = real
    // The stuck connection was dropped: the next call opened a new one, and the stored value is there.
    expect(await store.getState(A, 'answers')).toEqual([1])
    expect(opened).toHaveLength(2)
  })

  it('a write that never answers fails, is aborted, and the value is written on the next try', async () => {
    const { factory, opened } = watchedFactory()
    const store = await openVaultStore(idbBackend({ factory, keyRange: IDBKeyRange, timeoutMs: 50 }))
    await store.setState(A, 'answers', [1])
    const db = opened[0]
    const silent = silentTransaction()
    db.transaction = (() => silent) as unknown as typeof db.transaction
    await expect(store.setState(A, 'answers', [1, 2])).rejects.toBeInstanceOf(StorageTimeoutError)
    expect(silent.aborted).toBe(true)
    await store.setState(A, 'answers', [1, 2])
    expect(await store.getState(A, 'answers')).toEqual([1, 2])
  })

  it('an open that never answers fails, and the next call opens again', async () => {
    const factory = new IDBFactory()
    const open = factory.open.bind(factory)
    let silent = true
    factory.open = (name: string, version?: number) => (silent ? (new EventTarget() as unknown as IDBOpenDBRequest) : open(name, version))
    const backend = idbBackend({ factory, keyRange: IDBKeyRange, timeoutMs: 50 })
    await expect(backend.get('meta', 'format')).rejects.toBeInstanceOf(StorageTimeoutError)
    silent = false
    await backend.apply([{ put: 'meta', key: 'x', value: 1 }])
    expect(await backend.get('meta', 'x')).toBe(1)
  })
})
