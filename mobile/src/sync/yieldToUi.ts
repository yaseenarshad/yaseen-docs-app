/**
 * Gives the UI thread back for a moment, so a long sync pass never blocks a tap or a frame. `scheduler.yield()` where
 * the browser has it (it keeps the task's place), else a zero timeout (a new task; the browser can draw first).
 */
export function yieldToUi(): Promise<void> {
  const scheduler = (globalThis as { scheduler?: { yield?: () => Promise<void> } }).scheduler
  if (typeof scheduler?.yield === 'function') return scheduler.yield()
  return new Promise((resolve) => setTimeout(resolve, 0))
}

/**
 * A slicer for a long loop: call it after each small unit of work. It yields only when this slice has run `sliceMs`,
 * so the cost of yielding stays small and no slice gets near a "long task" (50 ms). Parallel workers (the downloads)
 * share ONE yield: when one of them yields, each other worker waits for that same yield at its next call. Without
 * this, the other workers kept the thread while the first one waited (measured: 50 ms holds in the 1,700-file test).
 */
export function uiSlicer(yieldFn: () => Promise<void> = yieldToUi, sliceMs = 8, now: () => number = () => performance.now()): () => Promise<void> {
  let start = now()
  let pending: Promise<void> | null = null
  return () => {
    if (pending === null && now() - start >= sliceMs)
      pending = yieldFn().then(() => {
        start = now()
        pending = null
      })
    return pending ?? Promise.resolve()
  }
}
