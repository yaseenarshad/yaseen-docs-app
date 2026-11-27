/**
 * No Milkdown timeout outlives its test file (YAZ-2233). `@milkdown/ctx` 7.22.1's `Timer` arms a
 * 3 s `setTimeout` for every readiness timer an editor waits on and never clears it, not even on
 * `editor.destroy()` (upstream fixed it in 7.22.2). The callback calls the global
 * `removeEventListener`; if it fires after vitest has torn jsdom down, that global is gone and the
 * run gets an unhandled ReferenceError. Whether it fires in time depends only on how long the
 * worker outlives the file, so `npm test` failed at random under load.
 *
 * `@milkdown/plugin-block` 7.22.1 has the same leak: it throttles `pointermove` with lodash's
 * `throttle(…, 200)` and its `destroy()` never cancels it, so a pointermove in a file's last 200 ms
 * runs again after teardown and reads the gone global `Element` (`tableBlock.test.ts` in CI).
 * lodash may re-arm that timeout from inside its own callback, where no Milkdown frame is on the
 * stack, so a timeout armed while a tracked callback runs is tracked too.
 *
 * `trackMilkdownTimeouts()` wraps the global `setTimeout`, remembers the timeouts armed from
 * `@milkdown/ctx` or `@milkdown/plugin-block`, and returns their cancel; the client setup file runs
 * it in its `afterAll`, after the file's own hooks. Every other timeout is untouched, so a test's
 * own leak still shows.
 */
export function trackMilkdownTimeouts(): () => void {
  const armed = new Set<ReturnType<typeof setTimeout>>()
  const real = globalThis.setTimeout
  let inTracked = false
  globalThis.setTimeout = ((handler: TimerHandler, timeout?: number, ...args: unknown[]) => {
    const tracked = inTracked || /@milkdown\/(ctx|plugin-block)/.test(new Error().stack ?? '')
    if (!tracked) return real(handler, timeout, ...args)
    const id = real(() => {
      armed.delete(id)
      inTracked = true
      try {
        (handler as (...args: unknown[]) => void)(...args)
      } finally {
        inTracked = false
      }
    }, timeout)
    armed.add(id)
    return id
  }) as typeof setTimeout
  return () => {
    for (const id of armed) clearTimeout(id)
    armed.clear()
  }
}
