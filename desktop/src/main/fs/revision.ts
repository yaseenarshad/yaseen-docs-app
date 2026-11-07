import { createHash } from 'node:crypto'

/** A saved snapshot's modification time plus its exact text bytes. */
export const revisionOf = (content: string | Uint8Array, mtime: number): string => `${mtime}:${createHash('sha256').update(content).digest('hex')}`

const writers = new Map<string, Promise<unknown>>()
/** All in-process writers using this boundary check their base inside the same resource turn. */
export function serializeFile<T>(path: string, write: () => Promise<T>): Promise<T> {
  const previous = writers.get(path) ?? Promise.resolve()
  const result = previous.catch(() => undefined).then(write)
  writers.set(path, result)
  void result.finally(() => { if (writers.get(path) === result) writers.delete(path) }).catch(() => undefined)
  return result
}
