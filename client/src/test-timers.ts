/**
 * No Milkdown timeout outlives its test file (YAZ-2233). `@milkdown/ctx` 7.22.1's `Timer` arms a
 * 3 s `setTimeout` for every readiness timer an editor waits on and never clears it, not even on
 * `editor.destroy()` (upstream fixed it in 7.22.2). The callback calls the global
 * `removeEventListener`; if it fires after vitest has torn jsdom down, that global is gone and the
 * run gets an unhandled ReferenceError. Whether it fires in time depends only on how long the
 * worker outlives the file, so `npm test` failed at random under load.
 *
 * `trackMilkdownTimeouts()` wraps the global `setTimeout`, remembers the timeouts armed from
 * `@milkdown/ctx`, and returns their cancel; the client setup file runs it in its `afterAll`, after
 * the file's own hooks. Every other timeout is untouched, so a test's own leak still shows.
 */
export function trackMilkdownTimeouts(): () => void {
  const armed = new Set<ReturnType<typeof setTimeout>>()
  const real = globalThis.setTimeout
  globalThis.setTimeout = ((...args: Parameters<typeof setTimeout>) => {
    const id = real(...args)
    if (new Error().stack?.includes('@milkdown/ctx')) armed.add(id)
    return id
  }) as typeof setTimeout
  return () => {
    for (const id of armed) clearTimeout(id)
    armed.clear()
  }
}
