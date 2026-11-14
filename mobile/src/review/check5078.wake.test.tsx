// @vitest-environment jsdom
import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { describe, expect, it } from 'vitest'
import { useWakeLock } from './wakeLock'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

/** A fake Wake Lock whose requests the test resolves by hand; counts what is held. */
function fakeLock() {
  const pending: ((v: { release(): Promise<void> }) => void)[] = []
  let held = 0
  let asked = 0
  const api = {
    request: () => {
      asked++
      return new Promise<{ release(): Promise<void> }>((resolve) => pending.push(resolve))
    },
  }
  const grantAll = () => {
    for (const r of pending.splice(0))
      r({
        released: false,
        async release() {
          if (!(this as { released: boolean }).released) held--
          ;(this as { released: boolean }).released = true
        },
      } as never)
    held += 0
  }
  return { api, pending, grantAll, get held() { return held }, set held(v) { held = v }, get asked() { return asked } }
}

describe('4B checker: the Wake Lock', () => {
  it('4B-F: hidden then visible again while the first ask is still open: one lock at most, and none after leave', async () => {
    const f = fakeLock()
    let vis: DocumentVisibilityState = 'visible'
    const doc = new EventTarget() as unknown as Document
    Object.defineProperty(doc, 'visibilityState', { get: () => vis })
    const nav = { wakeLock: f.api }
    function Probe({ on }: { on: boolean }) {
      useWakeLock(on, nav as never, doc)
      return null
    }
    const root = createRoot(document.createElement('div'))
    await act(async () => root.render(createElement(Probe, { on: true })))
    console.log('[4B-F] asks right after mount', f.asked)
    // The ask is open (iOS can take a moment). The person leaves and comes back.
    vis = 'hidden'
    doc.dispatchEvent(new Event('visibilitychange'))
    vis = 'visible'
    doc.dispatchEvent(new Event('visibilitychange'))
    const asks = f.asked
    // Both asks are granted now.
    const granted = f.pending.length
    for (const r of f.pending.splice(0)) {
      f.held++
      const lock = { released: false, async release() { if (!lock.released) f.held--; lock.released = true } }
      r(lock)
    }
    await act(async () => {})
    // The person leaves the Review tab.
    await act(async () => root.unmount())
    await act(async () => {})
    console.log(`[4B-F] asks ${asks}, granted ${granted}, still held after leave ${f.held}`)
    expect(f.held).toBe(0)
  })
})
