/**
 * ContextMenuSurface: what closes a menu. A click in a frame (a draw.io diagram) never reaches the page, so the
 * window's blur closes it too (YAZ-4156 demo round 2).
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

  it('when the window loses focus, as a click into a draw.io frame makes it do', () => {
    const onClose = vi.fn()
    mount(onClose)
    act(() => void window.dispatchEvent(new Event('blur')))
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('a dialog on the surface stays when the window loses focus, so a typed search is kept, and leaves a frame its keyboard (YAZ-4156 3H, checker)', () => {
    const onClose = vi.fn()
    const frame = document.body.appendChild(document.createElement('iframe'))
    frame.focus()
    mount(onClose, 'dialog')
    act(() => void window.dispatchEvent(new Event('blur')))
    expect([onClose.mock.calls.length, document.activeElement === frame]).toEqual([0, true])
  })

  it('takes the keyboard back from a frame that has it as the menu opens, so a click into the frame blurs the window again', () => {
    const frame = document.body.appendChild(document.createElement('iframe'))
    frame.focus()
    expect(document.activeElement).toBe(frame)
    mount(vi.fn())
    expect(document.activeElement).not.toBe(frame)
  })
})
