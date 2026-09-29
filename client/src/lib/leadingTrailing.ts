/**
 * A watcher-burst gate (YAZ-2240): the first call after a quiet spell runs at once, and calls inside
 * the spell coalesce into ONE trailing run, `quietMs` after the last of them. So a lone external
 * add refreshes immediately, while a sync pull's storm still costs two reads, not one per event.
 * (Trailing-only, as YAZ-2191 had it, made even a lone add wait out the whole quiet spell.)
 */
export function leadingTrailing(run: () => void, quietMs: number) {
  let timer: ReturnType<typeof setTimeout> | null = null
  let pending = false
  const cancel = () => {
    if (timer !== null) clearTimeout(timer)
    timer = null
    pending = false
  }
  return {
    call() {
      if (timer === null) run()
      else {
        clearTimeout(timer)
        pending = true
      }
      timer = setTimeout(() => {
        timer = null
        if (!pending) return
        pending = false
        run()
      }, quietMs)
    },
    /** Runs now and drops any pending trailing run: a watcher's `ready` (a (re)subscription) reads at once. */
    flush() {
      cancel()
      run()
    },
    cancel,
  }
}
