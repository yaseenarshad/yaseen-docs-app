import { afterEach, describe, expect, it } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { inspectSurface, useAutomationSurface, waitForSurface } from './surfaces'

;(globalThis as unknown as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true

function Probe({ id, n }: { id: string; n: number }) {
  useAutomationSurface(id, { ready: n > 0, inspect: () => ({ n }) })
  return null
}
let root: Root | null = null
const render = (id: string, n: number) => act(async () => root!.render(<Probe id={id} n={n} />))
afterEach(() => { act(() => root?.unmount()); root = null })

describe('useAutomationSurface (YAZ-4527 P23)', () => {
  it('reads the committed state through one registration, wakes a pending wait on a commit, and leaves on unmount or a new key', async () => {
    root = createRoot(document.createElement('div'))
    await render('a', 0)
    expect(inspectSurface('a')).toEqual({ state: 'unavailable' })
    const ready = waitForSurface('a', surface => surface.inspect().n === 2)
    await render('a', 1)
    expect(inspectSurface('a')).toEqual({ n: 1, state: 'ready' })
    await render('a', 2)
    expect((await ready).inspect()).toEqual({ n: 2 })
    await render('b', 3)
    expect(inspectSurface('a')).toEqual({ state: 'unavailable' })
    expect(inspectSurface('b')).toEqual({ n: 3, state: 'ready' })
    act(() => root!.unmount()); root = null
    expect(inspectSurface('b')).toEqual({ state: 'unavailable' })
  })
})
