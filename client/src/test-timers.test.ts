/**
 * The teardown guard (YAZ-2233). A destroyed Milkdown editor still holds its readiness timeouts,
 * whose callback calls the global `removeEventListener` 3 s later: after jsdom's teardown that
 * global is gone, which was the random unhandled ReferenceError. `trackMilkdownTimeouts`' cancel
 * clears exactly those. The first test is the upstream bug itself: when a Milkdown upgrade makes it
 * fail, the guard can go. The block plugin's throttled pointermove is the same kind of leak (the
 * `Element is not defined` after `tableBlock.test.ts`), with its own pair of tests.
 */
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { editorViewCtx } from '@milkdown/kit/core'
import { createCrepe } from './editor/createCrepe'
import { trackMilkdownTimeouts } from './test-timers'

let cancel: () => void
beforeEach(() => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] })
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

/** Two pointermoves 100 ms apart, then destroy: the block plugin's 200 ms throttle still holds the second. */
async function destroyAfterPointermoves(): Promise<void> {
  const root = document.createElement('div')
  document.body.appendChild(root)
  const crepe = createCrepe({ root, defaultValue: 'hello' })
  await crepe.create()
  const view = crepe.editor.ctx.get(editorViewCtx)
  view.dom.dispatchEvent(new MouseEvent('pointermove', { bubbles: true }))
  vi.advanceTimersByTime(100)
  view.dom.dispatchEvent(new MouseEvent('pointermove', { bubbles: true }))
  await crepe.destroy()
  root.remove()
}

it('a destroyed editor still runs the block plugin\'s throttled pointermove 200 ms later (@milkdown/plugin-block 7.22.1)', async () => {
  await destroyAfterPointermoves()
  const fromPoint = vi.spyOn(document, 'elementFromPoint')
  vi.advanceTimersByTime(100)
  expect(fromPoint).toHaveBeenCalled()
})

it('the cancel clears that call, also when lodash re-arms its timeout from inside its own callback', async () => {
  await destroyAfterPointermoves()
  const fromPoint = vi.spyOn(document, 'elementFromPoint')
  // The clock 5 ms behind the timers, as `Date.now()` can be behind Node's loop time: lodash's timeout
  // finds the 200 ms not yet up and arms another for the last 5 ms.
  vi.setSystemTime(Date.now() - 5)
  vi.advanceTimersByTime(100)
  expect(fromPoint).not.toHaveBeenCalled()
  cancel()
  vi.advanceTimersByTime(100)
  expect(fromPoint).not.toHaveBeenCalled()
})
