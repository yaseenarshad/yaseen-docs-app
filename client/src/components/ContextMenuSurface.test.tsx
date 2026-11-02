/**
 * ContextMenuSurface: what closes a menu. A press in a frame (a draw.io diagram) never reaches the page, so the
 * keyboard going into the frame closes it too (YAZ-4156 bug 3H); a switch to another app does not.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { ContextMenuSurface } from './ContextMenuSurface'

;(globalThis as unknown as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true

let root: Root | null = null
afterEach(() => {
  act(() => root?.unmount())
  root = null
  document.body.innerHTML = ''
})

const mount = (onClose: () => void, role?: 'menu' | 'dialog') => {
  root = createRoot(document.body.appendChild(document.createElement('div')))
  act(() => root?.render(<ContextMenuSurface x={0} y={0} onClose={onClose} role={role}><button type="button">Row</button></ContextMenuSurface>))
}

describe('ContextMenuSurface closes', () => {
  it('on a press outside it and on Esc, not on a press inside it', () => {
    const onClose = vi.fn()
    mount(onClose)
    act(() => void document.querySelector('.ctx-menu button')?.dispatchEvent(new MouseEvent('mousedown', { bubbles: true })))
    expect(onClose).not.toHaveBeenCalled()
    act(() => void document.body.dispatchEvent(new MouseEvent('mousedown', { bubbles: true })))
    act(() => void window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' })))
    expect(onClose).toHaveBeenCalledTimes(2)
  })

  it('when the keyboard goes into a frame, as a press in a draw.io diagram does: the window blurs and the frame is active', async () => {
    const onClose = vi.fn()
    mount(onClose)
    const frame = document.body.appendChild(document.createElement('iframe'))
    frame.focus()
    act(() => void window.dispatchEvent(new Event('blur')))
    await act(async () => new Promise((done) => setTimeout(done)))
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('not on a switch to another app: the window blurs but no frame takes the keyboard, so a typed field keeps its text (YAZ-4156 checker round 2)', async () => {
    for (const role of ['menu', 'dialog'] as const) {
      const onClose = vi.fn()
      mount(onClose, role)
      act(() => void window.dispatchEvent(new Event('blur')))
      await act(async () => new Promise((done) => setTimeout(done)))
      expect([role, onClose.mock.calls.length]).toEqual([role, 0])
      act(() => root?.unmount())
      root = null
    }
  })

  it('takes the keyboard back from a frame that has it as the menu opens, so a click into the frame blurs the window again', () => {
    const frame = document.body.appendChild(document.createElement('iframe'))
    frame.focus()
    expect(document.activeElement).toBe(frame)
    mount(vi.fn())
    expect(document.activeElement).not.toBe(frame)
  })
})
