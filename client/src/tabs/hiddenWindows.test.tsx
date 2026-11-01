import { afterEach, describe, expect, it, vi } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { useWindowHidden } from './hiddenWindows'

let push: (ids: string[]) => void = () => undefined
vi.mock('../api', () => ({
  api: {
    window: {
      hiddenWindows: vi.fn(async () => []),
      onHiddenWindows: vi.fn((take: (ids: string[]) => void) => ((push = take), () => undefined)),
      minimizedWindows: vi.fn(async () => []),
      onMinimizedWindows: vi.fn(() => () => undefined),
    },
  },
}))

;(globalThis as unknown as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true

let root: Root | null = null
afterEach(() => {
  act(() => root?.unmount())
  root = null
})

describe('hiddenWindows (YAZ-3343 D23, YAZ-3737 S10)', () => {
  it('useWindowHidden renders only when ITS window goes in or out of the set, not on a push about another window', async () => {
    const seen: boolean[] = []
    function Probe() {
      seen.push(useWindowHidden('w1'))
      return null
    }
    root = createRoot(document.createElement('div'))
    await act(async () => root!.render(<Probe />))
    expect(seen).toEqual([false])
    act(() => push(['w2']))
    act(() => push(['w2', 'w3']))
    expect(seen).toEqual([false]) // other windows hid: no render
    act(() => push(['w1', 'w2']))
    act(() => push(['w2']))
    expect(seen).toEqual([false, true, false])
  })
})
