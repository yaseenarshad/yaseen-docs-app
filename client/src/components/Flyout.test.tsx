/**
 * The app's ONE menu flyout (`FlyoutParent` + `useFlyout`): two parents of one menu share its controller, so one flyout
 * is open at a time, and a plain row on the way from one parent to the other must not undo the swap (YAZ-4747, the demo's
 * "the flyout isnt opening": "Open in ›", over "Copy path", into "Move to Other files ›"). Under fake timers, with the
 * pointer moved as a browser moves it: a `mouseout` off the old element and a `mouseover` on the new one.
 */
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { FlyoutParent, SWITCH_MS, useFlyout } from './Flyout'

;(globalThis as unknown as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true

/** A menu as the row menu builds it: parent A, a plain row that says "no flyout" to the controller (`hover(null)`), a plain row that does not, parent B. */
function Menu() {
  const flyout = useFlyout<'a' | 'b'>()
  const parent = (id: 'a' | 'b', label: string) => (
    <FlyoutParent label={label} open={flyout.open === id} onHover={() => flyout.hover(id)} onOpen={() => flyout.openNow(id)} onCloseFlyout={() => flyout.openNow(null)}>
      <button type="button" role="menuitem" className="ctx-menu__item">
        {`${label} child`}
      </button>
    </FlyoutParent>
  )
  return (
    <div className="ctx-menu" role="menu">
      {parent('a', 'Open in')}
      <button type="button" role="menuitem" className="ctx-menu__item" onMouseEnter={() => flyout.hover(null)}>
        Copy path
      </button>
      <button type="button" role="menuitem" className="ctx-menu__item">
        Quiet row
      </button>
      {parent('b', 'Move to Other files')}
    </div>
  )
}

let host: HTMLElement
let root: Root

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
  act(() => root.render(<Menu />))
})

afterEach(() => {
  act(() => root.unmount())
  host.remove()
  vi.useRealTimers()
})

const row = (text: string): HTMLElement => [...host.querySelectorAll<HTMLElement>('[role="menuitem"]')].find((b) => b.textContent === text)!
/** The open flyouts' rows. */
const flyouts = (): string[] => [...host.querySelectorAll('.ctx-menu__sub')].map((m) => m.textContent ?? '')
/** The pointer comes to rest on `to`, from `from` (null: from outside the window). */
const pointer = (from: Element | null, to: Element): void =>
  act(() => {
    from?.dispatchEvent(new MouseEvent('mouseout', { bubbles: true, relatedTarget: to }))
    to.dispatchEvent(new MouseEvent('mouseover', { bubbles: true, relatedTarget: from }))
  })
const wait = (ms: number): void => act(() => void vi.advanceTimersByTime(ms))

it('the first flyout opens at once; a hover on the other parent swaps them after SWITCH_MS: one open at a time', () => {
  pointer(null, row('Open in'))
  expect(flyouts()).toEqual(['Open in child'])
  pointer(row('Open in'), row('Move to Other files'))
  wait(SWITCH_MS - 1)
  expect(flyouts()).toEqual(['Open in child'])
  wait(1)
  expect(flyouts()).toEqual(['Move to Other files child'])
  expect(row('Open in').getAttribute('aria-expanded')).toBe('false')
  expect(row('Move to Other files').getAttribute('aria-expanded')).toBe('true')
})

it('YAZ-4747: from one parent over a plain row into the other parent, the other flyout opens and the first closes', () => {
  pointer(null, row('Open in'))
  pointer(row('Open in'), row('Copy path'))
  wait(SWITCH_MS / 2)
  pointer(row('Copy path'), row('Move to Other files'))
  // The plain row's close was due here: it must not take the swap with it.
  wait(SWITCH_MS / 2)
  wait(SWITCH_MS)
  expect(flyouts()).toEqual(['Move to Other files child'])
  // And back again, over a row with no hover of its own.
  pointer(row('Move to Other files'), row('Quiet row'))
  wait(SWITCH_MS / 2)
  pointer(row('Quiet row'), row('Open in'))
  wait(SWITCH_MS * 2)
  expect(flyouts()).toEqual(['Open in child'])
})

it('a slow pass: resting on the plain row closes the flyout, and the next parent then opens at once', () => {
  pointer(null, row('Open in'))
  pointer(row('Open in'), row('Copy path'))
  wait(SWITCH_MS)
  expect(flyouts()).toEqual([])
  pointer(row('Copy path'), row('Move to Other files'))
  expect(flyouts()).toEqual(['Move to Other files child'])
})

it('resting on a plain row closes an open flyout, also one that tells the controller nothing (YAZ-3746 13AU)', () => {
  pointer(null, row('Move to Other files'))
  pointer(row('Move to Other files'), row('Quiet row'))
  wait(SWITCH_MS - 1)
  expect(flyouts()).toEqual(['Move to Other files child'])
  wait(1)
  expect(flyouts()).toEqual([])
})

it('the pointer that crosses a plain row into the open flyout keeps it open', () => {
  pointer(null, row('Open in'))
  pointer(row('Open in'), row('Quiet row'))
  wait(SWITCH_MS / 2)
  pointer(row('Quiet row'), row('Open in child'))
  wait(SWITCH_MS * 2)
  expect(flyouts()).toEqual(['Open in child'])
})
