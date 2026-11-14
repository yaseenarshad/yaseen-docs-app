import { TABLES, type Backend, type Key, type Op, type Table } from './backend'

/** The database's own schema number (its object stores). It is not the format of the data: that is `STORE_FORMAT`. */
export const DB_SCHEMA = 1
export const DB_NAME = 'notecards'


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
 */
export function idbBackend(options: { name?: string; factory?: IDBFactory; keyRange?: typeof IDBKeyRange } = {}): Backend {
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
    opening ??= open().then(
      (db) => {
        current = db
        opening = null
        return db
      },
      (error: unknown) => {
        opening = null
        throw error
      },
    )
    return opening
  }

  async function run<T>(work: (db: IDBDatabase) => Promise<T>): Promise<T> {
    const db = await connect()
    try {
      return await work(db)
    } catch (error) {
      if (!isLostConnection(error)) throw error
      forget(db)
      try {
        db.close()
      } catch {
        // Already closed.
      }
      return work(await connect())
    }
  }

  return {
    get: (table: Table, key: Key) =>
      run((db) => request(db.transaction(table, 'readonly').objectStore(table).get(key))),
    all: (table: Table, scope?: string) =>
      run((db) => request(db.transaction(table, 'readonly').objectStore(table).getAll(scope === undefined ? undefined : scopeRange(scope)))),
    apply(ops: readonly Op[]) {
      if (ops.length === 0) return Promise.resolve()
      const tables = [...new Set(ops.map((op) => ('put' in op ? op.put : 'del' in op ? op.del : op.clear)))]
      return run(
        (db) =>
          new Promise<void>((resolve, reject) => {
            // `strict`: committed means written to disk, not only to the OS cache.
            const tx = db.transaction(tables, 'readwrite', { durability: 'strict' })
            tx.oncomplete = () => resolve()
            tx.onabort = () => reject(tx.error ?? new DOMException('The write was stopped', 'AbortError'))
            try {
              for (const op of ops) {
                if ('put' in op) tx.objectStore(op.put).put(op.value, op.key)
                else if ('del' in op) tx.objectStore(op.del).delete(op.key)
                else if (op.scope === undefined) tx.objectStore(op.clear).clear()
                else tx.objectStore(op.clear).delete(scopeRange(op.scope))
              }
            } catch (error) {
              // A value the browser cannot store throws here. Stop the whole batch, so none of it lands.
              tx.onabort = null
              tx.abort()
              reject(error)
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
