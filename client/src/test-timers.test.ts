/**
 * The teardown guard (YAZ-2233). A destroyed Milkdown editor still holds its readiness timeouts,
 * whose callback calls the global `removeEventListener` 3 s later: after jsdom's teardown that
 * global is gone, which was the random unhandled ReferenceError. `trackMilkdownTimeouts`' cancel
 * clears exactly those. The first test is the upstream bug itself: when a Milkdown upgrade makes it
 * fail, the guard can go.
 */
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { createCrepe } from './editor/createCrepe'
import { trackMilkdownTimeouts } from './test-timers'

let cancel: () => void
beforeEach(() => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
  cancel = trackMilkdownTimeouts()
})
afterEach(() => {
  cancel()
  vi.useRealTimers()
})

async function createAndDestroy(): Promise<void> {
  const root = document.createElement('div')
  document.body.appendChild(root)
  const crepe = createCrepe({ root, defaultValue: 'hello' })
  await crepe.create()
  await crepe.destroy()
  root.remove()
}

it('a destroyed editor still calls removeEventListener from its readiness timeouts 3 s later (@milkdown/ctx 7.22.1)', async () => {
  await createAndDestroy()
  const removeListener = vi.spyOn(globalThis, 'removeEventListener')
  vi.advanceTimersByTime(3000)
  expect(removeListener).toHaveBeenCalled()
})

it('the cancel clears those timeouts and leaves every other timeout alone', async () => {
  await createAndDestroy()
  const removeListener = vi.spyOn(globalThis, 'removeEventListener')
  const ours = vi.fn()
  setTimeout(ours, 3000)
  cancel()
  vi.advanceTimersByTime(3000)
  expect(removeListener).not.toHaveBeenCalled()
  expect(ours).toHaveBeenCalledOnce()
})
