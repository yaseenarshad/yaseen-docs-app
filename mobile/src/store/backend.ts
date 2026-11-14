/**
 * The storage under `VaultStore`: a few tables of keys and values, and atomic batches of writes. Two backends
 * have it: IndexedDB on the phone (`idbBackend.ts`) and memory for tests (`memoryBackend.ts`). All the rules
 * (kinds, what may be dropped, the format number, the clears) are in `vaultStore.ts`, once, above both.
 */

/**
 * - `meta`: the format number (key `'format'`).
 * - `entries`: one row for each stored file, with no content: `[vault, path]` → `FileEntry`. Listing reads only this.
 * - `files`: the content of each stored file: `[vault, path]` → `{ content }`.
 * - `checkpoints`: `vault` → `Checkpoint`.
 * - `state`: phone-only state, never synced: `[scope, name]` → any value the browser can clone.
 */
export type Table = 'meta' | 'entries' | 'files' | 'checkpoints' | 'state'
export const TABLES: readonly Table[] = ['meta', 'entries', 'files', 'checkpoints', 'state']

/** A string, or `[scope, name]`: the scope is a vault id (or `PHONE`), so one vault's rows are one key range. */
export type Key = string | [string, string]

export type Op =
  | { put: Table; key: Key; value: unknown }
  | { del: Table; key: Key }
  /** Every row of the table, or only the rows whose key is `[scope, …]`. */
  | { clear: Table; scope?: string }
  /**
   * A condition, not a write: the batch lands only when the row at `key` holds `value` now (`undefined`: no row). Else
   * no op of the batch lands and `apply` rejects with `StaleWriteError`. Checked inside the same transaction as the
   * writes, so a change by another tab cannot slip in between (YAZ-5193, YAZ-5194).
   */
  | { check: Table; key: Key; value: unknown }

/** A batch whose `check` failed: the rows it checked changed meanwhile (a clear of the vault, in any tab). */
export class StaleWriteError extends Error {
  constructor() {
    super('The stored generation changed: this write belongs to an older open of the vault')
    this.name = 'StaleWriteError'
  }
}

/** The table an op touches. */
export const tableOf = (op: Op): Table => ('put' in op ? op.put : 'del' in op ? op.del : 'check' in op ? op.check : op.clear)

export interface Backend {
  /** The value at `key`, a copy; `undefined` when there is none. */
  get(table: Table, key: Key): Promise<unknown>
  /** Every value of the table, or of one scope, in key order. */
  all(table: Table, scope?: string): Promise<unknown[]>
  /** Every key of the table, or of one scope, in key order. No values are read. */
  keys(table: Table, scope?: string): Promise<Key[]>
  /**
   * Applies every op in ONE transaction: all of them land or none does. It resolves only when the transaction
   * is committed, so a caller that awaits it can move on (the answer list rule: iOS 17.4–18.1 could lose
   * writes that were not committed). When storage is full it rejects with a `QuotaExceededError`.
   */
  apply(ops: readonly Op[]): Promise<void>
  close(): void
}

/** The order of keys that IndexedDB uses, for the strings and `[string, string]` pairs used here. */
export function compareKeys(a: Key, b: Key): number {
  const x = typeof a === 'string' ? [a] : a
  const y = typeof b === 'string' ? [b] : b
  for (let i = 0; i < Math.min(x.length, y.length); i++) if (x[i] !== y[i]) return x[i] < y[i] ? -1 : 1
  return x.length - y.length
}
