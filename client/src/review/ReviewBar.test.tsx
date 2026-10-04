/**
 * The review surface's chrome (YAZ-2322): the top bar that stands in the tab strip's place, the
 * answer bar under the notecard, the message the main pane shows when it has no page of its own —
 * and the session's keys, which the top bar owns because it is mounted exactly while one is open.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, type ReactNode } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { ReviewAnswers, ReviewBar, ReviewMessage } from './ReviewBar'
import type { ReviewSession } from './useReview'

;(globalThis as unknown as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true

let root: Root | null = null
let container: HTMLElement | null = null

function mount(node: ReactNode): HTMLElement {
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  act(() => root?.render(node))
  return container
}

afterEach(() => {
  act(() => root?.unmount())
  root = null
  container?.remove()
  container = null
  document.body.replaceChildren()
})

const session = (over: Partial<ReviewSession> = {}): ReviewSession => ({ label: 'Inbox', path: '/v/a.md', position: 2, total: 5, canUndo: false, ...over })
const handlers = () => ({ onKeep: vi.fn(), onSkip: vi.fn(), onUndo: vi.fn(), onClose: vi.fn() })
const button = (el: HTMLElement, name: string) => [...el.querySelectorAll('button')].find((b) => (b.getAttribute('aria-label') ?? b.textContent) === name)

describe('ReviewBar', () => {
  it('shows the session label and the notecard\'s place among the total', () => {
    const el = mount(<ReviewBar session={session({ label: 'Projects' })} {...handlers()} />)
    expect(el.querySelector('.review-bar__label')?.textContent).toBe('Projects')
    expect(el.querySelector('.review-bar__count')?.textContent).toBe('2 of 5')
  })

  it('shows no place once nothing is left', () => {
    const el = mount(<ReviewBar session={session({ path: null, position: 5 })} {...handlers()} />)
    expect(el.querySelector('.review-bar__count')).toBeNull()
  })

  it('Undo is disabled until there is an answer to take back, then calls its handler', () => {
    const h = handlers()
    const el = mount(<ReviewBar session={session()} {...h} />)
    expect(button(el, 'Undo')?.disabled).toBe(true)
    act(() => root?.render(<ReviewBar session={session({ canUndo: true })} {...h} />))
    expect(button(el, 'Undo')?.disabled).toBe(false)
    act(() => button(el, 'Undo')?.click())
    expect(h.onUndo).toHaveBeenCalledTimes(1)
  })

  it('the close button is named "Close review" and closes', () => {
    const h = handlers()
    const el = mount(<ReviewBar session={session()} {...h} />)
    act(() => button(el, 'Close review')?.click())
    expect(h.onClose).toHaveBeenCalledTimes(1)
  })
})

describe('ReviewAnswers', () => {
  it('"Still relevant" and "Skip" call their handlers, each showing its chord', () => {
    const onKeep = vi.fn()
    const onSkip = vi.fn()
    const el = mount(<ReviewAnswers onKeep={onKeep} onSkip={onSkip} />)
    const [keep, skip] = [...el.querySelectorAll('button')]
    expect([keep.textContent, skip.textContent]).toEqual(['Still relevant⌘⇧⏎', 'Skip⌘⇧S'])
    act(() => keep.click())
    act(() => skip.click())
    expect(onKeep).toHaveBeenCalledTimes(1)
    expect(onSkip).toHaveBeenCalledTimes(1)
  })
})

describe('ReviewMessage', () => {
  it('nothing left in the Inbox: "Inbox complete." and a way back to the tabs', () => {
    const onClose = vi.fn()
    const el = mount(<ReviewMessage session={session({ path: null })} onClose={onClose} />)
    expect(el.querySelector('p')?.textContent).toBe('Inbox complete.')
    act(() => button(el, 'Back to tabs')?.click())
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('nothing left in a folder names the folder', () => {
    const el = mount(<ReviewMessage session={session({ label: 'Projects', path: null })} onClose={vi.fn()} />)
    expect(el.querySelector('p')?.textContent).toBe('Nothing due in Projects.')
  })

  it('a notecard that is showing means it is open in the side panel: one line, no button', () => {
    const el = mount(<ReviewMessage session={session()} onClose={vi.fn()} />)
    expect(el.textContent).toBe('This notecard is open in the side panel.')
    expect(el.querySelector('button')).toBeNull()
  })
})

describe('the session\'s keys', () => {
  /** A keydown from `target`, as the window hears it; returns the event so a test can read `defaultPrevented`. */
  const press = (init: KeyboardEventInit, target: EventTarget = document.body): KeyboardEvent => {
    const event = new KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...init })
    act(() => void target.dispatchEvent(event))
    return event
  }
  const KEEP = { key: 'Enter', metaKey: true, shiftKey: true }
  const SKIP = { key: 'S', metaKey: true, shiftKey: true }

  it('⌘⇧⏎ keeps and ⌘⇧S skips, and the key goes no further — not even to the editor the caret is in', () => {
    const h = handlers()
    const el = mount(<ReviewBar session={session()} {...h} />)
    const editor = el.appendChild(document.createElement('div'))
    const heard = vi.fn()
    editor.addEventListener('keydown', heard)
    expect(press(KEEP, editor).defaultPrevented).toBe(true)
    expect(press(SKIP, editor).defaultPrevented).toBe(true)
    expect(h.onKeep).toHaveBeenCalledTimes(1)
    expect(h.onSkip).toHaveBeenCalledTimes(1)
    expect(heard).not.toHaveBeenCalled()
  })

  it('a held chord answers once', () => {
    const h = handlers()
    mount(<ReviewBar session={session()} {...h} />)
    press(KEEP)
    expect(press({ ...KEEP, repeat: true }).defaultPrevented).toBe(true)
    expect(h.onKeep).toHaveBeenCalledTimes(1)
  })

  it('⌘⏎ and a bare S are not the review\'s', () => {
    const h = handlers()
    mount(<ReviewBar session={session()} {...h} />)
    expect(press({ key: 'Enter', metaKey: true }).defaultPrevented).toBe(false)
    expect(press({ key: 's' }).defaultPrevented).toBe(false)
    expect(h.onKeep).not.toHaveBeenCalled()
    expect(h.onSkip).not.toHaveBeenCalled()
  })

  it('Escape closes', () => {
    const h = handlers()
    mount(<ReviewBar session={session()} {...h} />)
    press({ key: 'Escape' })
    expect(h.onClose).toHaveBeenCalledTimes(1)
  })

  it('Escape that something nearer already took does nothing', () => {
    const h = handlers()
    const el = mount(<ReviewBar session={session()} {...h} />)
    const findBar = el.appendChild(document.createElement('input'))
    findBar.addEventListener('keydown', (event) => event.preventDefault())
    press({ key: 'Escape' }, findBar)
    expect(h.onClose).not.toHaveBeenCalled()
  })

  it.each([
    ['a modal', { role: 'dialog', 'aria-modal': 'true' }],
    ['a picker', { role: 'dialog' }],
    ['a menu', { role: 'menu' }],
  ])('%s that is open keeps every key', (_what, attributes) => {
    const h = handlers()
    mount(<ReviewBar session={session()} {...h} />)
    const owner = document.body.appendChild(document.createElement('div'))
    for (const [name, value] of Object.entries(attributes)) owner.setAttribute(name, value)
    press({ key: 'Escape' })
    expect(press(KEEP).defaultPrevented).toBe(false)
    press(SKIP)
    expect(h.onClose).not.toHaveBeenCalled()
    expect(h.onKeep).not.toHaveBeenCalled()
    expect(h.onSkip).not.toHaveBeenCalled()
  })

  it('no session, no keys: the listeners leave with the bar', () => {
    const h = handlers()
    mount(<ReviewBar session={session()} {...h} />)
    act(() => root?.render(null))
    expect(press(KEEP).defaultPrevented).toBe(false)
    press(SKIP)
    press({ key: 'Escape' })
    expect(h.onKeep).not.toHaveBeenCalled()
    expect(h.onSkip).not.toHaveBeenCalled()
    expect(h.onClose).not.toHaveBeenCalled()
  })
})
