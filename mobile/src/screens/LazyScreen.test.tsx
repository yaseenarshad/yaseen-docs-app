// @vitest-environment jsdom
import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { describe, expect, it } from 'vitest'
import { CHUNK_FAILED, lazyScreen } from './LazyScreen'

/** YAZ-5230: the one wrapper of the app's lazy screens; the checker's M3: "Try again" is a NEW import. */
;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
const settle = async () => {
  for (let i = 0; i < 5; i++) await act(async () => void (await new Promise((r) => setTimeout(r, 0))))
}

describe('lazyScreen', () => {
  it('a failed chunk: plain words, Try again and Back; Try again imports again and shows the screen', async () => {
    let calls = 0
    const Screen = lazyScreen<{ word: string }>(async () => {
      calls++
      if (calls === 1) throw new TypeError('Importing a module script failed.')
      return { default: ({ word }: { word: string }) => createElement('p', null, `Loaded ${word}`) }
    })
    let backs = 0
    const host = document.createElement('div')
    const root = createRoot(host)
    const onError = (e: ErrorEvent) => e.preventDefault()
    window.addEventListener('error', onError)
    await act(async () => root.render(createElement(Screen, { word: 'yes', onBack: () => void backs++ })))
    await settle()
    expect(host.textContent).toContain(CHUNK_FAILED)
    expect(host.textContent).not.toContain('Importing a module')
    const button = (name: string) => [...host.querySelectorAll('button')].find((b) => b.textContent === name)!
    await act(async () => button('‹ Back').click())
    expect(backs).toBe(1)
    await act(async () => button('Try again').click())
    await settle()
    window.removeEventListener('error', onError)
    expect(calls).toBe(2)
    expect(host.textContent).toBe('Loaded yes')
    act(() => root.unmount())
  })
})
