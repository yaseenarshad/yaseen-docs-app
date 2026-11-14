// @vitest-environment jsdom
import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { describe, expect, it, vi } from 'vitest'
import { CHUNK_FAILED, lazyScreen } from './LazyScreen'
;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const settle = async () => {
  for (let i = 0; i < 6; i++) await act(async () => void (await new Promise((r) => setTimeout(r, 0))))
}
describe('checker round 2: lazyScreen (YAZ-5230)', () => {
  it('L1: fails once, then "Try again" loads it; fails for ever: the words stay, no throw', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    let calls = 0
    const Fine = (p: { word: string }) => createElement('p', null, `loaded ${p.word}`)
    const Once = lazyScreen<{ word: string }>(async () => {
      calls++
      if (calls === 1) throw new TypeError('Failed to fetch dynamically imported module')
      return { default: Fine }
    })
    const host = document.createElement('div')
    document.body.append(host)
    const root = createRoot(host)
    await act(async () => root.render(createElement(Once, { word: 'x' })))
    await settle()
    const first = host.textContent
    const retry = [...host.querySelectorAll('button')].find((b) => b.textContent === 'Try again')!
    await act(async () => retry.click())
    await settle()
    console.log(`[L1] first: "${first}" | after Try again: "${host.textContent}" | imports ${calls}`)
    expect(first).toContain(CHUNK_FAILED)
    expect(host.textContent).toBe('loaded x')

    let n = 0
    const Never = lazyScreen(async () => {
      n++
      throw new TypeError('Failed to fetch')
    })
    await act(async () => root.render(createElement(Never, {})))
    await settle()
    for (let i = 0; i < 3; i++) {
      const b = [...host.querySelectorAll('button')].find((x) => x.textContent === 'Try again')!
      await act(async () => b.click())
      await settle()
    }
    console.log(`[L1] for ever: "${host.textContent}" | imports ${n} | role ${host.firstElementChild?.getAttribute('role')}`)
    expect(host.textContent).toContain(CHUNK_FAILED)
    act(() => root.unmount())
  })
})
