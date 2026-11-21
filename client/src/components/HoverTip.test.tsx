/**
 * The app's own hover box (YAZ-4772 demo: "tool tip on column hover?"; then "when you have the tool tip hover then right
 * click the tool tip shows up messed up"): after a short wait on hover a box shows in a portal on the page; leaving,
 * a press, a right-click or a scroll anywhere closes it at once, and a press before it shows cancels it.
 * And the shortcut ↗ after a row's title (YAZ-4797 demo) says where the page lives in that box.
 */
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { IndexRecord } from '@shared/types'
import { HoverTip } from './HoverTip'
import { ViewFolder, rowTitle } from '../views/view/GroupHeader'
import type { Row } from '../views/engine'
import { TEST_RECORDS } from '../views/testRecords'

;(globalThis as unknown as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true

let root: Root | null = null
let host: HTMLDivElement | null = null
beforeEach(() => vi.useFakeTimers())
afterEach(() => {
  act(() => root?.unmount())
  host?.remove()
  root = null
  host = null
  vi.useRealTimers()
})
function render(node: React.ReactNode) {
  host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
  act(() => root!.render(node))
}
const box = () => document.body.querySelector<HTMLElement>('.hover-tip[role="tooltip"]')
const enter = (el: Element) => act(() => void el.dispatchEvent(new MouseEvent('mouseover', { bubbles: true, relatedTarget: document.body })))
const leave = (el: Element) => act(() => void el.dispatchEvent(new MouseEvent('mouseout', { bubbles: true, relatedTarget: document.body })))
const wait = (ms: number) => act(() => void vi.advanceTimersByTime(ms))
const target = () => host!.querySelector<HTMLElement>('.mark')!

describe('YAZ-4772 demo: HoverTip', () => {
  beforeEach(() => render(<HoverTip className="mark" text="From Recipes">↳</HoverTip>))

  it('YAZ-4772 demo: a pointer passing over shows nothing; after the wait the box shows, on the page (not in the cell)', () => {
    enter(target())
    wait(100)
    expect(box()).toBeNull()
    wait(400)
    expect(box()?.textContent).toBe('From Recipes')
    expect(host!.contains(box())).toBe(false)
  })

  it('YAZ-4772 demo: leaving closes it', () => {
    enter(target())
    wait(400)
    leave(target())
    expect(box()).toBeNull()
  })

  it('YAZ-4772 demo: a right-click anywhere closes it, so a menu never shows under it', () => {
    enter(target())
    wait(400)
    act(() => void document.body.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true })))
    expect(box()).toBeNull()
  })

  it('YAZ-4772 demo: a press or a scroll anywhere closes it', () => {
    enter(target())
    wait(400)
    act(() => void document.body.dispatchEvent(new Event('pointerdown', { bubbles: true })))
    expect(box()).toBeNull()
    enter(target())
    wait(400)
    expect(box()).not.toBeNull()
    act(() => void document.dispatchEvent(new Event('scroll')))
    expect(box()).toBeNull()
  })

  it('YAZ-4772 demo: a right-click on the mark before the box shows cancels it', () => {
    enter(target())
    wait(100)
    act(() => void target().dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true })))
    wait(1000)
    expect(box()).toBeNull()
  })
})

describe('YAZ-4797 demo: the shortcut ↗ says where the page lives', () => {
  const row = (folder: string): Row => ({ record: { ...TEST_RECORDS[0], folder, title: 'Tiramisu', name: 'Tiramisu.md' } as IndexRecord, values: {} }) as unknown as Row

  it('YAZ-4797 demo: on Party menu, Tiramisu (in Recipes/Desserts) shows ↗ whose box reads "Shortcut. Lives in Recipes › Desserts"', () => {
    render(<ViewFolder.Provider value="Recipes/Party menu">{rowTitle(row('Recipes/Desserts'))}</ViewFolder.Provider>)
    const tip = host!.querySelector<HTMLElement>('.view-shortcut-tip')!
    expect(tip).not.toBeNull()
    enter(tip)
    wait(400)
    expect(box()?.textContent).toBe('Shortcut. Lives in Recipes › Desserts')
  })

  it('YAZ-4797 demo: a page at the vault top says "the vault"; a page that lives here has no ↗', () => {
    render(<ViewFolder.Provider value="Recipes/Party menu">{rowTitle(row(''))}</ViewFolder.Provider>)
    enter(host!.querySelector('.view-shortcut-tip')!)
    wait(400)
    expect(box()?.textContent).toBe('Shortcut. Lives in the vault')
    act(() => root!.unmount())
    host!.remove()
    render(<ViewFolder.Provider value="Recipes/Party menu">{rowTitle(row('Recipes/Party menu'))}</ViewFolder.Provider>)
    expect(host!.querySelector('.view-shortcut-tip')).toBeNull()
  })
})

describe('YAZ-5130 round 2 (Yaseen: "why is the tool tip so far away?"): the box sits right under its mark', () => {
  /** The mark's place on screen, and the box's real width (jsdom lays out nothing). */
  function place(markLeft: number, boxWidth: number) {
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
      return this.classList.contains('mark') ? ({ left: markLeft, right: markLeft + 16, top: 20, bottom: 38, width: 16, height: 18, x: markLeft, y: 20 } as DOMRect) : ({ left: 0, right: 0, top: 0, bottom: 0, width: 0, height: 0, x: 0, y: 0 } as DOMRect)
    })
    vi.spyOn(HTMLElement.prototype, 'offsetWidth', 'get').mockImplementation(function (this: HTMLElement) {
      return this.classList.contains('hover-tip') ? boxWidth : 0
    })
  }
  afterEach(() => vi.restoreAllMocks())

  it('a short box near the window`s right edge starts at its mark, not 268 px from the edge', () => {
    render(<HoverTip className="mark" text="Today: 9 min">◷</HoverTip>)
    place(window.innerWidth - 120, 110)
    enter(target())
    wait(400)
    expect(box()?.style.left).toBe(`${window.innerWidth - 120}px`)
    expect(box()?.style.top).toBe('44px')
  })

  it('a box too wide for the room after its mark moves left only as far as it must, 8 px from the edge', () => {
    render(<HoverTip className="mark" text="A long hint">◷</HoverTip>)
    place(window.innerWidth - 120, 250)
    enter(target())
    wait(400)
    expect(box()?.style.left).toBe(`${window.innerWidth - 258}px`)
    // Far from the edge: at its mark, as before.
    leave(target())
    place(40, 250)
    enter(target())
    wait(400)
    expect(box()?.style.left).toBe('40px')
  })

  it('`focus`: a keyboard focus on the mark shows the box at once; the blur hides it', () => {
    render(
      <HoverTip className="mark" text="Today: 9 min" focus>
        <span className="clock" tabIndex={0}>
          ◷
        </span>
      </HoverTip>,
    )
    act(() => host!.querySelector<HTMLElement>('.clock')!.focus())
    expect(box()?.textContent).toBe('Today: 9 min')
    act(() => host!.querySelector<HTMLElement>('.clock')!.blur())
    expect(box()).toBeNull()
  })

  it('without `focus`, a focus shows nothing (the other boxes stay hover-only)', () => {
    render(
      <HoverTip className="mark" text="From Recipes">
        <button type="button">↳</button>
      </HoverTip>,
    )
    act(() => host!.querySelector('button')!.focus())
    wait(1000)
    expect(box()).toBeNull()
  })
})

describe('YAZ-5130 round 3 (Yaseen: "im getting a macos tool tip also?"): one box, never the native tooltip too', () => {
  it('the mark carries an empty `title`, so no native tooltip shows over it — not even an ancestor`s', () => {
    render(
      <div title="Reviewed today in this vault">
        <HoverTip className="mark" text="Time so far">
          ◷
        </HoverTip>
      </div>,
    )
    // An empty title is "no advisory information" for the mark and all inside it: the ancestor's stops here.
    expect(target().getAttribute('title')).toBe('')
  })
})
