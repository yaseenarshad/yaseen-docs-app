import type { Backend, Key, Op } from './backend'
import type { FileEntry } from './vaultStore'

/**
 * Test help: a backend that holds at most `limit` bytes of files and rejects a batch that would pass it with a
 * `QuotaExceededError`, as a full phone does. It wraps either backend, so row P2 runs on both.
 */
export function limitedBackend(inner: Backend, limit: number): Backend {
  const id = (key: Key) => JSON.stringify(key)
  return {
    ...inner,
    async apply(ops: readonly Op[]) {
      const sizes = new Map(((await inner.all('entries')) as FileEntry[]).map((e) => [id([e.vault, e.path]), { vault: e.vault, size: e.size }]))
      for (const op of ops) {
        if ('put' in op && op.put === 'entries') sizes.set(id(op.key), { vault: (op.value as FileEntry).vault, size: (op.value as FileEntry).size })
        else if ('del' in op && op.del === 'entries') sizes.delete(id(op.key))
        else if ('clear' in op && op.clear === 'entries') for (const [k, v] of sizes) if (op.scope === undefined || v.vault === op.scope) sizes.delete(k)
      }
      const total = [...sizes.values()].reduce((sum, e) => sum + e.size, 0)
      if (total > limit) throw new DOMException('The phone is full', 'QuotaExceededError')
      return inner.apply(ops)
    },
  }
}
