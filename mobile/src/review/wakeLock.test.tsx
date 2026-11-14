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
    expect(events).toEqual(['request', 'request'])
    await r.rerender(false)
    expect(events).toEqual(['request', 'request', 'release'])
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
