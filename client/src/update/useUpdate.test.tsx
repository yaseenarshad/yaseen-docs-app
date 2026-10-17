/** useUpdate (YAZ-2976 D4): one read on mount, then main's pushes; a push beats a late read; unsubscribed on unmount. */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import type { UpdateState } from '@shared/types'
import { useUpdate } from './useUpdate'

;(globalThis as unknown as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true

let root: Root | null = null
afterEach(() => {
  act(() => root?.unmount())
  root = null
  delete (window as unknown as Record<string, unknown>).yaseenDocs
})

function installBridge(read: () => Promise<UpdateState>) {
  const listeners = new Set<(state: UpdateState) => void>()
  const bridge = {
    update: {
      state: vi.fn(read),
      onState: vi.fn((l: (state: UpdateState) => void) => {
        listeners.add(l)
        return () => listeners.delete(l)
      }),
    },
  }
  Object.defineProperty(window, 'yaseenDocs', { value: bridge, configurable: true, writable: true })
  return { push: (state: UpdateState) => listeners.forEach((l) => l(state)), count: () => listeners.size }
}

let seen: UpdateState[] = []
function Probe() {
  seen.push(useUpdate())
  return null
}

async function mount(): Promise<void> {
  seen = []
  root = createRoot(document.createElement('div'))
  await act(async () => root?.render(<Probe />))
}

describe('useUpdate', () => {
  it('starts idle, takes the read, then follows the pushes, and unsubscribes on unmount', async () => {
    const b = installBridge(async () => ({ kind: 'downloading', version: '1.0.13' }))
    await mount()
    expect(seen[0]).toEqual({ kind: 'idle' })
    expect(seen.at(-1)).toEqual({ kind: 'downloading', version: '1.0.13' })
    act(() => b.push({ kind: 'ready', version: '1.0.13' }))
    expect(seen.at(-1)).toEqual({ kind: 'ready', version: '1.0.13' })
    act(() => root?.unmount())
    root = null
    expect(b.count()).toBe(0)
  })

  it('a push before the read answers wins: the late read is older', async () => {
    let answer: (state: UpdateState) => void = () => undefined
    const b = installBridge(() => new Promise((resolve) => (answer = resolve)))
    await mount()
    act(() => b.push({ kind: 'ready', version: '1.0.13' }))
    await act(async () => answer({ kind: 'downloading', version: '1.0.13' }))
    expect(seen.at(-1)).toEqual({ kind: 'ready', version: '1.0.13' })
  })

  it('a failed read leaves idle: no pill', async () => {
    installBridge(async () => Promise.reject(new Error('no handler')))
    await mount()
    expect(seen.at(-1)).toEqual({ kind: 'idle' })
  })
})
