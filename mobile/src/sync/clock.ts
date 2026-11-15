import type { Clock } from './engine'

/** The browser's clock and timers: what each part takes when its options give no `clock` (tests give a fake one). */
export const browserClock: Clock = {
  now: () => Date.now(),
  setTimeout: (fn, ms) => globalThis.setTimeout(fn, ms),
  clearTimeout: (handle) => globalThis.clearTimeout(handle as ReturnType<typeof setTimeout>),
}
