/**
 * The toast's own clock (YAZ-3303 D8, D9): it goes after `ms`, shows the seconds left in a small grey
 * count that is not in its text, holds while the mouse is on it, and starts the full time again when
 * the mouse leaves. With no `ms` it stays until ✕. CSS runs the count (jsdom runs no animation), so
 * these tests read what it starts from and whether it runs; `fileClipboard.spec.ts` sees it step down.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import type { Notice } from '../lib/notice'
import { NoticeToast } from './NoticeToast'

;(globalThis as unknown as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true

let root: Root | null = null
let el: HTMLElement
const onClose = vi.fn()

beforeEach(() => {
  vi.useFakeTimers()
  onClose.mockReset()
  el = document.createElement('div')
  document.body.appendChild(el)
  root = createRoot(el)
})
afterEach(() => {
  act(() => root?.unmount())
  root = null
  el.remove()
  vi.useRealTimers()
})

const undo: Notice = { text: 'Moved 1 file (a.md)', icon: 'paste', action: { label: 'Undo', run: () => undefined, fades: true } }
const show = (notice: Notice, ms: number | null) => act(() => root?.render(<NoticeToast notice={notice} ms={ms} onClose={onClose} />))
const clock = () => el.querySelector<HTMLElement>('.link-notice__clock')
/** The whole seconds the count starts from, and whether it runs: `[6, true]`. */
const count = () => (clock() === null ? undefined : [Number(clock()!.style.getPropertyValue('--left')), clock()!.classList.contains('link-notice__clock--running')])
const toast = () => el.querySelector<HTMLElement>('.link-notice')!
// React's onMouseEnter and onMouseLeave come from mouseover and mouseout with a target outside.
const enter = () => act(() => void toast().dispatchEvent(new MouseEvent('mouseover', { bubbles: true, relatedTarget: document.body })))
const leave = () => act(() => void toast().dispatchEvent(new MouseEvent('mouseout', { bubbles: true, relatedTarget: document.body })))
const tick = (ms: number) => act(() => vi.advanceTimersByTime(ms))

describe('NoticeToast (YAZ-3303)', () => {
  it('counts down from the whole seconds, outside the toast text, and closes after ms (S4 to S7)', () => {
    show(undo, 6000)
    expect(count()).toEqual([6, true])
    expect(clock()?.style.getPropertyValue('--count-ms')).toBe('6000ms')
    expect(toast().textContent).toBe('Moved 1 file (a.md)Undo')
    expect(clock()?.getAttribute('aria-hidden')).toBe('true')
    tick(5999)
    expect(onClose).not.toHaveBeenCalled()
    tick(1)
    expect(onClose).toHaveBeenCalledOnce()
  })

  it('the mouse holds it at the full time; leaving starts the full time again (S10, S11)', () => {
    show(undo, 6000)
    tick(3000)
    enter()
    expect(count()).toEqual([6, false])
    tick(60_000)
    expect(onClose).not.toHaveBeenCalled()
    leave()
    expect(count()).toEqual([6, true])
    tick(5999)
    expect(onClose).not.toHaveBeenCalled()
    tick(1)
    expect(onClose).toHaveBeenCalledOnce()
  })

  it('with no ms it has no count and stays; ✕ closes it (S8, S13)', () => {
    show({ text: 'Copied path', icon: 'info' }, null)
    expect(count()).toBeUndefined()
    tick(60_000)
    expect(onClose).not.toHaveBeenCalled()
    const close = el.querySelector<HTMLButtonElement>('.link-notice__close')!
    expect(close.getAttribute('aria-label')).toBe('Dismiss')
    act(() => close.click())
    expect(onClose).toHaveBeenCalledOnce()
  })

  it('a new toast that comes while the mouse holds the toast is held too (S12)', () => {
    show({ text: 'Copied path', icon: 'info' }, 4000)
    enter()
    show({ text: 'Copied 2 paths', icon: 'info' }, 4000)
    tick(60_000)
    expect(onClose).not.toHaveBeenCalled()
    expect(toast().textContent).toBe('Copied 2 paths')
    leave()
    tick(4000)
    expect(onClose).toHaveBeenCalledOnce()
  })

  it('a new notice starts the clock again', () => {
    show({ text: 'Copied path', icon: 'info' }, 4000)
    tick(3000)
    const before = clock()
    show({ text: 'Copied 2 paths', icon: 'info' }, 4000)
    expect(count()).toEqual([4, true])
    expect(clock()).not.toBe(before) // a new element, so its CSS count starts again
    tick(3999)
    expect(onClose).not.toHaveBeenCalled()
    tick(1)
    expect(onClose).toHaveBeenCalledOnce()
  })
})
