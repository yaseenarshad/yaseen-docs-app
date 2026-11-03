/**
 * ONE MERGE AT A TIME (YAZ-4279 item 4). An AI can save one file several times in a few seconds, and each merge reads the
 * file again. A call while a run is in flight is remembered — only the latest — and runs once, when that run ends.
 */
export function oneAtATime(run: (mtime: number) => Promise<void>): (mtime: number) => Promise<void> {
  let running = false
  let again: number | null = null
  return async (mtime) => {
    if (running) {
      again = mtime
      return
    }
    running = true
    try {
      for (let next: number | null = mtime; next !== null; next = again) {
        again = null
        await run(next)
      }
    } finally {
      running = false
    }
  }
}
