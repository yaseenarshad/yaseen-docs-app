/** The vault's lock in the sidebar (YAZ-4985): its "Allow file changes?" box has the choice box's keys (YAZ-4989). */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { VaultLock } from './VaultLock'

;(globalThis as unknown as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true

let root: Root
let host: HTMLElement
afterEach(() => {
  act(() => root.unmount())
  host.remove()
})

describe('YAZ-4989: the sidebar lock\'s box', () => {
  it('↓ ↑ Tab move through 1 minute · 10 minutes · Cancel and round; Enter picks the focused one; Esc cancels', () => {
    const onAllow = vi.fn()
    host = document.body.appendChild(document.createElement('div'))
    root = createRoot(host)
    act(() => root.render(<VaultLock until={null} onAllow={onAllow} onLock={vi.fn()} />))
    const open = () => act(() => host.querySelector<HTMLButtonElement>('.vault-lock__button')!.click())
    const press = (k: string, init: KeyboardEventInit = {}) => act(() => void document.activeElement!.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true, ...init })))
    const focused = () => document.activeElement?.textContent
    open()
    expect(focused()).toBe('Allow file changes for 1 minute')
    press('ArrowDown')
    expect(focused()).toBe('10 minutes')
    press('Tab')
    expect(focused()).toBe('Cancel')
    press('ArrowDown')
    expect(focused()).toBe('Allow file changes for 1 minute')
    press('ArrowUp')
    press('ArrowUp')
    expect(focused()).toBe('10 minutes')
    press('Enter')
    expect(onAllow).toHaveBeenCalledExactlyOnceWith('ten')
    open()
    press('Escape')
    expect(host.querySelector('.vault-lock__ask')).toBeNull()
  })
})
