/**
 * Cold-start deep links (E1, GRO-2171): macOS fires `open-url` before `ready`, so
 * `main/index.ts` pushes every URL here and calls `flush()` once `restore()` has run —
 * queued URLs replay in order, and from then on pushes go straight to the handler.
 */
export interface LinkQueue {
  push(url: string): void
  /** The URLs that wait for `flush()` (YAZ-2589 D1): what this launch was asked to open. */
  pending(): readonly string[]
  flush(): void
}

export function createLinkQueue(handle: (url: string) => void): LinkQueue {
  const queued: string[] = []
  let ready = false
  return {
    push(url) {
      if (ready) handle(url)
      else queued.push(url)
    },
    pending: () => queued,
    flush() {
      ready = true
      for (const url of queued.splice(0)) handle(url)
    },
  }
}
