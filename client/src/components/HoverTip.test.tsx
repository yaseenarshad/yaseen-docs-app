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
