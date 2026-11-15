import { StaleWriteError, StorageTimeoutError, TABLES, tableOf, type Backend, type Key, type Op, type Table } from './backend'

/** The database's own schema number (its object stores). It is not the format of the data: that is `STORE_FORMAT`. */
export const DB_SCHEMA = 1
export const DB_NAME = 'notecards'
/**
 * YAZ-5596 (1): the longest wait for one IndexedDB call (its transaction to its answer) and for the open. A
 * normal call takes a few ms, a big index read on a slow phone under a second; past this the call has no answer.
 */
export const STORAGE_TIMEOUT_MS = 8_000


/**
 * The connection is gone and a new one can work: the database was closed under us (iOS 17.4–18.1 lost it,
 * WebKit 273827 and 277615: "Connection to Indexed Database server lost"), or this connection was closed.
 */
function isLostConnection(error: unknown): boolean {
  if (!(error instanceof Error) && !(error instanceof DOMException)) return false
  return error.name === 'InvalidStateError' || error.name === 'UnknownError' || /connection.*lost/i.test(error.message)
}

function request<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
}

/**
 * The phone's backend: one IndexedDB database. It opens on the first call. When the connection is lost, the
 * next call opens a new one, and a call that finds it lost is tried one more time on the new one.
 *
 * YAZ-5596 (1): no call waits forever. A call with no answer in `timeoutMs` (iOS after a wake: a request that never
 * fires) fails with `StorageTimeoutError`; its connection is dropped (closed and forgotten), so the next call opens a
 * new one. A write is aborted first, so it cannot land later. An open with no answer fails the same way.
 */
export function idbBackend(options: { name?: string; factory?: IDBFactory; keyRange?: typeof IDBKeyRange; timeoutMs?: number } = {}): Backend {
  const timeoutMs = options.timeoutMs ?? STORAGE_TIMEOUT_MS
  const name = options.name ?? DB_NAME
  // Both from the same IndexedDB: the browser's, or a test's fake-indexeddb.
  const factory = options.factory ?? indexedDB
  const keyRange = options.keyRange ?? IDBKeyRange
  /** All the keys `[scope, …]`: arrays sort after strings, so `[scope, []]` is above every `[scope, path]`. */
  const scopeRange = (scope: string) => keyRange.bound([scope], [scope, []])
  let current: IDBDatabase | null = null
  let opening: Promise<IDBDatabase> | null = null
  const forget = (db: IDBDatabase) => {
    if (current === db) current = null
  }
  /** A connection that stopped answering: forgotten and closed, so the next call opens a new one. */
  const drop = (db: IDBDatabase) => {
    forget(db)
    try {
      db.close()
    } catch {
      // Already closed.
    }
  }

  function openOnce(): Promise<IDBDatabase> {
    return new Promise((resolve, reject) => {
      const req = factory.open(name, DB_SCHEMA)
      req.onupgradeneeded = () => {
        for (const table of TABLES) if (!req.result.objectStoreNames.contains(table)) req.result.createObjectStore(table)
      }
      req.onsuccess = () => {
        const db = req.result
        // The browser closed it (a lost connection, cleared site data): the next call opens again.
        db.onclose = () => forget(db)
        // Another tab deletes or upgrades the database: let go at once, so it is not blocked.
        db.onversionchange = () => {
          db.close()
          forget(db)
        }
        resolve(db)
      }
      req.onerror = () => reject(req.error)
    })
  }

  async function open(): Promise<IDBDatabase> {
    try {
      return await openOnce()
    } catch (error) {
      // A newer app made this database (a higher schema number), and this app cannot open it. Its copy is of no
      // use to this app: delete it and start again, as a format change does.
      if (!(error instanceof DOMException) || error.name !== 'VersionError') throw error
      await request(factory.deleteDatabase(name))
      return openOnce()
    }
  }

  function connect(): Promise<IDBDatabase> {
    if (current !== null) return Promise.resolve(current)
    if (opening !== null) return opening
    const attempt: Promise<IDBDatabase> = new Promise((resolve, reject) => {
      // An open with no answer: this attempt fails, and the next call starts a new one. If it answers later, its
      // connection is closed at once (nobody uses it).
      let late = false
      const timer = setTimeout(() => {
        late = true
        if (opening === attempt) opening = null
        reject(new StorageTimeoutError('open'))
      }, timeoutMs)
      open().then(
        (db) => {
          clearTimeout(timer)
          if (late) {
            try {
              db.close()
            } catch {
              // Already closed.
            }
            return
          }
          current = db
          if (opening === attempt) opening = null
          resolve(db)
        },
        (error: unknown) => {
          clearTimeout(timer)
          if (late) return
          if (opening === attempt) opening = null
          reject(error)
        },
      )
    })
    opening = attempt
    return attempt
  }

  /**
   * One call on `db`, with the time limit. `onStop` gets what to undo when the limit ends it (a write's abort).
   * On the limit: the call fails with `StorageTimeoutError` and the connection is dropped.
   */
  function timed<T>(db: IDBDatabase, work: (db: IDBDatabase, onStop: (undo: () => void) => void) => Promise<T>): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const undos: (() => void)[] = []
      let done = false
      const timer = setTimeout(() => {
        if (done) return
        done = true
        for (const undo of undos) {
          try {
            undo()
          } catch {
            // The transaction already ended.
          }
        }
        drop(db)
        reject(new StorageTimeoutError())
      }, timeoutMs)
      const end = (fn: () => void) => {
        if (done) return
        done = true
        clearTimeout(timer)
        fn()
      }
      let call: Promise<T>
      try {
        call = work(db, (undo) => void undos.push(undo))
      } catch (error) {
        call = Promise.reject(error)
      }
      call.then(
        (value) => end(() => resolve(value)),
        (error: unknown) => end(() => reject(error)),
      )
    })
  }

  async function run<T>(work: (db: IDBDatabase, onStop: (undo: () => void) => void) => Promise<T>): Promise<T> {
    const db = await connect()
    try {
      return await timed(db, work)
    } catch (error) {
      if (!isLostConnection(error)) throw error
      drop(db)
      return timed(await connect(), work)
    }
  }

  return {
    get: (table: Table, key: Key) =>
      run((db) => request(db.transaction(table, 'readonly').objectStore(table).get(key))),
    all: (table: Table, scope?: string) =>
      run((db) => request(db.transaction(table, 'readonly').objectStore(table).getAll(scope === undefined ? undefined : scopeRange(scope)))),
    keys: (table: Table, scope?: string) =>
      run((db) => request(db.transaction(table, 'readonly').objectStore(table).getAllKeys(scope === undefined ? undefined : scopeRange(scope)))) as Promise<Key[]>,
    apply(ops: readonly Op[]) {
      if (ops.length === 0) return Promise.resolve()
      const tables = [...new Set(ops.map(tableOf))]
      const checks = ops.filter((op): op is Extract<Op, { check: Table }> => 'check' in op)
      return run(
        (db, onStop) =>
          new Promise<void>((resolve, reject) => {
            // `strict`: committed means written to disk, not only to the OS cache.
            const tx = db.transaction(tables, 'readwrite', { durability: 'strict' })
            // A write that hit the time limit is aborted, so it never lands after the caller was told it failed.
            onStop(() => {
              tx.onabort = null
              tx.abort()
            })
            tx.oncomplete = () => resolve()
            tx.onabort = () => reject(tx.error ?? new DOMException('The write was stopped', 'AbortError'))
            const stop = (error: unknown) => {
              tx.onabort = null
              tx.abort()
              reject(error)
            }
            const write = () => {
              try {
                for (const op of ops) {
                  if ('check' in op) continue
                  if ('put' in op) tx.objectStore(op.put).put(op.value, op.key)
                  else if ('del' in op) tx.objectStore(op.del).delete(op.key)
                  else if (op.scope === undefined) tx.objectStore(op.clear).clear()
                  else tx.objectStore(op.clear).delete(scopeRange(op.scope))
                }
              } catch (error) {
                // A value the browser cannot store throws here. Stop the whole batch, so none of it lands.
                stop(error)
              }
            }
            if (checks.length === 0) return write()
            // The conditions first, in this transaction: the writes start only when every row still holds its value.
            let left = checks.length
            let stale = false
            for (const c of checks) {
              const read = tx.objectStore(c.check).get(c.key)
              read.onsuccess = () => {
                if (read.result !== c.value) stale = true
                if (--left === 0) {
                  if (stale) stop(new StaleWriteError())
                  else write()
                }
              }
            }
          }),
      )
    },
    close() {
      current?.close()
      current = null
    },
  }
}
