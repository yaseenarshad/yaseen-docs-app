// @vitest-environment jsdom
import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { describe, expect, it } from 'vitest'
import { useWakeLock } from './wakeLock'

/** Round 10, addition 4: the screen stays on while a card shows, if iOS allows it; with no API or a "no", nothing shows. */
;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

function fakeDoc() {
  const target = new EventTarget()
  const doc = Object.assign(target, { visibilityState: 'visible' as DocumentVisibilityState })
  return doc as unknown as Document & { visibilityState: DocumentVisibilityState }
}

async function run(on: boolean, nav: object, doc: Document) {
  function Probe({ on }: { on: boolean }) {
    useWakeLock(on, nav as never, doc)
    return null
  }
  const root = createRoot(document.createElement('div'))
  await act(async () => root.render(createElement(Probe, { on })))
  return { root, rerender: (next: boolean) => act(async () => root.render(createElement(Probe, { on: next }))) }
}

describe('useWakeLock', () => {
  it('asks while a card shows; asks again after the background; lets go when the card goes', async () => {
    const events: string[] = []
    const nav = { wakeLock: { request: async () => (events.push('request'), { release: async () => void events.push('release') }) } }
    const doc = fakeDoc()
    const r = await run(true, nav, doc)
    expect(events).toEqual(['request'])
    ;(doc as { visibilityState: DocumentVisibilityState }).visibilityState = 'hidden'
    await act(async () => void doc.dispatchEvent(new Event('visibilitychange')))
    ;(doc as { visibilityState: DocumentVisibilityState }).visibilityState = 'visible'
    await act(async () => void doc.dispatchEvent(new Event('visibilitychange')))
    expect(events).toEqual(['request', 'release', 'request'])
    await r.rerender(false)
    expect(events).toEqual(['request', 'release', 'request', 'release'])
    act(() => r.root.unmount())
  })

  it('no API, or the API says no: nothing happens and nothing throws (the quiet fallback)', async () => {
    const doc = fakeDoc()
    const a = await run(true, {}, doc)
    const b = await run(true, { wakeLock: { request: () => Promise.reject(new DOMException('Low Power Mode', 'NotAllowedError')) } }, doc)
    act(() => a.root.unmount())
    act(() => b.root.unmount())
  })
})

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

describe('useWakeLock: an ask that is still open', () => {
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
