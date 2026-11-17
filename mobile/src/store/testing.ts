import type { Backend, Key, Op, Table } from './backend'

/**
 * Test help: a full phone as the browser sees it. Every stored byte counts: file contents, phone-only state and
 * checkpoints (the `entries` index and the format number count as 0). A batch that would pass `limit` rejects with
 * a `QuotaExceededError`, as a full phone does.
 * `limit` may be a function: the free disk can shrink while the app runs (another app fills it).
 * It wraps either backend, so row P2 runs on both. It must see every write from a new, empty disk.
 * (YAZ-5156: the first version counted only `entries`, so a full phone never refused a state write.)
 */
export function limitedBackend(inner: Backend, limit: number | (() => number)): Backend {
  const limitNow = () => (typeof limit === 'number' ? limit : limit())
  const sizes = new Map<string, number>()
  const id = (table: Table, key: Key) => `${table}\u0000${JSON.stringify(key)}`
  const sizeOf = (table: Table, value: unknown): number => {
    if (table === 'entries' || table === 'meta') return 0
    if (table === 'files') {
      const content = (value as { content: string | Uint8Array }).content
      return typeof content === 'string' ? new TextEncoder().encode(content).length : content.byteLength
    }
    return JSON.stringify(value ?? null).length
  }
  return {
    ...inner,
    async apply(ops: readonly Op[]) {
      const next = new Map(sizes)
      for (const op of ops) {
        if ('put' in op) next.set(id(op.put, op.key), sizeOf(op.put, op.value))
        else if ('del' in op) next.delete(id(op.del, op.key))
        else if ('clear' in op) {
          const prefix = op.scope === undefined ? `${op.clear}\u0000` : `${op.clear}\u0000${JSON.stringify([op.scope]).slice(0, -1)},`
          for (const k of [...next.keys()]) if (k.startsWith(prefix)) next.delete(k)
        }
      }
      if ([...next.values()].reduce((sum, n) => sum + n, 0) > limitNow()) throw new DOMException('The phone is full', 'QuotaExceededError')
      // Counted at once, before the write lands: writes that run in parallel (3D downloads 3 at a time) each see the
      // bytes of the others, as a real disk does. (YAZ-5074: counted after the await, three parallel writes each saw
      // the same total, so a full phone took them all.)
      const before = new Map(sizes)
      sizes.clear()
      for (const [k, v] of next) sizes.set(k, v)
      try {
        await inner.apply(ops)
      } catch (error) {
        sizes.clear()
        for (const [k, v] of before) sizes.set(k, v)
        throw error
      }
    },
  }
}
