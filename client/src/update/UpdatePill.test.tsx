/** The update pill (YAZ-2976 D4): a label for each state there is something to act on, nothing for the others, and its click. */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import type { UpdateState } from '@shared/types'
import { UpdatePill } from './UpdatePill'

;(globalThis as unknown as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true

let root: Root | null = null
let host: HTMLElement | null = null
afterEach(() => {
  act(() => root?.unmount())
  host?.remove()
  root = null
  host = null
})

function render(update: UpdateState, onOpen = vi.fn()): HTMLElement {
  host = document.body.appendChild(document.createElement('div'))
  root = createRoot(host)
  act(() => root?.render(<UpdatePill update={update} onOpen={onOpen} />))
  return host
}

describe('UpdatePill', () => {
  it('shows nothing while idle or downloading (D6: the download is the app\'s business)', () => {
    expect(render({ kind: 'idle' }).innerHTML).toBe('')
    act(() => root?.render(<UpdatePill update={{ kind: 'downloading', version: '1.0.13' }} onOpen={vi.fn()} />))
    expect(host!.innerHTML).toBe('')
  })

  it.each([
    ['ready', 'Update ready'],
    ['manual', 'Update available'],
    ['updated', "What's new"],
  ] as const)('%s says "%s", and its title names the version', (kind, label) => {
    const button = render({ kind, version: '1.0.13' }).querySelector('button')!
    expect(button.textContent).toBe(label)
    expect(button.title).toBe('Yaseen Docs 1.0.13')
    expect(button.type).toBe('button')
  })

  it('a click opens the sheet', () => {
    const onOpen = vi.fn()
    const button = render({ kind: 'ready', version: '1.0.13' }, onOpen).querySelector('button')!
    act(() => button.click())
    expect(onOpen).toHaveBeenCalledTimes(1)
  })
})
