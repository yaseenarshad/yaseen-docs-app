import { StaleWriteError, TABLES, compareKeys, type Backend, type Key, type Op, type Table } from './backend'

/** The "disk" of a memory backend: a new backend on the same disk sees the same rows, as the next app start does. */
export type MemoryDisk = Map<Table, Map<string, { key: Key; value: unknown }>>

export function newMemoryDisk(): MemoryDisk {
  return new Map(TABLES.map((t) => [t, new Map()]))
}

/**
 * The backend for tests and for the other units' tests (3B–3E): plain maps. Values go in and come out as
 * copies (`structuredClone`), as with IndexedDB, so a test cannot pass by sharing an object by accident.
 */
export function memoryBackend(disk: MemoryDisk = newMemoryDisk()): Backend {
  const table = (t: Table) => disk.get(t)!
  const id = (key: Key) => JSON.stringify(key)
  const rowsOf = (t: Table, scope?: string) =>
    [...table(t).values()].filter((r) => scope === undefined || (Array.isArray(r.key) && r.key[0] === scope)).sort((a, b) => compareKeys(a.key, b.key))
  return {
    async get(t, key) {
      const row = table(t).get(id(key))
      return row === undefined ? undefined : structuredClone(row.value)
    },
    async all(t, scope) {
      return rowsOf(t, scope).map((r) => structuredClone(r.value))
    },
    async keys(t, scope) {
      return rowsOf(t, scope).map((r) => structuredClone(r.key))
    },
    async apply(ops: readonly Op[]) {
      // Clone first: a value that cannot be cloned fails the batch before any row changes.
      const ready = ops.map((op) => ('put' in op ? { ...op, value: structuredClone(op.value) } : op))
      for (const op of ready) if ('check' in op && table(op.check).get(id(op.key))?.value !== op.value) throw new StaleWriteError()
      for (const op of ready) {
        if ('check' in op) continue
        if ('put' in op) table(op.put).set(id(op.key), { key: op.key, value: op.value })
        else if ('del' in op) table(op.del).delete(id(op.key))
        else if (op.scope === undefined) table(op.clear).clear()
        else for (const [k, r] of table(op.clear)) if (Array.isArray(r.key) && r.key[0] === op.scope) table(op.clear).delete(k)
      }
    },
    close() {},
  }
}
